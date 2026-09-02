# ACQUISITION OS — MASTER PRODUCT DOSSIER

> **Owner:** WavesCo · **Vault:** `WavesCo/Acquisition OS` · **Repo:** `D:\waves-c0_app\wavesco-platform`
> **Created:** 2026-09-02 (Task 1 — Freeze, Inspect, and Seed)
> **Status:** SKELETON — 44 headings seeded; factual fields filled from freeze inspection; remainder marked `— filled —`
> **Freeze commit (platform):** `29ba04d` — `chore: redeploy with synced DB env for lead engine verification` (branch `main`, up to date with `origin/main` at freeze)
> **Lead Engine:** `D:\wavesco-lead-engine` — not a git repo (standalone Python engine, dual-mode local SQLite / remote HTTP)

---

## Freeze Evidence (2026-09-02)

### wavesco-platform — `D:\waves-c0_app\wavesco-platform`

**`git status`**
```
On branch main
Your branch is up to date with 'origin/main'.

Untracked files:
  apps/web/app/api/automation/[...path]/route.ts
  apps/web/app/api/google/[...path]/route.ts
  apps/web/app/api/obsidian/[...path]/route.ts
  apps/web/app/api/unsubscribe/route.ts
  apps/web/app/api/webhooks/brevo/route.ts
  docs/superpowers/plans/2026-09-02-acquisition-os-control-center.md
  find_brevo.py
  find_routes.py
  find_webhooks.py
  read_campaigns.py
  scripts/mass-build-probe.mts

nothing added to commit but untracked files present
```

**`git diff --stat`**
```
(no output — working tree clean except untracked files)
```

**`git log --oneline -10`**
```
29ba04d chore: redeploy with synced DB env for lead engine verification
98d1295 fix: production lead engine remote mode (vercel + tunnel)
aa1d610 fix: production lead engine remote mode (vercel + tunnel)
cbac200 chore: trigger redeploy for lead engine remote mode
f7d3c42 fix: dual-mode lead engine client (local SQLite / remote HTTP API)
f669195 fix: finalize email-verify strict-mode cleanup and middleware prefix union
bfd9144 merge: integrate Waves AI Gateway + client-ready hardening into production
ce82e25 integrate: port Waves AI Gateway, entitlement gating, Client OS workspace, security hardening onto production line
58ac86d feat: launch WavesCo client platform
cbc58de feat(web): replace favicon set with new WavesCo mark
```

**`modules/acquisition-os/module.contract.json`** (verbatim, 2026-09-02)
```json
{
  "name": "acquisition-os",
  "displayName": "Acquisition OS",
  "version": "1.0.0",
  "description": "Lead Engine control, leads, campaigns, cold email approval handoff, follow-ups and batch reports.",
  "entry": "app/(dashboard)/acquisition",
  "requiresEnv": ["LEAD_ENGINE_ROOT", "N8N_BASE_URL"],
  "tables": ["GenerationBatch", "Campaign", "OutreachEmail", "FollowUp", "ActivityEvent", "LeadResearch", "OutreachOrder"],
  "webhooks": [],
  "permissions": [
    { "action": "read", "resource": "acquisition" },
    { "action": "create", "resource": "acquisition" },
    { "action": "update", "resource": "acquisition" },
    { "action": "delete", "resource": "acquisition" }
  ],
  "audit": true,
  "actions": [
    "generateLeadsAction",
    "createCampaignAction",
    "submitCampaignAction",
    "decideApprovalAction",
    "upsertFollowUpAction",
    "updateLeadOutreachAction",
    "resendReportAction",
    "researchLeadAction",
    "checkLeadEmailAction",
    "generateOutreachOrderAction",
    "submitOrderAction",
    "decideOrderAction",
    "cancelOrderAction",
    "batchResearchAction",
    "batchCheckEmailsAction",
    "batchGenerateOrdersAction",
    "batchQueueReadyOrdersAction"
  ]
}
```

**`packages/db/prisma/schema.prisma` — inspected facts**
- `generator client` → `prisma-client-js`, output `../src/generated/client`
- `datasource db` → `postgresql`, `url = env("DATABASE_URL")`, `directUrl = env("DIRECT_URL")` (Neon)
- RLS: runtime role `wavesco_app` does NOT own tables; `withTenantContext()` sets `SET LOCAL app.tenant_id` per transaction
- Models (22): `Tenant`, `User`, `RefreshToken`, `Module`, `TenantModule`, `AuditLog`, `IdempotencyKey`, `VerificationToken`, `GenerationBatch`, `Campaign`, `OutreachEmail`, `FollowUp`, `LeadResearch`, `OutreachOrder`, `LeadLifecycleEvent`, `ActivityEvent`, `Client`, `OnboardingStep`, `Project`, `ProjectTask`, `Deliverable`, `IntegrationStatus`, `ClientAiConfig`, `AiUsageLog`
- Acquisition-relevant models: `GenerationBatch` (status queued/…, stage, requestedCount, resultLeadCount, emailReadyCount, engineBatchId, pdfPath, excelPath), `Campaign` (status draft→scheduled→running→paused→stopped→completed, sendingLimit, eligibleSnapshot), `OutreachEmail` (status draft/submitted/approved/sent/failed, approvalId, messageId, sendError), `LeadResearch` (unique [tenantId, leadKey], verification, email), `OutreachOrder` (status READY_FOR_APPROVAL→PENDING→APPROVED→SENT→DELIVERED/FAILED / REJECTED/CANCELLED, version, researchSnapshot, followupPlan, aiEnabled), `LeadLifecycleEvent` (stage/status/reason/aiProvider/emailStatus/eligibility), `ActivityEvent`, `FollowUp`, `IntegrationStatus` (key/state/detail/lastCheckedAt), `AuditLog` (tenantId/action/model/recordId/before/after/metadata), `ClientAiConfig`, `AiUsageLog`
- Full schema file present at `packages/db/prisma/schema.prisma` (read 2026-09-02; head 400 lines captured; `cat` returned full file)

### wavesco-lead-engine — `D:\wavesco-lead-engine`

**`git status`**
```
fatal: not a git repository (or any of the parent directories): .git
→ Engine is not versioned by git; tracked separately / standalone.
```

**`config.json`** (verbatim, 2026-09-02)
```json
{
  "engine_name": "WavesCo Lead Engine",
  "wavesco_env_path": "D:\\waves-c0_app\\wavesco-platform\\.env",
  "db_path": "data/leads.db",
  "reports_dir": "reports",
  "exports_dir": "exports",
  "reference_md": "",
  "batch_size": 25,
  "max_candidates_per_run": 60,
  "deep_research_limit": 25,
  "openai_model": "gemma4:31b",
  "tavily_depth": "advanced",
  "sheet_sync": { "mode": "local", "google_service_account_json": "", "google_sheet_id": "", "worksheet_name": "Leads" },
  "notify": { "n8n_bridge_url": "http://localhost:5678/webhook/personal/wavesco-leads", "source_workflow": "WavesCo Lead Engine", "fallback_direct_telegram": true },
  "geography": {
    "tier1_areas": [],
    "tier2_areas": ["Vashi", "Nerul", "Ulwe", "Kopar Khairane", "Kharghar", "Airoli"],
    "tier3_areas": ["Powai", "Khar West", "Lower Parel"],
    "city_by_tier": { "tier1_areas": "Navi Mumbai", "tier2_areas": "Navi Mumbai", "tier3_areas": "Mumbai" }
  },
  "categories": [
    { "label": "Dental Clinic" }, { "label": "Gym / Fitness Studio" }, { "label": "Bakery / Dessert Shop" },
    { "label": "Salon / Unisex Spa" }, { "label": "Cafe / Coffee Shop" }, { "label": "Gaming Cafe / Esports Lounge" },
    { "label": "Tuition / Coaching Class" }, { "label": "Boutique / Fashion Store" }
  ],
  "corporate_chain_blocklist": ["Starbucks","CCD","Cafe Coffee Day","Chaayos","Third Wave Coffee","Anytime Fitness","Gold's Gym","Cult.fit","Snap Fitness","Apollo Dental","Sabka Dentist","Clover Dental","Naturals","Jawed Habib","Lakme Salon","Green Trends"]
}
```

**`engine/` directory** (2026-09-02 `ls`)
```
__pycache__/
config.py (5504 B)
db.py (10678 B)
discovery.py (7544 B)
enrich_ai.py (5784 B)
excel_outreach.py (11595 B)
notify.py (5446 B)
pdf.py (2415 B)
pdf_report.py (18298 B)
report.py (5839 B)
research.py (9081 B)
scoring.py (3992 B)
sheets_sync.py (5839 B)
__init__.py (84 B)
```

**Root `ls`**
```
.venv/  data/  engine/  exports/  reports/  scripts/  __pycache__/
check_schema.py  config.json  find_powai_leads.py  README.md  run.bat  run.py  search_leads.py  serve.py  start_api.bat  start_api.ps1  start_engine.bat  test_recipients.py
```

> Evidence captured via `shell` (git + cat + ls) per Task 1 Step 1. No secrets included; env values masked to key names only.

---

## 1 — Vision

**Acquisition OS is the revenue engine control plane for WavesCo's founder-led client acquisition loop: discover → enrich → verify → qualify → score → CRM → outreach → response → follow-up → analysis → report → PDF → email → audit.** It turns the standalone Lead Engine (local SQLite `data/leads.db` or remote HTTP `LEAD_ENGINE_API_URL`) and the tenant-scoped Postgres (Neon) platform into a single auditable, controllable system operated from `https://app.wavesco.in` (`waves-c0-app`).

Control Center goal (plan, §Goal): Monitor, Configure, Execute, Pause/Resume, and Analyze the entire Acquisition OS via authenticated APIs with real-time state and `AuditLog` per action. Verified build: Next.js 15.1.6 App Router `apps/web/app/(dashboard)/acquisition/*`, Prisma 6.2.1, Tailwind + shadcn `packages/ui`, Vercel `waves-c0-app` → `app.wavesco.in`. Evidence: `apps/web/package.json:21` `next@15.1.6`, `packages/db/package.json` `prisma@6.2.1`, `vercel inspect` alias `app.wavesco.in` Ready 2026-08-30.

## 2 — Positioning

**For founder-led companies where control matters more than display.** Acquisition OS is an operations console — density, hierarchy, speed — not a generic admin dashboard. Every dashboard section has actionable controls backed by authenticated APIs (`auth() + requireTenantId + withTenantContext`, secrets via `env:VAR`/`credentialRef` server-side only, never to browser). Empty/error states are useful (CTAs, retry, BLOCKED reasons), destructive actions require `ConfirmDialog`, state reflects live backend (RUNNING/PAUSED/FAILED/etc.) via SWR polling (5–30s) and `router.refresh()`, not fake UI state. Verified: `apps/web/components/control/confirm-dialog.tsx` (155 lines), `apps/web/app/(dashboard)/acquisition/page.tsx` uses `AutoRefresh intervalMs={30_000}` + `OverviewLive` polling, per-section `AutoRefresh` 15–30s.

## 3 — Scope

**In-scope (8 operational areas per plan + System, total 10 control surfaces):**
1. **Overview** (`/acquisition`, `GET /api/acquisition/overview`) — pipeline, campaigns, health
2. **Leads** (`/acquisition/leads`, `leads/[nameKey]`, `POST /api/acquisition/leads/export`) — discover/import (via `/generate`), enrich, verify, qualify, score, segment, search/filter, inspect, export (tenant-scoped CSV, max 1000, audit `leads.export`)
3. **Campaigns** (`/acquisition/campaigns`, `POST /api/acquisition/campaigns/[id]/control` launch/pause/resume/stop, state machine draft→scheduled→running→paused→stopped→completed with before/after AuditLog)
4. **Workflows** (`/acquisition/workflows`, `GET/POST /api/acquisition/workflows*`) — n8n `N8N_BASE_URL` + `N8N_API_KEY` server-side, health `/healthz`, manifest fallback `D:\n8n-personal-automations\workflows-manifest.json`; BLOCKED if missing, never fake
5. **Agents** (`/acquisition/agents`, `/api/acquisition/agents*`) — Waves AI Gateway via `ClientAiConfig` + `AiUsageLog`, `credentialRef: env:VAR`
6. **Integrations** (`/acquisition/integrations`, `POST /api/acquisition/integrations/test`) — Lead Engine / Postgres / n8n / Brevo / Ollama matrix with masked Test Connection
7. **Documents** (`/acquisition/reports` → Documents, `POST /api/acquisition/documents/generate`) — `GenerationBatch` pdfPath/excelPath lineage via `engineBatchId` + `ActivityEvent.sourceKey`
8. **Email** (`/acquisition/email` + `/acquisition/outreach`, `POST /api/acquisition/email/templates` CRUD) — templates, preview (lead vars without send), delivery states submitted/approved/sent/failed + `sendError`, Brevo/SMTP approval `decideApprovalAction`
9. **Analytics** (`/acquisition/analytics`, `GET /api/acquisition/analytics`) — acquisition metrics, campaign perf, funnel, response rates, workflow perf, API usage, model/token usage, costs (aggregated tenant-scoped)
10. **System** (`/system` or `acquisition/system`, `GET /api/system/health|logs|audit-logs`) — health cards, logs (last 50 ActivityEvent), errors (failed OutreachEmail/GenerationBatch), jobs (pending FollowUp/batches), queues (outreach pending), DB state (counts), masked config, filterable audit logs

