# Email System — Acquisition OS

## Models

- `OutreachEmail` `id, tenantId, leadKey, business, email, subject, body, status draft→submitted→approved→sent (messageId, sentAt) → failed (error, sendError), approvalId, campaignId`.
- `OutreachOrder` `id, tenantId, version 1, leadKey, businessName, email VERIFIED, researchSnapshot Json, subject/body, followupPlan Json, status READY_FOR_APPROVAL→PENDING→APPROVED→SENT→DELIVERED/FAILED, REJECTED/CANCELLED, approvalId/sendId/deliveryStatus/replyStatus/sendError, aiEnabled/aiModel/enrichmentStatus`.
- `Campaign` `eligibleSnapshot Json, sendingLimit, status draft|scheduled|running|paused|stopped|completed`.
- `FollowUp` `dueAt, status pending|completed, channel email, followUpNumber`.

## Approval handoff (n8n)

- Submit: `submitApproval({ type, recipient, subject, body }) → POST /webhook/personal/approval` (`apps/web/lib/wavesco/n8n.ts`), then `submitOrderAction` sets `OutreachOrder.status=PENDING, approvalId`.
- Decide: `decideApproval(id, approve|reject) → GET /webhook/personal/approval-decide?id=&decision=` + `decideOrderAction` / `decideApprovalAction` → `OutreachEmail approved` → `Email Outbox` dispatch. Every decision writes `AuditLog`.

## Delivery (two paths)

1. **n8n Email Outbox** (existing `Personal - SMTP` credential) for single sends.
2. **Brevo** (`BREVO_API_KEY`, `POST /api/webhooks/brevo` handles transactional events → `opted_out/bounced/reply_status` via `updateLeadOutreachState(nameKey, fields)` mirrored back into `leads.db`).

Queue depth on `/system`: `OutreachEmail where status in [submitted,approved,pending,queued]`.

## Templates (Control Center)

- Routes: `GET|POST /api/acquisition/email/templates` tenant-scoped CRUD (`title, subjectTpl, bodyTpl` with vars `{{business}} {{category}} {{city}} {{tier}} {{problem}}`), `preview` renders with lead vars without sending.
- Pages: `/acquisition/email` (Templates table, Preview drawer, Delivery states `submitted/approved/sent/failed + sendError`, Configure sending integration).
- Compliance: `opted_out`/`bounced` flags, `POST /api/unsubscribe` (exists, untracked), reply filter excludes `none/no reply/no`.

## Campaign → email

Eligibility preview `selectCampaignCandidates({ location, category, tier })` checks corpus `email VERIFIED, NOT optedOut/bounced/contacted` before `submitCampaignAction`. Batch actions: `batchResearchAction, batchCheckEmailsAction, batchGenerateOrdersAction, batchQueueReadyOrdersAction` chain behind `/acquisition/pipeline`.

## Config (masked)

`POST /api/acquisition/integrations/test { key: brevo }` probes Brevo server-side (masked response, never leaks key). Dev SMTP fallback `SMTP_HOST localhost:587` via Nodemailer when `RESEND_API_KEY` unavailable.

## Blockage handling

`BREVO_API_KEY` missing in `vercel env ls` → `brevoHealth() BLOCKED: BREVO_API_KEY missing` (prod), outreach stays on n8n Outbox placeholder until set. Pages still render empty state with CTA, not 500. Verify via `integrations` matrix `brevo BLOCKED`.

## Tests

`tests/email-templates.test.ts` (5 tests: 401 without auth, CRUD, preview), `tests/email-verify.test.ts`, `tests/pipeline-email-check.test.ts`.

