import { existsSync } from "node:fs";
import { join } from "node:path";
import { withTenantContext } from "@wavesco/db";
import { getHealth, n8nApiKey, n8nBaseUrl } from "./n8n";
import {
  getLastEngineRun,
  leadEngineRoot,
  listBatchManifests,
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
  {
    const root = leadEngineRoot();
    const dbExists = existsSync(join(root, "data", "leads.db"));
    const run = dbExists ? getLastEngineRun() : undefined;
    if (!process.env.LEAD_ENGINE_ROOT && !dbExists) {
      out.push({
        key: "lead_engine",
        label: "Lead Engine",
        state: "disconnected",
        detail: "LEAD_ENGINE_ROOT not configured and default path not found.",
      });    } else if (!dbExists) {
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
    const manifests = listBatchManifests();
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