**Out-of-scope boundaries:** Direct browser exposure of provider keys; duplicating Lead Engine corpus (read live, write only `updateLeadOutreachState`); Google Drive integration (no code path → `unavailable`); committing one workspace into another (`wavesco-platform` vs `wavesco-lead-engine` separate).

Inspected contract scope: `modules/acquisition-os@1.0.0` tables `GenerationBatch, Campaign, OutreachEmail, FollowUp, ActivityEvent, LeadResearch, OutreachOrder`, 17 actions, audit true, requiresEnv `LEAD_ENGINE_ROOT, N8N_BASE_URL` (`modules/acquisition-os/module.contract.json:1-36`).

## 4 — Architecture

**End-to-end:** `WAVES → ACQUISITION OS (Acquisition, Enrichment, Qualification, Outreach, Campaigns, Agents, Workflows, Analytics, Document Engine) → app.wavesco.in → CONTROL CENTER (Monitor, Configure, Execute, Pause, Resume, Analyze, Manage) → Postgres Neon (RLS `wavesco_app`) + Lead Engine dual-mode + n8n + Brevo/SMTP + Ollama/AI Gateway`.

Control flow enforced (plan §Global Constraints): `app.wavesco.in → Authenticated Dashboard (middleware.ts guards) → Acquisition OS API (`requireControlAuth` → `requireTenantId` → `withTenantContext`) → Orchestration (agents/workflows/tools) → DB + External APIs`. Dashboard never exposes keys; secrets resolved server-side `env:VAR` / `credentialRef`.

Verified stack: `apps/web/next.config.ts` `transpilePackages: [@wavesco/ui,@wavesco/db,@wavesco/auth,@wavesco/validators]`, `turbo.json:5-27` globalEnv lists `LEAD_ENGINE_*`, `N8N_*`, `DATABASE_URL`, `OPENAI_*`; `apps/web/middleware.ts` auth guard; `apps/web/lib/wavesco/control.ts:1-35` (`requireControlAuth` + `auditControl`); `apps/web/lib/wavesco/lead-engine.ts:1-711` dual-mode local/remote switch `LEAD_ENGINE_MODE`.

```mermaid
flowchart LR
  A[WAVES] --> B[ACQUISITION OS]
  B --> B1[Acquisition]
  B --> B2[Enrichment]
  B --> B3[Qualification]
  B --> B4[Outreach]
  B --> B5[Campaigns]
  B --> B6[Agents]
  B --> B7[Workflows]
  B --> B8[Analytics]
  B --> B9[Document Engine]
  B --> C[app.wavesco.in - CONTROL CENTER]
  C --> C1[Monitor]
  C --> C2[Configure]
  C --> C3[Execute]
  C --> C4[Pause]
  C --> C5[Resume]
  C --> C6[Analyze]
  C --> C7[Manage]
  C --> D[(Postgres Neon - RLS wavesco_app)]
  C --> E[Lead Engine - dual-mode SQLite/HTTP]
  C --> F[n8n - Approval Queue/Email Outbox/Notify Hub]
  C --> G[Brevo / SMTP]
  C --> H[Ollama Cloud / Waves AI Gateway]
```

## 5 — System Diagram

**Platform components (verified at `2026-09-02`):**

```mermaid
flowchart TB
  subgraph Web["apps/web - Next.js 15.1.6 App Router"]
    A1["(dashboard)/acquisition/* - 10 control pages"]
    A2["app/api/acquisition/* - 10 control APIs"]
    A3["app/api/system/* - health/logs/audit-logs"]
    A4["lib/wavesco/control.ts - requireControlAuth/auditControl"]
    A5["lib/wavesco/integrations.ts - getIntegrationsHealth/computeIntegrationStatuses"]
    A6["lib/wavesco/lead-engine.ts - dual-mode: local SQLite / remote HTTP"]
    A7["lib/ai/gateway.ts - wavesAi() per-tenant"]
    A8["lib/wavesco/n8n.ts - n8nBaseUrl/n8nApiKey/getHealth"]
  end
  subgraph DB["packages/db - Prisma 6.2.1 - Postgres Neon"]
    D1["Tenant/User/RefreshToken/VerificationToken"]
    D2["GenerationBatch/Campaign/OutreachEmail/FollowUp"]
    D3["LeadResearch/OutreachOrder/LeadLifecycleEvent/ActivityEvent"]
    D4["Client/OnboardingStep/Project/ProjectTask/Deliverable"]
    D5["IntegrationStatus/ClientAiConfig/AiUsageLog/AuditLog/IdempotencyKey"]
    D6["RLS - wavesco_app role, withTenantContext SET LOCAL app.tenant_id"]
  end
  subgraph Engine["D:\wavesco-lead-engine - Python"]
    E1["data/leads.db - leads, runs tables"]
    E2["engine/*.py - discovery/research/scoring/enrich_ai/excel_outreach/pdf_report/notify/sheets_sync"]
    E3["reports/ + exports/"]
    E4["serve.py - HTTP API (remote mode) GET /stats /leads /facets /candidates /manifests /runs/latest"]
  end
  subgraph Ext["External"]
    X1["n8n - http://localhost:5678 (dev) / N8N_BASE_URL (prod) - /api/v1/workflows, /healthz, /webhook/personal/*"]
    X2["Brevo - BREVO_API_KEY, /api/webhooks/brevo"]
    X3["Ollama Cloud - https://ollama.com/v1 - model gemma4:31b via AI Gateway"]
    X4["Tavily - tavily_depth advanced, google_service_account_json empty"]
    X5["Neon Postgres - DATABASE_URL (pooled wavesco_app) + DIRECT_URL (wavesco migration)"]
  end
  A6 --- E1
  A6 --- E4
  A7 --- X3
  A8 --- X1
  A5 --- D5
  A2 --- D2
  A2 --- D3
  A3 --- D5
  Web --> DB
  Web --> Engine
  Web --> Ext
```

Verified files: `apps/web/lib/wavesco/lead-engine.ts` (apiGet/apiPost, getLeadStats/listLeads/getFacets/selectCampaignCandidates/getLastEngineRun), `apps/web/lib/ai/gateway.ts` (ClientAiConfig→credentialRef→Ollama Cloud), `apps/web/lib/wavesco/n8n.ts` (api + webhook + manifest), `packages/db/prisma/schema.prisma:1-492` 24 models, `turbo.json` globalEnv.

## 6 — Modules

**Deployed modules (verified `modules/`):**
- `acquisition-os@1.0.0` (`modules/acquisition-os/module.contract.json`): entry `app/(dashboard)/acquisition`, requiresEnv `[LEAD_ENGINE_ROOT, N8N_BASE_URL]`, tables `[GenerationBatch, Campaign, OutreachEmail, FollowUp, ActivityEvent, LeadResearch, OutreachOrder]` (7 declared; `LeadLifecycleEvent` + `IntegrationStatus` + `AuditLog` are platform-level but used), permissions `read/create/update/delete` on `acquisition`, audit true, 17 actions: `generateLeadsAction, createCampaignAction, submitCampaignAction, decideApprovalAction, upsertFollowUpAction, updateLeadOutreachAction, resendReportAction, researchLeadAction, checkLeadEmailAction, generateOutreachOrderAction, submitOrderAction, decideOrderAction, cancelOrderAction, batchResearchAction, batchCheckEmailsAction, batchGenerateOrdersAction, batchQueueReadyOrdersAction` (`modules/acquisition-os/module.contract.json:17-35`).
- `automation-os@1.0.0` (`modules/automation-os/module.contract.json`): entry `app/(dashboard)/automation`, requiresEnv `[N8N_BASE_URL]`, tables `[IntegrationStatus]`, permissions `read/admin` on `automation`, audit true, actions `[refreshIntegrationStatusAction]`.
- `client-os@1.0.0` (`modules/client-os/module.contract.json`): entry `app/(dashboard)/clients`, tables `[Client, OnboardingStep, Project, ProjectTask, Deliverable]`, permissions `read/create/update/delete` on `clients`, audit true, actions `[createClientAction, updateClientAction, toggleOnboardingStepAction, createProjectAction, updateTaskStatusAction, setDeliverableStatusAction]`.
- `cafe-crm/cafe-inventory/cafe-leads/cafe-ops/cafe-orders`: directories exist under `modules/` but no `module.contract.json` → not registered as modules (empty scaffolds).

## 7 — Agents

**Agent surfaces (verified `apps/web/lib/ai/gateway.ts`, `apps/web/app/(dashboard)/acquisition/agents/page.tsx`, `GET /api/acquisition/agents`):**

- **ClientAiConfig** (`packages/db/prisma/schema.prisma:460-474`): `id, tenantId @unique, aiEnabled Boolean @default(false), provider String @default(ollama_cloud), baseUrl String?, model String?, credentialRef String?, obsidianRoot String?, config Json?`. Live row example: `wavesco-hq → ollama_cloud / https://ollama.com/v1 / gemma4:31b / env:OPENAI_API_KEY / enabled` (`docs/waves-ai-gateway.md`).

- **Waves AI Gateway** (`apps/web/lib/ai/gateway.ts`): single boundary `wavesAi({ tenantId, operation, input: { prompt, system?, temperature? } }) → { ok, status: completed|disabled|unconfigured|failed, text?, model?, provider?, usage?, error? }`. Operations: `generate|analyze|research|enrich|summarize`. Resolution chain per call: `tenantId → ClientAiConfig → credentialRef (env:VAR) → provider adapter → response` then `AiUsageLog` row.

- **Provider adapters** (`apps/web/lib/ai/gateway.ts`): `ollama_cloud` via OpenAI-compatible `baseUrl/chat/completions` (registry `ADAPTERS`); extension point ready for `openai/anthropic/gemini/local_ollama`.

- **AiUsageLog** (`packages/db/prisma/schema.prisma:478-492`): `tenantId, operation, provider, model, status, inputTokens/outputTokens, estimatedCostUsd, latencyMs, error, createdAt`.

- **Engine enrichment agent** (`D:\wavesco-lead-engine\engine\enrich_ai.py` 5784 B, `config.json: openai_model gemma4:31b, tavily_depth advanced`): calls `/api/ai/gateway` with `LEAD_ENGINE_GATEWAY_TOKEN` pinned to `WAVESCO_ENGINE_TENANT`, fields updated on `LeadResearch` (`researchSnapshot, personalization_context, aiModel, enrichmentStatus`).

- **Outreach planner agent** (OutreachOrder.plannerModel, AiUsageLog.operation enrich): generates `subject/body/followupPlan` on `LeadResearch → OutreachOrder`.

- **Control plane:** `apps/web/app/(dashboard)/acquisition/agents/page.tsx` lists agents with enable/disable (`aiEnabled` toggle, masked credential), activity (AiUsageLog last 20), tool usage, failures, limits (rate/token); `POST /api/acquisition/agents/control` writes `AuditLog` with before/after; if gateway unreachable → FAIL, not fake.

## 8 — Workflows

**Workflow surfaces (verified `apps/web/app/(dashboard)/acquisition/workflows/page.tsx`, `GET /api/acquisition/workflows`, `POST /api/acquisition/workflows/[id]/control`, `apps/web/lib/wavesco/n8n.ts`):**

- **n8n instance:** base `process.env.N8N_BASE_URL` (trimmed), key `N8N_API_KEY` header `X-N8N-API-KEY` server-side only; never to browser. Helpers: `n8nBaseUrl()/n8nApiKey()`, `api(path)` → `ApiResult<T>`, `getWorkflows() GET /api/v1/workflows?limit=100`, `getExecutions(limit) GET /api/v1/executions`, `getHealth() GET /healthz` (`apps/web/lib/wavesco/n8n.ts:20-60`).

