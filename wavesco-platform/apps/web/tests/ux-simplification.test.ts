import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { buildNavSections } from "@/lib/nav";

/**
 * Acquisition UX simplification — clients operate, they do not configure.
 * Primary nav follows the client flow (Home → Setup → Leads → Outreach →
 * Replies → Reports); infrastructure lives behind the Advanced section.
 * These tests lock the vocabulary: no provider/infra names on client
 * surfaces, and every primary route still resolves to a real page.
 */

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(here, "..");
function src(rel: string): string {
  return readFileSync(resolve(webRoot, rel), "utf8");
}

const HOME = "app/(dashboard)/acquisition/page.tsx";
const REPLIES = "app/(dashboard)/acquisition/replies/page.tsx";
const CONNECTIONS = "app/(dashboard)/acquisition/integrations/page.tsx";
const EMAIL = "app/(dashboard)/acquisition/email/page.tsx";
const REPORTS = "app/(dashboard)/acquisition/analytics/page.tsx";
const SETUP = "app/(dashboard)/acquisition/profile/page.tsx";
const FOLLOWUPS = "app/(dashboard)/acquisition/follow-ups/page.tsx";
const CAMPAIGNS = "app/(dashboard)/acquisition/campaigns/page.tsx";
const CAMPAIGN_FORM = "components/acquisition/campaign-form.tsx";

describe("primary nav follows the client flow", () => {
  it("Acquisition OS section is Home → Setup → Leads → Outreach → Replies → Reports", () => {
    const sections = buildNavSections(false);
    const os = sections.find((s) => s.title === "Acquisition OS");
    expect(os).toBeDefined();
    expect(os!.items.map((i) => i.label)).toEqual([
      "Home",
      "Setup",
      "Leads",
      "Outreach",
      "Replies",
      "Reports",
    ]);
    expect(os!.items.map((i) => i.href)).toEqual([
      "/acquisition",
      "/acquisition/profile",
      "/acquisition/leads",
      "/acquisition/outreach",
      "/acquisition/replies",
      "/acquisition/analytics",
    ]);
  });

  it("operator screens moved to Advanced, Intelligence keeps only Waves AI", () => {
    const sections = buildNavSections(false);
    const advanced = sections.find((s) => s.title === "Advanced");
    expect(advanced).toBeDefined();
    const labels = advanced!.items.map((i) => i.label);
    for (const expected of [
      "Lead Engine",
      "Outreach Pipeline",
      "Campaigns",
      "Email Setup",
      "Follow-ups",
      "Connections",
      "Documents",
      "Analytics",
      "Insights",
    ]) {
      expect(labels).toContain(expected);
    }
    const primaryLabels = sections
      .find((s) => s.title === "Acquisition OS")!
      .items.map((i) => i.label);
    for (const gone of [
      "Overview",
      "Company Profile",
      "Cold Email",
      "Lead Engine",
      "Outreach Pipeline",
      "Campaigns",
      "Acquisition Analytics",
      "Integrations",
    ]) {
      expect(primaryLabels).not.toContain(gone);
    }
    const intelligence = sections.find((s) => s.title === "Intelligence");
    expect(intelligence!.items.map((i) => i.label)).toEqual(["Waves AI"]);
  });

  it("internal gating still works — Modules only with internal access", () => {
    const hrefs = (internal: boolean) =>
      buildNavSections(internal).flatMap((s) => s.items.map((i) => i.href));
    expect(hrefs(false)).not.toContain("/modules");
    expect(hrefs(true)).toContain("/modules");
  });
});

describe("client surfaces hide infrastructure names", () => {
  it("Home speaks plain language", () => {
    const t = src(HOME);
    for (const present of [
      "Needs your attention",
      "All clear",
      "Your leads",
      "Your outreach",
      "Waiting to send",
      "Failed to send",
    ]) {
      expect(t).toContain(present);
    }
    for (const gone of [
      "Lead Engine",
      "Approval Queue",
      "Email Outbox",
      "Notify Hub",
      "Corpus",
      "Telegram",
      "Queued emails",
      "Company Profile",
      "Control layer",
    ]) {
      expect(t).not.toContain(gone);
    }
  });

  it("Replies uses plain buckets with leave / try-again guidance", () => {
    const t = src(REPLIES);
    for (const present of [
      "Waiting for reply",
      "Not interested",
      "try again with a follow-up",
    ]) {
      expect(t).toContain(present);
    }
    for (const gone of ["Go to Pipeline", "reply ingestion", "nothing here is fabricated"]) {
      expect(t).not.toContain(gone);
    }
  });

  it("Connections shows tasks, not providers", () => {
    const t = src(CONNECTIONS);
    for (const present of [
      "Connections",
      "Email sending",
      "WAVE AI",
      "Behind the scenes",
      "Your files & reports",
    ]) {
      expect(t).toContain(present);
    }
    for (const gone of [
      "Brevo",
      "BREVO_API_KEY",
      "Postgres",
      "AI Gateway",
      "AiUsageLog",
      "LEAD_ENGINE_ROOT",
      "N8N_BASE_URL",
      "DATABASE_URL",
      "Test Connection",
      "maskUrl",
      "latencyMs",
      "BLOCKED",
      "IntegrationStatus",
      "AuditLog",
      "STORAGE_PROVIDER",
      "masked",
    ]) {
      expect(t).not.toContain(gone);
    }
    // No provider shown as a UI label (data keys like `?.n8n` stay in code).
    expect(t).not.toContain('label: "n8n"');
    expect(t).not.toContain(">n8n<");
  });

  it("Email page hides providers, keys and endpoints", () => {
    const t = src(EMAIL);
    for (const present of [
      "Message templates",
      "Previews never send",
      "Your campaigns",
      "every email",
    ]) {
      expect(t).toContain(present);
    }
    for (const gone of [
      "Brevo",
      "BREVO_API_KEY",
      "SMTP",
      "resend.com",
      "Resend",
      "EmailTemplate table",
      "ActivityEvent",
      "Approval Queue",
      "OutreachEmail.status",
      "OutreachOrder",
      "decide endpoint",
      "Email Outbox",
      "grouped by",
      "CampaignId",
      "tenant-scoped via",
      "auditControl",
      "server-side",
      "Test Connection",
      "credentialRef",
    ]) {
      expect(t).not.toContain(gone);
    }
  });

  it("message template controls avoid operator internals", () => {    const t = src("components/acquisition/email-template-controls.tsx");
    for (const present of [
      "Your message",
      "Previews never send",
      "No message templates yet",
    ]) {
      expect(t).toContain(present);
    }
    for (const gone of [
      "audit-logged",
      "auditControl",
      "tenant-scoped",
      "ActivityEvent",
      "server-side",
      "email.template.preview",
      "Manage &",
      "in-memory",
    ]) {
      expect(t).not.toContain(gone);
    }
  });

  it("Setup and Follow-ups avoid configuration language", () => {
    const setup = src(SETUP);
    expect(setup).toContain("essentials done");
    expect(setup).toContain("Preferences");
    expect(setup).not.toContain("tenant-isolated");
    expect(setup).not.toContain("Infrastructure");
    expect(setup).not.toContain("required sections complete");
    const fu = src(FOLLOWUPS);
    expect(fu).toContain("work them from here");
    expect(fu).not.toContain("Notify Hub");
    expect(fu).not.toContain("automations");
  });
});

