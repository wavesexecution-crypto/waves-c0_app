"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "@wavesco/auth";
import { withTenantContext } from "@wavesco/db";
import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { recordActivity } from "@/lib/wavesco/activity";

async function requireUser(): Promise<{ tenantId: string; userId: string; role: string }> {
  const session = await auth();
  const user = requireSession(session);
  return { tenantId: user.tenantId, userId: user.id, role: user.role };
}

export interface ActionState {
  ok: boolean;
  error?: string;
  message?: string;
}

function optStr(formData: FormData, name: string): string | undefined {
  const v = formData.get(name);
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

const createSchema = z.object({
  name: z.string().min(2).max(120),
  company: z.string().max(120).optional(),
  email: z.string().email().optional().or(z.literal("")),
  phone: z.string().max(30).optional(),
  notes: z.string().max(2000).optional(),
  sourceLeadKey: z.string().max(200).optional(),
});

export async function createClientAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser();
  if (!can({ role: user.role }, "create", "clients")) {
    return { ok: false, error: "Admin role required to add clients." };
  }
  const parsed = createSchema.safeParse({
    name: formData.get("name"),
    company: optStr(formData, "company"),
    email: optStr(formData, "email"),
    phone: optStr(formData, "phone"),
    notes: optStr(formData, "notes"),
    sourceLeadKey: optStr(formData, "sourceLeadKey"),
  });
  if (!parsed.success) {
    return { ok: false, error: "Client name (2+ chars) is required; email must be valid if given." };
  }

  const clientId = await withTenantContext(user.tenantId, async (tx) => {
    const client = await tx.client.create({
      data: {
        tenantId: user.tenantId,
        name: parsed.data.name,
        company: parsed.data.company,
        email: parsed.data.email && parsed.data.email.length > 0 ? parsed.data.email : null,
        phone: parsed.data.phone,
        notes: parsed.data.notes,
        sourceLeadKey: parsed.data.sourceLeadKey,
        ownerUserId: user.userId,
        status: "onboarding",
      },
    });
    // Standard onboarding checklist
    const steps = [
      "Discovery call completed",
      "Proposal + scope signed",
      "Kickoff scheduled",
      "Access & assets collected",
      "First deliverable planned",
    ];
    await tx.onboardingStep.createMany({
      data: steps.map((title, i) => ({
        tenantId: user.tenantId,
        clientId: client.id,
        seq: i + 1,
        title,
      })),
    });
    return client.id;
  });

  await recordActivity(user.tenantId, {
    type: "client_created",
    title: `Client "${parsed.data.name}" added — onboarding started`,
    entityType: "client",
    entityId: clientId,
    href: `/clients/${clientId}`,
  });

  revalidatePath("/clients");
  revalidatePath("/command");
  return { ok: true, message: clientId };
}

const toggleStepSchema = z.object({
  stepId: z.string().min(1),
  done: z.enum(["true", "false"]),
});

export async function toggleOnboardingStepAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser();
  if (!can({ role: user.role }, "update", "clients")) {
    return { ok: false, error: "Admin role required." };
  }
  const parsed = toggleStepSchema.safeParse({
    stepId: formData.get("stepId"),
    done: formData.get("done"),
  });
  if (!parsed.success) return { ok: false, error: "Invalid request." };

  await withTenantContext(user.tenantId, async (tx) => {
    await tx.onboardingStep.updateMany({
      where: { id: parsed.data.stepId, tenantId: user.tenantId },
      data: {
        done: parsed.data.done === "true",
        doneAt: parsed.data.done === "true" ? new Date() : null,
      },
    });
  });
  revalidatePath("/clients");
  return { ok: true };
}

// ------------------------------------------------------------------
// Projects
// ------------------------------------------------------------------

const projectSchema = z.object({
  clientId: z.string().min(1),
  name: z.string().min(2).max(120),
  description: z.string().max(2000).optional(),
});

export async function createProjectAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser();
  if (!can({ role: user.role }, "create", "clients")) {
    return { ok: false, error: "Admin role required." };
  }
  const parsed = projectSchema.safeParse({
    clientId: formData.get("clientId"),
    name: formData.get("name"),
    description: optStr(formData, "description"),
  });
  if (!parsed.success) return { ok: false, error: "Project name (2+ chars) required." };

  const projectId = await withTenantContext(user.tenantId, async (tx) => {
    const client = await tx.client.findFirst({
      where: { id: parsed.data.clientId, tenantId: user.tenantId },
      select: { id: true },
    });
    if (!client) throw new Error("Client not found.");
    const project = await tx.project.create({
      data: {
        tenantId: user.tenantId,
        clientId: parsed.data.clientId,
        name: parsed.data.name,
        description: parsed.data.description,
        status: "planning",
      },
    });
    return project.id;
  });

  await recordActivity(user.tenantId, {
    type: "client_created",
    title: `Project "${parsed.data.name}" created`,
    entityType: "project",
    entityId: projectId,
    href: `/clients/${parsed.data.clientId}`,
  });
  revalidatePath(`/clients/${parsed.data.clientId}`);
  return { ok: true, message: projectId };
}