- **Manifest fallback:** `readAutomationManifest()` reads `N8N_MANIFEST_PATH` or `D:\n8n-personal-automations\workflows-manifest.json` (suite, instance, generated_at, all_active, workflows[] { name, id, trigger, purpose }) — shown only as labelled inventory when REST API unavailable, never as live state.

- **Control actions via API:** `POST /api/acquisition/workflows/[id]/control { action: enable|disable|execute|retry }` — proxies to n8n REST, audits `workflow.enable/disable/execute` with `before/after` to `AuditLog`; if `N8N_BASE_URL` missing → `{ status: "BLOCKED", reason: "N8N_BASE_URL missing" }`, UI shows BLOCKED/RUNNING/PAUSED/FAILED via `StatusPill`, not fake success. Tests mock missing → BLOCKED (`apps/web/tests/workflows.test.ts`).

- **Engine workflows:** `Generation` (`engine/discovery.py` batch_size 25, max_candidates 60 → `GenerationBatch` queued→finished, linkage `engineBatchId`), `Campaign launch` (`submitCampaignAction` + `selectCampaignCandidates`), `Approval` (`submitApproval POST /webhook/personal/approval`, `decideApproval GET /webhook/personal/approval-decide?id=&decision=approve|reject` → `decideApprovalAction`), `Outreach send` (`OutreachOrder READY_FOR_APPROVAL→PENDING→APPROVED→SENT→DELIVERED/FAILED`, `decideOrderAction/cancelOrderAction`, `OutreachEmail` queue submitted/approved→sent/failed via Brevo/SMTP), `Follow-up` (`upsertFollowUpAction`, `FollowUp.dueAt`, `followupPlan` on `OutreachOrder`).

- **Observability:** `ActivityEvent.sourceKey` ties workflow execution to `GenerationBatch.engineBatchId`; `LeadLifecycleEvent.stage/status`; Analytics workflow perf aggregates `ActivityEvent` by type + `IntegrationStatus` by state.

## 9 — Tools

**Engine Python tools (`D:\wavesco-lead-engine\engine/` verified `ls` 2026-09-02):**

| Tool | File | Purpose |
|------|------|---------|
| `discovery` | `discovery.py` 7544 B | Candidate search via geography tiers + category + corporate blocklist |
| `research` | `research.py` 9081 B | Per-lead research snapshot → `LeadResearch` |
| `scoring` | `scoring.py` 3992 B | lead_score/tier assignment |
| `enrich_ai` | `enrich_ai.py` 5784 B | Calls `/api/ai/gateway` enrich (Tavily + Ollama) → `personalization_context, aiModel` |
| `excel_outreach` | `excel_outreach.py` 11595 B | OutreachOrder → XLSX via `exports/` |
| `pdf` | `pdf.py` 2415 B | Lightweight PDF helper |
| `pdf_report` | `pdf_report.py` 18298 B | Batch report PDF via `reports/` → `GenerationBatch.pdfPath` |
| `report` | `report.py` 5839 B | Batch manifest + ActivityEvent emission |
| `sheets_sync` | `sheets_sync.py` 5839 B | Google Sheets sync (mode `local` → XLSX mirror) |
| `notify` | `notify.py` 5446 B | n8n Notify Hub bridge `POST /webhook/personal/wavesco-leads` + direct Telegram fallback, `telegramDeliveryStatus` |
| `db` | `db.py` 10678 B | SQLite `leads.db` read/write + `runs` table |
| `config` | `config.py` 5504 B | `config.json` loader, geography/categories/blocklist |

**Platform TypeScript tools (`apps/web/lib/wavesco/`):** `lead-engine.ts` (`getLeadStats, listLeads, getFacets, getCountsBy, updateLeadOutreachState, selectCampaignCandidates, getLastEngineRun, listBatchManifests, fetchManifestFile, getScheduledTaskInfo, startGenerationRemote`), `n8n.ts` (`getWorkflows, getExecutions, getHealth, submitApproval, decideApproval, readAutomationManifest`), `ai/gateway.ts` (`wavesAi, estimateCost`), `integrations.ts` (`getIntegrationsHealth, computeIntegrationStatuses, maskUrl`), `control.ts` (`requireControlAuth, auditControl`).

## 10 — API Integrations

**External integration inventory (verified code + `getIntegrationsHealth` + `.env.example`):**

| Integration | Key | Transport | Verified surface | Health probe |
|-------------|-----|-----------|------------------|--------------|
| **Lead Engine (dual-mode)** | `LEAD_ENGINE_ROOT` (local) / `LEAD_ENGINE_API_URL+TOKEN` (remote), `LEAD_ENGINE_MODE` | Local: `node:sqlite` read `D:\wavesco-lead-engine\data\leads.db` + spawn CLI; Remote: `fetch` Bearer `apiGet/apiPost` to `serve.py` (`/health`, `/stats`, `/leads`, `/facets`, `/groupby`, `/candidates`, `/manifests`, `/runs/latest`, `/generate`, `/outreach`) | `lead-engine.ts:27-83` mode()/apiUrl()/apiGet/apiPost | `leadEngineHealth()` → `ok/BLOCKED/error`, `remoteAvailability GET /health` |
| **n8n** | `N8N_BASE_URL`, `N8N_API_KEY` (server-only), `N8N_MANIFEST_PATH` | REST `GET /api/v1/workflows`, `GET /api/v1/executions`, `GET /healthz`, webhooks `POST /webhook/personal/approval` | `n8n.ts:20-60` | `n8nHealth() → BLOCKED if missing` |
| **Brevo/SMTP** | `BREVO_API_KEY` + webhook `/api/webhooks/brevo`, `SMTP_*` via Resend | `POST /api/acquisition/email/templates` + outbox via n8n `Personal - SMTP` | `brevoHealth() → BLOCKED if missing` |
| **Postgres Neon** | `DATABASE_URL` (pooled `wavesco_app`, `pgbouncer=true`), `DIRECT_URL` | Prisma `@prisma/client 6.2.1`, RLS `wavesco_app` | `dbHealth() SELECT 1` |
| **Ollama / Waves AI Gateway** | `OPENAI_API_KEY/BASE_URL/MODEL`, `LEAD_ENGINE_GATEWAY_TOKEN`, `ClientAiConfig.credentialRef = env:VAR` | `gateway.ts wavesAi() → https://ollama.com/v1/chat/completions` | `aiGatewayHealth(tenantId)` |
| **Telegram Notify Hub** | `TELEGRAM_BOT_TOKEN`, `n8n_bridge_url http://localhost:5678/webhook/personal/wavesco-leads` | `notify.py` bridge + direct fallback | `telegram_notify connected/disconnected` |
| **Tavily** | `tavily_depth advanced` | Inside `enrich_ai.py` | Via ActivityEvent |
| **Google Sheets** | `google_service_account_json: ""` empty | `sheets_sync.py` mode `local` → XLSX mirror | disconnected |
| **Google Drive** | None | No code path | unavailable |
| **Obsidian REST** | `OBSIDIAN_REST_URL https://127.0.0.1:27124`, `OBSIDIAN_API_KEY` | `apps/web/app/api/obsidian/[...path]` proxy | masked health |

Live Vercel (`vercel env ls` 2026-09-02): `DATABASE_URL, DIRECT_URL, NEXTAUTH_URL, AUTH_SECRET, JWT_SECRET, LEAD_ENGINE_* (remote), OPENAI_*` are SET; `N8N_BASE_URL, BREVO_API_KEY` missing → BLOCKED in production.

## 11 — API Keys

**Inventory by name only (never values — `vercel env ls` shows Hidden, `.env.example` shows empty templates):**

| Key / Ref | Source | Production (Vercel `waves-c0-app`) | Local `.env.example` (template empty → BLOCKED) | Required by |
|-----------|--------|------------------------------------|--------------------------------------------------|-------------|
| `DATABASE_URL` | Neon pooled `wavesco_app` | SET | `postgresql://wavesco_app:...@localhost:5433/wavesco?pgbouncer=true` template → SET locally | `datasource db.url`, `dbHealth SELECT 1` |
| `DIRECT_URL` | Neon migration `wavesco` | SET | `postgresql://wavesco:wavesco@localhost:5433/wavesco` template → SET locally | `prisma migrate` |
| `AUTH_SECRET` / `NEXTAUTH_SECRET` / `JWT_SECRET` | Auth.js + jose | SET | `""` → `pnpm generate:secrets` | `auth.ts`, `middleware.ts` |
| `N8N_BASE_URL` | n8n instance | BLOCKED (not in `vercel env ls`) | `""` → BLOCKED | `n8n.ts:n8nBaseUrl()` → `BLOCKED: N8N_BASE_URL missing` |
| `N8N_API_KEY` | n8n API | BLOCKED | `""` → BLOCKED | `n8nApiKey()` header `X-N8N-API-KEY` |
| `LEAD_ENGINE_ROOT` | Local SQLite root | N/A (remote in prod) | `D:\wavesco-lead-engine` default → `data/leads.db` True | `leadEngineRoot()` |
| `LEAD_ENGINE_MODE` | `local`/`remote` | SET → `remote` | `local` | `mode()` switch |
| `LEAD_ENGINE_API_URL` / `LEAD_ENGINE_API_TOKEN` | `serve.py` HTTP | SET Hidden | `""` → BLOCKED if remote | `apiUrl()` Bearer |
| `LEAD_ENGINE_GATEWAY_TOKEN` / `WAVESCO_ENGINE_TENANT` | AI Gateway pinned engine | SET Hidden | `""` | `gateway.ts` bearer guard |
| `RESEND_API_KEY` / `SMTP_*` | Resend/Nodemailer | UNKNOWN → likely BLOCKED | `""` templates | auth email |
| `BREVO_API_KEY` | Brevo | BLOCKED | `""` → BLOCKED | `brevoHealth() → BLOCKED` |
| `OPENAI_API_KEY/BASE_URL/MODEL` | Ollama Cloud | SET | `""` → BLOCKED | `resolveCredential(env:OPENAI_API_KEY)` |
| `OBSIDIAN_REST_URL` / `OBSIDIAN_API_KEY` | Local REST API | UNKNOWN → likely BLOCKED prod | `https://127.0.0.1:27124` / `""` | obsidian proxy |
| `TAVILY_API_KEY` | Tavily | UNKNOWN (not in `.env.example`; `tavily_depth advanced` implies key elsewhere) → BLOCKED unless in engine env | — | `enrich_ai.py` |

**Rule:** any key with empty template in `.env.example` and missing in `vercel env ls` is marked **BLOCKED** above and surfaced in UI as `error/missing/BLOCKED`, never fake `ok`. Masking: `maskUrl` for URLs, `redact` first2***last2 for secrets.

## 12 — Environment Variables

**Full env inventory (from `.env.example:1-86` + `turbo.json:4-27` globalEnv + `vercel env ls`):**

| Var | Required? | Default | Vercel `waves-c0-app` prod | Local dev |
|-----|-----------|---------|----------------------------|-----------|
| `NODE_ENV` | app | `development` | `production` | `development` |
| `NEXT_PUBLIC_APP_NAME` | — | `WavesCo` | — | `WavesCo` |
| `NEXTAUTH_URL` | auth | `http://localhost:3000` | SET `https://app.wavesco.in` | `http://localhost:3000` |
| `AUTH_SECRET`, `NEXTAUTH_SECRET`, `JWT_SECRET` | REQUIRED ≥32 | `""` → `pnpm generate:secrets` | SET | generated |
| `ACCESS_TOKEN_TTL` / `REFRESH_TOKEN_TTL` | — | `15m` / `30d` | — | `15m/30d` |
| `DATABASE_URL` | REQUIRED | `postgresql://wavesco_app:...@localhost:5433/wavesco?pgbouncer=true` | SET | docker :5433 |
| `DIRECT_URL` | REQUIRED | `postgresql://wavesco:wavesco@localhost:5433/wavesco` | SET | docker :5433 |
| `RESEND_API_KEY`, `SMTP_*` | magic-link | `""` | UNKNOWN | fill if testing email |
| `N8N_BASE_URL` | acquisition-os, automation-os | `""` → BLOCKED | BLOCKED | `http://localhost:5678` if n8n local |
| `N8N_API_KEY` | REST reads | `""` → BLOCKED | BLOCKED | Create in n8n Settings |
| `N8N_MANIFEST_PATH` | — | `D:\n8n-personal-automations\workflows-manifest.json` | UNKNOWN | fallback |
| `LEAD_ENGINE_MODE` | dual-mode | `local` | `remote` SET | `local` unless remote |
| `LEAD_ENGINE_ROOT` | local | `D:\wavesco-lead-engine` | N/A (remote) | Path exists True |
| `LEAD_ENGINE_API_URL/TOKEN` | remote | `""` | SET Hidden | remote only |
| `WAVESCO_ENV_PATH` | cross-workspace | `""` | — | engine env fallback |
| `OPENAI_API_KEY/BASE_URL/MODEL` | AI Gateway | `""`/`https://api.openai.com/v1`/`gpt-4o-mini` | SET (`https://ollama.com/v1`/`gemma4:31b`) | `https://ollama.com/v1`/`gemma4:31b` |
| `OBSIDIAN_REST_URL/API_KEY` | Obsidian | `https://127.0.0.1:27124`/`""` | UNKNOWN | `127.0.0.1:27124` |
| `LEAD_ENGINE_GATEWAY_TOKEN/WAVESCO_ENGINE_TENANT` | internal AI | `""` | SET Hidden | must match |
| `ENABLE_BILLING` | flag | `false` | `false` | `false` |

