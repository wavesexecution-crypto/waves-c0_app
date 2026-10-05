/**
 * Performance guardrails — realistic pure-logic workloads with generous
 * ceilings. These catch algorithmic regressions (e.g. accidental O(n²)),
 * not hardware limits. No DB, no network.
 */
import { describe, it, expect } from "vitest";
import { decideNextAction, summarizeBatch } from "@/lib/wavesco/smart-engine";
import { classifyEmail, composeFallback, coercePlanned } from "@/lib/wavesco/outreach-logic";
import { readinessCheck, validateProfileInput } from "@/lib/wavesco/acquisition-profile";
import type { EngineLead } from "@/lib/wavesco/lead-engine";

function lead(i: number): EngineLead {
  return {
    id: i, business: `Synthetic Fitness ${i}`, category: "Gym",
    area: "Vashi", city: "Navi Mumbai", phone: "+911234567890", whatsapp: null,
    email: `owner${i}@perf-test.example`, website: "https://perf-test.example",
    instagram: "@perf", rating: 4.4, reviews: 120, digital_score: 30,
    lead_score: 68, tier: "B", problem: "no booking", opportunity: "funnel",
    reason: "r", outreach_angle: "a", wavesco_service: "web",
    digital_assessment: "basic site", contact_name: null, role: null,
    decision_maker: null, source_urls: JSON.stringify(["https://perf-test.example"]),
    verification: "Verified", site_class: "basic", status: "new",
    email_status: "Verified", date_contacted: null, reply_status: null,
    opted_out: 0, bounced: 0, next_follow_up: null, name_key: `perf-${i}`,
    batch_id: null, first_discovered: null, last_researched: null,
  };
}

describe("perf — 1 customer (60-lead batch)", () => {
  it("research-grade decisions for 60 leads < 2s", () => {
    const t0 = Date.now();
    const results = Array.from({ length: 60 }, (_, i) => ({ lead: lead(i), result: decideNextAction(lead(i)) }));
    const summary = summarizeBatch(results);
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(summary.CREATE_OUTREACH).toBe(60);
  });
  it("email gates for 60 leads < 1s", () => {
    const live = new Set<string>();
    const t0 = Date.now();
    for (let i = 0; i < 60; i++) classifyEmail(lead(i), live);
    expect(Date.now() - t0).toBeLessThan(1000);
  });
});

describe("perf — 50 customers (readiness + validation)", () => {
  it("1000 readiness checks < 1s", () => {
    const p: any = {
      id: "x", tenantId: "t", status: "DRAFT", version: 1,
      companyName: "C", website: "https://c.example", industry: "Fitness",
      whatWeSell: "training", acquisitionObjective: "leads", primaryObjective: "30 in 30d",
      icp: { targetCustomer: "pros", geography: "Vashi" }, offer: { productService: "trial" },
    };
    const t0 = Date.now();
    for (let i = 0; i < 1000; i++) readinessCheck(p);
    expect(Date.now() - t0).toBeLessThan(1000);
  });
  it("500 profile validations < 1s", () => {
    const t0 = Date.now();
    for (let i = 0; i < 500; i++) {
      validateProfileInput({ companyName: `C${i}`, website: "https://c.example", targetQuantity: 30, icp: { api_key: "x" } });
    }
    expect(Date.now() - t0).toBeLessThan(1000);
  });
});

describe("perf — 100-customer outreach shaping", () => {
  it("100 fallback drafts + coerces < 2s", () => {
    const facts: any = {
      business: "Apex", contact: "Not found", category: "Gym", location: "Vashi",
      website: "Not found", presence: "basic", problem: "no booking", opportunity: "funnel",
      serviceFit: "website", angleSeed: "angle", sources: [],
    };
    const t0 = Date.now();
    for (let i = 0; i < 100; i++) {
      const fb = composeFallback(facts);
      coercePlanned({ subject: `Idea ${i}`, body: "Body here", follow_ups: [] }, fb);
    }
    expect(Date.now() - t0).toBeLessThan(2000);
  });
});