const taskSchema = z.object({
  projectId: z.string().min(1),
  clientId: z.string().min(1),
  title: z.string().min(2).max(160),
  priority: z.enum(["low", "medium", "high"]).optional(),
});

export async function createTaskAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser();
  if (!can({ role: user.role }, "create", "clients")) {
    return { ok: false, error: "Admin role required." };
  }
  const parsed = taskSchema.safeParse({
    projectId: formData.get("projectId"),
    clientId: formData.get("clientId"),
    title: formData.get("title"),
    priority: optStr(formData, "priority"),
  });
  if (!parsed.success) return { ok: false, error: "Task title (2+ chars) required." };

  await withTenantContext(user.tenantId, async (tx) => {
    const project = await tx.project.findFirst({
      where: { id: parsed.data.projectId, tenantId: user.tenantId },
      select: { id: true },
    });
    if (!project) throw new Error("Project not found.");
    await tx.projectTask.create({
      data: {
        tenantId: user.tenantId,
        projectId: parsed.data.projectId,
        title: parsed.data.title,
        priority: parsed.data.priority ?? "medium",
      },
    });
  });
  revalidatePath(`/clients/${parsed.data.clientId}`);
  return { ok: true };
}

const taskStatusSchema = z.object({
  taskId: z.string().min(1),
  status: z.enum(["todo", "in_progress", "blocked", "done"]),
  clientId: z.string().min(1),
});

export async function updateTaskStatusAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser();
  if (!can({ role: user.role }, "update", "clients")) {
    return { ok: false, error: "Admin role required." };
  }
  const parsed = taskStatusSchema.safeParse({
    taskId: formData.get("taskId"),
    status: formData.get("status"),
    clientId: formData.get("clientId"),
  });
  if (!parsed.success) return { ok: false, error: "Invalid request." };

  await withTenantContext(user.tenantId, async (tx) => {
    await tx.projectTask.updateMany({
      where: { id: parsed.data.taskId, tenantId: user.tenantId },
      data: {
        status: parsed.data.status,
        completedAt: parsed.data.status === "done" ? new Date() : null,
      },
    });
  });
  revalidatePath(`/clients/${parsed.data.clientId}`);
  return { ok: true };
}

// ------------------------------------------------------------------
// Deliverables
// ------------------------------------------------------------------

const deliverableSchema = z.object({
  projectId: z.string().min(1),
  clientId: z.string().min(1),
  title: z.string().min(2).max(160),
  type: z.string().max(60).optional(),
});

export async function createDeliverableAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser();
  if (!can({ role: user.role }, "create", "clients")) {
    return { ok: false, error: "Admin role required." };
  }
  const parsed = deliverableSchema.safeParse({
    projectId: formData.get("projectId"),
    clientId: formData.get("clientId"),
    title: formData.get("title"),
    type: optStr(formData, "type"),
  });
  if (!parsed.success) return { ok: false, error: "Deliverable title (2+ chars) required." };

  await withTenantContext(user.tenantId, async (tx) => {
    const project = await tx.project.findFirst({
      where: { id: parsed.data.projectId, tenantId: user.tenantId },
      select: { id: true },
    });
    if (!project) throw new Error("Project not found.");
    await tx.deliverable.create({
      data: {
        tenantId: user.tenantId,
        projectId: parsed.data.projectId,
        title: parsed.data.title,
        type: parsed.data.type,
      },
    });
  });
  revalidatePath(`/clients/${parsed.data.clientId}`);
  return { ok: true };
}

const deliverableStatusSchema = z.object({
  deliverableId: z.string().min(1),
  status: z.enum(["draft", "review", "delivered", "approved"]),
  clientId: z.string().min(1),
});

export async function setDeliverableStatusAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser();
  if (!can({ role: user.role }, "update", "clients")) {
    return { ok: false, error: "Admin role required." };
  }
  const parsed = deliverableStatusSchema.safeParse({
    deliverableId: formData.get("deliverableId"),
    status: formData.get("status"),
    clientId: formData.get("clientId"),
  });
  if (!parsed.success) return { ok: false, error: "Invalid request." };

  await withTenantContext(user.tenantId, async (tx) => {
    await tx.deliverable.updateMany({
      where: { id: parsed.data.deliverableId, tenantId: user.tenantId },
      data: {
        status: parsed.data.status,
        deliveredAt: parsed.data.status === "delivered" ? new Date() : null,
      },
    });
  });
  revalidatePath(`/clients/${parsed.data.clientId}`);
  return { ok: true };
}
