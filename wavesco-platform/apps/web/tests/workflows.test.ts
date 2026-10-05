import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/wavesco/control", () => ({
  acquisitionDenied: vi.fn(async () => null),
  requireControlAuth: vi.fn(async () => {
    throw new Error("UNAUTHORIZED");
  }),
  auditControl: vi.fn(async () => ({ id: "audit1" })),
}));

describe("GET /api/acquisition/workflows", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("401 without auth", async () => {
    const { requireControlAuth } = await import("@/lib/wavesco/control");
    vi.mocked(requireControlAuth).mockRejectedValueOnce(new Error("UNAUTHORIZED"));
    const { GET } = await import("@/app/api/acquisition/workflows/route");
    const res = await GET();
    expect(res.status).toBe(401);
  });
});

describe("n8n missing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns BLOCKED when N8N_BASE_URL missing", async () => {
    vi.stubEnv("N8N_BASE_URL", "");
    vi.stubEnv("N8N_API_KEY", "");
    const { requireControlAuth } = await import("@/lib/wavesco/control");
    vi.mocked(requireControlAuth).mockResolvedValueOnce({ tenantId: "t1", userId: "u1", session: {} } as any);
    const { GET } = await import("@/app/api/acquisition/workflows/route");
    const res = await GET();
    expect(res.status).toBe(200);
    const json: any = await res.json();
    expect(json.status).toBe("BLOCKED");
    expect(json.reason).toBe("N8N_BASE_URL missing");
    expect(Array.isArray(json.workflows)).toBe(true);
    expect(json.workflows.length).toBe(0);
  });

  it("control returns 400 BLOCKED when N8N_BASE_URL missing", async () => {
    vi.stubEnv("N8N_BASE_URL", "");
    const { requireControlAuth } = await import("@/lib/wavesco/control");
    vi.mocked(requireControlAuth).mockResolvedValueOnce({ tenantId: "t1", userId: "u1", session: {} } as any);
    const { POST } = await import("@/app/api/acquisition/workflows/[id]/control/route");
    const res = await POST(
      new Request("http://test", {
        method: "POST",
        body: JSON.stringify({ action: "enable" }),
        headers: { "content-type": "application/json" },
      }),
      { params: Promise.resolve({ id: "w1" }) } as any
    );
    expect(res.status).toBe(400);
    const json: any = await res.json();
    expect(json.status).toBe("BLOCKED");
    expect(json.reason).toBe("N8N_BASE_URL missing");
  });
});
