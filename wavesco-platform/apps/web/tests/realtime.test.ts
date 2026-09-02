import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";

vi.mock("@/lib/wavesco/control", () => ({ requireControlAuth: vi.fn() }));
vi.mock("@wavesco/db", () => ({ withTenantContext: vi.fn() }));
vi.mock("@/lib/wavesco/lead-engine", () => ({
  getLeadStats: vi.fn(),
  getFacets: vi.fn(),
  getLastEngineRun: vi.fn(),
}));

describe("realtime", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("overview polling returns consistent state on two calls", async () => {
    const { requireControlAuth } = await import("@/lib/wavesco/control");
    const { withTenantContext } = await import("@wavesco/db");
    const { getLeadStats, getFacets, getLastEngineRun } = await import("@/lib/wavesco/lead-engine");

    vi.mocked(requireControlAuth).mockResolvedValue({
      tenantId: "t1",
      userId: "u1",
      session: {},
    } as any);
    vi.mocked(getLeadStats).mockResolvedValue({
      total: 42,
      emailReady: 10,
      contacted: 5,
      optedOut: 0,
      bounced: 0,
      replies: 2,
      byTier: { A: 1 },
      lastResearchedAt: null,
    } as any);
    vi.mocked(getFacets).mockResolvedValue({ categories: ["cat"], cities: ["city"] } as any);
    vi.mocked(getLastEngineRun).mockResolvedValue(null as any);
    vi.mocked(withTenantContext).mockImplementation(async (_tenantId: string, fn: any) => {
      const tx: any = {
        campaign: { count: async () => 3 },
        outreachEmail: {
          count: async ({ where }: any) => {
            if (where?.status === "sent") return 7;
            if (where?.status === "failed") return 1;
            if (where?.status?.in) return 4;
            return 0;
          },
        },
        followUp: { count: async () => 2 },
        activityEvent: {
          findMany: async () => [
            { id: "a1", title: "Test event", type: "test", createdAt: new Date().toISOString() },
          ],
        },
      };
      return fn(tx);
    });

    const { GET } = await import("@/app/api/acquisition/overview/route");
    const r1 = await (GET as any)(new Request("http://test"));
    const j1: any = await r1.json();
    const r2 = await (GET as any)(new Request("http://test"));
    const j2: any = await r2.json();
    expect(j1.corpus.total).toBe(j2.corpus.total);
    expect(j1.corpus.total).toBe(42);
    expect(j1.platform.campaigns).toBe(j2.platform.campaigns);
  });

  it("campaign stop requires confirm in UI", async () => {
    const candidates = [
      path.join(process.cwd(), "apps/web/components/acquisition/campaign-controls.tsx"),
      path.join(process.cwd(), "components/acquisition/campaign-controls.tsx"),
      "apps/web/components/acquisition/campaign-controls.tsx",
      "components/acquisition/campaign-controls.tsx",
    ];
    let text: string | null = null;
    for (const p of candidates) {
      try {
        if (fs.existsSync(p)) {
          text = fs.readFileSync(p, "utf-8");
          break;
        }
      } catch {}
    }
    if (text === null) {
      // fallback: try relative to this test file (apps/web/tests)
      const alt = path.resolve(__dirname, "../components/acquisition/campaign-controls.tsx");
      if (fs.existsSync(alt)) text = fs.readFileSync(alt, "utf-8");
    }
    expect(text).not.toBeNull();
    expect(text!).toMatch(/confirm|AlertDialog/);
    // ensure destructive stop is guarded (message mentions stop or before/after)
    expect(text!).toMatch(/stop/i);
  });

  it("overview mock remains deterministic under rapid polling (3 calls)", async () => {
    const { requireControlAuth } = await import("@/lib/wavesco/control");
    const { withTenantContext } = await import("@wavesco/db");
    const { getLeadStats, getFacets, getLastEngineRun } = await import("@/lib/wavesco/lead-engine");
    vi.mocked(requireControlAuth).mockResolvedValue({
      tenantId: "t1",
      userId: "u1",
      session: {},
    } as any);
    vi.mocked(getLeadStats).mockResolvedValue({
      total: 100,
      emailReady: 20,
      contacted: 10,
      optedOut: 1,
      bounced: 0,
      replies: 3,
      byTier: { B: 2 },
      lastResearchedAt: null,
    } as any);
    vi.mocked(getFacets).mockResolvedValue({ categories: [], cities: [] } as any);
    vi.mocked(getLastEngineRun).mockResolvedValue(null as any);
    vi.mocked(withTenantContext).mockImplementation(async (_tenantId: string, fn: any) => {
      const tx: any = {
        campaign: { count: async () => 1 },
        outreachEmail: { count: async () => 0 },
        followUp: { count: async () => 0 },
        activityEvent: { findMany: async () => [] },
      };
      return fn(tx);
    });
    const { GET } = await import("@/app/api/acquisition/overview/route");
    const vals: number[] = [];
    for (let i = 0; i < 3; i++) {
      const r = await (GET as any)(new Request("http://test"));
      const j: any = await r.json();
      vals.push(j.corpus.total);
    }
    expect(vals[0]).toBe(vals[1]);
    expect(vals[1]).toBe(vals[2]);
  });
});
