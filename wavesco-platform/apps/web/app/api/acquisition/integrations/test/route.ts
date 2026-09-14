import { NextResponse } from "next/server";
import { acquisitionDenied, auditControl, requireControlAuth } from "@/lib/wavesco/control";
import { maskUrl } from "@/lib/wavesco/integrations";

export const dynamic = "force-dynamic";

const VALID_KEYS = ["lead_engine", "n8n", "brevo", "db", "postgres", "ai_gateway"] as const;
type ValidKey = (typeof VALID_KEYS)[number];

function normalizeKey(input: string): ValidKey | null {
  const k = input.trim().toLowerCase();
  if ((VALID_KEYS as readonly string[]).includes(k)) return k as ValidKey;
  if (k === "postgresql") return "postgres";
  return null;
}

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
    return NextResponse.json({ error: "invalid JSON", status: "error" }, { status: 400 });
  }

  const rawKey = typeof body.key === "string" ? body.key : "";
  const key = normalizeKey(rawKey);
  if (!key) {
    return NextResponse.json({ error: "invalid key", valid: VALID_KEYS, received: rawKey || null, status: "error" }, { status: 400 });
  }
  const responseKey = key;

  // audit every test attempt – never include secrets in audit metadata
  try {
    await auditControl({
      tenantId,
      userId,
      action: "integration.test",
      model: "IntegrationStatus",
      recordId: key,
      metadata: { key, at: new Date().toISOString() },
    });
  } catch {
    // audit failure should not block test
  }

  const lastCheckedAt = new Date().toISOString();

  // Helper to mask and never leak secrets
  const blockedResponse = (detail: string, reason?: string) => {
    return NextResponse.json(
      {
        key: responseKey,
        status: "BLOCKED" as const,
        detail,
        reason: reason ?? detail,
        latencyMs: 0,
        lastCheckedAt,
      },
      { status: 200 }
    );
  };

  // -------------------------------------------------------------
  // n8n
  // -------------------------------------------------------------
  if (key === "n8n") {
    const baseRaw = process.env.N8N_BASE_URL?.trim() ?? "";
    const apiKey = process.env.N8N_API_KEY?.trim() ?? "";
    if (!baseRaw) {
      return blockedResponse("N8N_BASE_URL missing", "N8N_BASE_URL missing");
    }
    if (!apiKey) {
      return blockedResponse("N8N_API_KEY missing", "N8N_API_KEY missing");
    }
    const base = baseRaw.replace(/\/+$/, "");
    const maskBase = maskUrl(baseRaw);
    const start = Date.now();
    try {
      const res = await fetch(`${base}/api/v1/workflows?limit=1`, {
        headers: { accept: "application/json", "X-N8N-API-KEY": apiKey },
        cache: "no-store",
        signal: AbortSignal.timeout(8000),
      });
      const latencyMs = Date.now() - start;
      if (res.ok) {
        return NextResponse.json(
          { key: responseKey, status: "ok" as const, detail: `n8n reachable at ${maskBase}`, latencyMs, lastCheckedAt, url: maskBase },
          { status: 200 }
        );
      }
      const txt = await res.text().catch(() => "");
      return NextResponse.json(
        {
          key: responseKey,
          status: "error" as const,
          detail: `n8n API ${res.status}: ${txt.slice(0, 200)}`,
          reason: `n8n API ${res.status}`,
          latencyMs,
          lastCheckedAt,
          url: maskBase,
        },
        { status: 200 }
      );
    } catch (e) {
      const latencyMs = Date.now() - start;
      const msg = e instanceof Error ? e.message : String(e);
      return NextResponse.json(
        { key: responseKey, status: "error" as const, detail: `n8n unreachable: ${msg.slice(0, 200)}`, reason: msg.slice(0, 200), latencyMs, lastCheckedAt, url: maskBase },
        { status: 200 }
      );
    }
  }

  // -------------------------------------------------------------
  // brevo
  // -------------------------------------------------------------
  if (key === "brevo") {
    const brevoKey = process.env.BREVO_API_KEY?.trim() ?? "";
    if (!brevoKey) {
      return blockedResponse("BREVO_API_KEY missing", "BREVO_API_KEY missing");
    }
    const start = Date.now();
    try {
      const res = await fetch("https://api.brevo.com/v3/account", {
        headers: { accept: "application/json", "api-key": brevoKey },
        cache: "no-store",
        signal: AbortSignal.timeout(8000),
      });
      const latencyMs = Date.now() - start;
      if (res.ok) {
        return NextResponse.json(
          { key: responseKey, status: "ok" as const, detail: "Brevo API reachable", latencyMs, lastCheckedAt },
          { status: 200 }
        );
      }
      const txt = await res.text().catch(() => "");
      return NextResponse.json(
        { key: responseKey, status: "error" as const, detail: `Brevo API ${res.status}: ${txt.slice(0, 200)}`, reason: `Brevo API ${res.status}`, latencyMs, lastCheckedAt },
        { status: 200 }
      );
    } catch (e) {
      const latencyMs = Date.now() - start;
      const msg = e instanceof Error ? e.message : String(e);
      return NextResponse.json(
        { key: responseKey, status: "error" as const, detail: `Brevo unreachable: ${msg.slice(0, 200)}`, reason: msg.slice(0, 200), latencyMs, lastCheckedAt },
        { status: 200 }
      );
    }
  }

  // -------------------------------------------------------------
  // db / postgres
  // -------------------------------------------------------------
  if (key === "db" || key === "postgres") {
    const dbUrl = process.env.DATABASE_URL?.trim() ?? "";
    if (!dbUrl) {
      return blockedResponse("DATABASE_URL missing", "DATABASE_URL missing");
    }
    const masked = maskUrl(dbUrl);
    const start = Date.now();
    try {
      const { prisma } = await import("@wavesco/db");
      await (prisma as unknown as { $queryRaw: (t: TemplateStringsArray) => Promise<unknown> }).$queryRaw`SELECT 1`;
      const latencyMs = Date.now() - start;
      return NextResponse.json(
        { key: responseKey, status: "ok" as const, detail: "Postgres query ok", latencyMs, lastCheckedAt, url: masked },
        { status: 200 }
      );
    } catch (e) {
      const latencyMs = Date.now() - start;
      const msg = e instanceof Error ? e.message : String(e);
      return NextResponse.json(
        { key: responseKey, status: "error" as const, detail: `DB query failed: ${msg.slice(0, 200)}`, reason: msg.slice(0, 200), latencyMs, lastCheckedAt, url: masked },
        { status: 200 }
      );
    }
  }

  // -------------------------------------------------------------
  // lead_engine
  // -------------------------------------------------------------
  if (key === "lead_engine") {
    const mode = (process.env.LEAD_ENGINE_MODE?.trim() ?? "local").toLowerCase();
    if (mode === "remote") {
      const apiUrlRaw = process.env.LEAD_ENGINE_API_URL?.trim() ?? "";
      if (!apiUrlRaw) {
        return blockedResponse("LEAD_ENGINE_API_URL missing", "LEAD_ENGINE_API_URL missing");
      }
      const masked = maskUrl(apiUrlRaw);
      const apiUrl = apiUrlRaw.replace(/\/+$/, "");
      const token = process.env.LEAD_ENGINE_API_TOKEN?.trim() ?? "";
      const start = Date.now();
      try {
        const res = await fetch(`${apiUrl}/health`, {
          headers: {
            ...(token ? { authorization: `Bearer ${token}` } : {}),
          } as Record<string, string>,
          cache: "no-store",
          signal: AbortSignal.timeout(8000),
        });
        const latencyMs = Date.now() - start;
        if (res.ok) {
          return NextResponse.json(
            { key: responseKey, status: "ok" as const, detail: `Lead Engine reachable at ${masked}`, latencyMs, lastCheckedAt, url: masked },
            { status: 200 }
          );
        }
        await res.text().catch(() => "");
        return NextResponse.json(
          { key: responseKey, status: "error" as const, detail: `Lead Engine ${res.status}: temporarily unavailable`, reason: `Lead Engine ${res.status}`, latencyMs, lastCheckedAt, url: masked },
          { status: 200 }
        );
      } catch (e) {
        const latencyMs = Date.now() - start;
        console.error(`[integrations:test:lead_engine] ${e instanceof Error ? e.message : String(e)}`);
        return NextResponse.json(
          { key: responseKey, status: "error" as const, detail: "Lead Engine unreachable: temporarily unavailable", reason: "unreachable", latencyMs, lastCheckedAt, url: masked },
          { status: 200 }
        );
      }
    } else {
      const rootRaw = process.env.LEAD_ENGINE_ROOT?.trim() ?? "";
      if (!rootRaw) {
        return blockedResponse("LEAD_ENGINE_ROOT missing", "LEAD_ENGINE_ROOT missing");
      }
      const masked = maskUrl(rootRaw);
      // For local mode, presence is enough; try to verify file existence without leaking path details
      try {
        const { existsSync } = await import("node:fs");
        const { join } = await import("node:path");
        const dbPath = join(rootRaw, "data", "leads.db");
        const exists = existsSync(dbPath);
        if (!exists) {
          return NextResponse.json(
            { key: responseKey, status: "error" as const, detail: `Lead Engine root present but leads.db missing`, reason: "leads.db missing", latencyMs: 0, lastCheckedAt, url: masked },
            { status: 200 }
          );
        }
        return NextResponse.json(
          { key: responseKey, status: "ok" as const, detail: `Lead Engine root present at ${masked}`, latencyMs: 0, lastCheckedAt, url: masked },
          { status: 200 }
        );
      } catch {
        return NextResponse.json(
          { key: responseKey, status: "ok" as const, detail: `Lead Engine root present at ${masked}`, latencyMs: 0, lastCheckedAt, url: masked },
          { status: 200 }
        );
      }
    }
  }

  // -------------------------------------------------------------
  // ai_gateway
  // -------------------------------------------------------------
  if (key === "ai_gateway") {
    const hasEnv =
      Boolean(process.env.OPENAI_API_KEY?.trim()) ||
      Boolean(process.env.OLLAMA_API_KEY?.trim()) ||
      Boolean(process.env.OLLAMA_CLOUD_API_KEY?.trim()) ||
      Boolean(process.env.AI_GATEWAY_URL?.trim()) ||
      Boolean(process.env.LEAD_ENGINE_GATEWAY_TOKEN?.trim());

    // Try to enrich with usage if tenantId available
    let usage: { total: number; last24h: number } | null = null;
    try {
      const { withTenantContext } = await import("@wavesco/db");
      const result = await withTenantContext(tenantId, async (tx: any) => {
        const total = await tx.aiUsageLog.count({ where: { tenantId } }).catch(() => 0);
        const last24h = await tx.aiUsageLog
          .count({ where: { tenantId, createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } } })
          .catch(() => 0);
        return { total, last24h };
      });
      usage = result as { total: number; last24h: number };
    } catch {
      // ignore
    }

    if (!hasEnv) {
      // Check DB config as fallback
      try {
        const { withTenantContext } = await import("@wavesco/db");
        const cfg = await withTenantContext(tenantId, async (tx: any) => tx.clientAiConfig.findFirst({ where: { tenantId } }));
        if (cfg && (cfg as { aiEnabled?: boolean }).aiEnabled) {
          return NextResponse.json(
            { key: responseKey, status: "ok" as const, detail: `AI Gateway enabled provider=${(cfg as { provider?: string }).provider ?? "unknown"}`, latencyMs: 0, lastCheckedAt, usage },
            { status: 200 }
          );
        }
        if (cfg && !(cfg as { aiEnabled?: boolean }).aiEnabled) {
          return NextResponse.json(
            { key: responseKey, status: "BLOCKED" as const, detail: "AI Gateway disabled (aiEnabled=false)", reason: "AI gateway disabled", latencyMs: 0, lastCheckedAt, usage },
            { status: 200 }
          );
        }
      } catch {
        // fall through
      }
      return blockedResponse("AI gateway not configured (no API key or ClientAiConfig)", "AI gateway not configured");
    }

    // hasEnv true – consider it ok, plus optional DB health check for blocked disabled state
    try {
      const { withTenantContext } = await import("@wavesco/db");
      const cfg = await withTenantContext(tenantId, async (tx: any) => tx.clientAiConfig.findFirst({ where: { tenantId } }));
      if (cfg && !(cfg as { aiEnabled?: boolean }).aiEnabled) {
        // env present but disabled – still report BLOCKED with usage
        const base = NextResponse.json(
          { key: responseKey, status: "BLOCKED" as const, detail: "AI Gateway disabled (aiEnabled=false)", reason: "AI gateway disabled", latencyMs: 0, lastCheckedAt, usage },
          { status: 200 }
        );
        // attach usage to BLOCKED response
        const json: any = await base.json();
        // we already set usage
        return NextResponse.json(json, { status: 200 });
      }
    } catch {
      // ignore
    }

    return NextResponse.json(
      { key: responseKey, status: "ok" as const, detail: "AI Gateway key present", latencyMs: 0, lastCheckedAt, usage },
      { status: 200 }
    );
  }

  // Fallback – should not reach here
  return NextResponse.json({ error: "unhandled key", key: responseKey, status: "error" as const, detail: "unhandled", latencyMs: 0, lastCheckedAt }, { status: 400 });
}
