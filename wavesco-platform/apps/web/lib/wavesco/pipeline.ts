import { existsSync, readFileSync } from "node:fs";
import { withTenantContext } from "@wavesco/db";
import {
  openReadonly,
  updateLeadOutreachState,
  type EngineLead,
} from "./lead-engine";
import {
  NOT_FOUND,
  classifyEmail,
  coercePlanned,
  composeFallback,
  isPositiveReply,
  type EmailCheckResult,
  type PlannedEmail,
  type PlannerFacts,
} from "./outreach-logic";

export { classifyEmail } from "./outreach-logic";
import { n8nBaseUrl, submitApproval } from "./n8n";
import { appendNote, putNote, readNote } from "./obsidian";
import { onCampaignDeployed, onEmailsReadyForReview, onNewResponsesDetected, onPositiveResponseDetected, processDueFollowUpMilestones } from "./notify";
import { appendUnsubscribeFooter, buildUnsubscribeUrl, isRecipientSuppressed, suppressRecipient } from "./unsubscribe";

/**
 * Lead Intelligence → Email Outreach Order Pipeline.
 *
 * Stage functions over the EXISTING systems:
 * - lead corpus: Lead Engine SQLite (read-only except outreach-state columns)
 * - approval + dispatch: existing Approval Queue / Email Outbox webhooks
 * - notifications: existing Notify Hub bridge (Telegram)
 * - operational log: existing Obsidian Local REST API vault
 *
 * Nothing here fabricates data: every field is traceable to the engine
 * corpus or marked "Not found". All lifecycle transitions are idempotent.
 */

const LIVE_ORDER_STATUSES = ["READY_FOR_APPROVAL", "PENDING", "APPROVED", "SENT", "DELIVERED"] as const;

type Tx = Parameters<Parameters<typeof withTenantContext>[1]>[0];

// ------------------------------------------------------------------
// Corpus access (existing engine DB)
// ------------------------------------------------------------------

function parseSourceUrls(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((u): u is string => typeof u === "string") : [];
  } catch {
    return [];
  }
}

export function listPipelineLeads(filters?: {
  category?: string;
  location?: string;
}): EngineLead[] {
  const db = openReadonly();
  try {
    const where: string[] = [];
    const args: (string | number)[] = [];
    if (filters?.category && filters.category !== "all") {
      where.push("category = ?");
      args.push(filters.category);
    }
    if (filters?.location && filters.location !== "all") {
      where.push("(city = ? OR area = ?)");
      args.push(filters.location, filters.location);
    }
    const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
    return db
      .prepare(
        `SELECT * FROM leads ${whereSql} ORDER BY COALESCE(lead_score,0) DESC`,
      )
      .all(...args) as unknown as EngineLead[];
  } finally {
    db.close();
  }
}

// ------------------------------------------------------------------
// Stage 2 — LEAD RESEARCH (facts only, from the corpus row)
// ------------------------------------------------------------------

export interface ResearchRecord {
  business: string;
  category: string;
  location: string;
  website: string;
  instagram: string;
  presence: string;
  ratingReviews: string;
  problem: string;
  opportunity: string;
  serviceFit: string;
  angleSeed: string;
  contact: string;
  sources: string[];
}

function nf(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return NOT_FOUND;
  const s = String(v).trim();
  return s.length > 0 && s !== "?" ? s : NOT_FOUND;
}

export function buildResearchRecord(lead: EngineLead): ResearchRecord {
  const ratingReviews =
    lead.rating === null && lead.reviews === null
      ? NOT_FOUND
      : `${lead.rating ?? "?"} stars · ${lead.reviews ?? "?"} reviews`;
  return {
    business: nf(lead.business),
    category: nf(lead.category),
    location: [nf(lead.area), nf(lead.city)].filter((p) => p !== NOT_FOUND).join(", ") || NOT_FOUND,
    website: nf(lead.website),
    instagram: nf(lead.instagram),
    presence:
      nf(lead.site_class) !== NOT_FOUND
        ? `${nf(lead.site_class)}${lead.digital_assessment ? ` — ${lead.digital_assessment}` : ""}`
        : NOT_FOUND,
    ratingReviews,
    problem: nf(lead.problem),
    opportunity: nf(lead.opportunity),
    serviceFit: nf(lead.wavesco_service),
    angleSeed: nf(lead.outreach_angle),
    contact:
      lead.contact_name
        ? `${lead.contact_name}${lead.role ? ` (${lead.role})` : ""}`
        : NOT_FOUND,
    sources: parseSourceUrls(lead.source_urls),
  };
}

