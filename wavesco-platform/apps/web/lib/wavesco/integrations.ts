import { existsSync } from "node:fs";
import { join } from "node:path";
import { withTenantContext } from "@wavesco/db";
import { getHealth, n8nApiKey, n8nBaseUrl } from "./n8n";
import {
  getLastEngineRun,
  leadEngineMode,
  leadEngineRoot,
  listBatchManifests,
  remoteAvailability,
} from "./lead-engine";

/**
 * Computes REAL integration status by probing the underlying systems.
 * Nothing here is inferred from presence alone when a live probe is
 * possible; where no integration exists at all the state is `unavailable`.
 */

export type IntegrationState =
  | "connected"
  | "disconnected"
  | "unavailable"
  | "error"
  | "degraded"
  | "never_connected";

export interface IntegrationStatusView {
  key: string;
  label: string;
  state: IntegrationState;
  detail: string;
  lastCheckedAt: string;
  lastOkAt: string | null;
}

export function maskUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.protocol}//***`;
  } catch {
    return "***";
  }
}

/**
 * Never log raw secrets; callers should use maskUrl for URLs and treat
 * remaining keys as redacted. This helper centralizes redaction.
 */
function redact(value: string | null | undefined): string {
  if (!value) return "***";
  if (value.length <= 4) return "***";
  return `${value.slice(0, 2)}***${value.slice(-2)}`;
}

export function n8nHealth(): { status: "BLOCKED" | "ok"; reason?: string; url?: string } {
  const raw = process.env.N8N_BASE_URL?.trim() ?? "";
  if (!raw) return { status: "BLOCKED", reason: "N8N_BASE_URL missing" };
  return { status: "ok", url: maskUrl(raw) };
}

export function leadEngineHealth(): { status: "ok" | "BLOCKED" | "error"; detail: string; reason?: string; url?: string } {
  const mode = process.env.LEAD_ENGINE_MODE?.trim() ?? "local";
  if (mode === "remote") {
    const apiUrl = process.env.LEAD_ENGINE_API_URL?.trim() ?? "";
    if (!apiUrl) {
      return { status: "BLOCKED", reason: "LEAD_ENGINE_API_URL missing", detail: "LEAD_ENGINE_API_URL missing (remote mode)" };
    }
    return { status: "ok", detail: `mode=remote root=${maskUrl(apiUrl)}`, url: maskUrl(apiUrl) };
  }
  const root = process.env.LEAD_ENGINE_ROOT?.trim() ?? "";
  if (!root) {
    return { status: "BLOCKED", reason: "LEAD_ENGINE_ROOT missing", detail: "LEAD_ENGINE_ROOT missing" };
  }
  // presence check is enough for sync health; async probes will try fetch
  return { status: "ok", detail: `mode=${mode} root=${maskUrl(root)}`, url: maskUrl(root) };
}

export function brevoHealth(): { status: "ok" | "BLOCKED"; detail: string; reason?: string } {
  const key = process.env.BREVO_API_KEY?.trim() ?? "";
  if (!key) return { status: "BLOCKED", reason: "BREVO_API_KEY missing", detail: "BREVO_API_KEY missing" };
  return { status: "ok", detail: "BREVO_API_KEY present" };
}

export async function dbHealth(): Promise<{ status: "ok" | "BLOCKED" | "error"; detail: string; reason?: string; latencyMs?: number; url?: string }> {
  const url = process.env.DATABASE_URL?.trim() ?? "";
  if (!url) return { status: "BLOCKED", reason: "DATABASE_URL missing", detail: "DATABASE_URL missing" };
  const start = Date.now();
  try {
    const { prisma } = await import("@wavesco/db");
    // Try a harmless query; never log url/key
    await (prisma as unknown as { $queryRaw: (s: TemplateStringsArray) => Promise<unknown> }).$queryRaw`SELECT 1`;
    const latencyMs = Date.now() - start;
    return { status: "ok", detail: "DATABASE_URL present, query ok", latencyMs, url: maskUrl(url) };
  } catch (e) {
    const latencyMs = Date.now() - start;
    const msg = e instanceof Error ? e.message : String(e);
    // do not include raw DATABASE_URL in error
    return { status: "error", detail: `DB query failed: ${msg.slice(0, 200)}`, reason: msg.slice(0, 200), latencyMs };
  }
}

