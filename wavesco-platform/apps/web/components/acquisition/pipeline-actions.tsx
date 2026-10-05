"use client";

import { useActionState, useState, useTransition } from "react";
import {
  batchCheckEmailsAction,
  batchGenerateOrdersAction,
  batchQueueReadyOrdersAction,
  batchResearchAction,
  cancelOrderAction,
  checkLeadEmailAction,
  decideOrderAction,
  generateOutreachOrderAction,
  reconcileNowAction,
  researchLeadAction,
  submitOrderAction,
  type PipelineActionState,
} from "@/lib/actions/pipeline";

const initial: PipelineActionState = { ok: false };

function Btn({
  label,
  busy,
  tone = "default",
  disabled,
}: {
  label: string;
  busy?: boolean;
  tone?: "default" | "approve" | "danger";
  disabled?: boolean;
}) {
  const tones = {
    default: "border hover:bg-accent",
    approve: "bg-emerald-600 text-white hover:bg-emerald-500 border-transparent",
    danger: "border-red-500/40 text-red-600 dark:text-red-400 hover:bg-red-500/10",
  } as const;
  return (
    <button
      type="submit"
      disabled={disabled ?? busy}
      className={`rounded-lg border border-border/80 px-2 py-1 text-[11px] font-medium disabled:opacity-40 ${tones[tone]}`}
    >
      {busy ? "…" : label}
    </button>
  );
}

/** Row-level one-click stage buttons for a single lead. */
export function LeadStageButtons({ nameKey }: { nameKey: string }) {
  const [researchState, research, researchPending] = useActionState(researchLeadAction, initial);
  const [checkState, check, checkPending] = useActionState(checkLeadEmailAction, initial);
  const [genState, gen, genPending] = useActionState(generateOutreachOrderAction, initial);

  return (
    <div className="flex flex-col items-end gap-1">
      <form action={research}>
        <input type="hidden" name="nameKey" value={nameKey} />
        <Btn label="Research" busy={researchPending} disabled={researchPending} />
      </form>
      <form action={check}>
        <input type="hidden" name="nameKey" value={nameKey} />
        <Btn label="Check email" busy={checkPending} disabled={checkPending} />
      </form>
      <form action={gen}>
        <input type="hidden" name="nameKey" value={nameKey} />
        <Btn label="Generate outreach" busy={genPending} disabled={genPending} />
      </form>
      {[researchState.error, checkState.error, genState.error].some(Boolean) ? (
        <span className="max-w-[180px] break-words text-right text-[10px] text-red-500">
          {[researchState.error, checkState.error, genState.error].find(Boolean)}
        </span>
      ) : null}
      {/* Success was previously not rendered at all: clicking "Research" gave
          no feedback whatsoever. */}
      {[researchState, checkState, genState].some((s) => s.ok && s.message) ? (
        <span className="max-w-[180px] break-words text-right text-[10px] text-emerald-600 dark:text-emerald-400">
          {[researchState, checkState, genState].find((s) => s.ok && s.message)?.message}
        </span>
      ) : null}
    </div>
  );
}

