"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type WorkflowAction = "enable" | "disable" | "execute" | "retry";

export function WorkflowControls({ workflowId, workflowName, active }: { workflowId: string; workflowName: string; active: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState<WorkflowAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function doAction(action: WorkflowAction) {
    const confirmMap: Record<string, string> = {
      enable: `Enable workflow "${workflowName}"?\n\nThis will PATCH active=true via n8n API (server-side, key never leaves server).`,
      disable: `Disable workflow "${workflowName}"?\n\nThis will PATCH active=false and pause execution.`,
      execute: `Execute workflow "${workflowName}" now?\n\nThis triggers a manual execution via n8n API.`,
      retry: `Retry failed execution for "${workflowName}"?\n\nThis will re-execute the last failed run if available, else trigger a fresh execution.`,
    };
    if (typeof window !== "undefined" && !window.confirm(confirmMap[action] ?? `Confirm ${action}?`)) return;
    setPending(action);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch(`/api/acquisition/workflows/${encodeURIComponent(workflowId)}/control`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const json = await res.json().catch(() => ({} as Record<string, unknown>));
      if (!res.ok) {
        const detail = (json as { reason?: string; error?: string }).reason ?? (json as { error?: string }).error ?? `Failed ${res.status}`;
        throw new Error(detail);
      }
      if ((json as { status?: string }).status === "error" || (json as { status?: string }).status === "BLOCKED") {
        throw new Error((json as { reason?: string }).reason ?? "error");
      }
      setSuccess(`${action} → ok`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {active ? (
        <button
          type="button"
          disabled={!!pending}
          onClick={() => doAction("disable")}
          className="rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-xs font-medium text-amber-700 hover:bg-amber-500/20 disabled:opacity-50 dark:text-amber-300"
        >
          {pending === "disable" ? "Disabling…" : "Disable"}
        </button>
      ) : (
        <button
          type="button"
          disabled={!!pending}
          onClick={() => doAction("enable")}
          className="rounded-md bg-emerald-600 px-2 py-1 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          {pending === "enable" ? "Enabling…" : "Enable"}
        </button>
      )}
      <button
        type="button"
        disabled={!!pending}
        onClick={() => doAction("execute")}
        className="rounded-md border px-2 py-1 text-xs hover:bg-accent disabled:opacity-50"
      >
        {pending === "execute" ? "Executing…" : "Execute"}
      </button>
      <button
        type="button"
        disabled={!!pending}
        onClick={() => doAction("retry")}
        className="rounded-md border px-2 py-1 text-xs hover:bg-accent disabled:opacity-50"
      >
        {pending === "retry" ? "Retrying…" : "Retry failed"}
      </button>
      {error ? <span className="max-w-[180px] truncate text-[11px] text-red-500" title={error}>{error}</span> : null}
      {success ? <span className="text-[11px] text-emerald-600 dark:text-emerald-400">{success}</span> : null}
    </div>
  );
}

export function WorkflowHistoryButton({ workflowId }: { workflowId: string }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [execs, setExecs] = useState<{ id: string; status?: string; startedAt?: string; stoppedAt?: string; mode?: string }[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/acquisition/workflows`, { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      const list: unknown[] = Array.isArray((json as { workflows?: unknown[] }).workflows) ? (json as { workflows: unknown[] }).workflows : [];
      const wf = list.find((w) => (w as { id: string }).id === workflowId) as { executions?: { id: string; status?: string; startedAt?: string; stoppedAt?: string; mode?: string }[] } | undefined;
      setExecs(wf?.executions ?? []);
      setOpen(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="inline-flex flex-col gap-1">
      <button type="button" onClick={load} disabled={loading} className="rounded border px-2 py-1 text-xs hover:bg-accent disabled:opacity-50">
        {loading ? "Loading…" : "History"}
      </button>
      {error ? <span className="text-[11px] text-red-500">{error}</span> : null}
      {open && execs ? (
        <div className="rounded-md border bg-muted/20 p-2 text-[11px]">
          <div className="mb-1 flex items-center justify-between">
            <span className="font-medium">Last {execs.length} executions</span>
            <button type="button" onClick={() => setOpen(false)} className="text-muted-foreground hover:text-foreground">✕</button>
          </div>
          {execs.length === 0 ? <p className="text-muted-foreground">No executions found.</p> : (
            <ul className="space-y-1">
              {execs.slice(0, 10).map((ex) => (
                <li key={ex.id} className="flex items-center justify-between gap-2 rounded border bg-card px-2 py-1">
                  <span className="font-mono">{ex.id.slice(0, 8)}</span>
                  <span className={ex.status === "success" ? "text-emerald-600" : ex.status === "failed" || ex.status === "error" ? "text-red-500" : "text-muted-foreground"}>{ex.status ?? "unknown"}</span>
                  <span className="text-muted-foreground">{ex.startedAt ? new Date(ex.startedAt).toLocaleString() : "—"}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
