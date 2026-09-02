# Changelog — WavesCo Platform (Acquisition OS Control Center)

All notable changes beyond pre-freeze (since `29ba04d chore: redeploy with synced DB env`).

## [Unreleased] — 2026-09-02 Acquisition OS Control Center

### Added
- **Control API foundation** (`0387def`) — `apps/web/lib/wavesco/control.ts` `requireControlAuth` + `auditControl` (writes `AuditLog before/after`), tests `tests/control.test.ts` (3 passing).
- **Overview control** (`25bd67b`) — `GET /api/acquisition/overview` (corpus `getLeadStats` + platform `campaign/outreach/followUp` + system `leadEngine/db/n8n`) + page `apps/web/app/(dashboard)/acquisition/page.tsx` with `AutoRefresh 30s` + `OverviewLive` polling, tests `tests/acquisition-overview.test.ts`.
- **Leads control** (`d7f7ee6`) — `POST /api/acquisition/leads/export` tenant-scoped CSV (max 1000, audit `leads.export`) + control bar (Discover/Import/Export/Segment chips Tier A/B/C) + `leads/[nameKey]` enrich/verify/qualify actions, tests `tests/leads-export.test.ts` (RLS).
- **Campaigns control** (`7aa9018`) — `POST /api/acquisition/campaigns/[id]/control` state machine `draft→scheduled→running→paused→stopped→completed` with `before/after` AuditLog, pages `campaigns/page.tsx` launch/pause/resume/stop + detail, tests `tests/campaign-control.test.ts` (9).
- **Workflows (n8n)** (`335e8ef`) — `GET /api/acquisition/workflows` + `POST .../workflows/[id]/control` (enable/disable/execute/retry) server-side `N8N_API_KEY`, manifest fallback `D:\n8n-personal-automations\workflows-manifest.json` when `N8N_BASE_URL` missing → `BLOCKED`, tests `tests/workflows.test.ts`.
- **Agents (Waves AI Gateway)** (`73cd9f2`) — `GET /api/acquisition/agents` + `POST /api/acquisition/agents/control` (tenant `ClientAiConfig aiEnabled/provider/credentialRef env:VAR`), activity `AiUsageLog`, tests `tests/agents.test.ts` (10).
- **Integrations health** (`6cdafb9`) — `apps/web/lib/wavesco/integrations.ts` `getIntegrationsHealth/computeIntegrationStatuses` (lead_engine/n8n/brevo/db/ai_gateway masked) + `POST /api/acquisition/integrations/test` masked Test Connection + `AuditLog`, tests `tests/integrations.test.ts`.
- **Documents** (`8f4fc5c`) — `POST /api/acquisition/documents/generate` (validates `GenerationBatch`, lineage `engineBatchId→ActivityEvent.sourceKey`) + page `reports/page.tsx` (generate/download/history), tests `tests/documents.test.ts`.
- **Email** (`12845b3`) — `GET|POST /api/acquisition/email/templates` CRUD tenant-scoped + preview (lead vars without send) + delivery states `submitted/approved/sent/failed + sendError` + `decideApprovalAction`, page `email/page.tsx` + `outreach/page.tsx`, tests `tests/email-templates.test.ts`.
- **Analytics** (`7a03762`) — `GET /api/acquisition/analytics` aggregates (acquisition `getLeadStats`, campaign `eligibleSnapshot`, funnel, workflow `byType/byState`, api usage, model/token `AiUsageLog` last 200 by `provider:model`, costs `token*0.00002 + lead*0.005`), page `analytics/page.tsx`, tests `tests/analytics.test.ts`.
- **System** (`ec0fa53`) — `GET /api/system/health|logs|audit-logs` + page `system/page.tsx` (health cards masked, ActivityEvent last 50, errors `OutreachEmail+GenerationBatch failed`, jobs `pending FollowUp+Batch`, queues `OutreachEmail pending`, DB counts, masked env table, filterable AuditLog), tests `tests/system.test.ts`.
- **Real-time + polish** (`5255c56`) — SWR `AutoRefresh intervalMs={15000|30000}` / `router.refresh()` on all 10 pages + `components/control/confirm-dialog.tsx` (155 lines) for destructive actions + empty/error states (CTA, retry, BLOCKED pills), tests `tests/realtime.test.ts`.
- **E2E + Dossier + Docs + Deployment** (this release) — `apps/web/tests/e2e/acquisition-flow.test.ts` (3 tests: discover→enrich→verify→qualify→score→CRM→outreach→response→follow-up→analysis→report→PDF→email→audit, each stage verifiable or `BLOCKED` when `LEAD_ENGINE_ROOT` missing; `pnpm --filter web test:e2e` PASS, `pnpm --filter web test` 103/103), filled Master Dossier 44 sections (`WavesCo/Acquisition OS/ACQUISITION OS — MASTER PRODUCT DOSSIER.md` 86773 bytes, snapshot `docs/ACQUISITION_OS_MASTER_DOSSIER_SNAPSHOT.md`), updated repo docs (`apps/web/README.md`, `docs/ARCHITECTURE.md`, `docs/INTEGRATIONS.md`, `docs/API_ENVIRONMENT_SETUP.md`, `docs/SECURITY.md`, `docs/DEPLOYMENT.md`, `docs/OPERATIONS.md`, `docs/TESTING.md`, `docs/DOCUMENT_GENERATION.md`, `docs/EMAIL_SYSTEM.md`), `turbo.json: test:e2e` + `apps/web/package.json: test:e2e`, deployment `vercel --prod --yes` to `https://app.wavesco.in` (alias `waves-c0-app`, build `pnpm --filter @wavesco/db db:generate && next build && node scripts/copy-prisma-engine.mjs`).

### Infra / config
- `turbo.json` `globalEnv` extended `LEAD_ENGINE_MODE, LEAD_ENGINE_API_URL/TOKEN` + `test:e2e: { cache:false }`.
- Build guards: `next build --turbopack`, `transpilePackages: [@wavesco/ui,@wavesco/db,@wavesco/auth,@wavesco/validators]`, `vercel.json` buildCommand.
- Env prod (`vercel env ls` 2026-09-02): `DATABASE_URL, DIRECT_URL, NEXTAUTH_URL, AUTH_SECRET, NEXTAUTH_SECRET, JWT_SECRET, LEAD_ENGINE_* remote, OPENAI_*` SET; `N8N_BASE_URL, N8N_API_KEY, BREVO_API_KEY, OBSIDIAN_*` BLOCKED.

### Tests
- 16 suites 100 passed (pre-E2E) → 17 suites 103 passed (post-E2E, inc. `tests/e2e/acquisition-flow.test.ts` 3). All control routes 401 without auth; BLOCKED when env missing (not fake success).

## Prior baseline

- `29ba04d 2026-08-30` — freeze: `chore: redeploy with synced DB env for lead engine verification` (remote dual-mode).
- Plan seed: `f1a1dc5 2026-09-02` — `docs(plan): acquisition os control center — freeze and master dossier skeleton` (44 headings, Freeze Evidence).
- See `docs/superpowers/plans/2026-09-02-acquisition-os-control-center.md` for task ledger (14 tasks).
