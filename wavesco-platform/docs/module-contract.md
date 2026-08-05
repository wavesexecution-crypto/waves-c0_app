# WavesCo Module Contract

Every CafeOS module declares a `module.contract.json` at `modules/<name>/module.contract.json`,
validated against [`module-contract.schema.json`](./module-contract.schema.json) by
`pnpm verify:contracts`.

## Fields

| Field | Type | Required | Meaning |
|---|---|---|---|
| `name` | string | yes | Machine name; must match the module directory (`^[a-z0-9]+(-[a-z0-9]+)*$`) |
| `displayName` | string | yes | Human-readable name |
| `version` | string | yes | Semver (`x.y.z`) |
| `description` | string | yes | One-liner |
| `entry` | string | yes | Module entry file (e.g. `src/index.ts`) |
| `requiresEnv` | string[] | no | Env vars that MUST be set before the module can be enabled. Missing values = loud failure. |
| `tables` | string[] | yes | Prisma model names owned by this module (all tenant-scoped) |
| `webhooks` | array | yes | Per-module webhook routes owned by the module |
| `permissions` | array | yes | Action/resource pairs exposed by the module |
| `audit` | boolean | yes | `false` opts the module's tables out of the auto-audit extension |
| `actions` | string[] | no | Server action names exported by the module |

## Webhook object

| Field | Type | Meaning |
|---|---|---|
| `path` | string | Route, e.g. `/api/modules/cafe-orders/webhooks/swiggy` |
| `method` | string | `GET`, `POST`, `PUT`, `PATCH`, `DELETE` |
| `signature` | string | `hmac-sha256` \| `none` \| `bearer` |

## Cross-module rules

- Modules must NOT import other `@wavesco/modules/*` packages directly.
- Modules reach sibling data only through the registry and their contracts.
- Enabling a module validates `requiresEnv`; a missing key fails loudly.

## Example

```json
{
  "name": "cafe-leads",
  "displayName": "Cafe Leads",
  "version": "0.1.0",
  "description": "Lead capture with AI enrichment.",
  "entry": "src/index.ts",
  "requiresEnv": ["OPENAI_API_KEY", "TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID"],
  "tables": ["CafeLead"],
  "webhooks": [],
  "permissions": [{ "action": "create", "resource": "cafe-leads/lead" }],
  "audit": true,
  "actions": ["createLead", "listLeads"]
}
```
