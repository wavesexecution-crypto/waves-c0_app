import type { Metadata } from "next";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { requireTenantId } from "@/lib/tenant";
import { getAcquisitionOSEntitlement, acquisitionOSProduct } from "@/lib/wavesco/entitlements";
import { withTenantContext } from "@wavesco/db";
import { StatusPill } from "@/components/command/primitives";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Your Products" };

function Pill({ status }: { status: string }) {
  const s = status === "active" ? "live" : status === "inactive" ? "error" : "disconnected";
  return <StatusPill state={s as any} />;
}

export default async function ProductsPage() {
  const session = await auth();
  const tenantId = requireTenantId(session as any);
  const user = (session as any)?.user as { email?: string; name?: string } | undefined;

  const entitlement = await getAcquisitionOSEntitlement(tenantId);
  // Fetch tenant name for Waves identity display
  let tenantName: string | null = null;
  try {
    tenantName = await withTenantContext(tenantId, async (tx: any) => {
      const t = await tx.tenant.findUnique({ where: { id: tenantId }, select: { name: true, slug: true } });
      return t?.name ?? t?.slug ?? null;
    });
  } catch {}

  const isActive = entitlement.status === "active";

  return (
    <div className="space-y-6">
      <div>
        <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Waves</p>
        <h1 className="text-2xl font-semibold tracking-tight">Your Products</h1>
        <p className="text-sm text-muted-foreground">
          One Waves account. All your products. Your Waves profile
          {user?.email ? ` — ${user.email}` : ""} {tenantName ? `· ${tenantName}` : ""} gives you access to the products you own or rent.
        </p>
      </div>

      <div className="rounded-lg border bg-card p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold">{acquisitionOSProduct.name}</h2>
            <p className="text-sm text-muted-foreground">{acquisitionOSProduct.tagline} — {acquisitionOSProduct.description}</p>
            <p className="mt-2 text-xs text-muted-foreground">Product ID: {acquisitionOSProduct.id} · Tenant: {tenantId.slice(0, 8)}…</p>
          </div>
          <Pill status={entitlement.status} />
        </div>

        <div className="mt-4 rounded-md border bg-muted/30 p-3 text-sm">
          {isActive ? (
            <p>
              <span className="font-medium text-emerald-700">Active</span> — your Acquisition OS is rented and operational. Open the Control Center to operate.
            </p>
          ) : entitlement.status === "not_configured" ? (
            <p>
              <span className="font-medium">Not currently active</span> — no entitlement record. When billing lands, <span className="font-mono text-xs">Choose → Rent → Pay → Entitlement active</span> will activate this card. For now the state is <span className="font-mono text-xs">not_configured</span>, not fake active.
            </p>
          ) : (
            <p>
              <span className="font-medium">Inactive</span> — {entitlement.reason}
            </p>
          )}
          <p className="mt-1 text-xs text-muted-foreground">{entitlement.reason}</p>
        </div>

        <div className="mt-4 flex flex-wrap gap-3">
          {isActive ? (
            <Link
              href="/acquisition"
              className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              Open Acquisition OS
            </Link>
          ) : (
            <a
              href="https://wavesco.in#products"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center justify-center rounded-md border bg-background px-4 py-2 text-sm font-medium hover:bg-accent"
            >
              Rent Acquisition OS
            </a>
          )}
          <Link href="/acquisition/profile" className="inline-flex items-center justify-center rounded-md border px-4 py-2 text-sm hover:bg-accent">
            Company Profile
          </Link>
        </div>

        <p className="mt-4 text-xs text-muted-foreground">
          Billing contract (future): <span className="font-mono">Tenant → ProductEntitlements → Acquisition OS</span> — interface `getAcquisitionOSEntitlement(tenantId)` currently reads `TenantModule` for `acquisition-os`. No payment implemented in this task.
        </p>
      </div>

      <div className="rounded-lg border border-dashed p-4 text-xs text-muted-foreground">
        <p className="font-medium text-foreground">Waves identity</p>
        <p>
          Waves Account → User → Profile → Tenant/Company → Products → Entitlements → Billing (later). Acquisition OS references the same tenant identity — no separate
          Acquisition OS account, password, or customer profile is created. Tenant cannot be changed through client input; every control API enforces{" "}
          <span className="font-mono">requireControlAuth → withTenantContext</span>.
        </p>
      </div>
    </div>
  );
}
