import type { Metadata } from "next";
import { auth } from "@/lib/auth";
import { withTenantContext } from "@wavesco/db";
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@wavesco/ui";
import { requireTenantId } from "@/lib/tenant";
import { getAcquisitionOSEntitlement, hasAccess } from "@/lib/wavesco/entitlements";
import { RecordGrantForm, StartTrialButton, TransitionButtons } from "@/components/billing/entitlement-forms";
import { CheckoutLeaseGrid } from "@/components/billing/checkout";
import { PUBLIC_LEASES } from "@/lib/wavesco/pricing";
import { isRazorpayConfigured } from "@/lib/razorpay";

export const metadata: Metadata = {
  title: "Billing",
};

export const dynamic = "force-dynamic";

const STATUS_COPY: Record<string, string> = {
  trial: "Trial — full access while the trial runs. Complete onboarding to get value from it.",
  active: "Active — your Acquisition OS is rented and operational.",
  expired: "Expired — the OS is read-only-blocked until you renew. Your data is preserved.",
  suspended: "Suspended — contact Waves to restore access.",
  cancelled: "Cancelled — access revoked. Your data is preserved.",
  refunded: "Refunded — access revoked.",
  inactive: "Inactive — no usable grant.",
  not_configured: "No grant yet — start a trial or record paid access.",
};

export default async function BillingPage() {
  const session = await auth();
  const tenantId = requireTenantId(session);
  const role = ((session as any)?.user?.role as string) ?? "member";
  const isOwner = role === "owner";
  const canTrial = role === "owner" || role === "admin";

  const data = await withTenantContext(tenantId, async (tx) =>
    tx.tenant.findUnique({
      where: { id: tenantId },
      select: { plan: true, status: true },
    }),
  );

  const entitlement = await getAcquisitionOSEntitlement(tenantId);
  const access = hasAccess(entitlement.status);

  let orders: any[] = [];
  try {
    orders = await withTenantContext(tenantId, async (tx: any) =>
      tx.acquisitionOrder.findMany({ where: { tenantId }, orderBy: { createdAt: "desc" }, take: 20 }),
    );
  } catch {
    orders = [];
  }

  const canStartTrial = canTrial && (entitlement.status === "not_configured" || entitlement.status === "inactive");
  const paymentsEnabled = isRazorpayConfigured();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">Workspace</p>
          <h1 className="mt-1 font-display text-[22px] font-semibold tracking-[-0.02em] text-foreground">Billing</h1>
          <p className="mt-1.5 max-w-2xl font-sans text-[13px] leading-5 text-muted-foreground">
          Plan and access for your workspace. Access state is authoritative — expiry blocks the product, renewal restores it.
        </p>
      </div>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Acquisition OS access</CardTitle>
            <Badge>{entitlement.status.replace("_", " ")}</Badge>
          </div>
          <CardDescription>
            {STATUS_COPY[entitlement.status] ?? entitlement.reason}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            <div><dt className="text-muted-foreground">Status</dt><dd className="font-medium">{entitlement.status}{access ? " · access granted" : " · blocked"}</dd></div>
            <div><dt className="text-muted-foreground">Reason</dt><dd>{entitlement.reason}</dd></div>
            {entitlement.trialExpiresAt && (
              <div><dt className="text-muted-foreground">Trial ends</dt><dd>{new Date(entitlement.trialExpiresAt).toLocaleString()}</dd></div>
            )}
            {entitlement.startedAt && (
              <div><dt className="text-muted-foreground">Access started</dt><dd>{new Date(entitlement.startedAt).toLocaleString()}</dd></div>
            )}
            {entitlement.expiresAt && (
              <div><dt className="text-muted-foreground">Access ends</dt><dd>{new Date(entitlement.expiresAt).toLocaleString()}</dd></div>
            )}
          </dl>
          <p className="mt-3 text-xs text-muted-foreground">
            At expiry the product blocks with an explanation and a renewal path — nothing is deleted, and renewal restores
            immediately. Trials are single-use per workspace.
          </p>
          {canStartTrial ? (
            <StartTrialButton canStart />
          ) : (
            (entitlement.status === "not_configured" || entitlement.status === "inactive") && (
              <p className="mt-3 text-xs text-muted-foreground">Only workspace owners/admins can start the trial.</p>
            )
          )}
          {isOwner && (access || entitlement.status === "expired") && <RecordGrantForm />}
          {isOwner && <TransitionButtons status={entitlement.status} />}
        </CardContent>
      </Card>

      {paymentsEnabled && (isOwner || role === "admin") && (
        <Card>
          <CardHeader>
            <CardTitle>Rent Acquisition OS</CardTitle>
            <CardDescription>
              Choose a lease. Prices are fixed server-side; no auto-renewal, and renewal restores access immediately.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <CheckoutLeaseGrid leases={PUBLIC_LEASES} />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Workspace plan</CardTitle>
          <CardDescription>
            Status: <span className="font-medium">{data?.status ?? "active"}</span>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Badge>{data?.plan ?? "starter"}</Badge>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Grant history</CardTitle>
          <CardDescription>Every trial and paid grant on this workspace, newest first.</CardDescription>
        </CardHeader>
        <CardContent>
          {orders.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border/80 p-8 text-center">
              <p className="font-sans text-[13px] text-muted-foreground">No grants recorded yet. Trials and paid access appear here with their references.</p>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border/80 bg-card">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border/60 text-left font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
                    <th className="py-2 pr-4">Date</th>
                    <th className="py-2 pr-4">Provider</th>
                    <th className="py-2 pr-4">Reference</th>
                    <th className="py-2 pr-4">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map((o: any) => (
                    <tr key={o.id} className="border-b border-border/60 last:border-0">
                      <td className="py-2 pr-4">{o.createdAt ? new Date(o.createdAt).toLocaleString() : "—"}</td>
                      <td className="py-2 pr-4">{o.provider ?? "—"}</td>
                      <td className="py-2 pr-4 font-mono text-xs">{o.providerRef ?? "—"}</td>
                      <td className="py-2 pr-4">{o.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
