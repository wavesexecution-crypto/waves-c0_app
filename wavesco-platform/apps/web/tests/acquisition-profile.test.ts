import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/wavesco/control", () => ({
  requireControlAuth: vi.fn(),
  auditControl: vi.fn(async () => ({ id: "audit1" })),
}));
vi.mock("@wavesco/db", () => ({
  withTenantContext: vi.fn(),
  prisma: { auditLog: { create: vi.fn() } },
}));
vi.mock("@/lib/wavesco/integrations", () => ({
  getIntegrationsHealth: vi.fn(async () => ({ n8n: { status: "ok" }, db: { status: "ok" } })),
  maskUrl: vi.fn((u: string) => (u ? "https://***" : null)),
}));

describe("Acquisition Profile — lib readiness", () => {
  it("DRAFT when no profile", async () => {
    const { readinessCheck } = await import("@/lib/wavesco/acquisition-profile");
    const r = readinessCheck(null);
    expect(r.ready).toBe(false);
    expect(r.status).toBe("DRAFT");
    expect(r.missing.length).toBeGreaterThan(0);
    expect(r.present.length).toBe(0);
  });

  it("INCOMPLETE when missing required", async () => {
    const { readinessCheck } = await import("@/lib/wavesco/acquisition-profile");
    const r = readinessCheck({
      id: "p1",
      tenantId: "t1",
      status: "DRAFT",
      version: 1,
      companyName: "ACME",
      website: null,
      industry: null,
      whatWeSell: null,
      acquisitionObjective: null,
      primaryObjective: null,
      icp: { targetCustomer: "Founders" },
      offer: {},
    } as any);
    expect(r.ready).toBe(false);
    expect(r.status).toBe("INCOMPLETE");
    expect(r.missing).toContain("Website");
  });

  it("READY when all required present", async () => {
    const { readinessCheck } = await import("@/lib/wavesco/acquisition-profile");
    const r = readinessCheck({
      id: "p1",
      tenantId: "t1",
      status: "DRAFT",
      version: 1,
      companyName: "WavesCo",
      website: "https://wavesco.in",
      industry: "B2B Services",
      whatWeSell: "OS installs",
      acquisitionObjective: "leads",
      primaryObjective: "30 qualified leads",
      icp: { targetCustomer: "Founders", geography: "Navi Mumbai" },
      offer: { productService: "Acquisition OS rental" },
    } as any);
    expect(r.ready).toBe(true);
    expect(r.status).toBe("READY");
  });

  it("validateProfileInput strips unknown keys and validates website", async () => {
    const { validateProfileInput } = await import("@/lib/wavesco/acquisition-profile");
    const { valid, errors, sanitized } = validateProfileInput({
      companyName: "ACME",
      website: "not a url",
      unknownField: "evil",
      agents: "should be stripped",
    } as any);
    expect(valid).toBe(false);
    expect(errors.length).toBeGreaterThan(0);
    expect((sanitized as any).unknownField).toBeUndefined();
    expect((sanitized as any).agents).toBeUndefined();
  });

  it("nextStatusForAction guards activate when not ready", async () => {
    const { nextStatusForAction, readinessCheck } = await import("@/lib/wavesco/acquisition-profile");
    const r = readinessCheck(null);
    const res = nextStatusForAction("READY", "activate", r);
    expect(res.next).toBeNull();
    expect(res.error).toMatch(/missing/);
  });

  it("nextStatusForAction allows activate when ready", async () => {
    const { nextStatusForAction, readinessCheck } = await import("@/lib/wavesco/acquisition-profile");
    const r = readinessCheck({
      id: "p1",
      tenantId: "t1",
      status: "READY",
      version: 1,
      companyName: "WavesCo",
      website: "https://wavesco.in",
      industry: "B2B",
      whatWeSell: "OS",
      acquisitionObjective: "leads",
      primaryObjective: "30",
      icp: { targetCustomer: "Founders", geography: "Mumbai" },
      offer: { productService: "OS" },
    } as any);
    const res = nextStatusForAction("READY", "activate", r);
    expect(res.next).toBe("ACTIVE");
  });

  it("buildAgentContext masks website and redacts secrets", async () => {
    const { buildAgentContext } = await import("@/lib/wavesco/acquisition-profile");
    const ctx = await buildAgentContext("t1", {
      id: "p1",
      tenantId: "t1",
      status: "READY",
      version: 1,
      companyName: "ACME",
      website: "https://acme.com/secret?token=abc",
      industry: "SaaS",
      whatWeSell: "Tools",
      acquisitionObjective: "leads",
      primaryObjective: "10",
      icp: { targetCustomer: "CTOs", geography: "Pune", api_key: "should redact" },
      offer: { productService: "Tool", credentialRef: "env:SECRET" },
    } as any, { integrationsHealth: { db: { status: "ok" } } });
    expect(ctx.company.websiteMasked).toBe("https://***");
    expect(JSON.stringify(ctx)).not.toMatch(/should redact/);
    expect(JSON.stringify(ctx)).not.toMatch(/env:SECRET/);
    expect(ctx.meta.model).toBe("nemotron-3-super");
    expect(ctx.current_state.tenantId).toBe("t1");
  });
});