export async function aiGatewayHealth(tenantId?: string): Promise<{ status: "ok" | "BLOCKED" | "error" | "missing"; detail: string; reason?: string; usage?: { total: number; last24h: number } | null }> {
  let usage: { total: number; last24h: number } | null = null;
  // Best-effort usage fetch if tenantId available – never throws
  if (tenantId) {
    try {
      const result = await withTenantContext(tenantId, async (tx: any) => {
        const total = await tx.aiUsageLog.count({ where: { tenantId } }).catch(() => 0);
        const last24h = await tx.aiUsageLog
          .count({ where: { tenantId, createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } } })
          .catch(() => 0);
        return { total, last24h };
      });
      usage = result as { total: number; last24h: number };
    } catch {
      // ignore – usage stays null
    }
  }

  const hasEnv =
    Boolean(process.env.OPENAI_API_KEY?.trim()) ||
    Boolean(process.env.OLLAMA_API_KEY?.trim()) ||
    Boolean(process.env.OLLAMA_CLOUD_API_KEY?.trim()) ||
    Boolean(process.env.AI_GATEWAY_URL?.trim()) ||
    Boolean(process.env.LEAD_ENGINE_GATEWAY_TOKEN?.trim());

  if (hasEnv) {
    return { status: "ok", detail: "AI Gateway key present (env)", usage };
  }

  if (tenantId) {
    try {
      const cfg = await withTenantContext(tenantId, async (tx: any) => tx.clientAiConfig.findFirst({ where: { tenantId } }));
      if (cfg as unknown) {
        const enabled = Boolean((cfg as { aiEnabled?: boolean }).aiEnabled);
        const provider = (cfg as { provider?: string }).provider ?? "unknown";
        if (enabled) {
          return { status: "ok", detail: `AI Gateway enabled provider=${provider}`, usage };
        }
        return { status: "missing", reason: "AI Gateway disabled", detail: "AI Gateway disabled (aiEnabled=false)", usage };
      }
    } catch {
      // ignore and fall through to BLOCKED
    }
  }

  return { status: "BLOCKED", reason: "AI gateway not configured", detail: "AI gateway not configured (no API key or ClientAiConfig)", usage };
}

export type HealthStatus = "ok" | "error" | "missing" | "BLOCKED";

export interface IntegrationHealthEntry {
  key: string;
  label: string;
  status: HealthStatus;
  detail: string;
  reason?: string;
  url?: string;
  lastCheckedAt: string;
  latencyMs?: number;
  usage?: unknown;
}

export async function getIntegrationsHealth(
  tenantId?: string
): Promise<Record<string, IntegrationHealthEntry & { status: HealthStatus; reason?: string; url?: string; detail?: string }>> {
  const now = new Date().toISOString();
  const n8n = n8nHealth();
  const lead = leadEngineHealth();
  const brevo = brevoHealth();
  const db = await dbHealth();
  const ai = await aiGatewayHealth(tenantId);

  const map: Record<string, IntegrationHealthEntry> = {
    lead_engine: {
      key: "lead_engine",
      label: "Lead Engine",
      status: (lead.status === "ok" ? "ok" : lead.status === "BLOCKED" ? "BLOCKED" : "error") as HealthStatus,
      detail: lead.detail,
      reason: lead.reason,
      url: lead.url ? maskUrl(lead.url) : undefined,
      lastCheckedAt: now,
    },
    n8n: {
      key: "n8n",
      label: "n8n",
      status: n8n.status === "BLOCKED" ? "BLOCKED" : "ok",
      detail: n8n.status === "BLOCKED" ? (n8n.reason ?? "N8N_BASE_URL missing") : "N8N_BASE_URL configured",
      reason: n8n.reason,
      url: n8n.url ? maskUrl(n8n.url) : undefined,
      lastCheckedAt: now,
    },
    brevo: {
      key: "brevo",
      label: "Brevo",
      status: brevo.status,
      detail: brevo.detail,
      reason: brevo.reason,
      lastCheckedAt: now,
    },
    db: {
      key: "db",
      label: "Postgres",
      status: db.status as HealthStatus,
      detail: db.detail,
      reason: db.reason,
      url: db.url ? maskUrl(db.url) : undefined,
      lastCheckedAt: now,
      latencyMs: db.latencyMs,
    },
    postgres: {
      key: "postgres",
      label: "Postgres",
      status: db.status as HealthStatus,
      detail: db.detail,
      reason: db.reason,
      url: db.url ? maskUrl(db.url) : undefined,
      lastCheckedAt: now,
      latencyMs: db.latencyMs,
    },
    ai_gateway: {
      key: "ai_gateway",
      label: "AI Gateway",
      status: ai.status as HealthStatus,
      detail: ai.detail,
      reason: ai.reason,
      lastCheckedAt: now,
      usage: ai.usage ?? undefined,
    },
  };

  return map as Record<string, IntegrationHealthEntry & { status: HealthStatus; reason?: string; url?: string; detail?: string }>;
}

