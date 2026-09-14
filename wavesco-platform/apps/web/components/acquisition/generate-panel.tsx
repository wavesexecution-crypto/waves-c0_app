"use client";

import { useActionState, useEffect, useState } from "react";
import {
  generateLeadsAction,
  getGenerationStatusAction,
  type ActionState,
  type GenerationStatus,
} from "@/lib/actions/acquisition";

const initial: ActionState = { ok: false };

const STAGES: { key: string; label: string }[] = [
  { key: "queued", label: "Queued" },
  { key: "researching", label: "Researching" },
  { key: "verifying", label: "Verifying" },
  { key: "scoring", label: "Scoring" },
  { key: "generating_report", label: "Generating report" },
  { key: "completed", label: "Completed" },
];

function stageIndex(stage: string | null, status: string): number {
  if (status === "completed") return STAGES.length - 1;
  if (status === "failed") return -1;
  const i = STAGES.findIndex((s) => s.key === stage);
  return i === -1 ? 0 : i;
}

export function GeneratePanel({ lastRequestId }: { lastRequestId: string | null }) {
  const [state, formAction, pending] = useActionState(generateLeadsAction, initial);
  const [trackingId, setTrackingId] = useState<string | null>(lastRequestId);
  const [status, setStatus] = useState<GenerationStatus | null>(null);

  useEffect(() => {
    if (state.ok && state.message) {
      setTrackingId(state.message);
    }
  }, [state]);

  useEffect(() => {
    if (!trackingId) return;
    let cancelled = false;
    const poll = async (): Promise<void> => {
      try {
        const s = await getGenerationStatusAction(trackingId);
        if (!cancelled) setStatus(s);
        if (s && (s.status === "completed" || s.status === "failed")) return; // stop polling
      } catch {
        // transient — keep polling
      }
      if (!cancelled) {
        setTimeout(() => {
          void poll();
        }, 5000);
      }
    };
    void poll();
    return () => {
      cancelled = true;
    };
  }, [trackingId]);

  const running = status ? status.status === "running" || status.status === "queued" : Boolean(trackingId);
  const currentIdx = status ? stageIndex(status.stage, status.status) : trackingId ? 0 : -1;

  return (
    <div className="space-y-5">
      <form action={formAction} className="rounded-lg border bg-card p-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs text-muted-foreground">
            New leads to research
            <input
              name="requestedCount"
              type="number"
              min={1}
              max={60}
              defaultValue={10}
              className="mt-1 block w-32 rounded-md border bg-transparent px-2 py-1.5 text-sm"
            />
          </label>
          <button
            type="submit"
            disabled={pending || running}
            className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {pending ? "Starting…" : running ? "Engine is running…" : "Generate leads"}
          </button>
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          Finds new prospects, researches them, and scores fit — usually in a few minutes.
        </p>
        {state.error ? <p className="mt-2 text-xs text-red-500">{state.error}</p> : null}
        {state.ok && !trackingId ? <p className="mt-2 text-xs text-emerald-600">Queued.</p> : null}
      </form>

      {trackingId ? (
        <div className="space-y-3 rounded-lg border bg-card p-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium">
              Batch <span className="font-mono text-xs">{trackingId}</span>
            </h3>
            <span className="text-xs text-muted-foreground">
              {status?.status ?? "starting…"}
            </span>
          </div>

          <ol className="grid gap-2 sm:grid-cols-6">
            {STAGES.map((s, i) => (
              <li
                key={s.key}
                className={`rounded-md border px-2 py-1.5 text-center text-xs ${
                  i < currentIdx
                    ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                    : i === currentIdx
                      ? "border-sky-500/40 bg-sky-500/10 text-sky-600 dark:text-sky-400"
                      : "text-muted-foreground/60"
                }`}
              >
                {i < currentIdx ? "✓ " : ""}
                {s.label}
              </li>
            ))}
          </ol>

          {status?.error ? (
            <p className="rounded-md border border-red-500/30 bg-red-500/5 p-2 text-xs text-red-500">This research run hit a problem — please try again. Your workspace is safe.</p>
          ) : null}

          {status?.status === "completed" ? (
            <div className="text-sm">
              <p className="text-emerald-600 dark:text-emerald-400">
                Done — {status.resultLeadCount ?? "?"} new leads,{" "}
                {status.emailReadyCount ?? "?"} ready to contact.
              </p>
              <div className="mt-2 flex gap-2 text-xs">
                {status.pdfPath ? (
                  <a className="rounded border px-2 py-1 hover:bg-accent" href={`/api/reports/${status.engineBatchId}/file?type=pdf`}>
                    Download PDF
                  </a>
                ) : null}
                {status.excelPath ? (
                  <a className="rounded border px-2 py-1 hover:bg-accent" href={`/api/reports/${status.engineBatchId}/file?type=xlsx`}>
                    Download Excel
                  </a>
                ) : null}
                <a className="rounded border px-2 py-1 hover:bg-accent" href="/acquisition/reports">
                  Reports →
                </a>
              </div>
            </div>
          ) : null}

          {status?.logTail ? (
            <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-md bg-muted/60 p-2 font-mono text-[10px] leading-relaxed text-muted-foreground">
              {status.logTail}
            </pre>
          ) : (
            <p className="text-xs text-muted-foreground">Waiting for engine log output…</p>
          )}
        </div>
      ) : null}
    </div>
  );
}
