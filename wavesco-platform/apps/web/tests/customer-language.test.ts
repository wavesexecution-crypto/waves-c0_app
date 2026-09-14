/**
 * Customer language + state-driven primary action — regression tests.
 *
 * Guarantees: human-readable labels contain no internal codes, and exactly
 * one next action is produced for every workspace state.
 */
import { describe, it, expect } from "vitest";
import {
  acquisitionFlow,
  campaignStatusLabel,
  fitScore,
  getPrimaryAction,
  greeting,
  leadNextAction,
  outreachLabel,
  outreachStatusLabel,
  researchLabel,
} from "@/lib/wavesco/lead-labels";

describe("researchLabel / outreachLabel", () => {
  it("uses plain language, never internal codes", () => {
    expect(researchLabel({ lead_score: null })).toBe("Research pending");
    expect(researchLabel({ lead_score: 82 })).toBe("Researched");
    expect(outreachLabel({ email: "a@b.co" })).toBe("Ready to contact");
    expect(outreachLabel({})).toBe("Needs email");
    expect(outreachLabel({ email: "a@b.co", date_contacted: "2026-01-01" })).toBe("Contacted");
    expect(outreachLabel({ email: "a@b.co", reply_status: "positive" })).toBe("Replied");
    expect(outreachLabel({ bounced: 1 })).toBe("Bounced");
    expect(outreachLabel({ opted_out: 1, bounced: 1 })).toBe("Opted out");
    for (const l of ["EMAIL_READY", "RESEARCH_PENDING", "CONTACTED"]) {
      expect(outreachLabel({})).not.toContain(l);
    }
  });

  it("gives a next action for every lead", () => {
    expect(leadNextAction({ opted_out: 1 })).toBe("Do not contact");
    expect(leadNextAction({ email: "a@b.co" })).toBe("Add to campaign");
    expect(leadNextAction({})).toBe("Find email");
  });

  it("never invents a fit score", () => {
    expect(fitScore({})).toBeNull();
    expect(fitScore({ lead_score: 82.6 })).toBe(83);
  });
});

describe("outreachStatusLabel / campaignStatusLabel", () => {
  it("maps machine states to human words", () => {
    expect(outreachStatusLabel("submitted")).toBe("Needs your approval");
    expect(outreachStatusLabel("approved")).toBe("Approved");
    expect(outreachStatusLabel("sent")).toBe("Sent");
    expect(outreachStatusLabel("failed")).toBe("Needs attention");
    expect(outreachStatusLabel("unsubscribed")).toBe("Unsubscribed");
    expect(outreachStatusLabel(null)).toBe("Not started");
    expect(campaignStatusLabel("active")).toBe("Sending");
    expect(campaignStatusLabel(null)).toBe("Draft");
  });
});

describe("getPrimaryAction", () => {
  const base = {
    profileReady: true,
    profileFresh: false,
    totalLeads: 10,
    outreachReady: 4,
    queuedEmails: 0,
    sentEmails: 0,
    replies: 0,
  };
  it("asks for the profile first when missing", () => {
    expect(getPrimaryAction({ ...base, profileReady: false, profileFresh: true }).href).toBe(
      "/acquisition/profile",
    );
  });
  it("asks to generate when there are no leads", () => {
    expect(getPrimaryAction({ ...base, totalLeads: 0 }).href).toBe("/acquisition/generate");
  });
  it("prioritizes replies over everything once they exist", () => {
    expect(
      getPrimaryAction({ ...base, replies: 3, queuedEmails: 5 }).href,
    ).toBe("/acquisition/replies");
  });
  it("then waiting approvals", () => {
    expect(getPrimaryAction({ ...base, queuedEmails: 2 }).href).toBe("/acquisition/outreach");
  });
  it("then building a campaign from ready leads", () => {
    expect(getPrimaryAction(base).href).toBe("/acquisition/leads");
  });
  it("then tracking sent outreach", () => {
    expect(
      getPrimaryAction({ ...base, outreachReady: 0, sentEmails: 9 }).href,
    ).toBe("/acquisition/reports");
  });
  it("always returns exactly one CTA with copy", () => {
    for (const s of [
      base,
      { ...base, profileReady: false },
      { ...base, totalLeads: 0 },
    ]) {
      const a = getPrimaryAction(s);
      expect(a.cta.length).toBeGreaterThan(0);
      expect(a.href.startsWith("/acquisition/")).toBe(true);
    }
  });
});

describe("acquisitionFlow", () => {
  it("has 7 plain-language steps with exactly one current", () => {
    const steps = acquisitionFlow({
      profileReady: true,
      profileFresh: false,
      totalLeads: 5,
      outreachReady: 2,
      queuedEmails: 0,
      sentEmails: 0,
      replies: 0,
    });
    expect(steps.map((s) => s.label)).toEqual([
      "Define",
      "Discover",
      "Research",
      "Review",
      "Outreach",
      "Follow up",
      "Convert",
    ]);
    expect(steps.filter((s) => s.state === "current")).toHaveLength(1);
  });
  it("starts at Define for a fresh workspace", () => {
    const steps = acquisitionFlow({
      profileReady: false,
      profileFresh: true,
      totalLeads: 0,
      outreachReady: 0,
      queuedEmails: 0,
      sentEmails: 0,
      replies: 0,
    });
    expect(steps.find((s) => s.state === "current")?.id).toBe("define");
  });
});

describe("greeting", () => {
  it("greets by time of day", () => {
    expect(greeting(9)).toBe("Good morning");
    expect(greeting(13)).toBe("Good afternoon");
    expect(greeting(20)).toBe("Good evening");
  });
});
