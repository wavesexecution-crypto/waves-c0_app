import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Regression: the AuditLog write must run on the caller's TENANT TRANSACTION.
 *
 * `auditControl` used to issue its INSERT through the module-level `prisma`
 * client. That is a different pooled connection, on which
 * `SET LOCAL app.tenant_id` was never applied, so a tenant-scoped
 * `auditlog_insert` policy evaluated `current_setting('app.tenant_id')` as NULL
 * and rejected the row with
 *   42501 new row violates row-level security policy for table "AuditLog"
 * Because the audit write is in the same transaction as the mutation it
 * describes, that rolled back the whole client-context submission: every
 * profile save returned HTTP 500 in production.
 */

const auditCreates: { connection: string; data: Record<string, unknown> }[] = [];

function makeTx(connection: string) {
  return {
    auditLog: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        auditCreates.push({ connection, data });
        return { id: "audit_1", ...data };
      },
    },
  };
}

let openTx: ReturnType<typeof makeTx> | null = null;

// control.ts imports @/lib/auth, which pulls next-auth — unresolvable under
// vitest. Only auditControl is exercised here, so a stub is sufficient.
vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => ({ user: { id: "u1", tenantId: "t1", role: "owner" } })),
}));

vi.mock("@wavesco/db", () => ({
  withTenantContext: vi.fn(async (_tenantId: string, fn: (tx: unknown) => Promise<unknown>) => {
    // A new transaction means a new connection: the GUC is set for it.
    const tx = makeTx("tenant-transaction");
    openTx = tx;
    return fn(tx);
  }),
  getTenantTx: vi.fn(() => openTx),
  assertRuntimeRoleIsNotTableOwner: vi.fn(async () => undefined),
  directPrisma: vi.fn(),
  prisma: {
    auditLog: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        auditCreates.push({ connection: "pooled-prisma-client", data });
        return { id: "audit_leak", ...data };
      },
    },
  },
}));

describe("auditControl writes inside the tenant transaction", () => {
  beforeEach(() => {
    auditCreates.length = 0;
    openTx = null;
    vi.clearAllMocks();
  });

  it("uses the open tenant transaction, never a separate pooled connection", async () => {
    const { auditControl } = await import("@/lib/wavesco/control");
    const { withTenantContext } = await import("@wavesco/db");

    await withTenantContext("tenant_a", async () => {
      await auditControl({
        tenantId: "tenant_a",
        userId: "u1",
        action: "acquisition_profile.update",
        model: "AcquisitionProfile",
        recordId: "p1",
        after: { companyName: "Acme" },
      });
    });

    expect(auditCreates).toHaveLength(1);
    // The regression: this must NOT be the pooled prisma client.
    expect(auditCreates[0]!.connection).toBe("tenant-transaction");
    expect(auditCreates[0]!.data).toMatchObject({
      tenantId: "tenant_a",
      action: "acquisition_profile.update",
      model: "AcquisitionProfile",
      recordId: "p1",
    });
  });

  it("opens a tenant-scoped transaction when called outside one", async () => {
    const { auditControl } = await import("@/lib/wavesco/control");
    const { withTenantContext } = await import("@wavesco/db");

    await auditControl({
      tenantId: "tenant_b",
      userId: "u2",
      action: "x.y",
      model: "Thing",
    });

    // It must still go through withTenantContext so the GUC is set.
    expect(withTenantContext).toHaveBeenCalledWith("tenant_b", expect.any(Function), "u2");
    expect(auditCreates).toHaveLength(1);
    expect(auditCreates[0]!.connection).toBe("tenant-transaction");
    expect(auditCreates[0]!.data).toMatchObject({ tenantId: "tenant_b", userId: "u2" });
  });

  it("does not let an audit write escape to the pooled client under any call shape", async () => {
    const { auditControl } = await import("@/lib/wavesco/control");
    const { withTenantContext } = await import("@wavesco/db");

    // Nested inside a transaction, called repeatedly, with and without metadata.
    await withTenantContext("tenant_c", async () => {
      await auditControl({ tenantId: "tenant_c", action: "a", model: "M" });
      await auditControl({ tenantId: "tenant_c", action: "b", model: "M", metadata: { k: 1 } });
    });
    await auditControl({ tenantId: "tenant_c", action: "c", model: "M" });

    expect(auditCreates).toHaveLength(3);
    expect(auditCreates.every((c) => c.connection === "tenant-transaction")).toBe(true);
  });
});
