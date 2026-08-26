/**
 * Smart Lead Engine — /lib/wavesco/smart-engine.ts
 *
 * Evaluates every lead against 13 analysis points and decides the next action.
 * All decisions are deterministic for AI-disabled clients; AI-enabled clients
 * get enrichment via the Waves AI Gateway.
 *
 * Decision matrix:
 *   REJECT          — hard disqualifier (no business name, spam, duplicate)
 *   RETAIN          — hold for future batch
 *   RESEARCH_FURTHER — needs more data before enrichment
 *   VERIFY_EMAIL    — email found but not yet verified
 *   ENRICH          — has enough data, ready for AI enrichment
 *   CREATE_OUTREACH — enriched + verified email, ready for outreach order
 *   CREATE_FOLLOWUP — existing order, needs follow-up scheduling
 *   HUMAN_REVIEW    — edge case, needs manual judgment
 */

import { withTenantContext } from "@wavesco/db";
import type { prisma } from "@wavesco/db";
import type { EngineLead } from "./lead-engine";

export type Decision =
  | "REJECT"
  | "RETAIN"
  | "RESEARCH_FURTHER"
  | "VERIFY_EMAIL"
  | "ENRICH"
  | "CREATE_OUTREACH"
  | "CREATE_FOLLOWUP"
  | "HUMAN_REVIEW";

export interface AnalysisResult {
  decision: Decision;
  reason: string;
  checks: CheckResult[];
  eligibility: EligibilityStatus;
}

export type EligibilityStatus =
  | "eligible"
  | "needs_verification"
  | "needs_enrichment"
  | "ineligible"
  | "human_review";

export interface CheckResult {
  name: string;
  passed: boolean;
  value: string | null;
  weight: number;
}

// ------------------------------------------------------------------
// The 13 analysis checks
// ------------------------------------------------------------------

function runChecks(lead: EngineLead): CheckResult[] {
  return [
    {
      name: "business_name",
      passed: !!lead.business && lead.business.trim().length > 1,
      value: lead.business,
      weight: 10,
    },
    {
      name: "category",
      passed: !!lead.category && lead.category.trim().length > 0,
      value: lead.category,
      weight: 6,
    },
    {
      name: "area_city",
      passed: !!lead.area || !!lead.city,
      value: [lead.area, lead.city].filter(Boolean).join(", ") || null,
      weight: 5,
    },
    {
      name: "website",
      passed: !!lead.website && lead.website.trim().length > 0,
      value: lead.website,
      weight: 4,
    },
    {
      name: "instagram",
      passed: !!lead.instagram && lead.instagram.trim().length > 0,
      value: lead.instagram,
      weight: 3,
    },
    {
      name: "email_found",
      passed: !!lead.email && lead.email.trim().length > 0,
      value: lead.email,
      weight: 8,
    },
    {
      name: "phone_found",
      passed: !!lead.phone && lead.phone.trim().length > 0,
      value: lead.phone,
      weight: 3,
    },
    {
      name: "rating_reviews",
      passed: (lead.rating ?? 0) > 0 || (lead.reviews ?? 0) > 0,
      value: `${lead.rating ?? "N/A"} (${lead.reviews ?? 0} reviews)`,
      weight: 4,
    },
    {
      name: "digital_presence",
      passed: !!lead.digital_assessment && lead.digital_assessment.trim().length > 0,
      value: lead.digital_assessment ?? null,
      weight: 5,
    },
    {
      name: "source_urls",
      passed: (() => {
        try {
          const urls: unknown = JSON.parse(lead.source_urls ?? "[]");
          return Array.isArray(urls) && urls.length > 0;
        } catch {
          return false;
        }
      })(),
      value: lead.source_urls,
      weight: 4,
    },
    {
      name: "verification",
      passed: !!lead.verification && lead.verification !== "unverified",
      value: lead.verification,
      weight: 5,
    },
    {
      name: "email_valid_format",
      passed: !!lead.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(lead.email),
      value: lead.email,
      weight: 6,
    },
    {
      name: "domain_reputation",
      passed: (() => {
        if (!lead.email) return false;
        const domain = lead.email.split("@")[1]?.toLowerCase();
        if (!domain) return false;
        const disposable = ["tempmail.com", "throwaway.com", "guerrillamail.com",
          "mailinator.com", "yopmail.com", "10minutemail.com"];
        return !disposable.includes(domain);
      })(),
      value: lead.email?.split("@")[1] ?? null,
      weight: 7,
    },
  ];
}

// ------------------------------------------------------------------
// Decision logic
// ------------------------------------------------------------------

