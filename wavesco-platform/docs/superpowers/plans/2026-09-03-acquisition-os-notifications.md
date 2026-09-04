# Acquisition OS Live Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the existing notification subsystem into the REAL Acquisition OS lifecycle so each of the 11 locked milestones fires an idempotent, tenant-scoped notification from an actual state transition — never from a frontend timer, mount, or fake event.

**Architecture:** Port the already-built (and verified) notification engine — types, pure logic, engine, preferences, hooks, email template — from the marketing site (`D:\waves-co`) into the REAL platform monorepo (`D:\waves-c0_app\wavesco-platform`). Add `Notification` + `NotificationPreference` to the platform's own Prisma schema (`packages/db`) and a migration. Wire the existing hooks into the real lifecycle transition points in `apps/web/lib/wavesco/*` (pipeline, generation, activity, acquisition-profile). In-app storage is the only mandatory channel and works standalone; email/push remain channel abstractions (no provider credentials assumed).

**Tech Stack:** Next.js 15, Prisma 6, PostgreSQL (Neon + RLS), pnpm + Turborepo, Vitest, NextAuth (tenant via `requireSession`).

## Global Constraints

- **Do NOT rebuild the notification engine logic.** Port the verified implementation (types/pure/engine/preferences/hooks/email-template) — adapt only the DB access layer to `@wavesco/db`.
- **11 locked milestone events only:** CYCLE_STARTED, LEAD_GENERATION_COMPLETED, LEAD_REPORT_READY, EMAILS_READY_FOR_REVIEW, CAMPAIGN_DEPLOYED, NEW_RESPONSES_DETECTED, POSITIVE_RESPONSE_DETECTED, FOLLOW_UP_READY, FOLLOW_UP_WINDOW_COMPLETED, CAMPAIGN_RESULTS_FINALIZED, CYCLE_REPORT_READY. Do not add success milestones.
- **Real source of truth only.** Fire hooks ONLY where a real state transition succeeds. Never on page load, mount, frontend timer, or hardcoded delay. No fake events.
- **Idempotency preserved.** Deterministic `idempotencyKey` + unique constraint + P2002 race handling. Must survive job/webhook/API retries and worker restarts.
- **Tenant isolation.** Every write uses the authenticated tenant from the server session (`requireSession`), through `withTenantContext` (RLS). Never accept tenantId from an untrusted client to create a notification.
- **Failure = no success notification.** If an operation fails, its milestone must NOT emit.
- **Client-facing language only.** Never expose n8n, Neon, Ollama, model names, queue, worker, or internal terms in notification copy.
- **Do not modify the locked product flow.** Add observers at transition points; do not re-orchestrate.
- **Tests must cover real transitions**, not superficial helper tests.

---

### Task 1: Add Notification + NotificationPreference models to the platform DB schema

**Files:**
- Modify: `packages/db/prisma/schema.prisma` — add `Notification`, `NotificationPreference` models and `notifications`/`notificationPreferences` relations on `Tenant`
- Create: `packages/db/prisma/migrations/<next>/migration.sql` (see Task 2)

**Interfaces:**
- Consumes: existing `Tenant` model (id, timestamps), existing RLS pattern (each model carries `tenantId` + migration applies RLS policy for role `wavesco_app`).
- Produces: `Notification` and `NotificationPreference` client models usable via `tx.notification` / `tx.notificationPreference` inside `withTenantContext`.

- [ ] **Step 1: Read the schema tail**

Confirm the last models (`AcquisitionProfile`, `AcquisitionDataImport`, `WavesHandoffToken`) and the `Tenant` model relations block. Read `packages/db/prisma/schema.prisma:21-35`.

- [ ] **Step 2: Add relation fields to `Tenant`**

After `refreshTokens RefreshToken[]`, add:

```prisma
  notifications           Notification[]
  notificationPreferences NotificationPreference[]
```

- [ ] **Step 3: Append the two models at end of file**

