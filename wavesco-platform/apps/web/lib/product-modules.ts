import type { ModuleContract } from "./module-loader";

export interface ProductModule {
  contract: ModuleContract;
}

/**
 * WavesCo product modules (first-party). Replaces the legacy Cafe demo
 * modules in the registry surface while keeping the generic module
 * framework (catalog, TenantModule enable/disable, contracts) intact.
 */
export const WAVECO_MODULES: ProductModule[] = [
  {
    contract: {
      name: "acquisition-os",
      displayName: "Acquisition OS",
      version: "1.0.0",
      description:
        "Lead Engine control, leads, campaigns, cold email approval handoff, follow-ups and batch reports.",
      entry: "app/(dashboard)/acquisition",
      requiresEnv: ["LEAD_ENGINE_ROOT", "N8N_BASE_URL"],
      tables: ["GenerationBatch", "Campaign", "OutreachEmail", "FollowUp", "ActivityEvent"],
      webhooks: [],
      permissions: [
        { action: "read", resource: "acquisition" },
        { action: "create", resource: "acquisition" },
        { action: "update", resource: "acquisition" },
        { action: "delete", resource: "acquisition" },
      ],
      audit: true,
      actions: [
        "generateLeadsAction",
        "createCampaignAction",
        "submitCampaignAction",
        "decideApprovalAction",
        "upsertFollowUpAction",
        "updateLeadOutreachAction",
        "resendReportAction",
      ],
    },
  },
  {
    contract: {
      name: "client-os",
      displayName: "Client OS",
      version: "1.0.0",
      description: "Clients, onboarding checklists, projects, tasks and deliverables.",
      entry: "app/(dashboard)/clients",
      requiresEnv: [],
      tables: ["Client", "OnboardingStep", "Project", "ProjectTask", "Deliverable"],
      webhooks: [],
      permissions: [
        { action: "read", resource: "clients" },
        { action: "create", resource: "clients" },
        { action: "update", resource: "clients" },
        { action: "delete", resource: "clients" },
      ],
      audit: true,
      actions: [
        "createClientAction",
        "updateClientAction",
        "toggleOnboardingStepAction",
        "createProjectAction",
        "updateTaskStatusAction",
        "setDeliverableStatusAction",
      ],
    },
  },
  {
    contract: {
      name: "automation-os",
      displayName: "Automation OS",
      version: "1.0.0",
      description:
        "Control plane for the existing n8n instance: workflows, executions, health and integration status.",
      entry: "app/(dashboard)/automation",
      requiresEnv: ["N8N_BASE_URL"],
      tables: ["IntegrationStatus"],
      webhooks: [],
      permissions: [
        { action: "read", resource: "automation" },
        { action: "admin", resource: "automation" },
      ],
      audit: true,
      actions: ["refreshIntegrationStatusAction"],
    },
  },
];

export function getProductModule(name: string): ProductModule | undefined {
  return WAVECO_MODULES.find((m) => m.contract.name === name);
}
