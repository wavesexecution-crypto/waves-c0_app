# WavesCo Platform

Multi-tenant SaaS platform for cafés with a modular feature system (CafeOS). Built as a pnpm + Turbo monorepo: Next.js 15 web app, shared DB/auth/UI packages, and pluggable feature modules.

## Stack

- **Apps**: `apps/web` — Next.js 15 (App Router), React 19, Tailwind CSS 3
- **Packages**: `packages/db` (Prisma 6 + RLS + audit middleware), `packages/auth` (Auth.js v5 + Resend magic link + JWT), `packages/ui` (Radix + Tailwind), `packages/validators` (Zod), `packages/config` (shared TS/ESLint)
- **Modules**: `modules/*` — pluggable CafeOS feature bundles with per-module webhooks
- **Infra**: PostgreSQL 16 (Docker), Turbo 2

## Prerequisites

- Node.js >= 20 (tested on 24)
- pnpm >= 9 (`npm install -g pnpm`)
- Docker Desktop (for PostgreSQL)

## Setup

```bash
# 1. Start the database
docker compose up -d

# 2. Install dependencies
pnpm install

# 3. Configure env vars
cp .env.example .env
#   - Set NEXTAUTH_SECRET / JWT_SECRET (openssl rand -base64 32)
#   - Set RESEND_API_KEY for magic-link signup (required)
#   - apps/web reads the root .env via turbo globalEnv

# 4. Migrate + seed
pnpm db:migrate
pnpm db:seed
```

## Development

```bash
pnpm dev            # http://localhost:3000
pnpm typecheck      # zero errors expected
pnpm lint           # zero warnings expected
pnpm test           # vitest unit tests
pnpm db:studio      # Prisma Studio
pnpm verify:contracts  # validates modules/*/module.contract.json
```

### Vertical slice acceptance test

```
pnpm install && pnpm db:migrate && pnpm db:seed && pnpm dev
→ Open http://localhost:3000
→ Sign up with demo@cafe.com → land on empty dashboard
→ Verify tenant row in DB (pnpm db:studio)
→ Verify JWT contains tenant ID
```

## Tenant data export / import

Every tenant can export and restore its full data set (tenant, users, module state, module-owned tables).

- `POST /api/tenant/export` — streams a JSON blob signed with a one-time token (24h expiry)
- `POST /api/tenant/import` — accepts an export blob, validates the schema, imports inside a single transaction

The import/export format is versioned via `dataSchemaVersion` so future breaking changes can be handled.

## Modules

Modules live under `modules/*` and each declare a `module.contract.json` validated against
[`docs/module-contract.schema.json`](docs/module-contract.schema.json). See `docs/module-contract.md`.

## Database

- Prisma schema: `packages/db/prisma/schema.prisma`
- Row-level security is enforced via `SET LOCAL app.tenant_id` in `withTenantContext`
- Every mutation is auto-audited by a Prisma client extension (`packages/db/src/audit.ts`); sensitive fields are redacted

## License

Private. Do not distribute.