/** Persists the research snapshot for one lead. Idempotent per (tenant, leadKey). */
export async function researchLead(tenantId: string, nameKey: string): Promise<{ ok: boolean; error?: string }> {
  const lead = getEngineLead(nameKey);
  if (!lead || lead.status === "reference") {
    return { ok: false, error: lead ? "Reference seed row — not an active lead." : "Lead not found in the engine corpus." };
  }
  const r = buildResearchRecord(lead);
  await withTenantContext(tenantId, async (tx) => {
    await tx.leadResearch.upsert({
      where: { tenantId_leadKey: { tenantId, leadKey: nameKey } },
      create: {
        tenantId,
        leadKey: nameKey,
        engineLeadId: lead.id,
        business: lead.business,
        category: lead.category,
        area: lead.area,
        city: lead.city,
        website: lead.website,
        instagram: lead.instagram,
        rating: lead.rating,
        reviews: lead.reviews,
        tier: lead.tier,
        leadScore: lead.lead_score,
        digitalPresence: lead.site_class ?? lead.digital_assessment ?? null,
        problem: isFound(r.problem) ? r.problem : null,
        opportunity: isFound(r.opportunity) ? r.opportunity : null,
        serviceFit: isFound(r.serviceFit) ? r.serviceFit : null,
        angleSeed: isFound(r.angleSeed) ? r.angleSeed : null,
        contactName: lead.contact_name,
        contactRole: lead.role,
        email: lead.email,
        sourceUrls: r.sources as never,
        verification: lead.verification,
        notes: isFound(r.presence) ? r.presence : null,
      },
      update: {
        engineLeadId: lead.id,
        category: lead.category,
        area: lead.area,
        city: lead.city,
        website: lead.website,
        instagram: lead.instagram,
        rating: lead.rating,
        reviews: lead.reviews,
        tier: lead.tier,
        leadScore: lead.lead_score,
        digitalPresence: lead.site_class ?? lead.digital_assessment ?? null,
        problem: isFound(r.problem) ? r.problem : null,
        opportunity: isFound(r.opportunity) ? r.opportunity : null,
        serviceFit: isFound(r.serviceFit) ? r.serviceFit : null,
        angleSeed: isFound(r.angleSeed) ? r.angleSeed : null,
        contactName: lead.contact_name,
        contactRole: lead.role,
        email: lead.email,
        sourceUrls: r.sources as never,
        verification: lead.verification,
        notes: isFound(r.presence) ? r.presence : null,
        researchedAt: new Date(),
      },
    });
  });
  return { ok: true };
}

function isFound(v: string): boolean {
  return v !== NOT_FOUND;
}

function getEngineLead(nameKey: string): EngineLead | undefined {
  const db = openReadonly();
  try {
    return db.prepare("SELECT * FROM leads WHERE name_key = ?").get(nameKey) as EngineLead | undefined;
  } finally {
    db.close();
  }
}

// ------------------------------------------------------------------
// Stage 3 — EMAIL CHECK (validate + global dedupe; nothing is sent)
// ------------------------------------------------------------------

async function collectLiveOrderEmails(db: Tx, excludeLeadKey: string | null, tenantId?: string): Promise<Set<string>> {
  // Scope to the caller's tenant. The previous unbounded `where` returned every
  // tenant's live-order addresses, so an address was "already live" only
  // because of *another* tenant's order — leaking contact existence across
  // workspaces and silently suppressing one tenant's outreach because a
  // different tenant touched the same address.
  const rows = await db.outreachOrder.findMany({
    where: tenantId
      ? { status: { in: [...LIVE_ORDER_STATUSES] }, tenantId }
      : { status: { in: [...LIVE_ORDER_STATUSES] } },
    select: { email: true, leadKey: true },
  });
  return new Set(rows.filter((r) => r.leadKey !== excludeLeadKey).map((r) => r.email.toLowerCase()));
}

/** Runs the email-check stage for one lead and writes the state back to the corpus. */
export async function checkLeadEmail(tenantId: string, nameKey: string): Promise<EmailCheckResult & { ok: boolean }> {
  const lead = getEngineLead(nameKey);
  if (!lead) return { ok: false, status: "NOT_FOUND", email: null, reason: "lead not found" };

  const result = await withTenantContext(tenantId, async (tx) => {
    const live = await collectLiveOrderEmails(tx, nameKey, tenantId);
    const check = classifyEmail(lead, live);

    // Persist the check on the research row when present.
    await tx.leadResearch.updateMany({
      where: { tenantId, leadKey: nameKey },
      data: { checkedAt: new Date(), email: check.email },
    });
    return check;
  });

  // Write back ONLY outreach-state columns to the corpus so exports,
  // eligibility gates and dedupe stay consistent everywhere.
  try {
    await updateLeadOutreachState(nameKey, {
      email_status:
        result.status === "VERIFIED"
          ? "Verified"
          : result.status === "BOUNCED"
            ? "Bounced"
            : result.status === "OPTED_OUT"
              ? "Opted out"
              : result.status === "ALREADY_CONTACTED"
                ? "Contacted"
                : "Unverified",
    });
  } catch {
    // corpus write-back is best-effort; the authoritative state lives here
  }
  return { ok: true, ...result };
}

// ------------------------------------------------------------------
// Stage 4 — OUTREACH PLANNER (individual email per lead's own facts)
// ------------------------------------------------------------------

export type { EmailCheckResult, EmailStatus, PlannedEmail, PlannerFacts } from "./outreach-logic";

function plannerPrompt(facts: PlannerFacts): string {
  return JSON.stringify({
    task: "Write ONE individualized cold outreach email for this exact business.",
    rules: [
      "Use ONLY the facts provided. If a field says 'Not found', do not reference that aspect at all.",
      "Never invent contact names, job titles, results, case studies, client counts or claims about the business.",
      "Reference at most one concrete observed detail from problem/opportunity/presence/rating.",
      "Under 110 words. Plain text. Sign as Amey from WavesCo.",
    ],
    business: facts.business,
    observed: {
      category: facts.category,
      location: facts.location,
      website: facts.website,
      online_presence: facts.presence,
      identified_problem: facts.problem,
      opportunity: facts.opportunity,
      relevant_wavesco_service: facts.serviceFit,
      suggested_angle: facts.angleSeed,
    },
    output_shape: {
      subject: "string (<70 chars)",
      body: "string",
      follow_up_1: { after_days: 3, subject: "string", body: "string (<60 words)" },
      follow_up_2: { after_days: 7, subject: "string", body: "string (<50 words)" },
    },
  });
}


