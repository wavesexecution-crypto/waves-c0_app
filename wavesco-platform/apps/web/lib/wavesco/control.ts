import { auth } from "@/lib/auth";
import { requireTenantId } from "@/lib/tenant";

export async function requireControlAuth() {
  const session = await auth();
  const tenantId = requireTenantId(session as unknown);
  const userId =
    ((session as unknown as { user?: { id?: string } } | null)?.user?.id as string | undefined) ??
    null;
  return { session, tenantId, userId };
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
