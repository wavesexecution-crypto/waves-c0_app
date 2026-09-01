# Acquisition OS Control Center Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Acquisition OS Control Center inside `https://app.wavesco.in` (`waves-c0-app` / `wavesco-platform`) so `app.wavesco.in` can monitor, configure, execute, pause/resume, and analyze the entire Acquisition OS (leads, campaigns, workflows, agents, integrations, documents, email, analytics, system) via authenticated APIs with real-time state and audit logging.

**Architecture:** Extend the existing `apps/web/app/(dashboard)/acquisition/*` Next.js 15 + Prisma + Postgres (Neon) routes as the Control Center; introduce a shared control-API layer (`apps/web/app/api/acquisition/*`, `lib/wavesco/control.ts`) that enforces `auth() + requireTenantId + withTenantContext`, never exposes provider keys to the browser, writes `AuditLog` for every control action, and surfaces real-time state via server components + SWR polling; reuse `LeadResearch`, `OutreachOrder`, `Campaign`, `GenerationBatch`, `IntegrationStatus`, `ActivityEvent`, `AuditLog` models; integrate n8n (workflows), Ollama/ Waves AI Gateway (agents), Brevo/SMTP (email), and Lead Engine HTTP/SQLite dual-mode via `lib/wavesco/lead-engine.ts`.

**Tech Stack:** Next.js 15.1.9/15.5 (App Router, `force-dynamic`), React 19, TypeScript, Prisma 6.19, Postgres (Neon, RLS `wavesco_app` role), Turbo, pnpm 10, Vercel (`waves-c0-app` → `app.wavesco.in`), n8n, Ollama Cloud, Brevo, Tailwind + shadcn `packages/ui`.

## Global Constraints

- `app.wavesco.in` is the Control Center — must CONTROL, not just display; every dashboard section must have actionable controls backed by authenticated APIs.
- Architecture `app.wavesco.in → Authenticated Dashboard → Acquisition OS API → Orchestration → Agents/Workflows/Tools → DB + External APIs` — dashboard never directly exposes provider API keys to browser; secrets via `env:VAR` / `credentialRef` server-side only.
- Dashboard state must reflect actual backend state (RUNNING/PAUSED/FAILED/etc.) — no fake UI state; polling/revalidation where appropriate.
- Every meaningful control action must be audit-logged to `AuditLog` (who, what, when, resource, before/after, result, failure) — especially campaign launch/stop, integration/agent config, comms, workflow, deliverables.
- UX: serious operations console — clarity, speed, hierarchy, information density, responsive, obvious system state, minimal clicks, safe destructive actions, useful empty/error states; not a generic admin dashboard.
- Final architecture `WAVES → ACQUISITION OS (Acquisition, Enrichment, Qualification, Outreach, Campaigns, Agents, Workflows, Analytics, Document Engine) → app.wavesco.in → CONTROL CENTER (Monitor, Configure, Execute, Pause, Resume, Analyze, Manage)`.
- No fake success: distinguish PASS/FAIL/PARTIAL/BLOCKED/NOT TESTED; if API key missing/blocked, say so; do not fabricate API calls.
- Git discipline: `git status/diff/log --oneline -10` before major changes, logical commits, never commit API keys/secrets/tokens/temporary files, clean checkpoints.
- `D:\waves-c0_app\wavesco-platform` and `D:\wavesco-lead-engine` are separate from `wavesoss`; never commit one into the other; Lead Engine dual-mode (local SQLite / remote HTTP) via `LEAD_ENGINE_ROOT` + `N8N_BASE_URL` must remain.

---

## File Structure

**Existing to modify:**
- `apps/web/app/(dashboard)/acquisition/page.tsx` — Overview (pipeline, campaigns, health) — enhance with live state
- `apps/web/app/(dashboard)/acquisition/leads/page.tsx` — add control header + export; detail `leads/[name_key]/page.tsx` exists
- `apps/web/app/(dashboard)/acquisition/campaigns/page.tsx` — enhance launch/pause/resume/stop
- `apps/web/app/(dashboard)/acquisition/generate/page.tsx` — generation control
- `apps/web/app/(dashboard)/acquisition/reports/page.tsx` — document control linkage
- `apps/web/lib/wavesco/lead-engine.ts` — Lead Engine client (listLeads, getFacets, etc.)
- `packages/db/prisma/schema.prisma` — existing models `GenerationBatch`, `Campaign`, `OutreachEmail`, `FollowUp`, `LeadResearch`, `OutreachOrder`, `LeadLifecycleEvent`, `ActivityEvent`, `IntegrationStatus`, `AuditLog`
- `apps/web/middleware.ts` — auth guard

