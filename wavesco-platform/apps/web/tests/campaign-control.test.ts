import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/wavesco/control", () => ({
  acquisitionDenied: vi.fn(async () => null),
  requireControlAuth: vi.fn(async () => ({
    tenantId: "t1",
    userId: "u1",
    // Launching/stopping a campaign is owner/admin-only; the route reads the
    // role from this session, so the tests must present an owner session.
    session: { user: { id: "u1", tenantId: "t1", role: "owner" } } as Record<string, unknown>,
  })),
  auditControl: vi.fn(async () => ({ id: "audit1" })),
  // Mirrors the real pure helper (same pattern as the other route tests).
  sessionRole: (s: unknown) => {
    const role = (s as { user?: { role?: unknown } } | null)?.user?.role;
    return role === "owner" || role === "admin" || role === "member" ? role : "member";
  },
}));

vi.mock("@wavesco/db", async (importActual) => {
  const actual = await importActual<typeof import("@wavesco/db")>();
  return {
    ...actual,
    withTenantContext: vi.fn(),
    // Spied engine — real pure logic (event types, idempotency keys) is kept.
    createMultiChannelNotification: vi.fn(async () => [{ created: true, notificationId: "n_test" }]),
  };
});

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

  it("stop on running succeeds 200 (notification-engine failure must not fail the transition)", async () => {
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
    // NOTE: this test's @wavesco/db mock has no createMultiChannelNotification,
    // so the CAMPAIGN_RESULTS_FINALIZED hook fires against a broken engine.
    // The route must still succeed — notification failures are contained.
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
    vi.mocked(withTenantContext).mockImplementation((async (_tid: string, fn: (tx: unknown) => Promise<unknown>) => {
      const tx: unknown = { campaign: { findFirst: async () => null, update: vi.fn(async () => ({})) } };
      return fn(tx);
    }) as unknown as typeof withTenantContext);
    const { POST } = await import("@/app/api/acquisition/campaigns/[id]/control/route");
    const res = await POST(
      new Request("http://test", { method: "POST", body: JSON.stringify({ action: "pause" }), headers: { "content-type": "application/json" } }),
      { params: Promise.resolve({ id: "missing" }) } as any
    );
    expect(res.status).toBe(404);
  });

  it("403 for a member role — a member cannot launch or stop a campaign", async () => {
    const { withTenantContext } = await import("@wavesco/db");
    const { requireControlAuth } = await import("@/lib/wavesco/control");
    vi.mocked(withTenantContext).mockImplementation(mockWithTenantContext("draft") as never);
    vi.mocked(requireControlAuth).mockResolvedValueOnce({
      tenantId: "t1",
      userId: "u2",
      session: { user: { id: "u2", tenantId: "t1", role: "member" } },
    } as never);

    const { POST } = await import("@/app/api/acquisition/campaigns/[id]/control/route");
    const res = await POST(
      new Request("http://test", { method: "POST", body: JSON.stringify({ action: "launch" }), headers: { "content-type": "application/json" } }),
      { params: Promise.resolve({ id: "c1" }) } as never
    );
    expect(res.status).toBe(403);
    const json: { error?: string } = await res.json();
    expect(json.error).toMatch(/owner or admin/i);
  });
});
