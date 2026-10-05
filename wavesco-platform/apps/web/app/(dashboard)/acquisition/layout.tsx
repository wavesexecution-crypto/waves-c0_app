import Link from "next/link";
import { auth } from "@/lib/auth";
import { getUserFromSession, requireTenantId } from "@/lib/tenant";
import {
  canStartTrial,
  getAcquisitionOSEntitlement,
  hasAccess,
  type EntitlementStatus,
} from "@/lib/wavesco/entitlements";

export const dynamic = "force-dynamic";

const HEADING: Partial<Record<EntitlementStatus, string>> = {
  expired: "Your access has expired",
  suspended: "Your access is suspended",
  cancelled: "Your access was cancelled",
  refunded: "Your access was refunded",
  inactive: "Acquisition OS is not active yet",
  not_configured: "Acquisition OS is not active yet",
};

function formatDay(value: string | null | undefined): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

/** Acquisition OS gate. Entitled (trial/active) tenants see the product.
 *  Everyone else gets a truthful blocked panel — WHAT happened, WHY, and
 *  exactly WHAT NEXT — instead of an empty dashboard that looks broken. */
export default async function AcquisitionLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  const tenantId = requireTenantId(session);
  const entitlement = await getAcquisitionOSEntitlement(tenantId);

  if (hasAccess(entitlement.status)) return <>{children}</>;

  // A lookup outage is not a billing decision. Never tell the client their
  // access was never purchased, and never offer to re-buy it.
  if (entitlement.readFailed) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 sm:px-6">
        <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Acquisition OS</p>
        <h1 className="mt-2 font-display text-2xl font-semibold tracking-tight">
          We could not verify your access
        </h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          This is a temporary problem on our side, not a change to your account. Nothing has been cancelled and your
          data is intact. Try again in a moment.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link
            href="/acquisition"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </Link>
          <Link
            href="/command"
            className="inline-flex items-center justify-center rounded-md border px-4 py-2 text-sm transition-colors hover:bg-accent"
          >
            Command Center
          </Link>
        </div>
      </div>
    );
  }

  const status = entitlement.status;
  const rawRole = getUserFromSession(session)?.role;
  const isOwnerish = canStartTrial(typeof rawRole === "string" ? rawRole : null);
  // A lapsed TRIAL keeps its trialExpiresAt and has no expiresAt; picking the
  // wrong field rendered "Access ended 1/1/1970".
  const endDate = formatDay(status === "trial" ? entitlement.trialExpiresAt : entitlement.expiresAt ?? entitlement.trialExpiresAt);
  const canTrial = (status === "not_configured" || status === "inactive") && isOwnerish;

  return (
    <div className="mx-auto max-w-2xl px-4 py-16 sm:px-6">
      <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Acquisition OS</p>
      <h1 className="mt-2 font-display text-2xl font-semibold tracking-tight">
        {HEADING[status] ?? "Acquisition OS is not available"}
      </h1>
      <p className="mt-3 text-sm leading-6 text-muted-foreground">{entitlement.reason}</p>
      {endDate ? (
        <p className="mt-1 text-xs text-muted-foreground">
          {status === "trial" ? `Trial ends ${endDate}.` : `Access ended ${endDate}.`}
        </p>
      ) : null}
      <div className="mt-6 rounded-lg border bg-card p-5 text-sm">
        <p className="font-medium">What next</p>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
          {canTrial && <li>Start your free trial — provisioning is automatic, no engineer needed.</li>}
          {(status === "not_configured" || status === "inactive") && !isOwnerish && (
            <li>Ask your workspace owner to start the free trial.</li>
          )}
          {status === "expired" && <li>Renew from Billing to resume operating immediately.</li>}
          {(status === "suspended" || status === "cancelled" || status === "refunded") && (
            <li>Contact Waves to restore access.</li>
          )}
          <li>Your existing data is preserved — nothing is deleted when access lapses.</li>
        </ul>
        <div className="mt-4 flex flex-wrap gap-3">
          {status === "expired" || status === "suspended" ? (
            <Link
              href="/billing"
              className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              Go to Billing
            </Link>
          ) : null}
          {canTrial ? (
            <Link
              href="/billing"
              className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              Start trial
            </Link>
          ) : null}
          <Link
            href="/products"
            className="inline-flex items-center justify-center rounded-md border px-4 py-2 text-sm transition-colors hover:bg-accent"
          >
            Your Products
          </Link>
        </div>
      </div>
    </div>
  );
}