import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { acquisitionDenied, auditControl, requireControlAuth } from "@/lib/wavesco/control";
import { withTenantContext } from "@wavesco/db";

export const dynamic = "force-dynamic";

function sanitizeString(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t.length > 0 ? t : undefined;
}

function renderTemplate(str: string, vars: Record<string, string>): string {
  return str.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key: string) => {
    const val = vars[key];
    if (val !== undefined && val !== null) return String(val);
    // keep placeholder if not found but without extra braces spacing
    return `{{${key}}}`;
  });
}

function extractVars(body: Record<string, unknown>, fallback: Record<string, string>): Record<string, string> {
  const vars: Record<string, string> = { ...fallback };
  const explicit = (body.vars ?? body.leadVars ?? body.variables) as unknown;
  if (explicit && typeof explicit === "object" && !Array.isArray(explicit)) {
    for (const [k, v] of Object.entries(explicit as Record<string, unknown>)) {
      if (typeof v === "string" && k.trim().length > 0) vars[k.trim()] = v;
      else if (typeof v === "number") vars[k.trim()] = String(v);
    }
  }
  // also allow flat business/city/email at top level
  for (const key of ["business", "city", "name", "email", "leadKey", "businessName"]) {
    const val = (body as Record<string, unknown>)[key];
    if (typeof val === "string" && val.trim().length > 0) {
      vars[key] = val.trim();
      if (key === "businessName") vars.business = val.trim();
    }
  }
  return vars;
}