```prisma
// --- Client Notifications ------------------------------------------------
// Client-facing, idempotent, tenant-scoped. The engine writes to `Notification`
// (one row per event × channel). `NotificationPreference` toggles delivery by
// category × channel. RLS applied by the notification migration.
model Notification {
  id             String    @id @default(cuid())
  tenantId       String
  userId         String?
  tenant         Tenant    @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  eventType      String
  title          String
  message        String
  cycleId        String?
  campaignId     String?
  resourceType   String?
  resourceId     String?
  resourceHref   String?
  channel        String    @default("in_app")
  read           Boolean   @default(false)
  readAt         DateTime?
  delivered      Boolean   @default(false)
  deliveredAt    DateTime?
  idempotencyKey String    @unique
  metadata       Json?
  createdAt      DateTime  @default(now())
  updatedAt      DateTime  @updatedAt

  @@index([tenantId, read, createdAt(sort: Desc)])
  @@index([tenantId, userId])
  @@index([tenantId, eventType])
}

model NotificationPreference {
  id        String   @id @default(cuid())
  tenantId  String
  tenant    Tenant   @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  category  String
  channel   String
  enabled   Boolean  @default(true)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@unique([tenantId, category, channel])
  @@index([tenantId])
}
```

- [ ] **Step 4: Validate + format the schema**

Run from repo root: `pnpm --filter @wavesco/db exec prisma format` then `pnpm --filter @wavesco/db exec prisma validate`. Expected: valid, formatting applied.

- [ ] **Step 5: Commit**

```bash
git add packages/db/prisma/schema.prisma
git commit -m "feat(notifications): add Notification + NotificationPreference models"
```

---

### Task 2: Author the notification migration (DDL + RLS)

**Files:**
- Create: `packages/db/prisma/migrations/<YYYYMMDDHHMMSS>_add_notifications/migration.sql`

**Interfaces:**
- Consumes: model DDL from Task 1.
- Produces: the migration that `pnpm --filter @wavesco/db db:deploy` will apply to Neon. Must create tables, indexes, FKs, AND add tenant-scoped RLS policies consistent with the platform's existing migrations.

- [ ] **Step 1: Generate the empty-then-target diff for the table DDL**

Run from `packages/db`: `npx prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script`. Extract ONLY the `Notification` and `NotificationPreference` `CREATE TABLE`/`CREATE INDEX`/`CREATE UNIQUE INDEX`/`ADD CONSTRAINT` statements into the migration file.

- [ ] **Step 2: Inspect an existing product migration for the RLS pattern**

Read `packages/db/prisma/migrations/20260825010000_wavesco_product_models/migration.sql` and copy the exact RLS convention (role `wavesco_app`, `USING (tenant_id = current_setting('app.tenant_id', true))`, WITH CHECK) so the new tables enforce the same isolation.

- [ ] **Step 3: Write the full migration.sql**

Table DDL + indexes + FK to `"Tenant"` (`ON DELETE CASCADE`) + enable RLS + policies:

```sql
-- +goose down style not used; Prisma migrations are append-only.
ALTER TABLE "Notification" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Notification"
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));
-- same for "NotificationPreference"
```

(Match the exact policy naming/format of the existing product migration.)

- [ ] **Step 4: Validate the migration is well-formed**

Run `pnpm --filter @wavesco/db exec prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --shadow-database-url "$env:SHADOW_URL"` only if a shadow URL is available. Otherwise, confirm `prisma validate` + `prisma format` pass (Task 1) and that the SQL is syntactically self-consistent. Do NOT run against production.

- [ ] **Step 5: Commit**

```bash
git add packages/db/prisma/migrations
git commit -m "feat(notifications): migration for notification tables + RLS"
```

---

### Task 3: Port the notification engine into `@wavesco/db`

**Files:**
- Create: `packages/db/src/notifications/types.ts`
- Create: `packages/db/src/notifications/pure.ts`
- Create: `packages/db/src/notifications/engine.ts`
- Create: `packages/db/src/notifications/preferences.ts`
- Modify: `packages/db/src/index.ts` (re-export)

**Interfaces:**
- Consumes: `@wavesco/db` — `Prisma` (from `./client`), `withTenantContext` (from `./context`), `prisma` (from `./client`). Source reference implementation to PORT (adapt imports only): `D:\waves-co\lib\notifications\{types,pure,engine,preferences}.ts`.
- Produces:
  - `NOTIFICATION_EVENT_TYPES`, `NotificationEventType`, `NOTIFICATION_CHANNELS`, `PREFERENCE_CATEGORIES`, `EVENT_TO_CATEGORY`, `EVENT_TO_RESOURCE_TYPE`, `NOTIFICATION_TEMPLATES`, `NotificationContext`
  - `buildIdempotencyKey()`, `resolveNotificationContent()`, `resolveResourceHref()`, `resolveResourceType()` (pure)
  - `createNotification(input)`, `createMultiChannelNotification(input)`, `markNotificationRead()`, `markAllNotificationsRead()`, `listNotifications()`, `getNotification()`
  - `ensureDefaultPreferences()`, `getPreferences()`, `updatePreference()`, `updatePreferences()`, `isChannelEnabled()`

