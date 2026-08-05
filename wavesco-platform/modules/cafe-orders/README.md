# Cafe Orders

Order intake from Swiggy and Zomato with per-module HMAC webhooks.

## Requires (fail loudly when missing)

- `SWIGGY_SECRET` — HMAC verification for `/webhooks/swiggy`
- `ZOMATO_SECRET` — HMAC verification for `/webhooks/zomato`

## Tables

| Model | Purpose |
|---|---|
| `CafeOrder` | Normalized inbound order (dedup by `tenantId + externalOrderId + source`) |
| `CafeReconciliation` | Daily reconciliation summary |
| `CafeSettlement` | Aggregator settlement tracking |

## Webhooks (module-owned, no generic router)

- `POST /api/modules/cafe-orders/webhooks/swiggy` — HMAC-SHA256 vs `SWIGGY_SECRET`
- `POST /api/modules/cafe-orders/webhooks/zomato` — HMAC-SHA256 vs `ZOMATO_SECRET`

Webhooks read the target tenant from the `tenantId` query/header (see the
mounted route in `apps/web`).

## Actions

- `listOrders(tenantId, limit)`
- `markOrderStatus(tenantId, orderId, status)`
