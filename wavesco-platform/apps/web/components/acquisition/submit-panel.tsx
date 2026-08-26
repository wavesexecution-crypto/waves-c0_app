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
    return <p className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-2 text-xs text-emerald-600 dark:text-emerald-400">{state.message}</p>;
  }

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => {
          setConfirming(true);
        }}
        disabled={eligible === 0}
        className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-40"
      >
        Prepare send
      </button>
    );
  }

  return (
    <form action={formAction} className="space-y-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3">
      <input type="hidden" name="campaignId" value={campaignId} />
      <input type="hidden" name="subject" value={`Quick intro — more customers for ${campaignName}`} />
      <textarea
        name="body"
        required
        minLength={20}
        defaultValue={"Hi there,\n\nWe help local businesses in your area bring in more customers through better online presence. Would you be open to a short chat this week?\n\n— WavesCo"}
        className="w-full rounded-md border bg-transparent p-2 font-mono text-xs"
        rows={6}
      />
      <label className="flex items-start gap-2 text-xs">
        <input type="checkbox" checked={acknowledged} onChange={(e) => { setAcknowledged(e.target.checked); }} className="mt-0.5 h-3.5 w-3.5" />
        Queue <strong>{eligible}</strong> email(s) into the existing Approval Queue (n8n → Email Outbox → SMTP).
        Nothing sends until each item is approved.
      </label>
      <div className="flex gap-2">
        <button type="submit" disabled={!acknowledged || pending} className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50">
          {pending ? "Submitting…" : "Confirm & queue"}
        </button>
        <button
          type="button"
          onClick={() => {
            setConfirming(false);
          }}
          className="rounded-md border px-3 py-1.5 text-xs hover:bg-accent"
        >
          Cancel
        </button>
      </div>
      {state.error ? <p className="text-xs text-red-500">{state.error}</p> : null}
    </form>
  );
}

export function DecideButtons({ outreachEmailId }: { outreachEmailId: string }) {
  const [, formAction, pending] = useActionState(decideOutreachEmailAction, initial);

  return (
    <form action={formAction} className="flex items-center gap-1">
      <input type="hidden" name="outreachEmailId" value={outreachEmailId} />
      <button
        type="submit"
        name="decision"
        value="approve"
        disabled={pending}
        className="rounded-md bg-emerald-600 px-2 py-1 text-[11px] font-medium text-white disabled:opacity-50"
      >
        {pending ? "…" : "Approve"}
      </button>
      <button
        type="submit"
        name="decision"
        value="reject"
        disabled={pending}
        className="rounded-md border px-2 py-1 text-[11px] text-muted-foreground hover:bg-accent disabled:opacity-50"
      >
        Reject
      </button>
    </form>
  );
}
