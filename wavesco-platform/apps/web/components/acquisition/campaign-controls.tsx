"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function CampaignControls({
  campaignId,
  status,
  campaignName,
}: {
  campaignId: string;
  status: string;
  campaignName: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function doAction(action: "launch" | "pause" | "resume" | "stop") {
    const confirmMessages: Record<string, string> = {
      launch: `Launch campaign "${campaignName}"?\n\nStatus will move draft → scheduled and become eligible for sending.`,
      pause: `Pause campaign "${campaignName}"?\n\nStatus running → paused. Sending will halt until resumed.`,
      resume: `Resume campaign "${campaignName}"?\n\nStatus paused → running.`,
      stop: `Stop campaign "${campaignName}"?\n\nStatus → stopped. This halts all sending. This is safe — the action is audit-logged.`,
    };
    const msg = confirmMessages[action] ?? `Confirm ${action}?`;
    if (typeof window !== "undefined" && !window.confirm(msg)) return;
    setPending(action);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch(`/api/acquisition/campaigns/${encodeURIComponent(campaignId)}/control`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) {
        // Prefer the server's next step / reason over a machine token such as
        // "entitlement_required" or "internal".
        const detail =
          typeof json.whatNext === "string"
            ? json.whatNext
            : typeof json.reason === "string"
              ? json.reason
              : typeof json.error === "string"
                ? json.error
                : `Failed ${res.status}`;
        throw new Error(detail);
      }
      const next = typeof json.status === "string" ? json.status : "ok";
      setSuccess(`${action.charAt(0).toUpperCase()}${action.slice(1)} — status is now ${next}.`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(null);
    }
  }

  const canLaunch = status === "draft";
  const canPause = status === "running";
  const canResume = status === "paused";
  const canStop = ["running", "paused", "scheduled"].includes(status);
  const noActions = !canLaunch && !canPause && !canResume && !canStop;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {canLaunch ? (
        <button
          type="button"
          disabled={!!pending}
          onClick={() => doAction("launch")}
          className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {pending === "launch" ? "Launching…" : "Launch"}
        </button>
      ) : null}
      {canPause ? (
        <button
          type="button"
          disabled={!!pending}
          onClick={() => doAction("pause")}
          className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-700 hover:bg-amber-500/20 disabled:opacity-50 dark:text-amber-300"
        >
          {pending === "pause" ? "Pausing…" : "Pause"}
        </button>
      ) : null}
      {canResume ? (
        <button
          type="button"
          disabled={!!pending}
          onClick={() => doAction("resume")}
          className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          {pending === "resume" ? "Resuming…" : "Resume"}
        </button>
      ) : null}
      {canStop ? (
        <button
          type="button"
          disabled={!!pending}
          onClick={() => doAction("stop")}
          className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-500/20 disabled:opacity-50 dark:text-red-300"
        >
          {pending === "stop" ? "Stopping…" : "Stop"}
        </button>
      ) : null}
      {/* Terminal/edge statuses used to render zero buttons and zero explanation. */}
      {noActions ? (
        <span className="text-[11px] text-muted-foreground">
          No status controls available while this campaign is{" "}
          <span className="font-mono">{status}</span>.
        </span>
      ) : null}
      {error ? (
        <span className="max-w-[220px] text-xs text-red-500" title={error}>
          {error}
        </span>
      ) : null}
      {success ? <span className="text-xs text-emerald-600 dark:text-emerald-400">{success}</span> : null}
    </div>
  );
}