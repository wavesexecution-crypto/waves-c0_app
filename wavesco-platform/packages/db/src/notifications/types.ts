/**
 * Acquisition OS Notification System — Event Types & Constants
 *
 * LOCKED milestone events. Do not add additional client-facing
 * milestone notifications unless the system requires an error/action notification.
 */

// ─── Canonical Event Types ──────────────────────────────────────────
export const NOTIFICATION_EVENT_TYPES = {
  // Immediate milestones
  CYCLE_STARTED: "CYCLE_STARTED",
  LEAD_GENERATION_COMPLETED: "LEAD_GENERATION_COMPLETED",
  LEAD_REPORT_READY: "LEAD_REPORT_READY",
  EMAILS_READY_FOR_REVIEW: "EMAILS_READY_FOR_REVIEW",
  CAMPAIGN_DEPLOYED: "CAMPAIGN_DEPLOYED",

  // Time-dependent milestones
  NEW_RESPONSES_DETECTED: "NEW_RESPONSES_DETECTED",
  POSITIVE_RESPONSE_DETECTED: "POSITIVE_RESPONSE_DETECTED",
  FOLLOW_UP_READY: "FOLLOW_UP_READY",
  FOLLOW_UP_WINDOW_COMPLETED: "FOLLOW_UP_WINDOW_COMPLETED",
  CAMPAIGN_RESULTS_FINALIZED: "CAMPAIGN_RESULTS_FINALIZED",
  CYCLE_REPORT_READY: "CYCLE_REPORT_READY",

  // Error/action-required notifications
  STORAGE_CONNECTION_ERROR: "STORAGE_CONNECTION_ERROR",
  EMAIL_CONNECTION_ERROR: "EMAIL_CONNECTION_ERROR",
  CAMPAIGN_HALTED: "CAMPAIGN_HALTED",
} as const;

export type NotificationEventType =
  (typeof NOTIFICATION_EVENT_TYPES)[keyof typeof NOTIFICATION_EVENT_TYPES];

// ─── Notification Channels ───────────────────────────────────────────
export const NOTIFICATION_CHANNELS = {
  IN_APP: "in_app",
  EMAIL: "email",
  PUSH: "push",
} as const;

export type NotificationChannel =
  (typeof NOTIFICATION_CHANNELS)[keyof typeof NOTIFICATION_CHANNELS];

// ─── Resource Types (for linking notifications to client resources) ──
export const RESOURCE_TYPES = {
  CYCLE: "cycle",
  LEAD_REPORT: "lead_report",
  LEADS: "leads",
  CAMPAIGN: "campaign",
  EMAIL_REVIEW: "email_review",
  RESPONSE: "response",
  FOLLOW_UP: "follow_up",
  CYCLE_REPORT: "cycle_report",
} as const;

export type ResourceType = (typeof RESOURCE_TYPES)[keyof typeof RESOURCE_TYPES];

// ─── Preference Categories ───────────────────────────────────────────
export const PREFERENCE_CATEGORIES = {
  CYCLE_MILESTONES: "cycle_milestones",
  REPORTS: "reports",
  CAMPAIGN_ACTIVITY: "campaign_activity",
  RESPONSES: "responses",
  ACTION_REQUIRED: "action_required",
} as const;

export type PreferenceCategory =
  (typeof PREFERENCE_CATEGORIES)[keyof typeof PREFERENCE_CATEGORIES];

// ─── Event → Preference Category Mapping ─────────────────────────────
export const EVENT_TO_CATEGORY: Record<NotificationEventType, PreferenceCategory> = {
  CYCLE_STARTED: "cycle_milestones",
  LEAD_GENERATION_COMPLETED: "cycle_milestones",
  LEAD_REPORT_READY: "reports",
  EMAILS_READY_FOR_REVIEW: "campaign_activity",
  CAMPAIGN_DEPLOYED: "campaign_activity",
  NEW_RESPONSES_DETECTED: "responses",
  POSITIVE_RESPONSE_DETECTED: "responses",
  FOLLOW_UP_READY: "campaign_activity",
  FOLLOW_UP_WINDOW_COMPLETED: "campaign_activity",
  CAMPAIGN_RESULTS_FINALIZED: "reports",
  CYCLE_REPORT_READY: "reports",
  STORAGE_CONNECTION_ERROR: "action_required",
  EMAIL_CONNECTION_ERROR: "action_required",
  CAMPAIGN_HALTED: "action_required",
};

// ─── Event → Resource Type Mapping ───────────────────────────────────
export const EVENT_TO_RESOURCE_TYPE: Record<NotificationEventType, ResourceType | null> = {
  CYCLE_STARTED: "cycle",
  LEAD_GENERATION_COMPLETED: "leads",
  LEAD_REPORT_READY: "lead_report",
  EMAILS_READY_FOR_REVIEW: "email_review",
  CAMPAIGN_DEPLOYED: "campaign",
  NEW_RESPONSES_DETECTED: "response",
  POSITIVE_RESPONSE_DETECTED: "response",
  FOLLOW_UP_READY: "follow_up",
  FOLLOW_UP_WINDOW_COMPLETED: "follow_up",
  CAMPAIGN_RESULTS_FINALIZED: "campaign",
  CYCLE_REPORT_READY: "cycle_report",
  STORAGE_CONNECTION_ERROR: null,
  EMAIL_CONNECTION_ERROR: null,
  CAMPAIGN_HALTED: "campaign",
};