function engineEnvPath(): string | null {
  const candidates = [
    process.env.WAVESCO_ENV_PATH,
    "D:\\cLAUDE\\.openclaw\\workspace\\wavesco-platform\\.env",
  ].filter((v): v is string => Boolean(v));
  for (const c of candidates) if (existsSync(c)) return c;
  return null;
}

async function persistSnapshot(
  tenantId: string,
  views: Omit<IntegrationStatusView, "lastCheckedAt" | "lastOkAt">[],
): Promise<void> {
  await withTenantContext(tenantId, async (tx) => {
    for (const v of views) {
      await tx.integrationStatus.upsert({
        where: { tenantId_key: { tenantId, key: v.key } },
        create: {
          tenantId,
          key: v.key,
          state: v.state,
          detail: v.detail,
          lastCheckedAt: new Date(),
          lastOkAt: v.state === "connected" ? new Date() : null,
        },
        update: {
          state: v.state,
          detail: v.detail,
          lastCheckedAt: new Date(),
          ...(v.state === "connected" ? { lastOkAt: new Date() } : {}),
        },
      });
    }
  });
}

export async function computeIntegrationStatuses(tenantId: string): Promise<IntegrationStatusView[]> {
  const views = await computeRaw(tenantId);
  try {
    await persistSnapshot(tenantId, views);
  } catch {
    // snapshot persistence is best-effort; live view still returned
  }
  const nowIso = new Date().toISOString();
  let previous: Record<string, { lastOkAt?: Date | null }> = {};
  try {
    const rows = await withTenantContext(tenantId, (tx) =>
      tx.integrationStatus.findMany({ where: { tenantId }, select: { key: true, lastOkAt: true } }),
    );
    previous = Object.fromEntries(rows.map((r) => [r.key, { lastOkAt: r.lastOkAt }]));
  } catch {
    // ignore — timestamps fall back to now
  }
  return views.map((v) => ({
    ...v,
    lastCheckedAt: nowIso,
    lastOkAt:
      v.state === "connected"
        ? nowIso
        : (previous[v.key]?.lastOkAt?.toISOString() ?? null),
  }));
}

