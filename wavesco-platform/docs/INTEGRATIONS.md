# Integrations — Health Matrix + Test Connection

## Matrix (live via `GET /api/system/health` and `/acquisition/integrations`)

| Integration | Key | State when configured | State when missing | How to fix |
|-------------|-----|-----------------------|--------------------|------------|
| Lead Engine (local) | `LEAD_ENGINE_ROOT` | `connected` if `data/leads.db` exists | `disconnected` | Ensure `D:\wavesco-lead-engine\data\leads.db` exists; path default `D:\wavesco-lead-engine` |
| Lead Engine (remote) | `LEAD_ENGINE_API_URL` + `LEAD_ENGINE_API_TOKEN` + `LEAD_ENGINE_MODE=remote` | `connected` if `GET /health` returns ok | `BLOCKED` | `vercel env add LEAD_ENGINE_API_URL` + `LEAD_ENGINE_API_TOKEN`, ensure `serve.py` + tunnel reachable |
| Postgres / Neon | `DATABASE_URL` + `DIRECT_URL` | `connected` (`SELECT 1` latency) | `BLOCKED` / `error` | `docker compose up -d` locally; `vercel env ls` shows SET for prod |
| n8n | `N8N_BASE_URL` + `N8N_API_KEY` | `connected` (`GET /healthz` ok) | `BLOCKED` (`N8N_BASE_URL missing`) or `disconnected` (`no_api_key`) | Set both vars (Settings → n8n API → Create key) then redeploy; fallback manifest `D:\n8n-personal-automations\workflows-manifest.json` shown as inventory only when API unavailable |
| Brevo | `BREVO_API_KEY` | `connected` | `BLOCKED` (`BREVO_API_KEY missing`) | `vercel env add BREVO_API_KEY` |
| AI Gateway | `OPENAI_API_KEY/BASE_URL/MODEL` or per-tenant `ClientAiConfig.credentialRef` | `connected` (aiEnabled + provider ok) | `BLOCKED` / `unconfigured` / `disabled` | Set `OPENAI_*` or tenant `ClientAiConfig` (`env:VAR`); verify `/acquisition/agents` masked |
| Telegram Notify Hub | `TELEGRAM_BOT_TOKEN` + `n8n_bridge_url http://localhost:5678/webhook/personal/wavesco-leads` | `connected` (last delivery in manifest) | `disconnected` | Set token via `WAVESCO_ENV_PATH` or engine `.env` |
| Google Sheets | `sheet_sync.mode` | `disconnected` (mode `local` → XLSX mirror) | — | Provision `google_service_account_json` to flip to `remote` |
| Google Drive | — | `unavailable` | — | No code path (dossier §10/40) |

## How engineers use

- **View matrix:** `/acquisition/integrations` (health cards: lead_engine/n8n/brevo/db/ai_gateway/persisted IntegrationStatus, masked URLs, latency, usage last 24h).
- **Test Connection:** `POST /api/acquisition/integrations/test { key: lead_engine|n8n|brevo|db|ai_gateway }` — server-side probe, returns `{ status, detail, reason }` masked (never leaks key). Writes `AuditLog action integrations.test model IntegrationStatus`.
- **Persisted health:** `computeIntegrationStatuses(tenantId)` upserts `IntegrationStatus { tenantId+key → state detail lastCheckedAt/lastOkAt }` per `withTenantContext`.
- **Pill mapping:** `ok/connected → emerald`, `BLOCKED/disconnected → zinc`, `error → red`, `missing/unavailable → zinc`.

## Vercel prod env (2026-09-02 `vercel env ls`)

SET: `DATABASE_URL, DIRECT_URL, NEXTAUTH_URL, AUTH_SECRET, NEXTAUTH_SECRET, JWT_SECRET, LEAD_ENGINE_* (remote), OPENAI_*` · BLOCKED: `N8N_BASE_URL, N8N_API_KEY, BREVO_API_KEY, OBSIDIAN_API_KEY` (not in `vercel env ls`). Marking is truthful; never fake `ok`.

## Troubleshooting

- Overview shows `Lead Engine unavailable` → check `LEAD_ENGINE_MODE` vs `LEAD_ENGINE_ROOT`/`LEAD_ENGINE_API_URL`; remote mode checks `GET /health` and surfaces `EngineUnavailableError`.
- Workflows `BLOCKED` → expected until `N8N_BASE_URL` set; verify via `/api/acquisition/workflows` returns `{ status:"BLOCKED", reason:"N8N_BASE_URL missing" }`.
