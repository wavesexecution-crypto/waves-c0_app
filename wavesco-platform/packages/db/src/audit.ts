import type { PrismaClient } from "./generated/client";
import { getTenantContext } from "./context";

const AUDITABLE_OPERATIONS = new Set([
  "create",
  "createMany",
  "update",
  "updateMany",
  "upsert",
  "delete",
  "deleteMany",
]);

const SENSITIVE_FIELDS = new Set([
  "passwordHash",
  "tokenHash",
  "refreshToken",
  "apiKey",
  "secret",
  "authorization",
]);

const REDACTED = "[REDACTED]";

export function redact(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redact(item));
  }
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(obj)) {
      out[key] = SENSITIVE_FIELDS.has(key) ? REDACTED : redact(val);
    }
    return out;
  }
  return value;
}

function extractTenantId(model: string, args: Record<string, unknown>): string | null {
  const data = args.data as Record<string, unknown> | undefined;
  if (model === "Tenant") {
    const id = data?.id;
    return typeof id === "string" ? id : null;
  }
  if (Array.isArray(data)) {
    const first = data[0] as Record<string, unknown> | undefined;
    return typeof first?.tenantId === "string" ? first.tenantId : null;
  }
  return typeof data?.tenantId === "string" ? data.tenantId : null;
}

function extractRecordId(args: Record<string, unknown>): string | null {
  const where = args.where as Record<string, unknown> | undefined;
  if (typeof where?.id === "string") return where.id;
  const data = args.data as Record<string, unknown> | undefined;
  if (typeof data?.id === "string") return data.id;
  return null;
}

interface AuditParams {
  model?: string;
  operation: string;
  args: Record<string, unknown>;
  query: (args: Record<string, unknown>) => Promise<unknown>;
}

/**
 * Prisma client extension that auto-audits every mutation.
 *
 * - Skips the AuditLog model itself (no infinite recursion).
 * - Reads the tenant context from AsyncLocalStorage; falls back to
 *   deriving the tenant from the operation args.
 * - Redacts sensitive fields from the stored snapshot.
 * - Writes via a SECURITY DEFINER SQL function so RLS on AuditLog
 *   never blocks the audit write (the audit extension runs on a pooled
 *   connection without a tenant GUC).
 *
 * Modules opt out by declaring `"audit": false` in their contract; the
 * module loader passes an opt-out set when building the client.
 */
export function auditExtension(
  base: PrismaClient,
  opts?: { optOutModels?: Set<string> },
) {
  const optOut = opts?.optOutModels ?? new Set<string>();

  return {
    name: "wavesco.audit",
    query: {
      async $allOperations({ model, operation, args, query }: AuditParams) {
        const result = await query(args);
        if (!model || model === "AuditLog") return result;
        if (!AUDITABLE_OPERATIONS.has(operation)) return result;
        if (optOut.has(model)) return result;

        const ctx = getTenantContext();
        const tenantId =
          ctx?.tenantId ?? extractTenantId(model, args);
        const after =
          operation.startsWith("create") || operation.startsWith("update")
            ? (args.data as object | null)
            : null;
        const metadata = { agent: "wavesco-audit" };

        try {
          await base.$executeRaw`
            SELECT public.audit_log_write(
              ${tenantId}::text,
              ${ctx?.userId ?? null}::text,
              ${operation}::text,
              ${model}::text,
              ${extractRecordId(args)}::text,
              ${(redact(after) as object)}::jsonb,
              ${metadata}::jsonb
            )
          `;
        } catch (err) {
          console.error("[audit] failed to write audit log entry", err);
        }
        return result;
      },
    },
  };
}