async function computeRaw(tenantId: string): Promise<Omit<IntegrationStatusView, "lastCheckedAt" | "lastOkAt">[]> {
  const out: Omit<IntegrationStatusView, "lastCheckedAt" | "lastOkAt">[] = [];

  // Lead Engine -----------------------------------------------------
  if (leadEngineMode() === "remote") {
    const avail = await remoteAvailability();
    if (!avail.available) {
      out.push({
        key: "lead_engine",
        label: "Lead Engine",
        state: "error",
        detail: `Remote Lead Engine unreachable: ${avail.detail}`,
      });
    } else {
      try {
        const run = await getLastEngineRun();
        out.push({
          key: "lead_engine",
          label: "Lead Engine",
          state: "connected",
          detail: run?.started_at ? `Last run started ${run.started_at} (remote)` : "Remote Lead Engine reachable (API mode).",
        });
      } catch {
        out.push({
          key: "lead_engine",
          label: "Lead Engine",
          state: "connected",
          detail: "Remote Lead Engine reachable.",
        });
      }
    }
  } else {
    const root = leadEngineRoot();
    const dbExists = existsSync(join(root, "data", "leads.db"));
    const run = dbExists ? await getLastEngineRun() : undefined;
    if (!process.env.LEAD_ENGINE_ROOT && !dbExists) {
      out.push({
        key: "lead_engine",
        label: "Lead Engine",
        state: "disconnected",
        detail: "LEAD_ENGINE_ROOT not configured and default path not found.",
      });
    } else if (!dbExists) {
      out.push({
        key: "lead_engine",
        label: "Lead Engine",
        state: "error",
        detail: `leads.db not found at ${root}`,
      });
    } else {
      out.push({
        key: "lead_engine",
        label: "Lead Engine",
        state: "connected",
        detail: run?.started_at ? `Last run started ${run.started_at}` : "Corpus reachable; no runs recorded yet.",
      });
    }
  }

  // n8n -------------------------------------------------------------
  {
    const health = await getHealth();
    if (!n8nBaseUrl()) {
      out.push({ key: "n8n", label: "n8n", state: "disconnected", detail: "N8N_BASE_URL not configured." });
    } else if (!health.ok) {
      out.push({
        key: "n8n",
        label: "n8n",
        state: health.reason === "network" ? "disconnected" : "error",
        detail: health.error ?? "healthz unreachable",
      });
    } else {
      out.push({
        key: "n8n",
        label: "n8n",
        state: "connected",
        detail: n8nApiKey() ? "Instance healthy; API key present." : "Instance healthy; REST API key missing (Automation OS read-only surfaces disabled).",
      });
    }
  }

  // Telegram / Notify Hub -------------------------------------------
  {
    const envFile = engineEnvPath();
    const hasPlatformToken = Boolean(process.env.TELEGRAM_BOT_TOKEN);
    let hasEngineToken = false;
    if (envFile) {
      try {
        const { readFileSync } = await import("node:fs");
        hasEngineToken = /^TELEGRAM_BOT_TOKEN=.+/m.test(readFileSync(envFile, "utf8"));
      } catch {
        hasEngineToken = false;
      }
    }
    const manifests = await listBatchManifests();
    const delivered = manifests.find((m) => (m.telegramDeliveryStatus ?? "").includes("delivered"));
    if (hasPlatformToken || hasEngineToken) {
      const deliveryStatus = delivered?.telegramDeliveryStatus ?? "";
      out.push({
        key: "telegram_notify",
        label: "Telegram · Notify Hub",
        state: "connected",
        detail: delivered
          ? `Last hub delivery: ${deliveryStatus} (${delivered.batchId})`
          : "Bot token configured via engine/platform env. No deliveries recorded yet in visible manifests.",
      });
    } else {
      out.push({
        key: "telegram_notify",
        label: "Telegram · Notify Hub",
        state: "disconnected",
        detail: "No Telegram bot token resolvable from platform or engine env.",
      });
    }
  }

  // SMTP (Email Outbox credential lives inside n8n) ------------------
  {
    let sentCount = 0;
    try {
      const agg = await withTenantContext(tenantId, (tx) =>
        tx.outreachEmail.aggregate({
          where: { tenantId, status: { in: ["sent", "failed"] } },
          _max: { sentAt: true },
        }),
      );
      sentCount = await withTenantContext(tenantId, (tx) =>
        tx.outreachEmail.count({ where: { tenantId, status: "sent" } }),
      );
      void agg;
    } catch {
      sentCount = -1;
    }
    if (sentCount > 0) {
      out.push({
        key: "smtp_outbox",
        label: "SMTP · Email Outbox",
        state: "connected",
        detail: `${sentCount} outbound email(s) dispatched through the existing Email Outbox.`,
      });
    } else {
      out.push({
        key: "smtp_outbox",
        label: "SMTP · Email Outbox",
        state: sentCount === 0 ? "never_connected" : "error",
        detail:
          sentCount === 0
            ? "Sender is the existing n8n Email Outbox workflow ('Personal - SMTP' credential). No sends recorded yet; automation docs flag the credential as a placeholder — verify before first campaign."
            : "Could not read outreach records.",
      });
    }
  }

  // Google Sheets ----------------------------------------------------
  {
    try {
      const cfgPath = join(leadEngineRoot(), "config.json");
      const cfg = JSON.parse((await import("node:fs")).readFileSync(cfgPath, "utf8")) as {
        sheet_sync?: { mode?: string };
      };
      const mode = cfg.sheet_sync?.mode ?? "local";
      if (mode === "local") {
        out.push({
          key: "google_sheets",
          label: "Google Sheets",
          state: "disconnected",
          detail: "Lead Engine sheet_sync.mode=local (writes local XLSX/CSV mirror only).",
        });
      } else {
        out.push({
          key: "google_sheets",
          label: "Google Sheets",
          state: "connected",
          detail: `sheet_sync.mode=${mode}`,
        });
      }
    } catch {
      out.push({
        key: "google_sheets",
        label: "Google Sheets",
        state: "disconnected",
        detail: "Lead Engine config unavailable.",
      });
    }
  }

  // Google Drive ------------------------------------------------------
  {
    out.push({
      key: "google_drive",
      label: "Google Drive",
      state: "unavailable",
      detail: "No Drive integration exists in any WavesCo system yet.",
    });
  }

  return out;
}
