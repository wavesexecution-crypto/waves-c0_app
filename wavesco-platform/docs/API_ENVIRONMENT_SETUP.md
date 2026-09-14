# API & Environment Setup

## Local prerequisites

- Node ≥20, pnpm 11.18.0, Docker (for Postgres)
- Copy env: `cp .env.example .env`
- Secrets: `pnpm generate:secrets` (fills `AUTH_SECRET`/`NEXTAUTH_SECRET`/`JWT_SECRET` ≥32 chars)
- DB: `docker compose up -d` (Postgres 16 on `:5433`, RLS `wavesco_app`)
- Migrate: `pnpm --filter @wavesco/db db:migrate` (uses `DIRECT_URL` migration role `wavesco`)
- Lead Engine (local): `D:\wavesco-lead-engine` with `data/leads.db` present (default `LEAD_ENGINE_ROOT=D:\wavesco-lead-engine`; keep `LEAD_ENGINE_MODE=local`)
- Lead Engine (remote, prod): `LEAD_ENGINE_MODE=remote`, `LEAD_ENGINE_API_URL` (production: `https://engine.wavesco.in` via the `acquisition-lead-engine` Cloudflare Tunnel) + `LEAD_ENGINE_API_TOKEN` Bearer
- n8n (optional locally): run at `http://localhost:5678`, set `N8N_BASE_URL` + `N8N_API_KEY` (Create in n8n Settings → n8n API)
- AI Gateway: set `OPENAI_API_KEY` + `OPENAI_BASE_URL=https://ollama.com/v1` + `OPENAI_MODEL=gemma4:31b` (Ollama Cloud) or tenant `ClientAiConfig` with `credentialRef=env:OPENAI_API_KEY`

## Required vs optional env

| Var | Required? | Where |
|-----|-----------|-------|
| `DATABASE_URL` (pooled `wavesco_app?pgbouncer=true`) + `DIRECT_URL` (`wavesco`) | required | `packages/db` RLS + migrations |
| `AUTH_SECRET` (+ alias `NEXTAUTH_SECRET` + `JWT_SECRET`) | required | `auth.ts` + `middleware.ts` |
| `LEAD_ENGINE_ROOT` (local) *or* `LEAD_ENGINE_API_URL`+`TOKEN` (remote via `LEAD_ENGINE_MODE`) | required via `modules/acquisition-os requiresEnv` | `apps/web/lib/wavesco/lead-engine.ts` |
| `N8N_BASE_URL` | required via contract (still BLOCKED until set; workflows fallback to manifest inventory) | `apps/web/lib/wavesco/n8n.ts` |
| `N8N_API_KEY` | needed for live `/api/v1/workflows` reads | `X-N8N-API-KEY` server-side |
| `BREVO_API_KEY` | needed for Brevo dispatch + webhook `/api/webhooks/brevo` | `lib/wavesco/integrations.ts brevoHealth()` |
| `OPENAI_*` + `LEAD_ENGINE_GATEWAY_TOKEN`/`WAVESCO_ENGINE_TENANT` | needed for AI Gateway | `lib/ai/gateway.ts` |

Empty values in `.env.example` → BLOCKED in UI until operator sets them (never fake success).

## Vercel (production)

- Project `waves-c0-app` (`team_4yzMS5Im7cXbCms5w6U4iWsR` / `prj_4MAbxJuodhhBJUpEhCH8MQuCpMBQ`), alias `https://app.wavesco.in`.
- Build: `pnpm --filter @wavesco/db db:generate && next build && node scripts/copy-prisma-engine.mjs` (`vercel.json`).
- Env: `vercel env ls` (`DATABASE_URL`, `DIRECT_URL`, `NEXTAUTH_URL`, `AUTH_SECRET`, `JWT_SECRET`, `LEAD_ENGINE_* remote`, `OPENAI_*` are SET; `N8N_*`, `BREVO_*` BLOCKED until added).
- Add secret: `vercel env add N8N_BASE_URL production` → redeploy `vercel --prod --yes` (or `git push origin main`).
- Verify: `curl https://app.wavesco.in/acquisition` after auth (auth guard redirects `/login` unauth).

## APIs (control)

All require `auth() + requireTenantId + withTenantContext`; 401 without auth, 400 on state-machine violation, 500 on DB error (detail sliced 200).

| Method & path | Purpose |
|---------------|---------|
| `GET /api/acquisition/overview` | Corpus + platform + system health snapshot |
| `POST /api/acquisition/leads/export` | Tenant-scoped CSV (max 1000) of `LeadResearch` + `auditControl leads.export` |
| `POST /api/acquisition/campaigns/[id]/control` `{ action: launch|pause|resume|stop }` | State machine `draft→scheduled→running→paused→stopped→completed` + AuditLog before/after |
| `GET /api/acquisition/workflows` + `POST /api/acquisition/workflows/[id]/control` | n8n proxy (server-side key) + AuditLog |
| `GET /api/acquisition/agents` + `POST /api/acquisition/agents/control` | AI Gateway per-tenant + AuditLog |
| `POST /api/acquisition/integrations/test` `{ key }` | Server-side Test Connection masked |
| `POST /api/acquisition/documents/generate` | Generate `GenerationBatch` artifacts + AuditLog |
| `GET|POST /api/acquisition/email/templates` | Templates CRUD tenant-scoped + preview |
| `GET /api/acquisition/analytics` | Acquisition/campaign/funnel/workflow/token/cost aggregates |
| `GET /api/system/health` `|/logs?limit=50` `|/audit-logs?limit=50&action=&model=` | Health + ActivityEvent + AuditLog filterable |

See `docs/ARCHITECTURE.md` for flow, `docs/SECURITY.md` for masking.

