import type { Metadata } from "next";
import { auth } from "@/lib/auth";
import { requireTenantId } from "@/lib/tenant";
import { withTenantContext } from "@wavesco/db";
import { maskUrl } from "@/lib/wavesco/integrations";
import { StatusPill } from "@/components/command/primitives";
import { AutoRefresh } from "@/components/command/auto-refresh";
import { AgentToggle, AgentConfigureForm } from "@/components/acquisition/agent-controls";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Agents — AI Gateway" };

function formatTokens(n: number | null | undefined): string {
  if (n == null) return "—";
  return String(n);
}

export default async function AgentsPage() {
  const session = await auth();
  const tenantId = requireTenantId(session as unknown);

  let config: {
    id: string;
    tenantId: string;
    aiEnabled: boolean;
    provider: string | null;
    model: string | null;
    baseUrl: string | null;
    credentialRef?: string | null;
    obsidianRoot?: string | null;
    createdAt?: unknown;
    updatedAt?: unknown;
  } | null = null;
  let usage: {
    id: string;
    tenantId: string;
    operation: string;
    provider: string;
    model: string;
    status: string;
    inputTokens: number | null;
    outputTokens: number | null;
    latencyMs: number | null;
    error: string | null;
    createdAt: Date | string;
  }[] = [];
  let loadError: string | null = null;

  try {
    const result = await withTenantContext(tenantId, async (tx: any) => {
      const c = await tx.clientAiConfig.findFirst({ where: { tenantId }, orderBy: { createdAt: "desc" } });
      const u = await tx.aiUsageLog.findMany({ where: { tenantId }, orderBy: { createdAt: "desc" }, take: 20 });
      return { config: c, usage: u };
    });
    config = result.config as any;
    usage = (result.usage as any) ?? [];
  } catch (e) {
    loadError = e instanceof Error ? e.message : String(e);
  }

  const isConfigured = !!config;
  const isEnabled = !!config?.aiEnabled;
  const gatewayStatus = !isConfigured ? "not_configured" : isEnabled ? "ok" : "disabled";
  const gatewayPill: string = gatewayStatus === "ok" ? "connected" : gatewayStatus === "disabled" ? "disconnected" : gatewayStatus === "not_configured" ? "unavailable" : "error";

  const maskedBaseUrl = config?.baseUrl ? maskUrl(String(config.baseUrl)) : "***";
  // never leak credentialRef — intentionally not reading it, but if loaded, do not render
  const provider = config?.provider ?? "ollama_cloud";
  const model = config?.model ?? "—";

  const failures = usage.filter((u) => u.status === "error");
  const toolUsage = usage.reduce<Record<string, number>>((acc, cur) => {
    const op = cur.operation ?? "unknown";
    acc[op] = (acc[op] ?? 0) + 1;
    return acc;
  }, {});
  const totalInputTokens = usage.reduce((s, u) => s + (u.inputTokens ?? 0), 0);
  const totalOutputTokens = usage.reduce((s, u) => s + (u.outputTokens ?? 0), 0);
  const avgLatency = usage.length > 0 ? Math.round(usage.reduce((s, u) => s + (u.latencyMs ?? 0), 0) / usage.length) : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Agents — Waves AI Gateway</h1>
          <p className="text-sm text-muted-foreground">
            Per-tenant AI Gateway control. Gateway credentials are credentialRef (env:VAR) server-side only, never exposed to the browser. Base URL is masked.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <AutoRefresh intervalMs={15_000} />
          <StatusPill state={gatewayPill} />
          <span className="text-xs uppercase tracking-widest text-muted-foreground">
            {gatewayStatus === "ok" ? "LIVE" : gatewayStatus === "disabled" ? "DISABLED" : gatewayStatus === "not_configured" ? "NOT CONFIGURED" : "ERROR"}
          </span>
        </div>
      </div>

      {loadError ? (
        <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-4 text-sm">
          <p className="font-medium text-red-600 dark:text-red-400">Failed to load gateway state</p>
          <p className="text-xs text-muted-foreground">{loadError}</p>
          <a href="/acquisition/agents" className="mt-2 inline-block rounded-md border px-3 py-1.5 text-xs hover:bg-accent">
            Retry
          </a>
        </div>
      ) : null}

      {!isConfigured ? (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-4">
          <p className="text-sm font-semibold text-amber-800 dark:text-amber-200">AI Gateway disabled — not_configured</p>
          <p className="mt-1 text-xs text-muted-foreground">
            No ClientAiConfig for this tenant. Enable will create a default config (provider ollama_cloud). Configure saves provider/model/baseUrl (audited, credentialRef never leaves server).
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">Gateway: not_configured · tenant {tenantId} · Limits: rate/token — provider-enforced, see activity below.</p>
        </div>
      ) : !isEnabled ? (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-4">
          <p className="text-sm font-semibold text-amber-800 dark:text-amber-200">AI Gateway disabled</p>
          <p className="mt-1 text-xs text-muted-foreground">
            aiEnabled=false. All gateway calls are blocked with 403 ai_disabled. Enable to resume enrichment/email AI operations. No fake success is shown — status reflects ClientAiConfig.
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">Gateway: disabled · provider {provider} · model {model} · baseUrl {String(maskedBaseUrl)} · credential: masked (server-side credentialRef)</p>
        </div>
      ) : null}

      {/* Agent list / config card */}
      <div className="rounded-lg border bg-card">
        <div className="border-b px-4 py-3">
          <h2 className="text-sm font-semibold">Agent config (ClientAiConfig)</h2>
          <p className="text-xs text-muted-foreground">One row per tenant. Enable/disable toggles aiEnabled and is audit-logged. Configure updates provider/model/baseUrl.</p>
        </div>
        {isConfigured && config ? (
          <div className="space-y-3 p-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-md border bg-muted/20 p-3">
                <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Tenant</p>
                <p className="mt-1 font-mono text-xs">{config.tenantId}</p>
                <p className="text-[11px] text-muted-foreground">id {config.id}</p>
              </div>
              <div className="rounded-md border bg-muted/20 p-3">
                <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Enabled</p>
                <p className="mt-1 flex items-center gap-2">
                  <StatusPill state={isEnabled ? "connected" : "disconnected"} />
                  <span className="text-xs font-medium">{isEnabled ? "enabled" : "disabled"}</span>
                </p>
                <p className="text-[11px] text-muted-foreground">gateway {gatewayStatus}</p>
              </div>
              <div className="rounded-md border bg-muted/20 p-3">
                <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Provider / Model</p>
                <p className="mt-1 text-xs font-medium">{provider} · {model}</p>
                <p className="text-[11px] text-muted-foreground">baseUrl {String(maskedBaseUrl)}</p>
              </div>
              <div className="rounded-md border bg-muted/20 p-3">
                <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Credential</p>
                <p className="mt-1 font-mono text-xs">*** (credentialRef masked)</p>
                <p className="text-[11px] text-muted-foreground">Resolved server-side via env:VAR; never leaked</p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/30 p-3">
              <AgentToggle aiEnabled={isEnabled} hasConfig={true} />
              <span className="ml-auto text-[11px] text-muted-foreground">Audit: agent.enable / agent.disable → AuditLog (ClientAiConfig, tenant {tenantId})</span>
            </div>

            <AgentConfigureForm initial={{ provider: config.provider ?? "ollama_cloud", model: config.model ?? "gemma3:27b", baseUrl: maskedBaseUrl }} />

            <p className="text-[11px] text-muted-foreground">
              Config updatedAt {config.updatedAt ? String(new Date(config.updatedAt as any).toLocaleString()) : "—"} · obsidianRoot {String((config as any).obsidianRoot ?? "—")} · If gateway unreachable during configure, response status=error but audit still written.
            </p>
          </div>
        ) : (
          <div className="space-y-3 p-4">
            <p className="text-sm text-muted-foreground">No config yet. Use Enable to create a default, or Configure to create with custom provider/model/baseUrl.</p>
            <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/30 p-3">
              <AgentToggle aiEnabled={false} hasConfig={false} />
              <span className="ml-auto text-[11px] text-muted-foreground">Will create ClientAiConfig on first enable/configure (audited).</span>
            </div>
            <AgentConfigureForm initial={{ provider: "ollama_cloud", model: "gemma3:27b", baseUrl: "" }} />
          </div>
        )}
      </div>

      {/* Activity — AiUsageLog last 20 */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">Activity — AiUsageLog (last 20)</h2>
          <span className="text-xs text-muted-foreground">
            {usage.length} entries · total input {totalInputTokens} · output {totalOutputTokens} · avg latency {avgLatency != null ? `${avgLatency}ms` : "—"}
          </span>
        </div>

        <div className="overflow-x-auto rounded-lg border bg-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-3 py-2">When</th>
                <th className="px-3 py-2">Operation</th>
                <th className="px-3 py-2">Provider / Model</th>
                <th className="px-3 py-2">Tokens</th>
                <th className="px-3 py-2">Latency</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Error</th>
              </tr>
            </thead>
            <tbody>
              {usage.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-sm text-muted-foreground">
                    No AI usage yet. Trigger enrichment or email generation to populate the ledger.
                  </td>
                </tr>
              ) : (
                usage.map((u) => (
                  <tr key={u.id} className="border-b last:border-0 hover:bg-accent/40">
                    <td className="px-3 py-2 text-xs text-muted-foreground">{new Date(u.createdAt).toLocaleString()}</td>
                    <td className="px-3 py-2 text-xs font-mono">{u.operation}</td>
                    <td className="px-3 py-2 text-xs">{u.provider} · {u.model}</td>
                    <td className="px-3 py-2 text-xs tabular-nums">
                      in {formatTokens(u.inputTokens)} · out {formatTokens(u.outputTokens)}
                    </td>
                    <td className="px-3 py-2 text-xs tabular-nums">{u.latencyMs != null ? `${u.latencyMs}ms` : "—"}</td>
                    <td className="px-3 py-2">
                      <StatusPill state={u.status === "success" ? "connected" : u.status === "error" ? "error" : "queued"} />
                      <span className="ml-2 text-xs">{u.status}</span>
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground max-w-[200px] truncate" title={u.error ?? undefined}>
                      {u.error ?? "—"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Tool usage & failures & limits summary */}
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg border bg-card p-3">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Tool usage (by operation)</p>
            {Object.keys(toolUsage).length === 0 ? (
              <p className="mt-1 text-xs text-muted-foreground">No operations logged.</p>
            ) : (
              <ul className="mt-2 space-y-1">
                {Object.entries(toolUsage).map(([op, count]) => (
                  <li key={op} className="flex items-center justify-between text-xs">
                    <span className="font-mono">{op}</span>
                    <span className="rounded-full bg-muted px-2 py-0.5 tabular-nums">{count}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="rounded-lg border bg-card p-3">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Failures (status=error)</p>
            {failures.length === 0 ? (
              <p className="mt-1 text-xs text-emerald-600 dark:text-emerald-400">No failures in last 20 — clean.</p>
            ) : (
              <div className="mt-2 space-y-2">
                <p className="text-xs">
                  <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-xs font-medium text-red-600 dark:text-red-400">{failures.length} failed</span>
                  <span className="ml-2 text-[11px] text-muted-foreground">most recent:</span>
                </p>
                <ul className="space-y-1">
                  {failures.slice(0, 5).map((f) => (
                    <li key={f.id} className="rounded border bg-muted/20 px-2 py-1 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-[11px]">{f.operation}</span>
                        <span className="text-[11px] text-muted-foreground">{new Date(f.createdAt).toLocaleString()}</span>
                      </div>
                      <p className="mt-0.5 truncate text-[11px] text-muted-foreground" title={f.error ?? undefined}>
                        {f.error ?? "no error message"}
                      </p>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          <div className="rounded-lg border bg-card p-3">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Limits (rate / token)</p>
            <p className="mt-2 text-xs text-muted-foreground">
              Provider-enforced. No app-level rate limit is applied; token usage below is the ledger for cost/throughput monitoring.
            </p>
            <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
              <div className="rounded border bg-muted/20 p-2">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Input tokens (last 20)</p>
                <p className="mt-1 font-mono text-sm tabular-nums">{totalInputTokens}</p>
              </div>
              <div className="rounded border bg-muted/20 p-2">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Output tokens</p>
                <p className="mt-1 font-mono text-sm tabular-nums">{totalOutputTokens}</p>
              </div>
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">Estimated cost: sum via AiUsageLog.estimatedCostUsd when provider reports usage (not yet, ~4 chars/token estimate).</p>
          </div>
        </div>

        <p className="text-[11px] text-muted-foreground">
          Source: AiUsageLog (tenant-scoped, last 20) · Status reflects DB; gateway unreachable surfaces as error, not success. Base URLs masked via maskUrl, credentialRef never leaves server.
        </p>
      </div>
    </div>
  );
}