async function callPlannerModel(facts: PlannerFacts): Promise<PlannedEmail | null> {
  const gatewayToken = process.env.LEAD_ENGINE_GATEWAY_TOKEN?.trim() ?? "";
  if (!gatewayToken) return null;

  const baseUrl = (process.env.NEXTAUTH_URL?.trim() ?? "http://localhost:3000")
    .replace(/\/+$/, "");
  const gatewayUrl = `${baseUrl}/api/ai/gateway`;

  try {
    const res = await fetch(gatewayUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${gatewayToken}`,
      },
      body: JSON.stringify({
        operation: "email",
        system:
          "You write individualized B2B cold emails for WavesCo, a digital agency for local businesses. Use ONLY facts provided. No fabrication. Respond as strict JSON.",
        prompt: plannerPrompt(facts),
      }),
      cache: "no-store",
      // Bounded: planner timeout degrades to the deterministic composer
      // instead of hanging order creation.
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) return null;
    const j = (await res.json()) as { ok?: boolean; text?: string; model?: string };
    if (!j.ok || !j.text) return null;
    const fallback = composeFallback(facts);
    // Some providers wrap JSON in markdown fences.
    const unwrapped = j.text
      .replace(/^\s*```(?:json)?\s*/i, "")
      .replace(/\s*```\s*$/i, "")
      .trim();
    return coercePlanned(JSON.parse(unwrapped), fallback);
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------
// Stage 5 — OUTREACH ORDER creation (persistent, dedup-guarded)
// ------------------------------------------------------------------

export async function createOutreachOrder(
  tenantId: string,
  userId: string,
  nameKey: string,
): Promise<{ ok: boolean; orderId?: string; error?: string }> {
  const lead = getEngineLead(nameKey);
  if (!lead) return { ok: false, error: "Lead not found in the engine corpus." };

  return withTenantContext(tenantId, async (tx) => {
    const research = await tx.leadResearch.findUnique({
      where: { tenantId_leadKey: { tenantId, leadKey: nameKey } },
    });
    if (!research) return { ok: false as const, error: "Run lead research first." };

    const live = await collectLiveOrderEmails(tx, nameKey, tenantId);
    const check = classifyEmail(lead, live);
    if (check.status !== "VERIFIED" || !check.email) {
      return { ok: false as const, error: `Email not eligible: ${check.status} (${check.reason}).` };
    }
    const verifiedEmail: string = check.email;

    // Duplicate prevention: one live order per lead; superseded versions only.
    const priorVersions = await tx.outreachOrder.findMany({
      where: { tenantId, leadKey: nameKey },
      select: { version: true, status: true },
    });
    if (priorVersions.some((p) => (LIVE_ORDER_STATUSES as readonly string[]).includes(p.status))) {
      return { ok: false as const, error: "This lead already has a live outreach order." };
    }

    const facts: PlannerFacts = {
      business: research.business,
      contact: research.contactName ? `${research.contactName}${research.contactRole ? ` (${research.contactRole})` : ""}` : NOT_FOUND,
      category: research.category ?? NOT_FOUND,
      location: [research.area, research.city].filter(Boolean).join(", ") || NOT_FOUND,
      website: research.website ?? NOT_FOUND,
      presence: research.notes ?? NOT_FOUND,
      problem: research.problem ?? NOT_FOUND,
      opportunity: research.opportunity ?? NOT_FOUND,
      serviceFit: research.serviceFit ?? NOT_FOUND,
      angleSeed: research.angleSeed ?? NOT_FOUND,
      sources: Array.isArray(research.sourceUrls) ? (research.sourceUrls as unknown as string[]) : [],
    };

    const planned = (await callPlannerModel(facts)) ?? composeFallback(facts);

    // Global guard: no other live order may hold this email (DB enforces too).
    const emailTaken = await tx.outreachOrder.findFirst({
      where: { tenantId, email: { equals: verifiedEmail, mode: "insensitive" }, status: { in: [...LIVE_ORDER_STATUSES] } },
      select: { id: true },
    });
    if (emailTaken) return { ok: false as const, error: "Another live order already targets this email address." };

    // Suppression guard: a recipient who unsubscribed must never be re-contacted.
    if (await isRecipientSuppressed(tx, tenantId, verifiedEmail)) {
      return { ok: false as const, error: "This recipient has previously unsubscribed and is permanently suppressed." };
    }

    let order;
    try {
      order = await tx.outreachOrder.create({
        data: {
          tenantId,
          version: priorVersions.reduce((m, p) => Math.max(m, p.version), 0) + 1,
          leadKey: nameKey,
          engineLeadId: lead.id,
          businessName: lead.business,
          contactName: research.contactName,
          contactRole: research.contactRole,
          email: verifiedEmail,
          emailStatus: check.status,
          researchSnapshot: {
            business: facts.business,
            category: facts.category,
            location: facts.location,
            website: facts.website,
            presence: facts.presence,
            problem: facts.problem,
            opportunity: facts.opportunity,
            serviceFit: facts.serviceFit,
            contact: facts.contact,
            sources: facts.sources,
            researchedAt: research.researchedAt.toISOString(),
          } as never,
          opportunity: facts.opportunity !== NOT_FOUND ? facts.opportunity : null,
          outreachAngle: facts.angleSeed !== NOT_FOUND ? facts.angleSeed : null,
          subject: planned.subject,
          body: planned.body,
          followupPlan: planned.followUps as never,
          plannerModel: planned.model,
          confidence: planned.confidence,
          status: "READY_FOR_APPROVAL",
        },
      });
    } catch (e: unknown) {
      // Concurrent double-submit race: both requests passed the live-order
      // guards, then collided on @@unique[tenantId, leadKey, version].
      // Degrade to a retryable refusal instead of a raw 500.
      if (typeof e === "object" && e !== null && (e as { code?: unknown }).code === "P2002") {
        return { ok: false as const, error: "This lead already has a live outreach order (concurrent request detected). Please retry." };
      }
      throw e;
    }

    await tx.activityEvent.create({
      data: {
        tenantId,
        type: "order_created",
        title: `Outreach order drafted for ${lead.business} (${planned.model}, confidence ${planned.confidence})`,
        entityType: "outreach_order",
        entityId: order.id,
        href: "/acquisition/pipeline",
      },
    });

    // Real transition: outreach order drafted and ready for client approval.
    onEmailsReadyForReview(
      tenantId,
      undefined,
      undefined,
      { emailCount: 1, prospectName: lead.business },
      undefined,
      `order-${order.id}`,
    );

    void userId;
    return { ok: true as const, orderId: order.id };
  });
}

// ------------------------------------------------------------------
// Stage 6 — APPROVAL via the EXISTING Approval Queue
// ------------------------------------------------------------------

export async function submitOrderToApproval(
  tenantId: string,
  orderId: string,
): Promise<{ ok: boolean; approvalId?: string; error?: string }> {
  return withTenantContext(tenantId, async (tx) => {
    const order = await tx.outreachOrder.findUnique({ where: { id: orderId } });
    if (order?.tenantId !== tenantId) return { ok: false as const, error: "Order not found." };
    if (order.approvalId) return { ok: true as const, approvalId: order.approvalId }; // idempotent
    if (order.status !== "READY_FOR_APPROVAL") {
      return { ok: false as const, error: `Order is ${order.status}; only READY_FOR_APPROVAL can be queued.` };
    }

    // Suppression guard (re-checked at queue time — the recipient may have
    // unsubscribed after the order was drafted).
    if (await isRecipientSuppressed(tx, tenantId, order.email)) {
      return { ok: false as const, error: "This recipient has unsubscribed and cannot be contacted." };
    }

    // Compliance fail-closed: every outbound email must carry a working
    // unsubscribe link. Without UNSUBSCRIBE_SECRET no link can be minted, so
    // refuse to queue rather than send a footer-less email.
    const unsubscribeUrl = buildUnsubscribeUrl(tenantId, order.email);
    if (!unsubscribeUrl) {
      return { ok: false as const, error: "Unsubscribe link unavailable — configure UNSUBSCRIBE_SECRET before queuing outreach." };
    }

    const res = await submitApproval({
      type: "cold_email",
      recipient: order.email,
      subject: order.subject,
      // Legal/compliance: every outbound email carries an authenticated,
      // working unsubscribe link (HMAC-signed, tenant + recipient bound).
      body: appendUnsubscribeFooter(
        order.body,
        order.businessName,
        unsubscribeUrl,
      ),
    });
    if (!res.ok) {
      return { ok: false as const, error: `Approval Queue unreachable (HTTP ${res.status}): ${res.error ?? ""}` };
    }
    const rec = (res.data ?? {}) as Record<string, unknown>;
    const rawId = rec.approval_id ?? rec.id;
    const approvalId =
      typeof rawId === "string" && rawId.trim()
        ? rawId.trim().slice(0, 40)
        : typeof rawId === "number" && Number.isFinite(rawId)
          ? String(rawId)
          : undefined;
    if (!approvalId) return { ok: false as const, error: "Approval Queue returned no id — nothing queued." };

    await tx.outreachOrder.update({
      where: { id: order.id },
      data: { status: "PENDING", approvalId, submittedAt: new Date() },
    });
    await tx.activityEvent.create({
      data: {
        tenantId,
        type: "order_submitted",
        title: `Order ${order.businessName} → Approval Queue #${approvalId}`,
        entityType: "outreach_order",
        entityId: order.id,
        href: "/acquisition/pipeline",
        metadata: { approvalId },
      },
    });
    return { ok: true as const, approvalId };
  });
}