function decideFromChecks(checks: CheckResult[]): {
  decision: Decision;
  reason: string;
  eligibility: EligibilityStatus;
} {
  const totalWeight = checks.reduce((s, c) => s + c.weight, 0);
  const passedWeight = checks.filter((c) => c.passed).reduce((s, c) => s + c.weight, 0);
  const score = totalWeight > 0 ? passedWeight / totalWeight : 0;

  // Hard rejects
  if (!checks.find((c) => c.name === "business_name")?.passed) {
    return { decision: "REJECT", reason: "no business name", eligibility: "ineligible" };
  }

  // Domain reputation: only reject if email exists AND domain is disposable
  const domainCheck = checks.find((c) => c.name === "domain_reputation");
  const emailPresent = checks.find((c) => c.name === "email_found")?.passed;
  if (emailPresent && domainCheck && !domainCheck.passed) {
    return { decision: "REJECT", reason: "disposable email domain", eligibility: "ineligible" };
  }

  // Needs email verification: only reject if email exists AND format is invalid
  const emailCheck = checks.find((c) => c.name === "email_found");
  const emailFormatCheck = checks.find((c) => c.name === "email_valid_format");
  if (emailCheck?.passed && emailFormatCheck && !emailFormatCheck.passed) {
    return { decision: "REJECT", reason: "invalid email format", eligibility: "ineligible" };
  }

  if (emailCheck?.passed && checks.find((c) => c.name === "verification")?.passed) {
    // Has verified email — high value
    if (score >= 0.5) {
      return { decision: "CREATE_OUTREACH", reason: `score ${Math.round(score * 100)}%, verified email`, eligibility: "eligible" };
    }
    return { decision: "ENRICH", reason: "verified email but low data score", eligibility: "needs_enrichment" };
  }

  if (emailCheck?.passed && !checks.find((c) => c.name === "verification")?.passed) {
    // Has email but unverified
    if (score >= 0.4) {
      return { decision: "VERIFY_EMAIL", reason: "email found but unverified", eligibility: "needs_verification" };
    }
    return { decision: "RESEARCH_FURTHER", reason: "unverified email, low data", eligibility: "needs_enrichment" };
  }

  // No email
  if (score < 0.25) {
    return { decision: "RETAIN", reason: `very low score ${Math.round(score * 100)}%`, eligibility: "ineligible" };
  }

  if (score < 0.4) {
    return { decision: "RESEARCH_FURTHER", reason: `low score ${Math.round(score * 100)}%`, eligibility: "needs_enrichment" };
  }

  if (score >= 0.5) {
    return { decision: "ENRICH", reason: `score ${Math.round(score * 100)}%, no email yet`, eligibility: "needs_enrichment" };
  }

  return { decision: "HUMAN_REVIEW", reason: `borderline score ${Math.round(score * 100)}%`, eligibility: "human_review" };
}

// ------------------------------------------------------------------
// Public API
// ------------------------------------------------------------------

/**
 * Evaluate a single lead and return the analysis + decision.
 */
export function decideNextAction(lead: EngineLead): AnalysisResult {
  const checks = runChecks(lead);
  const { decision, reason, eligibility } = decideFromChecks(checks);

  return { decision, reason, checks, eligibility };
}

/**
 * Evaluate a batch of leads and record lifecycle events.
 * Returns the decisions for each lead (no side effects beyond logging).
 */
export async function runSmartEngineBatch(
  tenantId: string,
  leads: EngineLead[],
  batchId?: string,
): Promise<{ lead: EngineLead; result: AnalysisResult }[]> {
  const results: { lead: EngineLead; result: AnalysisResult }[] = [];

  for (const lead of leads) {
    const result = decideNextAction(lead);
    results.push({ lead, result });

    // Record lifecycle event
    await withTenantContext(tenantId, async (tx) => {
      await (tx as typeof prisma).leadLifecycleEvent.create({
        data: {
          tenantId,
          leadKey: `lead:${lead.id}`,
          batchId: batchId ?? null,
          stage: "smart_engine",
          status: result.decision,
          reason: result.reason,
          aiEnabled: false, // Smart Engine is deterministic; AI comes later
          emailStatus: lead.email_status ?? null,
          eligibility: result.eligibility,
        },
      });
    }).catch(() => { /* Non-critical — don't fail batch on logging errors */ });
  }

  return results;
}

/**
 * Summary stats for a batch of results.
 */
export function summarizeBatch(
  results: { lead: EngineLead; result: AnalysisResult }[],
): Record<Decision, number> {
  const summary: Record<Decision, number> = {
    REJECT: 0,
    RETAIN: 0,
    RESEARCH_FURTHER: 0,
    VERIFY_EMAIL: 0,
    ENRICH: 0,
    CREATE_OUTREACH: 0,
    CREATE_FOLLOWUP: 0,
    HUMAN_REVIEW: 0,
  };
  for (const { result } of results) {
    summary[result.decision]++;
  }
  return summary;
}
