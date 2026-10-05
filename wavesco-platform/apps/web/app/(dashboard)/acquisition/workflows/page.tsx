import type { Metadata } from "next";
import { auth } from "@/lib/auth";
import { requireTenantId } from "@/lib/tenant";
import { n8nHealth, maskUrl } from "@/lib/wavesco/integrations";
import { getWorkflows, getExecutions, readAutomationManifest, n8nBaseUrl } from "@/lib/wavesco/n8n";
import { StatusPill } from "@/components/command/primitives";
import { AutoRefresh } from "@/components/command/auto-refresh";
import { WorkflowControls, WorkflowHistoryButton } from "@/components/acquisition/workflow-controls";
import { safeErrorText } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Workflows" };

function stateForWorkflow(active: boolean): string {
  return active ? "running" : "disconnected";
}

export default async function WorkflowsPage() {
  const session = await auth();
  requireTenantId(session as unknown);

  const health = n8nHealth();
  const isBlocked = health.status === "BLOCKED";

  let workflows: {
    id: string;
    name: string;
    active: boolean;
    updatedAt?: string;
    tags?: { id: string; name: string }[];
    trigger?: string;
    purpose?: string;
    _fallback?: boolean;
    executions?: { id: string; status?: string; startedAt?: string; stoppedAt?: string; mode?: string }[];
  }[] = [];
  let executions: { id: string; workflowId?: string; status?: string; startedAt?: string; stoppedAt?: string; mode?: string }[] = [];
  let error: string | null = null;
  let fallbackReason: string | null = null;
  let fallback = false;

  if (!isBlocked) {
    try {
      const wfRes = await getWorkflows();
      if (wfRes.ok && wfRes.data) {
        workflows = (wfRes.data.data ?? []).map((w) => ({ ...w })) as typeof workflows;
        try {
          const execRes = await getExecutions(50);
          if (execRes.ok && execRes.data) executions = (execRes.data.data ?? []) as typeof executions;
        } catch {
          // ignore
        }
        // attach executions to workflows for client history button
        const byWf = new Map<string, typeof executions>();
        for (const ex of executions) {
          const wid = ex.workflowId ?? "";
          if (!wid) continue;
          const arr = byWf.get(wid) ?? [];
          arr.push(ex);
          byWf.set(wid, arr);
        }
        workflows = workflows.map((w) => ({ ...w, executions: byWf.get(w.id) ?? [] }));
      } else if (wfRes.reason === "no_api_key" || wfRes.reason === "http_error" || wfRes.reason === "network") {
        const manifest = readAutomationManifest();
        if (manifest.ok && manifest.workflows && manifest.workflows.length > 0) {
          fallback = true;
          fallbackReason = wfRes.error ?? "N8N_API_KEY missing or n8n unreachable — showing manifest inventory (not live state)";
          workflows = manifest.workflows.map((m) => ({
            id: m.id,
            name: m.name,
            active: false,
            trigger: m.trigger,
            purpose: m.purpose,
            _fallback: true,
            executions: [],
          }));
        } else {
          error = wfRes.error ?? "n8n workflow fetch failed";
        }
      } else {
        error = wfRes.error ?? "n8n unreachable";
      }
    } catch (e) {
      error = safeErrorText(e, "Automation is temporarily unavailable.", "workflows:load");
    }
    // If workflows empty and no fallback, try manifest as last resort
    if (workflows.length === 0 && !error && !fallback) {
      const manifest = readAutomationManifest();
      if (manifest.ok && manifest.workflows && manifest.workflows.length > 0) {
        fallback = true;
        fallbackReason = "n8n returned no workflows — showing manifest inventory";
        workflows = manifest.workflows.map((m) => ({
          id: m.id,
          name: m.name,
          active: false,
          trigger: m.trigger,
          purpose: m.purpose,
          _fallback: true,
          executions: [],
        }));
      }
    }
  }

  const baseRaw = n8nBaseUrl();
  const masked = baseRaw ? maskUrl(baseRaw) : "***";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">Automation</p>
          <h1 className="mt-1 font-display text-[22px] font-semibold tracking-[-0.02em] text-foreground">Workflows</h1>
          <p className="mt-1.5 max-w-2xl font-sans text-[13px] leading-5 text-muted-foreground">
            n8n automation control — enable/disable, execute, history, retry failed, inspect failures, view workflow state. Server-side key only, never exposed to browser.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <AutoRefresh intervalMs={10_000} />
          <StatusPill state={isBlocked ? "disconnected" : fallback ? "degraded" : error ? "error" : "connected"} />
          <span className="font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">{isBlocked ? "BLOCKED" : fallback ? "FALLBACK MANIFEST" : error ? "ERROR" : "LIVE"}</span>
        </div>
      </div>

      {isBlocked ? (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-4">
          <p className="text-sm font-semibold text-amber-800 dark:text-amber-200">NOT TESTED — N8N_BASE_URL missing</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Workflows control is BLOCKED. Set <code className="rounded bg-muted px-1 py-0.5 font-mono">N8N_BASE_URL</code> and <code className="rounded bg-muted px-1 py-0.5 font-mono">N8N_API_KEY</code> (server-side only) to enable live n8n state. No fake success is shown.
          </p>
          <p className="mt-1 font-mono text-[11px] tracking-[0.02em] text-muted-foreground">Health: {health.reason} · masked url: {String(masked)}</p>
        </div>
      ) : null}

      {!isBlocked && fallbackReason ? (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs">
          <p className="font-medium text-amber-700 dark:text-amber-300">Manifest inventory — not live n8n state</p>
          <p className="text-muted-foreground">{fallbackReason}</p>
        </div>
      ) : null}

      {!isBlocked && error ? (
        <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-4 text-sm">
          <p className="font-medium text-red-600 dark:text-red-400">Workflows unreachable</p>
          <p className="font-sans text-[13px] leading-5 text-muted-foreground">{error}</p>
          <p className="mt-1 font-mono text-[11px] tracking-[0.02em] text-muted-foreground">Base: {masked} · Verify n8n instance and API key via Integrations → Test Connection.</p>
          <a href="/acquisition/workflows" className="mt-2 inline-block rounded-lg border border-border/80 px-3 py-1.5 text-xs hover:bg-accent">
            Retry
          </a>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border/80 bg-card p-3 text-xs">
        <span className="font-medium uppercase tracking-widest text-muted-foreground">Control:</span>
        <span className="rounded-full border px-2 py-0.5">Enable / Disable toggle</span>
        <span className="rounded-full border px-2 py-0.5">Execute</span>
        <span className="rounded-full border px-2 py-0.5">History</span>
        <span className="rounded-full border px-2 py-0.5">Retry failed</span>
        <span className="rounded-full border px-2 py-0.5">Inspect failures</span>
        <span className="rounded-full border px-2 py-0.5">View workflow state</span>
        <span className="ml-auto font-mono text-[11px] tracking-[0.02em] text-muted-foreground">
          {isBlocked ? "0 workflows · BLOCKED" : `${workflows.length} workflows · ${executions.length} executions · state reflects n8n + audit`}
        </span>
      </div>

      {isBlocked ? (
        <div className="overflow-x-auto rounded-lg border border-border/80 bg-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/60 text-left font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
                <th className="px-4 py-2.5">Workflow</th>
                <th className="px-4 py-2.5">ID</th>
                <th className="px-4 py-2.5">State</th>
                <th className="px-4 py-2.5">Trigger</th>
                <th className="px-4 py-2.5">Actions</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-sm text-muted-foreground">
                  No workflows loaded — n8n is BLOCKED. Configure N8N_BASE_URL to view and control workflows.
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      ) : workflows.length === 0 && !error ? (
        <div className="rounded-lg border border-dashed border-border/80 p-8 text-center text-sm text-muted-foreground">
          <p>No workflows found. If n8n is configured, verify API key has workflow read access.</p>
          <a href="/acquisition/integrations" className="mt-3 inline-block rounded-lg border border-border/80 px-3 py-1.5 text-xs hover:bg-accent">
            Test n8n Connection
          </a>
        </div>
      ) : workflows.length > 0 ? (
        <div className="space-y-4">
          <div className="overflow-x-auto rounded-lg border border-border/80 bg-card">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/60 text-left font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
                  <th className="px-4 py-2.5">Workflow</th>
                  <th className="px-4 py-2.5">ID</th>
                  <th className="px-4 py-2.5">State</th>
                  <th className="px-4 py-2.5">Trigger / Purpose</th>
                  <th className="px-4 py-2.5">Failure</th>
                  <th className="px-4 py-2.5">Actions</th>
                </tr>
              </thead>
              <tbody>
                {workflows.map((w) => {
                  const failedExecs = (w.executions ?? []).filter((e) => (e.status ?? "").toLowerCase().includes("fail") || (e.status ?? "").toLowerCase().includes("error")).length;
                  const lastFailed = (w.executions ?? []).find((e) => (e.status ?? "").toLowerCase().includes("fail") || (e.status ?? "").toLowerCase().includes("error"));
                  return (
                    <tr key={w.id} className="border-b border-border/60 last:border-0 hover:bg-card-hover">
                      <td className="px-4 py-3">
                        <div className="font-medium">{w.name}</div>
                        {w._fallback ? <span className="text-[11px] text-amber-600 dark:text-amber-400">manifest · not live</span> : null}
                        {w.tags && w.tags.length > 0 ? (
                          <div className="mt-1 flex flex-wrap gap-1">
                            {w.tags.map((t) => (
                              <span key={t.id} className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] tracking-[0.02em] text-muted-foreground">
                                {t.name}
                              </span>
                            ))}
                          </div>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{w.id}</td>
                      <td className="px-4 py-3">
                        <StatusPill state={w._fallback ? "unavailable" : stateForWorkflow(!!w.active)} />
                        <div className="mt-1 font-mono text-[11px] tracking-[0.02em] text-muted-foreground">{w.active ? "active" : "inactive"}</div>
                        {w.updatedAt ? <div className="font-mono text-[11px] tracking-[0.02em] text-muted-foreground/60">{new Date(w.updatedAt).toLocaleString()}</div> : null}
                      </td>
                      <td className="px-4 py-3 text-xs">
                        {w.trigger ? <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px]">{w.trigger}</span> : <span className="text-muted-foreground">—</span>}
                        {w.purpose ? <p className="mt-1 max-w-[260px] font-mono text-[11px] tracking-[0.02em] text-muted-foreground">{w.purpose}</p> : null}
                      </td>
                      <td className="px-4 py-3 text-xs">
                        {failedExecs > 0 ? (
                          <div>
                            <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-[11px] font-medium text-red-600 dark:text-red-400">{failedExecs} failed</span>
                            {lastFailed ? (
                              <p className="mt-1 max-w-[180px] truncate font-mono text-[11px] tracking-[0.02em] text-muted-foreground" title={JSON.stringify(lastFailed)}>
                                Last failure: {lastFailed.status} @ {lastFailed.stoppedAt ?? lastFailed.startedAt ?? "—"}
                              </p>
                            ) : null}
                            <a
                              href={`#failures-${w.id}`}
                              onClick={(e) => e.preventDefault()}
                              className="mt-1 inline-block text-[11px] text-primary hover:underline"
                            >
                              Inspect failures
                            </a>
                          </div>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {w._fallback ? (
                          <span className="font-mono text-[11px] tracking-[0.02em] text-muted-foreground">Actions disabled in fallback mode</span>
                        ) : (
                          <div className="flex flex-col gap-2">
                            <WorkflowControls workflowId={w.id} workflowName={w.name} active={!!w.active} />
                            <WorkflowHistoryButton workflowId={w.id} />
                            <a href={`#view-${w.id}`} className="font-mono text-[11px] tracking-[0.02em] text-muted-foreground hover:text-foreground hover:underline" title="View workflow state (JSON)">
                              View state
                            </a>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {executions.length > 0 ? (
            <div className="space-y-2">
              <h2 className="font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">Recent executions (all workflows)</h2>
              <div className="overflow-x-auto rounded-lg border border-border/80 bg-card">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border/60 text-left font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
                      <th className="px-4 py-2">Execution</th>
                      <th className="px-4 py-2">Workflow</th>
                      <th className="px-4 py-2">Status</th>
                      <th className="px-4 py-2">Mode</th>
                      <th className="px-4 py-2">Started</th>
                      <th className="px-4 py-2">Stopped</th>
                      <th className="px-4 py-2">Retry</th>
                    </tr>
                  </thead>
                  <tbody>
                    {executions.slice(0, 20).map((ex) => {
                      const isFailed = (ex.status ?? "").toLowerCase().includes("fail") || (ex.status ?? "").toLowerCase().includes("error");
                      return (
                        <tr key={ex.id} className="border-b border-border/60 last:border-0 hover:bg-card-hover">
                          <td className="px-4 py-2 font-mono text-xs">{ex.id}</td>
                          <td className="px-4 py-2 font-mono text-xs text-muted-foreground">{ex.workflowId ?? "—"}</td>
                          <td className="px-4 py-2">
                            <StatusPill state={isFailed ? "failed" : (ex.status ?? "").toLowerCase() === "success" ? "connected" : "queued"} />
                            <span className="ml-2 text-xs">{ex.status ?? "—"}</span>
                          </td>
                          <td className="px-4 py-2 text-xs text-muted-foreground">{ex.mode ?? "—"}</td>
                          <td className="px-4 py-2 text-xs text-muted-foreground">{ex.startedAt ? new Date(ex.startedAt).toLocaleString() : "—"}</td>
                          <td className="px-4 py-2 text-xs text-muted-foreground">{ex.stoppedAt ? new Date(ex.stoppedAt).toLocaleString() : "—"}</td>
                          <td className="px-4 py-2">
                            {isFailed && ex.workflowId ? (
                              <form
                                onSubmit={async (e) => {
                                  e.preventDefault();
                                  const fd = new FormData(e.currentTarget as HTMLFormElement);
                                  // handled by client controls; placeholder for progressive enhancement
                                  void fd;
                                }}
                              >
                                <span className="font-mono text-[11px] tracking-[0.02em] text-muted-foreground">Use Retry failed on workflow row</span>
                              </form>
                            ) : (
                              <span className="font-mono text-[11px] tracking-[0.02em] text-muted-foreground">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      <p className="font-mono text-[11px] tracking-[0.02em] text-muted-foreground">
        n8n base: {masked} · API key: {process.env.N8N_API_KEY ? "present (server-side only, never leaked to browser)" : "missing — control actions will fail until set"} · Audit: every enable/disable/execute/retry is logged to AuditLog with workflow id + actor.
      </p>
    </div>
  );
}
