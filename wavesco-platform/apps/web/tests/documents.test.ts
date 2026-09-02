import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/wavesco/control", () => ({
  requireControlAuth: vi.fn(async () => {
    throw new Error("UNAUTHORIZED");
  }),
  auditControl: vi.fn(async () => ({ id: "audit1" })),
}));

vi.mock("@wavesco/db", () => ({
  withTenantContext: vi.fn(),
  prisma: {
    generationBatch: { findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn() },
    activityEvent: { findMany: vi.fn() },
    auditLog: { create: vi.fn() },
  },
}));

describe("POST /api/acquisition/documents/generate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("401 without auth", async () => {
    const { requireControlAuth } = await import("@/lib/wavesco/control");
    vi.mocked(requireControlAuth).mockRejectedValueOnce(new Error("UNAUTHORIZED"));
    const { POST } = await import("@/app/api/acquisition/documents/generate/route");
    const res = await POST(new Request("http://test", { method: "POST", body: JSON.stringify({}) }));
    expect(res.status).toBe(401);
    const json: any = await res.json().catch(() => ({}));
    expect(json.error).toBeDefined();
  });

  it("400 without valid batch", async () => {
    const { requireControlAuth } = await import("@/lib/wavesco/control");
    const { withTenantContext } = await import("@wavesco/db");
    vi.mocked(requireControlAuth).mockResolvedValueOnce({ tenantId: "t1", userId: "u1", session: {} } as any);
    // batchId provided but not found -> 400; tx returns null
    vi.mocked(withTenantContext).mockImplementationOnce(async (_tid: string, fn: any) => {
      const tx: any = {
        generationBatch: {
          findFirst: async () => null,
          findUnique: async () => null,
        },
      };
      return fn(tx);
    });
    const { POST } = await import("@/app/api/acquisition/documents/generate/route");
    const res = await POST(
      new Request("http://test", {
        method: "POST",
        body: JSON.stringify({ batchId: "missing-batch-id" }),
        headers: { "content-type": "application/json" },
      })
    );
    expect(res.status).toBe(400);
    const json: any = await res.json();
    expect(json.error).toMatch(/batch/i);
  });

  it("400 when no batchId and no params", async () => {
    const { requireControlAuth } = await import("@/lib/wavesco/control");
    vi.mocked(requireControlAuth).mockResolvedValueOnce({ tenantId: "t1", userId: "u1", session: {} } as any);
    const { POST } = await import("@/app/api/acquisition/documents/generate/route");
    const res = await POST(
      new Request("http://test", {
        method: "POST",
        body: JSON.stringify({}),
        headers: { "content-type": "application/json" },
      })
    );
    expect(res.status).toBe(400);
  });

  it("200 with valid batch logs AuditLog", async () => {
    const { requireControlAuth, auditControl } = await import("@/lib/wavesco/control");
    const { withTenantContext } = await import("@wavesco/db");
    vi.mocked(requireControlAuth).mockResolvedValueOnce({ tenantId: "t1", userId: "u1", session: {} } as any);
    const batch = {
      id: "batch1",
      tenantId: "t1",
      requestId: "gen_abc123",
      status: "completed",
      params: { category: "Salon" },
      engineBatchId: "eng_123",
      pdfPath: "/tmp/report.pdf",
      excelPath: "/tmp/report.xlsx",
      createdAt: new Date().toISOString(),
    };
    vi.mocked(withTenantContext).mockImplementationOnce(async (_tid: string, fn: any) => {
      const tx: any = {
        generationBatch: {
          findFirst: async () => batch,
          findUnique: async () => batch,
        },
      };
      return fn(tx);
    });
    const { POST } = await import("@/app/api/acquisition/documents/generate/route");
    const res = await POST(
      new Request("http://test", {
        method: "POST",
        body: JSON.stringify({ batchId: "batch1" }),
        headers: { "content-type": "application/json" },
      })
    );
    expect(res.status).toBe(200);
    const json: any = await res.json();
    expect(json.batchId).toBe("batch1");
    expect(json.status).toBe("completed");
    expect(auditControl).toHaveBeenCalledWith(
      expect.objectContaining({ action: "document.generate", model: "GenerationBatch", tenantId: "t1" })
    );
    const call: any = vi.mocked(auditControl).mock.calls[0]?.[0];
    expect(call.recordId).toBe("batch1");
    // never expose secrets
    expect(JSON.stringify(json).toLowerCase()).not.toContain("secret");
  });

  it("200 with params creates new batch and audits", async () => {
    const { requireControlAuth, auditControl } = await import("@/lib/wavesco/control");
    const { withTenantContext } = await import("@wavesco/db");
    vi.mocked(requireControlAuth).mockResolvedValueOnce({ tenantId: "t1", userId: "u1", session: {} } as any);
    const created = {
      id: "newbatch1",
      tenantId: "t1",
      requestId: "gen_new123",
      status: "queued",
      params: { category: "Salon", city: "Pune", tier: "A", count: 10 },
      createdAt: new Date().toISOString(),
    };
    vi.mocked(withTenantContext).mockImplementationOnce(async (_tid: string, fn: any) => {
      const tx: any = {
        generationBatch: {
          findFirst: async () => null,
          create: async ({ data }: any) => ({ ...created, ...data, id: created.id }),
        },
      };
      return fn(tx);
    });
    const { POST } = await import("@/app/api/acquisition/documents/generate/route");
    const res = await POST(
      new Request("http://test", {
        method: "POST",
        body: JSON.stringify({ params: { category: "Salon", city: "Pune", tier: "A", count: 10 } }),
        headers: { "content-type": "application/json" },
      })
    );
    expect(res.status).toBe(200);
    const json: any = await res.json();
    expect(json.batchId).toBe("newbatch1");
    expect(json.status).toBe("queued");
    expect(json.requestId).toBeDefined();
    expect(auditControl).toHaveBeenCalledWith(
      expect.objectContaining({ action: "document.generate", model: "GenerationBatch" })
    );
    // tenant-scoped: withTenantContext called with correct tenant
    expect(withTenantContext).toHaveBeenCalledWith("t1", expect.any(Function));
  });
});
