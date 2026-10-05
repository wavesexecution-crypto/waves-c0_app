/**
 * Inbound conversations — attribution, state transitions, idempotency.
 * Synthetic tenants only. No network.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

type Row = Record<string, any>;
const mem = {
  conversation: [] as Row[],
  conversationMessage: [] as Row[],
  outreachOrder: [] as Row[],
  followUp: [] as Row[],
  leadResearch: [] as Row[],
  activityEvent: [] as Row[],
};
let seq = 1;
const nid = (p: string) => `${p}_${seq++}`;

function matchEmail(rowEmail: string, cond: any): boolean {
  if (cond && typeof cond === "object" && "equals" in cond) {
    return cond.mode === "insensitive"
      ? (rowEmail ?? "").toLowerCase() === String(cond.equals).toLowerCase()
      : rowEmail === cond.equals;
  }
  return rowEmail === cond;
}
function matchWhere(row: Row, where: any): boolean {
  for (const [k, v] of Object.entries(where ?? {})) {
    if (k === "status" && v && typeof v === "object" && "in" in (v as any)) {
      if (!(v as any).in.includes(row.status)) return false;
      continue;
    }
    if (k === "email" && v && typeof v === "object") {
      if (!matchEmail(row.email ?? "", v)) return false;
      continue;
    }
    if (row[k] !== v) return false;
  }
  return true;
}

function makeTx() {
  return {
    conversation: {
      findUnique: async ({ where }: any) => {
        if (where.id) return mem.conversation.find((r) => r.id === where.id) ?? null;
        const k = where.tenantId_leadKey;
        return mem.conversation.find((r) => r.tenantId === k.tenantId && r.leadKey === k.leadKey) ?? null;
      },
      findFirst: async ({ where }: any) => mem.conversation.find((r) => matchWhere(r, where)) ?? null,
      create: async ({ data }: any) => { const r = { id: nid("conv"), ...data }; mem.conversation.push(r); return r; },
      update: async ({ where, data }: any) => {
        const r = mem.conversation.find((x) => x.id === where.id)!;
        Object.assign(r, data);
        return r;
      },
    },
    conversationMessage: {
      findFirst: async ({ where }: any) => mem.conversationMessage.find((r) => matchWhere(r, where)) ?? null,
      create: async ({ data }: any) => { const r = { id: nid("msg"), ...data }; mem.conversationMessage.push(r); return r; },
    },
    outreachOrder: {
      findFirst: async ({ where }: any) => {
        const rows = mem.outreachOrder.filter((r) => matchWhere(r, where));
        return rows[rows.length - 1] ?? null;
      },
      findMany: async ({ where }: any = {}) => mem.outreachOrder.filter((r) => matchWhere(r, where)),
      update: async ({ where, data }: any) => {
        const r = mem.outreachOrder.find((x) => x.id === where.id)!;
        Object.assign(r, data);
        return r;
      },
      updateMany: async ({ where, data }: any) => {
        let count = 0;
        for (const r of mem.outreachOrder) if (matchWhere(r, where)) { Object.assign(r, data); count++; }
        return { count };
      },
    },
    followUp: {
      updateMany: async ({ where, data }: any) => {
        let count = 0;
        for (const r of mem.followUp) if (matchWhere(r, where)) { Object.assign(r, data); count++; }
        return { count };
      },
    },
    leadResearch: {
      findUnique: async ({ where }: any) => {
        const k = where.tenantId_leadKey;
        return mem.leadResearch.find((r) => r.tenantId === k.tenantId && r.leadKey === k.leadKey) ?? null;
      },
      findFirst: async ({ where }: any) => mem.leadResearch.find((r) => matchWhere(r, where)) ?? null,
    },
    activityEvent: { create: async ({ data }: any) => { const r = { id: nid("act"), ...data }; mem.activityEvent.push(r); return r; } },
  };
}

vi.mock("@wavesco/db", () => ({
  withTenantContext: async (_tid: string, fn: any) => fn(makeTx()),
}));

import { recordInboundMessage, validateInbound } from "@/lib/wavesco/conversations";

const TID = "t-conv";

beforeEach(() => {
  for (const k of Object.keys(mem)) (mem as any)[k] = [];
  seq = 1;
  mem.leadResearch.push({ tenantId: TID, leadKey: "apex", business: "Apex Fitness", email: "owner@apex-test.example" });
  mem.outreachOrder.push({
    id: "ord1", tenantId: TID, leadKey: "apex", businessName: "Apex Fitness",
    email: "owner@apex-test.example", status: "SENT", replyStatus: null, deliveryStatus: "accepted_by_provider",
  });
  mem.followUp.push({ id: "fu1", tenantId: TID, leadKey: "apex", status: "pending", business: "Apex Fitness" });
  vi.clearAllMocks();
});

describe("validateInbound", () => {
  it("accepts a well-formed reply; rejects bad kind/empty/oversized", () => {
    expect(validateInbound({ kind: "reply", body: "Interested, call me" }).ok).toBe(true);
    expect(validateInbound({ kind: "smoke-signal", body: "x" })).toMatchObject({ ok: false });
    expect(validateInbound({ kind: "reply", body: "   " })).toMatchObject({ ok: false });
    expect(validateInbound({ kind: "reply", body: "x".repeat(4001) })).toMatchObject({ ok: false });
    expect(validateInbound({ kind: "BOUNCE", body: "5.1.1" }).value).toMatchObject({ kind: "bounce" });
  });
});

describe("recordInboundMessage", () => {
  it("reply → REPLIED thread + order replyStatus + actions listed", async () => {
    const r = await recordInboundMessage(TID, { leadKey: "apex", kind: "reply", body: "Looks good, send details" }, "test");
    expect(r.ok).toBe(true);
    expect(r.status).toBe("REPLIED");
    expect(mem.outreachOrder[0]!.replyStatus).toBe("Looks good, send details");
    expect(mem.conversation).toHaveLength(1);
    expect(mem.conversationMessage).toHaveLength(1);
  });
  it("explicit positive language → POSITIVE", async () => {
    const r = await recordInboundMessage(TID, { leadKey: "apex", kind: "reply", body: "Yes, I am interested — are you available Tuesday?" }, "test");
    expect(r.status).toBe("POSITIVE");
    expect(r.actions).toContain("positive_detected");
  });
  it("replay with same providerMsgId dedupes (no duplicates, no re-actions)", async () => {
    const m = { leadKey: "apex", kind: "reply" as const, body: "Call me", providerMsgId: "pm-1" };
    const r1 = await recordInboundMessage(TID, m, "test");
    const r2 = await recordInboundMessage(TID, m, "test");
    expect(r2).toMatchObject({ ok: true, deduped: true, conversationId: r1.conversationId });
    expect(mem.conversationMessage).toHaveLength(1);
  });
  it("bounce → BOUNCED + deliveryStatus + pending follow-ups cancelled", async () => {
    const r = await recordInboundMessage(TID, { leadKey: "apex", kind: "bounce", body: "5.1.1 mailbox unavailable" }, "test");
    expect(r.status).toBe("BOUNCED");
    expect(mem.outreachOrder[0]!.deliveryStatus).toBe("bounced");
    expect(mem.followUp[0]!.status).toBe("cancelled");
  });
  it("unsubscribe → UNSUBSCRIBED + orders cancelled + follow-ups cancelled", async () => {
    mem.outreachOrder.push({ id: "ord2", tenantId: TID, leadKey: "apex", businessName: "Apex Fitness", email: "owner@apex-test.example", status: "APPROVED", replyStatus: null });
    const r = await recordInboundMessage(TID, { leadKey: "apex", kind: "unsubscribe", body: "Remove me" }, "test");
    expect(r.status).toBe("UNSUBSCRIBED");
    expect(mem.outreachOrder.find((o) => o.id === "ord2")!.status).toBe("CANCELLED");
    expect(mem.followUp[0]!.status).toBe("cancelled");
    expect(String(r.actions)).toMatch(/suppressed/);
  });
  it("complaint behaves like unsubscribe", async () => {
    const r = await recordInboundMessage(TID, { leadKey: "apex", kind: "complaint", body: "spam" }, "test");
    expect(r.status).toBe("UNSUBSCRIBED");
  });
  it("note annotates without changing state", async () => {
    await recordInboundMessage(TID, { leadKey: "apex", kind: "reply", body: "ok" }, "test");
    const r = await recordInboundMessage(TID, { leadKey: "apex", kind: "note", body: "called, no answer" }, "test");
    expect(r.status).toBe("REPLIED");
    expect(mem.conversationMessage).toHaveLength(2);
  });
  it("resolves by recipient email when leadKey is absent", async () => {
    const r = await recordInboundMessage(TID, { email: "OWNER@apex-test.example", kind: "reply", body: "hi" }, "test");
    expect(r.ok).toBe(true);
    expect(r.conversationId).toBeDefined();
  });
  it("unattributable message fails loudly (never silently dropped)", async () => {
    const r = await recordInboundMessage(TID, { kind: "reply", body: "who is this" }, "test");
    expect(r.ok).toBe(false);
    expect(String(r.error)).toMatch(/attribute/i);
    expect(mem.conversationMessage).toHaveLength(0);
  });
});
