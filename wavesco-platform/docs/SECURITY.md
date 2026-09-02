# Security — Acquisition OS

## Multitenancy (RLS)

- Runtime role `wavesco_app` does NOT own tables → RLS enforced (migrations). `withTenantContext(tenantId, tx => ...)` does `SET LOCAL app.tenant_id` per transaction. All module tables carry `tenantId`; every query includes `where:{ tenantId }`. Verified `packages/db/prisma/schema.prisma:1-492` (24 models, `@@unique([tenantId, leadKey])` etc.).

## Secrets never to browser/DB

- `ClientAiConfig.credentialRef` stores reference `env:VARNAME` only (e.g. `env:OPENAI_API_KEY`), resolved server-side `resolveCredential(ref) → process.env[VAR]` (`apps/web/lib/ai/gateway.ts:36-43`). Raw keys never in DB or `GET /api/acquisition/agents` response (masked `***`).
- `N8N_API_KEY`, `BREVO_API_KEY`, `DATABASE_URL` read only via `process.env` server-side. Page `System` masks via `maskUrl` (`protocol + ***`) and `redact` (`first2***last2`) (`apps/web/lib/wavesco/integrations.ts:50-120`, `apps/web/app/(dashboard)/system/page.tsx:maskEnvValue`). `POST /api/acquisition/integrations/test` never echoes key.

## Auth

- Auth.js v5 `auth()` + `requireTenantId(session)` → 401 `UNAUTHORIZED` if missing (`apps/web/lib/wavesco/control.ts:requireControlAuth`). `middleware.ts` guards `(dashboard)/*`. `JWT_SECRET` signs `jose HS256` tokens (`ACCESS_TOKEN_TTL 15m`, `REFRESH_TOKEN_TTL 30d`), `User` `@@unique([tenantId,email])`, `RefreshToken tokenHash @unique`.

## Audit

- Every control POST writes `AuditLog { tenantId, userId, action, model, recordId, before, after, metadata, createdAt }` via `auditControl()` (`apps/web/lib/wavesco/control.ts:16-32`). Queried filterable `GET /api/system/audit-logs?limit=50&offset=0&action=&model=` and shown in `/system` Audit Logs (who/what/when/resource/before→after). Before/after capture state machine transitions (e.g. `Campaign draft→running`).

## HTTP hardening

- `next-auth` CSRF, `cache: no-store` on control fetches, `pgbouncer=true` disables prepared statements for Neon pooler, error responses slice to 200 chars (never raw `DATABASE_URL`). Deployment checks `git diff --stat` for stray `.env` before `vercel --prod`.

## Gaps noted (dossier §40)

- Google Drive no path → `unavailable` (not a risk).
- `TAVILY_API_KEY` not in `.env.example` inventory; lives in engine env.
- `BREVO`/`N8N` intentionally BLOCKED prod until Vercel env set (explicit `BLOCKED` pill, not hidden failure).

## Operator checklist

- `cp .env.example .env && pnpm generate:secrets` before first run.
- Never commit `.env`; verify `git status` clean before `vercel --prod`.
- Test masking: visit `/system` → Configuration table shows `masked` per key, not raw.

