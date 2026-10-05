"use client";

import { useActionState } from "react";
import {
  activatePaidAction,
  startTrialAction,
  transitionEntitlementAction,
  type EntitlementActionState,
} from "@/lib/actions/entitlement";

const empty: EntitlementActionState = { ok: false };

function Result({ state }: { state: EntitlementActionState }) {
  if (!state.error && !state.message) return null;
  return (
    <p className={`mt-2 text-sm ${state.ok ? "text-emerald-700" : "text-destructive"}`}>
      {state.ok ? state.message : state.error}
    </p>
  );
}

export function StartTrialButton({ canStart }: { canStart: boolean }) {
  const [state, formAction, pending] = useActionState(
    async () => startTrialAction(),
    empty,
  );
  if (!canStart) return null;
  return (
    <form action={formAction} className="mt-3">
      <button
        type="submit"
        disabled={pending}
        className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
      >
        {pending ? "Starting…" : "Start free trial"}
      </button>
      <Result state={state} />
    </form>
  );
}

export function RecordGrantForm() {
  const [state, formAction, pending] = useActionState(activatePaidAction, empty);
  return (
    <form action={formAction} className="mt-3 grid gap-2 text-sm">
      <p className="text-xs text-muted-foreground">
        Record access after Waves confirms payment off-band. The grant, reference and actor are written to the audit log.
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="grid gap-1">
          <span className="text-xs font-medium text-muted-foreground">Duration (days)</span>
          <input name="days" type="number" min={1} max={732} defaultValue={30} className="rounded-md border bg-background px-3 py-2" />
        </label>
        <label className="grid gap-1">
          <span className="text-xs font-medium text-muted-foreground">Payment reference (optional)</span>
          <input name="providerRef" type="text" maxLength={120} placeholder="UPI/transfer ref" className="rounded-md border bg-background px-3 py-2" />
        </label>
      </div>
      <input type="hidden" name="provider" value="manual" />
      <div>
        <button type="submit" disabled={pending} className="inline-flex items-center justify-center rounded-md border px-4 py-2 font-medium hover:bg-accent disabled:opacity-50">
          {pending ? "Recording…" : "Record paid access"}
        </button>
      </div>
      <Result state={state} />
    </form>
  );
}

export function TransitionButtons({ status }: { status: string }) {
  const [state, formAction, pending] = useActionState(transitionEntitlementAction, empty);
  const actions: { action: string; label: string }[] = [];
  if (status === "active" || status === "trial") actions.push({ action: "suspend", label: "Suspend" });
  if (status === "suspended") actions.push({ action: "resume", label: "Resume" });
  if (status === "expired") actions.push({ action: "renew", label: "Renew 30 days" });
  if (!["cancelled", "refunded"].includes(status)) actions.push({ action: "cancel", label: "Cancel" });
  if (actions.length === 0) return null;
  return (
    <form action={formAction} className="mt-3 flex flex-wrap items-center gap-2 text-sm">
      {actions[0]!.action === "renew" || actions.some((a) => a.action === "renew") ? <input type="hidden" name="days" value="30" /> : null}
      {actions.map((a) => (
        <button
          key={a.action}
          type="submit"
          name="action"
          value={a.action}
          disabled={pending}
          className="inline-flex items-center justify-center rounded-md border px-3 py-1.5 hover:bg-accent disabled:opacity-50"
        >
          {a.label}
        </button>
      ))}
      <Result state={state} />
    </form>
  );
}
