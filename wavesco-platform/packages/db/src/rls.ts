import { prisma } from "./client";
import { tenantContext } from "./context";

function sanitizeTenantId(tenantId: string): string {
  return tenantId.replace(/['\\]/g, "");
}

/**
 * Runs `fn` inside a single transaction with the tenant context set:
 *
 * - `SET LOCAL app.tenant_id` → enforced by PostgreSQL RLS policies for
 *   the runtime role `wavesco_app` (every statement in this transaction
 *   only sees/writes rows belonging to `tenantId`).
 * - AsyncLocalStorage context → read by the audit extension and any
 *   code that needs the current tenant without threading parameters.
 *
 * All application database writes MUST go through this helper.
 */
export async function withTenantContext<T>(
  tenantId: string,
  fn: (tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0]) => Promise<T> | T,
  userId?: string,
): Promise<T> {
  const safeTenantId = sanitizeTenantId(tenantId);
  if (safeTenantId.length === 0) {
    throw new Error("withTenantContext: invalid empty tenantId");
  }

  return tenantContext.run({ tenantId: safeTenantId, userId }, () =>
    prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL app.tenant_id = '${safeTenantId}'`);
      return fn(tx);
    }),
  );
}
