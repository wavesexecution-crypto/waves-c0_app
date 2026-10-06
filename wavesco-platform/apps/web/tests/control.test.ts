import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => ({ user: { id: "u1", email: "test@example.com", tenantId: "t1" } })) }));
vi.mock("@/lib/tenant", () => ({ requireTenantId: vi.fn(() => "t1") }));
vi.mock("@wavesco/db", () => ({
  prisma: { auditLog: { create: vi.fn(async (x: { data: Record<string, unknown> }) => ({ id: "a1", ...x.data })) } },
  // No tenant transaction is open in this unit test, so auditControl falls
  // back to its own withTenantContext — which is what makes the mocked
  // `prisma.auditLog.create` the writer.
  getTenantTx: vi.fn(() => undefined),
  // requireControlAuth calls this once per process; it is a no-op in tests.
  assertRuntimeRoleIsNotTableOwner: vi.fn(async () => undefined),
  withTenantContext: vi.fn(async (_tid: string, fn: (tx: unknown) => Promise<unknown>) =>
    fn({
      acquisitionEntitlement: {
        findUnique: async () => ({
          id: "ent1", status: "ACTIVE", source: "MANUAL",
          trialStartedAt: null, trialExpiresAt: null,
          startedAt: new Date(), expiresAt: new Date(Date.now() + 86_400_000),
        }),
        update: async ({ data }: any) => ({ id: "ent1", status: "ACTIVE", ...data }),
      },
      auditLog: {
        create: async (x: { data: Record<string, unknown> }) => ({ id: "a1", ...x.data }),
      },
    }),
  ),
}));

describe("auditControl", () => {
  it("writes AuditLog with before/after", async () => {
    const { auditControl } = await import("@/lib/wavesco/control");
    expect(typeof auditControl).toBe("function");
  });

  it("writes AuditLog with before/after and returns record", async () => {
    const { auditControl } = await import("@/lib/wavesco/control");
    const log = await auditControl({
      tenantId: "t1",
      userId: "u1",
      action: "campaign.launch",
      model: "Campaign",
      recordId: "c1",
      before: { status: "draft" },
      after: { status: "running" },
    });
    expect((log as { action: string }).action).toBe("campaign.launch");
    expect((log as { before: unknown }).before).toEqual({ status: "draft" });
    expect((log as { after: unknown }).after).toEqual({ status: "running" });
    expect((log as { model: string }).model).toBe("Campaign");
    expect((log as { recordId: string }).recordId).toBe("c1");
  });
});

describe("requireControlAuth", () => {
  it("returns tenantId", async () => {
    const { requireControlAuth } = await import("@/lib/wavesco/control");
    const res = await requireControlAuth();
    expect(res.tenantId).toBe("t1");
    expect(res.userId).toBe("u1");
    expect(res.session).toBeDefined();
  });
});

describe("sessionRole (real helper)", () => {
  it("extracts owner/admin/member, defaults unknown to member", async () => {
    const { sessionRole } = await import("@/lib/wavesco/control");
    expect(sessionRole({ user: { role: "owner" } })).toBe("owner");
    expect(sessionRole({ user: { role: "admin" } })).toBe("admin");
    expect(sessionRole({ user: { role: "member" } })).toBe("member");
    expect(sessionRole({ user: { role: "superadmin" } })).toBe("member");
    expect(sessionRole({ user: {} })).toBe("member");
    expect(sessionRole(null)).toBe("member");
    expect(sessionRole(undefined)).toBe("member");
  });
});

describe("acquisitionDenied (real gate)", () => {
  it("returns null for entitled tenants", async () => {
    const { acquisitionDenied } = await import("@/lib/wavesco/control");
    await expect(acquisitionDenied("t1")).resolves.toBeNull();
  });
  it("fail-closed deny body when the database is unreachable", async () => {
    const { withTenantContext } = await import("@wavesco/db");
    vi.mocked(withTenantContext).mockRejectedValueOnce(new Error("connection refused"));
    const { acquisitionDenied } = await import("@/lib/wavesco/control");
    const denied = await acquisitionDenied("t1");
    expect(denied).not.toBeNull();
    expect(denied!.status).toBe(403);
    expect((denied!.body as { error: string }).error).toBe("entitlement_required");
  });
});