/** Order lifecycle buttons: queue → approve/reject/cancel. */
export function OrderButtons({
  orderId,
  status,
  decided,
}: {
  orderId: string;
  status: string;
  decided: boolean;
}) {
  const [queueState, queue, queuePending] = useActionState(submitOrderAction, initial);
  const [decideState, decide, decidePending] = useActionState(decideOrderAction, initial);
  const [cancelState, cancel, cancelPending] = useActionState(cancelOrderAction, initial);

  const err = queueState.error ?? decideState.error ?? cancelState.error;
  // Only `queueState` success used to render, so a completed Approve or Cancel
  // left the row looking untouched.
  const done = !err ? (queueState.ok ? queueState.message : decideState.ok ? decideState.message : cancelState.ok ? cancelState.message : null) : null;

  return (
    <div className="flex flex-col items-end gap-1">
      {status === "READY_FOR_APPROVAL" ? (
        <form action={queue}>
          <input type="hidden" name="orderId" value={orderId} />
          <Btn
            label="Send to approval"
            busy={queuePending}
            disabled={queuePending}
          />
        </form>
      ) : null}
      {status === "PENDING" && !decided ? (
        <form action={decide} className="flex gap-1">
          <input type="hidden" name="orderId" value={orderId} />
          <button
            type="submit"
            name="decision"
            value="approve"
            disabled={decidePending}
            onClick={(e) => {
              if (!window.confirm("Approve this order? The email is dispatched immediately and cannot be unsent.")) {
                e.preventDefault();
              }
            }}
            className="rounded-lg bg-emerald-600 px-2 py-1 text-[11px] font-medium text-white disabled:opacity-50"
          >
            {decidePending ? "…" : "Approve"}
          </button>
          <button
            type="submit"
            name="decision"
            value="reject"
            disabled={decidePending}
            onClick={(e) => {
              if (!window.confirm("Reject this order? It will not be sent.")) e.preventDefault();
            }}
            className="rounded-lg border border-border/80 px-2 py-1 text-[11px] hover:bg-accent disabled:opacity-50"
          >
            Reject
          </button>
        </form>
      ) : null}
      {["READY_FOR_APPROVAL", "PENDING"].includes(status) ? (
        <form action={cancel}>
          <input type="hidden" name="orderId" value={orderId} />
          <Btn
            label="Cancel"
            tone="danger"
            busy={cancelPending}
            disabled={cancelPending}
          />
        </form>
      ) : null}
      {err ? (
        <span className="max-w-[200px] break-words text-right text-[10px] text-red-500" title={err}>
          {err}
        </span>
      ) : null}
      {!err && done ? (
        <span className="max-w-[200px] break-words text-right text-[10px] text-emerald-600 dark:text-emerald-400" title={done}>
          {done}
        </span>
      ) : null}
    </div>
  );
}

interface BatchCountsView {
  processed?: number;
  researched?: number;
  verifiedEmails?: number;
  ordersCreated?: number;
  awaitingApproval?: number;
  sent?: number;
  failed?: number;
  telegram?: string;
  obsidian?: boolean;
}

