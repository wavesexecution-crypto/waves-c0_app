import type { Metadata } from "next";
import Link from "next/link";
import { StatusPill } from "@/components/command/primitives";
import {
  getHealth,
  getWorkflows,
  n8nApiKey,
  readAutomationManifest,
} from "@/lib/wavesco/n8n";
import { getScheduledTaskInfo } from "@/lib/wavesco/lead-engine";
import { formatIST } from "@/lib/wavesco/time";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Workflows" };

export default function WorkflowsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Workflows</h1>
        <p className="text-sm text-muted-foreground">
          Live state of the existing n8n instance. Active flags come straight from the API.
        </p>
      </div>
      <WorkflowsBody />
    </div>
  );
}

async function WorkflowsBody() {
  const health = await getHealth();
  const hasKey = Boolean(n8nApiKey());

  if (!health.ok && health.reason === "no_base_url") {
    return (
      <div className="rounded-lg border border-dashed p-6 text-sm">
        <div className="flex items-center justify-between gap-3">
          <p className="font-medium">n8n not configured</p>
          <StatusPill state="disconnected" />
        </div>
        <p className="mt-1 text-muted-foreground">Set N8N_BASE_URL in the platform .env and restart.</p>
      </div>
    );
  }

  if (!hasKey || !health.ok) {
    const manifest = readAutomationManifest();
    return (
      <div className="space-y-4">
        <div className="space-y-3 rounded-lg border border-dashed p-6 text-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="font-medium">
                {health.ok ? "n8n REST API disconnected" : "n8n instance unreachable"}
              </p>
              <p className="text-muted-foreground">
                {health.ok
                  ? "The instance answers healthz but no API key is configured, so live workflow and execution data cannot be read. Nothing here is faked."
                  : (health.error ?? "Connection failed")}
              </p>
            </div>
            <StatusPill state={health.ok ? "disconnected" : "error"} />
          </div>
          <ol className="list-inside list-decimal text-xs text-muted-foreground">
            <li>
              Open <Link className="underline" href="http://localhost:5678/settings/api">n8n → Settings → n8n API</Link> and create a key.
            </li>
            <li>
              Add <code className="rounded bg-muted px-1">N8N_API_KEY=…</code> to the platform .env (stays server-side).
            </li>
            <li>Restart the app.</li>
          </ol>
        </div>

        {manifest.ok ? (
          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
                Documented suite · offline manifest
              </h2>
              <span className="rounded-full border border-zinc-500/30 bg-zinc-500/10 px-2 py-0.5 text-[10px] uppercase text-zinc-500">
                manifest · not live
              </span>
            </div>
            <p className="text-[11px] text-muted-foreground">
              {manifest.suite} — generated {formatIST(manifest.generatedAt ?? null)} ·{" "}
              {manifest.workflows?.length ?? 0} workflows documented
            </p>
            <div className="overflow-x-auto rounded-lg border bg-card">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="px-4 py-2.5">Workflow</th>
                    <th className="px-4 py-2.5">Trigger</th>
                    <th className="px-4 py-2.5">Purpose</th>
                  </tr>
                </thead>
                <tbody>
                  {(manifest.workflows ?? []).map((w) => (
                    <tr key={w.id} className="border-b last:border-0 hover:bg-accent/40">
                      <td className="px-4 py-2 font-medium">{w.name}</td>
                      <td className="px-4 py-2 font-mono text-xs text-muted-foreground">{w.trigger}</td>
                      <td className="px-4 py-2 text-xs text-muted-foreground">{w.purpose}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ) : (
          <p className="text-xs text-destructive">Manifest unavailable: {manifest.error}</p>
        )}
      </div>
    );
  }

  return <LiveWorkflowTable />;
}

async function LiveWorkflowTable() {
  const [wf, sched] = await Promise.all([getWorkflows(), getScheduledTaskInfo()]);
  const rows = wf.data?.data ?? [];

  return (
    <>
      {sched ? (
        <p className="text-[11px] text-muted-foreground">
          Windows Task Scheduler — {sched.taskName}: state {sched.state}, next run{" "}
          {sched.nextRunTime ?? "—"}, last run {sched.lastRunTime ?? "—"}
          {sched.lastResult ? ` (exit ${sched.lastResult})` : ""}
        </p>
      ) : null}
      <div className="overflow-x-auto rounded-lg border bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="px-4 py-2.5">Workflow</th>
              <th className="px-4 py-2.5">State</th>
              <th className="px-4 py-2.5">Updated</th>
            </tr>
          </thead>
          <tbody>
            {[...rows]
              .sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name))
              .map((w) => (
                <tr key={w.id} className="border-b last:border-0 hover:bg-accent/40">
                  <td className="px-4 py-2 font-medium">{w.name}</td>
                  <td className="px-4 py-2">
                    <StatusPill state={w.active ? "running" : "queued"} />
                  </td>
                  <td className="px-4 py-2 text-xs text-muted-foreground">{formatIST(w.updatedAt ?? null)}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
