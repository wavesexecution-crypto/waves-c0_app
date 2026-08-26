import { describe, expect, it } from "vitest";
import { classifyEmail } from "@/lib/wavesco/outreach-logic";
import type { EngineLead } from "@/lib/wavesco/lead-engine";

function makeLead(overrides: Partial<EngineLead> = {}): EngineLead {
  return {
    id: 1,
    business: "Test Business",
    category: "Cafe",
    area: "Vashi",
    city: "Navi Mumbai",
    phone: null,
    whatsapp: null,
    email: null,
    website: null,
    instagram: null,
    rating: 4.2,
    reviews: 30,
    digital_score: 40,
    lead_score: 20,
    tier: "B",
    problem: null,
    opportunity: null,
    reason: null,
    outreach_angle: null,
    wavesco_service: null,
    digital_assessment: null,
    contact_name: null,
    role: null,
    decision_maker: null,
    source_urls: "[]",
    verification: null,
    site_class: null,
    status: "new",
    email_status: null,
    date_contacted: null,
    reply_status: null,
    opted_out: 0,
    bounced: 0,
    next_follow_up: null,
    name_key: "test business vashi",
    batch_id: null,
    first_discovered: null,
    last_researched: null,
    ...overrides,
  };
}

describe("classifyEmail — eligibility gate", () => {
  it("NOT_FOUND when there is no email", () => {
    const r = classifyEmail(makeLead({}), new Set());
    expect(r.status).toBe("NOT_FOUND");
  });

  it("NOT_FOUND when the email fails format validation", () => {
    const r = classifyEmail(makeLead({ email: "not-an-email" }), new Set());
    expect(r.status).toBe("NOT_FOUND");
    expect(r.email).toBe("not-an-email");
  });

  it("UNVERIFIED for placeholder mailbox patterns", () => {
    const r = classifyEmail(makeLead({ email: "noreply@example.com" }), new Set());
    expect(r.status).toBe("UNVERIFIED");
  });

  it("OPTED_OUT beats verification", () => {
    const r = classifyEmail(
      makeLead({ email: "a@b.co", verification: "Verified", opted_out: 1 }),
      new Set(),
    );
    expect(r.status).toBe("OPTED_OUT");
  });

  it("BOUNCED when a bounce is recorded", () => {
    const r = classifyEmail(
      makeLead({ email: "a@b.co", verification: "Verified", bounced: 1 }),
      new Set(),
    );
    expect(r.status).toBe("BOUNCED");
  });

  it("ALREADY_CONTACTED when the corpus marks the lead contacted", () => {
    const r = classifyEmail(
      makeLead({ email: "a@b.co", verification: "Verified", date_contacted: "2026-01-01T00:00:00Z" }),
      new Set(),
    );
    expect(r.status).toBe("ALREADY_CONTACTED");
  });

  it("ALREADY_CONTACTED on non-new corpus status", () => {
    const r = classifyEmail(
      makeLead({ email: "a@b.co", verification: "Verified", status: "meeting" }),
      new Set(),
    );
    expect(r.status).toBe("ALREADY_CONTACTED");
  });

  it("ALREADY_CONTACTED when another live order holds the same email (global dedupe)", () => {
    const live = new Set(["taken@shop.in"]);
    const r = classifyEmail(makeLead({ email: "Taken@Shop.in ", verification: "Verified" }), live);
    expect(r.status).toBe("ALREADY_CONTACTED");
  });

  it("VERIFIED only with engine verification + valid format + no guards tripped", () => {
    const r = classifyEmail(makeLead({ email: "owner@gym.in", verification: "Verified" }), new Set());
    expect(r.status).toBe("VERIFIED");
  });

  it("UNVERIFIED when format-valid but engine verification pending", () => {
    const r = classifyEmail(makeLead({ email: "owner@gym.in" }), new Set());
    expect(r.status).toBe("UNVERIFIED");
  });
});
