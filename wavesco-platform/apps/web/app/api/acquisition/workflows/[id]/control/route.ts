import { NextResponse } from "next/server";
import { acquisitionDenied, auditControl, requireControlAuth } from "@/lib/wavesco/control";
import { n8nBaseUrl, n8nApiKey } from "@/lib/wavesco/n8n";

export const dynamic = "force-dynamic";

const VALID_ACTIONS = ["enable", "disable", "execute", "retry"] as const;
type Action = (typeof VALID_ACTIONS)[number];

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  let tenantId: string;
  let userId: string | null;
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

  const { id } = await ctx.params;
  if (!id) return NextResponse.json({ error: "missing id" }, { status: 400 });

  let body: Record<string, unknown> = {};
  try {
    const raw = await req.text();
    if (raw) body = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    // invalid JSON
  }
  const action = typeof body.action === "string" ? body.action.trim() : "";
  if (!VALID_ACTIONS.includes(action as Action)) {
    return NextResponse.json({ error: "invalid action", valid: VALID_ACTIONS, received: action || null }, { status: 400 });
  }

  // audit before proxy (always log attempt)
  try {
    await auditControl({
      tenantId,
      userId,
      action: `workflow.${action}`,
      model: "Workflow",
      recordId: id,
      before: { id },
      after: { action },
      metadata: { action },
    });
  } catch {
    // audit failure should not block control, but we continue
  }

  const base = n8nBaseUrl();
  if (!base) {
    return NextResponse.json({ status: "BLOCKED", reason: "N8N_BASE_URL missing" }, { status: 400 });
  }
  const key = n8nApiKey();
  if (!key) {
    return NextResponse.json({ status: "error", reason: "N8N_API_KEY missing — cannot proxy to n8n" }, { status: 400 });
  }

  const headers: Record<string, string> = { accept: "application/json", "X-N8N-API-KEY": key, "content-type": "application/json" };

  try {
    if (action === "enable" || action === "disable") {
      const active = action === "enable";
      const res = await fetch(`${base}/api/v1/workflows/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ active }),
        cache: "no-store",
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        return NextResponse.json({ status: "error", reason: `n8n API ${res.status}: ${text.slice(0, 200)}` }, { status: res.status >= 500 ? 502 : res.status });
      }
      const data = await res.json().catch(() => ({}));
      return NextResponse.json({ status: "ok", action, id, active, data }, { status: 200 });
    }

    if (action === "execute") {
      const res = await fetch(`${base}/api/v1/workflows/${encodeURIComponent(id)}/execute`, {
        method: "POST",
        headers,
        cache: "no-store",
      });
      if (!res.ok) {
        // fallback: try trigger endpoint
        const alt = await fetch(`${base}/api/v1/workflows/${encodeURIComponent(id)}/run`, {
          method: "POST",
          headers,
          cache: "no-store",
        }).catch(() => null);
        if (!alt || !alt.ok) {
          const text = await res.text().catch(() => "");
          return NextResponse.json({ status: "error", reason: `n8n execute ${res.status}: ${text.slice(0, 200)}` }, { status: res.status >= 500 ? 502 : res.status });
        }
        const data = await alt.json().catch(() => ({}));
        return NextResponse.json({ status: "ok", action, id, data }, { status: 200 });
      }
      const data = await res.json().catch(() => ({}));
      return NextResponse.json({ status: "ok", action, id, data }, { status: 200 });
    }

    if (action === "retry") {
      // retry: if body.executionId provided, try executions retry endpoint
      const executionId = typeof body.executionId === "string" ? body.executionId : null;
      if (executionId) {
        const res = await fetch(`${base}/api/v1/executions/${encodeURIComponent(executionId)}/retry`, {
          method: "POST",
          headers,
          cache: "no-store",
        });
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          return NextResponse.json({ status: "error", reason: `n8n retry ${res.status}: ${text.slice(0, 200)}` }, { status: res.status >= 500 ? 502 : res.status });
        }
        const data = await res.json().catch(() => ({}));
        return NextResponse.json({ status: "ok", action, id, executionId, data }, { status: 200 });
      }
      // fallback to execute workflow again
      const res = await fetch(`${base}/api/v1/workflows/${encodeURIComponent(id)}/execute`, {
        method: "POST",
        headers,
        cache: "no-store",
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        return NextResponse.json({ status: "error", reason: `n8n retry/execute ${res.status}: ${text.slice(0, 200)}` }, { status: res.status >= 500 ? 502 : res.status });
      }
      const data = await res.json().catch(() => ({}));
      return NextResponse.json({ status: "ok", action, id, data }, { status: 200 });
    }

    return NextResponse.json({ error: "unhandled" }, { status: 500 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ status: "error", reason: msg }, { status: 502 });
  }
}