export type OrderDecision = "approve" | "reject";

export interface DecideResult {
  ok: boolean;
  error?: string;
  sent?: boolean;
  deliveryStatus?: string;
}

/** Decides through the EXISTING decide endpoint. The endpoint itself is
 * idempotent (pending-only); we additionally refuse double decisions. */
export async function decideOrderApproval(
  tenantId: string,
  orderId: string,
  decision: OrderDecision,
): Promise<DecideResult> {
  const base = n8nBaseUrl();
  if (!base) return { ok: false, error: "N8N_BASE_URL not configured." };

  const { decideApproval: n8nDecide } = await import("./n8n");
  const outcome = await withTenantContext(tenantId, async (tx): Promise<{ proceed: boolean; reason?: string; approvalNumeric?: number }> => {
    const order = await tx.outreachOrder.findUnique({ where: { id: orderId } });
    if (order?.tenantId !== tenantId) return { proceed: false, reason: "Order not found." };
    if (order.decidedAt) return { proceed: false, reason: `Already decided (${order.status}).` };
    if (!order.approvalId) return { proceed: false, reason: "Order was never submitted to the Approval Queue." };
    // Suppression guard: refuse approval if the recipient unsubscribed after queuing.
    if (await isRecipientSuppressed(tx, tenantId, order.email)) {
      await tx.outreachOrder.update({
        where: { id: orderId },
        data: { status: "CANCELLED", decidedAt: new Date(), sendError: "Recipient unsubscribed before approval" },
      });
      return { proceed: false, reason: "Recipient has unsubscribed; this order was cancelled." };
    }
    const numeric = Number(order.approvalId);
    if (!Number.isFinite(numeric)) return { proceed: false, reason: "Non-numeric approval id — use Telegram approve instead." };
    return { proceed: true, approvalNumeric: numeric };
  });
  if (!outcome.proceed || !outcome.approvalNumeric) {
    return { ok: false, error: outcome.reason ?? "Cannot decide this order." };
  }

  const res = await n8nDecide(outcome.approvalNumeric, decision);

  return withTenantContext(tenantId, async (tx): Promise<DecideResult> => {
    const order = await tx.outreachOrder.findUnique({ where: { id: orderId } });
    if (!order) return { ok: false, error: "Order vanished mid-decision." };

    if (!res.ok) {
      await tx.outreachOrder.update({
        where: { id: orderId },
        data: { sendError: `decide endpoint HTTP ${res.status}: ${res.error ?? ""}` },
      });
      return { ok: false, error: `n8n decide failed: HTTP ${res.status}` };
    }

    const now = new Date();
    if (decision === "reject") {
      await tx.outreachOrder.update({
        where: { id: orderId },
        data: { status: "REJECTED", decidedAt: now },
      });
      await logDecisionToObsidian(order.businessName, order.email, "REJECTED", null);
      await tx.activityEvent.create({
        data: { tenantId, type: "order_rejected", title: `Outreach to ${order.businessName} rejected`, entityType: "outreach_order", entityId: orderId, href: "/acquisition/pipeline" },
      });
      return { ok: true, sent: false, deliveryStatus: "rejected" };
    }

    // approve — the Email Outbox runs synchronously inside the decide
    // webhook, but its ack does NOT carry the send result. Record the
    // decision, then reconcile against the Outbox execution record.
    await tx.outreachOrder.update({
      where: { id: orderId },
      data: { status: "APPROVED", decidedAt: now },
    });
    const reconcile = await reconcileOrderSend(tenantId, orderId);
    return {
      ok: true,
      sent: reconcile.sent === true,
      deliveryStatus: reconcile.deliveryStatus ?? "pending_reconciliation",
    };
  });
}

