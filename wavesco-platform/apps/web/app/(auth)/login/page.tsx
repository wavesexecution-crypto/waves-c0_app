import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@wavesco/ui";
import { LoginForm } from "./login-form";
import { auth } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Sign in",
};

export default async function LoginPage({ searchParams }: { searchParams?: { callbackUrl?: string } }) {
  const session = await auth();
  const email = (session as any)?.user?.email as string | undefined;
  const isRecognized = typeof email === "string" && email.length > 0;

  // If Waves profile already recognized via shared .wavesco.in cookie — no app sign-in needed
  if (isRecognized) {
    const cb = searchParams?.callbackUrl;
    let safe: string | null = null;
    if (cb) {
      if (cb.startsWith("/") && !cb.startsWith("//")) safe = cb;
      else {
        try {
          const dest = new URL(cb);
          const allowed = ["wavesco.in", "app.wavesco.in", "www.wavesco.in", "localhost", "127.0.0.1"];
          if (allowed.some((h) => dest.hostname === h || dest.hostname.endsWith("." + h))) safe = cb;
        } catch {}
      }
    }
    const dest = safe ?? "/overview";
    if (dest.startsWith("http")) redirect(dest);
    redirect(dest);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sign in to your Waves account</CardTitle>
        <CardDescription>Use your Waves credentials to access the app.</CardDescription>
      </CardHeader>
      <CardContent>
        <Suspense>
          <LoginForm />
        </Suspense>
      </CardContent>
    </Card>
  );
}
