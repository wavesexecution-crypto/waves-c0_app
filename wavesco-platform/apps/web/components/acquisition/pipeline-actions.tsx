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
      className={`rounded-md border px-2 py-1 text-[11px] font-medium disabled:opacity-40 ${tones[tone]}`}
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

  return (
    <div className="flex flex-col items-end gap-1">
      {status === "READY_FOR_APPROVAL" ? (
        <form action={queue}>
          <input type="hidden" name="orderId" value={orderId} />
          <Btn label="Send to approval" busy={queuePending} disabled={queuePending} />
        </form>
      ) : null}
      {status === "PENDING" && !decided ? (
        <form action={decide} className="flex gap-1">
          <input type="hidden" name="orderId" value={orderId} />
          <button type="submit" name="decision" value="approve" disabled={decidePending} className="rounded-md bg-emerald-600 px-2 py-1 text-[11px] font-medium text-white disabled:opacity-50">
            {decidePending ? "…" : "Approve"}
          </button>
          <button type="submit" name="decision" value="reject" disabled={decidePending} className="rounded-md border px-2 py-1 text-[11px] hover:bg-accent disabled:opacity-50">
            Reject
          </button>
        </form>
      ) : null}
      {["READY_FOR_APPROVAL", "PENDING"].includes(status) ? (
        <form action={cancel}>
          <input type="hidden" name="orderId" value={orderId} />
          <Btn label="Cancel" tone="danger" busy={cancelPending} disabled={cancelPending} />
        </form>
      ) : null}
      {err ? <span className="max-w-[200px] break-words text-right text-[10px] text-red-500">{err}</span> : null}
      {!err && queueState.ok ? <span className="text-[10px] text-emerald-600">{queueState.message}</span> : null}
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
  const [batchCounts, setBatchCounts] = useState<BatchCountsView | null>(null);
  const [confirmQueue, setConfirmQueue] = useState(false);
  const [queueAck, setQueueAck] = useState(false);

  const runBatch = (label: string, fn: () => Promise<PipelineActionState>): void => {
    start(async () => {
      setResult(`${label}…`);
      const r = await fn();
      setResult(r.message ?? (r.ok ? "Done." : r.error ?? "Failed."));
      if (r.counts) setBatchCounts(r.counts);
    });
  };

  return (
    <div className="space-y-3 rounded-lg border bg-card p-4">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={pending || counts.researchable === 0}
          onClick={() => { runBatch("Researching", batchResearchAction); }}
          className="rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-accent disabled:opacity-40"
        >
          Research all eligible ({counts.researchable})
        </button>
        <button
          type="button"
          disabled={pending || counts.checkable === 0}
          onClick={() => { runBatch("Checking", batchCheckEmailsAction); }}
          className="rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-accent disabled:opacity-40"
        >
          Check all emails ({counts.checkable})
        </button>
        <button
          type="button"
          disabled={pending || counts.generatable === 0}
          onClick={() => { runBatch("Generating", batchGenerateOrdersAction); }}
          className="rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-accent disabled:opacity-40"
        >
          Generate all eligible outreach ({counts.generatable})
        </button>
        {counts.readyToQueue > 0 && !confirmQueue ? (
          <button
            type="button"
            disabled={pending}
            onClick={() => { setConfirmQueue(true); }}
            className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-40"
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
                const r = await batchQueueReadyOrdersAction(initial, fd);
                setResult(r.message ?? r.error ?? "Failed.");
                if (r.counts) setBatchCounts(r.counts);
                setConfirmQueue(false);
                setQueueAck(false);
              });
            }}
            className="flex flex-wrap items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-2"
          >
            <label className="flex items-center gap-1.5 text-xs">
              <input type="checkbox" checked={queueAck} onChange={(e) => { setQueueAck(e.target.checked); }} className="h-3.5 w-3.5" />
              Queue <strong>{counts.readyToQueue}</strong> into the existing Approval Queue — each still requires an individual approve before sending.
            </label>
            <button type="submit" disabled={!queueAck || pending} className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50">
              Confirm &amp; queue
            </button>
            <button type="button" onClick={() => { setConfirmQueue(false); }} className="rounded-md border px-3 py-1.5 text-xs hover:bg-accent">
              Cancel
            </button>
          </form>
        ) : null}
      </div>

      {result ? (
        <p className="text-xs text-muted-foreground">
          {result}
          {batchCounts ? (
            <span className="mt-1 block font-mono text-[10px]">
              processed {batchCounts.processed ?? 0} · researched {batchCounts.researched ?? 0} · verified{" "}
              {batchCounts.verifiedEmails ?? 0} · orders {batchCounts.ordersCreated ?? 0} · pending{" "}
              {batchCounts.awaitingApproval ?? 0} · sent {batchCounts.sent ?? 0} · failed {batchCounts.failed ?? 0} ·
              telegram {batchCounts.telegram ?? "—"} · obsidian {batchCounts.obsidian ? "logged" : "—"}
            </span>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}
