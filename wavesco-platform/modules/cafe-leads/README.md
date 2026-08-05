# Cafe Leads

Lead capture with AI enrichment and instant Telegram alerts.

## Requires (fail loudly when missing)

- `OPENAI_API_KEY` — enrichment (`gpt-4o-mini`)
- `TELEGRAM_BOT_TOKEN` — alert delivery
- `TELEGRAM_CHAT_ID` — where alerts land

## Tables

| Model | Purpose |
|---|---|
| `CafeLead` | Captured lead with enrichment fields |

## Actions

- `createLead(tenantId, input)` — validates input, runs real OpenAI enrichment, saves the lead, posts a real Telegram alert
- `listLeads(tenantId, limit)` — recent leads

## Webhooks

None.
