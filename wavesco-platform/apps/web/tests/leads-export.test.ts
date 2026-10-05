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
  prisma: { leadResearch: { findMany: vi.fn() } },
}));

vi.mock("@/lib/wavesco/lead-engine", () => ({
  listLeads: vi.fn(),
  getFacets: vi.fn(),
}));

const CORPUS = [
  {
    business: "Acme Salon",
    category: "Salon",
    city: "Pune",
    area: "Kothrud",
    tier: "A",
    leadScore: 92,
    email: "acme@example.com",
    email_status: "Verified",
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
    email_status: "Unverified",
    website: null,
    rating: null,
    reviews: null,
  },
];

describe("POST /api/acquisition/leads/export", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  async function authed() {
    const { requireControlAuth, auditControl } = await import("@/lib/wavesco/control");
    vi.mocked(requireControlAuth).mockResolvedValueOnce({
      tenantId: "t1",
      userId: "u1",
      session: { user: { id: "u1" } },
    } as never);
    vi.mocked(auditControl).mockResolvedValueOnce({ id: "a1" } as never);
  }

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

  it("200 exports the corpus the Leads table renders, not a different dataset", async () => {
    await authed();
    const { listLeads } = await import("@/lib/wavesco/lead-engine");
    vi.mocked(listLeads).mockResolvedValueOnce({
      rows: CORPUS,
      total: 2,
      page: 1,
      pageSize: 1000,
    } as never);

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
    expect(text).toContain("business");
    expect(text).toContain("leadScore");
    expect(text).toContain("Acme Salon");
    expect(text).toContain("Beta Spa");
    expect(text).toContain("acme@example.com");
    // Verification state is part of the export, so an "Unverified" row cannot
    // be mistaken for a sendable one.
    expect(text).toContain("email_status");
    expect(text).toContain("Unverified");

    // Filters are forwarded to the same query the page uses.
    expect(listLeads).toHaveBeenCalledWith(
      expect.objectContaining({ search: "Acme", tier: "A", category: "Salon", city: "Pune", sort: "score" })
    );
  });

  it("discloses truncation instead of silently capping at the row limit", async () => {
    await authed();
    const { listLeads } = await import("@/lib/wavesco/lead-engine");
    vi.mocked(listLeads).mockResolvedValueOnce({
      rows: CORPUS,
      total: 5240,
      page: 1,
      pageSize: 1000,
    } as never);

    const { POST } = await import("@/app/api/acquisition/leads/export/route");
    const res = await POST(
      new Request("http://test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ q: "salon" }),
      })
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("x-truncated")).toBe("true");
    expect(res.headers.get("x-total-rows")).toBe("5240");
    expect(res.headers.get("x-exported-rows")).toBe("2");
    const text = await res.text();
    expect(text).toContain("top 2 of 5240");
  });

  it("audit records the filter set and both counts", async () => {
    await authed();
    const { auditControl } = await import("@/lib/wavesco/control");
    const { listLeads } = await import("@/lib/wavesco/lead-engine");
    vi.mocked(listLeads).mockResolvedValueOnce({ rows: CORPUS, total: 2, page: 1, pageSize: 1000 } as never);

    const { POST } = await import("@/app/api/acquisition/leads/export/route");
    await POST(
      new Request("http://test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ q: "Acme", tier: "A" }),
      })
    );
    expect(auditControl).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "leads.export",
        model: "LeadCorpus",
        tenantId: "t1",
        metadata: expect.objectContaining({ count: 2, totalMatching: 2 }),
      })
    );
  });

  it("never leaks an internal message on failure", async () => {
    await authed();
    const { listLeads } = await import("@/lib/wavesco/lead-engine");
    vi.mocked(listLeads).mockRejectedValueOnce(new Error("engine API 500: D:\\wavesco-lead-engine\\data.db locked"));

    const { POST } = await import("@/app/api/acquisition/leads/export/route");
    const res = await POST(
      new Request("http://test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ q: "Acme" }),
      })
    );
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error?: string; detail?: string };
    expect(body.error).not.toContain("wavesco-lead-engine");
    expect(body.detail).toBeUndefined();
  });
});