- [ ] **Step 1: Copy `types.ts`** — port verbatim (it is DB-free) with the import of `Prisma` removed (none needed). Keep all 14 keys + error types + templates + `EVENT_*` maps.

- [ ] **Step 2: Copy `pure.ts`** — port verbatim (DB-free).

- [ ] **Step 3: Port `engine.ts`** — adapt the DB access from the marketing-site `prisma`/`prisma.notification.*` to `withTenantContext`:

```ts
import { Prisma } from "../client";            // generated client (task 1 model)
import { withTenantContext } from "../context";
import {
  buildIdempotencyKey, resolveNotificationContent,
  resolveResourceHref, resolveResourceType,
} from "./pure";
import { EVENT_TO_CATEGORY, NOTIFICATION_CHANNELS as CHANNELS,
  type NotificationChannel, type NotificationContext,
  type NotificationEventType } from "./types";

export async function createNotification(input) {
  // resolve content/href/type via pure fns (unchanged)
  // then idempotent insert inside withTenantContext(input.tenantId, async (tx) => {...})
  //   existing? return {created:false,id}
  //   create with metadata: (metadata ?? undefined) as Prisma.InputJsonValue | undefined
  // catch P2002 -> find existing -> return {created:false}
}
```

`createMultiChannelNotification`, `markNotificationRead`, `markAllNotificationsRead`, `listNotifications`, `getNotification` all wrap their `prisma.notification.*` calls in `withTenantContext(tenantId, (tx) => tx.notification.* )`.

- [ ] **Step 4: Port `preferences.ts`** — adapt to `withTenantContext(tenantId, (tx) => tx.notificationPreference.*)`. Keep the same defaults and `upsert` on `tenantId_category_channel`.

- [ ] **Step 5: Export from `packages/db/src/index.ts`**

```ts
export * from "./notifications";
```

Create `packages/db/src/notifications/index.ts` that re-exports the engine, preferences, types, and pure helpers.

- [ ] **Step 6: Typecheck the db package**