export interface ReconcileResult {
  ok: boolean;
  sent?: boolean;
  deliveryStatus?: string;
  error?: string;
}

/**
 * Reads the authoritative send result from the EXISTING Email Outbox
 * execution history (n8n REST API) and promotes the order to SENT or
 * FAILED accordingly. Never marks SENT without provider acceptance.
 * Also self-heals orders left in an unclear state.
 */
export async function reconcileOrderSend(tenantId: string, orderId: string): Promise<ReconcileResult> {
  const base = n8nBaseUrl();
  const apiKey = process.env.N8N_API_KEY?.trim() ?? "";
  const outboxWorkflowId = process.env.N8N_EMAIL_OUTBOX_WORKFLOW_ID?.trim() ?? "rEhoE4lIphr6A9ry";

  return withTenantContext(tenantId, async (tx): Promise<ReconcileResult> => {
    const order = await tx.outreachOrder.findUnique({ where: { id: orderId } });
    if (order?.tenantId !== tenantId) return { ok: false, error: "Order not found." };
    if (order.status === "SENT" || order.status === "DELIVERED") {
      return { ok: true, sent: true, deliveryStatus: order.deliveryStatus ?? "accepted_by_provider" };
    }
    if (!order.approvalId) return { ok: false, error: "Order was never queued for approval." };

    let sendStatus: string | null = null;
    let sendError: string | null = null;
    let sentAtRaw: string | null = null;
    let found = false;
    if (base && apiKey) {
      try {
        const res = await fetch(
          `${base}/api/v1/executions?workflowId=${encodeURIComponent(outboxWorkflowId)}&limit=15&includeData=true`,
          { headers: { accept: "application/json", "X-N8N-API-KEY": apiKey }, cache: "no-store" },
        );
        if (res.ok) {
          const payload = (await res.json()) as {
            data?: {
              data?: {
                resultData?: {
                  runData?: {
                    "Return Send Result"?: { data?: { main?: [{ json?: unknown }[]] } }[];
                  };
                };
              };
            }[];
          };
          for (const exec of payload.data ?? []) {
            const runs = exec.data?.resultData?.runData?.["Return Send Result"];
            const item = runs?.[0]?.data?.main?.[0]?.[0]?.json as
              | { approval_id?: unknown; status?: unknown; sent_at?: unknown; error?: unknown }
              | undefined;
            const numericApproval = Number(order.approvalId);
            if (item && Number(item.approval_id) === numericApproval) {
              found = true;
              sendStatus = typeof item.status === "string" ? item.status : null;
              sentAtRaw = typeof item.sent_at === "string" ? item.sent_at : null;
              sendError =
                typeof item.error === "string" && item.error.trim()
                  ? item.error.trim().slice(0, 240)
                  : null;
              break;
            }
          }
        }
      } catch {
        // network/API failure handled by the unclear branch below
      }
    }

    if (found && sendStatus === "sent") {
      const senderIdentity =
        process.env.SMTP_FROM?.trim() ?? "waves.execution@gmail.com (via existing n8n Email Outbox)";
      const now2 = new Date();
      await tx.outreachOrder.update({
        where: { id: orderId },
        data: {
          status: "SENT",
          decidedAt: order.decidedAt ?? now2,
          sentAt: sentAtRaw ? new Date(sentAtRaw) : now2,
          sendId: order.approvalId,
          senderIdentity,
          deliveryStatus: "accepted_by_provider",
          sendError: null,
        },
      });
      // Real transition: order actually confirmed sent by the provider.
      onCampaignDeployed(
        tenantId,
        undefined,
        undefined,
        { prospectName: order.businessName },
        undefined,
        `order-${orderId}`,
      );
      await scheduleFollowUpsAfterSend(tenantId, orderId, tx);
      await logDecisionToObsidian(order.businessName, order.email, "SENT", senderIdentity.slice(0, 80));
      await tx.activityEvent.create({
        data: { tenantId, type: "order_sent", title: `Cold email dispatched to ${order.email} (${order.businessName}) - confirmed by Email Outbox`, entityType: "outreach_order", entityId: orderId, href: "/acquisition/pipeline" },
      });
      return { ok: true, sent: true, deliveryStatus: "accepted_by_provider" };
    }

    if (found && sendStatus !== null) {
      const failReason = sendError ?? `provider status "${sendStatus}"`;
      await tx.outreachOrder.update({
        where: { id: orderId },
        data: { status: "FAILED", decidedAt: order.decidedAt ?? new Date(), deliveryStatus: "failed", sendError: failReason },
      });
      await logDecisionToObsidian(order.businessName, order.email, "FAILED", failReason.slice(0, 120));
      await tx.activityEvent.create({
        data: { tenantId, type: "order_failed", title: `Send FAILED for ${order.businessName}: ${failReason.slice(0, 80)}`, entityType: "outreach_order", entityId: orderId, href: "/acquisition/pipeline" },
      });
      return { ok: true, sent: false, deliveryStatus: "failed" };
    }

    // No authoritative record yet - keep APPROVED, never fabricate SENT.
    if (!found) {
      await tx.outreachOrder.update({
        where: { id: orderId },
        data: { status: "APPROVED", deliveryStatus: "pending_reconciliation" },
      });
      return { ok: false, deliveryStatus: "pending_reconciliation", error: "No matching Email Outbox execution found yet." };
    }
    return { ok: false, error: "Execution record unreadable." };
  });
}

