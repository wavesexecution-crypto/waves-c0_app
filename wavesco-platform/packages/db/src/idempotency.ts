import { getTenantContext } from "./context";
import { withTenantContext } from "./rls";

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

export interface IdempotencyOptions {
  scope: string;
  key: string;
  ttlMs?: number;
  tenantId?: string;
  userId?: string;
}

/**
 * Runs a mutation at most once per (tenant, scope, key).
 *
 * Must be called inside `withTenantContext` (or pass an explicit
 * `tenantId`). The cached response is stored on the IdempotencyKey row
 * and returned on repeat calls. `fn` should return JSON-serializable
 * data.
 */
export async function withIdempotency<T>(
  options: IdempotencyOptions,
  fn: () => Promise<T>,
): Promise<T> {
  const ctx = getTenantContext();
  const tenantId = options.tenantId ?? ctx?.tenantId;
  if (!tenantId) {
    throw new Error("withIdempotency requires an active tenant context or explicit tenantId");
  }

  const scope = options.scope;
  const key = options.key;
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;

  return withTenantContext(tenantId, async (tx) => {
    const existing = await tx.idempotencyKey.findUnique({
      where: { tenantId_scope_key: { tenantId, scope, key } },
    });

    if (existing?.response) {
      return existing.response as T;
    }

    const result = await fn();
    const payload = result as unknown;

    await tx.idempotencyKey.create({
      data: {
        tenantId,
        scope,
        key,
        response: payload as object,
        expiresAt: new Date(Date.now() + ttlMs),
      },
    });

    return result;
  }, options.userId);
}
