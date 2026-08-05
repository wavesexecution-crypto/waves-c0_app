"use client";

import { useActionState } from "react";
import { signupAction, type SignupResult } from "@/lib/signup";
import { Button, Input } from "@wavesco/ui";

const initialState: SignupResult = { ok: false };

export function SignupForm() {
  const [state, formAction, isPending] = useActionState(signupAction, initialState);

  return (
    <form action={formAction} className="space-y-4">
      <div className="space-y-1">
        <label htmlFor="tenantName" className="text-sm font-medium">
          Business name
        </label>
        <Input id="tenantName" name="tenantName" required placeholder="Acme Cafe" autoComplete="organization" />
      </div>
      <div className="space-y-1">
        <label htmlFor="name" className="text-sm font-medium">
          Your name
        </label>
        <Input id="name" name="name" placeholder="Jane Doe" autoComplete="name" />
      </div>
      <div className="space-y-1">
        <label htmlFor="email" className="text-sm font-medium">
          Email
        </label>
        <Input id="email" name="email" type="email" required placeholder="owner@cafe.com" autoComplete="email" />
      </div>
      <div className="space-y-1">
        <label htmlFor="password" className="text-sm font-medium">
          Password
        </label>
        <Input
          id="password"
          name="password"
          type="password"
          required
          minLength={8}
          placeholder="8+ chars, upper, lower, digit"
          autoComplete="new-password"
        />
      </div>
      {state.error ? (
        <p role="alert" className="text-sm font-medium text-destructive">
          {state.error}
        </p>
      ) : null}
      <Button type="submit" className="w-full" disabled={isPending}>
        {isPending ? "Creating workspace…" : "Create workspace"}
      </Button>
    </form>
  );
}
