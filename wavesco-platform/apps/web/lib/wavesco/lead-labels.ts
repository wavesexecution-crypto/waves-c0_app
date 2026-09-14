/**
 * Customer language for the Acquisition OS.
 *
 * Pure mappers from internal states to human-readable labels.
 * No technical terms, no codes, no internal names. Fully unit-tested.
 */

export interface LeadLike {
  lead_score?: number | null;
  tier?: string | null;
  email?: string | null;
  email_status?: string | null;
  date_contacted?: string | null;
  reply_status?: string | null;
  opted_out?: number | null;
  bounced?: number | null;
}

/** "Research pending" until the engine has scored the lead. */
export function researchLabel(lead: LeadLike): "Researched" | "Research pending" {
  return lead.lead_score === null || lead.lead_score === undefined ? "Research pending" : "Researched";
}

/** Outreach readiness in plain language. Order matters: opt-out/bounce win. */
export function outreachLabel(
  lead: LeadLike,
): "Opted out" | "Bounced" | "Replied" | "Contacted" | "Ready to contact" | "Needs email" {
  if (lead.opted_out === 1) return "Opted out";
  if (lead.bounced === 1) return "Bounced";
  if (lead.reply_status && lead.reply_status.trim() !== "") return "Replied";
  if (lead.date_contacted) return "Contacted";
  if (lead.email && lead.email.trim() !== "") return "Ready to contact";
  return "Needs email";
}

/** Next concrete action for a single lead. */
export function leadNextAction(lead: LeadLike): string {
  const outreach = outreachLabel(lead);
  switch (outreach) {
    case "Opted out":
      return "Do not contact";
    case "Bounced":
      return "Verify details";
    case "Replied":
      return "Review reply";
    case "Contacted":
      return "Follow up";
    case "Ready to contact":
      return "Add to campaign";
    case "Needs email":
      return "Find email";
  }
}

/** Fit score for display — null when unscored (never invent numbers). */
export function fitScore(lead: LeadLike): number | null {
  return typeof lead.lead_score === "number" ? Math.round(lead.lead_score) : null;
}

// ------------------------------------------------------------------
// Outreach / campaign states
// ------------------------------------------------------------------

const OUTREACH_LABELS: Record<string, string> = {
  draft: "Draft",
  submitted: "Needs your approval",
  approved: "Approved",
  scheduled: "Scheduled",
  queued: "Scheduled",
  sending: "Sending",
  sent: "Sent",
  delivered: "Sent",
  opened: "Seen",
  replied: "Replied",
  bounced: "Bounced",
  failed: "Needs attention",
  opted_out: "Opted out",
  unsubscribed: "Unsubscribed",
  cancelled: "Cancelled",
  skipped: "Skipped",
};

export function outreachStatusLabel(status: string | null | undefined): string {
  if (!status) return "Not started";
  return OUTREACH_LABELS[status.toLowerCase()] ?? "In progress";
}

const CAMPAIGN_LABELS: Record<string, string> = {
  draft: "Draft",
  ready: "Ready to review",
  scheduled: "Scheduled",
  active: "Sending",
  sending: "Sending",
  paused: "Paused",
  completed: "Completed",
  stopped: "Stopped",
  archived: "Archived",
};

export function campaignStatusLabel(status: string | null | undefined): string {
  if (!status) return "Draft";
  return CAMPAIGN_LABELS[status.toLowerCase()] ?? status;
}

// ------------------------------------------------------------------
// Greeting
// ------------------------------------------------------------------

export function greeting(hour?: number): "Good morning" | "Good afternoon" | "Good evening" {
  const h = hour ?? new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

// ------------------------------------------------------------------
// State-driven primary action (ONE obvious next step)
// ------------------------------------------------------------------

export interface PrimaryActionInput {
  profileReady: boolean;
  profileFresh: boolean;
  totalLeads: number;
  outreachReady: number;
  queuedEmails: number;
  sentEmails: number;
  replies: number;
}

export interface PrimaryAction {
  title: string;
  description: string;
  cta: string;
  href: string;
}

export function getPrimaryAction(s: PrimaryActionInput): PrimaryAction {
  if (!s.profileReady) {
    return {
      title: s.profileFresh ? "Tell us about your business" : "Finish your acquisition profile",
      description: s.profileFresh
        ? "Complete your company profile so the system knows who to find for you."
        : "A few profile details are still missing. Finish them to unlock the full system.",
      cta: s.profileFresh ? "Complete your company profile" : "Finish your acquisition profile",
      href: "/acquisition/profile",
    };
  }
  if (s.totalLeads === 0) {
    return {
      title: "Generate your first leads",
      description: "Your profile is ready. Run discovery to build your pipeline.",
      cta: "Generate your first leads",
      href: "/acquisition/generate",
    };
  }
  if (s.replies > 0) {
    return {
      title: "Review your replies",
      description: `${s.replies} ${s.replies === 1 ? "conversation needs" : "conversations need"} your attention.`,
      cta: "Review replies",
      href: "/acquisition/replies",
    };
  }
  if (s.queuedEmails > 0) {
    return {
      title: "Review outreach waiting for approval",
      description: `${s.queuedEmails} ${s.queuedEmails === 1 ? "message is" : "messages are"} ready for your review. Nothing sends without your approval.`,
      cta: "Review campaign",
      href: "/acquisition/outreach",
    };
  }
  if (s.outreachReady > 0) {
    return {
      title: "Build an outreach campaign",
      description: `${s.outreachReady} ${s.outreachReady === 1 ? "lead is" : "leads are"} researched and ready to contact.`,
      cta: "Review qualified leads",
      href: "/acquisition/leads",
    };
  }
  if (s.sentEmails > 0) {
    return {
      title: "Track your outreach",
      description: "Campaigns are sending. Watch replies and follow-ups here.",
      cta: "View reports",
      href: "/acquisition/reports",
    };
  }
  return {
    title: "Review your pipeline",
    description: "See where every prospect stands and what happens next.",
    cta: "Review qualified leads",
    href: "/acquisition/leads",
  };
}

// ------------------------------------------------------------------
// Acquisition flow progress (Define → Convert)
// ------------------------------------------------------------------

export interface FlowStep {
  id: string;
  label: string;
  hint: string;
  state: "done" | "current" | "next";
}

export function acquisitionFlow(s: PrimaryActionInput): FlowStep[] {
  const hasLeads = s.totalLeads > 0;
  const hasOutreach = s.queuedEmails > 0 || s.sentEmails > 0;
  const done: boolean[] = [
    s.profileReady,
    hasLeads,
    hasLeads && (s.outreachReady > 0 || hasOutreach),
    hasOutreach || s.outreachReady > 0,
    s.sentEmails > 0,
    s.sentEmails > 0,
    false, // Convert is ongoing — never "done"
  ];
  const meta = [
    { id: "define", label: "Define", hint: "Company + customer + offer" },
    { id: "discover", label: "Discover", hint: "Find prospects" },
    { id: "research", label: "Research", hint: "Research + qualify" },
    { id: "review", label: "Review", hint: "Approve prospects" },
    { id: "outreach", label: "Outreach", hint: "Send approved campaigns" },
    { id: "followup", label: "Follow up", hint: "Manage follow-ups" },
    { id: "convert", label: "Convert", hint: "Meetings + wins" },
  ];
  // Exactly one "current": the first step that isn't done.
  const currentIdx = done.findIndex((d) => !d);
  return meta.map((m, i) => ({
    ...m,
    state: done[i] ? ("done" as const) : i === currentIdx ? ("current" as const) : ("next" as const),
  }));
}
