/**
 * Regression tests for the authorization/isolation fixes on the
 * server-action and route surfaces that had no tenant+role gate.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

type Row = Record<string, any>;
const mem = {
  generationBatch: [] as Row[],
  storedObject: [] as Row[],
};
let seq = 1;
const nid = (p: string) => `${p}_${seq++}`;

let sessionRole = "owner";
let denied: { body: any; status: number } | null = null;

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => ({ user: { id: "u1", tenantId: "t1", role: sessionRole } })),
}));
vi.mock("@wavesco/auth", () => ({
  requireSession: (s: unknown) => {
    const user = (s as { user?: Row } | null)?.user;
    if (!user) throw new Error("UNAUTHORIZED");
    return user;
  },
}));
// Mirrors lib/permissions.ts exactly — a looser mock here would hide a real
// authorization gap rather than exercise it.
vi.mock("@/lib/permissions", () => {
  const rank = (role: string) => (role === "owner" ? 3 : role === "admin" ? 2 : 1);
  return {
    can: ({ role }: { role: string }, action: string) => {
      const r = rank(role);
      if (action === "read") return r >= 1;
      if (action === "create" || action === "update") return r >= 2;
      return r >= 3;
    },
  };
});
vi.mock("@/lib/wavesco/control", () => ({
  acquisitionDenied: vi.fn(async () => denied),
  requireControlAuth: vi.fn(async () => ({
    tenantId: "t1",
    userId: "u1",
    session: { user: { id: "u1", tenantId: "t1", role: sessionRole } },
  })),
  sessionRole: (s: unknown) => {
    const user = (s as { user?: { role?: unknown } } | null)?.user;
    const role = (user as { role?: unknown } | null)?.role;
    return role === "owner" || role === "admin" || role === "member" ? (role as string) : "member";
  },
  auditControl: vi.fn(async () => ({ id: "a1" })),
}));
vi.mock("@/lib/wavesco/activity", () => ({
  recordActivity: vi.fn(async () => {}),
}));
vi.mock("@/lib/wavesco/lead-engine", () => ({
  getBatchManifest: vi.fn(async (batchId: string) =>
    batchId === "engine-batch-a"
      ? {
          batchId,
          leadCount: 10,
          emailReadyCount: 4,
          // Real engine paths: PDF in reports/, XLSX in exports/
          pdfPath: "C:/leads/reports/engine-batch-a/report.pdf",
          excelPath: "C:/leads/exports/engine-batch-a/report.xlsx",
        }
      : undefined,
  ),
  fetchManifestFile: vi.fn(async () => ({ ok: false as const })),
  leadEngineMode: vi.fn(() => "local"),
  leadEngineRoot: vi.fn(() => "C:/leads"),
  runsDir: vi.fn(() => "C:/leads/data/runs"),
  // Used by computeEligibilityAction — it expects a bare array.
  selectCampaignCandidates: vi.fn(async () => []),
  updateLeadOutreachState: vi.fn(async () => ({})),
}));
vi.mock("@/lib/wavesco/n8n", () => ({
  n8nBaseUrl: vi.fn(() => "http://n8n.invalid"),
}));

vi.mock("@wavesco/db", () => ({
  withTenantContext: vi.fn(async (_tid: string, fn: any) =>
    fn({
      generationBatch: {
        // Mirrors Prisma: matches on whichever unique field the predicate names,
        // always constrained by tenantId. A query omitting tenantId must not
        // match across tenants.
        findFirst: async ({ where }: any) =>
          mem.generationBatch.find((r) => {
            if (where.tenantId && r.tenantId !== where.tenantId) return false;
            if (where.id && r.id !== where.id) return false;
            if (where.engineBatchId && r.engineBatchId !== where.engineBatchId) return false;
            return true;
          }) ?? null,
      },
      storedObject: { findMany: async () => [] },
      campaign: {
        findFirst: async () => null,
        create: async ({ data }: any) => ({ id: nid("camp"), ...data }),
        update: async () => ({}),
      },
    }),
  ),
  withIdempotency: vi.fn(async (_key: string, fn: any) => fn()),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const OLD_ENV = { ...process.env };
beforeEach(() => {
  mem.generationBatch = [];
  mem.storedObject = [];
  seq = 1;
  sessionRole = "owner";
  denied = null;
  delete process.env.N8N_BASE_URL;
});
afterEach(() => {
  process.env = { ...OLD_ENV };
});

function fd(fields: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.append(k, v);
  return f;
}

describe("resendReportAction — batch ownership (IDOR)", () => {
  it("refuses a batch that belongs to another tenant", async () => {
    mem.generationBatch.push({ id: "gb-1", tenantId: "t2", engineBatchId: "engine-batch-a" });
    const { resendReportAction } = await import("@/lib/actions/reports");
    const out = await resendReportAction({ ok: true }, fd({ batchId: "engine-batch-a" }));
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/no such batch/i);
  });

  it("refuses a batch id with no GenerationBatch row at all", async () => {
    const { resendReportAction } = await import("@/lib/actions/reports");
    const out = await resendReportAction({ ok: true }, fd({ batchId: "engine-batch-a" }));
    expect(out.ok).toBe(false);
  });

  it("proceeds past the ownership check for the caller's own batch", async () => {
    mem.generationBatch.push({
      id: "gb-1",
      tenantId: "t1",
      engineBatchId: "engine-batch-a",
    });
    const { resendReportAction } = await import("@/lib/actions/reports");
    const out = await resendReportAction({ ok: true }, fd({ batchId: "engine-batch-a" }));
    // It gets past authorization and then fails on the environment (no n8n
    // configured), never with the ownership error.
    expect(out.error ?? "").not.toMatch(/no such batch/i);
  });

  it("refuses a manifest path that escapes the engine output directories", async () => {
    mem.generationBatch.push({ id: "gb-1", tenantId: "t1", engineBatchId: "evil" });
    const { getBatchManifest } = await import("@/lib/wavesco/lead-engine");
    vi.mocked(getBatchManifest).mockResolvedValueOnce({
      batchId: "evil",
      // Traversal attempt - escapes the engine root entirely
      pdfPath: "C:/leads/../../../../etc/passwd",
    } as any);
    const { resendReportAction } = await import("@/lib/actions/reports");
    const out = await resendReportAction({ ok: true }, fd({ batchId: "evil" }));
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/outside the engine output/i);
  });

  it("rejects a traversal path in the manifest", async () => {
    mem.generationBatch.push({ id: "gb-1", tenantId: "t1", engineBatchId: "evil2" });
    const { getBatchManifest } = await import("@/lib/wavesco/lead-engine");
    vi.mocked(getBatchManifest).mockResolvedValueOnce({
      batchId: "evil2",
      pdfPath: "C:/leads/data/runs/../../../../etc/passwd",
    } as any);
    const { resendReportAction } = await import("@/lib/actions/reports");
    const out = await resendReportAction({ ok: true }, fd({ batchId: "evil2" }));
    expect(out.ok).toBe(false);
  });

  it("still requires an admin role", async () => {
    sessionRole = "member";
    const { resendReportAction } = await import("@/lib/actions/reports");
    const out = await resendReportAction({ ok: true }, fd({ batchId: "engine-batch-a" }));
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/admin role/i);
  });
});

describe("computeEligibilityAction — authorization", () => {
  it("refuses a member", async () => {
    sessionRole = "member";
    const { computeEligibilityAction } = await import("@/lib/actions/campaigns");
    await expect(computeEligibilityAction({ location: "Pune" })).rejects.toThrow(/not authorised/i);
  });

  it("refuses a lapsed tenant (entitlement denied)", async () => {
    denied = { body: { error: "not_configured" }, status: 402 };
    const { computeEligibilityAction } = await import("@/lib/actions/campaigns");
    await expect(computeEligibilityAction({ location: "Pune" })).rejects.toThrow();
  });

  it("allows an entitled owner", async () => {
    const { computeEligibilityAction } = await import("@/lib/actions/campaigns");
    // Reaches computeEligibility, which is unmocked-safe to call here.
    await expect(computeEligibilityAction({ location: "Pune" })).resolves.toBeDefined();
  });
});

describe("automation/workflow role gates", () => {
  it("workflow control refuses a member", async () => {
    sessionRole = "member";
    const mod = await import("@/app/api/acquisition/workflows/[id]/control/route");
    vi.mocked((await import("@/lib/wavesco/control")).acquisitionDenied).mockResolvedValueOnce(
      null as any,
    );
    const res = await mod.POST(
      new Request("http://t/", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "enable" }),
      }),
      { params: Promise.resolve({ id: "wf1" }) },
    );
    expect(res.status).toBe(403);
  });

  it("automation proxy refuses a member", async () => {
    sessionRole = "member";
const mod = await import("@/app/api/automation/[...path]/route");
    const { NextRequest } = await import("next/server");
    const res = await mod.GET(
      new NextRequest("http://t/api/automation/workflows"),
      { params: Promise.resolve({ path: ["workflows"] }) },
    );
    expect(res.status).toBe(403);
  });
});

describe("module registry role gate", () => {
  it("refuses a member registering a platform module", async () => {
    sessionRole = "member";
    const mod = await import("@/app/api/modules/registry/route");
    const res = await mod.POST(
      new Request("http://t/", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "acquisition-os" }),
      }),
    );
    expect(res.status).toBe(403);
  });
});

describe("documents/generate — no unscoped fallback lookup", () => {
  it("does not resolve another tenant's batch", async () => {
    mem.generationBatch.push({
      id: "gb-other",
      tenantId: "t2",
      engineBatchId: "engine-x",
      pdfPath: "/etc/passwd",
    });
    const mod = await import("@/app/api/acquisition/documents/generate/route");
    vi.mocked((await import("@/lib/wavesco/control")).acquisitionDenied).mockResolvedValueOnce(
      null as any,
    );
    const res = await mod.POST(
      new Request("http://t/", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ batchId: "gb-other" }),
      }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("batch not found");
    // Crucially, the other tenant's pdfPath is not echoed back.
    expect(JSON.stringify(body)).not.toContain("passwd");
  });
});

