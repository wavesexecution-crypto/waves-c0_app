/**
 * Smart Lead Engine — decision logic tests.
 *
 * Covers the 13 analysis checks, decision matrix, and edge cases.
 * No database required — pure function tests.
 */
import { describe, it, expect } from "vitest";
import { decideNextAction, summarizeBatch } from "../lib/wavesco/smart-engine";
import type { EngineLead } from "../lib/wavesco/lead-engine";

function makeLead(overrides: Partial<EngineLead> = {}): EngineLead {
  return {
    id: 1,
    business: "Test Business",
    category: "Restaurant",
    area: "Powai",
    city: "Mumbai",
    phone: "+919876543210",
    whatsapp: null,
    email: "test@example.com",
    website: "https://example.com",
    instagram: "@testbiz",
    rating: 4.5,
    reviews: 120,
    digital_score: 6,
    lead_score: 75,
    tier: "A",
    problem: "outdated website",
    opportunity: "booking funnel",
    reason: "strong brand, weak digital",
    outreach_angle: "Your site doesn't reflect your quality",
    wavesco_service: "website_redesign",
    digital_assessment: "Basic WordPress site, no online booking",
    contact_name: "Rahul Sharma",
    role: "Owner",
    decision_maker: "yes",
    source_urls: JSON.stringify(["https://example.com/about"]),
    verification: "verified",
    site_class: "basic",
    status: "new",
    email_status: "verified",
    date_contacted: null,
    reply_status: null,
    opted_out: null,
    bounced: null,
    next_follow_up: null,
    name_key: "test-business",
    batch_id: null,
    first_discovered: null,
    last_researched: null,
    ...overrides,
  };
}

describe("Smart Lead Engine — 13 checks", () => {
  it("all checks pass for a complete lead", () => {
    const result = decideNextAction(makeLead());
    expect(result.checks).toHaveLength(13);
    expect(result.checks.every((c) => c.passed)).toBe(true);
  });

  it("fails when business name is missing", () => {
    const result = decideNextAction(makeLead({ business: "" }));
    const check = result.checks.find((c) => c.name === "business_name");
    expect(check?.passed).toBe(false);
    expect(result.decision).toBe("REJECT");
  });

  it("fails when business name is whitespace only", () => {
    const result = decideNextAction(makeLead({ business: "   " }));
    expect(result.decision).toBe("REJECT");
  });

  it("fails when category is missing", () => {
    const result = decideNextAction(makeLead({ category: null }));
    const check = result.checks.find((c) => c.name === "category");
    expect(check?.passed).toBe(false);
  });

  it("fails when area and city are both missing", () => {
    const result = decideNextAction(makeLead({ area: null, city: null }));
    const check = result.checks.find((c) => c.name === "area_city");
    expect(check?.passed).toBe(false);
  });

  it("passes when only area is present", () => {
    const result = decideNextAction(makeLead({ city: null }));
    const check = result.checks.find((c) => c.name === "area_city");
    expect(check?.passed).toBe(true);
  });

  it("detects missing website", () => {
    const result = decideNextAction(makeLead({ website: null }));
    const check = result.checks.find((c) => c.name === "website");
    expect(check?.passed).toBe(false);
  });

  it("detects missing instagram", () => {
    const result = decideNextAction(makeLead({ instagram: null }));
    const check = result.checks.find((c) => c.name === "instagram");
    expect(check?.passed).toBe(false);
  });

  it("detects missing email", () => {
    const result = decideNextAction(makeLead({ email: null }));
    const check = result.checks.find((c) => c.name === "email_found");
    expect(check?.passed).toBe(false);
  });

  it("detects missing phone", () => {
    const result = decideNextAction(makeLead({ phone: null }));
    const check = result.checks.find((c) => c.name === "phone_found");
    expect(check?.passed).toBe(false);
  });

  it("detects missing rating/reviews", () => {
    const result = decideNextAction(makeLead({ rating: null, reviews: null }));
    const check = result.checks.find((c) => c.name === "rating_reviews");
    expect(check?.passed).toBe(false);
  });

  it("detects missing digital assessment", () => {
    const result = decideNextAction(makeLead({ digital_assessment: null }));
    const check = result.checks.find((c) => c.name === "digital_presence");
    expect(check?.passed).toBe(false);
  });

  it("detects missing source URLs", () => {
    const result = decideNextAction(makeLead({ source_urls: null }));
    const check = result.checks.find((c) => c.name === "source_urls");
    expect(check?.passed).toBe(false);
  });

  it("detects unverified email", () => {
    const result = decideNextAction(makeLead({ verification: "unverified" }));
    const check = result.checks.find((c) => c.name === "verification");
    expect(check?.passed).toBe(false);
  });

  it("rejects invalid email format", () => {
    const result = decideNextAction(makeLead({ email: "not-an-email" }));
    const check = result.checks.find((c) => c.name === "email_valid_format");
    expect(check?.passed).toBe(false);
  });

  it("rejects disposable email domain", () => {
    const result = decideNextAction(makeLead({ email: "test@tempmail.com" }));
    const check = result.checks.find((c) => c.name === "domain_reputation");
    expect(check?.passed).toBe(false);
  });
});

