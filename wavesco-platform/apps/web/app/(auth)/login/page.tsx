import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@wavesco/ui";
import { LoginForm } from "./login-form";

export const metadata: Metadata = {
  title: "Sign in",
};

export default function LoginPage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Continue with your Waves profile</CardTitle>
        <CardDescription>
          Your Waves account is used across Waves. No separate login is required for Acquisition OS.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="mb-4 rounded-md border border-primary/20 bg-primary/5 p-3 text-xs leading-relaxed text-muted-foreground">
          <p className="font-medium text-foreground">One Waves account. All your products.</p>
          <p>Acquisition OS is operated through your Waves account. Sign in with your Waves profile to continue.</p>
        </div>
        <Suspense>
          <LoginForm />
        </Suspense>
        <p className="mt-4 text-center text-sm text-muted-foreground">
          No account yet?{" "}
          <Link href="/signup" className="font-medium text-primary hover:underline">
            Create a workspace on Waves
          </Link>
        </p>
        <p className="mt-3 text-center text-xs text-muted-foreground">
          Login happens on the main Waves site. app.wavesco.in does not have an independent customer login.
        </p>
      </CardContent>
    </Card>
  );
}
