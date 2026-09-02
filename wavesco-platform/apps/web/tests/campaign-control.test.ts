import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/wavesco/control", () => ({
  requireControlAuth: vi.fn(async () => ({ tenantId: "t1", userId: "u1", session: {} as any })),
  auditControl: vi.fn(async () => ({ id: "audit1" })),
}));

vi.mock("@wavesco/db", () => ({
  withTenantContext: vi.fn(),
  prisma: { campaign: { findFirst: vi.fn(), update: vi.fn() } },
}));

function mockWithTenantContext(status: string) {
  return async (_tenantId: string, fn: (tx: any) => Promise<any>) => {
    const tx: any = {
      campaign: {
        findFirst: async () => ({ id: "c1", tenantId: "t1", status }),
        update: vi.fn(async () => ({})),
      },
    };
    return fn(tx);
  };
}

describe("campaign control", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("pause on draft fails 400", async () => {
    const { withTenantContext } = await import("@wavesco/db");
    vi.mocked(withTenantContext).mockImplementation(mockWithTenantContext("draft") as any);

    const { POST } = await import("@/app/api/acquisition/campaigns/[id]/control/route");
    const res = await POST(
      new Request("http://test", { method: "POST", body: JSON.stringify({ action: "pause" }), headers: { "content-type": "application/json" } }),
      { params: Promise.resolve({ id: "c1" }) } as any
    );
    expect(res.status).toBe(400);
    const json: any = await res.json();
    expect(json.error).toMatch(/cannot pause/i);
  });

  it("pause on running succeeds 200 and audits", async () => {
    const { withTenantContext } = await import("@wavesco/db");
    const { auditControl } = await import("@/lib/wavesco/control");
    vi.mocked(withTenantContext).mockImplementation(mockWithTenantContext("running") as any);

    const { POST } = await import("@/app/api/acquisition/campaigns/[id]/control/route");
    const res = await POST(
      new Request("http://test", { method: "POST", body: JSON.stringify({ action: "pause" }), headers: { "content-type": "application/json" } }),
      { params: Promise.resolve({ id: "c1" }) } as any
    );
    expect(res.status).toBe(200);
    const json: any = await res.json();
    expect(json.status).toBe("paused");
    expect(auditControl).toHaveBeenCalledWith(
      expect.objectContaining({ action: "campaign.pause", model: "Campaign", recordId: "c1", tenantId: "t1" })
    );
    // before/after audit payload
    const call: any = vi.mocked(auditControl).mock.calls[0]?.[0];
    expect(call.before).toEqual({ status: "running" });
    expect(call.after).toEqual({ status: "paused" });
  });

  it("launch on draft succeeds 200", async () => {
    const { withTenantContext } = await import("@wavesco/db");
    const { auditControl } = await import("@/lib/wavesco/control");
    vi.mocked(withTenantContext).mockImplementation(mockWithTenantContext("draft") as any);

    const { POST } = await import("@/app/api/acquisition/campaigns/[id]/control/route");
    const res = await POST(
      new Request("http://test", { method: "POST", body: JSON.stringify({ action: "launch" }), headers: { "content-type": "application/json" } }),
      { params: Promise.resolve({ id: "c1" }) } as any
    );
    expect(res.status).toBe(200);
    const json: any = await res.json();
    expect(json.status).toBe("scheduled");
    expect(auditControl).toHaveBeenCalledWith(expect.objectContaining({ action: "campaign.launch" }));
  });

  it("resume on paused succeeds 200", async () => {
    const { withTenantContext } = await import("@wavesco/db");
    vi.mocked(withTenantContext).mockImplementation(mockWithTenantContext("paused") as any);

    const { POST } = await import("@/app/api/acquisition/campaigns/[id]/control/route");
    const res = await POST(
      new Request("http://test", { method: "POST", body: JSON.stringify({ action: "resume" }), headers: { "content-type": "application/json" } }),
      { params: Promise.resolve({ id: "c1" }) } as any
    );
    expect(res.status).toBe(200);
    const json: any = await res.json();
    expect(json.status).toBe("running");
  });

  it("stop on running succeeds 200", async () => {
    const { withTenantContext } = await import("@wavesco/db");
    vi.mocked(withTenantContext).mockImplementation(mockWithTenantContext("running") as any);

    const { POST } = await import("@/app/api/acquisition/campaigns/[id]/control/route");
    const res = await POST(
      new Request("http://test", { method: "POST", body: JSON.stringify({ action: "stop" }), headers: { "content-type": "application/json" } }),
      { params: Promise.resolve({ id: "c1" }) } as any
    );
    expect(res.status).toBe(200);
    const json: any = await res.json();
    expect(json.status).toBe("stopped");
  });

  it("invalid action returns 400", async () => {
    const { POST } = await import("@/app/api/acquisition/campaigns/[id]/control/route");
    const res = await POST(
      new Request("http://test", { method: "POST", body: JSON.stringify({ action: "explode" }), headers: { "content-type": "application/json" } }),
      { params: Promise.resolve({ id: "c1" }) } as any
    );
    expect(res.status).toBe(400);
  });

  it("launch on running fails 400", async () => {
    const { withTenantContext } = await import("@wavesco/db");
    vi.mocked(withTenantContext).mockImplementation(mockWithTenantContext("running") as any);
    const { POST } = await import("@/app/api/acquisition/campaigns/[id]/control/route");
    const res = await POST(
      new Request("http://test", { method: "POST", body: JSON.stringify({ action: "launch" }), headers: { "content-type": "application/json" } }),
      { params: Promise.resolve({ id: "c1" }) } as any
    );
    expect(res.status).toBe(400);
  });

  it("stop on draft fails 400", async () => {
    const { withTenantContext } = await import("@wavesco/db");
    vi.mocked(withTenantContext).mockImplementation(mockWithTenantContext("draft") as any);
    const { POST } = await import("@/app/api/acquisition/campaigns/[id]/control/route");
    const res = await POST(
      new Request("http://test", { method: "POST", body: JSON.stringify({ action: "stop" }), headers: { "content-type": "application/json" } }),
      { params: Promise.resolve({ id: "c1" }) } as any
    );
    expect(res.status).toBe(400);
  });

  it("404 when campaign not found", async () => {
    const { withTenantContext } = await import("@wavesco/db");
    vi.mocked(withTenantContext).mockImplementation(async (_tid: string, fn: (tx: any) => Promise<any>) => {
      const tx: any = { campaign: { findFirst: async () => null, update: vi.fn(async () => ({})) } };
      return fn(tx);
    });
    const { POST } = await import("@/app/api/acquisition/campaigns/[id]/control/route");
    const res = await POST(
      new Request("http://test", { method: "POST", body: JSON.stringify({ action: "pause" }), headers: { "content-type": "application/json" } }),
      { params: Promise.resolve({ id: "missing" }) } as any
    );
    expect(res.status).toBe(404);
  });
});
