import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/wavesco/control", () => ({
  requireControlAuth: vi.fn(async () => {
    throw new Error("UNAUTHORIZED");
  }),
  auditControl: vi.fn(async () => ({ id: "audit1" })),
}));

vi.mock("@wavesco/db", () => ({
  withTenantContext: vi.fn(),
  prisma: { leadResearch: { findMany: vi.fn() } },
}));

vi.mock("@/lib/wavesco/lead-engine", () => ({
  listLeads: vi.fn(),
  getFacets: vi.fn(),
}));

describe("POST /api/acquisition/leads/export", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("401 without auth", async () => {
    const { POST } = await import("@/app/api/acquisition/leads/export/route");
    const res = await POST(
      new Request("http://test", {
        method: "POST",
        body: JSON.stringify({ q: "test" }),
        headers: { "content-type": "application/json" },
      })
    );
    expect(res.status).toBe(401);
  });

  it("200 with tenant returns CSV and audits", async () => {
    const { requireControlAuth, auditControl } = await import("@/lib/wavesco/control");
    const { withTenantContext } = await import("@wavesco/db");

    vi.mocked(requireControlAuth).mockResolvedValueOnce({
      tenantId: "t1",
      userId: "u1",
      session: { user: { id: "u1" } },
    } as any);
    vi.mocked(auditControl).mockResolvedValueOnce({ id: "a1" } as any);
    vi.mocked(withTenantContext).mockImplementationOnce(async (_tenantId: string, fn: any) => {
      const tx: any = {
        leadResearch: {
          findMany: async () => [
            {
              business: "Acme Salon",
              category: "Salon",
              city: "Pune",
              area: "Kothrud",
              tier: "A",
              leadScore: 92,
              email: "acme@example.com",
              website: "https://acme.example.com",
              rating: 4.5,
              reviews: 120,
            },
            {
              business: "Beta Spa",
              category: "Spa",
              city: "Mumbai",
              area: null,
              tier: "B",
              leadScore: 78,
              email: "beta@example.com",
              website: null,
              rating: null,
              reviews: null,
            },
          ],
        },
      };
      return fn(tx);
    });

    const { POST } = await import("@/app/api/acquisition/leads/export/route");
    const res = await POST(
      new Request("http://test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ q: "Acme", tier: "A", category: "Salon", city: "Pune" }),
      })
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    const disp = res.headers.get("content-disposition") ?? "";
    expect(disp).toContain("attachment");
    expect(disp).toContain("leads-export-");
    expect(disp).toContain(".csv");
    const text = await res.text();
    // header row
    expect(text).toContain("business");
    expect(text).toContain("category");
    expect(text).toContain("leadScore");
    // data rows
    expect(text).toContain("Acme Salon");
    expect(text).toContain("Beta Spa");
    expect(text).toContain("acme@example.com");
    // audit called with correct action/model
    expect(auditControl).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "leads.export",
        model: "LeadResearch",
        tenantId: "t1",
      })
    );
    // ensure withTenantContext was tenant-scoped
    expect(withTenantContext).toHaveBeenCalledWith("t1", expect.any(Function));
  });
});
