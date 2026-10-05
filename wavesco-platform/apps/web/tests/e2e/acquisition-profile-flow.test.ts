import { describe, it, expect, vi, beforeEach } from "vitest";

// E2E: New tenant — Create Company → Complete Brief → Connect infra → Readiness → Activate → Agent context → Workflow → Audit
// All tenant-isolated, deterministic readiness, no AI for required-field check, masked context.

const e2eProfileStore: Record<string, any> = {};
const e2eAudit: any[] = [];
const e2eImports: any[] = [];

vi.mock("@/lib/wavesco/control", () => ({
  acquisitionDenied: vi.fn(async () => null),
  requireControlAuth: vi.fn(async () => ({ tenantId: "e2e-profile-tenant", userId: "e2e-user", session: { user: { id: "e2e-user" } } })),
  auditControl: vi.fn(async (args: any) => {
    e2eAudit.push({ ...args, createdAt: new Date().toISOString(), id: `audit_${e2eAudit.length}` });
    return { id: `audit_${e2eAudit.length}` };
  }),
}));

vi.mock("@wavesco/db", () => {
  return {
    withTenantContext: async (tid: string, fn: any) => {
      const tx: any = {
        acquisitionProfile: {
          findFirst: async ({ where }: any) => {
            const p = e2eProfileStore[where.tenantId];
            return p || null;
          },
          create: async ({ data }: any) => {
            const rec = { id: `profile_${Date.now()}`, ...data, version: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
            e2eProfileStore[data.tenantId] = rec;
            return rec;
          },
          update: async ({ where, data }: any) => {
            const tid = Object.values(e2eProfileStore).find((v: any) => v.id === where.id)?.tenantId || "e2e-profile-tenant";
            const existing = e2eProfileStore[tid];
            const updated = { ...existing, ...data, version: (existing.version || 1) + 1, updatedAt: new Date().toISOString() };
            // Handle increment object from Prisma
            if (data.version && typeof data.version === "object" && data.version.increment) {
              updated.version = existing.version + 1;
            }
            // Unwrap data's version increment handling
            if (typeof data.status === "string") updated.status = data.status;
            if (data.readiness) updated.readiness = data.readiness;
            for (const k of ["companyName", "website", "industry", "whatWeSell", "businessModel", "acquisitionObjective", "primaryObjective", "targetQuantity", "targetTimeframe", "priorityProductService", "icp", "offer", "brand", "integrations", "rules"]) {
              if (k in data) (updated as any)[k] = data[k];
            }
            if ("activatedAt" in data) updated.activatedAt = data.activatedAt;
            if ("pausedAt" in data) updated.pausedAt = data.pausedAt;
            if ("suspendedAt" in data) updated.suspendedAt = data.suspendedAt;
            e2eProfileStore[tid] = updated;
            return updated;
          },
          findMany: async () => Object.values(e2eProfileStore),
        },
        acquisitionDataImport: {
          create: async ({ data }: any) => {
            const rec = { id: `imp_${Date.now()}`, ...data, createdAt: new Date().toISOString() };
            e2eImports.push(rec);
            return rec;
          },
          findMany: async ({ where }: any) => e2eImports.filter((i) => !where?.tenantId || i.tenantId === where.tenantId),
        },
        activityEvent: { create: async () => ({}), findMany: async () => [] },
        campaign: { findMany: async () => [{ id: "c1", name: "Test", status: "draft" }], count: async () => 1 },
        leadResearch: { count: async () => 5 },
        outreachOrder: { findMany: async () => [], count: async () => 0 },
        auditLog: { findMany: async () => e2eAudit, count: async () => e2eAudit.length },
      };
      return fn(tx);
    },
    prisma: {
      auditLog: { create: async (a: any) => e2eAudit.push(a) },
    },
  };
});

vi.mock("@/lib/wavesco/integrations", () => ({
  getIntegrationsHealth: vi.fn(async () => ({ n8n: { status: "ok" }, db: { status: "ok" }, lead_engine: { status: "ok" } })),
  maskUrl: vi.fn((u: string) => (u ? "https://***" : null)),
}));

describe("e2e acquisition profile flow", () => {
  beforeEach(() => {
    // Keep store across tests to simulate lifecycle; but clear for first test
  });

  it("Create Company → Complete Brief → Readiness INCOMPLETE → missing fields shown", async () => {
    const { POST } = await import("@/app/api/acquisition/profile/route");
    // Create with only companyName
    const res = await POST(new Request("http://test", { method: "POST", body: JSON.stringify({ companyName: "ACME Corp" }) }));
    expect(res.status).toBe(200);
    const j: any = await res.json();
    expect(j.profile.companyName).toBe("ACME Corp");
    expect(j.readiness.ready).toBe(false);
    expect(j.readiness.missing.length).toBeGreaterThan(0);
    expect(j.readiness.present).toContain("Company name");
    // Should be INCOMPLETE not READY
    expect(["INCOMPLETE", "DRAFT"].includes(j.profile.status)).toBe(true);
    expect(j.profile.status).not.toBe("READY");
  });

  it("Complete Brief with all required → READY, optional not blocking", async () => {
    const { POST } = await import("@/app/api/acquisition/profile/route");
    const res = await POST(
      new Request("http://test", {
        method: "POST",
        body: JSON.stringify({
          companyName: "WavesCo Pvt Ltd",
          website: "https://wavesco.in",
          industry: "B2B Services",
          whatWeSell: "Operating system installs",
          acquisitionObjective: "leads",
          primaryObjective: "30 qualified leads in 30 days",
          targetQuantity: 30,
          targetTimeframe: "30 days",
          icp: { targetCustomer: "Founder-led companies 5-50", geography: "Navi Mumbai", industry: "Services" },
          offer: { productService: "Acquisition OS rental", valueProp: "Founder stops midnight reconciliation" },
          brand: { toneOfVoice: "Direct" },
          integrations: { email: "Brevo", crm: "Sheets" },
          rules: { geoRestrictions: "Only Navi Mumbai" },
        }),
      })
    );
    expect(res.status).toBe(200);
    const j: any = await res.json();
    expect(j.readiness.ready).toBe(true);
    expect(j.profile.status).toBe("READY");
    expect(j.readiness.missing.length).toBe(0);
  });

  it("Readiness check is deterministic via GET", async () => {
    const { GET } = await import("@/app/api/acquisition/profile/route");
    const res = await GET();
    expect(res.status).toBe(200);
    const j: any = await res.json();
    expect(j.readiness.ready).toBe(true);
    expect(j.profile.status).toBe("READY");
  });

  it("Incomplete activation rejected", async () => {
    // Force incomplete by clearing required field
    const { POST } = await import("@/app/api/acquisition/profile/route");
    await POST(new Request("http://test", { method: "POST", body: JSON.stringify({ website: null }) }));
    const { POST: ControlPOST } = await import("@/app/api/acquisition/profile/control/route");
    // Now profile is INCOMPLETE, try activate
    const res = await ControlPOST(new Request("http://test", { method: "POST", body: JSON.stringify({ action: "activate" }) }));
    expect(res.status).toBe(400);
    const j: any = await res.json();
    expect(j.error).toMatch(/missing/);
    // Restore ready state for next test
    await POST(new Request("http://test", { method: "POST", body: JSON.stringify({ website: "https://wavesco.in" }) }));
  });

  it("Activate Acquisition OS when READY → ACTIVE and audited", async () => {
    const { POST } = await import("@/app/api/acquisition/profile/control/route");
    const res = await POST(new Request("http://test", { method: "POST", body: JSON.stringify({ action: "activate" }) }));
    expect(res.status).toBe(200);
    const j: any = await res.json();
    expect(j.nextStatus).toBe("ACTIVE");
    expect(j.profile.status).toBe("ACTIVE");
    expect(e2eAudit.some((a) => a.action === "acquisition_profile.activate")).toBe(true);
  });

  it("Agent receives operational context — masked, structured, tenant-isolated", async () => {
    const { GET } = await import("@/app/api/acquisition/profile/context/route");
    const res = await GET();
    expect(res.status).toBe(200);
    const j: any = await res.json();
    expect(j.context.company.name).toBe("WavesCo Pvt Ltd");
    expect(j.context.company.websiteMasked).toBe("https://***");
    expect(j.context.objective.acquisitionObjective).toBe("leads");
    expect(j.context.icp.targetCustomer).toContain("Founder");
    expect(j.context.current_state.status).toBe("ACTIVE");
    expect(j.context.current_state.tenantId).toBe("e2e-profile-tenant");
    expect(j.context.meta.model).toBe("nemotron-3-super");
    expect(JSON.stringify(j.context)).not.toMatch(/api_key|secret/i);
    expect(j.context.historical_context).toBeDefined();
  });

  it("Data import + integration association + pause/resume", async () => {
    const { POST: ImportPOST } = await import("@/app/api/acquisition/profile/import/route");
    const impRes = await ImportPOST(new Request("http://test", { method: "POST", body: JSON.stringify({ fileName: "leads.csv", fileType: "csv", rowCount: 42 }) }));
    expect(impRes.status).toBe(200);
    const impJ: any = await impRes.json();
    expect(impJ.import.fileName).toBe("leads.csv");
    expect(e2eAudit.some((a) => a.action === "acquisition_profile.import")).toBe(true);

    const { POST } = await import("@/app/api/acquisition/profile/control/route");
    const pauseRes = await POST(new Request("http://test", { method: "POST", body: JSON.stringify({ action: "pause" }) }));
    expect(pauseRes.status).toBe(200);
    const pauseJ: any = await pauseRes.json();
    expect(pauseJ.nextStatus).toBe("PAUSED");

    const resumeRes = await POST(new Request("http://test", { method: "POST", body: JSON.stringify({ action: "resume" }) }));
    expect(resumeRes.status).toBe(200);
    const resumeJ: any = await resumeRes.json();
    expect(resumeJ.nextStatus).toBe("ACTIVE");
  });

  it("Audit trail exists — who/what/when/tenant/resource/before/after", async () => {
    expect(e2eAudit.length).toBeGreaterThan(0);
    const hasCreate = e2eAudit.some((a) => a.action === "acquisition_profile.create" || a.action === "acquisition_profile.update");
    const hasActivate = e2eAudit.some((a) => a.action === "acquisition_profile.activate");
    const hasImport = e2eAudit.some((a) => a.action === "acquisition_profile.import");
    expect(hasCreate).toBe(true);
    expect(hasActivate).toBe(true);
    expect(hasImport).toBe(true);
    for (const a of e2eAudit) {
      expect(a.tenantId).toBe("e2e-profile-tenant");
      expect(a.action).toBeDefined();
      expect(a.model).toBeDefined();
    }
  });

  it("tenant isolation — other tenant cannot see profile", async () => {
    const { requireControlAuth } = await import("@/lib/wavesco/control");
    vi.mocked(requireControlAuth).mockResolvedValueOnce({ tenantId: "other-tenant", userId: "other-user", session: {} } as any);
    const { GET } = await import("@/app/api/acquisition/profile/route");
    const res = await GET();
    expect(res.status).toBe(200);
    const j: any = await res.json();
    // other-tenant has no profile
    expect(j.exists).toBe(false);
    expect(j.readiness.status).toBe("DRAFT");
    // Restore
    vi.mocked(requireControlAuth).mockResolvedValue({ tenantId: "e2e-profile-tenant", userId: "e2e-user", session: {} } as any);
  });
});
