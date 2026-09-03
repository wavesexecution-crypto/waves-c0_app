"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button, Input } from "@wavesco/ui";

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  async function handleSubmit(event: React.ChangeEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setError(null);
    setIsPending(true);

    const emailValue = typeof form.get("email") === "string" ? form.get("email") : "";
    const passwordValue = typeof form.get("password") === "string" ? form.get("password") : "";
    const result = await signIn("credentials", {
      email: emailValue,
      password: passwordValue,
      redirect: false,
    });

    setIsPending(false);

    if (result.error) {
      setError("Invalid email or password.");
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
        <label htmlFor="email" className="text-sm font-medium">
          Email
        </label>
        <Input id="email" name="email" type="email" required placeholder="operator@wavesco.com" autoComplete="email" />
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
        {isPending ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}
