"use client";

import { useActionState, useState } from "react";
import {
  submitCampaignAction,
  decideOutreachEmailAction,
  type ActionState,
} from "@/lib/actions/campaigns";

const initial: ActionState = { ok: false };

export function CampaignSubmitPanel({
  campaignId,
  campaignName,
  eligible,
}: {
  campaignId: string;
  campaignName: string;
  eligible: number;
}) {
  const [state, formAction, pending] = useActionState(submitCampaignAction, initial);
  const [confirming, setConfirming] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);

  if (state.ok) {
    return <p className="rounded-lg border border-border/80 border-emerald-500/30 bg-emerald-500/5 p-2 text-xs text-emerald-600 dark:text-emerald-400">{state.message}</p>;
  }

  if (!confirming) {
    // A greyed button with no reason is a dead end. Say why it is unavailable.
    if (eligible === 0) {
      return (
        <p className="text-xs text-muted-foreground">
          No eligible leads for this segment — widen the campaign filters and reload.
        </p>
      );
    }
    return (
      <button
        type="button"
        onClick={() => {
          setConfirming(true);
        }}
        className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground"
      >
        Prepare send
      </button>
    );
  }

  return (
    <form action={formAction} className="space-y-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3">
      <input type="hidden" name="campaignId" value={campaignId} />
      {/* The subject was a hidden hardcoded string, so every campaign shipped
          identical copy with no way to edit it before real recipients. */}
      <label className="block text-xs text-muted-foreground">
        Subject *
        <input
          name="subject"
          required
          minLength={3}
          maxLength={200}
          defaultValue={`Quick intro — more customers for ${campaignName}`}
          className="mt-1 w-full rounded-lg border border-border/80 bg-transparent p-2 font-sans text-[13px]"
        />
      </label>
      <label className="block text-xs text-muted-foreground">
        Body *
        <textarea
          name="body"
          required
          minLength={20}
          defaultValue={"Hi there,\n\nWe help local businesses in your area bring in more customers through better online presence. Would you be open to a short chat this week?\n\n— WavesCo"}
          className="mt-1 w-full rounded-lg border border-border/80 bg-transparent p-2 font-mono text-xs"
          rows={6}
        />
      </label>
      <label className="flex items-start gap-2 text-xs">
        <input type="checkbox" checked={acknowledged} onChange={(e) => { setAcknowledged(e.target.checked); }} className="mt-0.5 h-3.5 w-3.5" />
        Queue <strong>{eligible}</strong> email(s) for approval.
        Nothing sends until each item is approved.
      </label>
      <div className="flex gap-2">
        <button type="submit" disabled={!acknowledged || pending} className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50">
          {pending ? "Submitting…" : "Confirm & queue"}
        </button>
        <button
          type="button"
          onClick={() => {
            setConfirming(false);
          }}
          className="rounded-lg border border-border/80 px-3 py-1.5 text-xs hover:bg-accent"
        >
          Cancel
        </button>
      </div>
      {state.error ? <p className="text-xs text-red-500">{state.error}</p> : null}
    </form>
  );
}

export function DecideButtons({
  outreachEmailId,
  recipient,
  subject,
}: {
  outreachEmailId: string;
  recipient?: string | null;
  subject?: string | null;
}) {
  // The action state was previously discarded, so a rejected approval webhook
  // produced no feedback whatsoever and the row looked unchanged.
  const [state, formAction, pending] = useActionState(decideOutreachEmailAction, initial);

  return (
    <form action={formAction} className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-1">
        <input type="hidden" name="outreachEmailId" value={outreachEmailId} />
        <button
          type="submit"
          name="decision"
          value="approve"
          disabled={pending}
          // Approving dispatches a real email immediately and there is no undo.
          onClick={(e) => {
            if (
              !window.confirm(
                `Approve and send this email${recipient ? ` to ${recipient}` : ""}?${
                  subject ? `\n\nSubject: ${subject}` : ""
                }\n\nIt is sent immediately and cannot be unsent.`
              )
            ) {
              e.preventDefault();
            }
          }}
          className="rounded-lg bg-emerald-600 px-2 py-1 text-[11px] font-medium text-white disabled:opacity-50"
        >
          {pending ? "…" : "Approve"}
        </button>
        <button
          type="submit"
          name="decision"
          value="reject"
          disabled={pending}
          onClick={(e) => {
            if (!window.confirm(`Reject this email${recipient ? ` to ${recipient}` : ""}? It will not be sent.`)) {
              e.preventDefault();
            }
          }}
          className="rounded-lg border border-border/80 px-2 py-1 text-[11px] text-muted-foreground hover:bg-accent disabled:opacity-50"
        >
          Reject
        </button>
      </div>
      {state.error ? (
        <span className="max-w-[200px] text-left text-[10px] text-red-500" title={state.error}>
          {state.error}
        </span>
      ) : null}
      {state.ok && state.message ? (
        <span className="max-w-[200px] text-left text-[10px] text-emerald-600 dark:text-emerald-400" title={state.message}>
          {state.message}
        </span>
      ) : null}
    </form>
  );
}