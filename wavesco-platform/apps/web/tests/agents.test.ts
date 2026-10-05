import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/wavesco/control", () => ({
  acquisitionDenied: vi.fn(async () => null),
  requireControlAuth: vi.fn(async () => {
    throw new Error("UNAUTHORIZED");
  }),
  auditControl: vi.fn(async () => ({ id: "audit1" })),
}));

vi.mock("@wavesco/db", () => ({
  withTenantContext: vi.fn(),
  prisma: {
    clientAiConfig: { findFirst: vi.fn(), findUnique: vi.fn(), upsert: vi.fn(), update: vi.fn(), create: vi.fn() },
    aiUsageLog: { findMany: vi.fn() },
  },
}));

function makeTx(overrides: {
  config?: unknown;
  usage?: unknown[];
  updateMock?: ReturnType<typeof vi.fn>;
  upsertMock?: ReturnType<typeof vi.fn>;
  createMock?: ReturnType<typeof vi.fn>;
} = {}) {
  const updateMock = overrides.updateMock ?? vi.fn(async ({ data }: any) => ({ id: "cfg1", tenantId: "t1", ...((overrides.config as any) ?? {}), ...data }));
  const upsertMock = overrides.upsertMock ?? vi.fn(async ({ create, update }: any) => ({ id: "cfg1", tenantId: "t1", ...create, ...update }));
  const createMock = overrides.createMock ?? vi.fn(async ({ data }: any) => ({ id: "cfg1", tenantId: "t1", ...data }));
  const findFirstMock = vi.fn(async () => (overrides.config as any) ?? null);
  const findUniqueMock = vi.fn(async () => (overrides.config as any) ?? null);
  const findManyMock = vi.fn(async () => overrides.usage ?? []);
  return {
    clientAiConfig: {
      findFirst: findFirstMock,
      findUnique: findUniqueMock,
      update: updateMock,
      upsert: upsertMock,
      create: createMock,
    },
    aiUsageLog: {
      findMany: findManyMock,
      create: vi.fn(async (x: any) => x),
    },
    _mocks: { findFirstMock, findUniqueMock, updateMock, upsertMock, createMock, findManyMock },
  };
}

describe("GET /api/acquisition/agents", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("401 without auth", async () => {
    const { requireControlAuth } = await import("@/lib/wavesco/control");
    vi.mocked(requireControlAuth).mockRejectedValueOnce(new Error("UNAUTHORIZED"));
    const { GET } = await import("@/app/api/acquisition/agents/route");
    const res = await GET();
    expect(res.status).toBe(401);
    const json: any = await res.json().catch(() => ({}));
    expect(json.error).toBeDefined();
  });

  it("200 not_configured when no ClientAiConfig", async () => {
    const { requireControlAuth } = await import("@/lib/wavesco/control");
    const { withTenantContext } = await import("@wavesco/db");
    vi.mocked(requireControlAuth).mockResolvedValueOnce({ tenantId: "t1", userId: "u1", session: {} } as any);
    const tx = makeTx({ config: null, usage: [] });
    vi.mocked(withTenantContext).mockImplementationOnce(async (_tid: string, fn: any) => fn(tx));

    const { GET } = await import("@/app/api/acquisition/agents/route");
    const res = await GET();
    expect(res.status).toBe(200);
    const json: any = await res.json();
    expect(json.status).toBe("not_configured");
    expect(json.config).toBeNull();
    expect(json.gateway.status).toBe("not_configured");
    expect(Array.isArray(json.usage)).toBe(true);
  });

  it("200 returns config without credentialRef and masked baseUrl", async () => {
    const { requireControlAuth } = await import("@/lib/wavesco/control");
    const { withTenantContext } = await import("@wavesco/db");
    vi.mocked(requireControlAuth).mockResolvedValueOnce({ tenantId: "t1", userId: "u1", session: {} } as any);
    const config = {
      id: "cfg1",
      tenantId: "t1",
      aiEnabled: true,
      provider: "ollama_cloud",
      model: "gemma3:27b",
      baseUrl: "https://ollama.com/v1",
      credentialRef: "env:OLLAMA_KEY",
      obsidianRoot: null,
      config: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const usage = [
      { id: "u1", tenantId: "t1", operation: "enrich", provider: "ollama_cloud", model: "gemma3:27b", status: "success", inputTokens: 100, outputTokens: 50, latencyMs: 1200, error: null, createdAt: new Date().toISOString() },
      { id: "u2", tenantId: "t1", operation: "email", provider: "ollama_cloud", model: "gemma3:27b", status: "error", inputTokens: 10, outputTokens: 0, latencyMs: 300, error: "timeout", createdAt: new Date().toISOString() },
    ];
    const tx = makeTx({ config, usage });
    vi.mocked(withTenantContext).mockImplementationOnce(async (_tid: string, fn: any) => fn(tx));

    const { GET } = await import("@/app/api/acquisition/agents/route");
    const res = await GET();
    expect(res.status).toBe(200);
    const json: any = await res.json();
    // never leak credentialRef
    expect(JSON.stringify(json)).not.toContain("credentialRef");
    expect(JSON.stringify(json)).not.toContain("OLLAMA_KEY");
    expect(JSON.stringify(json)).not.toContain("env:OLLAMA_KEY");
    // baseUrl masked
    expect(json.gateway.baseUrl).toBeDefined();
    expect(json.gateway.baseUrl).not.toBe("https://ollama.com/v1");
    expect(json.gateway.baseUrl).toContain("***");
    expect(json.config.baseUrl).toContain("***");
    // gateway status ok when aiEnabled true
    expect(json.gateway.status).toBe("ok");
    expect(json.gateway.provider).toBe("ollama_cloud");
    expect(json.gateway.model).toBe("gemma3:27b");
    // usage & failures
    expect(json.usage.length).toBe(2);
    expect(json.failures.length).toBe(1);
    expect(json.failures[0].status).toBe("error");
    // limits placeholder
    expect(json.limits).toBeDefined();
  });

  it("disabled gateway when aiEnabled false", async () => {
    const { requireControlAuth } = await import("@/lib/wavesco/control");
    const { withTenantContext } = await import("@wavesco/db");
    vi.mocked(requireControlAuth).mockResolvedValueOnce({ tenantId: "t1", userId: "u1", session: {} } as any);
    const config = { id: "cfg1", tenantId: "t1", aiEnabled: false, provider: "ollama_cloud", model: "gemma3:27b", baseUrl: "https://ollama.com/v1", credentialRef: "env:X" };
    const tx = makeTx({ config, usage: [] });
    vi.mocked(withTenantContext).mockImplementationOnce(async (_tid: string, fn: any) => fn(tx));
    const { GET } = await import("@/app/api/acquisition/agents/route");
    const res = await GET();
    const json: any = await res.json();
    expect(json.gateway.status).toBe("disabled");
  });
});

