# Five-Hour Sprint Checklist

Target: get a tenant from signup to a dashboard with at least one working
CafeOS module, with all checks green.

## 0. Prereqs (15 min)

- [ ] Node >= 20, pnpm >= 9, Docker Desktop running
- [ ] `docker compose up -d` (PostgreSQL 16 on :5433)
- [ ] `pnpm install`
- [ ] `.env` exists (copy `.env.example`; set `NEXTAUTH_SECRET` + `JWT_SECRET`)

## 1. Boot the spine (45 min)

- [ ] `pnpm db:migrate` (creates platform + module tables + RLS)
- [ ] `pnpm db:seed` (demo@cafe.com / Password123!)
- [ ] `pnpm dev` → http://localhost:3000
- [ ] Sign up → land on empty dashboard
- [ ] Verify JWT contains tenant id (middleware + `requireSession`)

## 2. Gates (30 min)

- [ ] `pnpm typecheck` — zero errors
- [ ] `pnpm lint` — zero warnings
- [ ] `pnpm test` — all tests pass
- [ ] `pnpm verify:contracts` — all module contracts valid

## 3. Enable a module (60 min)

- [ ] Set `OPENAI_API_KEY`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`
- [ ] Modules page → enable **Cafe Leads**
- [ ] Without the keys → enable fails loudly (expected)
- [ ] With keys → enable succeeds; `TenantModule` row is `enabled`

## 4. Webhooks (60 min)

- [ ] Set `SWIGGY_SECRET` + `ZOMATO_SECRET`
- [ ] Enable **Cafe Orders**
- [ ] `POST /api/modules/cafe-orders/webhooks/swiggy` with HMAC header + `?tenantId=...` → 200
- [ ] Bad signature → 401

## 5. Tenant data portability (60 min)

- [ ] `POST /api/tenant/export` → signed blob (24h token)
- [ ] `POST /api/tenant/import` with the blob → users restored in one transaction
- [ ] Tampered token → 400

## 6. Audit & UX (30 min)

- [ ] Make a mutation → AuditLog row appears automatically (redacted secrets)
- [ ] Notification bell shows recent audit activity
- [ ] Theme toggle flips light/dark

## 7. Wrap (15 min)

- [ ] `pnpm build` succeeds
- [ ] Update this checklist with what actually took longer