/** Batch one-click actions with explicit confirmation for queueing. */
export function BatchPanel({
  counts,
}: {
  counts: { researchable: number; checkable: number; generatable: number; readyToQueue: number };
}) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<string | null>(null);
  const [resultOk, setResultOk] = useState(true);
  const [batchCounts, setBatchCounts] = useState<BatchCountsView | null>(null);
  const [confirmQueue, setConfirmQueue] = useState(false);
  const [queueAck, setQueueAck] = useState(false);

  // `message` is populated even on failure (e.g. "Queued 0/12 order(s)"), and
  // it was rendered in muted grey — a failed batch looked successful. Also add
  // a try/catch: a throw used to leave the label stuck on "Researching…".
  const runBatch = (label: string, fn: () => Promise<PipelineActionState>): void => {
    start(async () => {
      setResult(`${label}…`);
      try {
        const r = await fn();
        setResultOk(r.ok);
        setResult(r.ok ? (r.message ?? "Done.") : `✗ ${r.error ?? r.message ?? "Failed."}`);
        if (r.counts) setBatchCounts(r.counts);
      } catch (e) {
        setResultOk(false);
        setResult(`✗ ${e instanceof Error ? e.message : String(e)}`);
      }
    });
  };

  return (
    <div className="space-y-3 rounded-lg border border-border/80 bg-card p-4">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={pending}
          title="Reconcile delivery status, sync replies/bounces, evaluate follow-ups. Same job the scheduler runs every 15 minutes — safe to run manually any time."
          onClick={() => { runBatch("Syncing delivery & replies", async () => reconcileNowAction(initial, new FormData())); }}
          className="rounded-lg border border-border/80 px-3 py-1.5 text-xs font-medium hover:bg-accent disabled:opacity-40"
        >
          Sync delivery & replies
        </button>
        <button
          type="button"
          disabled={pending || counts.researchable === 0}
          title={counts.researchable === 0 ? "No leads are waiting to be researched." : undefined}
          onClick={() => { runBatch("Researching", batchResearchAction); }}
          className="rounded-lg border border-border/80 px-3 py-1.5 text-xs font-medium hover:bg-accent disabled:opacity-40"
        >
          Research all eligible ({counts.researchable})
        </button>
        <button
          type="button"
          disabled={pending || counts.checkable === 0}
          title={counts.checkable === 0 ? "No leads are waiting for an email check." : undefined}
          onClick={() => { runBatch("Checking", batchCheckEmailsAction); }}
          className="rounded-lg border border-border/80 px-3 py-1.5 text-xs font-medium hover:bg-accent disabled:opacity-40"
        >
          Check all emails ({counts.checkable})
        </button>
        <button
          type="button"
          disabled={pending || counts.generatable === 0}
          title={counts.generatable === 0 ? "No researched leads are ready for outreach." : undefined}
          onClick={() => { runBatch("Generating", batchGenerateOrdersAction); }}
          className="rounded-lg border border-border/80 px-3 py-1.5 text-xs font-medium hover:bg-accent disabled:opacity-40"
        >
          Generate all eligible outreach ({counts.generatable})
        </button>
        {/* Previously the primary action simply vanished when nothing was ready,
            leaving four unexplained greyed buttons. */}
        {counts.readyToQueue === 0 && !confirmQueue ? (
          <span className="text-[11px] text-muted-foreground">
            Nothing is ready to queue — research and check emails first.
          </span>
        ) : null}
        {counts.readyToQueue > 0 && !confirmQueue ? (
          <button
            type="button"
            disabled={pending}
            onClick={() => { setConfirmQueue(true); }}
            className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-40"
          >
            Send {counts.readyToQueue} ready order(s) to approval…
          </button>
        ) : null}
        {confirmQueue ? (
          <form
            action={(fd) => {
              fd.set("confirm", "yes");
              start(async () => {
                setResult("Queueing…");
                try {
                  const r = await batchQueueReadyOrdersAction(initial, fd);
                  setResultOk(r.ok);
                  setResult(r.ok ? (r.message ?? "Done.") : `✗ ${r.error ?? r.message ?? "Failed."}`);
                  if (r.counts) setBatchCounts(r.counts);
                } catch (e) {
                  setResultOk(false);
                  setResult(`✗ ${e instanceof Error ? e.message : String(e)}`);
                }
                setConfirmQueue(false);
                setQueueAck(false);
              });
            }}
            className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-2"
          >
            <label className="flex items-center gap-1.5 text-xs">
              <input type="checkbox" checked={queueAck} onChange={(e) => { setQueueAck(e.target.checked); }} className="h-3.5 w-3.5" />
              Queue <strong>{counts.readyToQueue}</strong> into the existing Approval Queue — each still requires an individual approve before sending.
            </label>
            <button type="submit" disabled={!queueAck || pending} className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50">
              Confirm &amp; queue
            </button>
            <button type="button" onClick={() => { setConfirmQueue(false); }} className="rounded-lg border border-border/80 px-3 py-1.5 text-xs hover:bg-accent">
              Cancel
            </button>
          </form>
        ) : null}
      </div>

      {result ? (
        <p
          className={`font-sans text-[13px] leading-5 ${resultOk ? "text-muted-foreground" : "text-red-500"}`}
        >
          {result}
          {batchCounts ? (
            <span className="mt-1 block font-mono text-[10px]">
              processed {batchCounts.processed ?? 0} · researched {batchCounts.researched ?? 0} · verified{" "}
              {batchCounts.verifiedEmails ?? 0} · orders {batchCounts.ordersCreated ?? 0} · pending{" "}
              {batchCounts.awaitingApproval ?? 0} · sent {batchCounts.sent ?? 0} · failed {batchCounts.failed ?? 0} ·
              telegram {batchCounts.telegram ?? "—"} · obsidian {batchCounts.obsidian ? "logged" : "not logged"}
            </span>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}