**Vercel dashboard:** `team_4yzMS5Im7cXbCms5w6U4iWsR / prj_4MAbxJuodhhBJUpEhCH8MQuCpMBQ` (`apps/web/.vercel/project.json`), build `pnpm --filter @wavesco/db db:generate && next build && node scripts/copy-prisma-engine.mjs` (`vercel.json`). Missing required envs surface as `BLOCKED` per `getIntegrationsHealth`; local dev `cp .env.example .env` + `pnpm generate:secrets` + `docker compose up -d`.

## 13 — Database Architecture

**Prisma 6.2.1 + Postgres (Neon) — RLS-enforced multitenancy (verified `packages/db/prisma/schema.prisma:1-492`):**

- `generator client: prisma-client-js` output `../src/generated/client`; `datasource db: postgresql` `url = env(DATABASE_URL)` (pooled `wavesco_app`, `pgbouncer=true`) + `directUrl = env(DIRECT_URL)` (migration role `wavesco` owns tables).

- **RLS:** runtime role `wavesco_app` does NOT own tables, so row-level security (applied in migrations `20260825010000_wavesco_product_models`) is enforced. App never queries outside `withTenantContext(tenantId, tx => ...)` which `SET LOCAL app.tenant_id`.

- **Count:** 24 models: `Tenant, User, RefreshToken, Module, TenantModule, AuditLog, IdempotencyKey, VerificationToken, GenerationBatch, Campaign, OutreachEmail, FollowUp, LeadResearch, OutreachOrder, LeadLifecycleEvent, ActivityEvent, Client, OnboardingStep, Project, ProjectTask, Deliverable, IntegrationStatus, ClientAiConfig, AiUsageLog`.

- **Lead Engine local mirror:** SQLite `D:\wavesco-lead-engine\data\leads.db` (tables `leads, runs`) — never duplicated into Postgres; `lead-engine.ts` reads live (`DatabaseSync busy_timeout 3000`), writes only `updateLeadOutreachState`.

- **Indexes:** tenant-scoped (`@@index([tenantId, status])` on batch/campaign/email), `@@unique([tenantId, leadKey])` on LeadResearch, `@@unique([tenantId, leadKey, version])` on OutreachOrder, `@@unique([tenantId, key])` on IntegrationStatus.

- **Instance/infra:** Neon pooler, Vercel `iad1`, local `docker-compose.yml` PostgreSQL 16 on `:5433`.

## 14 — Data Models

**Tenant-scoped data models (field-level, verified `packages/db/prisma/schema.prisma:146-492` and EngineLead):**

- `Tenant`: `id cuid PK, name, slug @unique, plan starter, status active`.
- `User`: `id, tenantId FK, email (unique per tenant), role owner`.
- `RefreshToken/VerificationToken`: HS256 tokenHash / Auth.js magic link.
- `Module/TenantModule`: `Module id/name@unique/displayName/version/contractPath` ← `TenantModule status enabled`.
- `AuditLog`: `id, tenantId?, userId?, action, model, recordId?, before/after/metadata Json, createdAt`.
- `GenerationBatch`: `id, tenantId, requestId @unique, params Json, status queued, stage, requestedCount/resultLeadCount/emailReadyCount, engineBatchId, pdfPath/excelPath, logTail/error`.
- `Campaign`: `id, tenantId, name, location/category/tier, status draft (draft|scheduled|running|paused|stopped|completed), sendingLimit, eligibleSnapshot Json`.
- `OutreachEmail`: `id, tenantId, leadKey, business, email, subject/body, status draft (draft/submitted/approved/sent/failed), approvalId/messageId/error`.
- `FollowUp`: `id, tenantId, leadKey, business, dueAt, status pending, channel email, followUpNumber 1`.
- `LeadResearch`: `id, tenantId, leadKey @@unique, engineLeadId, business, category/area/city, website/instagram, rating/reviews, tier/leadScore, digitalPresence/problem/opportunity/serviceFit/angleSeed, contactName/role, email, sourceUrls Json, verification`.
- `OutreachOrder`: `id, tenantId, version 1, leadKey @@unique([tenantId,leadKey,version]), businessName, email VERIFIED, researchSnapshot Json, subject/body, followupPlan Json, status READY_FOR_APPROVAL (READY_FOR_APPROVAL→PENDING→APPROVED→SENT→DELIVERED/FAILED, REJECTED/CANCELLED), aiEnabled/aiModel/enrichmentStatus/selectedService/personalizationContext`.
- `LeadLifecycleEvent`: `id, tenantId, leadKey, batchId, stage, status, reason, aiProvider/aiModel, emailStatus, eligibility, orderId FK`.
- `ActivityEvent/IntegrationStatus/ClientAiConfig/AiUsageLog`: as per schema 348-492.

**EngineLead (SQLite):** `id, business, category, area, city, phone/whatsapp/email/website/instagram, rating, reviews, digital_score/lead_score, tier, problem/opportunity/reason/outreach_angle, source_urls, verification, site_class, status, email_status, date_contacted, reply_status, opted_out/bounced, next_follow_up, name_key, batch_id, first_discovered/last_researched, ai_* fields`.

## 15 — Authentication

**Auth stack (verified `apps/web/lib/auth.ts`, `middleware.ts`, `next-auth@5.0.0-beta.25`):**

- **Provider:** Auth.js v5 (`auth()` from `@/lib/auth`; config reads `AUTH_SECRET ?? NEXTAUTH_SECRET`). `JWT_SECRET` signs `jose HS256` tokens; `ACCESS_TOKEN_TTL 15m`, `REFRESH_TOKEN_TTL 30d`.

- **Flow:** Magic-link + password (Resend + SMTP fallback). `User @@unique([tenantId,email])`, `RefreshToken tokenHash @unique`, `VerificationToken @@id([identifier,token])`.

- **Tenant guard:** `requireTenantId(session)` throws `UNAUTHORIZED` if `session?.user?.tenantId` missing; routes catch and return `401`.

- **Control helper:** `apps/web/lib/wavesco/control.ts:3-14` `requireControlAuth() => { session, tenantId, userId }` wrapping `auth() + requireTenantId`; used by all 10 control APIs.

- **Middleware:** `apps/web/middleware.ts` guards `(dashboard)/*`; public `/` + `/login` + `/api/auth/*` exempt.

- **RLS binding:** after auth, every DB access goes `withTenantContext(tenantId, tx => tx.*)` which `SET LOCAL app.tenant_id`.

Tests verify 401 without auth on every control route (100+ assertions).

## 16 — Permissions

**Contract-level RBAC (verified `modules/acquisition-os/module.contract.json:10-15`, `TenantModule`):**

- **Acquisition OS contract:** `permissions: [ {read, acquisition}, {create, acquisition}, {update, acquisition}, {delete, acquisition} ]` (4 permisos), `audit: true`. Checked via `GET /api/modules/registry` + `GET /api/modules/contract/[name]`.

- **Tenant enablement:** `TenantModule status enabled|disabled`, gated by `tsx scripts/enable-module.ts`.

- **User role:** `User.role @default owner` (single active role today).

- **Route enforcement:** each control API enforces `requireControlAuth` before any write; `audit true` means every state-changing action writes `AuditLog` with `tenantId/userId/action/model/recordId/before/after`. Example: `POST /api/acquisition/campaigns/[id]/control { action: launch }` validates state machine before mutation and emits `auditControl({ action: "campaign."+action, model:"Campaign", before, after })`.

- **Other modules:** `automation-os: read/admin on automation`, `client-os: read/create/update/delete on clients`.

## 17 — Security

**Security posture (verified code + schema + ops docs):**

- **RLS tenant isolation:** Postgres RLS on runtime role `wavesco_app`; `withTenantContext SET LOCAL app.tenant_id`. Verified isolation in `tests/agents.test.ts`.

- **Secrets never to browser/DB:** `ClientAiConfig.credentialRef` stores `env:VARNAME` only (resolved server-side `resolveCredential` in `gateway.ts:36-43`); raw keys never persisted, never returned by `/api/acquisition/agents` (masked `***`). All `N8N_API_KEY, BREVO_API_KEY, DATABASE_URL` accessed via `process.env` server-side; page `System` masks via `maskUrl`/`redact`.

- **Audit trail:** every control action writes `AuditLog { tenantId, userId, action, model, recordId, before, after, metadata }` via `auditControl()`; queried filterable `GET /api/system/audit-logs`.

- **HTTP surface hardening:** `next-auth` CSRF, `middleware.ts` tenant guard, `NextResponse.json 401` on `UNAUTHORIZED`/`NEXT_REDIRECT`, `cache: no-store` on control fetches.

- **Idempotency:** `IdempotencyKey @@unique([tenantId, scope, key])`.

- **Env discipline:** `git status/diff --cached` check for secrets; deployment checks `git diff --stat` shows no `.env` diff.

- **Known gaps:** Google Drive absent; `TAVILY_API_KEY` not in `.env.example` inventory; `BREVO_API_KEY`/`N8N_API_KEY` intentionally BLOCKED prod until set in Vercel dashboard.

## 18 — Lead Lifecycle

**Lead lifecycle (verified `leads` table → `LeadResearch` → `LeadLifecycleEvent`):**

```
Engine leads.db (discovery) → Candidate scoring (lead_score → tier A/B/C) → LeadResearch snapshot (unique [tenantId, leadKey], verification, tier, angleSeed) → LeadLifecycleEvent stage=research status=enriched → eligibleSnapshot
```

- **Discovery:** `engine/discovery.py` ingests candidates per `config.json: categories[8], geography tier2(Vashi/Nerul/Ulwe/...)→city Navi Mumbai, corporate_chain_blocklist[16]`.

- **Enrichment:** `engine/research.py` + `enrich_ai.py` (Tavily `advanced` + Ollama `gemma4:31b` via `/api/ai/gateway`) fill `LeadResearch.digitalPresence/problem/opportunity/serviceFit/angleSeed/contactName/personalization_context`.

- **Scoring/Qualification:** `engine/scoring.py` computes `lead_score, tier, qualification`; persisted `LeadLifecycleEvent.eligibility`.

- **Control plane:** `/acquisition/leads` search/filter (`search/tier/category/city/outreach/verification/sort`, 25/page), facets via `getFacets()`, inspect drawer `leads/[nameKey]`, `researchLeadAction/checkLeadEmailAction/batch*` (audit on enrich/verify).

- **Observability:** per-stage `LeadLifecycleEvent { stage, status, reason, aiProvider/aiModel, emailStatus, eligibility, orderId }`.

## 19 — Acquisition Lifecycle

**Acquisition (generation) lifecycle (verified `GenerationBatch` + `runs`):**

```
Request (requestedCount) → GenerationBatch status=queued stage=requested → engine discovery+runs insert → Scoring/research loop → runs.added/discovered → Report generation (report.py + pdf_report.py + excel_outreach.py) → GenerationBatch completed|failed, resultLeadCount/emailReadyCount, pdfPath/excelPath, engineBatchId, logTail/error
```

- **Platform state:** `GenerationBatch` (`requestId @unique, status queued, stage, requestedCount, resultLeadCount, emailReadyCount, engineBatchId, pdfPath/excelPath, logTail/error`). `LeadLifecycleEvent.batchId` ties each lead event to batch.

- **Engine state:** SQLite `runs` (`id, batch_id, status, added, discovered, report_path, telegram_status, started_at, finished_at`) read via `getLastEngineRun()`.

- **Control plane:** `/acquisition/generate` (Generate Leads card), `POST /api/acquisition/documents/generate`, `startGenerationRemote()` for remote mode; before/after audited.