export async function cancelOrder(tenantId: string, orderId: string): Promise<{ ok: boolean; error?: string }> {
  return withTenantContext(tenantId, async (tx) => {
    const order = await tx.outreachOrder.findUnique({ where: { id: orderId } });
    if (order?.tenantId !== tenantId) return { ok: false as const, error: "Order not found." };
    if (order.status === "SENT" || order.status === "DELIVERED") {
      return { ok: false as const, error: "Already sent — cancel is not possible post-dispatch." };
    }
    if (order.cancelledAt) return { ok: true as const };
    await tx.outreachOrder.update({
      where: { id: orderId },
      data: { status: "CANCELLED", cancelledAt: new Date(), decidedAt: order.decidedAt ?? new Date() },
    });
    await tx.followUp.updateMany({
      where: { tenantId, outreachOrderId: orderId, status: "pending" },
      data: { status: "cancelled" },
    });
    await tx.activityEvent.create({
      data: { tenantId, type: "order_cancelled", title: `Outreach order for ${order.businessName} cancelled`, entityType: "outreach_order", entityId: orderId, href: "/acquisition/pipeline" },
    });
    return { ok: true as const };
  });
}

// ------------------------------------------------------------------
// Stage 8 — FOLLOW-UPS (existing FollowUp tracker)
// ------------------------------------------------------------------

