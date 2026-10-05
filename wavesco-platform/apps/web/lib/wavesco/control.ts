import { auth } from "@/lib/auth";
import { requireTenantId } from "@/lib/tenant";
import { entitlementDeniedPayload, requireAcquisitionAccess } from "@/lib/wavesco/entitlements";

export async function requireControlAuth() {
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
  const { prisma } = await import("@wavesco/db");
  return (prisma as unknown as { auditLog: { create: (x: unknown) => Promise<unknown> } }).auditLog.create({
    data: {
      tenantId: args.tenantId,
      userId: args.userId,
      action: args.action,
      model: args.model,
      recordId: args.recordId,
      before: args.before as never,
      after: args.after as never,
      metadata: args.metadata as never,
    },
  });
}