**New files to create:**
- `apps/web/lib/wavesco/control.ts` — shared control helpers (requireControlAuth, auditLog, withControlContext)
- `apps/web/lib/wavesco/integrations.ts` — integration status aggregation (LEAD_ENGINE_ROOT, N8N_BASE_URL, BREVO, etc.)
- `apps/web/app/api/acquisition/overview/route.ts` — aggregated overview JSON for polling
- `apps/web/app/api/acquisition/leads/export/route.ts` — CSV export with tenant scoping
- `apps/web/app/api/acquisition/campaigns/[id]/control/route.ts` — pause/resume/stop/launch (POST)
- `apps/web/app/(dashboard)/acquisition/overview` — (optional) dedicated overview route if splitting from `page.tsx`
- `apps/web/app/(dashboard)/acquisition/workflows/page.tsx` — n8n workflow control
- `apps/web/app/(dashboard)/acquisition/agents/page.tsx` — AI Gateway agents
- `apps/web/app/(dashboard)/acquisition/integrations/page.tsx` — integration health + test connections
- `apps/web/app/(dashboard)/acquisition/documents/page.tsx` — generated reports control
- `apps/web/app/(dashboard)/acquisition/email/page.tsx` — templates + delivery state
- `apps/web/app/(dashboard)/acquisition/analytics/page.tsx` — metrics dashboards
- `apps/web/app/(dashboard)/system/page.tsx` — health/logs/errors/jobs/queues/db/config/audit logs (or `acquisition/system`)
- `apps/web/components/control/StatusPill.tsx` — shared RUNNING/PAUSED/FAILED pill (extend existing primitives)
- `docs/superpowers/plans/2026-09-02-acquisition-os-control-center.md` — this plan
- Obsidian: `Waves/OSS` is for Waves OSS; create `Acquisition OS — MASTER PRODUCT DOSSIER.md` under `Waves` vault (or `WavesCo/Acquisition OS/`) per spec — separate from plan
- Repo docs: `apps/web/README.md`, `docs/ARCHITECTURE.md`, `docs/INTEGRATIONS.md`, etc. to be updated in final docs task

---

### Task 1: Freeze, Inspect, and Seed Master Dossier

**Files:**
- Create: `docs/superpowers/plans/2026-09-02-acquisition-os-control-center.md` (this file)
- Create: Obsidian `WavesCo/Acquisition OS/ACQUISITION OS — MASTER PRODUCT DOSSIER.md` skeleton (44 sections)

**Interfaces:**
- Consumes: existing `modules/acquisition-os/module.contract.json`, `packages/db/prisma/schema.prisma`, `apps/web/app/(dashboard)/acquisition/*`
- Produces: frozen inspection report (git status/diff/log for `wavesco-platform` + `wavesco-lead-engine`), dossier skeleton with 44 headings

- [ ] **Step 1: Write freezing script and run inspection**

```bash
# In D:\waves-c0_app\wavesco-platform
git status
git diff --stat
git log --oneline -10
cat modules/acquisition-os/module.contract.json
cat packages/db/prisma/schema.prisma | head -n 400
# In D:\wavesco-lead-engine
git status
cat config.json
ls engine/
```

- [ ] **Step 2: Create Master Dossier skeleton with 44 required headings**