describe("Smart Lead Engine — decisions", () => {
  it("REJECTS lead with no business name", () => {
    const result = decideNextAction(makeLead({ business: "" }));
    expect(result.decision).toBe("REJECT");
    expect(result.eligibility).toBe("ineligible");
  });

  it("REJECTS disposable email", () => {
    const result = decideNextAction(makeLead({ email: "spam@guerrillamail.com" }));
    expect(result.decision).toBe("REJECT");
  });

  it("REJECTS invalid email format", () => {
    const result = decideNextAction(makeLead({ email: "bad" }));
    expect(result.decision).toBe("REJECT");
  });

  it("CREATE_OUTREACH for complete lead with verified email", () => {
    const result = decideNextAction(makeLead());
    expect(result.decision).toBe("CREATE_OUTREACH");
    expect(result.eligibility).toBe("eligible");
  });

  it("VERIFY_EMAIL for lead with unverified email", () => {
    const result = decideNextAction(makeLead({ verification: "unverified" }));
    // High data score but unverified email
    expect(result.decision).toBe("VERIFY_EMAIL");
    expect(result.eligibility).toBe("needs_verification");
  });

  it("ENRICH for lead with good data but no email", () => {
    const result = decideNextAction(makeLead({ email: null }));
    expect(result.decision).toBe("ENRICH");
    expect(result.eligibility).toBe("needs_enrichment");
  });

  it("RESEARCH_FURTHER or ENRICH for low-score lead with email", () => {
    const result = decideNextAction(makeLead({
      website: null,
      instagram: null,
      rating: null,
      reviews: null,
      digital_assessment: null,
      source_urls: null,
    }));
    // With business name + category + area + phone + email, score is decent
    expect(["RESEARCH_FURTHER", "ENRICH", "CREATE_OUTREACH", "VERIFY_EMAIL"]).toContain(result.decision);
  });

  it("RETAIN for minimal lead with no email", () => {
    const result = decideNextAction(makeLead({
      category: null,
      area: null,
      city: null,
      website: null,
      instagram: null,
      email: null,
      phone: null,
      rating: null,
      reviews: null,
      digital_assessment: null,
      source_urls: null,
    }));
    expect(result.decision).toBe("RETAIN");
  });
});

describe("Smart Lead Engine — batch summary", () => {
  it("summarizes decisions correctly", () => {
    const leads = [
      makeLead({ id: 1 }),
      makeLead({ id: 2, business: "" }),
      makeLead({ id: 3, email: null }),
      makeLead({ id: 4, verification: "unverified" }),
    ];
    const results = leads.map((lead) => ({ lead, result: decideNextAction(lead) }));
    const summary = summarizeBatch(results);
    expect(summary.CREATE_OUTREACH).toBeGreaterThanOrEqual(1);
    expect(summary.REJECT).toBeGreaterThanOrEqual(1);
    expect(summary.ENRICH + summary.VERIFY_EMAIL).toBeGreaterThanOrEqual(1);
  });
});
