# Cafe Ops

Daily briefings and weekly reports aggregated across CafeOS modules.

## Requires

None (no external integrations).

## Tables

| Model | Purpose |
|---|---|
| `CafeOpsReport` | Generated briefing/report documents |
| `CafeOpsSchedule` | Scheduled report definitions |

## Actions

- `generateDailyBriefing(tenantId)` — aggregates orders, leads, low-stock items for today
- `generateWeeklyReport(tenantId)` — weekly order/lead/customer totals

Both read sibling module tables (`CafeOrder`, `CafeLead`, `CafeCustomer`,
`CafeInventoryItem`) inside the tenant context and persist a `CafeOpsReport`.

## Webhooks

None.
