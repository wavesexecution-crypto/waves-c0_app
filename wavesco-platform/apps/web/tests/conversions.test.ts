/**
 * Verified conversions + follow-up hardening + planner offset clamping + n8n retry.
 * Synthetic data only. No network (fetch mocked where needed).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

type Row = Record<string, any>;
const mem = {
  leadConversion: [] as Row[],
  followUp: [] as Row[],
  activityEvent: [] as Row[],
};
let seq = 1;
const nid = (p: string) => `${p}_${seq++}`;

vi.mock("@wavesco/db", () => ({
  withTenantContext: async (_tid: string, fn: any) => fn({
    leadConversion: {
      findUnique: async ({ where }: any) => {
        const k = where.tenantId_leadKey;
        return mem.leadConversion.find((r) => r.tenantId === k.tenantId && r.leadKey === k.leadKey) ?? null;
      },
      create: async ({ data }: any) => { const r = { id: nid("conv"), ...data }; mem.leadConversion.push(r); return r; },
      update: async ({ where, data }: any) => {
        const r = mem.leadConversion.find((x) => x.id === where.id)!;
        Object.assign(r, data);
        return r;
      },
    },
    followUp: {
      updateMany: async ({ where, data }: any) => {
        let count = 0;
        for (const r of mem.followUp) {
          if (r.tenantId === where.tenantId && r.leadKey === where.leadKey && r.status === where.status) {
            Object.assign(r, data);
            count++;
          }
        }
        return { count };
      },
    },
    activityEvent: { create: async ({ data }: any) => { const r = { id: nid("act"), ...data }; mem.activityEvent.push(r); return r; } },
  }),
}));

import { recordConversion, validateConversion } from "@/lib/wavesco/conversions";
import { coercePlanned, composeFallback } from "@/lib/wavesco/outreach-logic";

const TID = "t-conv";
beforeEach(() => {
  for (const k of Object.keys(mem)) (mem as any)[k] = [];
  seq = 1;
  vi.clearAllMocks();
});

describe("validateConversion", () => {
  it("accepts MEETING/WON/LOST (any case); rejects clicks/sends/empties", () => {
    expect(validateConversion({ leadKey: "a", state: "meeting" }).ok).toBe(true);
    expect(validateConversion({ leadKey: "a", state: "WON" }).ok).toBe(true);
    expect(validateConversion({ leadKey: "a", state: "lost" }).ok).toBe(true);
    expect(validateConversion({ leadKey: "a", state: "CLICKED" }).ok).toBe(false);
    expect(validateConversion({ leadKey: "a", state: "SENT" }).ok).toBe(false);
    expect(validateConversion({ leadKey: "", state: "WON" }).ok).toBe(false);
    expect(validateConversion({ state: "WON" }).ok).toBe(false);
  });
});

describe("recordConversion", () => {
  it("upserts per lead, cancels pending follow-ups, audits", async () => {
    mem.followUp.push(
      { id: "fu1", tenantId: TID, leadKey: "apex", status: "pending", business: "Apex" },
      { id: "fu2", tenantId: TID, leadKey: "apex", status: "done", business: "Apex" },
      { id: "fu3", tenantId: TID, leadKey: "other", status: "pending", business: "Other" },
    );
    const r = await recordConversion(TID, { leadKey: "apex", state: "WON", note: "Signed annual", businessName: "Apex" }, "u1");
    expect(r.state).toBe("WON");
    expect(r.followUpsCancelled).toBe(1);
    expect(mem.followUp.find((f) => f.id === "fu1")!.status).toBe("cancelled");
    expect(mem.followUp.find((f) => f.id === "fu2")!.status).toBe("done");
    expect(mem.followUp.find((f) => f.id === "fu3")!.status).toBe("pending");
    const r2 = await recordConversion(TID, { leadKey: "apex", state: "MEETING", note: null, businessName: null }, "u1");
    expect(mem.leadConversion).toHaveLength(1);
    expect(r2.conversionId).toBe(r.conversionId);
    expect(mem.activityEvent.some((a) => a.type === "lead_converted")).toBe(true);
  });
});

describe("planner offset clamping (AI-provided values)", () => {
  const facts: any = {
    business: "Apex", contact: "Not found", category: "Gym", location: "Vashi",
    website: "Not found", presence: "basic", problem: "no booking", opportunity: "funnel",
    serviceFit: "website", angleSeed: "angle", sources: [],
  };
  it("0/negative/huge offsets are clamped to 1..90; non-numbers default 3/7", () => {
    const fb = composeFallback(facts);
    const p = coercePlanned({
      subject: "Hi", body: "Body",
      follow_ups: [
        { subject: "f1", body: "b1", offsetDays: 0 },
        { subject: "f2", body: "b2", offsetDays: -5 },
      ],
    }, fb)!;
    expect(p.followUps[0]!.offsetDays).toBe(1);
    expect(p.followUps[1]!.offsetDays).toBe(1);
    const p2 = coercePlanned({
      subject: "Hi", body: "Body",
      follow_ups: [{ subject: "f1", body: "b1", offsetDays: 400 }, { subject: "f2", body: "b2", offsetDays: "soon" }],
    }, fb)!;
    expect(p2.followUps[0]!.offsetDays).toBe(90);
    expect(p2.followUps[1]!.offsetDays).toBe(7);
  });
});

describe("n8n bounded retry", () => {
  const OLD_ENV = { ...process.env };
  afterEach(() => { process.env = { ...OLD_ENV }; vi.unstubAllGlobals(); });
  it("retries once on network failure, then succeeds (2 calls)", async () => {
    process.env.N8N_BASE_URL = "http://127.0.0.1:9";
    const { submitApproval } = await import("@/lib/wavesco/n8n");
    let calls = 0;
    vi.stubGlobal("fetch", vi.fn(async () => {
      calls++;
      if (calls === 1) throw new Error("connection refused");
      return { ok: true, status: 200, json: async () => ({ approval_id: 7 }) };
    }));
    const r = await submitApproval({ type: "cold_email", recipient: "a@b.example", subject: "s", body: "b" });
    expect(r.ok).toBe(true);
    expect(calls).toBe(2);
  });
  it("does NOT retry HTTP 500 (single call — n8n may have queued)", async () => {
    process.env.N8N_BASE_URL = "http://127.0.0.1:9";
    const { submitApproval } = await import("@/lib/wavesco/n8n");
    let calls = 0;
    vi.stubGlobal("fetch", vi.fn(async () => {
      calls++;
      return { ok: false, status: 500, json: async () => ({}) };
    }));
    const r = await submitApproval({ type: "cold_email", recipient: "a@b.example", subject: "s", body: "b" });
    expect(r.ok).toBe(false);
    expect(calls).toBe(1);
  });
  it("no base URL → immediate failure without fetch", async () => {
    delete process.env.N8N_BASE_URL;
    const { decideApproval } = await import("@/lib/wavesco/n8n");
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }));
    vi.stubGlobal("fetch", fetchMock);
    const r = await decideApproval(1, "approve");
    expect(r.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
