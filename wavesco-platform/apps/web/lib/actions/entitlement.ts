"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@wavesco/auth";
import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import {
  activatePaid,
  startTrial,
  transitionEntitlement,
} from "@/lib/wavesco/entitlements";

async function requireUser(): Promise<{ tenantId: string; userId: string; role: string }> {
  const session = await auth();
  const user = requireSession(session);
  return { tenantId: user.tenantId, userId: user.id, role: user.role };
}

export interface EntitlementActionState {
  ok: boolean;
  error?: string;
  message?: string;
  status?: string;
}

function refresh() {
  revalidatePath("/products");
  revalidatePath("/billing");
  revalidatePath("/acquisition");
  revalidatePath("/acquisition/profile");
}

/** Self-serve trial start (admin+). Idempotent — already-trialed tenants get a clear 409-style message. */
export async function startTrialAction(): Promise<EntitlementActionState> {
  const user = await requireUser();
  if (!can({ role: user.role }, "create", "acquisition")) {
    return { ok: false, error: "Admin role required to start a trial." };
  }
  try {
    const { entitlement } = await startTrial(user.tenantId, user.userId);
    refresh();
    return {
      ok: true,
      status: entitlement.status,
      message: `Trial started — access until ${entitlement.trialExpiresAt ? new Date(entitlement.trialExpiresAt).toLocaleDateString() : "expiry"}. Complete your Company Profile next.`,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not start trial." };
  }
}

function str(formData: FormData, name: string): string {
  const v = formData.get(name);
  return typeof v === "string" ? v.trim() : "";
}

/** Record a verified off-band grant (owner only). This is the seam future
 *  payment providers will call server-side; today Waves confirms payment
 *  off-band and the tenant owner records the grant with its reference. */
export async function activatePaidAction(
  _prev: EntitlementActionState,
  formData: FormData,
): Promise<EntitlementActionState> {
  const user = await requireUser();
  if (!can({ role: user.role }, "admin", "acquisition")) {
    return { ok: false, error: "Owner role required to record paid access." };
  }
  const daysRaw = str(formData, "days");
  const expiresRaw = str(formData, "expiresAt");
  const days = daysRaw ? Number(daysRaw) : undefined;
  try {
    const { entitlement } = await activatePaid(
      user.tenantId,
      {
        provider: str(formData, "provider") || "manual",
        providerRef: str(formData, "providerRef") || undefined,
        idempotencyKey: str(formData, "idempotencyKey") || undefined,
        days,
        expiresAt: expiresRaw || undefined,
        note: str(formData, "note") || undefined,
      },
      user.userId,
    );
    refresh();
    return {
      ok: true,
      status: entitlement.status,
      message: `Paid access active until ${entitlement.expiresAt ? new Date(entitlement.expiresAt).toLocaleDateString() : "expiry"}.`,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not record paid access." };
  }
}

/** Lifecycle transitions on your own grant (owner only). */
export async function transitionEntitlementAction(
  _prev: EntitlementActionState,
  formData: FormData,
): Promise<EntitlementActionState> {
  const user = await requireUser();
  if (!can({ role: user.role }, "admin", "acquisition")) {
    return { ok: false, error: "Owner role required to change access state." };
  }
  const action = str(formData, "action");
  if (!["suspend", "resume", "cancel", "refund", "renew"].includes(action)) {
    return { ok: false, error: "Unknown transition." };
  }
  const daysRaw = str(formData, "days");
  try {
    const { entitlement } = await transitionEntitlement(
      user.tenantId,
      action as "suspend" | "resume" | "cancel" | "refund" | "renew",
      {
        reason: str(formData, "reason") || undefined,
        days: daysRaw ? Number(daysRaw) : undefined,
        expiresAt: str(formData, "expiresAt") || undefined,
      },
      user.userId,
    );
    refresh();
    return { ok: true, status: entitlement.status, message: `Access is now ${entitlement.status}.` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not change access state." };
  }
}