describe("POST /api/acquisition/agents — toggle and configure", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("401 without auth", async () => {
    const { requireControlAuth } = await import("@/lib/wavesco/control");
    vi.mocked(requireControlAuth).mockRejectedValueOnce(new Error("UNAUTHORIZED"));
    const { POST } = await import("@/app/api/acquisition/agents/route");
    const res = await POST(new Request("http://test", { method: "POST", body: JSON.stringify({ action: "enable" }), headers: { "content-type": "application/json" } }));
    expect(res.status).toBe(401);
  });

  it("toggle enable writes AuditLog and flips aiEnabled", async () => {
    const { requireControlAuth, auditControl } = await import("@/lib/wavesco/control");
    const { withTenantContext } = await import("@wavesco/db");
    vi.mocked(requireControlAuth).mockResolvedValueOnce({ tenantId: "t1", userId: "u1", session: {} } as any);
    const before = { id: "cfg1", tenantId: "t1", aiEnabled: false, provider: "ollama_cloud", model: "gemma3:27b", baseUrl: "https://ollama.com/v1", credentialRef: "env:X" };
    const updateMock = vi.fn(async () => ({ ...before, aiEnabled: true }));
    const tx = makeTx({ config: before, updateMock });
    // withTenantContext should call fn with tx and return whatever POST returns (which will be result of update)
    vi.mocked(withTenantContext).mockImplementationOnce(async (_tid: string, fn: any) => {
      // simulate POST's internal logic: it will call findFirst then update, then auditControl
      // we need to make fn handle that; easiest: just call fn(tx) and let fn do its work, but fn will call tx.clientAiConfig.update which is mocked above
      // To also capture audit, we let fn run; auditControl is mocked separately
      return fn(tx);
    });

    const { POST } = await import("@/app/api/acquisition/agents/route");
    const res = await POST(new Request("http://test", { method: "POST", body: JSON.stringify({ action: "enable" }), headers: { "content-type": "application/json" } }));
    expect(res.status).toBe(200);
    const json: any = await res.json();
    expect(json.status).toBe("ok");
    // audit called with agent.enable and ClientAiConfig
    expect(auditControl).toHaveBeenCalledWith(expect.objectContaining({ action: "agent.enable", model: "ClientAiConfig", tenantId: "t1" }));
    const call: any = vi.mocked(auditControl).mock.calls[0]?.[0];
    expect(call.before).toBeDefined();
    expect(call.after).toBeDefined();
    // never leak credentialRef in response
    expect(JSON.stringify(json)).not.toContain("credentialRef");
  });

  it("toggle disable writes AuditLog", async () => {
    const { requireControlAuth, auditControl } = await import("@/lib/wavesco/control");
    const { withTenantContext } = await import("@wavesco/db");
    vi.mocked(requireControlAuth).mockResolvedValueOnce({ tenantId: "t1", userId: "u1", session: {} } as any);
    const before = { id: "cfg1", tenantId: "t1", aiEnabled: true, provider: "ollama_cloud", model: "gemma3:27b", baseUrl: "https://ollama.com/v1", credentialRef: "env:X" };
    const updateMock = vi.fn(async () => ({ ...before, aiEnabled: false }));
    const tx = makeTx({ config: before, updateMock });
    vi.mocked(withTenantContext).mockImplementationOnce(async (_tid: string, fn: any) => fn(tx));

    const { POST } = await import("@/app/api/acquisition/agents/route");
    const res = await POST(new Request("http://test", { method: "POST", body: JSON.stringify({ action: "disable" }), headers: { "content-type": "application/json" } }));
    expect(res.status).toBe(200);
    expect(auditControl).toHaveBeenCalledWith(expect.objectContaining({ action: "agent.disable" }));
  });

  it("configure updates provider/model/baseUrl and audits", async () => {
    const { requireControlAuth, auditControl } = await import("@/lib/wavesco/control");
    const { withTenantContext } = await import("@wavesco/db");
    vi.mocked(requireControlAuth).mockResolvedValueOnce({ tenantId: "t1", userId: "u1", session: {} } as any);
    const before = { id: "cfg1", tenantId: "t1", aiEnabled: false, provider: "ollama_cloud", model: "old", baseUrl: "https://old.com", credentialRef: "env:X" };
    const updateMock = vi.fn(async ({ data }: any) => ({ ...before, ...data }));
    const tx = makeTx({ config: before, updateMock });
    vi.mocked(withTenantContext).mockImplementationOnce(async (_tid: string, fn: any) => fn(tx));

    const { POST } = await import("@/app/api/acquisition/agents/route");
    const res = await POST(
      new Request("http://test", {
        method: "POST",
        body: JSON.stringify({ action: "configure", config: { provider: "ollama_cloud", model: "gemma3:27b", baseUrl: "https://ollama.com/v1" } }),
        headers: { "content-type": "application/json" },
      })
    );
    expect(res.status).toBe(200);
    expect(auditControl).toHaveBeenCalledWith(expect.objectContaining({ action: "agent.configure", model: "ClientAiConfig" }));
    const json: any = await res.json();
    expect(json.config.provider).toBe("ollama_cloud");
    // baseUrl masked in response, original not leaked raw? Should be masked
    expect(json.config.baseUrl).toContain("***");
    expect(JSON.stringify(json)).not.toContain("env:X");
    expect(updateMock).toHaveBeenCalled();
  });

  it("invalid action returns 400", async () => {
    const { requireControlAuth } = await import("@/lib/wavesco/control");
    vi.mocked(requireControlAuth).mockResolvedValueOnce({ tenantId: "t1", userId: "u1", session: {} } as any);
    const { POST } = await import("@/app/api/acquisition/agents/route");
    const res = await POST(new Request("http://test", { method: "POST", body: JSON.stringify({ action: "explode" }), headers: { "content-type": "application/json" } }));
    expect(res.status).toBe(400);
  });

  it("control route POST enable also audits", async () => {
    const { requireControlAuth, auditControl } = await import("@/lib/wavesco/control");
    const { withTenantContext } = await import("@wavesco/db");
    vi.mocked(requireControlAuth).mockResolvedValueOnce({ tenantId: "t1", userId: "u1", session: {} } as any);
    const before = { id: "cfg1", tenantId: "t1", aiEnabled: false, provider: "ollama_cloud", model: "gemma3:27b", baseUrl: null, credentialRef: null };
    const updateMock = vi.fn(async () => ({ ...before, aiEnabled: true }));
    const tx = makeTx({ config: before, updateMock });
    vi.mocked(withTenantContext).mockImplementationOnce(async (_tid: string, fn: any) => fn(tx));

    const { POST } = await import("@/app/api/acquisition/agents/control/route");
    const res = await POST(new Request("http://test", { method: "POST", body: JSON.stringify({ action: "enable" }), headers: { "content-type": "application/json" } }));
    expect(res.status).toBe(200);
    expect(auditControl).toHaveBeenCalledWith(expect.objectContaining({ action: "agent.enable" }));
  });
});
