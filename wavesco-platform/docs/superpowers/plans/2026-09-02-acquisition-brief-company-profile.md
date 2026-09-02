# Acquisition Brief / Company Acquisition Profile — Gap Analysis & Implementation Plan

Date: 2026-09-02
Status: GAP ANALYSIS COMPLETE — PROCEEDING TO IMPLEMENTATION
Commercial: Choose. Rent. Operate. — one OS, no tiers, no gating.

## 1. What Already Exists (Reused)

**Tenant & Auth:** `Tenant(id,slug,plan, status)` + `User` + `TenantModule` + `withTenantContext()` RLS `app.tenant_id` + `requireControlAuth()`/`auditControl()` at `apps/web/lib/wavesco/control.ts:1` — all tenant-scoped, audited. Reused.

**Acquisition OS Data:** `GenerationBatch`, `Campaign(status draft/scheduled/running/paused/stopped)`, `OutreachEmail`, `FollowUp`, `LeadResearch(@@unique[tenantId,leadKey])`, `OutreachOrder(status READY_FOR_APPROVAL…)`, `LeadLifecycleEvent`, `ActivityEvent`, `IntegrationStatus(key,state)`, `ClientAiConfig(tenantId @unique, credentialRef env:VAR)`, `AiUsageLog`, `AuditLog`, `Tenant` — 24 models in `packages/db/prisma/schema.prisma:1`. Reuse all, no duplicates.

**Control Center:** `apps/web/app/(dashboard)/acquisition/*` 10 pages (overview, leads, lead-engine, pipeline, campaigns, outreach, follow-ups, reports, agents, workflows, integrations, email, analytics, system) + 10 APIs + `lib/wavesco/{lead-engine,integrations,control}` + `StatusPill/MetricCard` + polling `AutoRefresh` + `ConfirmDialog`. Keep, extend — do not rebuild.

**AI Gateway:** `lib/ai/gateway.ts` ollama_cloud gemma4:31b via `credentialRef`, never leaks to browser, `AiUsageLog` ledger. Reused for Nemotron.

**Commercial:** `Tenant.plan` default `starter` — currently not gatekeeping Acquisition OS. Will keep no-tier gating; profile status drives activation, not plan.

## 2. Gaps — Missing Canonical Models

No `AcquisitionProfile` / `Company Acquisition Profile` — no place to store the 8 input groups tenant-isolated.

No `AcquisitionDataImport` — GenerationBatch is engine batch, not client CSV/Excel/CRM import.

No deterministic `readiness` validator, no `DRAFT/INCOMPLETE/READY/ACTIVE/PAUSED/SUSPENDED` lifecycle for the profile (Campaign has its own state machine, not reused).

No `agent context` builder that projects profile + historical campaigns/leads/outreach/history into Nemotron-structured context (company/objective/icp/offer/brand/integrations/rules/current_state/historical_context) with credential redaction.

No Control Center `acquisition/profile` UI for Company→Objective→ICP→Data→Offer→Brand→Integrations→Rules → Brief → readiness → Activate.

No audit coverage for profile create/update/activate/pause/data-import/integration association.

## 3. Target Data Architecture (Minimal)

**Reuse:** all existing lead/campaign/outreach/integration/ai/audit models.

**Create only:**

```prisma
model AcquisitionProfile {
  id String @id @default(cuid())
  tenantId String @unique
  status String @default("DRAFT") // DRAFT, INCOMPLETE, READY, ACTIVE, PAUSED, SUSPENDED
  version Int @default(1)
  // 1 COMPANY
  companyName String?
  website String?
  industry String?
  whatWeSell String?
  productsServices Json? // [{name, description}]
  locationsServed Json? // [string]
  businessModel String? // B2B/B2C/marketplace/etc
  // 2 OBJECTIVE
  acquisitionObjective String? // leads/meetings/customers/sales
  primaryObjective String?
  targetQuantity Int?
  targetTimeframe String?
  priorityProductService String?
  // 3 ICP — Json
  icp Json? // {targetCustomer,b2bB2c,industry,companySize,decisionMakerTitles,geography,characteristics,buyingSignals,disqualifiers}
  // 5 OFFER — Json
  offer Json? // {productService,pricing,valueProp,promotions,cta,differentiators,proof}
  // 6 BRAND — Json
  brand Json? // {brandInfo,toneOfVoice,messagingPrefs,existingCopy,caseStudies,claimsProof,avoidSaying}
  // 7 INFRA — Json (crm,email,calendar,website,whatsapp,other) — references, not credentials
  integrations Json?
  // 8 RULES — Json
  rules Json? // {geoRestrictions,industriesExclude,customerTypesExclude,outreachRestrictions,approvalRequirements,businessRules,complianceConstraints,operationalLimits:{daily,monthly}}
  readiness Json? // last deterministic check snapshot
  activatedAt DateTime?
  pausedAt DateTime?
  suspendedAt DateTime?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  dataImports AcquisitionDataImport[]
  @@index([tenantId,status])
  @@map("AcquisitionProfile")
}

model AcquisitionDataImport {
  id String @id @default(cuid())
  tenantId String
  profileId String
  profile AcquisitionProfile @relation(fields:[profileId], references:[id], onDelete:Cascade)
  fileName String
  fileType String // csv|excel|json
  rowCount Int?
  status String @default("pending") // pending, processed, failed
  summary Json? // not raw PII dump; counts + column mapping
  error String?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  @@index([tenantId,profileId])
  @@index([tenantId,status])
  @@map("AcquisitionDataImport")
}
```

