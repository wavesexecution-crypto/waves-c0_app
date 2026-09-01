import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => ({ user: { id: "u1", email: "test@example.com", tenantId: "t1" } })) }));
vi.mock("@/lib/tenant", () => ({ requireTenantId: vi.fn(() => "t1") }));
vi.mock("@wavesco/db", () => ({ prisma: { auditLog: { create: vi.fn(async (x: { data: Record<string, unknown> }) => ({ id: "a1", ...x.data })) } } }));

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
