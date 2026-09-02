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
          <CardDescription>Enter your password to continue to the app</CardDescription>
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

  // No recognized Waves profile — show local email+password login
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
        <p className="mt-4 text-center text-xs text-muted-foreground">
          Don&apos;t have an account?{" "}
          <Link href="https://wavesco.in/signup" className="font-medium text-primary hover:underline">
            Create one on Waves
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
