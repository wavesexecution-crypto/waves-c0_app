"use client";

import { useActionState } from "react";
import { updateLeadOutreachAction, type ActionState } from "@/lib/actions/acquisition";

const initial: ActionState = { ok: false };

export function LeadOutreachForm({
  nameKey,
  emailStatus,
  optedOut,
  bounced,
  replyStatus,
  contacted,
}: {
  nameKey: string;
  emailStatus: string | null;
  optedOut: boolean;
  bounced: boolean;
  replyStatus: string | null;
  contacted: boolean;
}) {
  const [state, formAction, pending] = useActionState(updateLeadOutreachAction, initial);

  return (
    <form action={formAction} className="rounded-lg border bg-card p-4">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-widest text-muted-foreground">
        Outreach state · writes back to lead database
      </h2>
      <input type="hidden" name="nameKey" value={nameKey} />

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-xs text-muted-foreground">
          Email verification
          <select name="emailStatus" defaultValue={emailStatus ?? ""} className="mt-1 w-full rounded-md border bg-transparent px-2 py-1.5 text-sm">
            <option value="">unmarked</option>
            <option value="Verified">Verified</option>
            <option value="Unverified">Unverified</option>
            <option value="Invalid">Invalid</option>
          </select>
        </label>

        <label className="text-xs text-muted-foreground">
          Reply status
          <input
            name="replyStatus"
            defaultValue={replyStatus ?? ""}
            placeholder='e.g. "replied — interested"'
            className="mt-1 w-full rounded-md border bg-transparent px-2 py-1.5 text-sm"
          />
        </label>

        <label className="flex items-center gap-2 pt-4 text-sm">
          <input type="checkbox" name="optedOut" value="true" defaultChecked={optedOut} className="h-4 w-4" />
          Opted out (never email again)
        </label>

        <label className="flex items-center gap-2 pt-4 text-sm">
          <input type="checkbox" name="bounced" value="true" defaultChecked={bounced} className="h-4 w-4" />
          Bounced
        </label>
      </div>

      <p className="mt-3 text-[11px] text-muted-foreground">
        Contacted marker: {contacted ? "yes" : "no"} — set automatically when a campaign queues an email.
      </p>

      <div className="mt-3 flex items-center gap-3">
        <button type="submit" disabled={pending} className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50">
          {pending ? "Saving…" : "Save to engine DB"}
        </button>
        {state.error ? <span className="text-xs text-red-500">{state.error}</span> : null}
        {state.ok && state.message ? <span className="text-xs text-emerald-600 dark:text-emerald-400">{state.message}</span> : null}
      </div>
    </form>
  );
}
