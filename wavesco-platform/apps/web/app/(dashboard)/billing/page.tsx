import type { Metadata } from "next";
import { auth } from "@/lib/auth";
import { withTenantContext } from "@wavesco/db";
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@wavesco/ui";
import { requireTenantId } from "@/lib/tenant";

export const metadata: Metadata = {
  title: "Billing",
};

export default async function BillingPage() {
  const session = await auth();
  const tenantId = requireTenantId(session);

  const data = await withTenantContext(tenantId, async (tx) =>
    tx.tenant.findUnique({
      where: { id: tenantId },
      select: { plan: true, status: true },
    }),
  );

  const billingEnabled = process.env.ENABLE_BILLING === "true";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Billing</h1>
        <p className="text-sm text-muted-foreground">
          Plan and invoice information for your workspace.
        </p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Current plan</CardTitle>
            <Badge>{data?.plan ?? "starter"}</Badge>
          </div>
          <CardDescription>
            Status: <span className="font-medium">{data?.status ?? "active"}</span>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            {billingEnabled
              ? "Billing is enabled. Invoices will appear here."
              : "Billing is currently mocked (ENABLE_BILLING=false). Real invoices land here in a later release."}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Invoices</CardTitle>
          <CardDescription>No invoices have been issued yet.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-lg border border-dashed p-8 text-center">
            <p className="text-sm text-muted-foreground">You have no invoices.</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
