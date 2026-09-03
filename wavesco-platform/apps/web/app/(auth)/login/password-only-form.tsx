"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button, Input } from "@wavesco/ui";

export function PasswordOnlyForm({ email }: { email: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const password = typeof form.get("password") === "string" ? (form.get("password") as string) : "";
    setError(null);
    setIsPending(true);
    const result = await signIn("credentials", { email, password, redirect: false });
    setIsPending(false);
    if (result?.error) {
      setError("Incorrect password. Try again.");
      return;
    }
    const callbackUrl = searchParams.get("callbackUrl");
    let safe: string | null = null;
    if (callbackUrl) {
      if (callbackUrl.startsWith("/") && !callbackUrl.startsWith("//")) {
        safe = callbackUrl;
      } else {
        try {
          const dest = new URL(callbackUrl);
          const allowed = ["wavesco.in", "app.wavesco.in", "www.wavesco.in", "localhost", "127.0.0.1"];
          if (allowed.some((h) => dest.hostname === h || dest.hostname.endsWith("." + h))) {
            safe = callbackUrl;
          }
        } catch {}
      }
    }
    const dest = safe ?? "/overview";
    if (dest.startsWith("http")) {
      window.location.href = dest;
    } else {
      router.push(dest);
      router.refresh();
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-1">
        <label className="text-sm font-medium">Waves profile</label>
        <div className="rounded-md border bg-muted px-3 py-2 text-sm text-foreground">
          Your Waves profile is already connected.
          <div className="font-mono text-xs text-muted-foreground">{email}</div>
        </div>
        <p className="text-xs text-muted-foreground">Enter your password to continue.</p>
      </div>
      <div className="space-y-1">
        <label htmlFor="password" className="text-sm font-medium">
          Password
        </label>
        <Input id="password" name="password" type="password" required autoComplete="current-password" />
      </div>
      {error ? (
        <p role="alert" className="text-sm font-medium text-destructive">
          {error}
        </p>
      ) : null}
      <Button type="submit" className="w-full" disabled={isPending}>
        {isPending ? "Verifying…" : "Continue"}
      </Button>
    </form>
  );
}