async function scheduleFollowUpsAfterSend(tenantId: string, orderId: string, tx: Tx): Promise<void> {
  const order = await tx.outreachOrder.findUnique({ where: { id: orderId } });
  if (!order) return;

  // Guard rails: no follow-up when bounced / opted out / replied / stopped.
  const lead = getEngineLead(order.leadKey);
  if (!lead || lead.opted_out === 1 || lead.bounced === 1 || lead.reply_status) return;

  const rawPlan: unknown = order.followupPlan;
  const rawSteps = Array.isArray(rawPlan) ? (rawPlan as { offsetDays: number; subject: string; body: string }[]) : [];
  // Validate planner output: offsets must be finite future days within a
  // sane window. Invalid steps are dropped (and logged via the batch counts
  // path by the caller) — never scheduled as past/immediate/NaN dates.
  const plan = rawSteps.filter(
    (s) => s && Number.isFinite(s.offsetDays) && s.offsetDays >= 1 && s.offsetDays <= 90,
  );
  let seq = 0;
  for (const step of plan) {
    seq += 1;
    const marker = `Follow-up ${seq}/${plan.length} for order ${orderId}`;
    const dupe = await tx.followUp.findFirst({
      where: { tenantId, outreachOrderId: orderId, note: { contains: `Follow-up ${seq}/` } },
      select: { id: true },
    });
    if (dupe) continue; // idempotent re-send guard
    await tx.followUp.create({
      data: {
        tenantId,
        leadKey: order.leadKey,
        business: order.businessName,
        dueAt: new Date(Date.now() + step.offsetDays * 86_400_000),
        note: `${marker}: ${step.subject}`,
        channel: "email",
        outreachOrderId: orderId,
        status: "pending",
      },
    });
  }
}

/**
 * Conservative positive-reply classification lives in outreach-logic.ts
 * (pure, shared with the conversation layer). Re-exported here so existing
 * importers keep working.
 */
export { isPositiveReply } from "./outreach-logic";

/** Marks reply/bounce telemetry onto orders from corpus state changes. */
export async function syncOrderReplyStates(tenantId: string): Promise<number> {
  return withTenantContext(tenantId, async (tx) => {
    const orders = await tx.outreachOrder.findMany({
      where: { tenantId, status: { in: ["SENT", "DELIVERED"] } },
      select: { id: true, leadKey: true, replyStatus: true, businessName: true, email: true },
    });
    let updated = 0;
    for (const o of orders) {
      const lead = getEngineLead(o.leadKey);
      if (!lead) continue;
      const replyRaw = lead.reply_status?.trim() ?? "";
      // Real unsubscribe event from the corpus: persistently suppress the
      // recipient (idempotent), cancel pending follow-ups, and skip reply
      // processing for this order entirely.
      if (["unsubscribed", "unsubscribe"].includes(replyRaw.toLowerCase())) {
        await suppressRecipient(tx, tenantId, o.email, "corpus_reply_sync");
        await tx.followUp.updateMany({
          where: { tenantId, outreachOrderId: o.id, status: "pending" },
          data: { status: "cancelled" },
        });
        // Mirror into the conversation thread (deduped; best-effort so sync
        // keeps working on databases migrated before conversations existed).
        try {
          const { recordInboundMessageTx } = await import("./conversations");
          await recordInboundMessageTx(tx, tenantId, {
            leadKey: o.leadKey, email: o.email, businessName: o.businessName,
            kind: "unsubscribe", body: "Recipient unsubscribed (corpus sync)",
            providerMsgId: `sync:${o.id}:unsub`,
          }, "corpus_reply_sync");
        } catch {
          // conversation mirror is additive — never fail the sync for it
        }
        continue;
      }
      const replied =
        replyRaw && !["none", "no reply", "no", ""].includes(replyRaw.toLowerCase());
      if (replied && o.replyStatus !== replyRaw) {
        const reply = replyRaw || "yes";
        await tx.outreachOrder.update({ where: { id: o.id }, data: { replyStatus: reply } });
        updated += 1;
        // Real transition: a genuinely new reply arrived. Dedup keyed by the
        // concrete reply string so a repeated sync never re-notifies.
        onNewResponsesDetected(
          tenantId,
          undefined,
          undefined,
          { responseCount: 1, prospectName: o.businessName },
          `reply:${o.id}:${reply.toLowerCase()}`.slice(0, 200),
        );
        // Only explicit positive markers classify as a positive response.
        if (isPositiveReply(reply)) {
          onPositiveResponseDetected(
            tenantId,
            undefined,
            undefined,
            { prospectName: o.businessName },
            `prospect:${o.id}:${reply.toLowerCase()}`.slice(0, 200),
          );
        }
        try {
          const { recordInboundMessageTx } = await import("./conversations");
          await recordInboundMessageTx(tx, tenantId, {
            leadKey: o.leadKey, email: o.email, businessName: o.businessName,
            kind: "reply", body: reply.slice(0, 4000),
            providerMsgId: `sync:${o.id}:${reply.toLowerCase()}`.slice(0, 200),
          }, "corpus_reply_sync");
        } catch {
          // conversation mirror is additive — never fail the sync for it
        }
      }
      if (lead.bounced === 1) {
        await tx.outreachOrder.update({ where: { id: o.id }, data: { deliveryStatus: "bounced" } });
        // stop pending follow-ups on bounce
        await tx.followUp.updateMany({
          where: { tenantId, outreachOrderId: o.id, status: "pending" },
          data: { status: "cancelled" },
        });
        try {
          const { recordInboundMessageTx } = await import("./conversations");
          await recordInboundMessageTx(tx, tenantId, {
            leadKey: o.leadKey, email: o.email, businessName: o.businessName,
            kind: "bounce", body: "Delivery bounced (corpus sync)",
            providerMsgId: `sync:${o.id}:bounce`,
          }, "corpus_reply_sync");
        } catch {
          // conversation mirror is additive — never fail the sync for it
        }
        updated += 1;
      }
    }

    // Real server reconciliation: also evaluate due follow-ups (idempotent).
    await processDueFollowUpMilestones(tenantId);

    return updated;
  });
}

