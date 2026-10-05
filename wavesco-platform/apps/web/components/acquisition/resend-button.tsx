"use client";

import { useActionState } from "react";
import { resendReportAction, type ActionState } from "@/lib/actions/reports";

const initial: ActionState = { ok: false };

export function ResendButton({ batchId }: { batchId: string }) {
  const [state, formAction, pending] = useActionState(resendReportAction, initial);
  return (
    <form action={formAction} className="inline-flex items-center gap-2">
      <input type="hidden" name="batchId" value={batchId} />
      <button
        type="submit"
        disabled={pending}
        // Sends the report to a third-party channel — confirm before doing it.
        onClick={(e) => {
          if (!window.confirm("Send this batch's PDF and spreadsheet to Telegram?")) e.preventDefault();
        }}
        className="rounded-lg border border-border/80 px-2 py-1 text-[11px] text-muted-foreground hover:bg-accent disabled:opacity-50"
      >
        {pending ? "Sending…" : "Send to Telegram"}
      </button>
      {state.error ? (
        <span className="max-w-[160px] truncate text-[11px] text-red-500" title={state.error}>
          {state.error}
        </span>
      ) : null}
      {state.ok ? <span className="text-[11px] text-emerald-600 dark:text-emerald-400">{state.message}</span> : null}
    </form>
  );
}
