import { NextResponse } from "next/server";
import { acquisitionDenied, auditControl, requireControlAuth } from "@/lib/wavesco/control";
import { withTenantContext } from "@wavesco/db";

export const dynamic = "force-dynamic";

function maskUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.protocol}//***`;
  } catch {
    return "***";
  }
}

function sanitizeConfig(raw: any): any | null {
  if (!raw) return null;
  const { credentialRef, ...rest } = raw;
  void credentialRef;
  const maskedBaseUrl = raw.baseUrl ? maskUrl(String(raw.baseUrl)) : null;
  return { ...rest, baseUrl: maskedBaseUrl };
}

function gatewayView(config: any): { status: string; provider: string | null; model: string | null; baseUrl: string | null } {
  if (!config) return { status: "not_configured", provider: null, model: null, baseUrl: null };
  const baseUrl = config.baseUrl ? maskUrl(String(config.baseUrl)) : null;
  const status = config.aiEnabled ? "ok" : "disabled";
  return { status, provider: config.provider ?? null, model: config.model ?? null, baseUrl };
}

const VALID_ACTIONS = ["enable", "disable", "configure"] as const;
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
    if (isUnauthorized) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown> = {};
  try {
    const raw = await req.text();
    if (raw) body = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const action = typeof body.action === "string" ? body.action.trim() : "";
  if (!VALID_ACTIONS.includes(action as Action)) {
    return NextResponse.json({ error: "invalid action", valid: VALID_ACTIONS, received: action || null }, { status: 400 });
  }

  const incomingConfig = body.config as Record<string, unknown> | undefined;

  try {
    const outcome: any = await withTenantContext(tenantId, async (tx: any) => {
      const before = await tx.clientAiConfig.findFirst({ where: { tenantId }, orderBy: { createdAt: "desc" } });
      let after: any = null;
      let operationError: string | null = null;

      if (action === "enable") {
        if (!before) after = await tx.clientAiConfig.create({ data: { tenantId, aiEnabled: true, provider: "ollama_cloud", model: "gemma3:27b" } });
        else after = await tx.clientAiConfig.update({ where: { id: before.id }, data: { aiEnabled: true } });
      } else if (action === "disable") {
        if (!before) after = await tx.clientAiConfig.create({ data: { tenantId, aiEnabled: false, provider: "ollama_cloud" } });
        else after = await tx.clientAiConfig.update({ where: { id: before.id }, data: { aiEnabled: false } });
      } else if (action === "configure") {
        const cfg = incomingConfig ?? {};
        const provider = typeof cfg.provider === "string" ? cfg.provider.trim() : undefined;
        const model = typeof cfg.model === "string" ? cfg.model.trim() : undefined;
        const baseUrl = typeof cfg.baseUrl === "string" ? cfg.baseUrl.trim() : undefined;
        const data: Record<string, unknown> = {};
        if (provider) data.provider = provider;
        if (model) data.model = model;
        if (baseUrl !== undefined) {
          if (baseUrl === "" || baseUrl === null) data.baseUrl = null;
          else {
            try {
              new URL(baseUrl);
              data.baseUrl = baseUrl;
            } catch {
              operationError = `invalid baseUrl: ${baseUrl}`;
              data.baseUrl = baseUrl;
            }
          }
        }
        if (!before) {
          after = await tx.clientAiConfig.create({
            data: { tenantId, aiEnabled: false, provider: provider ?? "ollama_cloud", model: model ?? null, baseUrl: (data.baseUrl as string) ?? null },
          });
        } else {
          const updateData: Record<string, unknown> = {};
          if (provider !== undefined) updateData.provider = provider;
          if (model !== undefined) updateData.model = model;
          if (baseUrl !== undefined) updateData.baseUrl = data.baseUrl;
          if (Object.keys(updateData).length === 0) after = before;
          else after = await tx.clientAiConfig.update({ where: { id: before.id }, data: updateData });
        }
      }

      const beforeSanitized = before ? sanitizeConfig(before) : null;
      const afterSanitized = after ? sanitizeConfig(after) : null;

      await auditControl({
        tenantId,
        userId,
        action: `agent.${action}`,
        model: "ClientAiConfig",
        recordId: (after?.id as string) ?? (before?.id as string) ?? tenantId,
        before: beforeSanitized,
        after: afterSanitized,
        metadata: { provider: (after as any)?.provider ?? null, model: (after as any)?.model ?? null, operationError: operationError ?? undefined },
      });

      if (operationError) return { after, error: operationError, status: "error" };
      return { after, status: "ok" };
    });

    if (outcome.status === "error") {
      return NextResponse.json({ status: "error", reason: outcome.error, config: sanitizeConfig(outcome.after), gateway: gatewayView(outcome.after) }, { status: 200 });
    }
    return NextResponse.json({ status: "ok", action, config: sanitizeConfig(outcome.after), gateway: gatewayView(outcome.after) }, { status: 200 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    try {
      await auditControl({ tenantId, userId, action: `agent.${action}`, model: "ClientAiConfig", metadata: { error: msg, failed: true } });
    } catch {}
    return NextResponse.json({ error: "internal", detail: msg, status: "error" }, { status: 500 });
  }
}
