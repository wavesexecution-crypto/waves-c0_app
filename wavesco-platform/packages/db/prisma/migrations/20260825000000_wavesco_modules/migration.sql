-- Phase 1 legacy cleanup: retire Cafe demo catalog entries and register
-- the WavesCo product modules. Historical cafe tables are left untouched.
INSERT INTO "Module" ("id", "name", "displayName", "description", "version", "contractPath", "createdAt")
VALUES
  ('mod_acq0000000000000000000001', 'acquisition-os', 'Acquisition OS', 'Lead Engine control, leads, campaigns, cold email approval handoff, follow-ups and batch reports.', '1.0.0', 'modules/acquisition-os/module.contract.json', now()),
  ('mod_cli0000000000000000000001', 'client-os', 'Client OS', 'Clients, onboarding checklists, projects, tasks and deliverables.', '1.0.0', 'modules/client-os/module.contract.json', now()),
  ('mod_aut0000000000000000000001', 'automation-os', 'Automation OS', 'Control plane for the existing n8n instance: workflows, executions, health and integration status.', '1.0.0', 'modules/automation-os/module.contract.json', now())
ON CONFLICT ("name") DO NOTHING;

DELETE FROM "TenantModule" WHERE "moduleId" IN (SELECT "id" FROM "Module" WHERE "name" LIKE 'cafe-%');
