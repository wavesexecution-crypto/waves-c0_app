# Operations — Running the Acquisition OS Control Center

## Day-to-day flows

### Leads
- `/acquisition/leads` — search/filter (`q/tier/category/city/outreach/verification/sort`), 25/page, facets `getFacets()` `SELECT DISTINCT category/city`. Buttons: Discover → `/acquisition/generate`, Import (CSV placeholder), Export → `POST /api/acquisition/leads/export` (limit 1000, audit), Segment chips Tier A/B/C. Inspect → `leads/[nameKey]` detail + Enrich/Verify/Qualify actions (audit).

### Campaigns
- Create with `{ name, location, category, tier, sendingLimit, eligibleSnapshot }` via `createCampaignAction` → `Campaign status=draft`.
- Configure eligibility preview via `selectCampaignCandidates` (reads corpus `VERIFIED, NOT optedOut/bounced/contacted`). 
- Launch → `POST /api/acquisition/campaigns/[id]/control { action: launch }` → `running` + `AuditLog before draft after running`.
- Pause/Resume/Stop — same endpoint (`pause|resume|stop`) with state-machine validation (400 if pause on draft). UI shows `RUNNING/PAUSED` pill, `ConfirmDialog` with before/after preview for destructive `stop`.

### Workflows / Agents / Integrations
- `/acquisition/workflows` — table active/inactive, Execute, history drawer, retry failed; fallback manifest `D:\n8n-personal-automations\workflows-manifest.json` when `N8N_BASE_URL` missing.
- `/acquisition/agents` — enable/disable `aiEnabled`, configure `provider/baseUrl/model` (masked credential), activity `AiUsageLog` last 20.
- `/acquisition/integrations` — matrix `lead_engine/n8n/brevo/db/ai_gateway/persisted IntegrationStatus` with masked Test Connection.

### Email
- `/acquisition/email` — template CRUD + preview (renders `{{business}}` vars without sending) + delivery state `submitted/approved/sent/failed + sendError`.

## Queues & jobs (see `/system`)

- **Queue depth:** count `OutreachEmail where tenantId status in [submitted,approved,pending,queued]` (Analytics bar + System Queues).
- **Jobs:** pending `FollowUp` (`dueAt asc, pending`) + `GenerationBatch` (`queued/pending/running`) listed with retry.
- **Errors:** failed `OutreachEmail` + failed `GenerationBatch` tables on `/system` (use to trigger retry via pipeline/overdue).

## Observability

- **Logs:** `/system` Logs = last 50 `ActivityEvent` (`type/title/entity/sourceKey`) via `GET /api/system/logs?limit=50`.
- **Audit logs:** `/system` Audit Logs = `AuditLog` filterable (`?action=&model=&limit=50&offset=0`) and via `GET /api/system/audit-logs`.
- **Analytics:** `/acquisition/analytics` — acquisition metrics, campaign perf `eligible vs sent vs reply` bars, funnel `total→emailReady→contacted→replied`, response rates, workflow `byType/byState`, `Api usage`, `Model/token usage` table (by `provider:model`, avg latency, est cost), `System costs` estimate.

## Real-time

- `AutoRefresh intervalMs={15000}` (leads/campaigns/workflows/agents) or `30000` (overview/analytics/system) via `components/command/auto-refresh.tsx` (`router.refresh()`). No websocket. Refresh interval is per-resource; `OverviewLive` polls `/api/acquisition/overview`.

## Safe destructive

- Every destructive control (`stop campaign`, `cancel order`, `disable agent`) goes through `components/control/confirm-dialog.tsx` previewing `before → after`. Cancelled via `cancelOrderAction`.

## Health when BLOCKED

- `N8N_BASE_URL` / `BREVO_API_KEY` intentionally BLOCKED prod → UI shows `BLOCKED` pills + CTAs, never fake `connected`. Test via `POST /api/acquisition/integrations/test` still 200 masked response with `detail`.

