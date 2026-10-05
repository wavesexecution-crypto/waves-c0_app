import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("node:sqlite", () => ({
  DatabaseSync: class MockSync {
    constructor() {}
    prepare() { return { get: () => ({ c: 0 }), all: () => [] }; }
    exec() {}
    close() {}
  },
}));

vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  return { ...actual, existsSync: vi.fn(() => false), readFileSync: vi.fn(() => ""), readdirSync: vi.fn(() => []) };
});

vi.mock("@/lib/wavesco/lead-engine", () => ({
  leadEngineMode: vi.fn(() => "local"),
  leadEngineRoot: vi.fn(() => ""),
  getLastEngineRun: vi.fn(async () => null),
  listBatchManifests: vi.fn(async () => []),
  remoteAvailability: vi.fn(async () => ({ available: true, detail: "mocked" })),
}));

vi.mock("@/lib/wavesco/control", () => ({
  acquisitionDenied: vi.fn(async () => null),
  requireControlAuth: vi.fn(async () => {
    throw new Error("UNAUTHORIZED");
  }),
  auditControl: vi.fn(async () => ({ id: "audit1" })),
}));

vi.mock("@wavesco/db", () => ({
  withTenantContext: vi.fn(async (_tid: string, fn: any) => {
    // default mock for withTenantContext that provides a fake tx
    const fakeTx: any = {
      aiUsageLog: { count: vi.fn(async () => 0), findMany: vi.fn(async () => []) },
      clientAiConfig: { findFirst: vi.fn(async () => null) },
    };
    return fn(fakeTx);
  }),
  prisma: {
    $queryRaw: vi.fn(async () => [{ "?column?": 1 }]),
    clientAiConfig: { findFirst: vi.fn(async () => null) },
    aiUsageLog: { count: vi.fn(async () => 0), findMany: vi.fn(async () => []) },
  },
}));

describe("POST /api/acquisition/integrations/test", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  it("401 without auth", async () => {
    const { requireControlAuth } = await import("@/lib/wavesco/control");
    vi.mocked(requireControlAuth).mockRejectedValueOnce(new Error("UNAUTHORIZED"));
    const { POST } = await import("@/app/api/acquisition/integrations/test/route");
    const res = await POST(new Request("http://test", { method: "POST", body: JSON.stringify({ key: "n8n" }), headers: { "content-type": "application/json" } }));
    expect(res.status).toBe(401);
  });

  it("BLOCKED when missing credential does not leak key", async () => {
    vi.stubEnv("N8N_BASE_URL", "");
    vi.stubEnv("N8N_API_KEY", "");
    const { requireControlAuth } = await import("@/lib/wavesco/control");
    vi.mocked(requireControlAuth).mockResolvedValueOnce({ tenantId: "t1", userId: "u1", session: {} } as any);
    const { POST } = await import("@/app/api/acquisition/integrations/test/route");
    const res = await POST(
      new Request("http://test", {
        method: "POST",
        body: JSON.stringify({ key: "n8n" }),
        headers: { "content-type": "application/json" },
      })
    );
    expect(res.status).toBe(200);
    const json: any = await res.json();
    expect(json.status).toBe("BLOCKED");
    expect(JSON.stringify(json)).not.toMatch(/api_key|secret/i);
    // also ensure raw env values are not leaked
    const str = JSON.stringify(json).toLowerCase();
    expect(str).not.toContain("api_key");
    expect(str).not.toContain("secret");
  });
});
