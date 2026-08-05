# Cafe CRM

Customer tagging, LTV calculation and WhatsApp re-engagement.

## Requires (fail loudly when missing)

- `WHATSAPP_API_KEY` — provider auth
- `WHATSAPP_API_URL` — provider endpoint

## Tables

| Model | Purpose |
|---|---|
| `CafeCustomer` | Customer with computed tag (NEW/RETURNING/VIP) and LTV |
| `CafeCustomerVisit` | Visit ledger used to compute LTV + tag |
| `CafeReengagementLog` | Outbound WhatsApp attempts |

## Actions

- `upsertCustomer(tenantId, input)` — by phone
- `recordVisit(tenantId, input)` — increments visits/LTV, re-tags
- `sendReengagement(tenantId, input)` — real WhatsApp send + log

## Webhooks

None.
