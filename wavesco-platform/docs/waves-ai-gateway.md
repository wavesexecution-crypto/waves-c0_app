---
tags:
  - wavesco
  - ai
  - gateway
  - architecture
created: 2026-08-26
status: LIVE — ollama_cloud adapter; per-tenant config + usage ledger + RLS
---

# Waves AI Gateway

The single abstraction boundary for ALL WavesCo AI calls. Provider choice is an implementation detail behind this interface.

## API

```ts
wavesAi({ tenantId, operation, input: { prompt, system?, temperature? } })
  → { ok, status: completed|disabled|unconfigured|failed,
      text?, model?, provider?, usage?: {inputTokens, outputTokens, latencyMs}, error? }
```

Operations: `generate · analyze · research · enrich · summarize`
Resolution chain per call: **tenantId → ClientAiConfig → credentialRef (`env:VAR`) → provider adapter → response**, then an `AiUsageLog` row (tenant-scoped, RLS).

## Provider adapters

Registry in `apps/web/lib/ai/gateway.ts`. Live today:

- `ollama_cloud` → OpenAI-compatible chat completions (baseUrl from config, e.g. https://ollama.com/v1)

Extension point ready for `openai`, `anthropic`, `gemini`, `local_ollama` — add an adapter entry + cost row; nothing else changes.

## Client AI configuration (model)

`ClientAiConfig` (one row per tenant, unique tenantId): aiEnabled · provider · baseUrl · model · **credentialRef** (`env:VARNAME` only today) · obsidianRoot (reserved for per-client vault scoping) · config Json.

Current live row: wavesco-hq → ollama_cloud / https://ollama.com/v1 / gemma4:31b / env:OPENAI_API_KEY / enabled.

## Isolation guarantees (verified)

- Config + usage rows are RLS-guarded; cross-tenant reads return zero rows (tested).
- Disabled workspace → gateway short-circuits `status:"disabled"` BEFORE any provider call.
- Gateway responses structurally exclude credentials (leak-check against live keys passed).
- Engine endpoint `/api/ai/gateway` is bearer-token guarded and hard-pinned to `WAVESCO_ENGINE_TENANT`.

## Callers migrated

| Caller | Before | Now |
|---|---|---|
| Intelligence AI action | direct fetch to provider | `wavesAi(analyze)` |
| Lead Engine `enrich_ai.py` | direct requests to provider | HTTP → `/api/ai/gateway` (`enrich`) with shared token |
| Obsidian topic retrieval inside AI | direct | unchanged retrieval (tenant session) but logged under the caller's tenant |

## Usage & cost

`AiUsageLog`: tenantId · operation · provider · model · status · input/output tokens (when provider reports) · estimatedCostUsd (rate table per model) · latencyMs · error · timestamp. Ready for per-client billing later.

## Known limitations

- One real tenant exists; multi-Ollama-account routing is proven at the mechanism level (per-tenant rows), not with two live accounts.
- Obsidian vault partitioning per client awaits an owner policy (`obsidianRoot` field reserved).
- Cost table has a single model entry.