describe("GET /api/acquisition/profile", () => {
  beforeEach(() => vi.clearAllMocks());

  it("401 without auth", async () => {
    const { requireControlAuth } = await import("@/lib/wavesco/control");
    vi.mocked(requireControlAuth).mockRejectedValueOnce(new Error("UNAUTHORIZED"));
    const { GET } = await import("@/app/api/acquisition/profile/route");
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("returns DRAFT readiness when no profile", async () => {
    const { requireControlAuth } = await import("@/lib/wavesco/control");
    const { withTenantContext } = await import("@wavesco/db");
    vi.mocked(requireControlAuth).mockResolvedValue({ tenantId: "t1", userId: "u1", session: {} } as any);
    vi.mocked(withTenantContext).mockImplementation(async (_tid: string, fn: any) => {
      const tx: any = {
        acquisitionProfile: { findFirst: async () => null },
      };
      return fn(tx);
    });
    const { GET } = await import("@/app/api/acquisition/profile/route");
    const res = await GET();
    expect(res.status).toBe(200);
    const j: any = await res.json();
    expect(j.exists).toBe(false);
    expect(j.readiness.status).toBe("DRAFT");
    expect(j.readiness.ready).toBe(false);
  });

  it("returns profile and readiness when exists (tenant-isolated)", async () => {
    const { requireControlAuth } = await import("@/lib/wavesco/control");
    const { withTenantContext } = await import("@wavesco/db");
    vi.mocked(requireControlAuth).mockResolvedValue({ tenantId: "t1", userId: "u1", session: {} } as any);
    const mockProfile = {
      id: "p1",
      tenantId: "t1",
      status: "READY",
      version: 1,
      companyName: "WavesCo",
      website: "https://wavesco.in",
      industry: "B2B",
      whatWeSell: "OS",
      acquisitionObjective: "leads",
      primaryObjective: "30",
      icp: { targetCustomer: "Founders", geography: "Mumbai" },
      offer: { productService: "OS" },
    };
    vi.mocked(withTenantContext).mockImplementation(async (tid: string, fn: any) => {
      expect(tid).toBe("t1");
      const tx: any = {
        acquisitionProfile: { findFirst: async ({ where }: any) => {
          expect(where.tenantId).toBe("t1");
          return mockProfile;
        }},
        acquisitionDataImport: { findMany: async () => [] },
      };
      return fn(tx);
    });
    const { GET } = await import("@/app/api/acquisition/profile/route");
    const res = await GET();
    expect(res.status).toBe(200);
    const j: any = await res.json();
    expect(j.profile.companyName).toBe("WavesCo");
    expect(j.readiness.ready).toBe(true);
    expect(j.readiness.status).toBe("READY");
  });
});

describe("POST /api/acquisition/profile", () => {
  beforeEach(() => vi.clearAllMocks());

  it("creates profile and logs audit", async () => {
    const { requireControlAuth, auditControl } = await import("@/lib/wavesco/control");
    const { withTenantContext } = await import("@wavesco/db");
    vi.mocked(requireControlAuth).mockResolvedValue({ tenantId: "t2", userId: "u2", session: {} } as any);
    vi.mocked(withTenantContext).mockImplementation(async (_tid: string, fn: any) => {
      const tx: any = {
        acquisitionProfile: {
          findFirst: async () => null,
          create: async ({ data }: any) => ({ id: "p_new", ...data }),
        },
      };
      return fn(tx);
    });
    const { POST } = await import("@/app/api/acquisition/profile/route");
    const res = await POST(new Request("http://test", { method: "POST", body: JSON.stringify({ companyName: "ACME", website: "https://acme.com", industry: "SaaS", whatWeSell: "Widgets", acquisitionObjective: "leads", primaryObjective: "10 leads", icp: { targetCustomer: "CTO", geography: "Pune" }, offer: { productService: "Widget OS" } }) }));
    expect(res.status).toBe(200);
    const j: any = await res.json();
    expect(j.profile.companyName).toBe("ACME");
    expect(j.readiness.ready).toBe(true);
    expect(vi.mocked(auditControl).mock.calls.some((c: any) => c[0].action === "acquisition_profile.create")).toBe(true);
  });

  it("rejects invalid website", async () => {
    const { requireControlAuth } = await import("@/lib/wavesco/control");
    vi.mocked(requireControlAuth).mockResolvedValue({ tenantId: "t1", userId: "u1", session: {} } as any);
    const { POST } = await import("@/app/api/acquisition/profile/route");
    const res = await POST(new Request("http://test", { method: "POST", body: JSON.stringify({ website: "ht!tp:// bad" }) }));
    expect(res.status).toBe(400);
  });

  it("does not expose credentialRef in response", async () => {
    const { requireControlAuth } = await import("@/lib/wavesco/control");
    const { withTenantContext } = await import("@wavesco/db");
    vi.mocked(requireControlAuth).mockResolvedValue({ tenantId: "t3", userId: "u3", session: {} } as any);
    vi.mocked(withTenantContext).mockImplementation(async (_tid: string, fn: any) => {
      const tx: any = {
        acquisitionProfile: {
          findFirst: async () => null,
          create: async ({ data }: any) => ({ id: "p3", ...data }),
        },
      };
      return fn(tx);
    });
    const { POST } = await import("@/app/api/acquisition/profile/route");
    const res = await POST(new Request("http://test", { method: "POST", body: JSON.stringify({ companyName: "ACME", icp: { api_key: "secret123" } }) }));
    const text = await res.text();
    expect(text).not.toMatch(/secret123/);
  });
});

describe("POST /api/acquisition/profile/control", () => {
  beforeEach(() => vi.clearAllMocks());

  it("401 without auth", async () => {
    const { requireControlAuth } = await import("@/lib/wavesco/control");
    vi.mocked(requireControlAuth).mockRejectedValueOnce(new Error("UNAUTHORIZED"));
    const { POST } = await import("@/app/api/acquisition/profile/control/route");
    const res = await POST(new Request("http://test", { method: "POST", body: JSON.stringify({ action: "activate" }) }));
    expect(res.status).toBe(401);
  });

  it("rejects activate when INCOMPLETE", async () => {
    const { requireControlAuth } = await import("@/lib/wavesco/control");
    const { withTenantContext } = await import("@wavesco/db");
    vi.mocked(requireControlAuth).mockResolvedValue({ tenantId: "t1", userId: "u1", session: {} } as any);
    vi.mocked(withTenantContext).mockImplementation(async (_tid: string, fn: any) => {
      const tx: any = {
        acquisitionProfile: {
          findFirst: async () => ({
            id: "p1",
            tenantId: "t1",
            status: "INCOMPLETE",
            version: 1,
            companyName: "ACME",
            website: null,
            industry: null,
            whatWeSell: null,
            acquisitionObjective: null,
            primaryObjective: null,
            icp: {},
            offer: {},
          }),
        },
        activityEvent: { create: async () => ({}) },
      };
      return fn(tx);
    });
    const { POST } = await import("@/app/api/acquisition/profile/control/route");
    const res = await POST(new Request("http://test", { method: "POST", body: JSON.stringify({ action: "activate" }) }));
    expect(res.status).toBe(400);
    const j: any = await res.json();
    expect(j.error).toMatch(/missing/);
  });

  it("activates when READY and audits", async () => {
    const { requireControlAuth, auditControl } = await import("@/lib/wavesco/control");
    const { withTenantContext } = await import("@wavesco/db");
    vi.mocked(requireControlAuth).mockResolvedValue({ tenantId: "t1", userId: "u1", session: {} } as any);
    const readyProfile = {
      id: "p1",
      tenantId: "t1",
      status: "READY",
      version: 1,
      companyName: "WavesCo",
      website: "https://wavesco.in",
      industry: "B2B",
      whatWeSell: "OS",
      acquisitionObjective: "leads",
      primaryObjective: "30",
      icp: { targetCustomer: "Founders", geography: "Mumbai" },
      offer: { productService: "OS" },
    };
    vi.mocked(withTenantContext).mockImplementation(async (_tid: string, fn: any) => {
      const tx: any = {
        acquisitionProfile: {
          findFirst: async () => readyProfile,
          update: async ({ data }: any) => ({ ...readyProfile, ...data, status: "ACTIVE" }),
        },
        activityEvent: { create: async () => ({}) },
      };
      return fn(tx);
    });
    const { POST } = await import("@/app/api/acquisition/profile/control/route");
    const res = await POST(new Request("http://test", { method: "POST", body: JSON.stringify({ action: "activate" }) }));
    expect(res.status).toBe(200);
    const j: any = await res.json();
    expect(j.nextStatus).toBe("ACTIVE");
    expect(vi.mocked(auditControl).mock.calls.some((c: any) => c[0].action === "acquisition_profile.activate")).toBe(true);
  });

  it("pause/resume cycle", async () => {
    const { requireControlAuth } = await import("@/lib/wavesco/control");
    const { withTenantContext } = await import("@wavesco/db");
    // pause
    vi.mocked(requireControlAuth).mockResolvedValue({ tenantId: "t1", userId: "u1", session: {} } as any);
    const activeProfile: any = {
      id: "p1",
      tenantId: "t1",
      status: "ACTIVE",
      version: 2,
      companyName: "WavesCo",
      website: "https://wavesco.in",
      industry: "B2B",
      whatWeSell: "OS",
      acquisitionObjective: "leads",
      primaryObjective: "30",
      icp: { targetCustomer: "Founders", geography: "Mumbai" },
      offer: { productService: "OS" },
    };
    vi.mocked(withTenantContext).mockImplementationOnce(async (_tid: string, fn: any) => {
      const tx: any = {
        acquisitionProfile: { findFirst: async () => activeProfile, update: async ({ data }: any) => ({ ...activeProfile, ...data, status: "PAUSED" }) },
        activityEvent: { create: async () => ({}) },
      };
      return fn(tx);
    });
    let { POST } = await import("@/app/api/acquisition/profile/control/route");
    let res = await POST(new Request("http://test", { method: "POST", body: JSON.stringify({ action: "pause" }) }));
    expect(res.status).toBe(200);
    // resume
    const pausedProfile = { ...activeProfile, status: "PAUSED" };
    vi.mocked(withTenantContext).mockImplementationOnce(async (_tid: string, fn: any) => {
      const tx: any = {
        acquisitionProfile: { findFirst: async () => pausedProfile, update: async ({ data }: any) => ({ ...pausedProfile, ...data, status: "ACTIVE" }) },
        activityEvent: { create: async () => ({}) },
      };
      return fn(tx);
    });
    res = await POST(new Request("http://test", { method: "POST", body: JSON.stringify({ action: "resume" }) }));
    expect(res.status).toBe(200);
    const j: any = await res.json();
    expect(j.nextStatus).toBe("ACTIVE");
  });
});

describe("POST /api/acquisition/profile/import", () => {
  beforeEach(() => vi.clearAllMocks());
  it("401 without auth", async () => {
    const { requireControlAuth } = await import("@/lib/wavesco/control");
    vi.mocked(requireControlAuth).mockRejectedValueOnce(new Error("UNAUTHORIZED"));
    const { POST } = await import("@/app/api/acquisition/profile/import/route");
    const res = await POST(new Request("http://test", { method: "POST", body: JSON.stringify({ fileName: "a.csv" }) }));
    expect(res.status).toBe(401);
  });
  it("records import and audits with tenant isolation", async () => {
    const { requireControlAuth, auditControl } = await import("@/lib/wavesco/control");
    const { withTenantContext } = await import("@wavesco/db");
    vi.mocked(requireControlAuth).mockResolvedValue({ tenantId: "t_import", userId: "u1", session: {} } as any);
    vi.mocked(withTenantContext).mockImplementation(async (tid: string, fn: any) => {
      expect(tid).toBe("t_import");
      const tx: any = {
        acquisitionProfile: { findFirst: async () => ({ id: "p1", tenantId: "t_import" }), create: async ({ data }: any) => ({ id: "p1", ...data }) },
        acquisitionDataImport: { create: async ({ data }: any) => ({ id: "imp1", ...data }) },
      };
      return fn(tx);
    });
    const { POST } = await import("@/app/api/acquisition/profile/import/route");
    const res = await POST(new Request("http://test", { method: "POST", body: JSON.stringify({ fileName: "leads.csv", fileType: "csv", rowCount: 120 }) }));
    expect(res.status).toBe(200);
    const j: any = await res.json();
    expect(j.import.fileName).toBe("leads.csv");
    expect(vi.mocked(auditControl).mock.calls.some((c: any) => c[0].action === "acquisition_profile.import")).toBe(true);
  });
});

describe("GET /api/acquisition/profile/context", () => {
  beforeEach(() => vi.clearAllMocks());
  it("401 without auth", async () => {
    const { requireControlAuth } = await import("@/lib/wavesco/control");
    vi.mocked(requireControlAuth).mockRejectedValueOnce(new Error("UNAUTHORIZED"));
    const { GET } = await import("@/app/api/acquisition/profile/context/route");
    const res = await GET();
    expect(res.status).toBe(401);
  });
  it("returns masked context without secrets", async () => {
    const { requireControlAuth } = await import("@/lib/wavesco/control");
    const { withTenantContext } = await import("@wavesco/db");
    vi.mocked(requireControlAuth).mockResolvedValue({ tenantId: "t1", userId: "u1", session: {} } as any);
    const profile = {
      id: "p1",
      tenantId: "t1",
      status: "ACTIVE",
      version: 3,
      companyName: "ACME",
      website: "https://acme.com/secret",
      industry: "SaaS",
      whatWeSell: "Widgets",
      acquisitionObjective: "leads",
      primaryObjective: "10",
      icp: { targetCustomer: "CTO", geography: "Pune", credentialRef: "env:SECRET" },
      offer: { productService: "OS" },
      integrations: { email: "brevo" },
      rules: {},
    };
    vi.mocked(withTenantContext).mockImplementation(async (_tid: string, fn: any) => {
      const tx: any = {
        acquisitionProfile: { findFirst: async () => profile },
        campaign: { findMany: async () => [] },
        outreachOrder: { findMany: async () => [], count: async () => 0 },
        leadResearch: { count: async () => 5 },
        activityEvent: { findMany: async () => [] },
        acquisitionDataImport: { findMany: async () => [] },
      };
      return fn(tx);
    });
    // also need withTenantContext for buildAgentContext inner call — second call for imports
    const { GET } = await import("@/app/api/acquisition/profile/context/route");
    const res = await GET();
    expect(res.status).toBe(200);
    const j: any = await res.json();
    expect(j.context.company.websiteMasked).toBe("https://***");
    expect(JSON.stringify(j.context)).not.toMatch(/env:SECRET/);
    expect(j.context.meta.model).toBe("nemotron-3-super");
    expect(j.context.current_state.tenantId).toBe("t1");
  });
});