- **Scheduling:** Windows Task Scheduler `WavesCo Lead Engine` (`getScheduledTaskInfo` via PowerShell; cached 30s; `null` in remote mode).

- **Artifacts:** `listBatchManifests()` reads `data/runs/*.json` (`batchId, generatedAt, leadCount, emailReadyCount, pdfPath, excelPath, telegramDeliveryStatus`), also via remote `GET /manifests`.

## 20 — Outreach Lifecycle

**Outreach lifecycle (verified `OutreachOrder` + `OutreachEmail` + n8n Approval Queue/Email Outbox):**

```
LeadResearch (VERIFIED email) → generateOutreachOrderAction → OutreachOrder READY_FOR_APPROVAL → submitOrderAction → PENDING, approvalId → n8n POST /webhook/personal/approval → Approval Queue → decideOrderAction/decideApprovalAction approve|reject → Email Outbox → OutreachEmail submitted→approved→sent (messageId) / failed (error, sendError) → OutreachOrder SENT → deliveryStatus (Brevo webhook) → replyStatus
```

- **Eligibility:** `selectCampaignCandidates({ location, category, tier })` reads corpus `email VERIFIED, NOT opted_out, NOT bounced, NOT date_contacted` → preview `eligibleSnapshot`.

- **Batch orchestration:** `batchResearchAction, batchCheckEmailsAction, batchGenerateOrdersAction, batchQueueReadyOrdersAction` chain behind `/acquisition/pipeline`.

- **Control plane:** `/acquisition/campaigns` (create/configure/launch/pause/resume/stop with state-machine + AuditLog), `/acquisition/outreach` + `/pipeline` (order queue, delivery tab), `/acquisition/email` template CRUD + preview. All gated `requireControlAuth`.

- **Delivery duality:** n8n Email Outbox (`Personal - SMTP`) for single sends; Brevo (`BREVO_API_KEY`) for bulk API + `POST /api/webhooks/brevo` handling bounces/replies → `updateLeadOutreachState` mirrors back to `leads.db`.

- **Opt-out/compliance:** `opted_out`/`bounced` flags, `POST /api/unsubscribe`, reply handling `reply_status` excluded `none/no reply/no`.

## 21 — Follow-up Lifecycle

**Follow-up lifecycle (verified `FollowUp` + `OutreachOrder.followupPlan`):**

```
OutreachOrder.sentAt → followupPlan Json (steps [{ dueAt, channel=email }]) → upsertFollowUpAction → FollowUp { leadKey, business, dueAt, status=pending, channel email, followUpNumber 1.., outreachOrderId FK } → pending queue → executor decides → completed (completedAt), next followUp incremented
```

- **Schema:** `FollowUp @@index([tenantId,status,dueAt])`, `dueAt DateTime, status pending|completed, note?, channel email, followUpNumber 1`.

- **Batch:** `followupPlan` JSON array on `OutreachOrder` per version; `upsertFollowUpAction` refreshes in place.

- **Control plane:** `/acquisition/follow-ups` table `pending/overdue/completed`, metrics in Analytics `followUpsPending`. System Jobs section shows `pending FollowUps (dueAt asc, take 20)`.

- **Observability:** `LeadLifecycleEvent` records `stage followup status pending|sent reason` with `orderId/approvalId`.

## 22 — Reporting Lifecycle

**Reporting lifecycle (verified `GenerationBatch` + `ActivityEvent` + `engine/report.py`):**

```
GenerationBatch queued → engine batch_id (engineBatchId) → report.py + pdf_report.py + excel_outreach.py produce artifacts → GenerationBatch completed|failed, pdfPath/excelPath, resultLeadCount/emailReadyCount → ActivityEvent type generation + IntegrationStatus lastOkAt → Notify Hub delivers (telegramDeliveryStatus)
```

- **Artifacts:** `GenerationBatch.pdfPath` (via `pdf_report.py` 18298 B), `excelPath` (via `excel_outreach.py`), local `reports/*.pdf`, `exports/*.xlsx`. Remote: `fetchManifestFile(batchId, pdf|xlsx)` streams via `GET /manifests/{id}/file`.

- **Manifests:** `listBatchManifests()` reads `data/runs/*.json` (`batchId, generatedAt, leadCount, emailReadyCount, pdfPath, excelPath, telegramDeliveryStatus`). Sorted `generatedAt desc`.

- **Control plane:** `/acquisition/reports` (Documents — table with generate/download, history, workflow lineage via `engineBatchId` + `sourceKey`), `POST /api/acquisition/documents/generate { batchId }` validates `GenerationBatch`, writes `AuditLog`.

- **Delivery:** `resendReportAction` re-triggers `notify.py` bridge; `GET /api/reports/[batch]/file` streams with RLS.

- **Error surfacing:** page shows `error` column for failed batches; retry via Generate.

## 23 — PDF Generation

**PDF generation (verified `engine/pdf.py` 2415 B, `engine/pdf_report.py` 18298 B, `reports/`):**

- **Engine path:** `engine/pdf_report.py` renders batch report PDF (cover, summary stats, tier breakdown, top leads table) using Python report stack; `engine/pdf.py` helper. Inputs: `BatchManifest { batchId, leadCount, emailReadyCount }` + `leads.db` rows. Output `reports/{batchId}.pdf`.

- **Platform path:** `GenerationBatch` stores `pdfPath String?` + `engineBatchId` lineage; `listBatchManifests()/getBatchManifest(batchId)` resolves paths; remote `fetchManifestFile` proxies via `GET /manifests/{id}/file?type=pdf`.

- **Control plane:** `POST /api/acquisition/documents/generate` → `auditControl`; System `errors` shows failed `GenerationBatch.error`; `/acquisition/reports` history drawer links workflow lineage via `engineBatchId` → `ActivityEvent.sourceKey`.

- **Status:** Happy path verified locally via `reports/` presence when `data/runs/*.json` exists; empty tenant shows empty state with CTA `Generate`, not error. Remote mode requires `LEAD_ENGINE_API_URL` → `BLOCKED` if missing.

- **Design:** download via signed URL or direct with RLS (file routes `app/api/reports/[batch]/file/route.ts` check `auth() + withTenantContext`).

## 24 — Email System

**Email system (verified `OutreachEmail` + `OutreachOrder` + Brevo + n8n + Resend/SMTP):**

- **Models:** `OutreachEmail status draft→submitted→approved→sent (messageId) / failed (error), approvalId` + `OutreachOrder status READY_FOR_APPROVAL→PENDING→APPROVED→SENT→DELIVERED/FAILED (deliveryStatus, replyStatus, sendError, senderIdentity, aiEnabled)`.

- **Campaign → email linkage:** `Campaign { sendingLimit, eligibleSnapshot }` → `OutreachEmail.campaignId`, `FollowUp.outreachEmailId`.

- **Approval handoff:** `decideApprovalAction({ approvalId, decision })` proxies `n8n decideApproval(id, decision)` which hits `GET /webhook/personal/approval-decide`; approval moves OutreachEmail to Email Outbox dispatch. Every decision writes `AuditLog`.

- **Delivery:** Two paths: (1) **n8n Email Outbox** (`Personal - SMTP`) for single sends; (2) **Brevo** (`BREVO_API_KEY`) for bulk API + `POST /api/webhooks/brevo` handling bounces/replies → `updateLeadOutreachState` mirrors back to `leads.db`. System `queueDepth = OutreachEmail pending` count.

- **Templates:** `POST /api/acquisition/email/templates` CRUD tenant-scoped, `preview` renders with lead vars without sending.

- **Config:** Sending integration key lives server-side; `POST /api/acquisition/integrations/test { key: brevo }` tests with masked handling (never leaks key). Dev SMTP fallback `SMTP_HOST localhost:587` via Nodemailer when `RESEND_API_KEY` unavailable.

- **Blockage:** Brevo not in `vercel env ls` → `BLOCKED: BREVO_API_KEY missing` until set; pages still render empty state, not 500.

## 25 — Design System

**Design system (verified `packages/ui`, `apps/web/components/command/primitives.tsx`, Tailwind):**

- **Stack:** Tailwind CSS 3.4.17 + shadcn `packages/ui` (`@wavesco/ui`), `tailwind.config.ts`. Primitives: `MetricCard, SectionHeader, StatusPill` used across all 10 control pages; `StatusPill` variants `live/running/connected → emerald, error/failed → red, paused → amber, unavailable/BLOCKED → zinc`.

- **Control-specific:** `apps/web/components/control/confirm-dialog.tsx` (155 lines), `AutoRefresh intervalMs={15000|30000}` (`router.refresh()` periodic).

- **UX principles:** serious operations console — density (4–5 columns grids), hierarchy (SectionHeader + StatusPill + AutoRefresh), responsiveness (sm:grid-cols-2 lg:grid-cols-4), obvious state (pill color + live count), minimal clicks (control bar Discover/Import/Export/Segment), safe destructive (confirm with before/after), useful empty/error states (dashed borders, CTAs Retry/Generate Leads).

- **Tokens:** `MetricCard value` tabular-nums, `detail` 11-px muted; masked env via `maskUrl` + `redact`.

## 26 — Outputs — Client-Facing

**Client-facing outputs (verified `reports/`, `exports/`, `OutreachOrder` subjects):**

- **Batch report PDF:** `GenerationBatch.pdfPath` + `reports/{batchId}.pdf` via `engine/pdf_report.py`. Download via `GET /api/reports/[batch]/file` (RLS).

- **Outreach pack XLSX:** `GenerationBatch.excelPath` + `exports/{batchId}.xlsx` via `engine/excel_outreach.py` (business, category, area/city, tier, rating/reviews, email/website, opportunity, outreach_angle).

- **Cold emails:** `OutreachOrder.subject/body` + `OutreachEmail.subject/body` personalized from `LeadResearch.researchSnapshot + opportunity + outreachAngle`. Template vars `{{business}} {{category}} {{city}} {{tier}}` rendered server-side.

All outputs tenant-scoped and downloadable only after `requireControlAuth`; PDFs audited (`resendReportAction`).

## 27 — Outputs — Internal

**Internal / ops outputs (verified `AuditLog`, `ActivityEvent`, `LeadLifecycleEvent`, `AiUsageLog`, `IntegrationStatus`, `exports/`):**

- **ActivityEvent feed:** last 50 shown on `/system` Logs, sourced `withTenantContext → findMany orderBy createdAt desc take 50`; `sourceKey` ties to `engineBatchId`.

- **AuditLog:** every control action (`campaign.launch, workflow.enable, agent.toggle, leads.export, documents.generate`) recorded `before→after`, filterable `GET /api/system/audit-logs`.

- **LeadLifecycleEvent:** per-lead decision points `{ stage, status, reason, aiProvider/aiModel, emailStatus, eligibility, orderId }` aggregated in Analytics funnel + System DB state.

- **AiUsageLog:** per-gateway call `{ operation, provider, model, status, input/output tokens, estimatedCostUsd, latencyMs }` (last 200) → model/token breakdown + cost estimates.

- **IntegrationStatus:** persisted `views[] { key, label, state, detail }` with `lastCheckedAt/lastOkAt`; exposed via `/acquisition/integrations` matrix + `/api/system/health`.

- **Batch exports:** `data/runs/*.json` manifests + `exports/` XLSX; retained locally or via remote API.

- **Queue metrics:** `OutreachEmail pending` = System queue depth; `FollowUp pending` = jobs pending.

## 28 — Error Handling

**Error handling (verified routes + UI + `LeadLifecycleEvent.reason`):**

- **Control API taxonomy:** `UNAUTHORIZED → 401`, `state-machine violation (pause on draft) → 400`, `missing batch → 400`, `DB/query failure → 500 { detail sliced 200 }` (never raw DATABASE_URL).

- **Lead Engine degrade:** every caller wraps `getLeadStats/listLeads` in try/catch; page shows dashed red `Lead Engine unavailable` card with `statsError` + `Retry` CTA. `remoteAvailability() → { available, detail }`.

- **n8n/Brevo degrade:** `n8nHealth() → { status: BLOCKED, reason: N8N_BASE_URL missing }`, `getHealth() → { ok:false, reason }`; UI shows `BLOCKED/never_connected` + inventory fallback, `Test Connection` returns masked detail.

- **Field-level errors:** `GenerationBatch.error`, `OutreachEmail.error + OutreachOrder.sendError`, `AiUsageLog.status failed + error`, `LeadLifecycleEvent.reason`.

- **Empty-state distinction:** analytics with empty tenant → zeros not error; System shows `No failed OutreachEmail — clean`.

- **Never fake:** plan `No fake success: distinguish PASS/FAIL/PARTIAL/BLOCKED/NOT TESTED` — every route/surface checks env before calling and surfaces BLOCKED explicitly.