// ------------------------------------------------------------------
// Stage 11 — TELEGRAM batch summary via the EXISTING Notify Hub bridge
// ------------------------------------------------------------------

export interface BatchCounts {
  processed: number;
  researched: number;
  verifiedEmails: number;
  ordersCreated: number;
  awaitingApproval: number;
  sent: number;
  failed: number;
}

export async function notifyBatchSummary(
  batchId: string,
  counts: BatchCounts,
  attachments?: { pdfPath?: string; excelPath?: string },
): Promise<{ ok: boolean; delivered?: string; error?: string }> {
  const base = n8nBaseUrl();
  if (!base) return { ok: false, error: "N8N_BASE_URL not configured." };

  const files: { name: string; base64: string }[] = [];
  for (const p of [attachments?.pdfPath, attachments?.excelPath]) {
    if (p && existsSync(p)) {
      try {
        files.push({ name: p.split(/[\\/]/).pop() ?? "report", base64: readFileSync(p).toString("base64") });
      } catch {
        // unreadable attachment skipped
      }
    }
  }

  const body = [
    `Batch: ${batchId}`,
    `Leads processed: ${counts.processed}`,
    `Researched: ${counts.researched}`,
    `Verified emails: ${counts.verifiedEmails}`,
    `Outreach orders created: ${counts.ordersCreated}`,
    `Awaiting approval: ${counts.awaitingApproval}`,
    `Sent: ${counts.sent}`,
    `Failed: ${counts.failed}`,
  ].join("\n");

  try {
    const res = await fetch(`${base}/webhook/personal/wavesco-leads`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        level: counts.failed > 0 ? "warning" : "info",
        subject: "WAVESCO OUTREACH BATCH COMPLETE",
        body,
        files,
        source_workflow: "WavesCo Acquisition OS",
        dedupe_key: `outreach|${batchId}`.slice(0, 90),
      }),
      cache: "no-store",
    });
    let delivered = "";
    try {
      const j = (await res.json()) as Record<string, unknown>;
      delivered = typeof j.delivered === "string" ? j.delivered : "";
    } catch {
      // non-JSON
    }
    if (!res.ok) return { ok: false, error: `Notify Hub HTTP ${res.status}` };
    return { ok: true, delivered };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Notify Hub unreachable" };
  }
}

// ------------------------------------------------------------------
// Stage 12 — OBSIDIAN operational logging (existing vault REST API)
// ------------------------------------------------------------------

export async function logResearchToObsidian(
  leadKey: string,
  record: ResearchRecord,
): Promise<boolean> {
  const lines = [
    `# Lead Research — ${record.business}`,
    "",
    `- **Lead key**: ${leadKey}`,
    `- **Category**: ${record.category}`,
    `- **Location**: ${record.location}`,
    `- **Website**: ${record.website}`,
    `- **Instagram**: ${record.instagram}`,
    `- **Online presence**: ${record.presence}`,
    `- **Rating / reviews**: ${record.ratingReviews}`,
    `- **Observed problem**: ${record.problem}`,
    `- **Opportunity**: ${record.opportunity}`,
    `- **Service fit**: ${record.serviceFit}`,
    `- **Known contact**: ${record.contact}`,
    "",
    "## Sources",
    ...(record.sources.length > 0 ? record.sources.map((s) => `- ${s}`) : ["- _none recorded_"]),
    "",
    `_Generated ${new Date().toISOString()} by WavesCo Acquisition OS — facts only, sourced from the Lead Engine corpus._`,
    "",
  ];
  const res = await putNote(
    `WavesCo/Operations/Lead Research/${leadKey.replace(/[^\w.-]+/g, "-")}.md`,
    lines.join("\n"),
  );
  return res.ok;
}

export async function logDecisionToObsidian(
  business: string,
  email: string,
  decision: string,
  detail: string | null,
): Promise<boolean> {
  const stamp = new Date().toISOString().replace("T", " ").slice(0, 19);
  const res = await appendNote(
    "WavesCo/Operations/Email Outreach/Decisions.md",
    `\n| ${stamp} | ${business.replace(/\|/g, "/")} | ${email} | ${decision} | ${detail?.replace(/\|/g, "/") ?? "—"} |`,
  );
  return res.ok;
}

export async function logBatchToObsidian(batchId: string, counts: BatchCounts): Promise<boolean> {
  const header = "# Outreach Batch Log\n\n| Time | Batch | Processed | Researched | Verified | Orders | Pending | Sent | Failed |\n| --- | --- | --- | --- | --- | --- | --- | --- | --- |\n";
  const stamp = new Date().toISOString().replace("T", " ").slice(0, 19);
  const row = `| ${stamp} | ${batchId} | ${counts.processed} | ${counts.researched} | ${counts.verifiedEmails} | ${counts.ordersCreated} | ${counts.awaitingApproval} | ${counts.sent} | ${counts.failed} |\n`;
  const existing = await readNote("WavesCo/Operations/Email Outreach/Batches.md");
  const content = existing.ok ? existing.data ?? "" : "";
  const base = content.includes("# Outreach Batch Log") ? content : header + content;
  const res = await putNote("WavesCo/Operations/Email Outreach/Batches.md", base + row);
  return res.ok;
}