describe("Reports debrief in plain language with detail on demand", () => {
  it("summary first, technical detail gated behind ?detail=full", () => {
    const t = src(REPORTS);
    for (const present of [
      "What worked",
      "What to do next",
      "Most drop-off",
      "Show technical detail",
      "detail=full",
      "Back to summary",
    ]) {
      expect(t).toContain(present);
    }
    for (const gone of [
      "Corpus (Lead Engine)",
      "no lastResearched",
      "Tenant-scoped acquisition",
      "not opted_out",
      "date_contacted",
      "reply_status",
      "OutreachOrder replyStatus",
      "from acquisition.emailReady",
      "Eligible (emailReady)",
      "OutreachEmail failed",
      "from getLeadStats",
      "Raw: {",
    ]) {
      expect(t).not.toContain(gone);
    }
  });

  it("campaigns support run-again prefill from a previous campaign", () => {
    const page = src(CAMPAIGNS);
    expect(page).toContain("Run again");
    expect(page).toContain("?from=");
    expect(page).toContain("Prefilled from");
    expect(page).toContain("initial={prefill}");
    const form = src(CAMPAIGN_FORM);
    expect(form).toContain("initial?");
    expect(form).toContain("initialLocation");
    expect(form).toContain("fall back");
  });
});

describe("Step 04 cold mail — connect, authorize, done", () => {
  const MODE_SELECTOR = "components/acquisition/email-mode-selector.tsx";
  const MODE_ROUTE = "app/api/acquisition/email/mode/route.ts";

  it("decision screen offers exactly the two plain options", () => {
    const page = src(EMAIL);
    for (const present of [
      "How should WAVES send your outreach?",
      "Sending for:",
      "This cycle:",
      "Change email",
      "Review outreach",
      "Your email connection needs attention.",
      "Connecting your mailbox",
    ]) {
      expect(page).toContain(present);
    }
    const selector = src(MODE_SELECTOR);
    for (const present of [
      "Connect my email",
      "Have WAVES handle it",
      "Connect email →",
      "Set up WAVES →",
      "Send outreach from your existing business email.",
    ]) {
      expect(selector).toContain(present);
    }
  });

  it("never exposes infrastructure, providers, secrets or fake OAuth", () => {
    for (const file of [EMAIL, MODE_SELECTOR, MODE_ROUTE]) {
      const t = src(file);
      for (const gone of [
        "Continue with Google",
        "Continue with Microsoft",
        "Gmail",
        "Outlook",
        "OAuth",
        "API key",
        "API_KEY",
        "SMTP",
        "password",
        "email infrastructure",
        "mail server",
        "Resend",
        "resend.com",
        "Brevo",
        "BREVO",
        "webhook",
        "Webhook",
        "DNS",
        "N8N",
        "n8n",
        "ENV",
        "env var",
      ]) {
        expect(t).not.toContain(gone);
      }
    }
  });

  it("ready and error states use client language with working actions", () => {
    const page = src(EMAIL);
    expect(page).toContain("Sending is ready");
    expect(page).toContain("Try again");
    expect(page).toContain('href="/acquisition/outreach"');
    expect(page).toContain('href="/acquisition/integrations"');
    expect(page).toContain('href="#email-choice"');
    expect(page).toContain("nothing is lost");
  });

  it("send confirmation path hides queue machinery", () => {
    const panel = src("components/acquisition/submit-panel.tsx");
    expect(panel).toContain("for approval");
    for (const gone of ["Email Outbox", "Approval Queue", "n8n →", "SMTP"]) {
      expect(panel).not.toContain(gone);
    }
    const outreach = src("app/(dashboard)/acquisition/outreach/page.tsx");
    expect(outreach).toContain("Nothing sends until you approve it");
    for (const gone of [
      "Email Outbox",
      "Approval Queue",
      "verbatim",
      "audit-logged",
      "Brevo/SMTP",
      "Email Control",
      "decide endpoint",
      "telemetry does not exist upstream",
    ]) {
      expect(outreach).not.toContain(gone);
    }
  });
});