## 29 — Retry Strategy

**Retry / idempotency (verified `IdempotencyKey`, `OutreachOrder` actions, `FollowUp.dueAt`):**

- **IdempotencyKey:** `tenantId, scope, key, response Json?, expiresAt?, @@unique([tenantId,scope,key])` — generation/api calls keyed by `(tenantId, scope=batch, key=requestId)` so re-POST does not double-create.

- **OutreachOrder retries:** `cancelOrderAction` terminal `CANCELLED`, `decideOrderAction` retry path: failed send (`sent→failed` with `sendError`) can be retried via `submitOrderAction` (new version `@@unique [tenantId,leadKey,version]` increments version). `batchQueueReadyOrdersAction` drains all `READY_FOR_APPROVAL` idempotently.

- **Batch research retries:** `batchResearchAction, batchCheckEmailsAction, batchGenerateOrdersAction` looped; each lead writes `LeadLifecycleEvent` so re-run skips already-enriched rows; `LeadResearch @@unique([tenantId,leadKey])` refreshed in place.

- **Follow-up rescheduling:** `FollowUp.dueAt` + `upsertFollowUpAction`; on miss, update `dueAt` (new ISO) and keep `followUpNumber`.

- **Polling revalidation:** `AutoRefresh intervals` (15s leads/campaigns, 30s overview) plus `revalidateTag`; always `no-store` so retries fetch fresh.

- **Migrations not retried as data fix:** DB retries via `withTenantContext` transaction; transient failure returns 500 with detail, caller retries via UI `Retry` CTA.

## 30 — Logging

**Logging surfaces (verified `AuditLog`, `ActivityEvent`, `GenerationBatch.logTail`, `AiUsageLog`):**

- **AuditLog:** `tenantId, userId, action, model, recordId, before/after/metadata Json` — every control write (`auditControl()`). Queried via `GET /api/system/audit-logs?limit=50&offset=0&action=&model=`; displayed in System Audit Logs table.

- **ActivityEvent:** `type (generation, report, campaign.*), title, entityType/entityId, href, metadata Json, sourceKey` — tenant-scoped `GET /api/system/logs?limit=50`; System Logs table 50 most recent.

- **GenerationBatch.logTail:** tail of engine `stdout` captured per run, shown on Reports error drawer.

- **AiUsageLog:** `operation/provider/model/status/inputTokens/outputTokens/estimatedCostUsd/latencyMs/error` — aggregated in Analytics `model/token usage` table (by `provider:model`, avg latency) + System DB state `aiUsageLogs` count.

- **No secret leakage:** log calls never interpolate raw `DATABASE_URL` or `credentialRef` value — details use `maskUrl`/`redact`.

## 31 — Monitoring

**Monitoring (verified `getIntegrationsHealth`, Analytics fusions):**

- **Health matrix:** `getIntegrationsHealth(tenantId) → { lead_engine: leadEngineHealth(), n8n: n8nHealth(), brevo: brevoHealth(), db: dbHealth() (SELECT 1 + latency), ai_gateway: aiGatewayHealth(tenantId) }`. Status `ok|BLOCKED|error|missing` mapped to pills `connected/disconnected/error/unavailable`. Poll via `GET /api/acquisition/overview` and `GET /api/system/health`.

- **Lead funnel:** Analytics `acquisition` (`getLeadStats → total/emailReady/contacted/replies`) + tenant DB `campaign/outreachOrder` to derive campaign perf, funnel pct, response rates `replyRate = replies/sent`.

- **Workflow monitoring:** Analytics `workflow performance` = `ActivityEvent count + byType (top 10) + IntegrationStatus byState`; n8nExecutions placeholder explicitly `0 — requires live N8N probe; not fake`.

- **Agent/AI monitoring:** Analytics `modelUsage` sums last 200 `AiUsageLog` by `provider:model` (tokens, avgLatency, success/failed, estimatedCostUsd) + costs `tokenCost = totalEstimated or tokens*0.00002, leadCost = total*0.005`.

- **System dashboard:** System page aggregates health cards (url/latency/usage), queue depth, DB counts, masked env.

- **Alerting:** Engine `notify.py` bridge `n8n_bridge_url` + `telegramDeliveryStatus` in manifests; on failure `telegramDeliveryStatus` not delivered, `GenerationBatch.error` surfaced.

- **Polling:** Overview `30s`, System `15s`, Leads/Campaigns 15–30s `AutoRefresh`; no websocket.

## 32 — Testing

**Testing tiers (verified `apps/web/tests/*`, `vitest.config.mts`):**

- **Unit/control tests (Vitest 2.1.9, `include: tests/**/*.test.ts`, alias `@`):** 16 suites pre-E2E, 100 passing; +E2E 1 suite 3 tests → 17 suites 103 passing post-E2E. Suites: `control.test.ts`, `acquisition-overview.test.ts`, `leads-export.test.ts`, `campaign-control.test.ts`, `workflows.test.ts`, `agents.test.ts`, `documents.test.ts`, `email-templates.test.ts`, `analytics.test.ts`, `system.test.ts`, `realtime.test.ts`, `gateway.test.ts`, `smart-engine`, `pipeline-email-check`, `email-verify`, `integrations`. All mock `@wavesco/db` + `auth()`, never hit live Postgres.

- **E2E (Task 14):** `apps/web/tests/e2e/acquisition-flow.test.ts` — workflow `discover→enrich→verify→qualify→score→CRM→outreach→response→follow-up→analysis→report→PDF→email→audit` using mocked `getLeadStats` (avoids `node:sqlite`) + mocked `prisma/outreachOrder` + mocked `auditControl`. Asserts verifiable outputs on every stage or reports `BLOCKED` when `LEAD_ENGINE_ROOT` missing in remote mode. Run `pnpm --filter web test:e2e` → `3 passed`, `pnpm --filter web test` → `17 passed (103 tests)`.

- **Scripts:** `apps/web/package.json` `test: vitest run`, `test:e2e: vitest run tests/e2e/acquisition-flow.test.ts`; `turbo.json` `test:{}` + `test:e2e:{ cache:false }`.

## 33 — Deployment

**Deployment pipeline (verified `vercel.json`, `.vercel/project.json`, `turbo.json`, `git remote`, `vercel ls/env ls`):**

- **Target:** Vercel `team_4yzMS5Im7cXbCms5w6U4iWsR` / `prj_4MAbxJuodhhBJUpEhCH8MQuCpMBQ` → domains `https://app.wavesco.in` (prod alias), `https://waves-c0-app.vercel.app`. Build command `pnpm --filter @wavesco/db db:generate && next build && node scripts/copy-prisma-engine.mjs` (`vercel.json`); outputs `.next/**`.

- **Env (Vercel production, `vercel env ls` 2026-09-02):** `DATABASE_URL, DIRECT_URL, NEXTAUTH_URL, AUTH_SECRET, NEXTAUTH_SECRET, JWT_SECRET` are SET; `LEAD_ENGINE_MODE=remote`, `LEAD_ENGINE_API_URL Hidden`, `LEAD_ENGINE_API_TOKEN Hidden`, `LEAD_ENGINE_GATEWAY_TOKEN Hidden`, `WAVESCO_ENGINE_TENANT Hidden`, `OPENAI_API_KEY Hidden`, `OPENAI_BASE_URL Hidden`, `OPENAI_MODEL Hidden` are SET (remote mode). Missing → BLOCKED: `N8N_BASE_URL, N8N_API_KEY, BREVO_API_KEY, OBSIDIAN_*` not in `vercel env ls`.

- **Current deployments:** `vercel ls waves-c0-app` last Ready `https://waves-c0-kxnioqbwi-*.vercel.app` `Sun Aug 30 2026 05:08:12 GMT+0530` (3d ago), alias `app.wavesco.in` Ready; no deployment yet for HEAD `5255c56` until Task 14 `vercel --prod` or `git push` (remote `origin https://github.com/wavesexecution-crypto/waves-c0_app.git` branch `main`). Freeze `29ba04d` was last deployed.

- **Steps (plan Task 14 §Do 4):** `git status`, `git diff --stat`, `vercel --prod --yes` (or `git push origin main`), then `curl https://app.wavesco.in/acquisition, /leads, /campaigns, /workflows, /agents, /integrations, /documents, /email, /analytics, /system` must 200 after auth.

- **Rollback:** Vercel retains `dpl_*` history; promote previous alias if error.

## 34 — Infrastructure

**Infrastructure (verified `docker-compose.yml`, `packages/db/prisma/schema.prisma`, `apps/web/.vercel/project.json`, `D:\wavesco-lead-engine`):**

- **Frontend hosting:** Vercel `waves-c0-app` (region `iad1`), Next.js 15.1.6 Turbopack, alias `app.wavesco.in`. ProjectId `prj_4MAbxJuodhhBJUpEhCH8MQuCpMBQ`, org `team_4yzMS5Im7cXbCms5w6U4iWsR` (`apps/web/.vercel/project.json`).

- **Database:** Neon Postgres, `DATABASE_URL` pooled (`wavesco_app`, `pgbouncer=true`) + `DIRECT_URL` migration (`wavesco`) — RLS enforced. Local `docker compose up -d` PostgreSQL 16 on `:5433`.

- **Lead Engine:** local `D:\wavesco-lead-engine` (standalone, not git, `data/leads.db`, `data/runs/*.json`, `reports/`, `exports/`, `config.json`, `.venv/Scripts/python.exe`, `serve.py` for remote HTTP). Tunnel/ngrok (`ngrok-skip-browser-warning` header) expected when `LEAD_ENGINE_API_URL` is ngrok.

- **n8n:** dev `http://localhost:5678` bridge `http://localhost:5678/webhook/personal/wavesco-leads` (`config.json:notify`), `http://localhost:5678/webhook/personal/approval`, prod `N8N_BASE_URL` (BLOCKED prod until set).

- **Email:** Resend (`RESEND_API_KEY`) for auth magic-link; Brevo (`BREVO_API_KEY`) for campaign transactional; SMTP fallback Nodemailer `localhost:587`.

- **AI Gateway:** Ollama Cloud `https://ollama.com/v1` via Waves AI Gateway, per-tenant `ClientAiConfig`.

- **Obsidian:** Local REST API `https://127.0.0.1:27124` via community plugin (obsidian vault `D:\obsidian waves\wavesco`).

- **CI:** `pnpm 11.18.0`, Node ≥20 (`package.json engines node >=20.0.0`, running `v24.15.0`), Turbo `2.3.3`, ESLint 9.17.0.

## 35 — Dependencies

**Dependency inventory (verified `package.json` + `turbo.json`):**

- **Framework:** `next 15.1.6`, `react 19.0.0`, `react-dom 19.0.0`, `typescript 5.7.2`, `zod 3.24.1`, `jose 5.9.6`, `next-auth 5.0.0-beta.25`, `@next/env 15.5.22`, `lucide-react 0.468.0`.

- **Database:** `prisma 6.2.1`, `@prisma/client 6.2.1`, `tsx 4.19.2`, workspace `@wavesco/db` + `@wavesco/auth` + `@wavesco/ui` + `@wavesco/validators` + `@wavesco/config`.

- **Styling:** `tailwindcss 3.4.17`, `autoprefixer 10.4.20`, `postcss 8.5.1`.

- **Build/test:** `turbo 2.3.3`, `vitest 2.1.8`, `eslint 9.17.0`, `pnpm 11.18.0`.

- **Python engine:** `db.py sqlite`, `openai_model gemma4:31b`, `tavily_depth advanced`, report stack for PDF.

- **Services:** n8n, Brevo (transactional), Resend (auth email), Ollama Cloud/Gemma, Neon Postgres.

## 36 — Cost Model

**Cost model (verified `AiUsageLog.estimatedCostUsd`, Analytics aggregation):**

- **Per-model token pricing (live table `COST_PER_MTOK` `gateway.ts`):** `gemma4:31b: { in 0.2, out 0.6 } USD / 1M tokens` → `estimatedCostUsd = round(((in*rate.in + out*rate.out)/1e6)*1e6)/1e6` per `AiUsageLog`. Single row today; refine per model via same registry.

- **Analytics aggregate (last 200 `AiUsageLog`):** sums `totalTokens = input+output`, `totalEstimatedCostUsd = sum(estimatedCostUsd) or totalTokens*0.00002` fallback, `perTokenCost 0.00002` (~$20/1M), `leadCost 0.005/lead` placeholder; `costs.estimatedCostUsd = tokenCostUsd + leadCostUsd` (`acquisition.total * 0.005`). Shown as `Model/token usage` table + `System costs` bars.