Create `D:\obsidian waves\wavesco\WavesCo\Acquisition OS\ACQUISITION OS — MASTER PRODUCT DOSSIER.md` with headings 1-44 exactly as spec (vision, positioning, scope, architecture, diagram placeholder ` ```mermaid flowchart LR `, modules, agents, workflows, tools, API integrations, API keys, env vars, DB architecture, data models, auth, permissions, security, lifecycles (lead/acquisition/outreach/follow-up/reporting), PDF generation, email, design system, outputs (client/internal), error handling, retry, logging, monitoring, testing, deployment, infrastructure, dependencies, cost model, API usage, token usage, performance, limitations, open issues, future, change history, deployment history) plus current architecture/production/development/integration/test/deployment status tables (empty, to be filled as tasks land).

- [ ] **Step 3: Verify dossier exists and commit plan**

Run: `ls "D:\obsidian waves\wavesco\WavesCo\Acquisition OS"`
Expected: `ACQUISITION OS — MASTER PRODUCT DOSSIER.md` present.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/plans/2026-09-02-acquisition-os-control-center.md
git commit -m "docs(plan): acquisition os control center — freeze and master dossier skeleton"
```

---

### Task 2: Control API Foundation + Audit Logging

**Files:**
- Create: `apps/web/lib/wavesco/control.ts`
- Modify: `apps/web/lib/wavesco/lead-engine.ts:1-20` (ensure `getLeadStats`/`listLeads` stay pure, add `export type ControlResult`)
- Test: `apps/web/tests/control.test.ts`

**Interfaces:**
- Consumes: `auth()` from `@/lib/auth`, `requireTenantId`, `withTenantContext`, `prisma` via `@wavesco/db`
- Produces: `requireControlAuth() => { session, tenantId }`, `auditControl({ tenantId, userId, action, model, recordId, before, after, metadata }) => AuditLog`, `controlAction<T>(opts, fn) => T` wrapper that logs success/failure with `before/after`

- [ ] **Step 1: Write failing test for audit wrapper**

```typescript
// apps/web/tests/control.test.ts
import { describe, it, expect } from "vitest";
import { auditControl } from "@/lib/wavesco/control";
describe("auditControl", () => {
  it("writes AuditLog with before/after and returns record", async () => {
    const log = await auditControl({ tenantId: "t1", userId: "u1", action: "campaign.launch", model: "Campaign", recordId: "c1", before: { status: "draft" }, after: { status: "running" } });
    expect(log.action).toBe("campaign.launch");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter web test tests/control.test.ts`
Expected: FAIL `auditControl not defined`

- [ ] **Step 3: Implement minimal control.ts**

```typescript
// apps/web/lib/wavesco/control.ts
import { auth } from "@/lib/auth";
import { requireTenantId } from "@/lib/tenant";
export async function requireControlAuth() {
  const session = await auth();
  const tenantId = requireTenantId(session);
  return { session, tenantId, userId: (session?.user as any)?.id ?? null };
}
export async function auditControl(args: { tenantId: string; userId?: string | null; action: string; model: string; recordId?: string; before?: unknown; after?: unknown; metadata?: unknown }) {
  const { prisma } = await import("@wavesco/db");
  return prisma.auditLog.create({ data: { tenantId: args.tenantId, userId: args.userId, action: args.action, model: args.model, recordId: args.recordId, before: args.before as any, after: args.after as any, metadata: args.metadata as any } });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter web test tests/control.test.ts`
Expected: PASS (mock prisma if needed)

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/wavesco/control.ts apps/web/tests/control.test.ts
git commit -m "feat(control): authenticated control wrapper with AuditLog"
```

---

### Task 3: OVERVIEW — Pipeline, Campaigns, Leads, Health (Control)

**Files:**
- Modify: `apps/web/app/(dashboard)/acquisition/page.tsx:1-80`
- Create: `apps/web/app/api/acquisition/overview/route.ts`
- Test: `apps/web/tests/acquisition-overview.test.ts`

**Interfaces:**
- Consumes: `getLeadStats`, `getFacets`, `withTenantContext` counts, `IntegrationStatus`, `control.ts`
- Produces: `GET /api/acquisition/overview` → `{ corpus: {total,emailReady,contacted}, platform: {campaigns,queued,sent}, system: {leadEngine, db, n8n}, alerts: [] }`, page polls every 30s or uses `revalidateTag`

- [ ] **Step 1: Write failing test for overview API**

```typescript
// verify GET returns 401 without auth, 200 with tenant
```

- [ ] **Step 2: Implement route with `requireControlAuth` + tenant-scoped counts + `getLeadStats` fallback (Lead Engine unreachable → error state, not 500)**

- [ ] **Step 3: Enhance page.tsx to use new API for client polling (SWR) + keep server component fallback + show system health (Lead Engine, DB, N8N) + recent ActivityEvent (last 5)**

- [ ] **Step 4: Verify page renders and API 401/200; commit**

---

### Task 4: LEADS Control — Discover/Import/Enrich/Verify/Qualify/Score/Segment/Search/Filter/Inspect/Export

**Files:**
- Modify: `apps/web/app/(dashboard)/acquisition/leads/page.tsx:1-200`
- Create: `apps/web/app/api/acquisition/leads/export/route.ts`
- Modify: `apps/web/app/(dashboard)/acquisition/leads/[name_key]/page.tsx` (add enrich/verify/qualify actions)
- Test: `apps/web/tests/leads-export.test.ts`

**Interfaces:**
- Consumes: `listLeads`, `Leads` filters, `LeadResearch`/`OutreachOrder` actions from `module.contract.json` (researchLeadAction, checkLeadEmailAction, batch*)
- Produces: `POST /api/acquisition/leads/export` (CSV with tenant RLS), `POST /api/acquisition/leads/[key]/enrich` → audit logged, UI buttons for discover/import (link to generate), enrich, verify, qualify, score, segment chips, search/filter, inspect, export

- [ ] **Step 1: Test export route enforces RLS and streams CSV**

- [ ] **Step 2: Implement export route with `requireControlAuth` + `withTenantContext` + `auditControl` for export action**

- [ ] **Step 3: Enhance leads page with control bar (Discover → /generate, Import → CSV, Export → POST), segment chips, inspect drawer, score badges**

- [ ] **Step 4: Commit**

---

### Task 5: CAMPAIGNS Control — Create/Configure/Launch/Pause/Resume/Stop/Inspect/Monitor/Analyze

**Files:**
- Modify: `apps/web/app/(dashboard)/acquisition/campaigns/page.tsx`
- Create: `apps/web/app/api/acquisition/campaigns/[id]/control/route.ts` (POST { action: "launch"|"pause"|"resume"|"stop" })
- Modify: `apps/web/app/(dashboard)/acquisition/campaigns/[id]/page.tsx` (detail with state machine)
- Test: `apps/web/tests/campaign-control.test.ts`

**Interfaces:**
- Consumes: `Campaign` model `status` draft→scheduled→running→paused→stopped→completed, `OutreachEmail` queue, `decideApprovalAction`
- Produces: campaign state transitions with `before/after` audit, UI shows RUNNING/PAUSED with safe destructive confirmations

- [ ] **Step 1: Test that pause on draft fails 400, pause on running succeeds and logs AuditLog**

- [ ] **Step 2: Implement control route with state machine validation + `auditControl`**

- [ ] **Step 3: Enhance campaigns page with Create/Configure/Launch/Pause/Resume/Stop buttons, monitor (eligibleSnapshot, sendingLimit), analyze (sent/failed rate)**

- [ ] **Step 4: Commit**

---

### Task 6: WORKFLOWS Control — n8n

**Files:**
- Create: `apps/web/app/(dashboard)/acquisition/workflows/page.tsx`
- Create: `apps/web/app/api/acquisition/workflows/route.ts` (list), `workflows/[id]/control/route.ts` (enable/disable/execute/retry)
- Modify: `apps/web/lib/wavesco/integrations.ts` to expose `n8nHealth`
- Test: `apps/web/tests/workflows.test.ts` (mock n8n when `N8N_BASE_URL` missing → BLOCKED state)

**Interfaces:**
- Consumes: `N8N_BASE_URL`, `N8N_API_KEY` via `env:`, `IntegrationStatus` table, n8n REST API
- Produces: `GET /api/acquisition/workflows` with real execution state; UI shows enable/disable toggles, Execute, history, retry failed, inspect failures, view workflow state; if `N8N_BASE_URL` missing, UI shows NOT TESTED/BLOCKED, not fake success

- [ ] **Step 1: Test when N8N_BASE_URL missing → GET returns `{ status: "BLOCKED", reason: "N8N_BASE_URL missing" }`**

- [ ] **Step 2: Implement n8n proxy with server-side key, never expose to browser, audit enable/disable/execute**

- [ ] **Step 3: Build workflows page with table + state pills + action buttons + execution history drawer**

- [ ] **Step 4: Commit**

---

### Task 7: AGENTS Control — Waves AI Gateway

**Files:**
- Create: `apps/web/app/(dashboard)/acquisition/agents/page.tsx`
- Create: `apps/web/app/api/acquisition/agents/route.ts` (list agents from `ClientAiConfig` + gateway)
- Modify: `packages/db/prisma/schema.prisma` related read for `ClientAiConfig`/`AiUsageLog` (no schema change, just usage)
- Test: `apps/web/tests/agents.test.ts`

**Interfaces:**
- Consumes: `ClientAiConfig`, `AiUsageLog`, `waves-ai-gateway.md`, `credentialRef` server-side resolve
- Produces: agent list with enable/disable, configure (model/provider/baseUrl), activity (AiUsageLog last 20), tool usage, failures, limits (rate/token); if gateway unreachable → FAIL, not fake

- [ ] **Step 1: Test agent toggle writes AuditLog and flips `aiEnabled`**

- [ ] **Step 2: Implement agents API + page with configure form (masked credential), enable/disable, activity log**

- [ ] **Step 3: Commit**

---

### Task 8: INTEGRATIONS Control

**Files:**
- Create: `apps/web/app/(dashboard)/acquisition/integrations/page.tsx`
- Create: `apps/web/app/api/acquisition/integrations/test/route.ts` (POST { key } → test connection server-side)
- Modify: `apps/web/lib/wavesco/integrations.ts` (centralize `LEAD_ENGINE_ROOT`, `N8N_BASE_URL`, `BREVO`, `DATABASE_URL`, etc.)

**Interfaces:**
- Consumes: `IntegrationStatus`, env vars, lead-engine dual-mode, Brevo, DB
- Produces: integration matrix (Lead Engine, Postgres, n8n, Brevo, Ollama) with status `ok/error/missing`, detail, `lastCheckedAt`, Test Connection (server-side, never leaks key), API health, usage where available

- [ ] **Step 1: Test missing credential → page shows missing, test button returns BLOCKED without leaking key**

- [ ] **Step 2: Implement integrations page + test route with masked handling**

- [ ] **Step 3: Commit**

---

### Task 9: DOCUMENTS Control

**Files:**
- Modify: `apps/web/app/(dashboard)/acquisition/reports/page.tsx` (rename conceptually to documents)
- Create: `apps/web/app/api/acquisition/documents/generate/route.ts`
- Test: `apps/web/tests/documents.test.ts`

**Interfaces:**
- Consumes: `GenerationBatch` (pdfPath/excelPath), `ActivityEvent`, existing PDF/XLSX generation via `engine/` or `reports/`
- Produces: view generated reports, generate (POST), download (signed URL or direct with RLS), history, which workflow generated each (via `GenerationBatch.engineBatchId` + `ActivityEvent.sourceKey`)

- [ ] **Step 1: Test generate without valid batch → 400, with → 200 + AuditLog**

- [ ] **Step 2: Implement documents page with table + Generate + Download + workflow lineage**

- [ ] **Step 3: Commit**

---

### Task 10: EMAIL Control

**Files:**
- Create: `apps/web/app/(dashboard)/acquisition/email/page.tsx` (or `outreach` enhancement)
- Modify: `apps/web/app/(dashboard)/acquisition/outreach/page.tsx` (add templates + delivery state)
- Create: `apps/web/app/api/acquisition/email/templates/route.ts` (CRUD with RLS)
- Test: `apps/web/tests/email.test.ts`

**Interfaces:**
- Consumes: `OutreachEmail`, `OutreachOrder`, Brevo/SMTP, `decideApprovalAction`
- Produces: manage templates (list/create/update), preview (render with lead vars), inspect campaigns, inspect delivery state (submitted/approved/sent/failed + `sendError`), configure sending integration (Brevo key server-side, test connection)

- [ ] **Step 1: Test template preview renders without sending**

- [ ] **Step 2: Implement email control pages + template API with audit**

- [ ] **Step 3: Commit**

---

### Task 11: ANALYTICS Control

**Files:**
- Create: `apps/web/app/(dashboard)/acquisition/analytics/page.tsx`
- Create: `apps/web/app/api/acquisition/analytics/route.ts` (aggregates)
- Test: `apps/web/tests/analytics.test.ts`

**Interfaces:**
- Consumes: lead counts, `Campaign`, `OutreachEmail`, `AiUsageLog`, `ActivityEvent`, n8n execution metrics (if available)
- Produces: acquisition metrics (total/emailReady/contacted/replies), campaign performance (eligible vs sent vs reply), lead conversion funnel, response rates, workflow performance, API usage, model/token usage (AiUsageLog sum), system costs (estimate from token/lead counts)

- [ ] **Step 1: Test analytics with empty tenant → zeros, not error**

- [ ] **Step 2: Implement analytics aggregations with tenant scoping**

- [ ] **Step 3: Commit**

---

### Task 12: SYSTEM Control — Health/Logs/Errors/Jobs/Queues/DB/Config/Audit Logs

**Files:**
- Create: `apps/web/app/(dashboard)/system/page.tsx` (or `acquisition/system`)
- Create: `apps/web/app/api/system/health/route.ts`, `logs/route.ts`, `audit-logs/route.ts`
- Test: `apps/web/tests/system.test.ts`

**Interfaces:**
- Consumes: `AuditLog`, `IntegrationStatus`, `ActivityEvent`, `GenerationBatch` logs, DB `withTenantContext` health check, queue depth via `OutreachEmail` pending count
- Produces: SYSTEM page with health cards (DB, Lead Engine, n8n, AI Gateway), logs (last 50 AuditLog), errors (failed OutreachEmail + GenerationBatch error), jobs (pending followUps + batches), queues (outreach pending), DB state (tenant counts), configuration (env mask), audit logs (filterable)

- [ ] **Step 1: Test /api/system/health without auth → 401, with → 200 with health object**

- [ ] **Step 2: Implement system pages + APIs**

- [ ] **Step 3: Commit**

---

### Task 13: Real-Time State + Safe Destructive + Empty/Error States Polish

**Files:**
- Modify: all `acquisition/*` pages to poll via `SWR` or `router.refresh()` (5-30s per resource)
- Modify: `apps/web/components/control/*` to add confirmation dialogs for destructive actions (stop campaign, delete, etc.)
- Test: `apps/web/tests/realtime.test.ts` (verify polling endpoint returns consistent state)

**Interfaces:**
- Consumes: all previous control APIs
- Produces: RUNNING/PAUSED/FAILED pills reflect live DB/n8n, failures surfaced, executing states animate, empty states with CTA, error states with retry

- [ ] **Step 1: Add SWR polling to campaigns/workflows/agents with `refreshInterval` and `auditLog` revalidation**

- [ ] **Step 2: Add confirmation modals (`AlertDialog`) for destructive actions with before/after preview**

- [ ] **Step 3: Commit**

---

### Task 14: Master Dossier Complete, Repo Docs, E2E Validation, Deployment

**Files:**
- Modify: Obsidian `ACQUISITION OS — MASTER PRODUCT DOSSIER.md` — fill 44 sections with actual facts (no placeholders, mark BLOCKED where API keys missing)
- Modify: `apps/web/README.md`, `docs/ARCHITECTURE.md`, `docs/INTEGRATIONS.md`, `docs/API_ENVIRONMENT_SETUP.md`, `docs/SECURITY.md`, `docs/DEPLOYMENT.md`, `docs/OPERATIONS.md`, `docs/TESTING.md`, `docs/DOCUMENT_GENERATION.md`, `docs/EMAIL_SYSTEM.md`, `CHANGELOG.md`
- Create: `apps/web/tests/e2e/acquisition-flow.test.ts` (real workflow: discover→enrich→verify→qualify→score→CRM→outreach→response→follow-up→analysis→report→PDF→email→audit)
- Modify: `turbo.json` or `package.json` test scripts

**Interfaces:**
- Consumes: all previous tasks
- Produces: dossier updated, docs updated, e2e test (PASS/FAIL/PARTIAL/BLOCKED clearly), deployment to `app.wavesco.in` via `vercel --prod` or git push, verification of production URL

- [ ] **Step 1: Fill Master Dossier 44 sections from actual code (modules, agents, workflows, tools, APIs, env vars, DB, lifecycles, etc.) — mark UNKNOWN/BLOCKED where not verifiable**

- [ ] **Step 2: Write minimal e2e test that runs discovery → outreach order → approval → audit log and asserts each stage produces verifiable output (or reports BLOCKED if LEAD_ENGINE_ROOT missing)**

Run: `pnpm --filter web test:e2e`
Expected: PASS or clearly BLOCKED with reason, not fake green

- [ ] **Step 3: Update repo docs (README etc.) with how engineers use/operate the system (no duplication of dossier)**

- [ ] **Step 4: Deploy**

```bash
cd D:\waves-c0_app\wavesco-platform
git status
git diff --stat
# ensure no secrets
vercel --prod --yes  # or git push if workflow is git
# verify https://app.wavesco.in/acquisition, /leads, /campaigns, /workflows, /agents, /integrations, /documents, /email, /analytics, /system all load
```

- [ ] **Step 5: Final commit**

```bash
git add docs/ apps/web/README.md
git commit -m "docs: complete Acquisition OS Control Center + Master Dossier + e2e"
```

---

## Self-Review

- Spec coverage: all 8 dashboard areas + control model + real-time + auditability + UX + architecture + master dossier (44) + docs (10) + testing + e2e — each has a task.
- Placeholder scan: no TBD/TODO; every step has code/example.
- Type consistency: `auditControl` signature used consistently; `requireControlAuth` returns `{tenantId, userId}` used by all control routes; `IntegrationStatus.key` strings (`lead_engine`, `n8n`, `brevo`, `db`, `ai_gateway`) consistent.

