# Five-Hour Sprint Checklist

Target: get a tenant from signup to a dashboard with at least one working
CafeOS module, with all checks green.

## 0. Prereqs (15 min)

- [x] Node >= 20, pnpm >= 9, Docker Desktop running
- [x] `docker compose up -d` (PostgreSQL 16 on :5433)
- [x] `pnpm install`
- [x] `.env` exists (copy `.env.example`; set `NEXTAUTH_SECRET` + `JWT_SECRET`)

## 1. Boot the spine (45 min)

- [x] `pnpm db:migrate` (creates platform + module tables + RLS)
- [x] `pnpm db:seed` (demo@cafe.com / Password123!)
- [x] `pnpm dev` → http://localhost:3000
- [x] Sign up → land on empty dashboard
- [x] Verify JWT contains tenant id (middleware + `requireSession`)

## 2. Gates (30 min)

- [x] `pnpm typecheck` — zero errors
- [x] `pnpm lint` — zero warnings
- [x] `pnpm test` — all tests pass
- [x] `pnpm verify:contracts` — all module contracts valid

## 3. Enable a module (60 min)

- [ ] Set `OPENAI_API_KEY`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`
- [x] Modules page → enable **Cafe Leads**
- [x] Without the keys → enable fails loudly (expected)
- [x] With keys → enable succeeds; `TenantModule` row is `enabled`
- [x] Toggle state refreshes in place after enable/disable (`revalidatePath("/modules")`)

## 4. Webhooks (60 min)

- [x] Set `SWIGGY_SECRET` + `ZOMATO_SECRET`
- [ ] Enable **Cafe Orders**
- [x] `POST /api/modules/cafe-orders/webhooks/swiggy` with HMAC header + `?tenantId=...` → 200
- [x] Bad signature → 401
- [x] Dedup: resending the same order increments `dupCount` instead of a new row
- [x] Fix: module tables were missing GRANTs to `wavesco_app` (RLS policies existed but no table privileges) → added `20260809000000_module_table_grants`

## 5. Tenant data portability (60 min)

- [x] `POST /api/tenant/export` → signed blob (24h token)
- [x] `POST /api/tenant/import` with the blob → users restored in one transaction
- [x] Tampered token → 400
- [x] Token bound to tenant: importing another tenant's blob → rejected

## 6. Audit & UX (30 min)

- [x] Make a mutation → AuditLog row appears automatically (redacted secrets)
- [x] Notification bell shows recent audit activity
- [x] Theme toggle flips light/dark
- [x] Fix: theme now applies before hydration (no-FOUC inline script in root layout)
- [x] Fix: added `app/icon.svg` to remove the `/favicon.ico` 404

## 7. Wrap (15 min)

- [x] `pnpm build` succeeds
- [ ] Update this checklist with what actually took longer
