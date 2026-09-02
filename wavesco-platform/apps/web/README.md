# WavesCo Web — Acquisition OS Control Center

Next.js 15.1.6 App Router + Prisma 6.2.1 + Neon Postgres (RLS) — hosted `waves-c0-app` → `https://app.wavesco.in`.

## Quick start (engineer)

```bash
cp .env.example .env        # then fill DATABASE_URL, AUTH_SECRET etc.
pnpm generate:secrets       # fills AUTH_SECRET / NEXTAUTH_SECRET / JWT_SECRET
docker compose up -d        # Postgres 16 on :5433 (DATABASE_URL → wavesco_app)
pnpm --filter @wavesco/db db:migrate
pnpm dev                    # http://localhost:3000
```

Requires Node ≥20, pnpm 11.18.0.

## Control Center routes

- `/acquisition` — overview pipeline + health (AutoRefresh 30s, `GET /api/acquisition/overview`)
- `/acquisition/leads` — live corpus `lead-engine.ts` (search/filter, `POST /api/acquisition/leads/export` tenant-scoped CSV max 1000)
- `/acquisition/campaigns` — create/launch/pause/resume/stop (`POST /api/acquisition/campaigns/[id]/control` state machine + AuditLog)
- `/acquisition/workflows` — n8n workflows (`GET /api/acquisition/workflows`, BLOCKED if `N8N_BASE_URL` missing)
- `/acquisition/agents` — Waves AI Gateway `ClientAiConfig` enable/disable (`POST /api/acquisition/agents/control`)
- `/acquisition/integrations` — health matrix + `POST /api/acquisition/integrations/test` masked
- `/acquisition/reports` (Documents) — `GenerationBatch` lineage (`POST /api/acquisition/documents/generate`)
- `/acquisition/email` + `outreach` — templates CRUD + delivery (`POST /api/acquisition/email/templates`)
- `/acquisition/analytics` — funnel + costs (`GET /api/acquisition/analytics`)
- `/system` — health/logs/errors/jobs/queues/db/config/audit logs (`GET /api/system/health|logs|audit-logs`)

All control APIs enforce `auth() + requireTenantId + withTenantContext` and write `AuditLog` before/after.

## Env (see `docs/API_ENVIRONMENT_SETUP.md`)

Local `LEAD_ENGINE_MODE=local` reads `D:\wavesco-lead-engine\data\leads.db`; prod `remote` calls `LEAD_ENGINE_API_URL` Bearer. Required in `.env`: `DATABASE_URL`, `DIRECT_URL`, `AUTH_SECRET`, `LEAD_ENGINE_ROOT` or `LEAD_ENGINE_API_URL`, `N8N_BASE_URL` (for workflows), `OPENAI_*` (for AI Gateway).

## Operate

- **Test:** `pnpm --filter web test` (103 tests, 17 suites) · `pnpm --filter web test:e2e` (E2E discover→audit or BLOCKED)
- **Build:** `pnpm build` → `turbo` + `db:generate` + `copy-prisma-engine.mjs` (vercel build does this)
- **Deploy:** `vercel --prod --yes` (or `git push origin main`) — verify `https://app.wavesco.in/acquisition` etc. after auth
- **DB:** `pnpm db:studio` (Prisma Studio), `pnpm db:migrate`

No secrets in repo; `git diff --stat` before deploy must not show `.env`.

## More docs

- `docs/ARCHITECTURE.md` — system diagram + control flow
- `docs/INTEGRATIONS.md` — matrix + Test Connection
- `docs/SECURITY.md` — RLS, credentialRef, masking
- Master Dossier — `WavesCo/Acquisition OS/ACQUISITION OS — MASTER PRODUCT DOSSIER.md` (44 sections) + snapshot `docs/ACQUISITION_OS_MASTER_DOSSIER_SNAPSHOT.md`
