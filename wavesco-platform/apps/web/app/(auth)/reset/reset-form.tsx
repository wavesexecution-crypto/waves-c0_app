"use client";

import { useActionState } from "react";
import { Button, Input } from "@wavesco/ui";
import { requestPasswordReset, type ResetRequestResult } from "@/lib/reset";

const initialState: ResetRequestResult = { ok: false };

export function ResetForm() {
  const [state, formAction, isPending] = useActionState(requestPasswordReset, initialState);

  return (
    <form action={formAction} className="space-y-4">
      <div className="space-y-1">
        <label htmlFor="email" className="text-sm font-medium">
          Email
        </label>
        <Input id="email" name="email" type="email" required placeholder="owner@cafe.com" autoComplete="email" />
      </div>
      {state.error ? (
        <p role="alert" className="text-sm font-medium text-destructive">
          {state.error}
        </p>
      ) : null}
      {state.message ? (
        <p role="status" className="text-sm font-medium text-emerald-600 dark:text-emerald-400">
          {state.message}
        </p>
      ) : null}
      <Button type="submit" className="w-full" disabled={isPending}>
        {isPending ? "Sending…" : "Send reset instructions"}
      </Button>
    </form>
  );
}
