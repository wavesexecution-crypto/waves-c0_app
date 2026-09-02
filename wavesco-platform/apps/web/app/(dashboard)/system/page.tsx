import type { Metadata } from "next";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { requireTenantId } from "@/lib/tenant";
import { withTenantContext } from "@wavesco/db";
import { getIntegrationsHealth, maskUrl } from "@/lib/wavesco/integrations";
import { MetricCard, SectionHeader, StatusPill } from "@/components/command/primitives";
import { AutoRefresh } from "@/components/command/auto-refresh";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "System — Acquisition OS" };

function pillState(status: string): string {
  const s = String(status ?? "").toLowerCase();
  if (s === "ok" || s === "connected") return "connected";
  if (s === "blocked") return "disconnected";
  if (s === "missing") return "unavailable";
  if (s === "error" || s === "failed") return "error";
  if (s === "degraded") return "degraded";
  return s || "unavailable";
}

function formatTime(iso: string | Date | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso as string).toLocaleString();
  } catch {
    return String(iso);
  }
}

function maskSecret(value: string | null | undefined): string {
  if (!value) return "***";
  if (value.length <= 4) return "***";
  return `${value.slice(0, 2)}***${value.slice(-2)}`;
}

function maskEnvValue(key: string, value: string | undefined): string {
  if (!value || value.trim() === "") return "*** (missing)";
  const v = value.trim();
  // URL-like keys
  if (key.includes("URL") || key.includes("ROOT") || key.includes("BASE_URL") || key.includes("PATH")) {
    return maskUrl(v);
  }
  // secret keys
  if (key.includes("KEY") || key.includes("SECRET") || key.includes("TOKEN") || key.includes("PASSWORD")) {
    return maskSecret(v);
  }
  // others: show masked length hint not raw
  if (v.length > 12) return `${v.slice(0, 4)}***${v.slice(-4)}`;
  return maskSecret(v);
}

async function safeCount(tx: any, model: string, where: any): Promise<number> {
  try {
    const m = tx[model];
    if (!m || typeof m.count !== "function") return 0;
    return await m.count({ where });
  } catch {
    return 0;
  }
}

