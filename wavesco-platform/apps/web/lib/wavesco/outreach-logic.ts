import type { EngineLead } from "./lead-engine";

/**
 * Pure outreach-pipeline logic. No I/O, no DB, no env access — safe to
 * unit-test and reuse. Everything here decides; pipeline.ts executes.
 */

export const NOT_FOUND = "Not found";

export type EmailStatus =
  | "VERIFIED"
  | "UNVERIFIED"
  | "NOT_FOUND"
  | "BOUNCED"
  | "OPTED_OUT"
  | "ALREADY_CONTACTED";

const EMAIL_RE = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

export interface EmailCheckResult {
  status: EmailStatus;
  email: string | null;
  reason: string;
}

export function classifyEmail(
  lead: EngineLead,
  liveOrderEmailsForOtherLeads: Set<string>,
): EmailCheckResult {
  const raw = (lead.email ?? "").trim().toLowerCase();
  if (!raw || !EMAIL_RE.test(raw)) {
    return { status: "NOT_FOUND", email: raw || null, reason: raw ? "email fails RFC format check" : "no email in corpus" };
  }
  if (raw.includes("noreply") || raw.includes("no-reply") || /\.(png|jpg|jpeg|webp)$/i.test(raw)) {
    return { status: "UNVERIFIED", email: raw, reason: "placeholder/invalid mailbox pattern" };
  }
  if (lead.opted_out === 1) return { status: "OPTED_OUT", email: raw, reason: "lead opted out" };
  if (lead.bounced === 1) return { status: "BOUNCED", email: raw, reason: "previous bounce recorded" };
  if (
    lead.date_contacted ||
    (lead.status.toLowerCase() !== "new" && lead.status.toLowerCase() !== "")
  ) {
    return { status: "ALREADY_CONTACTED", email: raw, reason: `corpus status "${lead.status}"` };
  }
  if (liveOrderEmailsForOtherLeads.has(raw)) {
    return { status: "ALREADY_CONTACTED", email: raw, reason: "another lead already holds a live order for this address" };
  }
  const verified =
    lead.verification?.toLowerCase() === "verified" ||
    (lead.email_status ?? "").toUpperCase() === "VERIFIED";
  return verified
    ? { status: "VERIFIED", email: raw, reason: "verified in engine corpus and format-valid" }
    : { status: "UNVERIFIED", email: raw, reason: "format-valid but engine verification pending" };
}

// ------------------------------------------------------------------
// Planner output shaping
// ------------------------------------------------------------------

export interface PlannerFacts {
  business: string;
  contact: string;
  category: string;
  location: string;
  website: string;
  presence: string;
  problem: string;
  opportunity: string;
  serviceFit: string;
  angleSeed: string;
  sources: string[];
}

export interface PlannedEmail {
  subject: string;
  body: string;
  followUps: { offsetDays: number; subject: string; body: string }[];
  model: string;
  confidence: "high" | "medium" | "low";
}

function confidenceFrom(facts: PlannerFacts): PlannedEmail["confidence"] {
  let score = 0;
  if (facts.problem !== NOT_FOUND) score += 1;
  if (facts.opportunity !== NOT_FOUND) score += 1;
  if (facts.website !== NOT_FOUND || facts.presence !== NOT_FOUND) score += 1;
  if (facts.angleSeed !== NOT_FOUND || facts.serviceFit !== NOT_FOUND) score += 1;
  if (score >= 3) return "high";
  if (score >= 2) return "medium";
  return "low";
}

/** Deterministic fallback composer — built from THIS lead's fields only. */
export function composeFallback(facts: PlannerFacts): PlannedEmail {
  const detail =
    facts.problem !== NOT_FOUND
      ? `I noticed ${facts.problem.toLowerCase()}`
      : facts.opportunity !== NOT_FOUND
        ? `I noticed ${facts.opportunity.toLowerCase()}`
        : facts.presence !== NOT_FOUND
          ? `I came across your ${facts.category !== NOT_FOUND ? facts.category.toLowerCase() : "business"} online`
          : `I came across ${facts.business}`;
  const service = facts.serviceFit !== NOT_FOUND ? facts.serviceFit : "website and local search improvements";
  const loc = facts.location !== NOT_FOUND ? ` in ${facts.location}` : "";

  return {
    subject: `${facts.business}${loc} — quick idea`,
    body: [
      `Hi${facts.contact !== NOT_FOUND ? ` ${facts.contact.split(" (")[0]}` : ""},`,
      "",
      `${detail}.`,
      "",
      `WavesCo helps local businesses with ${service.toLowerCase()}. Would it be useful if I shared two specific things I noticed about ${facts.business}'s online presence?`,
      "",
      "Best,",
      "Amey",
      "WavesCo",
    ].join("\n"),
    followUps: [
      {
        offsetDays: 3,
        subject: `Re: ${facts.business} — quick idea`,
        body: `Hi again — just floating this back to the top of your inbox. Happy to send over the two observations about ${facts.business} whenever convenient.\n\nAmey · WavesCo`,
      },
      {
        offsetDays: 7,
        subject: `Last note re: ${facts.business}`,
        body: `Last note from me — if improving ${service.toLowerCase()} isn't a priority right now, no worries at all. If it ever becomes one, my earlier note has the details.\n\nAmey · WavesCo`,
      },
    ],
    model: "fact-composer",
    confidence: confidenceFrom(facts),
  };
}

/** Validates an AI planner JSON payload; falls back per-field to the composer. */
export function coercePlanned(raw: unknown, fallback: PlannedEmail): PlannedEmail | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const str = (v: unknown, max: number): string | null =>
    typeof v === "string" && v.trim().length > 0 ? v.trim().slice(0, max) : null;
  const subject = str(o.subject, 200);
  const body = str(o.body, 3800);
  if (!subject || !body) return null;
  const fu = Array.isArray(o.follow_ups) ? o.follow_ups : [];
  const followUps: PlannedEmail["followUps"] = [];
  for (let i = 0; i < Math.min(2, fu.length); i++) {
    const f = fu[i] as Record<string, unknown>;
    const fs = str(f.subject, 200);
    const fb = str(f.body, 1500);
    if (!fs || !fb) break;
    followUps.push({ offsetDays: typeof f.offsetDays === "number" ? f.offsetDays : 3 + i * 4, subject: fs, body: fb });
  }
  while (followUps.length < 2) {
    const i = followUps.length;
    followUps.push({
      offsetDays: 3 + i * 4,
      subject: `Re: ${subject.slice(0, 60)}`,
      body: `Hi — just bringing this back up in case it got buried. Happy to share specifics whenever useful.\n\nAmey · WavesCo`,
    });
  }
  const modelLabel = typeof o.model === "string" && o.model.trim() ? o.model.trim().slice(0, 60) : "planner";
  return { subject, body, followUps, model: modelLabel, confidence: fallback.confidence };
}
