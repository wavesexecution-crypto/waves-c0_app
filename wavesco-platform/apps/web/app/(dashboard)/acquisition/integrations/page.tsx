import type { Metadata } from "next";
import { auth } from "@/lib/auth";
import { requireTenantId } from "@/lib/tenant";
import { getIntegrationsHealth } from "@/lib/wavesco/integrations";
import { StatusPill } from "@/components/command/primitives";
import { AutoRefresh } from "@/components/command/auto-refresh";
import { TestConnectionButton } from "@/components/acquisition/integrations-controls";
import { withTenantContext } from "@wavesco/db";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Integrations — Acquisition OS" };

function pillState(status: string): string {
  const s = status.toLowerCase();
  if (s === "ok") return "connected";
  if (s === "blocked") return "disconnected";
  if (s === "missing") return "unavailable";
  if (s === "error") return "error";
  return s;
}

function formatTime(iso: string | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return String(iso);
  }
}

export default async function IntegrationsPage() {
  const session = await auth();
  const tenantId = requireTenantId(session as unknown);

  let health: Awaited<ReturnType<typeof getIntegrationsHealth>> | null = null;
  let loadError: string | null = null;
  try {
    health = await getIntegrationsHealth(tenantId);
  } catch (e) {
    loadError = e instanceof Error ? e.message : String(e);
  }

  // Fallback usage fetch for AI Gateway if health missing (defensive)
  let aiUsageFallback: { total: number; last24h: number } | null = null;
  if (health && !health.ai_gateway?.usage) {
    try {
      const counts = await withTenantContext(tenantId, async (tx: any) => {
        const total = await tx.aiUsageLog.count({ where: { tenantId } }).catch(() => 0);
        const last24h = await tx.aiUsageLog
          .count({ where: { tenantId, createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } } })
          .catch(() => 0);
        return { total, last24h };
      });
      aiUsageFallback = counts as { total: number; last24h: number };
    } catch {
      // ignore
    }
  }

  const integrations = health
    ? [
        { key: "lead_engine", label: "Lead Engine", entry: health.lead_engine },
        { key: "db", label: "Postgres", entry: health.db ?? health.postgres },
        { key: "n8n", label: "n8n", entry: health.n8n },
        { key: "brevo", label: "Brevo", entry: health.brevo },
        { key: "ai_gateway", label: "AI Gateway", entry: health.ai_gateway },
      ]
    : [];

  const blocked = integrations.filter((i) => i.entry?.status === "BLOCKED" || i.entry?.status === "missing");
  const hasError = integrations.some((i) => i.entry?.status === "error");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Integrations — Acquisition OS</h1>
          <p className="text-sm text-muted-foreground">
            Health matrix for Lead Engine, Postgres, n8n, Brevo, AI Gateway. Test Connection is server-side only — keys never leak to browser, URLs are masked.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <AutoRefresh intervalMs={30_000} />
          <StatusPill state={blocked.length > 0 ? "disconnected" : hasError ? "error" : "connected"} />
          <span className="text-xs uppercase tracking-widest text-muted-foreground">
            {blocked.length > 0 ? `BLOCKED (${blocked.length})` : hasError ? "ERROR" : "LIVE"}
          </span>
        </div>
      </div>

      {loadError ? (
        <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-4 text-sm">
          <p className="font-medium text-red-600 dark:text-red-400">Failed to load integrations health</p>
          <p className="text-xs text-muted-foreground">{loadError}</p>
          <a href="/acquisition/integrations" className="mt-2 inline-block rounded-md border px-3 py-1.5 text-xs hover:bg-accent">
            Retry
          </a>
        </div>
      ) : null}

      {blocked.length > 0 ? (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-4">
          <p className="text-sm font-semibold text-amber-800 dark:text-amber-200">Missing credentials — {blocked.length} integration(s) BLOCKED</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-amber-800/80 dark:text-amber-200/80">
            {blocked.map((b) => (
              <li key={b.key}>
                <span className="font-mono font-medium">{b.label}</span> — {b.entry?.detail ?? b.entry?.reason ?? "missing"} — Test Connection will return BLOCKED without leaking keys.
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[11px] text-muted-foreground">
            Tip: set the missing env vars (LEAD_ENGINE_ROOT, DATABASE_URL, N8N_BASE_URL, BREVO_API_KEY, OPENAI_API_KEY / OLLAMA) server-side; page shows only masked URLs.
          </p>
        </div>
      ) : null}

      {/* Health matrix */}
      <div className="overflow-x-auto rounded-lg border bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/20 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="px-3 py-2">Integration</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Detail</th>
              <th className="px-3 py-2">URL / Key (masked)</th>
              <th className="px-3 py-2">Latency</th>
              <th className="px-3 py-2">Last checked</th>
              <th className="px-3 py-2">Usage</th>
              <th className="px-3 py-2">Test</th>
            </tr>
          </thead>
          <tbody>
            {integrations.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-sm text-muted-foreground">
                  No health data — integration probe failed.
                </td>
              </tr>
            ) : (
              integrations.map((it) => {
                const entry = it.entry as unknown as {
                  status?: string;
                  detail?: string;
                  reason?: string;
                  url?: string;
                  lastCheckedAt?: string;
                  latencyMs?: number;
                  usage?: { total?: number; last24h?: number } | null;
                } | undefined;
                const status = entry?.status ?? "missing";
                const detail = entry?.detail ?? entry?.reason ?? "—";
                const url = entry?.url ?? "***";
                const latency = entry?.latencyMs != null ? `${entry.latencyMs}ms` : "—";
                const last = formatTime(entry?.lastCheckedAt);
                const usageObj = (entry?.usage as { total?: number; last24h?: number } | null) ?? (it.key === "ai_gateway" ? aiUsageFallback : null);
                const usageStr =
                  it.key === "ai_gateway" && usageObj
                    ? `total ${usageObj.total ?? 0} · 24h ${usageObj.last24h ?? 0}`
                    : it.key === "ai_gateway"
                    ? "—"
                    : "—";
                return (
                  <tr key={it.key} className="border-b last:border-0 hover:bg-accent/40">
                    <td className="px-3 py-3">
                      <p className="text-sm font-medium">{it.label}</p>
                      <p className="font-mono text-[11px] text-muted-foreground">{it.key}</p>
                    </td>
                    <td className="px-3 py-3">
                      <StatusPill state={pillState(status)} />
                      <span className="ml-2 text-xs uppercase tracking-wide">{status}</span>
                    </td>
                    <td className="max-w-[260px] px-3 py-3">
                      <p className="line-clamp-2 text-xs" title={detail}>
                        {detail}
                      </p>
                      {entry?.reason && entry.reason !== detail ? (
                        <p className="text-[11px] text-muted-foreground" title={entry.reason}>
                          {entry.reason.slice(0, 80)}
                        </p>
                      ) : null}
                    </td>
                    <td className="px-3 py-3">
                      <span className="font-mono text-xs" title={url}>
                        {typeof url === "string" && url.length > 40 ? `${url.slice(0, 40)}…` : url}
                      </span>
                      <p className="text-[11px] text-muted-foreground">masked via maskUrl</p>
                    </td>
                    <td className="px-3 py-3 text-xs tabular-nums">{latency}</td>
                    <td className="px-3 py-3 text-xs text-muted-foreground">{last}</td>
                    <td className="px-3 py-3 text-xs tabular-nums">{usageStr}</td>
                    <td className="px-3 py-3">
                      <TestConnectionButton integrationKey={it.key} label={it.label} />
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* API health + usage details */}
      <div className="grid gap-3 lg:grid-cols-2">
        <div className="rounded-lg border bg-card p-4">
          <h3 className="text-sm font-semibold">API health</h3>
          <p className="text-xs text-muted-foreground">Live probes are server-side; Test Connection audits to AuditLog with model IntegrationStatus.</p>
          <div className="mt-3 space-y-2">
            {integrations.map((it) => {
              const entry = it.entry as unknown as { status?: string; detail?: string; latencyMs?: number } | undefined;
              return (
                <div key={it.key} className="flex items-center justify-between rounded border bg-muted/20 px-3 py-2 text-xs">
                  <span className="font-mono">{it.label}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${entry?.status === "ok" ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" : entry?.status === "BLOCKED" ? "bg-amber-500/15 text-amber-700 dark:text-amber-300" : "bg-red-500/15 text-red-600 dark:text-red-400"}`}>
                    {entry?.status ?? "missing"}
                  </span>
                  <span className="tabular-nums text-muted-foreground">{entry?.latencyMs != null ? `${entry.latencyMs}ms` : "—"}</span>
                </div>
              );
            })}
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            Blocked integrations return 200 with status BLOCKED — never 500, never leak api_key/secret. All probes are audited as integration.test.
          </p>
        </div>

        <div className="rounded-lg border bg-card p-4">
          <h3 className="text-sm font-semibold">Usage where available</h3>
          <p className="text-xs text-muted-foreground">AI Gateway usage from AiUsageLog counts (total, last 24h). Other integrations show latency where measured.</p>
          <div className="mt-3 space-y-2">
            <div className="rounded border bg-muted/20 p-3">
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">AiUsageLog</p>
              {(() => {
                const ai = health?.ai_gateway as unknown as { usage?: { total?: number; last24h?: number } } | undefined;
                const u = (ai?.usage as { total?: number; last24h?: number } | null) ?? aiUsageFallback;
                if (!u || (u.total === 0 && u.last24h === 0)) {
                  return <p className="mt-1 text-xs text-muted-foreground">No AI usage yet — trigger enrichment or email generation to populate ledger, or check AiUsageLog via agents page for details.</p>;
                }
                return (
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <div className="rounded bg-card p-2">
                      <p className="text-[11px] text-muted-foreground">Total</p>
                      <p className="font-mono text-sm tabular-nums">{u.total ?? 0}</p>
                    </div>
                    <div className="rounded bg-card p-2">
                      <p className="text-[11px] text-muted-foreground">Last 24h</p>
                      <p className="font-mono text-sm tabular-nums">{u.last24h ?? 0}</p>
                    </div>
                  </div>
                );
              })()}
              <p className="mt-2 text-[11px] text-muted-foreground">Source: withTenantContext → aiUsageLog.count (tenant {tenantId.slice(0, 8)}…)</p>
            </div>
            <div className="rounded border bg-muted/20 p-3">
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Other usage / cost hints</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Lead Engine: see <span className="font-mono">/acquisition</span> corpus stats. Postgres: latencyMs shown above. n8n: workflows count via <span className="font-mono">/api/acquisition/workflows</span>. Brevo: account endpoint not enumerated here; full usage via Brevo dashboard.
              </p>
            </div>
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            All URLs and keys are masked (maskUrl / redact) before rendering — server never sends raw secrets to browser.
          </p>
        </div>
      </div>

      <p className="text-[11px] text-muted-foreground">
        Server component fetches getIntegrationsHealth(tenantId) — tenant {tenantId} — which aggregates LEAD_ENGINE_ROOT, N8N_BASE_URL, DATABASE_URL, BREVO_API_KEY, AI gateway env. Test Connection buttons POST to /api/acquisition/integrations/test with confirmation, audited as IntegrationStatus.
      </p>
    </div>
  );
}