RLS: `ENABLE ROW LEVEL SECURITY` + `POLICY tenantId = current_setting('app.tenant_id')` + `GRANT wavesco_app` matching `20260825010000_wavesco_product_models`.

No duplicate leads/campaigns — profile is the parent context, existing tables remain child execution state.

## 4. Readiness — Deterministic

Required for READY (optional never blocks):

- Company: `companyName`, `website`, `industry`, `whatWeSell`
- Objective: `acquisitionObjective`, `primaryObjective`
- ICP: `icp.targetCustomer`, `icp.geography`
- Offer: `offer.productService` OR `offer.valueProp`

Validator: `lib/wavesco/acquisition-profile.ts:readinessCheck(profile) → {ready:boolean, missing:string[], present:string[]}` pure, no AI. Called on GET and before activation.

States: `DRAFT` (empty) → `INCOMPLETE` (some required missing) → `READY` (all required) → `ACTIVE` (activate) → `PAUSED`/`SUSPENDED` → resume → `ACTIVE`. Transitions audited, tenant-scoped, 400 on invalid.

## 5. Agent Context — Nemotron 3 Super

`buildAgentContext(profile, ctx: {historicalCampaigns, leadStats, outreachHistory, activityEvents, decisionHistory}) → {company, objective, icp, offer, brand, existing_data:{importsSummary}, integrations:{refs, health}, constraints:rules, operating_preferences, current_state:{status, readiness, activatedAt}, historical_context:{campaigns, leads, outreach, responses, performance, documents}, meta:{tenantId, profileVersion, generatedAt}}`

Never includes `credentialRef`, raw API keys, `DATABASE_URL`. Uses `maskUrl` + `redact`. Large context capability treated as architectural — structured layer, not dump.

Nemotron reasons/plans/orchestrates; deterministic tools (`discovery`, `enrich_ai`, `excel_outreach`, `pdf_report`, `notify`, `withTenantContext` queries) execute; results return to OS state, persisted, audited.

## 6. Control Center Integration

Extend, don't rebuild: new route `app/(dashboard)/acquisition/profile` + `app/api/acquisition/profile/*`

- `GET /api/acquisition/profile` — tenant-scoped fetch or 404
- `POST/PATCH /api/acquisition/profile` — upsert 8 sections, `auditControl profile.create/update`, tenant-isolated
- `GET /api/acquisition/profile/readiness`, `POST /api/acquisition/profile/activate|pause|resume|suspend` — state machine
- `POST /api/acquisition/profile/import` — CSV/Excel upload → `AcquisitionDataImport` + audit, no raw secrets
- `GET /api/acquisition/profile/context` — internal, masked, tenant-scoped

UI: Company → Objective → ICP → Data → Offer → Brand → Integrations → Rules → Acquisition Brief review → readiness checklist (✓/○) → Activate/ Pause/ Update CTA, upload, connect integrations via existing `integrations/test` (masked), no agents/prompts/scoring exposed.

## 7. Security & Audit

- `credentialRef` only, never raw keys in profile/json.
- Tenant isolation via `withTenantContext` + RLS + `@@unique[tenantId]`.
- Every mutation `auditControl` with before/after, who/what/when/tenant/resource/result/failure.
- Integration health `n8nHealth` masked, never leaks `X-N8N-API-KEY`.

## 8. Tests & E2E

Reuse existing 100+ tests. Add: `acquisition-profile.test.ts` (create, update, tenant isolation, required/optional, readiness, activation/incomplete rejection, import, integration association, audit, context redaction, security), `e2e/acquisition-flow.test.ts` extension: Create Company → Complete Brief → Connect infra → Readiness → Activate → Agent context → Workflow → Audit trail, BLOCKED if LEAD_ENGINE_ROOT/N8N missing, never fake green.

## 9. Docs

Update `D:\obsidian waves\wavesco\WavesCo\Acquisition OS\ACQUISITION OS — MASTER PRODUCT DOSSIER.md` (44 sections) + snapshot + `docs/{ARCHITECTURE,INTEGRATIONS,SECURITY,OPERATIONS}` without duplicating dossier.

## 10. Execution Order

1. Schema + migration (AcquisitionProfile, AcquisitionDataImport, RLS) + `prisma generate`
2. `lib/wavesco/acquisition-profile.ts` (validator, state machine, context builder) + tests TDD
3. APIs (profile CRUD, readiness, lifecycle, import, context)
4. Control Center UI (`acquisition/profile` + brief review)
5. Tests + E2E
6. Dossier + engineering docs
7. Verify build + production deploy (already `waves-c0-app` `app.wavesco.in`)
