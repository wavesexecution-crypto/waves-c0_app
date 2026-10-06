import { prisma, type TenantTx } from "./prisma-instance";
import { tenantContext } from "./context";

export type { TenantTx };

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
  fn: (tx: TenantTx) => Promise<T> | T,
  userId?: string,
): Promise<T> {
  const safeTenantId = sanitizeTenantId(tenantId);
  if (safeTenantId.length === 0) {
    throw new Error("withTenantContext: invalid empty tenantId");
  }

  return prisma.$transaction(
    async (tx) => {
      // Bound parameter rather than string interpolation.
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${safeTenantId}, true)`;
      // Publish the transaction so nested writers (e.g. auditControl) reuse this
      // connection — and therefore this GUC — instead of opening a new one.
      return tenantContext.run({ tenantId: safeTenantId, userId, tx }, () => fn(tx));
    },
    { timeout: 15_000 },
  );
}

let roleCheck: Promise<void> | null = null;

/**
 * Fails loudly, once per process, if the connection role owns the tenant tables.
 *
 * PostgreSQL's `ENABLE ROW LEVEL SECURITY` (as opposed to
 * `FORCE ROW LEVEL SECURITY`) does not apply to the table owner. If the app
 * connects as the owner then every `tenantId` filter in this codebase and every
 * `SET LOCAL app.tenant_id` becomes decorative, and tenant isolation silently
 * stops working with no error anywhere.
 *
 * This is a warning, not a throw: an owner connection is a legitimate
 * configuration for migrations and local tooling, and hard-failing would break
 * those. It is called from the request path so a misconfigured deployment is
 * visible in the logs within seconds of the first request.
 */
export function assertRuntimeRoleIsNotTableOwner(): Promise<void> {
  roleCheck ??= (async () => {
    try {
      const rows = (await prisma.$queryRaw<
        { owned: number }[]
      >`SELECT count(*)::int AS owned
          FROM pg_class c
          JOIN pg_roles r ON r.rolname = current_user
          WHERE c.relkind = 'r'
            AND c.relrowsecurity
            AND c.relowner = (SELECT oid FROM pg_roles WHERE rolname = current_user)`);
      const owned = rows?.[0]?.owned ?? 0;
      if (owned > 0) {
        console.error(
          `[db] TENANT ISOLATION DISABLED: connected role "${process.env.DIRECT_URL || process.env.DATABASE_URL ? "(see URL)" : "(unset)"}" owns ${owned} RLS-enabled table(s). ` +
            "PostgreSQL does not apply RLS to the table owner. Point DATABASE_URL at the non-owner role " +
            "(e.g. wavesco_app) so tenant isolation actually applies.",
        );
      }
    } catch (e) {
      // Never block traffic on a diagnostic.
      console.warn("[db] could not verify runtime role against table ownership:", e);
    }
  })();
  return roleCheck;
}