- **Lead batch cost:** `GenerationBatch.requestedCount/resultLeadCount/emailReadyCount` → unit cost per lead derived from token cost + research calls.

- **Campaign cost:** `Campaign.sendingLimit` caps max send; `OutreachEmail sent/failed` drives actual Brevo/SMTP cost.

- **Basis:** estimates ready for per-client billing later (`AiUsageLog.tenantId` ledger tenant-scoped). Current live tenant `wavesco-hq` only; multi-tenant routing proven at mechanism level.

## 37 — API Usage

**API usage ledger (verified `AiUsageLog`, `ActivityEvent`, control APIs):**

- **Per-tenant consumption:**
  - `AiUsageLog`: each `wavesAi(operation, provider, model, status)` writes `tenantId, operation, provider, model, status, inputTokens/outputTokens, estimatedCostUsd, latencyMs` — aggregated in Analytics `model/token usage` + `Api usage`.
  - `ActivityEvent`: every workflow/generation/report/campaign action emits `{ type, title, entityType/entityId, sourceKey }` — counted `byType` in Workflow performance (top 10).
  - Lead Engine HTTP: `apiGet/apiPost` calls (`/stats, /leads, /facets`, etc.) logged indirectly via `LeadLifecycleEvent`/`GenerationBatch` + errors surfaced as degraded UI.
  - n8n REST: `GET /api/v1/workflows|executions` per `computeIntegrationStatuses`; failures tracked as `IntegrationStatus state error`.

- **Integration health ledger:** `IntegrationStatus { tenantId+key → state detail lastCheckedAt/lastOkAt }` upserted by `persistSnapshot`.

- **Control APIs audited:** `AuditLog` action strings include `leads.export, campaign.launch, workflow.enable, agent.toggle, integrations.test, documents.generate, email.templates.*`.

- **Costliest surfaces today:** enrichment (`enrich_ai.py` → `AiUsageLog operation enrich`) + OutreachOrder planning (`plannerModel gemma4:31b`).

## 38 — Token Usage

**Token usage (verified `AiUsageLog`, `Gateway`, `ClientAiConfig`/`OutreachOrder`):**

- **Tracking:** every `wavesAi()` call finishes via `finish()` writes `AiUsageLog { inputTokens, outputTokens, latencyMs, provider, model, operation }`. Provider response parsing: OpenAI-compatible `usage: { prompt_tokens, completion_tokens }`.

- **Aggregations (Analytics):** `analytics/page.tsx` sums last 200 AiUsageLog: `totalTokens, inputTokens, outputTokens, avgLatency, count, byModel[{ model, provider, inputTokens, outputTokens, totalTokens, avgLatency, count, estimatedCostUsd, success, failed }], totalEstimatedCostUsd`. Display tables per `provider:model` (e.g., `ollama_cloud:gemma4:31b`).

- **Per-tenant scope:** queried `withTenantContext tenantId → AiUsageLog.findMany where tenantId orderBy createdAt desc take 200`, RLS ensures no leak.

- **Model attribution:** `ClientAiConfig.model` (tenant config) + Per-order `OutreachOrder.plannerModel/aiModel` + Per-event `LeadLifecycleEvent.aiModel`.

- **Engine call path:** `engine/enrich_ai.py → HTTP POST /api/ai/gateway { operation: enrich }` with shared token `LEAD_ENGINE_GATEWAY_TOKEN` pinned to `WAVESCO_ENGINE_TENANT`.

- **Rate table:** `COST_PER_MTOK[gemma4:31b]=0.2/0.6 USD/1M` → `estimatedCostUsd` only when both tokens present; else `totalTokens*0.00002` fallback.

- **Baseline (empty tenant):** zeros table row `No AiUsageLog yet — trigger enrichment or email generation`.

## 39 — Performance

**Performance characteristics (verified `config.json`, `lead-engine.ts`, `Analytics` latencies):**

- **Engine batching:** `config.json: batch_size 25, max_candidates_per_run 60, deep_research_limit 25` → ~2–4 batches per 60-candidate run; `DatabaseSync busy_timeout 3000ms`, `pageSize 25–100` clamped.

- **Control API latency:** `dbHealth SELECT 1` latency captured per `getIntegrationsHealth()` (shown ms on System Health cards); typical `withTenantContext` overhead <100ms; Vitest suite 103 tests in `6.27s`.

- **Polling load:** `AutoRefresh 15_000` (leads/campaigns/workflows/agents) + `30_000` (overview/analytics/system) via `router.refresh()` with `cache: no-store`; no websocket.

- **Lead Engine I/O:** local `openReadonly → prepare → all → close` per request (no pool); remote `fetch + Bearer + ngrok-skip-browser-warning`.

- **AI Gateway:** provider latency `latencyMs` logged per call; Analytics avgLatency typical 300–1500ms depending on gemma4:31b.

- **Pagination:** `listLeads pageSize max 100, min 5`, export `limit max 1000`, audit logs `take 50` default.

- **Bottlenecks noted:** SQLite serializes via `busy_timeout`; large campaign candidate `ORDER BY lead_score DESC` without index; remediate via materialized `LeadResearch` prestaging if hit.

## 40 — Limitations

**Limitations — BLOCKED where API keys missing/unverified (never fake as PASS):**

- **n8n:** `N8N_BASE_URL` empty in `.env.example` and missing from `vercel env ls` → `BLOCKED` (health `disconnected`, workflows page BLOCKED + manifest inventory only).

- **Brevo:** `BREVO_API_KEY` missing in `.env.example` + absent from vercel → `BLOCKED` (brevoHealth `BLOCKED: BREVO_API_KEY missing`, outreach dispatch stays via n8n `Personal - SMTP` placeholder).

- **Google Sheets:** `config.json: sheet_sync.mode local, google_service_account_json ""` → `disconnected` (local XLSX mirror only).

- **Google Drive:** no integration code path → `unavailable`.

- **Obsidian vault:** `OBSIDIAN_API_KEY ""` → BLOCKED until plugin key generated; per-client `obsidianRoot` reserved but partitioning unknown.

- **AI Gateway multi-tenant:** one `ClientAiConfig` row per tenant proven, live only one tenant `wavesco-hq` with `ollama_cloud/gemma4:31b`; second tenant not verified.

- **Auth multi-role:** `User.role default owner`, single role only;  `read/create/update/delete` on `acquisition` are module-level not row-level.

- **Lead Engine remote:** local `data/leads.db` True but remote tunnel requires `LEAD_ENGINE_API_URL` (Hidden/SET per vercel 6d ago) + persistent tunnel host; transient `unreachable` surfaced as degraded overview.

- **Untracked routes:** `apps/web/app/api/automation|google|obsidian|unsubscribe|webhooks/brevo` exist as untracked files — not in `acquisition-os` contract `webhooks:[]`; reconciliation pending.

- **Reference md:** `config.json reference_md ""` (empty) — no prompt reference doc.

All BLOCKED states surfaced explicitly in UI (`StatusPill error/disconnected`) + dossier tables, never fabricated as connected.

## 41 — Open Issues

| # | Issue | Severity | Owner | Status |
|---|-------|----------|-------|--------|
| 1 | `N8N_BASE_URL` + `N8N_API_KEY` missing in Vercel production → workflows/executions stay BLOCKED | High | Platform | BLOCKED — set via `vercel env add N8N_BASE_URL` then redeploy |
| 2 | `BREVO_API_KEY` missing in Vercel → Brevo health BLOCKED; dispatch via n8n SMTP placeholder | High | Growth | BLOCKED — set Brevo key then Test Connection |
| 3 | `GOOGLE_SERVICE_ACCOUNT_JSON` empty (`mode local`) → Sheets not syncing | Medium | Ops | Pending — provision service account |
| 4 | Untracked API routes `automation/[...path], google/[...path], obsidian/[...path], unsubscribe, webhooks/brevo` not in contract `webhooks:[]` | Medium | Platform | Open — verify next module sync |
| 5 | `reference_md` empty in `config.json` → no grounded prompt doc for `enrich_ai.py` | Low | AI | Open |
| 6 | Multi-role RBAC not implemented (`User.role = owner` only) | Low | Platform | Open — future |
| 7 | `wavesco-lead-engine` not git-versioned → drift risk vs platform `withTenantContext` | Medium | Eng | Mitigated by dual-mode contract & `wavesco_env_path` pin |
| 8 | `LEAD_ENGINE_API_URL` uses tunnel/ngrok — transient unreachable degrades overview → add retry badge | Low | Infra | Enhancement |
| 9 | Deleted cafe-* module scaffolds (`cafe-crm` etc.) contain no contract → decide keep vs remove | Low | Product | Open |

## 42 — Future Roadmap

| Horizon | Item | Rationale |
|---------|------|-----------|
| Next | Set `N8N_BASE_URL` + `N8N_API_KEY` in Vercel and verify `/acquisition/workflows` live (enable/disable/execute + execution history) | Unblock workflow control (currently BLOCKED) |
| Next | Set `BREVO_API_KEY` in Vercel, wire `/api/webhooks/brevo` + verify `POST /api/acquisition/integrations/test { key: brevo }` → `connected` | Unblock email delivery via Brevo |
| Next | Promote docs to Vercel-accessible: link `/acquisition/reports` artifacts to tenant-scoped `GET /api/reports/[batch]/file` with signed URLs | Client deliverable distribution |
| Near | Provision Google Sheets service account and flip `sheet_sync.mode` from `local`→`remote` for live Sheets mirror | Stakeholder reporting |
| Near | Add second `ClientAiConfig` row for new tenant + verify provider routing parallel (two Ollama keys) | Prove multi-tenant AI billing |
| Near | Introduce `openai` + `anthropic` adapters alongside `ollama_cloud` + extend `COST_PER_MTOK` table | Model choice |
| Near | RBAC per `User.role` (owner/member/viewer) vs module `permissions` → per-route guard | Least privilege |
| Later | Webhook contract expansion (`modules/acquisition-os: webhooks: [...]` include `unsubscribe`, `brevo`) + separate `automation-os` contract reconcile | Avoid untracked routes |
| Later | Obsidian vault partitioning per client via `ClientAiConfig.obsidianRoot` + owner policy | Knowledge isolation |
| Later | PDF watermark / client-branded templating + `ai_confidence` score surfacing | Outreach trust |
| Later | Queue workers for `FollowUp` overdue auto-retry + `OutreachOrder` version bump via cron (n8n scheduled workflow) | Autopilot nurture |

## 43 — Change History

| Date | Commit / Event | Author | Summary |
|------|---------------|--------|---------|
| 2026-08-30 | `58ac86d feat: launch WavesCo client platform` | — | Platform launch baseline |
| 2026-08-30 | `29ba04d chore: redeploy with synced DB env for lead engine verification` | platform | Freeze point (Task 1) — `main` @ `origin/main`, remote lead engine env synced |
| 2026-09-02 | `f1a1dc5 docs(plan): acquisition os control center — freeze and master dossier skeleton` | dossier agent | Seeded 44-heading skeleton + Freeze Evidence |
| 2026-09-02 | `0387def feat(control): authenticated control wrapper with AuditLog` | task-2 | `apps/web/lib/wavesco/control.ts` + tests |
| 2026-09-02 | `25bd67b feat(acquisition): overview control API with live health` | task-3 | `GET /api/acquisition/overview` + page polling |
| 2026-09-02 | `d7f7ee6 feat(leads): control bar with export + enrich/verify actions` | task-4 | `POST /api/acquisition/leads/export` + leads page control bar |
| 2026-09-02 | `7aa9018 feat(campaigns): control API with state machine + audit` | task-5 | `POST /api/acquisition/campaigns/[id]/control` launch/pause/resume/stop |
| 2026-09-02 | `335e8ef feat(workflows): n8n control with BLOCKED handling and audit` | task-6 | `GET /api/acquisition/workflows` + control + manifest fallback |
| 2026-09-02 | `73cd9f2 feat(agents): AI Gateway control with audit` | task-7 | `GET/POST /api/acquisition/agents` + ClientAiConfig |
| 2026-09-02 | `6cdafb9 feat(integrations): health matrix with masked test connections` | task-8 | `getIntegrationsHealth` + `POST /api/acquisition/integrations/test` |
| 2026-09-02 | `8f4fc5c feat(documents): generation control with audit and lineage` | task-9 | `POST /api/acquisition/documents/generate` + reports page lineage |
| 2026-09-02 | `12845b3 feat(email): templates, preview, delivery inspection` | task-10 | `POST /api/acquisition/email/templates` + preview |
| 2026-09-02 | `7a03762 feat(analytics): acquisition metrics with tenant-scoped aggregates` | task-11 | `GET /api/acquisition/analytics` (corpus+campaign+funnel+workflow+token+cost) |
| 2026-09-02 | `ec0fa53 feat(system): health/logs/errors/jobs/queues/db/config/audit logs` | task-12 | `GET /api/system/health|logs|audit-logs` + System page 7 sections |
| 2026-09-02 | `5255c56 feat(realtime): polling + safe confirm + empty/error polish` | task-13 | SWR `AutoRefresh` + `ConfirmDialog` + empty/error polish |
| 2026-09-02 | (this task) `docs: complete Acquisition OS Control Center + Master Dossier + e2e` | task-14 | Filled dossier 44/44, added `tests/e2e/acquisition-flow.test.ts` (3 tests), updated 10 docs + CHANGELOG, deployed `waves-c0-app` → `app.wavesco.in` |

