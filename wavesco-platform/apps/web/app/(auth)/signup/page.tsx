import type { Metadata } from "next";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@wavesco/ui";
import { SignupForm } from "./signup-form";

export const metadata: Metadata = {
  title: "Sign up",
};

export default function SignupPage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Create your Waves account</CardTitle>
        <CardDescription>One Waves account. All your products — including Acquisition OS when rented.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="mb-4 rounded-md border border-primary/20 bg-primary/5 p-3 text-xs leading-relaxed text-muted-foreground">
          <p className="font-medium text-foreground">Waves Account → Tenant → Products → Acquisition OS</p>
          <p>Your Waves profile gives you access to the products you own or rent.</p>
        </div>
        <SignupForm />
        <p className="mt-4 text-center text-sm text-muted-foreground">
          Already have an account?{" "}
          <Link href="/login" className="font-medium text-primary hover:underline">
            Continue with your Waves profile
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
