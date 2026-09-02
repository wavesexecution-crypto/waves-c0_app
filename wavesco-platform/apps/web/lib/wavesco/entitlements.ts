import { withTenantContext } from "@wavesco/db";

// Waves Identity → Tenant → Product Entitlements → Acquisition OS
// For now without billing, entitlement is derived from TenantModule.
// When billing lands: Choose → Rent → Pay → verified subscription → TenantModule enabled.

export type ProductId = "acquisition-os";
export type EntitlementStatus = "active" | "inactive" | "not_configured";

export interface Entitlement {
  product: ProductId;
  status: EntitlementStatus;
  reason: string;
  tenantModuleId?: string | null;
  enabledAt?: string | null;
}

export async function getAcquisitionOSEntitlement(tenantId: string): Promise<Entitlement> {
  // Tenant-scoped, RLS-enforced via withTenantContext
  try {
    const result = await withTenantContext(tenantId, async (tx: any) => {
      const mod = await tx.module.findUnique({ where: { name: "acquisition-os" }, select: { id: true, name: true } });
      if (!mod) {
        return { found: false, mod: null, tm: null };
      }
      const tm = await tx.tenantModule.findUnique({
        where: { tenantId_moduleId: { tenantId, moduleId: mod.id } },
        select: { id: true, status: true, enabledAt: true },
      });
      return { found: true, mod, tm };
    });

    if (!result.found) {
      return { product: "acquisition-os", status: "not_configured", reason: "acquisition-os module not registered" };
    }
    const tm: any = result.tm;
    if (!tm) {
      return { product: "acquisition-os", status: "not_configured", reason: "Not rented — no entitlement record. Rent via Waves." };
    }
    if (tm.status === "enabled") {
      return {
        product: "acquisition-os",
        status: "active",
        reason: "Entitlement active — rented",
        tenantModuleId: tm.id,
        enabledAt: tm.enabledAt ? new Date(tm.enabledAt).toISOString() : null,
      };
    }
    return {
      product: "acquisition-os",
      status: "inactive",
      reason: `Entitlement ${tm.status}`,
      tenantModuleId: tm.id,
      enabledAt: tm.enabledAt ? new Date(tm.enabledAt).toISOString() : null,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { product: "acquisition-os", status: "not_configured", reason: `Entitlement check failed: ${msg}` };
  }
}

// Contract for future billing — do not implement payment here
export interface BillingContract {
  product: ProductId;
  checkout: (tenantId: string) => Promise<{ url: string }>; // Choose → Rent → Pay
  verify: (tenantId: string, sessionId: string) => Promise<Entitlement>;
  entitlement: (tenantId: string) => Promise<Entitlement>;
}

export const acquisitionOSProduct = {
  id: "acquisition-os" as const,
  name: "Acquisition OS",
  tagline: "Choose. Rent. Operate.",
  description: "The rented acquisition operating system. One complete OS while subscription active.",
} as const;