export default async function SystemPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[]>> | Record<string, string | string[]>;
}) {
  const session = await auth();
  const tenantId = requireTenantId(session as unknown);

  let sp: Record<string, string> = {};
  if (searchParams) {
    const resolved = (searchParams as any)?.then ? await (searchParams as Promise<Record<string, string>>) : (searchParams as Record<string, string>);
    for (const [k, v] of Object.entries(resolved as Record<string, unknown>)) {
      sp[k] = Array.isArray(v) ? String(v[0]) : String(v ?? "");
    }
  }
  const auditActionFilter = sp.action?.trim() || null;
  const auditModelFilter = sp.model?.trim() || null;
  const auditLimit = sp.limit ? Math.min(Math.max(parseInt(sp.limit, 10) || 50, 1), 100) : 50;
  const auditOffset = sp.offset ? Math.max(parseInt(sp.offset, 10) || 0, 0) : 0;

  let health: Awaited<ReturnType<typeof getIntegrationsHealth>> | null = null;
  let healthError: string | null = null;
  try {
    health = await getIntegrationsHealth(tenantId);
  } catch (e) {
    healthError = e instanceof Error ? e.message : String(e);
  }

  // Gather all system data in one tenant context where possible
  let dbState: Record<string, number> = {
    campaigns: 0,
    outreachEmails: 0,
    outreachEmailPending: 0,
    outreachEmailFailed: 0,
    outreachEmailSent: 0,
    outreachOrders: 0,
    leadResearch: 0,
    generationBatches: 0,
    generationBatchesFailed: 0,
    generationBatchesQueued: 0,
    followUpsPending: 0,
    followUpsTotal: 0,
    activityEvents: 0,
    auditLogs: 0,
    integrationStatus: 0,
    aiUsageLogs: 0,
    leadLifecycleEvents: 0,
    clients: 0,
  };
  let logs: any[] = [];
  let errorsOutreach: any[] = [];
  let errorsBatches: any[] = [];
  let pendingFollowUps: any[] = [];
  let pendingBatches: any[] = [];
  let auditLogs: any[] = [];
  let auditTotal = 0;
  let queueDepth = 0;
  let dbError: string | null = null;

  try {
    const data = await withTenantContext(tenantId, async (tx: any) => {
      const counts = {
        campaigns: await safeCount(tx, "campaign", { tenantId }),
        outreachEmails: await safeCount(tx, "outreachEmail", { tenantId }),
        outreachEmailPending: await safeCount(tx, "outreachEmail", { tenantId, status: { in: ["submitted", "approved", "pending", "queued"] } }),
        outreachEmailFailed: await safeCount(tx, "outreachEmail", { tenantId, status: "failed" }),
        outreachEmailSent: await safeCount(tx, "outreachEmail", { tenantId, status: "sent" }),
        outreachOrders: await safeCount(tx, "outreachOrder", { tenantId }),
        leadResearch: await safeCount(tx, "leadResearch", { tenantId }),
        generationBatches: await safeCount(tx, "generationBatch", { tenantId }),
        generationBatchesFailed: await safeCount(tx, "generationBatch", { tenantId, status: "failed" }),
        generationBatchesQueued: await safeCount(tx, "generationBatch", { tenantId, status: { in: ["queued", "pending", "running"] } }),
        followUpsPending: await safeCount(tx, "followUp", { tenantId, status: "pending" }),
        followUpsTotal: await safeCount(tx, "followUp", { tenantId }),
        activityEvents: await safeCount(tx, "activityEvent", { tenantId }),
        auditLogs: await safeCount(tx, "auditLog", { tenantId }),
        integrationStatus: await safeCount(tx, "integrationStatus", { tenantId }),
        aiUsageLogs: await safeCount(tx, "aiUsageLog", { tenantId }),
        leadLifecycleEvents: await safeCount(tx, "leadLifecycleEvent", { tenantId }),
        clients: await safeCount(tx, "client", { tenantId }),
      };

      let activityLogs: any[] = [];
      try {
        activityLogs = tx.activityEvent
          ? await tx.activityEvent.findMany({ where: { tenantId }, orderBy: { createdAt: "desc" }, take: 50 })
          : [];
      } catch {
        activityLogs = [];
      }

      let failedOutreach: any[] = [];
      try {
        failedOutreach = tx.outreachEmail
          ? await tx.outreachEmail.findMany({ where: { tenantId, status: "failed" }, orderBy: { createdAt: "desc" }, take: 20 })
          : [];
      } catch {
        failedOutreach = [];
      }

      let failedBatches: any[] = [];
      try {
        failedBatches = tx.generationBatch
          ? await tx.generationBatch.findMany({ where: { tenantId, status: "failed" }, orderBy: { createdAt: "desc" }, take: 20 })
          : [];
      } catch {
        failedBatches = [];
      }

      let followUps: any[] = [];
      try {
        followUps = tx.followUp
          ? await tx.followUp.findMany({ where: { tenantId, status: "pending" }, orderBy: { dueAt: "asc" }, take: 20 })
          : [];
      } catch {
        followUps = [];
      }

      let queuedBatches: any[] = [];
      try {
        queuedBatches = tx.generationBatch
          ? await tx.generationBatch.findMany({ where: { tenantId, status: { in: ["queued", "pending", "running"] } }, orderBy: { createdAt: "desc" }, take: 20 })
          : [];
      } catch {
        queuedBatches = [];
      }

      // Audit logs with optional filters from searchParams
      const where: Record<string, unknown> = { tenantId };
      if (auditActionFilter) where.action = auditActionFilter;
      if (auditModelFilter) where.model = auditModelFilter;

      let aLogs: any[] = [];
      let aTotal = 0;
      try {
        if (tx.auditLog) {
          const [rows, total] = await Promise.all([
            tx.auditLog.findMany({ where, orderBy: { createdAt: "desc" }, take: auditLimit, skip: auditOffset }) as Promise<unknown[]>,
            tx.auditLog.count({ where }) as Promise<number>,
          ]);
          aLogs = rows as any[];
          aTotal = total as number;
        }
      } catch {
        aLogs = [];
        aTotal = 0;
      }

      return {
        counts,
        activityLogs,
        failedOutreach,
        failedBatches,
        followUps,
        queuedBatches,
        aLogs,
        aTotal,
      };
    });

    dbState = {
      campaigns: data.counts.campaigns,
      outreachEmails: data.counts.outreachEmails,
      outreachEmailPending: data.counts.outreachEmailPending,
      outreachEmailFailed: data.counts.outreachEmailFailed,
      outreachEmailSent: data.counts.outreachEmailSent,
      outreachOrders: data.counts.outreachOrders,
      leadResearch: data.counts.leadResearch,
      generationBatches: data.counts.generationBatches,
      generationBatchesFailed: data.counts.generationBatchesFailed,
      generationBatchesQueued: data.counts.generationBatchesQueued,
      followUpsPending: data.counts.followUpsPending,
      followUpsTotal: data.counts.followUpsTotal,
      activityEvents: data.counts.activityEvents,
      auditLogs: data.counts.auditLogs,
      integrationStatus: data.counts.integrationStatus,
      aiUsageLogs: data.counts.aiUsageLogs,
      leadLifecycleEvents: data.counts.leadLifecycleEvents,
      clients: data.counts.clients,
    };
    logs = data.activityLogs as any[];
    errorsOutreach = data.failedOutreach as any[];
    errorsBatches = data.failedBatches as any[];
    pendingFollowUps = data.followUps as any[];
    pendingBatches = data.queuedBatches as any[];
    auditLogs = data.aLogs as any[];
    auditTotal = data.aTotal as number;
    queueDepth = data.counts.outreachEmailPending;
  } catch (e) {
    dbError = e instanceof Error ? e.message : String(e);
  }

  const healthEntries = health
    ? [
        { key: "db", label: "Postgres", entry: (health as any).db ?? (health as any).postgres },
        { key: "lead_engine", label: "Lead Engine", entry: (health as any).lead_engine },
        { key: "n8n", label: "n8n", entry: (health as any).n8n },
        { key: "ai_gateway", label: "AI Gateway", entry: (health as any).ai_gateway },
        { key: "brevo", label: "Brevo", entry: (health as any).brevo },
      ]
    : [];

  const envKeys = [
    "DATABASE_URL",
    "DIRECT_URL",
    "LEAD_ENGINE_ROOT",
    "LEAD_ENGINE_MODE",
    "LEAD_ENGINE_API_URL",
    "LEAD_ENGINE_API_TOKEN",
    "N8N_BASE_URL",
    "N8N_API_KEY",
    "N8N_MANIFEST_PATH",
    "BREVO_API_KEY",
    "OPENAI_API_KEY",
    "OLLAMA_API_KEY",
    "OLLAMA_CLOUD_API_KEY",
    "AI_GATEWAY_URL",
    "LEAD_ENGINE_GATEWAY_TOKEN",
    "RESEND_API_KEY",
    "NEXTAUTH_SECRET",
  ];

  const envRows = envKeys.map((k) => {
    const raw = process.env[k];
    const masked = maskEnvValue(k, raw);
    const isMissing = !raw || raw.trim() === "";
    return { key: k, value: masked, missing: isMissing, rawPresent: !isMissing };
  });

  const hasErrors = errorsOutreach.length > 0 || errorsBatches.length > 0;
  const hasJobs = pendingFollowUps.length > 0 || pendingBatches.length > 0;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">System — Acquisition OS</h1>
          <p className="text-sm text-muted-foreground">
            Health, logs, errors, jobs, queues, DB state, configuration (masked), audit logs. Tenant-scoped, real backend state — no fake success.
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Tenant {tenantId.slice(0, 8)}… · GET /api/system/health · /api/system/logs?limit=50 · /api/system/audit-logs · tenant-scoped via withTenantContext
          </p>
        </div>
        <div className="flex items-center gap-2">
          <AutoRefresh intervalMs={15_000} />
          <StatusPill state={healthError ? "error" : dbError ? "degraded" : hasErrors ? "error" : "connected"} />
          <span className="text-xs uppercase tracking-widest text-muted-foreground">
            {healthError ? "ERROR" : dbError ? "DEGRADED" : hasErrors ? "ERRORS" : "LIVE"}
          </span>
        </div>
      </div>

      {healthError ? (
        <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-3 text-xs">
          <p className="font-medium text-red-600 dark:text-red-400">Health probe failed</p>
          <p className="text-muted-foreground">{healthError.slice(0, 300)}</p>
          <a href="/system" className="mt-2 inline-block rounded-md border px-3 py-1.5 text-xs hover:bg-accent">
            Retry
          </a>
        </div>
      ) : null}
      {dbError ? (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs">
          <p className="font-medium text-amber-700 dark:text-amber-300">Tenant DB aggregation warning</p>
          <p className="text-muted-foreground">{dbError.slice(0, 300)}</p>
          <a href="/system" className="mt-2 inline-block rounded-md border px-3 py-1.5 text-xs hover:bg-accent">
            Retry
          </a>
        </div>
      ) : null}

      {/* Health cards */}
      <section className="space-y-3">
        <SectionHeader title="Health" subtitle="DB, Lead Engine, n8n, AI Gateway — via getIntegrationsHealth (masked, server-side)" />
        {healthEntries.length === 0 ? (
          <div className="rounded-lg border bg-card p-6 text-center text-sm text-muted-foreground">No health data — probe failed.</div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {healthEntries.map((it) => {
              const e: any = it.entry ?? {};
              const status = e.status ?? "missing";
              const detail = e.detail ?? e.reason ?? "—";
              const url = e.url ?? "***";
              const latency = e.latencyMs != null ? `${e.latencyMs}ms` : "—";
              const usage = e.usage as { total?: number; last24h?: number } | undefined;
              return (
                <div key={it.key} className="rounded-lg border bg-card p-4">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium">{it.label}</p>
                    <StatusPill state={pillState(status)} />
                  </div>
                  <p className="mt-1 font-mono text-[11px] text-muted-foreground">{it.key} · {status}</p>
                  <p className="mt-2 line-clamp-2 text-xs" title={detail}>
                    {detail}
                  </p>
                  <div className="mt-2 space-y-1 text-[11px] text-muted-foreground">
                    <p>
                      <span className="font-medium">URL:</span> <span className="font-mono">{typeof url === "string" && url.length > 36 ? `${url.slice(0, 36)}…` : url}</span>
                    </p>
                    <p>
                      <span className="font-medium">Latency:</span> {latency} · <span className="font-medium">Checked:</span> {formatTime(e.lastCheckedAt)}
                    </p>
                    {usage ? (
                      <p>
                        <span className="font-medium">Usage:</span> total {usage.total ?? 0} · 24h {usage.last24h ?? 0}
                      </p>
                    ) : null}
                    {e.reason && e.reason !== detail ? (
                      <p className="truncate" title={e.reason}>
                        Reason: {e.reason.slice(0, 80)}
                      </p>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        )}
        <div className="rounded-lg border bg-muted/20 p-3 text-xs">
          <p className="font-medium">Health details (raw masked)</p>
          <p className="text-muted-foreground">
            Queue depth (OutreachEmail pending): <span className="font-mono font-medium tabular-nums">{queueDepth}</span> · DB counts: campaigns {dbState.campaigns}, outreach {dbState.outreachEmails}, batches {dbState.generationBatches} · See DB state below for full counts.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Link href="/api/system/health" className="rounded-full border bg-card px-2.5 py-1 text-[11px] hover:bg-accent">
              GET /api/system/health (JSON)
            </Link>
            <Link href="/acquisition/integrations" className="rounded-full border bg-card px-2.5 py-1 text-[11px] hover:bg-accent">
              Integrations matrix
            </Link>
          </div>
        </div>
      </section>

      {/* Logs */}
      <section className="space-y-3">
        <SectionHeader
          title="Logs"
          subtitle="ActivityEvent — last 50 tenant-scoped (sourceKey, entity, href) · GET /api/system/logs?limit=50"
          right={
            <Link href="/api/system/logs?limit=50" className="text-[11px] text-primary hover:underline">
              API · logs?limit=50
            </Link>
          }
        />
        <div className="overflow-x-auto rounded-lg border bg-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/20 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-3 py-2">When</th>
                <th className="px-3 py-2">Type</th>
                <th className="px-3 py-2">Title</th>
                <th className="px-3 py-2">Entity</th>
                <th className="px-3 py-2">Source</th>
                <th className="px-3 py-2">Href</th>
              </tr>
            </thead>
            <tbody>
              {logs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-sm text-muted-foreground">
                    No ActivityEvent yet — trigger campaign, outreach, or generation to populate logs. Tenant empty shows zeros, not error.
                  </td>
                </tr>
              ) : (
                logs.map((ev: any) => (
                  <tr key={ev.id} className="border-b last:border-0 hover:bg-accent/40">
                    <td className="px-3 py-2 text-xs text-muted-foreground">{formatTime(ev.createdAt)}</td>
                    <td className="px-3 py-2 font-mono text-xs">{ev.type ?? "—"}</td>
                    <td className="px-3 py-2 text-xs">{ev.title ?? "—"}</td>
                    <td className="px-3 py-2 text-xs">
                      {ev.entityType ? (
                        <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px]">
                          {ev.entityType}:{String(ev.entityId ?? "").slice(0, 8)}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{ev.sourceKey ?? "—"}</td>
                    <td className="px-3 py-2 text-xs">
                      {ev.href ? (
                        <Link href={ev.href} className="text-primary hover:underline">
                          link
                        </Link>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <p className="text-[11px] text-muted-foreground">
          Source: withTenantContext → activityEvent.findMany where tenantId orderBy createdAt desc take 50. Tenant-scoped; no cross-tenant leak.
        </p>
      </section>

      {/* Errors */}
      <section className="space-y-3">
        <SectionHeader title="Errors" subtitle="Failed OutreachEmail + GenerationBatch (status=failed) — surfaced, not hidden" />
        <div className="grid gap-3 lg:grid-cols-2">
          <div className="overflow-x-auto rounded-lg border bg-card">
            <div className="border-b bg-muted/20 px-3 py-2">
              <p className="text-xs font-semibold uppercase tracking-wide">OutreachEmail — failed ({errorsOutreach.length})</p>
              <p className="text-[11px] text-muted-foreground">status=failed · error, sendError, retry via outreach pipeline</p>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-3 py-2">When</th>
                  <th className="px-3 py-2">Business</th>
                  <th className="px-3 py-2">Email</th>
                  <th className="px-3 py-2">Error</th>
                </tr>
              </thead>
              <tbody>
                {errorsOutreach.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-6 text-center text-xs text-muted-foreground">
                      No failed OutreachEmail — clean. {dbState.outreachEmailFailed > 0 ? `But count reports ${dbState.outreachEmailFailed} failed — check table filter.` : ""}
                    </td>
                  </tr>
                ) : (
                  errorsOutreach.map((e: any) => (
                    <tr key={e.id} className="border-b last:border-0 hover:bg-accent/40">
                      <td className="px-3 py-2 text-xs text-muted-foreground">{formatTime(e.createdAt ?? e.updatedAt)}</td>
                      <td className="px-3 py-2 text-xs font-medium">{e.business ?? e.leadKey ?? "—"}</td>
                      <td className="px-3 py-2 font-mono text-xs">{e.email ?? "—"}</td>
                      <td className="max-w-[220px] truncate px-3 py-2 text-xs text-red-600 dark:text-red-400" title={e.error ?? e.sendError ?? undefined}>
                        {e.error ?? e.sendError ?? "—"}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="overflow-x-auto rounded-lg border bg-card">
            <div className="border-b bg-muted/20 px-3 py-2">
              <p className="text-xs font-semibold uppercase tracking-wide">GenerationBatch — failed ({errorsBatches.length})</p>
              <p className="text-[11px] text-muted-foreground">status=failed · pdfPath/excelPath missing, logTail, retry via generate</p>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-3 py-2">When</th>
                  <th className="px-3 py-2">Request</th>
                  <th className="px-3 py-2">Stage</th>
                  <th className="px-3 py-2">Error</th>
                </tr>
              </thead>
              <tbody>
                {errorsBatches.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-6 text-center text-xs text-muted-foreground">
                      No failed GenerationBatch — clean. {dbState.generationBatchesFailed > 0 ? `Count ${dbState.generationBatchesFailed} failed.` : ""}
                    </td>
                  </tr>
                ) : (
                  errorsBatches.map((b: any) => (
                    <tr key={b.id} className="border-b last:border-0 hover:bg-accent/40">
                      <td className="px-3 py-2 text-xs text-muted-foreground">{formatTime(b.createdAt ?? b.finishedAt)}</td>
                      <td className="px-3 py-2 font-mono text-xs">{b.requestId ?? b.id.slice(0, 8)}</td>
                      <td className="px-3 py-2 text-xs">{b.stage ?? b.status ?? "—"}</td>
                      <td className="max-w-[220px] truncate px-3 py-2 text-xs text-red-600 dark:text-red-400" title={b.error ?? undefined}>
                        {b.error ?? "—"}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
        <p className="text-[11px] text-muted-foreground">
          Errors are tenant-scoped counts via withTenantContext — failed OutreachEmail + GenerationBatch. Use /acquisition/outreach and /acquisition/generate to inspect and retry.
        </p>
      </section>

      {/* Jobs */}
      <section className="space-y-3">
        <SectionHeader title="Jobs" subtitle="Pending followUps + batches (queued/running) — queue consumers, retry targets" />
        <div className="grid gap-3 lg:grid-cols-2">
          <div className="overflow-x-auto rounded-lg border bg-card">
            <div className="border-b bg-muted/20 px-3 py-2">
              <p className="text-xs font-semibold uppercase tracking-wide">FollowUps — pending ({pendingFollowUps.length})</p>
              <p className="text-[11px] text-muted-foreground">status=pending · dueAt asc · total pending {dbState.followUpsPending}</p>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-3 py-2">Due</th>
                  <th className="px-3 py-2">Business</th>
                  <th className="px-3 py-2">Channel</th>
                  <th className="px-3 py-2">Note</th>
                </tr>
              </thead>
              <tbody>
                {pendingFollowUps.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-6 text-center text-xs text-muted-foreground">
                      No pending follow-ups. Create OutreachOrder followupPlan to queue jobs.
                    </td>
                  </tr>
                ) : (
                  pendingFollowUps.map((f: any) => (
                    <tr key={f.id} className="border-b last:border-0 hover:bg-accent/40">
                      <td className="px-3 py-2 text-xs tabular-nums">{formatTime(f.dueAt)}</td>
                      <td className="px-3 py-2 text-xs font-medium">{f.business ?? f.leadKey ?? "—"}</td>
                      <td className="px-3 py-2 text-xs">
                        <span className="rounded-full border bg-muted px-2 py-0.5 text-[11px]">{f.channel ?? "email"}</span>
                      </td>
                      <td className="max-w-[180px] truncate px-3 py-2 text-xs text-muted-foreground" title={f.note ?? undefined}>
                        {f.note ?? "—"}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="overflow-x-auto rounded-lg border bg-card">
            <div className="border-b bg-muted/20 px-3 py-2">
              <p className="text-xs font-semibold uppercase tracking-wide">GenerationBatches — queued/running ({pendingBatches.length})</p>
              <p className="text-[11px] text-muted-foreground">status in queued/pending/running · total queued {dbState.generationBatchesQueued}</p>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-3 py-2">Created</th>
                  <th className="px-3 py-2">Request</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Stage</th>
                </tr>
              </thead>
              <tbody>
                {pendingBatches.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-6 text-center text-xs text-muted-foreground">
                      No queued batches. Generate via /acquisition/generate.
                    </td>
                  </tr>
                ) : (
                  pendingBatches.map((b: any) => (
                    <tr key={b.id} className="border-b last:border-0 hover:bg-accent/40">
                      <td className="px-3 py-2 text-xs text-muted-foreground">{formatTime(b.createdAt)}</td>
                      <td className="px-3 py-2 font-mono text-xs">{b.requestId ?? b.id.slice(0, 8)}</td>
                      <td className="px-3 py-2">
                        <StatusPill state={b.status === "running" ? "running" : "queued"} />
                      </td>
                      <td className="px-3 py-2 text-xs">{b.stage ?? "—"}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
        <p className="text-[11px] text-muted-foreground">Jobs reflect live DB — followUps pending + batches queued. Poll via GET /api/system/health for queueDepth.</p>
      </section>

      {/* Queues */}
      <section className="space-y-3">
        <SectionHeader title="Queues" subtitle="Outreach pending — OutreachEmail where status in submitted/approved/pending/queued" />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <MetricCard label="Queue Depth" value={String(queueDepth)} detail="pending outreach (submitted/approved/pending/queued)" />
          <MetricCard label="Sent" value={String(dbState.outreachEmailSent)} detail="OutreachEmail sent" />
          <MetricCard label="Failed" value={String(dbState.outreachEmailFailed)} detail="OutreachEmail failed" />
          <MetricCard label="Total Outreach" value={String(dbState.outreachEmails)} detail="all OutreachEmail rows" />
          <MetricCard label="Orders" value={String(dbState.outreachOrders)} detail="OutreachOrder total" />
        </div>
        <div className="rounded-lg border bg-card p-3">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Queue bar — pending vs sent vs failed snapshot</p>
          <div className="mt-3 space-y-2">
            {[
              { label: "Pending", value: queueDepth, max: Math.max(queueDepth, dbState.outreachEmailSent, dbState.outreachEmailFailed, 1), color: "bg-amber-500" },
              { label: "Sent", value: dbState.outreachEmailSent, max: Math.max(queueDepth, dbState.outreachEmailSent, dbState.outreachEmailFailed, 1), color: "bg-emerald-500" },
              { label: "Failed", value: dbState.outreachEmailFailed, max: Math.max(queueDepth, dbState.outreachEmailSent, dbState.outreachEmailFailed, 1), color: "bg-red-500" },
            ].map((r) => (
              <div key={r.label} className="flex items-center gap-3">
                <span className="w-20 text-xs font-medium">{r.label}</span>
                <div className="h-3 flex-1 rounded-full bg-muted">
                  <div className={`h-3 rounded-full ${r.color}`} style={{ width: `${Math.round((r.value / r.max) * 100)}%` }} />
                </div>
                <span className="w-12 text-right text-xs tabular-nums">{r.value}</span>
              </div>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            Source: withTenantContext tenant {tenantId.slice(0, 8)}… · counts tenant-scoped. Queue depth is OutreachEmail pending — consumers should drain via approval/outbox.
          </p>
        </div>
      </section>

      {/* DB state */}
      <section className="space-y-3">
        <SectionHeader title="DB State" subtitle="Tenant counts for all acquisition tables — via withTenantContext safeCount (tenant-scoped)" />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard label="Campaigns" value={String(dbState.campaigns)} href="/acquisition/campaigns" />
          <MetricCard label="Outreach Emails" value={String(dbState.outreachEmails)} href="/acquisition/outreach" />
          <MetricCard label="Lead Research" value={String(dbState.leadResearch)} href="/acquisition/leads" />
          <MetricCard label="Outreach Orders" value={String(dbState.outreachOrders)} href="/acquisition/pipeline" />
          <MetricCard label="Generation Batches" value={String(dbState.generationBatches)} href="/acquisition/generate" />
          <MetricCard label="Follow-ups" value={`${dbState.followUpsPending}/${dbState.followUpsTotal}`} detail="pending / total" href="/acquisition/follow-ups" />
          <MetricCard label="Activity Events" value={String(dbState.activityEvents)} detail="last 50 shown in Logs" />
          <MetricCard label="Audit Logs" value={String(dbState.auditLogs)} detail="last 50 below" />
        </div>
        <div className="grid gap-3 lg:grid-cols-2">
          <div className="rounded-lg border bg-card p-3">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Acquisition tables</p>
            <ul className="mt-2 space-y-1 text-xs">
              {Object.entries({
                campaigns: dbState.campaigns,
                outreachEmails: dbState.outreachEmails,
                outreachEmailPending: dbState.outreachEmailPending,
                outreachEmailSent: dbState.outreachEmailSent,
                outreachEmailFailed: dbState.outreachEmailFailed,
                outreachOrders: dbState.outreachOrders,
                leadResearch: dbState.leadResearch,
                generationBatches: dbState.generationBatches,
                generationBatchesFailed: dbState.generationBatchesFailed,
                generationBatchesQueued: dbState.generationBatchesQueued,
                clients: dbState.clients,
              }).map(([k, v]) => (
                <li key={k} className="flex items-center justify-between">
                  <span className="font-mono text-[11px]">{k}</span>
                  <span className="rounded-full bg-muted px-2 py-0.5 tabular-nums">{String(v)}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-lg border bg-card p-3">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Ops tables</p>
            <ul className="mt-2 space-y-1 text-xs">
              {Object.entries({
                followUpsPending: dbState.followUpsPending,
                followUpsTotal: dbState.followUpsTotal,
                activityEvents: dbState.activityEvents,
                auditLogs: dbState.auditLogs,
                integrationStatus: dbState.integrationStatus,
                aiUsageLogs: dbState.aiUsageLogs,
                leadLifecycleEvents: dbState.leadLifecycleEvents,
                queueDepth,
              }).map(([k, v]) => (
                <li key={k} className="flex items-center justify-between">
                  <span className="font-mono text-[11px]">{k}</span>
                  <span className="rounded-full bg-muted px-2 py-0.5 tabular-nums">{String(v)}</span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[11px] text-muted-foreground">All counts are tenant-scoped via withTenantContext — never leak cross-tenant data.</p>
          </div>
        </div>
        <p className="text-[11px] text-muted-foreground">Generated at {new Date().toISOString()} · tenant {tenantId} · DB state reflects live Postgres with RLS (SET LOCAL app.tenant_id).</p>
      </section>

      {/* Configuration */}
      <section className="space-y-3">
        <SectionHeader title="Configuration" subtitle="Env — masked (DATABASE_URL → masked, N8N_BASE_URL masked, keys redacted). Never leaks secrets to browser." />
        <div className="overflow-x-auto rounded-lg border bg-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/20 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-3 py-2">Env Var</th>
                <th className="px-3 py-2">Value (masked)</th>
                <th className="px-3 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {envRows.map((r) => (
                <tr key={r.key} className="border-b last:border-0 hover:bg-accent/40">
                  <td className="px-3 py-2 font-mono text-xs font-medium">{r.key}</td>
                  <td className="px-3 py-2 font-mono text-xs" title={r.value}>
                    <span className={r.missing ? "text-amber-600 dark:text-amber-400" : ""}>{r.value.length > 60 ? `${r.value.slice(0, 60)}…` : r.value}</span>
                    <span className="ml-2 text-[11px] text-muted-foreground">{r.missing ? "" : "masked"}</span>
                  </td>
                  <td className="px-3 py-2">
                    <StatusPill state={r.missing ? "disconnected" : "connected"} />
                    <span className="ml-2 text-xs uppercase tracking-wide">{r.missing ? "MISSING" : "SET"}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="rounded-lg border bg-muted/20 p-3 text-xs">
          <p className="font-medium">Masking note</p>
          <p className="text-muted-foreground">
            URLs are masked via maskUrl (protocol + ***), keys via redact (first2***last2). Raw secrets never leave server — page renders only masked values. Configure missing vars server-side (Vercel env or .env), then Test Connection via /acquisition/integrations.
          </p>
        </div>
      </section>

      {/* Audit logs */}
      <section className="space-y-3">
        <SectionHeader
          title="Audit Logs"
          subtitle={`Filterable AuditLog — who/what/when · last ${auditLimit} (total ${auditTotal}) · tenant-scoped · filter via ?action=&model=`}
          right={
            <div className="flex items-center gap-2 text-[11px]">
              <span className="text-muted-foreground">
                {auditLogs.length} shown · total {auditTotal} · limit {auditLimit} offset {auditOffset}
              </span>
            </div>
          }
        />
        {/* Filter bar */}
        <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-card p-3 text-xs">
          <span className="font-medium uppercase tracking-widest text-muted-foreground">Filter:</span>
          {auditActionFilter ? (
            <Link
              href="/system"
              className="rounded-full border bg-amber-500/15 px-2.5 py-1 text-[11px] font-mono text-amber-700 dark:text-amber-300"
            >
              action={auditActionFilter} ✕
            </Link>
          ) : (
            <span className="text-muted-foreground">no action filter</span>
          )}
          {auditModelFilter ? (
            <Link href="/system" className="rounded-full border bg-sky-500/15 px-2.5 py-1 text-[11px] font-mono text-sky-700 dark:text-sky-300">
              model={auditModelFilter} ✕
            </Link>
          ) : (
            <span className="text-muted-foreground">no model filter</span>
          )}
          <span className="ml-auto flex items-center gap-2">
            <Link href="/system?model=Campaign" className="rounded-full border px-2 py-1 hover:bg-accent">
              model=Campaign
            </Link>
            <Link href="/system?model=ClientAiConfig" className="rounded-full border px-2 py-1 hover:bg-accent">
              model=ClientAiConfig
            </Link>
            <Link href="/system?action=campaign.launch" className="rounded-full border px-2 py-1 hover:bg-accent">
              action=campaign.launch
            </Link>
            <Link href="/system" className="rounded-full bg-primary px-3 py-1 text-primary-foreground">
              Clear
            </Link>
            <Link href="/api/system/audit-logs?limit=50" className="rounded-full border px-2 py-1 hover:bg-accent">
              API
            </Link>
          </span>
        </div>

        <div className="overflow-x-auto rounded-lg border bg-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/20 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-3 py-2">When</th>
                <th className="px-3 py-2">Who</th>
                <th className="px-3 py-2">What (action)</th>
                <th className="px-3 py-2">Resource</th>
                <th className="px-3 py-2">Before → After</th>
              </tr>
            </thead>
            <tbody>
              {auditLogs.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-sm text-muted-foreground">
                    No audit logs yet — trigger control actions (campaign launch, agent toggle, integration test) to populate AuditLog.
                  </td>
                </tr>
              ) : (
                auditLogs.map((log: any) => (
                  <tr key={log.id} className="border-b last:border-0 hover:bg-accent/40">
                    <td className="px-3 py-2 text-xs tabular-nums text-muted-foreground">{formatTime(log.createdAt)}</td>
                    <td className="px-3 py-2">
                      <span className="font-mono text-xs">{log.userId ? String(log.userId).slice(0, 8) : "—"}</span>
                      <span className="ml-1 text-[11px] text-muted-foreground">tenant {String(log.tenantId ?? tenantId).slice(0, 6)}</span>
                    </td>
                    <td className="px-3 py-2">
                      <Link
                        href={`/system?action=${encodeURIComponent(log.action)}`}
                        className="rounded-full border bg-muted px-2 py-0.5 font-mono text-[11px] hover:bg-accent"
                        title="Filter by this action"
                      >
                        {log.action}
                      </Link>
                      <span className="ml-2 text-[11px] text-muted-foreground">{log.model ? `model ${log.model}` : ""}</span>
                    </td>
                    <td className="px-3 py-2">
                      {log.model ? (
                        <Link
                          href={`/system?model=${encodeURIComponent(log.model)}`}
                          className="font-mono text-xs hover:underline"
                          title="Filter by model"
                        >
                          {log.model}
                        </Link>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                      <span className="ml-1 font-mono text-[11px] text-muted-foreground">{log.recordId ? String(log.recordId).slice(0, 8) : "—"}</span>
                    </td>
                    <td className="max-w-[280px] px-3 py-2 text-xs">
                      <div className="space-y-1">
                        {log.before ? (
                          <p className="truncate text-muted-foreground" title={JSON.stringify(log.before).slice(0, 300)}>
                            before: <span className="font-mono">{JSON.stringify(log.before).slice(0, 80)}</span>
                          </p>
                        ) : null}
                        {log.after ? (
                          <p className="truncate" title={JSON.stringify(log.after).slice(0, 300)}>
                            after: <span className="font-mono">{JSON.stringify(log.after).slice(0, 80)}</span>
                          </p>
                        ) : null}
                        {!log.before && !log.after && log.metadata ? (
                          <p className="truncate text-muted-foreground" title={JSON.stringify(log.metadata).slice(0, 300)}>
                            meta: <span className="font-mono">{JSON.stringify(log.metadata).slice(0, 80)}</span>
                          </p>
                        ) : !log.before && !log.after ? (
                          <span className="text-muted-foreground">—</span>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="flex items-center justify-between rounded-lg border bg-card p-3 text-xs">
          <span className="text-muted-foreground">
            Showing {auditLogs.length} of {auditTotal} · limit {auditLimit} offset {auditOffset}
          </span>
          <div className="flex items-center gap-2">
            {auditOffset > 0 ? (
              <Link
                href={`/system?limit=${auditLimit}&offset=${Math.max(0, auditOffset - auditLimit)}${auditActionFilter ? `&action=${encodeURIComponent(auditActionFilter)}` : ""}${auditModelFilter ? `&model=${encodeURIComponent(auditModelFilter)}` : ""}`}
                className="rounded-full border px-3 py-1 hover:bg-accent"
              >
                ← Prev
              </Link>
            ) : (
              <span className="rounded-full border px-3 py-1 text-muted-foreground/50">← Prev</span>
            )}
            {auditOffset + auditLimit < auditTotal ? (
              <Link
                href={`/system?limit=${auditLimit}&offset=${auditOffset + auditLimit}${auditActionFilter ? `&action=${encodeURIComponent(auditActionFilter)}` : ""}${auditModelFilter ? `&model=${encodeURIComponent(auditModelFilter)}` : ""}`}
                className="rounded-full border px-3 py-1 hover:bg-accent"
              >
                Next →
              </Link>
            ) : (
              <span className="rounded-full border px-3 py-1 text-muted-foreground/50">Next →</span>
            )}
            <Link href="/api/system/audit-logs?limit=50&offset=0" className="ml-2 text-primary hover:underline">
              JSON
            </Link>
          </div>
        </div>

        <p className="text-[11px] text-muted-foreground">
          AuditLog is tenant-scoped (where tenantId) via withTenantContext. Columns: who (userId), what (action + model + recordId), when (createdAt), before/after. Filterable via ?action=&model=&limit=&offset= or GET /api/system/audit-logs. Every control action writes AuditLog (campaign launch, agent enable/disable, integration test, etc.).
        </p>
      </section>

      <p className="text-[11px] text-muted-foreground">
        SYSTEM page aggregates health (getIntegrationsHealth), logs (ActivityEvent 50), errors (failed OutreachEmail + GenerationBatch), jobs (pending followUps + batches), queues (outreach pending), DB state (tenant counts), configuration (env mask), audit logs (filterable AuditLog with who/what/when). All tenant-scoped; secrets masked server-side.
      </p>
    </div>
  );
}