export async function GET(req: Request) {
  let tenantId: string;
  try {
    const auth = await requireControlAuth();
    const denied = await acquisitionDenied(auth.tenantId);
    if (denied) return NextResponse.json(denied.body, { status: denied.status });
    tenantId = auth.tenantId;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const digest = (e as { digest?: string })?.digest as string | undefined;
    const isUnauthorized =
      msg === "UNAUTHORIZED" ||
      msg.includes("UNAUTHORIZED") ||
      msg.includes("NEXT_REDIRECT") ||
      (digest !== undefined && digest.includes("NEXT_REDIRECT"));
    if (isUnauthorized) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Try to list templates from DB; handle missing table gracefully
  let templates: any[] = [];
  let status: "ok" | "not_configured" = "ok";
  let reason: string | undefined;

  try {
    const result = await withTenantContext(tenantId, async (tx: any) => {
      // Prefer EmailTemplate if exists
      if (tx.emailTemplate && typeof tx.emailTemplate.findMany === "function") {
        try {
          const rows = await tx.emailTemplate.findMany({
            where: { tenantId },
            orderBy: { createdAt: "desc" },
            take: 50,
          });
          return rows ?? [];
        } catch {
          // fall through to activityEvent fallback
        }
      }
      // Fallback: ActivityEvent with type email_template
      if (tx.activityEvent && typeof tx.activityEvent.findMany === "function") {
        try {
          const events = await tx.activityEvent.findMany({
            where: { tenantId, type: "email_template" },
            orderBy: { createdAt: "desc" },
            take: 50,
          });
          if (Array.isArray(events) && events.length > 0) {
            return events.map((e: any) => ({
              id: e.id,
              subject: e.title ?? (e.metadata as any)?.subject ?? "",
              body: (e.metadata as any)?.body ?? "",
              createdAt: e.createdAt,
              source: "activity",
              metadata: e.metadata,
            }));
          }
        } catch {
          // ignore
        }
      }
      // Fallback: outreachEmail recent subjects as template hints (read-only)
      if (tx.outreachEmail && typeof tx.outreachEmail.findMany === "function") {
        try {
          const emails = await tx.outreachEmail.findMany({
            where: { tenantId },
            orderBy: { createdAt: "desc" },
            take: 5,
            select: { id: true, subject: true, body: true, createdAt: true },
          }).catch(() => []);
          if (Array.isArray(emails) && emails.length > 0) {
            // Do not treat as real templates, but return empty to signal not_configured
            return [];
          }
        } catch {
          // ignore
        }
      }
      return [];
    });
    templates = Array.isArray(result) ? result : [];
    if (templates.length === 0) {
      // No persistent template table or no rows -> not_configured but still 200
      status = "not_configured";
      reason = "EmailTemplate table not configured or no templates yet";
    } else {
      status = "ok";
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    status = "not_configured";
    reason = msg.slice(0, 200);
    templates = [];
  }

  // Never expose secrets
  const safeTemplates = templates.map((t: any) => ({
    id: t.id,
    subject: t.subject,
    body: t.body,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt ?? t.createdAt,
    ...(t.source ? { source: t.source } : {}),
  }));

  return NextResponse.json(
    {
      status,
      templates: safeTemplates,
      count: safeTemplates.length,
      ...(reason ? { reason } : {}),
    },
    { status: 200 }
  );
}

const VALID_ACTIONS = ["create", "update", "preview"] as const;
type Action = (typeof VALID_ACTIONS)[number];

export async function POST(req: Request) {
  let tenantId: string;
  let userId: string | null | undefined;
  try {
    const auth = await requireControlAuth();
    const denied = await acquisitionDenied(auth.tenantId);
    if (denied) return NextResponse.json(denied.body, { status: denied.status });
    tenantId = auth.tenantId;
    userId = auth.userId;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const digest = (e as { digest?: string })?.digest as string | undefined;
    const isUnauthorized =
      msg === "UNAUTHORIZED" ||
      msg.includes("UNAUTHORIZED") ||
      msg.includes("NEXT_REDIRECT") ||
      (digest !== undefined && digest.includes("NEXT_REDIRECT"));
    if (isUnauthorized) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown> = {};
  try {
    const raw = await req.text();
    if (raw) body = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const rawAction = sanitizeString(body.action) ?? "";
  const action = rawAction.toLowerCase() as Action;
  if (!VALID_ACTIONS.includes(action as Action)) {
    // also support alternative key "templateId" without action meaning preview
    const hasTemplateId = Boolean(sanitizeString(body.templateId) ?? sanitizeString((body as any).id));
    const hasLeadKey = Boolean(sanitizeString(body.leadKey));
    if (hasTemplateId || hasLeadKey) {
      // treat as preview if no explicit action but templateId/leadKey present
    } else {
      return NextResponse.json({ error: "invalid action", valid: VALID_ACTIONS, received: rawAction || null }, { status: 400 });
    }
  }

  // Determine effective action: if body.action missing but leadKey/templateId present, default to preview
  const effectiveAction: Action = VALID_ACTIONS.includes(action as Action) ? action as Action : "preview";

  // Extract template
  let templateInput: { subject?: string; body?: string } | null = null;
  if (body.template && typeof body.template === "object" && !Array.isArray(body.template)) {
    const t = body.template as Record<string, unknown>;
    templateInput = {
      subject: typeof t.subject === "string" ? t.subject : undefined,
      body: typeof t.body === "string" ? t.body : undefined,
    };
  } else {
    // flat subject/body at top level
    const subj = sanitizeString(body.subject);
    const bdy = typeof body.body === "string" ? (body.body as string) : undefined;
    if (subj !== undefined || bdy !== undefined) {
      templateInput = { subject: subj, body: bdy };
    }
  }

  const templateId = sanitizeString(body.templateId) ?? sanitizeString((body as any).id) ?? sanitizeString((body as any).template_id) ?? undefined;
  const leadKey = sanitizeString(body.leadKey) ?? undefined;

  // Default vars fallback; will be enriched via DB if leadKey present
  let varsFallback: Record<string, string> = {
    business: "Acme Corp",
    city: "Pune",
    name: "there",
    email: "test@example.com",
  };

  // If leadKey provided, try to fetch lead vars tenant-scoped
  if (leadKey) {
    try {
      const leadVars = await withTenantContext(tenantId, async (tx: any) => {
        // Try LeadResearch first
        if (tx.leadResearch && typeof tx.leadResearch.findFirst === "function") {
          try {
            const lr = await tx.leadResearch.findFirst({ where: { tenantId, leadKey } });
            if (lr) {
              return {
                business: (lr as any).business ?? (lr as any).businessName ?? undefined,
                city: (lr as any).city ?? (lr as any).area ?? undefined,
                name: (lr as any).contactName ?? undefined,
                email: (lr as any).email ?? undefined,
              };
            }
          } catch {
            // ignore
          }
          try {
            const lr2 = await tx.leadResearch.findUnique?.({ where: { tenantId_leadKey: { tenantId, leadKey } } });
            if (lr2) {
              return {
                business: (lr2 as any).business ?? undefined,
                city: (lr2 as any).city ?? undefined,
                name: (lr2 as any).contactName ?? undefined,
                email: (lr2 as any).email ?? undefined,
              };
            }
          } catch {
            // ignore
          }
        }
        if (tx.outreachOrder && typeof tx.outreachOrder.findFirst === "function") {
          try {
            const oo = await tx.outreachOrder.findFirst({ where: { tenantId, leadKey } });
            if (oo) {
              return {
                business: (oo as any).businessName ?? (oo as any).business ?? undefined,
                city: ((oo as any).researchSnapshot as any)?.city ?? undefined,
                name: (oo as any).contactName ?? undefined,
                email: (oo as any).email ?? undefined,
              };
            }
          } catch {
            // ignore
          }
        }
        return null;
      });
      if (leadVars) {
        for (const [k, v] of Object.entries(leadVars)) {
          if (typeof v === "string" && v.trim().length > 0) varsFallback[k] = v.trim();
        }
      }
    } catch {
      // ignore lead fetch errors
    }
  }

  const vars = extractVars(body as Record<string, unknown>, varsFallback);
  // Ensure leadKey-provided business/city override fallback if fetched
  // (already done via varsFallback merge, but ensure vars has business/city)
  if (!vars.business && varsFallback.business) vars.business = varsFallback.business;
  if (!vars.city && varsFallback.city) vars.city = varsFallback.city;

  // Handle preview
  if (effectiveAction === "preview") {
    // Need template to preview; if templateId provided without template body, fetch it
    let subjectToRender = templateInput?.subject ?? "";
    let bodyToRender = templateInput?.body ?? "";

    if ((!subjectToRender || !bodyToRender) && templateId) {
      try {
        const fetched = await withTenantContext(tenantId, async (tx: any) => {
          if (tx.emailTemplate && typeof tx.emailTemplate.findFirst === "function") {
            try {
              const t = await tx.emailTemplate.findFirst({ where: { id: templateId, tenantId } });
              if (t) return t;
              const t2 = await tx.emailTemplate.findUnique?.({ where: { id: templateId } });
              return t2 ?? null;
            } catch {
              return null;
            }
          }
          if (tx.activityEvent && typeof tx.activityEvent.findFirst === "function") {
            try {
              const ev = await tx.activityEvent.findFirst({ where: { id: templateId, tenantId, type: "email_template" } });
              if (ev) return { subject: ev.title, body: (ev.metadata as any)?.body ?? "" };
            } catch {
              return null;
            }
          }
          return null;
        });
        if (fetched) {
          if (!subjectToRender && (fetched as any).subject) subjectToRender = String((fetched as any).subject);
          if (!bodyToRender && (fetched as any).body) bodyToRender = String((fetched as any).body);
        }
      } catch {
        // ignore fetch errors
      }
    }

    // If still empty, provide helpful error but still render minimal
    if (!subjectToRender && !bodyToRender) {
      // If templateId/leadKey flow and no template found, still return preview with defaults
      subjectToRender = subjectToRender || "Hello {{business}}";
      bodyToRender = bodyToRender || "Hi {{business}} in {{city}}";
    }

    const renderedSubject = renderTemplate(subjectToRender, vars);
    const renderedBody = renderTemplate(bodyToRender, vars);

    // Audit preview (never sends)
    try {
      await auditControl({
        tenantId,
        userId,
        action: "email.template.preview",
        model: "EmailTemplate",
        recordId: templateId ?? undefined,
        before: { subject: subjectToRender, body: bodyToRender },
        after: { subject: renderedSubject, body: renderedBody },
        metadata: { leadKey: leadKey ?? null, vars, preview: true },
      });
    } catch {
      // audit failure should not block preview
    }

    return NextResponse.json(
      {
        status: "ok",
        action: "preview",
        preview: { subject: renderedSubject, body: renderedBody },
        rendered: { subject: renderedSubject, body: renderedBody },
        subject: renderedSubject,
        body: renderedBody,
        vars,
        template: { subject: subjectToRender, body: bodyToRender },
        leadKey: leadKey ?? null,
        // never expose send status
      },
      { status: 200 }
    );
  }

  // Handle create / update
  if (effectiveAction === "create" || effectiveAction === "update") {
    if (!templateInput || (!templateInput.subject && !templateInput.body)) {
      return NextResponse.json({ error: "template subject and body required", hint: "provide template: { subject, body }" }, { status: 400 });
    }

    const subject = templateInput.subject?.trim() ?? "";
    const bodyStr = templateInput.body ?? "";
    if (subject.length === 0 || bodyStr.trim().length === 0) {
      return NextResponse.json({ error: "template subject and body cannot be empty" }, { status: 400 });
    }
    if (subject.length > 200) {
      return NextResponse.json({ error: "subject too long (max 200)" }, { status: 400 });
    }
    if (bodyStr.length > 10000) {
      return NextResponse.json({ error: "body too long (max 10000)" }, { status: 400 });
    }

    let createdOrUpdated: any = null;
    let before: unknown = null;

    try {
      const result: any = await withTenantContext(tenantId, async (tx: any) => {
        if (effectiveAction === "create") {
          // Try real table else simulate
          if (tx.emailTemplate && typeof tx.emailTemplate.create === "function") {
            try {
              const created = await tx.emailTemplate.create({
                data: {
                  id: `tmpl_${randomUUID().replace(/-/g, "").slice(0, 12)}`,
                  tenantId,
                  subject,
                  body: bodyStr,
                },
              });
              return created;
            } catch (e) {
              // fallback to activityEvent
              if (tx.activityEvent && typeof tx.activityEvent.create === "function") {
                const ev = await tx.activityEvent.create({
                  data: {
                    tenantId,
                    type: "email_template",
                    title: subject,
                    metadata: { body: bodyStr, subject, createdVia: "email.template.create" },
                  },
                });
                return { id: ev.id, subject, body: bodyStr, createdAt: ev.createdAt, source: "activity" };
              }
              throw e;
            }
          }
          // No emailTemplate table: simulate + optionally persist as ActivityEvent
          if (tx.activityEvent && typeof tx.activityEvent.create === "function") {
            try {
              const ev = await tx.activityEvent.create({
                data: {
                  tenantId,
                  type: "email_template",
                  title: subject,
                  metadata: { body: bodyStr, subject, createdVia: "email.template.create" },
                },
              });
              return { id: ev.id, subject, body: bodyStr, createdAt: ev.createdAt, source: "activity" };
            } catch {
              // ignore
            }
          }
          // No emailTemplate table and no activityEvent fallback: refuse.
          // Returning a fabricated in-memory object with HTTP 200 made the UI
          // print "Template created — audit-logged" for something that was
          // never stored and vanished on refresh.
          throw new Error("TEMPLATE_STORAGE_UNAVAILABLE");
        } else {
          // update
          const id = templateId;
          if (!id) {
            throw new Error("templateId required for update");
          }
          // try fetch before
          let existing: any = null;
          if (tx.emailTemplate && typeof tx.emailTemplate.findFirst === "function") {
            try {
              // Tenant-scoped only. The previous `findUnique({ id })` fallback
              // matched another workspace's template on a guessed id.
              existing = await tx.emailTemplate.findFirst({ where: { id, tenantId } });
            } catch {
              // ignore
            }
          }
          if (!existing && tx.activityEvent && typeof tx.activityEvent.findFirst === "function") {
            try {
              const ev = await tx.activityEvent.findFirst({ where: { id, tenantId, type: "email_template" } });
              if (ev) existing = { id: ev.id, subject: ev.title, body: (ev.metadata as any)?.body ?? "" };
            } catch {
              // ignore
            }
          }
          before = existing;

          if (!existing) {
            // Never write to a row this tenant cannot see.
            throw new Error("TEMPLATE_NOT_FOUND");
          }

          if (tx.emailTemplate && typeof tx.emailTemplate.update === "function") {
            try {
              // Tenant-scoped update — `update({ where: { id } })` mutated
              // whichever tenant owned that id.
              const updated = await tx.emailTemplate.updateMany({
                where: { id, tenantId },
                data: { subject, body: bodyStr },
              });
              if (updated.count > 0) {
                return { id, tenantId, subject, body: bodyStr, updatedAt: new Date().toISOString() };
              }
              throw new Error("TEMPLATE_NOT_FOUND");
            } catch (e) {
              if (e instanceof Error && e.message === "TEMPLATE_NOT_FOUND") throw e;
              // fall through to activityEvent update if available
              if (tx.activityEvent && typeof tx.activityEvent.update === "function") {
                const ev = await tx.activityEvent.update({
                  where: { id },
                  data: { title: subject, metadata: { body: bodyStr, subject } },
                });
                return { id: ev.id, subject, body: bodyStr, updatedAt: ev.createdAt };
              }
              // Refuse rather than report a simulated success.
              throw new Error("TEMPLATE_STORAGE_UNAVAILABLE");
            }
          }
          if (tx.activityEvent && typeof tx.activityEvent.update === "function") {
            try {
              const ev = await tx.activityEvent.update({ where: { id }, data: { title: subject, metadata: { body: bodyStr, subject } } });
              return { id: ev.id, subject, body: bodyStr, updatedAt: new Date().toISOString() };
            } catch {
              // ignore
            }
          }
          throw new Error("TEMPLATE_STORAGE_UNAVAILABLE");
        }
      });
      createdOrUpdated = result;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("templateId required")) {
        return NextResponse.json({ error: "templateId required for update" }, { status: 400 });
      }
      if (msg.includes("TEMPLATE_NOT_FOUND")) {
        return NextResponse.json({ error: "That template does not exist." }, { status: 404 });
      }
      if (msg.includes("TEMPLATE_STORAGE_UNAVAILABLE")) {
        console.error("[email:templates] template storage unavailable", e);
        return NextResponse.json(
          { error: "Templates cannot be saved right now. Contact Waves — your email has not been changed." },
          { status: 501 }
        );
      }
      console.error("[email:templates] write failed", e);
      return NextResponse.json(
        { error: "We could not save that template. Try again in a moment." },
        { status: 500 }
      );
    }

    // Audit create/update
    try {
      await auditControl({
        tenantId,
        userId,
        action: `email.template.${effectiveAction}`,
        model: "EmailTemplate",
        recordId: (createdOrUpdated?.id as string) ?? templateId ?? undefined,
        before: before ?? undefined,
        after: { subject, body: bodyStr },
        metadata: { templateId: createdOrUpdated?.id ?? templateId ?? null, subject, vars: undefined },
      });
    } catch {
      // ignore audit failure
    }

    return NextResponse.json(
      {
        status: "ok",
        action: effectiveAction,
        template: {
          id: createdOrUpdated?.id ?? templateId ?? `tmpl_${randomUUID().replace(/-/g, "").slice(0, 12)}`,
          subject,
          body: bodyStr,
          createdAt: createdOrUpdated?.createdAt ?? new Date().toISOString(),
          updatedAt: createdOrUpdated?.updatedAt ?? undefined,
        },
      },
      { status: 200 }
    );
  }

  return NextResponse.json({ error: "unhandled" }, { status: 400 });
}