// ─── Notification Templates ──────────────────────────────────────────
export interface NotificationTemplate {
  title: string;
  message: string | ((ctx: NotificationContext) => string);
  resourceHref?: (ctx: NotificationContext) => string;
}

export interface NotificationContext {
  cycleId?: string;
  campaignId?: string;
  leadCount?: number;
  qualifiedCount?: number;
  emailCount?: number;
  responseCount?: number;
  prospectName?: string;
}

export const NOTIFICATION_TEMPLATES: Record<
  NotificationEventType,
  NotificationTemplate
> = {
  CYCLE_STARTED: {
    title: "Acquisition Cycle Started",
    message: "Acquisition OS has started working on your cycle.",
    resourceHref: (ctx) =>
      ctx.cycleId ? `/acquisition/cycles/${ctx.cycleId}` : "/acquisition",
  },
  LEAD_GENERATION_COMPLETED: {
    title: "Lead Generation Complete",
    message: (ctx) => {
      if (ctx.leadCount && ctx.qualifiedCount) {
        return `${ctx.leadCount} businesses researched and ${ctx.qualifiedCount} qualified leads were found.`;
      }
      return "Your lead research is complete. Your qualified leads are ready.";
    },
    resourceHref: (ctx) =>
      ctx.cycleId
        ? `/acquisition/cycles/${ctx.cycleId}/leads`
        : "/acquisition/leads",
  },
  LEAD_REPORT_READY: {
    title: "Lead Report Ready",
    message: "Your Lead Intelligence Report is ready to review.",
    resourceHref: (ctx) =>
      ctx.cycleId
        ? `/acquisition/cycles/${ctx.cycleId}/report`
        : "/acquisition/reports",
  },
  EMAILS_READY_FOR_REVIEW: {
    title: "Emails Ready for Review",
    message: (ctx) => {
      if (ctx.emailCount) {
        return `${ctx.emailCount} personalized outreach emails are ready for review.`;
      }
      return "Your personalized outreach emails are ready for review.";
    },
    resourceHref: (ctx) =>
      ctx.campaignId
        ? `/acquisition/campaigns/${ctx.campaignId}/emails`
        : "/acquisition/campaigns",
  },
  CAMPAIGN_DEPLOYED: {
    title: "Campaign Deployed",
    message: "Your approved outreach campaign has been deployed.",
    resourceHref: (ctx) =>
      ctx.campaignId
        ? `/acquisition/campaigns/${ctx.campaignId}`
        : "/acquisition/campaigns",
  },
  NEW_RESPONSES_DETECTED: {
    title: "New Responses Detected",
    message: (ctx) => {
      if (ctx.responseCount) {
        return `${ctx.responseCount} new responses have arrived from your outreach campaign.`;
      }
      return "New responses have arrived from your outreach campaign.";
    },
    resourceHref: (ctx) =>
      ctx.campaignId
        ? `/acquisition/campaigns/${ctx.campaignId}/responses`
        : "/acquisition/responses",
  },
  POSITIVE_RESPONSE_DETECTED: {
    title: "Positive Response Detected",
    message: (ctx) => {
      if (ctx.prospectName) {
        return `${ctx.prospectName} has shown positive interest in your outreach.`;
      }
      return "A prospect has shown positive interest in your outreach.";
    },
    resourceHref: (ctx) =>
      ctx.campaignId
        ? `/acquisition/campaigns/${ctx.campaignId}/responses`
        : "/acquisition/responses",
  },
  FOLLOW_UP_READY: {
    title: "Follow-up Ready",
    message: "Follow-ups are ready for your review.",
    resourceHref: (ctx) =>
      ctx.campaignId
        ? `/acquisition/campaigns/${ctx.campaignId}/follow-ups`
        : "/acquisition/follow-ups",
  },
  FOLLOW_UP_WINDOW_COMPLETED: {
    title: "Follow-up Window Completed",
    message: "The follow-up response window has ended.",
    resourceHref: (ctx) =>
      ctx.campaignId
        ? `/acquisition/campaigns/${ctx.campaignId}`
        : "/acquisition/campaigns",
  },
  CAMPAIGN_RESULTS_FINALIZED: {
    title: "Campaign Results Finalized",
    message: "Your campaign results have been finalized.",
    resourceHref: (ctx) =>
      ctx.campaignId
        ? `/acquisition/campaigns/${ctx.campaignId}/results`
        : "/acquisition/results",
  },
  CYCLE_REPORT_READY: {
    title: "Cycle 1 Report Ready",
    message: "Your complete Cycle 1 acquisition report is ready.",
    resourceHref: (ctx) =>
      ctx.cycleId
        ? `/acquisition/cycles/${ctx.cycleId}/report`
        : "/acquisition/reports",
  },
  STORAGE_CONNECTION_ERROR: {
    title: "Storage Connection Requires Attention",
    message:
      "There was an issue connecting to your storage. Some files may not be available temporarily.",
  },
  EMAIL_CONNECTION_ERROR: {
    title: "Email Connection Requires Attention",
    message:
      "There was an issue with your email service. Campaign sending may be delayed.",
  },
  CAMPAIGN_HALTED: {
    title: "Campaign Could Not Continue",
    message:
      "Your campaign has been paused due to an issue. Please review and take action.",
    resourceHref: (ctx) =>
      ctx.campaignId
        ? `/acquisition/campaigns/${ctx.campaignId}`
        : "/acquisition/campaigns",
  },
};
