import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@wavesco/ui";
import { LoginForm } from "./login-form";
import { PasswordOnlyForm } from "./password-only-form";
import { auth } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Sign in",
};

export default async function LoginPage() {
  const session = await auth();
  const email = (session as any)?.user?.email as string | undefined;
  const isRecognized = typeof email === "string" && email.length > 0;

  // If Waves profile is already recognized via shared .wavesco.in cookie, ask ONLY for password
  if (isRecognized) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Your Waves profile is already connected</CardTitle>
          <CardDescription>Enter your password to continue to app.wavesco.in</CardDescription>
        </CardHeader>
        <CardContent>
          <Suspense>
            <PasswordOnlyForm email={email!} />
          </Suspense>
          <p className="mt-3 text-center text-xs text-muted-foreground">
            One Waves account. No separate login is required.
          </p>
        </CardContent>
      </Card>
    );
  }

  // No recognized Waves profile — send to main site
  const wavesMain = process.env.WAVES_MAIN_URL || "https://wavesco.in";
  return (
    <Card>
      <CardHeader>
        <CardTitle>Continue with your Waves profile</CardTitle>
        <CardDescription>Your Waves account is used across Waves. No separate login is required for Acquisition OS.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="mb-4 rounded-md border border-primary/20 bg-primary/5 p-3 text-xs leading-relaxed text-muted-foreground">
          <p className="font-medium text-foreground">Waves Account → Tenant → Products → Acquisition OS</p>
          <p>Continue to Waves to access your account.</p>
        </div>
        <a
          href={`${wavesMain}/login`}
          className="inline-flex w-full items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          Continue to Waves
        </a>
        <p className="mt-3 text-center text-xs text-muted-foreground">No recognized Waves profile. Continue on Waves to sign in again.</p>
        <div className="mt-6 border-t pt-4">
          <p className="text-center text-xs text-muted-foreground">Or sign in directly (local dev):</p>
          <Suspense>
            <LoginForm />
          </Suspense>
        </div>
      </CardContent>
    </Card>
  );
}
