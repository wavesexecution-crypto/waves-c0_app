import { describe, it, expect } from "vitest";
import { answersToPayload, payloadToAnswers } from "@/lib/wavesco/flash-profile-map";

describe("flash-profile mapping — client friendly -> structured AcquisitionProfile", () => {
  it("maps required fields to top-level + nested", () => {
    const payload = answersToPayload({
      companyName: "WavesCo Pvt Ltd",
      website: "https://wavesco.in",
      industry: "B2B Services",
      whatWeSell: "OS installs",
      icp_targetCustomer: "Founders 5-50",
      icp_geography: "Navi Mumbai",
      offer_productService: "Acquisition OS rental",
      acquisitionObjective: "leads",
      primaryObjective: "30 leads in 30 days",
    } as any);
    expect(payload.companyName).toBe("WavesCo Pvt Ltd");
    expect(payload.website).toBe("https://wavesco.in");
    expect(payload.industry).toBe("B2B Services");
    expect(payload.whatWeSell).toBe("OS installs");
    expect((payload.icp as any).targetCustomer).toBe("Founders 5-50");
    expect((payload.icp as any).geography).toBe("Navi Mumbai");
    expect((payload.offer as any).productService).toBe("Acquisition OS rental");
    expect(payload.acquisitionObjective).toBe("leads");
    expect(payload.primaryObjective).toBe("30 leads in 30 days");
  });

  it("round-trips payload <-> answers without loss for core fields", () => {
    const original: any = {
      companyName: "ACME",
      website: "https://acme.com",
      industry: "SaaS",
      whatWeSell: "Widgets",
      priorityProductService: "Widget Pro",
      acquisitionObjective: "meetings",
      primaryObjective: "20 meetings",
      targetQuantity: 20,
      targetTimeframe: "30 days",
      icp: { targetCustomer: "CTOs", industry: "Tech", geography: "Pune", companySize: "10-100", disqualifiers: "Govt" },
      offer: { productService: "Tool", pricing: "₹25k", valueProp: "Save time", differentiators: "Fast", proof: "Case 1", cta: "Book call" },
      rules: { industriesExclude: "Gambling", outreachRestrictions: "No calls after 8pm" },
      brand: { toneOfVoice: "Direct" },
    };
    const answers = payloadToAnswers(original);
    const payload = answersToPayload(answers);
    expect(payload.companyName).toBe("ACME");
    expect(payload.acquisitionObjective).toBe("meetings");
    expect((payload.icp as any).geography).toBe("Pune");
    expect((payload.offer as any).productService).toBe("Tool");
    expect(payload.targetQuantity).toBe(20);
  });

  it("does not include empty keys", () => {
    const payload = answersToPayload({ companyName: "ACME", icp_geography: "" } as any);
    expect(payload.companyName).toBe("ACME");
    expect(payload).not.toHaveProperty("website");
    expect(payload).not.toHaveProperty("offer");
  });

  it("validates required fields via readinessCheck after payload build", async () => {
    const { readinessCheck } = await import("@/lib/wavesco/acquisition-profile");
    const payload = answersToPayload({
      companyName: "WavesCo",
      website: "https://wavesco.in",
      industry: "B2B",
      whatWeSell: "OS",
      icp_targetCustomer: "Founders",
      icp_geography: "Mumbai",
      offer_productService: "OS",
      acquisitionObjective: "leads",
      primaryObjective: "30",
    } as any);
    const profile = { id: "p1", tenantId: "t1", status: "DRAFT", version: 1, ...payload } as any;
    const r = readinessCheck(profile);
    expect(r.ready).toBe(true);
  });

  it("maps exclusions and outreach to rules + brand", () => {
    const payload = answersToPayload({
      icp_disqualifiers: "Gov >500",
      rules_industriesExclude: "Adult, Gambling",
      rules_outreachRestrictions: "Approve all",
      brand_toneOfVoice: "Direct",
    } as any);
    expect((payload.rules as any).industriesExclude).toBe("Adult, Gambling");
    expect((payload.rules as any).customerTypesExclude).toBe("Gov >500");
    expect((payload.brand as any).toneOfVoice).toBe("Direct");
    expect((payload.icp as any).disqualifiers).toBe("Gov >500");
  });

  it("does not expose internal keys — allowlist only", async () => {
    const { validateProfileInput } = await import("@/lib/wavesco/acquisition-profile");
    const payload = answersToPayload({
      companyName: "ACME",
      icp_targetCustomer: "CTO",
      offer_productService: "Tool",
      brand_toneOfVoice: "Direct",
    } as any);
    // attempt to inject internal
    (payload as any).agentContext = "should be stripped";
    (payload as any).n8n = "should strip";
    const { sanitized } = validateProfileInput(payload as any);
    expect((sanitized as any).agentContext).toBeUndefined();
    expect((sanitized as any).n8n).toBeUndefined();
    expect(sanitized.companyName).toBe("ACME");
  });

  it(" autosave payload is tenant-agnostic — no tenantId in payload", () => {
    const payload = answersToPayload({ companyName: "ACME", website: "https://acme.com" } as any);
    expect(payload).not.toHaveProperty("tenantId");
  });
});
