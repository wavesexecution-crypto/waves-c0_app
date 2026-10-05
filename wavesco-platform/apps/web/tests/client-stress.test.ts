/**
 * ACQUISITION OS — REAL CLIENT STRESS TEST (synthetic tenant, no external I/O).
 *
 * Synthetic customer: "IronPulse Fitness Studio (SYNTHETIC TEST)", Navi Mumbai.
 * Target: 30 qualified prospects. All businesses/emails use RFC-reserved
 * `.example` / `.test` domains — no real people, no real sends, no network.
 *
 * Mocks: @wavesco/db (in-memory tenant-scoped store), lead-engine SQLite
 * (in-memory corpus), n8n/obsidian/notify (no-ops), control auth (owner).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// In-memory tenant-scoped store (mock @wavesco/db)
// ---------------------------------------------------------------------------
type Row = Record<string, any>;
const mem = {
  campaign: [] as Row[],
  outreachOrder: [] as Row[],
  leadResearch: [] as Row[],
  followUp: [] as Row[],
  activityEvent: [] as Row[],
  acquisitionDataImport: [] as Row[],
  leadLifecycleEvent: [] as Row[],
  auditLog: [] as Row[],
};
let idSeq = 1;
const nid = (p: string) => `${p}_${idSeq++}`;
const cells = {
  outreachWrites: [] as any[],
  lastWhere: [] as { model: string; where: any }[],
};
let failNextCreate: string | null = null;

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
    if (k === "NOT" && v && typeof v === "object") {
      for (const [nk, nv] of Object.entries(v as any)) if (row[nk] === nv) return false;
      continue;
    }
    if (k === "status" && v && typeof v === "object" && "in" in (v as any)) {
      if (!(v as any).in.includes(row.status)) return false;
      continue;
    }
    if (k === "email" && v && typeof v === "object") {
      if (!matchEmail(row.email ?? "", v)) return false;
      continue;
    }
    if (k === "note" && v && typeof v === "object" && "contains" in (v as any)) {
      if (!String(row.note ?? "").includes((v as any).contains)) return false;
      continue;
    }
    if (row[k] !== v) return false;
  }
  return true;
}

function makeTx() {
  return {
    campaign: {
      findFirst: async ({ where }: any) => {
        cells.lastWhere.push({ model: "campaign", where });
        return mem.campaign.find((r) => matchWhere(r, where)) ?? null;
      },
      create: async ({ data }: any) => {
        const row = { id: nid("camp"), status: "draft", ...data };
        mem.campaign.push(row);
        return row;
      },
      update: async ({ where, data }: any) => {
        const row = mem.campaign.find((r) => r.id === where.id);
        if (!row) throw new Error("not found");
        Object.assign(row, data);
        return row;
      },
    },
    outreachOrder: {
      findUnique: async ({ where }: any) => {
        cells.lastWhere.push({ model: "outreachOrder", where });
        return mem.outreachOrder.find((r) => r.id === where.id) ?? null;
      },
      findFirst: async ({ where }: any) => {
        cells.lastWhere.push({ model: "outreachOrder", where });
        return mem.outreachOrder.find((r) => matchWhere(r, where)) ?? null;
      },
      findMany: async ({ where }: any = {}) => {
        cells.lastWhere.push({ model: "outreachOrder", where });
        return mem.outreachOrder.filter((r) => matchWhere(r, where));
      },
      create: async ({ data }: any) => {
        if (failNextCreate === "P2002") {
          failNextCreate = null;
          const e: any = new Error("Unique constraint failed");
          e.code = "P2002";
          throw e;
        }
        const row = { id: nid("order"), decidedAt: null, cancelledAt: null, ...data };
        mem.outreachOrder.push(row);
        return row;
      },
      update: async ({ where, data }: any) => {
        const row = mem.outreachOrder.find((r) => r.id === where.id);
        if (!row) throw new Error("not found");
        Object.assign(row, data);
        return row;
      },
      updateMany: async ({ where, data }: any) => {
        let count = 0;
        for (const r of mem.outreachOrder) if (matchWhere(r, where)) { Object.assign(r, data); count++; }
        return { count };
      },
    },
    leadResearch: {
      findUnique: async ({ where }: any) => {
        const k = where.tenantId_leadKey;
        return mem.leadResearch.find((r) => r.tenantId === k.tenantId && r.leadKey === k.leadKey) ?? null;
      },
      findMany: async ({ where }: any = {}) => mem.leadResearch.filter((r) => matchWhere(r, where)),
      updateMany: async ({ where, data }: any) => {
        let count = 0;
        for (const r of mem.leadResearch) if (matchWhere(r, where)) { Object.assign(r, data); count++; }
        return { count };
      },
      upsert: async ({ where, create, update }: any) => {
        const k = where.tenantId_leadKey;
        const existing: Row | undefined = mem.leadResearch.find((r) => r.tenantId === k.tenantId && r.leadKey === k.leadKey);
        if (!existing) {
          const row: Row = { id: nid("res"), researchedAt: new Date(), checkedAt: null, ...create };
          mem.leadResearch.push(row);
          return row;
        }
        Object.assign(existing, update);
        return existing;
      },
    },
    followUp: {
      findFirst: async ({ where }: any) => mem.followUp.find((r) => matchWhere(r, where)) ?? null,
      create: async ({ data }: any) => {
        const row = { id: nid("fu"), ...data };
        mem.followUp.push(row);
        return row;
      },
      updateMany: async ({ where, data }: any) => {
        let count = 0;
        for (const r of mem.followUp) if (matchWhere(r, where)) { Object.assign(r, data); count++; }
        return { count };
      },
    },
    activityEvent: { create: async ({ data }: any) => { const r = { id: nid("act"), ...data }; mem.activityEvent.push(r); return r; } },
    leadLifecycleEvent: { create: async ({ data }: any) => { const r = { id: nid("lc"), ...data }; mem.leadLifecycleEvent.push(r); return r; } },
    acquisitionDataImport: { findMany: async () => [] },
    acquisitionEntitlement: {
      findUnique: async ({ where }: any) => ({
        id: "ent_test", tenantId: where.tenantId, status: "ACTIVE", source: "TRIAL",
        trialStartedAt: null, trialExpiresAt: null,
        startedAt: new Date(), expiresAt: new Date(Date.now() + 86_400_000),
      }),
      update: async ({ where, data }: any) => ({ id: "ent_test", tenantId: where.tenantId, status: "ACTIVE", ...data }),
    },
    auditLog: {
      create: async ({ data }: any) => { const r = { id: nid("audit"), ...data }; mem.auditLog.push(r); return r; },
      count: async () => mem.auditLog.length,
      findMany: async () => [...mem.auditLog],
    },
  };
}

vi.mock("@wavesco/db", () => ({
  prisma: {},
  withTenantContext: async (_tid: string, fn: any) => fn(makeTx()),
}));

// ---------------------------------------------------------------------------
// Synthetic corpus (mock lead-engine SQLite)
// ---------------------------------------------------------------------------
function baseLead(over: Record<string, any>): any {
  return {
    id: 1, business: "Apex Fitness Hub", category: "Gym / Fitness Studio",
    area: "Vashi", city: "Navi Mumbai", phone: "+911234567890", whatsapp: null,
    email: "owner@apexfit-test.example", website: "https://apexfit-test.example",
    instagram: "@apexfit.test", rating: 4.6, reviews: 210, digital_score: 28,
    lead_score: 72, tier: "B", problem: "outdated website with no trial booking",
    opportunity: "online trial funnel", reason: "strong brand weak digital",
    outreach_angle: "trial booking gap", wavesco_service: "website and trial funnel",
    digital_assessment: "Basic site, no online booking", contact_name: null, role: null,
    decision_maker: null, source_urls: JSON.stringify(["https://apexfit-test.example/about"]),
    verification: "Verified", site_class: "basic", status: "new", email_status: "Verified",
    date_contacted: null, reply_status: null, opted_out: 0, bounced: 0, next_follow_up: null,
    name_key: "apex-fit-vashi", batch_id: "2026-01-01-001",
    first_discovered: "2026-01-01", last_researched: "2026-01-02", ...over,
  };
}
const corpus: Record<string, any> = {
  "apex-fit-vashi": baseLead({}),
  "queueline-test": baseLead({ business: "QueueLine Studios", name_key: "queueline-test", email: "hello@queueline-test.example", status: "queued" }),
  "noemail-test": baseLead({ business: "NoMail Fitness", name_key: "noemail-test", email: null, email_status: null, verification: null }),
  "bounced-test": baseLead({ business: "Bounce Gym", name_key: "bounced-test", email: "hard@bounced-test.example", bounced: 1 }),
  "optout-test": baseLead({ business: "OptOut Yoga", name_key: "optout-test", email: "stop@optout-test.example", opted_out: 1 }),
  "badmail-test": baseLead({ business: "BadMail Crossfit", name_key: "badmail-test", email: "not-an-email", email_status: null, verification: null }),
  "upper-unverified-test": baseLead({ business: "Upper Unverified Pilates", name_key: "upper-unverified-test", email: "hi@upperunverified-test.example", email_status: "Unverified", verification: "UNVERIFIED" }),
  "verifyfirst-test": baseLead({ business: "VerifyFirst Zumba", name_key: "verifyfirst-test", email: "team@verifyfirst-test.example", email_status: "Verify First", verification: "Verify First" }),
  "disposable-test": baseLead({ business: "Disposable Boxing", name_key: "disposable-test", email: "x@tempmail.com", email_status: null, verification: null }),
  "noname-test": baseLead({ business: "", name_key: "noname-test" }),
  "minimal-test": baseLead({ business: "Minimal MMA", name_key: "minimal-test", category: null, website: null, instagram: null, email: null, email_status: null, verification: null, phone: null, rating: null, reviews: null, digital_assessment: null, source_urls: null, problem: null, opportunity: null, outreach_angle: null, wavesco_service: null, reason: null }),
  "dupemail-a": baseLead({ business: "Twin A Strength", name_key: "dupemail-a", email: "same@twins-test.example" }),
  "dupemail-b": baseLead({ business: "Twin B Strength", name_key: "dupemail-b", email: "SAME@twins-test.example" }),
  "ref-test": baseLead({ business: "Seed Reference Gym", name_key: "ref-test", status: "reference" }),
};

vi.mock("@/lib/wavesco/lead-engine", () => ({
  openReadonly: () => ({
    prepare: (sql: string) => {
      if (sql.includes("name_key = ?")) return { get: (k: string) => corpus[k] };
      return { all: () => Object.values(corpus) };
    },
    close: () => {},
  }),
  updateLeadOutreachState: async (nameKey: string, fields: any) => {
    cells.outreachWrites.push({ nameKey, fields });
    return {};
  },
}));

vi.mock("@/lib/wavesco/n8n", () => ({
  n8nBaseUrl: () => (process.env.N8N_BASE_URL ?? "").trim(),
  submitApproval: vi.fn(async () => ({ ok: true, status: 200, data: { approval_id: 4242 } })),
  decideApproval: vi.fn(async () => ({ ok: true, status: 200, data: {} })),
}));
vi.mock("@/lib/wavesco/obsidian", () => ({
  putNote: async () => ({ ok: true }),
  appendNote: async () => ({ ok: true }),
  readNote: async () => ({ ok: true, data: "" }),
}));
vi.mock("@/lib/wavesco/notify", () => ({
  onCampaignDeployed: vi.fn(),
  onEmailsReadyForReview: vi.fn(),
  onNewResponsesDetected: vi.fn(),
  onPositiveResponseDetected: vi.fn(),
  processDueFollowUpMilestones: vi.fn(async () => 0),
  onCampaignResultsFinalized: vi.fn(),
}));
vi.mock("@/lib/wavesco/control", async () => {
  // Real entitlement gate (production logic in entitlements.ts, which has no
  // auth imports) against the mock DB. Fully-mocked control would skip the
  // gate entirely; importOriginal of control pulls next-auth (unresolvable
  // under vitest), so we re-wire the same two calls the real wrapper makes.
  const ent = await import("@/lib/wavesco/entitlements");
  return {
    requireControlAuth: async () => ({
      tenantId: "t-ironpulse",
      userId: "u-owner",
      // The campaign control route enforces owner/admin on status changes.
      session: { user: { id: "u-owner", role: "owner" } },
    }),
    // Mirrors the real pure helper (control.ts cannot be importOriginal'd here
    // because it pulls next-auth).
    sessionRole: (s: unknown) => {
      const role = (s as { user?: { role?: unknown } } | null)?.user?.role;
      return role === "owner" || role === "admin" || role === "member" ? role : "member";
    },
    auditControl: async (a: any) => {
      const r = { id: nid("audit"), ...a };
      mem.auditLog.push(r);
      return r;
    },
    acquisitionDenied: async (tenantId: string) => {
      try {
        await ent.requireAcquisitionAccess(tenantId);
        return null;
      } catch (e) {
        return (
          ent.entitlementDeniedPayload(e) ?? {
            status: 500,
            body: { error: "entitlement_check_failed", reason: "Could not verify access." },
          }
        );
      }
    },
  };
});

// ---------------------------------------------------------------------------
// Imports under test (real modules)
// ---------------------------------------------------------------------------
import {
  validateProfileInput, readinessCheck, canTransition, nextStatusForAction,
  redactSecrets, maskUrl, buildAgentContext,
} from "@/lib/wavesco/acquisition-profile";
import { classifyEmail, composeFallback, coercePlanned, NOT_FOUND } from "@/lib/wavesco/outreach-logic";
import { decideNextAction } from "@/lib/wavesco/smart-engine";
import {
  buildResearchRecord, researchLead, checkLeadEmail, createOutreachOrder,
  submitOrderToApproval, decideOrderApproval, cancelOrder, reconcileOrderSend,
} from "@/lib/wavesco/pipeline";
import { can } from "@/lib/permissions";
import {
  generateUnsubscribeToken, verifyUnsubscribeToken, buildUnsubscribeUrl,
  appendUnsubscribeFooter, normalizeEmail, isRecipientSuppressed, suppressRecipient,
} from "@/lib/wavesco/unsubscribe";

const TID = "t-ironpulse";
const UID = "u-owner";

function synthProfile(over: Record<string, any> = {}): any {
  return {
    id: "prof_1", tenantId: TID, status: "DRAFT", version: 1,
    companyName: "IronPulse Fitness Studio (SYNTHETIC TEST)",
    website: "https://ironpulse-test.example", industry: "Fitness",
    whatWeSell: "premium small-group personal training",
    productsServices: ["small-group training", "7-day trial"],
    locationsServed: ["Vashi", "Nerul"], businessModel: "membership",
    acquisitionObjective: "acquire trial members", primaryObjective: "book trial visits",
    targetQuantity: 30, targetTimeframe: "60 days", priorityProductService: "7-day trial",
    icp: { targetCustomer: "local professionals 25-45", geography: "Vashi, Nerul, Navi Mumbai" },
    offer: { productService: "7-day trial membership", valueProp: "coach-led trial week" },
    brand: { toneOfVoice: "direct, no hype" }, integrations: { emailMode: "waves_managed" },
    rules: { geoRestrictions: "Navi Mumbai only", operationalLimits: { daily: 20 } },
    readiness: null, activatedAt: null, pausedAt: null, suspendedAt: null, ...over,
  };
}
function synthLead(over: Record<string, any> = {}): any {
  return baseLead(over);
}

const OLD_ENV = { ...process.env };
beforeEach(() => {
  for (const k of Object.keys(mem)) (mem as any)[k] = [];
  cells.outreachWrites = [];
  cells.lastWhere = [];
  failNextCreate = null;
  idSeq = 1;
  vi.clearAllMocks();
  delete process.env.LEAD_ENGINE_GATEWAY_TOKEN;
  delete process.env.N8N_BASE_URL;
  delete process.env.N8N_API_KEY;
  delete process.env.UNSUBSCRIBE_SECRET;
  delete process.env.UNRESUBSCRIBE_SECRET;
});
afterEach(() => { process.env = { ...OLD_ENV }; });

// ---------------------------------------------------------------------------
// PHASE 1/2 — profile & onboarding journey
// ---------------------------------------------------------------------------
describe("client journey — profile validation & readiness", () => {
  it("accepts the synthetic fitness-studio profile and strips unknown keys", () => {
    const p = synthProfile();
    const { valid, errors, sanitized } = validateProfileInput({ ...p, hacker: true, id: "x" });
    expect(valid).toBe(true);
    expect(errors).toEqual([]);
    expect((sanitized as any).hacker).toBeUndefined();
    expect((sanitized as any).companyName).toContain("IronPulse");
  });
  it("empty profile → DRAFT, 9 missing, not ready (client cannot activate)", () => {
    const r = readinessCheck({ id: "x", tenantId: TID, status: "DRAFT", version: 1 } as any);
    expect(r.ready).toBe(false);
    expect(r.status).toBe("DRAFT");
    expect(r.missing).toHaveLength(9);
    const act = nextStatusForAction("DRAFT", "activate", r);
    expect(act.next).toBeNull();
    expect(act.error).toMatch(/missing/i);
  });
  it("partial profile → INCOMPLETE with named gaps", () => {
    const r = readinessCheck(synthProfile({ whatWeSell: null, icp: {}, offer: {} }));
    expect(r.ready).toBe(false);
    expect(r.status).toBe("INCOMPLETE");
    expect(r.missing.join("|")).toMatch(/What the company sells/);
  });
  it("complete synthetic profile → READY → activate → ACTIVE", () => {
    const r = readinessCheck(synthProfile());
    expect(r.ready).toBe(true);
    expect(r.status).toBe("READY");
    expect(nextStatusForAction("READY", "activate", r)).toEqual({ next: "ACTIVE" });
  });
  it("rejects invalid website and negative targetQuantity", () => {
    expect(validateProfileInput({ website: "has space!" }).errors).toMatchObject([expect.stringMatching(/URL/i)]);
    expect(validateProfileInput({ website: "notaurl" }).errors).toMatchObject([expect.stringMatching(/URL/i)]);
    expect(validateProfileInput({ targetQuantity: -5 }).errors).toMatchObject([expect.stringMatching(/non-negative/i)]);
    expect(validateProfileInput({ targetQuantity: "30" }).valid).toBe(true);
  });
  it("redacts secrets at any depth before persisting", () => {
    const out: any = redactSecrets({ integrations: { smtp: { auth: { password: "s3cret", host: "h" } } }, api_key: "k" });
    expect(JSON.stringify(out)).not.toContain("s3cret");
    expect(JSON.stringify(out)).not.toContain('"k"');
    expect(out.integrations.smtp.auth.host).toBe("h");
  });
  it("state machine guards: double-activate, pause-from-READY, resume-guards, suspend-guards", () => {
    const ready = readinessCheck(synthProfile());
    expect(nextStatusForAction("ACTIVE", "activate", ready).error).toMatch(/Already active/);
    expect(nextStatusForAction("READY", "pause", ready).error).toMatch(/only pause from ACTIVE/i);
    expect(nextStatusForAction("ACTIVE", "pause", ready)).toEqual({ next: "PAUSED" });
    const incomplete = readinessCheck({ id: "x", tenantId: TID, status: "PAUSED", version: 1 } as any);
    expect(nextStatusForAction("PAUSED", "resume", incomplete).error).toMatch(/missing/i);
    expect(nextStatusForAction("PAUSED", "resume", ready)).toEqual({ next: "ACTIVE" });
    expect(nextStatusForAction("READY", "suspend", ready).error).toMatch(/ACTIVE\/PAUSED/);
    expect(nextStatusForAction("ACTIVE", "suspend", ready)).toEqual({ next: "SUSPENDED" });
    expect(canTransition("ACTIVE", "READY")).toBe(true);
    expect(canTransition("READY", "SUSPENDED")).toBe(false);
  });
  it("maskUrl never leaks host; agent context carries no secrets", async () => {
    expect(maskUrl("https://ironpulse-test.example/p?q=1")).toBe("https://***");
    expect(maskUrl("notaurl")).toBe("***");
    const ctx: any = await buildAgentContext(TID, synthProfile({ integrations: { api_key: "live-secret" } }));
    expect(JSON.stringify(ctx)).not.toContain("live-secret");
    expect(ctx.meta.model).toBe("nemotron-3-super");
    expect(ctx.current_state.readiness.ready).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Email gate + SmartEngine
// ---------------------------------------------------------------------------
describe("client journey — email eligibility gate", () => {
  it("NOT_FOUND on missing / malformed email", () => {
    expect(classifyEmail(synthLead({ email: null }), new Set()).status).toBe("NOT_FOUND");
    expect(classifyEmail(synthLead({ email: "not-an-email" }), new Set()).status).toBe("NOT_FOUND");
  });
  it("UNVERIFIED on placeholder mailbox", () => {
    expect(classifyEmail(synthLead({ email: "noreply@apexfit-test.example" }), new Set()).status).toBe("UNVERIFIED");
  });
  it("opt-out / bounce beat verification", () => {
    expect(classifyEmail(corpus["optout-test"], new Set()).status).toBe("OPTED_OUT");
    expect(classifyEmail(corpus["bounced-test"], new Set()).status).toBe("BOUNCED");
  });
  it("contacted/meeting statuses block; research-queued status must NOT block", () => {
    expect(classifyEmail(corpus["apex-fit-vashi"], new Set()).status).toBe("VERIFIED");
    expect(classifyEmail(synthLead({ date_contacted: "2026-01-03" }), new Set()).status).toBe("ALREADY_CONTACTED");
    expect(classifyEmail(synthLead({ status: "meeting" }), new Set()).status).toBe("ALREADY_CONTACTED");
    // queued = waiting for research, never contacted → must stay eligible
    expect(classifyEmail(corpus["queueline-test"], new Set()).status).toBe("VERIFIED");
  });
  it("global email dedupe is case-insensitive", () => {
    const live = new Set(["same@twins-test.example"]);
    expect(classifyEmail(corpus["dupemail-b"], live).status).toBe("ALREADY_CONTACTED");
  });
});

describe("client journey — SmartEngine decisions", () => {
  it("complete synthetic lead → CREATE_OUTREACH/eligible", () => {
    const r = decideNextAction(corpus["apex-fit-vashi"]);
    expect(r.decision).toBe("CREATE_OUTREACH");
    expect(r.eligibility).toBe("eligible");
    expect(r.checks).toHaveLength(13);
  });
  it("uppercase UNVERIFIED → VERIFY_EMAIL (case-insensitive)", () => {
    const r = decideNextAction(corpus["upper-unverified-test"]);
    expect(r.decision).toBe("VERIFY_EMAIL");
    expect(r.eligibility).toBe("needs_verification");
  });
  it("'Verify First' is NOT verified → must not route to CREATE_OUTREACH", () => {
    const r = decideNextAction(corpus["verifyfirst-test"]);
    expect(r.decision).not.toBe("CREATE_OUTREACH");
    expect(["VERIFY_EMAIL", "RESEARCH_FURTHER", "ENRICH"]).toContain(r.decision);
  });
  it("disposable / missing name / missing email route correctly", () => {
    expect(decideNextAction(corpus["disposable-test"]).decision).toBe("REJECT");
    expect(decideNextAction(corpus["noname-test"]).decision).toBe("REJECT");
    expect(decideNextAction(corpus["noemail-test"]).decision).toBe("ENRICH");
    expect(decideNextAction(corpus["minimal-test"]).decision).toBe("RETAIN");
  });
});

// ---------------------------------------------------------------------------
// Composer / planner shaping (malformed AI, hallucination, timeout)
// ---------------------------------------------------------------------------
describe("client journey — outreach drafting robustness", () => {
  const facts = {
    business: "Apex Fitness Hub", contact: NOT_FOUND, category: "Gym / Fitness Studio",
    location: "Vashi, Navi Mumbai", website: "https://apexfit-test.example",
    presence: "basic — no online booking", problem: "outdated website with no trial booking",
    opportunity: "online trial funnel", serviceFit: "website and trial funnel",
    angleSeed: "trial booking gap", sources: ["https://apexfit-test.example/about"],
  };
  it("fallback composer is individualized, signed, 3d/7d follow-ups", () => {
    const p = composeFallback(facts);
    expect(p.body).toMatch(/Apex Fitness Hub/);
    expect(p.body).toMatch(/Amey/);
    expect(p.followUps).toHaveLength(2);
    expect(p.followUps.map((f) => f.offsetDays)).toEqual([3, 7]);
    expect(p.model).toBe("fact-composer");
  });
  it("coercePlanned rejects empty/missing subject/body (AI timeout/blank → null)", () => {
    const fb = composeFallback(facts);
    expect(coercePlanned(null, fb)).toBeNull();
    expect(coercePlanned({}, fb)).toBeNull();
    expect(coercePlanned({ subject: "Hi" }, fb)).toBeNull();
    expect(coercePlanned("string", fb)).toBeNull();
  });
  it("malformed follow_ups are backfilled to 2; hallucinated keys ignored; long fields truncated", () => {
    const fb = composeFallback(facts);
    const p = coercePlanned({ subject: "Idea for Apex", body: "Body here", follow_ups: [{ nope: 1 }], hacked: true, model: "x" }, fb)!;
    expect(p).not.toBeNull();
    expect(p.followUps).toHaveLength(2);
    expect((p as any).hacked).toBeUndefined();
    const long = coercePlanned({ subject: "s".repeat(500), body: "b".repeat(9000), follow_ups: [] }, fb)!;
    expect(long.subject.length).toBeLessThanOrEqual(200);
    expect(long.body.length).toBeLessThanOrEqual(3800);
  });
});

// ---------------------------------------------------------------------------
// Research record
// ---------------------------------------------------------------------------
describe("client journey — research snapshot", () => {
  it("rating separator is a clean interpunct (no mojibake)", () => {
    const r = buildResearchRecord(corpus["apex-fit-vashi"]);
    expect(r.ratingReviews).toContain("·");
    expect(r.ratingReviews).not.toContain("Â");
    expect(r.location).toBe("Vashi, Navi Mumbai");
    expect(r.sources).toEqual(["https://apexfit-test.example/about"]);
  });
  it("malformed source_urls and '?' placeholders degrade to empty/NOT_FOUND", () => {
    const r = buildResearchRecord(synthLead({ source_urls: "{bad json", website: "?", problem: null }));
    expect(r.sources).toEqual([]);
    expect(r.website).toBe(NOT_FOUND);
    expect(r.problem).toBe(NOT_FOUND);
  });
  it("researchLead persists snapshot; reference seed rows are refused", async () => {
    const ok = await researchLead(TID, "apex-fit-vashi");
    expect(ok.ok).toBe(true);
    expect(mem.leadResearch).toHaveLength(1);
    const again = await researchLead(TID, "apex-fit-vashi");
    expect(again.ok).toBe(true);
    expect(mem.leadResearch).toHaveLength(1); // idempotent upsert
    const ref = await researchLead(TID, "ref-test");
    expect(ref.ok).toBe(false);
    expect(await researchLead(TID, "ghost-key")).toEqual(expect.objectContaining({ ok: false }));
  });
  it("checkLeadEmail gates and writes back outreach state", async () => {
    const v = await checkLeadEmail(TID, "apex-fit-vashi");
    expect(v.ok).toBe(true);
    expect(v.status).toBe("VERIFIED");
    expect(cells.outreachWrites.at(-1)).toMatchObject({ nameKey: "apex-fit-vashi", fields: { email_status: "Verified" } });
    const b = await checkLeadEmail(TID, "badmail-test");
    expect(b.status).toBe("NOT_FOUND");
    expect(await checkLeadEmail(TID, "ghost-key")).toMatchObject({ ok: false });
  });
});

// ---------------------------------------------------------------------------
// Outreach order lifecycle (duplicates, suppression, races, cancel, reconcile)
// ---------------------------------------------------------------------------
describe("client journey — outreach order lifecycle", () => {
  async function researched(key = "apex-fit-vashi") {
    const r = await researchLead(TID, key);
    expect(r.ok).toBe(true);
  }
  it("requires research first; requires eligible email", async () => {
    expect(await createOutreachOrder(TID, UID, "apex-fit-vashi")).toMatchObject({ ok: false, error: expect.stringMatching(/research first/i) });
    await researched("badmail-test");
    expect(await createOutreachOrder(TID, UID, "badmail-test")).toMatchObject({ ok: false, error: expect.stringMatching(/not eligible/i) });
  });
  it("happy path → READY_FOR_APPROVAL v1; duplicate blocked; cancel → v2 allowed", async () => {
    await researched();
    const c1 = await createOutreachOrder(TID, UID, "apex-fit-vashi");
    expect(c1.ok).toBe(true);
    expect(mem.outreachOrder[0]!.version).toBe(1);
    expect(mem.outreachOrder[0]!.status).toBe("READY_FOR_APPROVAL");
    expect(await createOutreachOrder(TID, UID, "apex-fit-vashi")).toMatchObject({ ok: false, error: expect.stringMatching(/already has a live/i) });
    // email taken by another lead → refused (eligibility gate fires first: defense in depth)
    await researched("dupemail-a");
    mem.outreachOrder.push({ id: nid("order"), tenantId: TID, leadKey: "dupemail-b-holder", businessName: "Holder", email: "same@twins-test.example", status: "PENDING", version: 1, decidedAt: null, cancelledAt: null });
    const dup = await createOutreachOrder(TID, UID, "dupemail-a");
    expect(dup.ok).toBe(false);
    expect(String(dup.error)).toMatch(/live order|ALREADY_CONTACTED/i);
    // cancel then recreate → version bump
    expect(await cancelOrder(TID, c1.orderId!)).toMatchObject({ ok: true });
    expect(mem.followUp.filter((f) => f.status === "pending")).toHaveLength(0);
    const c2 = await createOutreachOrder(TID, UID, "apex-fit-vashi");
    expect(c2.ok).toBe(true);
    expect(mem.outreachOrder.find((o) => o.id === c2.orderId)?.version).toBe(2);
  });
  it("suppressed recipients can never be re-created or queued", async () => {
    await researched("optout-test");
    // corpus opt-out blocks at eligibility
    expect(await createOutreachOrder(TID, UID, "optout-test")).toMatchObject({ ok: false });
    // explicit suppression record blocks even verified lookalikes
    const tx: any = makeTx();
    mem.outreachOrder.push({ id: nid("order"), tenantId: TID, leadKey: "k", businessName: "B", email: "gone@test.example", status: "SENT", replyStatus: null, version: 1, decidedAt: null, cancelledAt: null });
    await suppressRecipient(tx, TID, "gone@test.example", "test");
    expect(await isRecipientSuppressed(tx, TID, "GONE@test.example")).toBe(true);
  });
  it("concurrent duplicate create degrades to a friendly retry error (no raw 500)", async () => {
    await researched();
    failNextCreate = "P2002";
    const r = await createOutreachOrder(TID, UID, "apex-fit-vashi");
    expect(r.ok).toBe(false);
    expect(String(r.error)).toMatch(/already|retry|concurrent/i);
  });
  it("submit requires queued state; missing unsubscribe secret fails closed (no silent footer-less send)", async () => {
    await researched();
    const c = await createOutreachOrder(TID, UID, "apex-fit-vashi");
    const { submitApproval } = await import("@/lib/wavesco/n8n");
    // no secret → must refuse BEFORE calling Approval Queue
    const refused = await submitOrderToApproval(TID, c.orderId!);
    expect(refused.ok).toBe(false);
    expect(String(refused.error)).toMatch(/unsubscribe/i);
    expect(submitApproval).not.toHaveBeenCalled();
    // with secret → queues, idempotent on retry
    process.env.UNSUBSCRIBE_SECRET = "synthetic-test-secret-32-chars-minimum-ok";
    const q1 = await submitOrderToApproval(TID, c.orderId!);
    expect(q1.ok).toBe(true);
    expect(mem.outreachOrder.find((o) => o.id === c.orderId)?.status).toBe("PENDING");
    const q2 = await submitOrderToApproval(TID, c.orderId!);
    expect(q2).toMatchObject({ ok: true, approvalId: q1.approvalId });
    expect(submitApproval).toHaveBeenCalledTimes(1);
  });
  it("decide refuses never-submitted and double decisions", async () => {
    process.env.N8N_BASE_URL = "http://127.0.0.1:9";
    await researched();
    const c = await createOutreachOrder(TID, UID, "apex-fit-vashi");
    expect(await decideOrderApproval(TID, c.orderId!, "approve")).toMatchObject({ ok: false, error: expect.stringMatching(/never submitted/i) });
    const row = mem.outreachOrder.find((o) => o.id === c.orderId)!;
    row.approvalId = "4242";
    row.decidedAt = new Date();
    row.status = "APPROVED";
    expect(await decideOrderApproval(TID, c.orderId!, "approve")).toMatchObject({ ok: false, error: expect.stringMatching(/Already decided/i) });
  });
  it("cancel refuses SENT; reconcile never fabricates SENT and is idempotent", async () => {
    await researched();
    const c = await createOutreachOrder(TID, UID, "apex-fit-vashi");
    const row = mem.outreachOrder.find((o) => o.id === c.orderId)!;
    row.status = "SENT";
    expect(await cancelOrder(TID, c.orderId!)).toMatchObject({ ok: false, error: expect.stringMatching(/Already sent/i) });
    expect(await reconcileOrderSend(TID, c.orderId!)).toMatchObject({ ok: true, sent: true });
    row.status = "APPROVED";
    row.approvalId = "4242";
    delete process.env.N8N_BASE_URL;
    delete process.env.N8N_API_KEY;
    const p = await reconcileOrderSend(TID, c.orderId!);
    expect(p.deliveryStatus).toBe("pending_reconciliation");
    expect(mem.outreachOrder.find((o) => o.id === c.orderId)?.status).toBe("APPROVED");
    expect(await reconcileOrderSend(TID, "ghost")).toMatchObject({ ok: false });
  });
});

// ---------------------------------------------------------------------------
// Campaign state machine (real route handler)
// ---------------------------------------------------------------------------
describe("client journey — campaign control transitions", () => {
  async function post(id: string, action: string) {
    const { POST } = await import("@/app/api/acquisition/campaigns/[id]/control/route");
    const req = new Request("http://localhost/api", { method: "POST", body: JSON.stringify({ action }) });
    return POST(req, { params: Promise.resolve({ id }) });
  }
  it("draft → scheduled → running → paused → stopped; illegal jumps 400; double-stop 400", async () => {
    mem.campaign.push({ id: "camp1", tenantId: TID, name: "Trial push", status: "draft" });
    expect(await (await post("camp1", "pause")).status).toBe(400); // cannot pause draft
    expect(await (await post("camp1", "launch")).status).toBe(200);
    expect(await (await post("camp1", "launch")).status).toBe(400); // already scheduled
    mem.campaign[0]!.status = "running"; // simulate scheduler pickup
    expect(await (await post("camp1", "resume")).status).toBe(400); // resume only from paused
    expect(await (await post("camp1", "pause")).status).toBe(200);
    expect(await (await post("camp1", "resume")).status).toBe(200);
    expect(await (await post("camp1", "stop")).status).toBe(200);
    expect(await (await post("camp1", "stop")).status).toBe(400); // terminal
    expect(await (await post("camp1", "bogus")).status).toBe(400);
    expect(await (await post("ghost", "stop")).status).toBe(404);
    expect(mem.auditLog.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// RBAC + tenant isolation + unsubscribe security
// ---------------------------------------------------------------------------
describe("security — RBAC matrix", () => {
  it("member reads only; admin creates/updates; owner deletes/approves", () => {
    expect(can({ role: "member" }, "read", "acquisition")).toBe(true);
    expect(can({ role: "member" }, "create", "acquisition")).toBe(false);
    expect(can({ role: "member" }, "update", "acquisition")).toBe(false);
    expect(can({ role: "member" }, "admin", "acquisition")).toBe(false);
    expect(can({ role: "admin" }, "create", "acquisition")).toBe(true);
    expect(can({ role: "admin" }, "update", "acquisition")).toBe(true);
    expect(can({ role: "admin" }, "delete", "acquisition")).toBe(false);
    expect(can({ role: "admin" }, "admin", "acquisition")).toBe(false);
    expect(can({ role: "owner" }, "delete", "acquisition")).toBe(true);
    expect(can({ role: "owner" }, "admin", "acquisition")).toBe(true);
    expect(can({ role: "intruder" }, "create", "acquisition")).toBe(false);
    expect(can({ role: "intruder" }, "read", "acquisition")).toBe(true);
  });
});

describe("security — tenant isolation", () => {
  it("cross-tenant campaign/order reads return not-found; every query carries tenantId", async () => {
    mem.campaign.push({ id: "campA", tenantId: "tenant-A", name: "A", status: "draft" });
    const { POST } = await import("@/app/api/acquisition/campaigns/[id]/control/route");
    const req = new Request("http://localhost/api", { method: "POST", body: JSON.stringify({ action: "stop" }) });
    // control auth is fixed to t-ironpulse → tenant-A row must be invisible
    expect(await (await POST(req, { params: Promise.resolve({ id: "campA" }) })).status).toBe(404);
    await researchLead(TID, "apex-fit-vashi");
    await createOutreachOrder(TID, UID, "apex-fit-vashi");
    const scoped = cells.lastWhere.filter((w) => w.model === "outreachOrder");
    expect(scoped.length).toBeGreaterThan(0);
    for (const w of scoped) {
      if (w.where && typeof w.where === "object" && "tenantId" in w.where) expect(w.where.tenantId).toBe(TID);
    }
  });
});

describe("security — unsubscribe tokens", () => {
  it("roundtrips; tampering/wrong-secret/no-secret fail closed", () => {
    process.env.UNSUBSCRIBE_SECRET = "synthetic-test-secret-32-chars-minimum-ok";
    const tok = generateUnsubscribeToken(TID, "Client@Test.Example")!;
    expect(tok.startsWith("v1.")).toBe(true);
    expect(verifyUnsubscribeToken(tok)).toMatchObject({ t: TID, e: "client@test.example" });
    const parts = tok.split(".");
    expect(verifyUnsubscribeToken(`v1.${parts[1]}.AAAAAAAA`)).toBeNull();
    expect(verifyUnsubscribeToken(`${parts[0]}.e30.${parts[2]}`)).toBeNull();
    expect(verifyUnsubscribeToken("garbage")).toBeNull();
    process.env.UNSUBSCRIBE_SECRET = "different-secret-00000000000000000000";
    expect(verifyUnsubscribeToken(tok)).toBeNull();
    delete process.env.UNSUBSCRIBE_SECRET;
    expect(generateUnsubscribeToken(TID, "a@b.example")).toBeNull();
    expect(verifyUnsubscribeToken(tok)).toBeNull();
    expect(buildUnsubscribeUrl(TID, "a@b.example")).toBeNull();
  });
  it("footer appended only when a real URL exists; email normalized", () => {
    process.env.UNSUBSCRIBE_SECRET = "synthetic-test-secret-32-chars-minimum-ok";
    const url = buildUnsubscribeUrl(TID, "lead@test.example")!;
    expect(url).toContain("/api/unsubscribe?token=");
    expect(appendUnsubscribeFooter("Hi", "Apex", url)).toContain("Unsubscribe:");
    expect(appendUnsubscribeFooter("Hi", "Apex", null)).toBe("Hi");
    expect(normalizeEmail("  A@B.Example ")).toBe("a@b.example");
  });
});
