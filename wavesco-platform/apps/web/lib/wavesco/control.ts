import { auth } from "@/lib/auth";
import { requireTenantId } from "@/lib/tenant";
import { assertRuntimeRoleIsNotTableOwner, getTenantTx, withTenantContext } from "@wavesco/db";
import { entitlementDeniedPayload, requireAcquisitionAccess } from "@/lib/wavesco/entitlements";

export async function requireControlAuth() {
  // Once per process: warn loudly if the runtime role owns tenant tables, which
  // would silently disable every tenant filter in the codebase.
  void assertRuntimeRoleIsNotTableOwner();
  const session = await auth();
  const tenantId = requireTenantId(session as unknown);
  const userId =
    ((session as unknown as { user?: { id?: string } } | null)?.user?.id as string | undefined) ??
    null;
  return { session, tenantId, userId };
}

/** Role from a session object, defensively typed. Unknown/missing → member. */
export function sessionRole(session: unknown): string {
  if (!session || typeof session !== "object") return "member";
  const user = (session as { user?: unknown }).user;
  if (!user || typeof user !== "object") return "member";
  const role = (user as { role?: unknown }).role;
  return role === "owner" || role === "admin" || role === "member" ? role : "member";
}

/** Acquisition OS gate. Returns null when the tenant may proceed, else an
 *  HTTP status + body explaining WHAT is blocked, WHY, and WHAT NEXT.
 *  Never throws for entitlement states — only unexpected errors propagate. */
export async function acquisitionDenied(
  tenantId: string,
): Promise<{ status: number; body: Record<string, unknown> } | null> {
  try {
    await requireAcquisitionAccess(tenantId);
    return null;
  } catch (e) {
    return (
      entitlementDeniedPayload(e) ?? {
        status: 500,
        body: { error: "entitlement_check_failed", reason: "Could not verify access. Retry — if this persists, contact Waves." },
      }
    );
  }
}

export async function auditControl(args: {
  tenantId: string;
  userId?: string | null;
  action: string;
  model: string;
  recordId?: string;
  before?: unknown;
  after?: unknown;
  metadata?: unknown;
}) {
  const data = {
    tenantId: args.tenantId,
    userId: args.userId,
    action: args.action,
    model: args.model,
    recordId: args.recordId,
    before: args.before as never,
    after: args.after as never,
    metadata: args.metadata as never,
  };

  // Join the caller's tenant transaction when one is open. Writing through the
  // module-level `prisma` uses a DIFFERENT pooled connection on which
  // `SET LOCAL app.tenant_id` was never applied, so a tenant-scoped
  // `auditlog_insert` policy evaluates the GUC as NULL and rejects the row with
  // `42501 new row violates row-level security policy` — which rolled back the
  // whole client-context submission. Using `tx` also commits the audit row
  // atomically with the mutation it describes.
  const tx = getTenantTx();
  if (tx) {
    return (tx.auditLog as unknown as { create: (x: unknown) => Promise<unknown> }).create({ data });
  }

  // No open transaction: open one for this tenant so the GUC is set either way.
  return withTenantContext(args.tenantId, async (inner) => {
    return (inner.auditLog as unknown as { create: (x: unknown) => Promise<unknown> }).create({ data });
  }, args.userId ?? undefined);
}