Run `pnpm --filter @wavesco/db typecheck`. Expected: exit 0. If `Prisma.InputJsonValue` is unavailable, cast metadata to the generated `JsonNull`/`InputJsonValue` like existing code, or `as never` (consistent with `recordActivity`'s `metadata as never`).

- [ ] **Step 7: Commit**

```bash
git add packages/db/src/notifications packages/db/src/index.ts
git commit -m "feat(notifications): port idempotent notification engine into @wavesco/db"
```

---

### Task 4: Port the notification HOOKS + email template into the web app

**Files:**
- Create: `apps/web/lib/wavesco/notify.ts` (port of `hooks.ts` adapted to `@wavesco/db`)
- Create: `apps/web/lib/wavesco/notify-email.ts` (port of `email-template.ts`, unused by default)
- Modify: `apps/web/lib/wavesco/activity.ts` (see wiring below)

**Interfaces:**
- Consumes: `createMultiChannelNotification`, `NOTIFICATION_EVENT_TYPES` from `@wavesco/db`.
- Produces client-facing hook functions (each takes an already-resolved `tenantId` — the caller is responsible for passing the authenticated tenant):

```ts
export function notifyCycleStarted(tenantId: string, userId: string | undefined, cycleId: string): void
export function notifyLeadGenerationCompleted(tenantId: string, userId: string | undefined, cycleId: string, ctx: NotificationContext): void
export function notifyLeadReportReady(tenantId: string, userId: string | undefined, cycleId: string, ctx: NotificationContext): void
export function notifyEmailsReadyForReview(tenantId: string, campaignId: string | undefined, cycleId: string | undefined, ctx: NotificationContext): void
export function notifyCampaignDeployed(tenantId: string, campaignId: string | undefined, ctx: NotificationContext): void
export function notifyNewResponses(tenantId: string, campaignId: string | undefined, ctx: NotificationContext): void
export function notifyPositiveResponse(tenantId: string, campaignId: string | undefined, prospect: string, ctx: NotificationContext): void
export function notifyFollowUpReady(tenantId: string, ctx: NotificationContext): void
export function notifyFollowUpWindowCompleted(tenantId: string, ctx: NotificationContext): void
export function notifyCampaignResultsFinalized(tenantId: string, ctx: NotificationContext): void
export function notifyCycleReportReady(tenantId: string, cycleId: string, ctx: NotificationContext): void
```

Each calls `createMultiChannelNotification(...)` fire-and-forget (`.catch(console.error)`), passing the authentic `tenantId` threaded from the caller.

- [ ] **Step 1: Write `apps/web/lib/wavesco/notify.ts`** — port the 11 milestone hooks + 3 error hooks from `D:\waves-co\lib\notifications\hooks.ts`, re-mapping `createMultiChannelNotification` to `@wavesco/db`. Keep `deduplicationSuffix` patterns.

- [ ] **Step 2: Write `apps/web/lib/wavesco/notify-email.ts`** — port `email-template.ts` verbatim (branded HTML + escapeHtml + subject/action helpers). No provider call is made here.

- [ ] **Step 3: Typecheck the web app**

Run `pnpm --filter @wavesco/web typecheck`. Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add apps/web/lib/wavesco/notify.ts apps/web/lib/wavesco/notify-email.ts
git commit -m "feat(notifications): port notification hooks + email template to web app"
```

---

### Task 5: Wire LEAD GENERATION + report completion notifications

**Files:**
- Modify: `apps/web/lib/wavesco/generation.ts` (real transition: `GenerationBatch` → `completed`, and `failed`)

**Interfaces:**
- Consumes: `notifyLeadGenerationCompleted`, `notifyCycleReportReady`/`notifyLeadReportReady` from `./notify`.

- [ ] **Step 1: Locate the two completion call-sites** — in `monitorGenerationRemote()` (around `generation.ts:223-243`) and `finalizeIfComplete()` (`generation.ts:327-352`). Both already set `status: "completed"` with `resultLeadCount`/`emailReadyCount`/`pdfPath`/`excelPath`.

- [ ] **Step 2: Add a side-effect after the `completed` update in BOTH call-sites**

After the `tx.generationBatch.update({ ... data: { status: "completed", ... } })` succeeds, call (outside the tx, fire-and-forget):

```ts
// after confirmed completion
notifyLeadGenerationCompleted(
  batch.tenantId, undefined, batch.id,
  { leadCount: batch.resultLeadCount ?? undefined, qualifiedCount: batch.emailReadyCount ?? undefined },
);
```

- **Failure guard:** the `status: "failed"` branches emit NO success notification — leave them as-is.

- [ ] **Step 3: Typecheck**

`pnpm --filter @wavesco/web typecheck`. Expected exit 0.

- [ ] **Step 4: Commit**

```bash
git add apps/web/lib/wavesco/generation.ts
git commit -m "feat(notifications): emit LEAD_GENERATION_COMPLETED on real batch completion"
```

---

### Task 6: Wire EMAILS_READY_FOR_REVIEW + CAMPAIGN_DEPLOYED notifications

**Files:**
- Modify: `apps/web/lib/wavesco/pipeline.ts`

**Interfaces:**
- Consumes: `notifyEmailsReadyForReview`, `notifyCampaignDeployed` from `./notify`.

- [ ] **Step 1: EMAILS_READY_FOR_REVIEW** — In `createOutreachOrder()` (`pipeline.ts:340-442`), the order is created with `status: "READY_FOR_APPROVAL"` inside `withTenantContext`. After the create succeeds and inside the same tx (so it's a real, persisted transition), call:

```ts
// order.status === "READY_FOR_APPROVAL" successfully created
notifyEmailsReadyForReview(tenantId, undefined, undefined, { emailCount: 1, prospectName: order.businessName });
```

Place the hook call AFTER `tx.outreachOrder.create(...)` returns, still inside `withTenantContext(tenantId, ...)`, passing the threaded `tenantId`.

- [ ] **Step 2: CAMPAIGN_DEPLOYED** — In `reconcileOrderSend()` (`pipeline.ts:587-692`), the ONLY branch that sets `status: "SENT"` is `found && sendStatus === "sent"` (`pipeline.ts:645-667`), confirmed by provider acceptance. After `tx.outreachOrder.update({ ... status: "SENT" ... })` succeeds, inside the same `withTenantContext`, call:

```ts
notifyCampaignDeployed(tenantId, orderId, { prospectName: order.businessName });
```

- **Failure guards:** the `FAILED` branch (`pipeline.ts:669-680`) and `pending_reconciliation` branch emit NO success notification. Leave them.

- [ ] **Step 3: Typecheck**

`pnpm --filter @wavesco/web typecheck`. Expected exit 0.

- [ ] **Step 4: Commit**

```bash
git add apps/web/lib/wavesco/pipeline.ts
git commit -m "feat(notifications): wire EMAILS_READY_FOR_REVIEW + CAMPAIGN_DEPLOYED at real transitions"
```

---

### Task 7: Wire RESPONSE detection + POSITIVE response + follow-up notifications

**Files:**
- Modify: `apps/web/lib/wavesco/pipeline.ts` (in `syncOrderReplyStates`) and the Brevo inbound webhook receiver
- Modify: `apps/web/app/api/webhooks/brevo/route.ts` (inbound reply causality)

**Interfaces:**
- Consumes: `notifyNewResponses`, `notifyPositiveResponse`, `notifyFollowUpReady` from `./notify`.

- [ ] **Step 1: Read the Brevo webhook receiver** — `apps/web/app/api/webhooks/brevo/route.ts`. It receives real inbound events (delivered/bounce/complaint). If inbound replies arrive there, wire `notifyNewResponses` / `notifyPositiveResponse` on the reply event using the tenant resolved from the order/recipient (server-side — never from the webhook body).

- [ ] **Step 2: NEW_RESPONSES_DETECTED** — In `syncOrderReplyStates()` (`pipeline.ts:756-784`), when a previously-`none` reply becomes present (`pipeline.ts:768-771`), after the update succeeds call:

```ts
notifyNewResponses(tenantId, o.id, undefined, { responseCount: updatedCount, prospectName: o.businessName });
```

Use `deduplicationSuffix: \`reply:${o.id}:${lead.reply_status}\`` so the same reply/status never re-notifies.

- [ ] **Step 3: POSITIVE_RESPONSE_DETECTED** — Determine positive classification from the existing reply data (e.g. reply text/sentiment where available). Where the platform has no classifier, treat only an explicit positive marker as positive (do NOT classify every reply as positive). When positive, call `notifyPositiveResponse(tenantId, o.id, o.businessName, {...})` with `deduplicationSuffix` keyed by the reply.

- [ ] **Step 4: FOLLOW_UP_READY** — When real follow-up window logic marks `FollowUp.dueAt` passed and status `pending` (no frontend timing), after the transition call `notifyFollowUpReady(tenantId, {...})` keyed by `followup-window:<tenantId>:<date>` idempotently.

- [ ] **Step 5: Typecheck**

`pnpm --filter @wavesco/web typecheck`. Expected exit 0.

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/wavesco/pipeline.ts apps/web/app/api/webhooks/brevo/route.ts
git commit -m "feat(notifications): wire response + positive + follow-up notifications at real events"
```

---

### Task 8: Add the in-app notification UI + routes in the web app

**Files:**
- Create: `apps/web/app/api/notifications/route.ts` (GET list)
- Create: `apps/web/app/api/notifications/[id]/read/route.ts` (POST read)
- Create: `apps/web/app/api/notifications/read-all/route.ts` (POST)
- Create: `apps/web/app/api/notifications/preferences/route.ts` (GET/PUT)
- Create: `apps/web/components/notifications/notification-center.tsx` (client)
- Modify: `apps/web/app/(dashboard)/command/header` or the app shell that renders the user's nav (locate the nav component; add `<NotificationCenter />` when authenticated)
- Modify: `apps/web/app/api/notifications/...` routes use `auth()` + `requireSession()` for tenant

**Interfaces:**
- Consumes: `listNotifications`, `markNotificationRead`, `markAllNotificationsRead`, `getPreferences`, `updatePreferences` from `@wavesco/db`; `auth`/`requireSession` from local lib.
- Produces: the client notification bell + dropdown + a `/notifications` history page (optional but recommended).

- [ ] **Step 1: Read the dashboard nav/shell** — locate where the authenticated user sees the app shell (e.g. `apps/web/app/(dashboard)/layout.tsx` or a `Command Center` header). Confirm where to mount the bell.

- [ ] **Step 2: Create the API routes** — each resolves `{ tenantId, userId }` via `requireSession(await auth())` (server-side, trusted), then calls the `@wavesco/db` functions wrapped in `withTenantContext`. Never trust a client `tenantId`.

- [ ] **Step 3: Create `notification-center.tsx`** — client component ported from `D:\waves-co\components\notification-center.tsx`, reusing WavesCo design tokens, fetching `/api/notifications`, polling unread count on an interval only while logged-in and panel closed, mark-read/mark-all, click-through to `resourceHref`. Use `cn()` from `@/lib/utils`.

- [ ] **Step 4: Mount the bell** into the authenticated dashboard shell (server component passes nothing; the client component reads its own session via `useSession`).

- [ ] **Step 5: Typecheck + lint**

`pnpm --filter @wavesco/web typecheck` and `pnpm --filter @wavesco/web lint`. Expected exit 0.

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/api/notifications apps/web/components/notifications
git commit -m "feat(notifications): in-app notification API + center UI"
```

---

### Task 9: Add lifecycle-wiring integration tests (Vitest, mocked DB)

**Files:**
- Create: `apps/web/tests/notifications-lifecycle.test.ts`

**Interfaces:**
- Consumes: the real hooks (`/lib/wavesco/notify`) and the real pipeline/generation transitions invoked in test. Mocks `@wavesco/db` (like existing `tests/e2e/acquisition-flow.test.ts`) with an in-memory `notification` store to assert idempotency and tenant isolation.

- [ ] **Step 1: Write the mocked-DB harness**

Reuse the `vi.mock("@wavesco/db")` pattern from `acquisition-flow.test.ts`, adding `notification` and `notificationPreference` to the in-memory `tx` with `create`/`findUnique`/`createMany`/`updateMany`/`findMany`/`count`. Use `vi.hoisted` for the mock fns.

- [ ] **Step 2: Write tests for each REQUIRED scenario**

1. Cycle started → notification created.
2. Lead generation completed → notification created (via `finalizeIfComplete` path).
3. Lead report actually ready → notification created.
4. Emails ready for review → notification created (via `createOutreachOrder` success).
5. Campaign actually deployed → notification created (via `reconcileOrderSend` → SENT).
6. New real response → notification created.
7. Positive response → notification created.
8. Response window completion → follow-up notification.
9. Campaign result finalization → notification.
10. Cycle 1 report actually stored → notification.
11. Duplicate transition → no duplicate notification (same idempotencyKey yields one row).
12. Failed transition → no success notification (failed generation/order → zero rows of that milestone).
13. Tenant A cannot see Tenant B notifications (separate in-memory stores).

- [ ] **Step 3: Run the tests**

`pnpm --filter @wavesco/web test`. Expected: all new + existing tests pass. (Existing tests must stay green — if a mocked `tx` lacks `notification`, that's fine because those tests never invoke hooks unless the transition fires.)

- [ ] **Step 4: Commit**

```bash
git add apps/web/tests/notifications-lifecycle.test.ts
git commit -m "test(notifications): lifecycle wiring integration tests"
```

---

### Task 10: Final verification + environment report

**Files:** none (verification only)

- [ ] **Step 1: Typecheck the whole repo**

`pnpm typecheck`. Expected exit 0.

- [ ] **Step 2: Run the full test suite**

`pnpm test`. Note any environment-blocked suites (those already BLOCK on missing env). Record pass counts.

- [ ] **Step 3: Attempt production build (with local env present)**

From `apps/web`: `pnpm --filter @wavesco/web build`. Report result honestly (build may require `DATABASE_URL`/`DIRECT_URL`/`AUTH_SECRET` present).

- [ ] **Step 4: Migration status**

Do NOT guess credentials. If `DATABASE_URL`/`DIRECT_URL` are present and the repo's process permits, run `pnpm --filter @wavesco/db db:deploy`. Otherwise report that production migration (`<migration>_add_notifications/migration.sql`) remains PENDING and give the exact command.

- [ ] **Step 5: Email / push delivery status**

The channel abstraction is intact but no provider sender has real credentials by default. In-app notifications function independently. Report email/push as NOT verified (no credentials) unless credentials are supplied and actual delivery is confirmed.

---

## Self-Review Notes

- **Spec coverage:** all 11 milestones map to Tasks 5-7 with real transition sites identified (`generation.ts`, `pipeline.ts`, `syncOrderReplyStates`, Brevo webhook). Idempotency preserved (Task 3 engine + unique key). Tenant isolation (Task 3 via `withTenantContext` + Task 8 via `requireSession`). Failure=no-notify guards noted per call-site. UI in Task 8. Migration in Task 2. Testing grid in Task 9. Production migration/email/push honestly reported in Task 10.
- **Type consistency:** hook names (Task 4) are used consistently in Tasks 5-7; `@wavesco/db` exports (Task 3) are consumed by both app tasks.
- **Left in the marketing site:** the original `D:\waves-co` port remains untouched (it is the staging/verification copy). This plan ports it into the platform rather than editing it.
