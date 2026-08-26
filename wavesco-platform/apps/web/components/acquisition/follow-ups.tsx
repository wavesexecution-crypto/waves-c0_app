"use client";

import { useActionState } from "react";
import {
  createFollowUpAction,
  updateFollowUpStatusAction,
  type ActionState,
} from "@/lib/actions/reports";

const initial: ActionState = { ok: false };

export function FollowUpForm() {
  const [state, formAction, pending] = useActionState(createFollowUpAction, initial);
  return (
    <form action={formAction} className="grid gap-3 rounded-lg border bg-card p-4 sm:grid-cols-4">
      <label className="text-xs text-muted-foreground">
        Business *
        <input name="business" required maxLength={120} className="mt-1 w-full rounded-md border bg-transparent px-2 py-1.5 text-sm" />
      </label>
      <label className="text-xs text-muted-foreground">
        Due date *
        <input name="dueAt" type="datetime-local" required className="mt-1 w-full rounded-md border bg-transparent px-2 py-1.5 text-sm" />
      </label>
      <label className="text-xs text-muted-foreground sm:col-span-2">
        Note
        <input name="note" maxLength={500} placeholder="what to check before pinging" className="mt-1 w-full rounded-md border bg-transparent px-2 py-1.5 text-sm" />
      </label>
      <div className="flex items-center gap-3 sm:col-span-4">
        <button type="submit" disabled={pending} className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50">
          {pending ? "Saving…" : "Schedule follow-up"}
        </button>
        {state.error ? <span className="text-xs text-red-500">{state.error}</span> : null}
        {state.ok ? <span className="text-xs text-emerald-600 dark:text-emerald-400">Created.</span> : null}
      </div>
    </form>
  );
}

export function FollowUpRowActions({ id, status }: { id: string; status: string }) {
  const [, formAction, pending] = useActionState(updateFollowUpStatusAction, initial);
  if (status !== "pending") return <span className="text-[11px] text-muted-foreground">{status}</span>;
  return (
    <form action={formAction} className="flex justify-end gap-1">
      <input type="hidden" name="followUpId" value={id} />
      <button
        type="submit"
        name="action"
        value="done"
        disabled={pending}
        className="rounded-md bg-emerald-600 px-2 py-1 text-[11px] font-medium text-white disabled:opacity-50"
      >
        Done
      </button>
      <button
        type="submit"
        name="action"
        value="cancel"
        disabled={pending}
        className="rounded-md border px-2 py-1 text-[11px] text-muted-foreground hover:bg-accent disabled:opacity-50"
      >
        Cancel
      </button>
    </form>
  );
}
