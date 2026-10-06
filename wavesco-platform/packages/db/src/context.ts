import { AsyncLocalStorage } from "node:async_hooks";
import type { TenantTx } from "./prisma-instance";

export type { TenantTx };

export interface TenantContext {
  tenantId: string;
  userId?: string;
  /**
   * The open tenant transaction, when there is one.
   *
   * Anything that writes a tenant-scoped row MUST use this client rather than
   * the module-level `prisma`. `SET LOCAL app.tenant_id` is applied to the
   * transaction's connection only; a statement issued on a different pooled
   * connection has no GUC set, so RLS evaluates `current_setting('app.tenant_id')`
   * as NULL and a tenant-scoped policy rejects the row. That is exactly how the
   * client-context submission began failing with
   * `new row violates row-level security policy for table "AuditLog"`.
   *
   * Using `tx` also keeps the audit row atomic with the mutation it describes.
   */
  tx?: TenantTx;
}

export const tenantContext = new AsyncLocalStorage<TenantContext>();

export function getTenantContext(): TenantContext | undefined {
  return tenantContext.getStore();
}

/**
 * The transaction of the currently-open `withTenantContext`, if any.
 * Callers that write tenant-scoped rows should prefer this so RLS applies and
 * the write commits atomically with the surrounding work.
 */
export function getTenantTx(): TenantTx | undefined {
  return tenantContext.getStore()?.tx;
}
