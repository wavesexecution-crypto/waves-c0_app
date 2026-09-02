# Waves Identity — Gap Analysis & Simplify Plan (2026-09-03)

## Current State Inspect

### wavesco.in (`D:\waves-co`, project `waves-co-1`)
- **Auth:** NONE — marketing site, no `next-auth`, no `Tenant/User`, `vercel env ls` empty, `app/login/page.tsx` dummy client `window.location.href="/"` (no `signIn`, no DB).
- **DB:** Supabase prototype `prototype_*` tables, not `Tenant/User`, no RLS, no `DATABASE_URL` env on Vercel.
- **Result:** Main site cannot set shared `wavesco.in` session — `app.wavesco.in` cannot recognize profile via cookie.

### app.wavesco.in (`D:\waves-c0_app\wavesco-platform`, project `waves-c0-app`)
- **Auth:** `NextAuth v5` `packages/auth/src/config.ts:66` (`Credentials` email+password bcrypt `lookupUserByEmail`, `Nodemailer` Resend, `JWT` `tenantId/role`, `AUTH_SECRET≥32`), `Tenant/User/RefreshToken` Neon, `middleware.ts:52 getToken` checks `tenantId`, `PROTECTED_PREFIXES` → `302 /login?callbackUrl`.
- **Recent over-engineering:** `NEXTAUTH_COOKIE_DOMAIN=.wavesco.in` added, `WAVES_MAIN_URL` redirect to `wavesco.in/login`, `WavesHandoffToken jti@unique` single-use 5m JWT `lib/wavesco/handoff.ts:42`, `POST /api/waves/handoff/create|consume` + `migrate-handoff` (9 stmts), `lib/wavesco/entitlements.ts` + `/products` (11→12 pages, 16 APIs). **Handoff is second auth system** — violates "Do NOT redesign into OAuth/complex SSO".
- **Login UI:** `app/(auth)/login/page.tsx:11` now `Continue with your Waves profile` but still `email+password` form via `signIn("credentials", {email,password, redirect:false})` + `callbackUrl` validation — asks **email again** on app, not password-only.

## Why Messed Up
1. **Main site has no real login** — cannot be "only entry point".
2. **App handoff is complex SSO** — `WavesHandoffToken` + `create/consume` + `getDirectPrisma` DDL is OAuth-like, not required for same-parent-domain `.wavesco.in` shared cookie.
3. **Duplicate auth paths:** `wave-co-1` (no DB) + `waves-c0-app` (full DB) — two user tables conceptually, but task says one `Waves Account`.
4. **App still asks email** — should recognize profile via cookie and ask **only password**.

## Simplify — Final Requirement
- **ONE Waves account:** `Waves Account → Email/Password/Profile/Tenant/Company → Product Entitlements → Acquisition OS`.
- **Main site is ONLY full login:** `wavesco.in/login` email+password → sets `__Secure-authjs.session-token` for `.wavesco.in`.
- **App recognizes profile:** `app.wavesco.in` reads same JWT via `getToken` (shared cookie) → shows `Your Waves profile is already connected: email@...` + **password only** → `verifyPassword(lookupUserByEmail(email).passwordHash, password)` → sets `app_verified` flag or re-issues `next-auth` session (or just `signIn` with email from cookie + password).
- **No:** second DB, second profile, OAuth provider selection, account selection, raw secrets in URL, `WavesHandoffToken` (remove or deprecate).

## Simplification Steps (minimal, reuse existing)
1. **Make waves-co use same Prism a DB + same NextAuth:** Copy `packages/auth` + `packages/db` minimal into `waves-co/lib/auth.ts` + `prisma/schema.prisma` (or pnpm workspace link), add `DATABASE_URL/DIRECT_URL/AUTH_SECRET/NEXTAUTH_SECRET/JWT_SECRET/NEXTAUTH_URL=https://wavesco.in/NEXTAUTH_COOKIE_DOMAIN=.wavesco.in` via `vercel env add --project waves-co-1`, set `cookies.domain=.wavesco.in` in `waves-co`.
2. **Keep app cookie domain:** `NEXTAUTH_COOKIE_DOMAIN=.wavesco.in` already in `packages/auth/src/config.ts:72` — keep, ensure `apps/web/middleware.ts` still redirects unauthenticated `app.wavesco.in` to `https://wavesco.in/login?callbackUrl=...` (already) and that `getToken` with `secureCookie: https:` reads `.wavesco.in` cookie.
3. **Simplify app login to password-only when recognized:** `apps/web/app/(auth)/login/page.tsx` — if `getToken` returns `email` (via server `auth()`), render email read-only + password input + `Sign in` that calls `signIn("credentials", {email: recognizedEmail, password})` (no email input). If no token, show `Continue to Waves to access your account` CTA to `WAVES_MAIN_URL/login`.
4. **Remove over-engineered handoff:** Delete `WavesHandoffToken` model + `migrations/20260903000000_waves_handoff` + `lib/wavesco/handoff.ts` + `app/api/waves/handoff/*` + `app/api/migrate-handoff` (or keep model but mark deprecated, not used for final journey). Keep `entitlements.ts` + `/products` (not billing) as they are correct and not over-engineered.
5. **Main site login:** `D:\waves-co\app\login/page.tsx` replace dummy with real `signIn` using same DB (copy `LoginForm` from `waves-c0_app` but with Waves branding).
6. **Tests:** Update `tests/waves-identity.test.ts` to test simplified flow: valid Waves user → main login sets cookie → app recognizes email → password-only success, wrong password fails, no email re-entry, no duplicate user, no secrets in URL, cross-tenant blocked via `withTenantContext`.
7. **Docs:** Update Master Dossier `14b` to reflect simplified shared-cookie + password confirmation, not handoff, and note `WavesHandoffToken` deprecated.

## Acceptance Test (must pass)
```
wavesco.in → email+password → Login successful (sets .wavesco.in cookie)
app.wavesco.in → Existing Waves profile recognized (email shown read-only) → User enters ONLY password → Access granted → /products shows entitlement → /acquisition loads per Control Center
```
No second email, no signup, no second account, no OAuth.

## What to NOT do
- Do not keep `WavesHandoffToken` as required path — keep for explicit "Open App" POST if desired, but not required for final journey.
- Do not create second `User` table.
- Do not implement billing.
- Do not break `requireControlAuth` boundaries.
