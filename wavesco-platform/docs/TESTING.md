# Testing — Acquisition OS

## Suites

- **Unit/control (Vitest 2.1.9, `apps/web/vitest.config.mts` `include: tests/**/*.test.ts`, alias `@`):** 16 suites pre-E2E + 1 E2E = 17 suites, 103 tests (2026-09-02).

| Suite | File | Focus |
|-------|------|-------|
| control | `tests/control.test.ts` | `requireControlAuth` + `auditControl` before/after |
| overview | `tests/acquisition-overview.test.ts` | `GET /api/acquisition/overview` 401 vs 200 |
| leads | `tests/leads-export.test.ts` | `POST /api/acquisition/leads/export` RLS, CSV max 1000 |
| campaigns | `tests/campaign-control.test.ts` | `POST /api/acquisition/campaigns/[id]/control` state machine (pause on draft 400) |
| workflows | `tests/workflows.test.ts` | `GET /api/acquisition/workflows` BLOCKED when `N8N_BASE_URL` missing |
| agents | `tests/agents.test.ts` | `GET /api/acquisition/agents` toggle `aiEnabled` + AuditLog |
| integrations | `tests/integrations.test.ts` | `POST /api/acquisition/integrations/test` 401 vs audit masked |
| documents | `tests/documents.test.ts` | `POST /api/acquisition/documents/generate` 401/400/200 + AuditLog |
| email | `tests/email-templates.test.ts` | `GET|POST /api/acquisition/email/templates` preview without send |
| analytics | `tests/analytics.test.ts` | `GET /api/acquisition/analytics` empty tenant zeros |
| system | `tests/system.test.ts` | `GET /api/system/health` 401 vs 200 + logs/audit |
| realtime | `tests/realtime.test.ts` | Polling endpoint consistent state |
| gateway | `tests/gateway.test.ts` | `wavesAi` disabled before provider |
| pipeline/smart/verify | `tests/pipeline-email-check.test.ts` etc. | Domain logic |
| e2e | `tests/e2e/acquisition-flow.test.ts` | See below |

## Run

```bash
pnpm --filter web test           # 17 suites, 103 tests, ~6s (collect 4.5s, tests 6.1s)
pnpm --filter web test:e2e       # 3 tests e2e only (~1.3s)
pnpm --filter web test tests/control.test.ts  # single suite
```

Scripts: `apps/web/package.json` `test: vitest run`, `test:e2e: vitest run tests/e2e/acquisition-flow.test.ts`; `turbo.json` `test: {}` + `test:e2e: { cache:false }`.

## E2E acquisition flow (Task 14)

File `apps/web/tests/e2e/acquisition-flow.test.ts`:

- Mocks `lead-engine` (`getLeadStats` avoids `node:sqlite` in Vitest) + `@wavesco/db` (in-memory `outreachOrder`/`auditLog`) + `control` (`auditControl`) — no live Postgres or next-auth required.
- Flow: `getLeadStats` (discover) → `OutreachOrder create` (enrich→verify→qualify→score→CRM→outreach) → `auditControl(outreach_order.create.e2e)` (response→follow-up→analysis→report→PDF→email→audit) → `withTenantContext auditLog.count`.
- Asserts verifiable outputs on every stage (stats shape, order status `READY_FOR_APPROVAL`, audit action, audit count) **or** reports `BLOCKED` when `LEAD_ENGINE_ROOT` missing in remote mode (env deletion branch). Pass = `3 passed`, not fake green.
- Also deterministic `BLOCKED` branch test (delete `LEAD_ENGINE_ROOT` + remote mode without URL → blocked true).

## Distinguishing outcomes

- `PASS` = 200 with tenant-scoped state, `FAIL` = violation (400), `BLOCKED` = env missing (surface `BLOCKED` reason, not error), `NOT TESTED` = integration not reachable. Tests assert `401 without auth`, `BLOCKED when N8N_BASE_URL missing`, `400 when pause on draft` — never infer `ok` when unreachable.

## CI note

Lead Engine SQLite not exercised in Vitest (`node:sqlite`); live `data/leads.db` presence checked via `Test-Path D:\wavesco-lead-engine\data\leads.db` (True). n8n live not probed (BLOCKED).