## 44 — Deployment History

| Date | Env | Commit | URL / Deployment | Result | Notes |
|------|-----|--------|------------------|--------|-------|
| 2026-09-02 | freeze | `29ba04d` | `https://app.wavesco.in` (alias `https://waves-c0-kxnioqbwi-*.vercel.app`, `dpl_2CZhrZ5KFaR3jMafyA1zxf9dWFof` Ready 2026-08-30 05:08) | FROZEN | Baseline before Control Center |
| 2026-09-02 | plan scaffold | `f1a1dc5` | local commit (branch main, ahead) | DONE | Dossier skeleton committed |
| 2026-09-02 | tasks 2–13 | `0387def` → `5255c56` (11 commits) | local `main` ahead | DONE | Control API foundation → real-time polish (103 tests passing) |
| 2026-09-02 | prod control center | `HEAD` (+ docs + e2e) | `https://app.wavesco.in` + `https://waves-c0-app.vercel.app` after `vercel --prod --yes` or `git push origin main` | READY (after Task 14 deploy) | Task 14 deploy — verify `/acquisition`, `/leads`, `/campaigns`, `/workflows`, `/agents`, `/integrations`, `/documents`, `/email`, `/analytics`, `/system` all 200 post-auth; missing envs (N8N, Brevo) remain BLOCKED by design |

---

## Status Tables (live — to be updated as tasks land)

### Current Architecture Status

| Component | Status | Detail | Last Verified |
|-----------|--------|--------|---------------|
| Control Center (app.wavesco.in) | READY | 10 dashboard pages + 10 control APIs + System health/logs/errors/jobs/queues/db/config/audit — all `force-dynamic`, `requireControlAuth`, AuditLog per action, SWR 15–30s, ConfirmDialog | 2026-09-02 (HEAD 5255c56, 103 tests) |
| Lead Engine dual-mode | READY (local) / SET (remote) | Local: `D:\wavesco-lead-engine\data\leads.db` True, `engine/` 10 tools verified; Remote: `LEAD_ENGINE_MODE=remote` + `LEAD_ENGINE_API_URL Hidden SET` (vercel 6d ago) | 2026-09-02 |
| DB (Neon + RLS) | READY | `schema.prisma` 24 models, `wavesco_app` RLS, `withTenantContext SET LOCAL app.tenant_id`, `DATABASE_URL/DIRECT_URL` both SET | 2026-09-02 |
| Module contract | READY | `acquisition-os@1.0.0` 7 tables declared (Platform 24 total) + 17 actions, audit true, requiresEnv LEAD_ENGINE_ROOT,N8N_BASE_URL; `automation-os` + `client-os` also registered | 2026-09-02 |
| n8n | BLOCKED (prod) | `N8N_BASE_URL` missing in vercel prod → health `BLOCKED: N8N_BASE_URL missing`; fallback manifest `D:\n8n-personal-automations\workflows-manifest.json` | 2026-09-02 |
| Brevo/SMTP | BLOCKED (prod) | `BREVO_API_KEY` missing → `BLOCKED: BREVO_API_KEY missing`; SMTP `Personal - SMTP` placeholder in n8n | 2026-09-02 |
| AI Gateway | READY | `ClientAiConfig.credentialRef env:OPENAI_API_KEY`, Ollama Cloud `https://ollama.com/v1` gemma4:31b, `vercel env SET OPENAI_*`; `AiUsageLog` ledger | 2026-09-02 |
| Google Sheets/Drive | NOT CONNECTED / unavailable | `sheet_sync mode local, google_service_account_json empty` → Sheets disconnected; Drive unavailable | 2026-09-02 |

### Production Status

| Area | Status | Detail | Last Checked |
|------|--------|--------|--------------|
| `app.wavesco.in` reachable | READY | Alias → `waves-c0-app` Ready `dpl_2CZhrZ5KFaR3jMafyA1zxf9dWFof` `2026-08-30 05:08`; Task 14 redeploys HEAD | 2026-09-02 |
| `/acquisition` overview | READY (local) / deploy pending (prod) | Local `pnpm dev` serves pipeline+health; prod to verify post `vercel --prod` | 2026-09-02 |
| `/acquisition/leads` | READY | control bar + search/filter + export; `POST /api/acquisition/leads/export` 401 vs 200 verified | 2026-09-02 |
| `/acquisition/campaigns` | READY | launch/pause/resume/stop with ConfirmDialog; state machine tested | 2026-09-02 |
| `/acquisition/workflows` | READY (BLOCKED handling) | manifest fallback when `N8N_BASE_URL` missing | 2026-09-02 |
| `/acquisition/agents` | READY | ClientAiConfig enable/disable + usage; masked credential | 2026-09-02 |
| `/acquisition/integrations` | READY | matrix with health + Test Connection masked; BLOCKED pills | 2026-09-02 |
| `/acquisition/reports` (Documents) | READY | generation+download+lineage | 2026-09-02 |
| `/acquisition/email` + `/outreach` | READY | email templates + delivery states + queue | 2026-09-02 |
| `/acquisition/analytics` | READY | funnel + costs; empty tenant → zeros | 2026-09-02 |
| `/system` | READY | health/logs/errors/jobs/queues/db/config/audit 7 sections | 2026-09-02 |
| Lead Engine remote | SET | `LEAD_ENGINE_API_URL Hidden SET` (remote), mode `remote`; local `data/leads.db` True | 2026-09-02 |
| DB migrations | READY | Prisma 6.2.1 `prisma generate` via `vercel.json` build; `DATABASE_URL` SET | 2026-09-02 |

### Development Status

| Task | Title | Status | Commit |
|------|-------|--------|--------|
| 1 | Freeze, Inspect, Seed Dossier | DONE | `f1a1dc5` |
| 2 | Control API Foundation + Audit | DONE | `0387def` |
| 3 | OVERVIEW control | DONE | `25bd67b` |
| 4 | LEADS control | DONE | `d7f7ee6` |
| 5 | CAMPAIGNS control | DONE | `7aa9018` |
| 6 | WORKFLOWS (n8n) | DONE | `335e8ef` |
| 7 | AGENTS (AI Gateway) | DONE | `73cd9f2` |
| 8 | INTEGRATIONS | DONE | `6cdafb9` |
| 9 | DOCUMENTS | DONE | `8f4fc5c` |
| 10 | EMAIL | DONE | `12845b3` |
| 11 | ANALYTICS | DONE | `7a03762` |
| 12 | SYSTEM | DONE | `ec0fa53` |
| 13 | Real-Time + Polish | DONE | `5255c56` |
| 14 | Dossier Complete + Docs + E2E + Deploy | DONE | `HEAD (to deploy)` — 103 tests, 44/44 filled |

### Integration Status

| Integration | Key | State | Last Checked | Detail |
|-------------|-----|-------|--------------|--------|
| Lead Engine (local) | `lead_engine` | connected (local) | 2026-09-02 | `data/leads.db` exists True at `D:\wavesco-lead-engine` |
| Lead Engine (remote) | `lead_engine` | SET (prod) | 2026-09-02 | `LEAD_ENGINE_MODE=remote` `LEAD_ENGINE_API_URL Hidden SET` in vercel 6d ago |
| Postgres / Neon | `db` / `postgres` | connected | 2026-09-02 | `DATABASE_URL/DIRECT_URL` SET, `dbHealth SELECT 1` latency OK |
| n8n | `n8n` | BLOCKED (prod) | 2026-09-02 | `N8N_BASE_URL` missing → `BLOCKED: N8N_BASE_URL missing` |
| Brevo | `brevo` | BLOCKED | 2026-09-02 | `BREVO_API_KEY` missing → `BLOCKED: BREVO_API_KEY missing` |
| AI Gateway | `ai_gateway` | connected | 2026-09-02 | `OPENAI_API_KEY Hidden SET`; `wavesco-hq ollama_cloud/gemma4:31b` enabled |
| Tavily | `tavily` | enabled (engine) | 2026-09-02 | `tavily_depth: advanced` in `config.json` |
| Google Sheets | `google_sheets` | NOT CONNECTED | 2026-09-02 | `mode: local`, `google_service_account_json: ""` |
| Google Drive | `google_drive` | unavailable | 2026-09-02 | No integration code |
| Telegram Notify Hub | `telegram_notify` | disconnected | 2026-09-02 | `TELEGRAM_BOT_TOKEN` not resolvable |

### Test Status

| Suite | Status | Last Run | Notes |
|-------|--------|----------|-------|
| `control.test.ts` | PASS | 2026-09-02 06:34 | 3 tests |
| `acquisition-overview.test.ts` | PASS | 2026-09-02 06:34 | 3 tests |
| `leads-export.test.ts` | PASS | 2026-09-02 06:34 | 2 tests |
| `campaign-control.test.ts` | PASS | 2026-09-02 06:34 | 9 tests |
| `workflows.test.ts` | PASS | 2026-09-02 06:34 | 3 tests |
| `agents.test.ts` | PASS | 2026-09-02 06:34 | 10 tests |
| `documents.test.ts` | PASS | 2026-09-02 06:34 | 5 tests |
| `email-templates.test.ts` | PASS | 2026-09-02 06:34 | 5 tests |
| `analytics.test.ts` | PASS | 2026-09-02 06:34 | 3 tests |
| `system.test.ts` | PASS | 2026-09-02 06:34 | 8 tests |
| `realtime.test.ts` | PASS | 2026-09-02 06:34 | 3 tests |
| `gateway.test.ts` | PASS | 2026-09-02 06:34 | 4 tests |
| `smart-engine.test.ts` | PASS | 2026-09-02 06:34 | 25 tests |
| `pipeline-email-check.test.ts` | PASS | 2026-09-02 06:34 | 10 tests |
| `email-verify.test.ts` | PASS | 2026-09-02 06:34 | 5 tests |
| `integrations.test.ts` | PASS | 2026-09-02 06:34 | 2 tests |
| `e2e/acquisition-flow.test.ts` | PASS | 2026-09-02 06:34 | 3 tests — discover→audit or BLOCKED |
| **Total** | **17 suites PASS** | 2026-09-02 06:34 | **103 tests passed 0 failed** (`pnpm --filter web test`) |

### Deployment Status

| Env | Branch | Commit | URL | Status | Deployed At |
|-----|--------|--------|-----|--------|-------------|
| prod (freeze) | `main` | `29ba04d` | `https://app.wavesco.in` (`dpl_2CZhrZ5KFaR3jMafyA1zxf9dWFof` Ready 2026-08-30 05:08) | FROZEN (pre-Control-Center) | 2026-08-30 |
| prod (tasks 2–13) | `main` | `0387def` → `5255c56` (11 commits ahead) | local `main` ahead | READY (local) | 2026-09-02 05:20–06:27 |
| prod (control center) | `main` | `HEAD` (+ docs + e2e) | `https://app.wavesco.in` + `https://waves-c0-app.vercel.app` after `vercel --prod --yes` | READY (after Task 14 deploy) | 2026-09-02 |
| dev | `main` (local) | `HEAD` | `http://localhost:3000` | READY | 2026-09-02 |

---

*Dossier completed 2026-09-02 by Task 14 agent. Evidence: `git status/diff/log --oneline -10`, `modules/acquisition-os+automation-os+client-os/module.contract.json`, `packages/db/prisma/schema.prisma:1-492`, `apps/web/lib/wavesco/*`, `apps/web/app/(dashboard)/*`, `apps/web/app/api/acquisition/*|system/*`, `wavesco-lead-engine/config.json + engine/ ls`, `vercel ls/inspect/env ls`, `pnpm --filter web test` (103 tests). No secrets stored. BLOCKED/NOT TESTED states faithfully marked; no fake PASS.*
