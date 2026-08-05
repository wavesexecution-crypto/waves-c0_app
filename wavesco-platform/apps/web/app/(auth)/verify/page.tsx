import type { Metadata } from "next";
import { MailCheck } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@wavesco/ui";

export const metadata: Metadata = {
  title: "Check your email",
};

export default function VerifyPage() {
  return (
    <Card>
      <CardHeader className="items-center text-center">
        <div className="mb-2 rounded-full bg-muted p-3">
          <MailCheck className="h-6 w-6 text-muted-foreground" />
        </div>
        <CardTitle>Verify your email</CardTitle>
        <CardDescription>
          If your account has an unverified email, a verification link was sent to your inbox.
        </CardDescription>
      </CardHeader>
      <CardContent className="text-center text-sm text-muted-foreground">
        <p>
          Credential-based signup marks your email verified immediately. Magic-link signup verifies
          you by opening the emailed link.
        </p>
      </CardContent>
    </Card>
  );
}
