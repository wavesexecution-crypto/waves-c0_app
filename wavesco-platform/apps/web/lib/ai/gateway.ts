import { withTenantContext } from "@wavesco/db";
import { resolveProviderBaseUrl } from "./endpoints";

/**
 * Waves AI Gateway — the ONLY path through which WavesCo code may call an
 * AI provider. Provider choice, credentials and model are resolved per
 * tenant from ClientAiConfig; secrets stay server-side and are never
 * returned to callers or the browser.
 *
 * Flow:  client_id(tenantId) → ClientAiConfig → credentialRef resolution
 *        → provider adapter → response (+ AiUsageLog row)
 */

export type AiOperation =
  | "generate"
  | "analyze"
  | "research"
  | "enrich"
  | "summarize";

export interface GatewayInput {
  system?: string;
  prompt: string;
  temperature?: number;
}

export interface GatewayResult {
  ok: boolean;
  status: "completed" | "disabled" | "unconfigured" | "failed";
  text?: string;
  model?: string;
  provider?: string;
  usage?: { inputTokens?: number; outputTokens?: number; latencyMs?: number };
  error?: string;
}

interface ResolvedConfig {
  aiEnabled: boolean;
  provider: string;
  baseUrl: string;
  model: string;
  apiKey: string;
}

/** Credential references: only "env:VARNAME" is supported today. */
function resolveCredential(ref: string | null | undefined): string {
  if (!ref) return "";
  if (ref.startsWith("env:")) {
    return process.env[ref.slice(4)]?.trim() ?? "";
  }
  return "";
}

async function loadClientAiConfig(tenantId: string): Promise<ResolvedConfig | null> {
  return withTenantContext(tenantId, async (tx) => {
    const cfg = await tx.clientAiConfig.findUnique({ where: { tenantId } });
    if (!cfg) return null;
    return {
      aiEnabled: cfg.aiEnabled,
      provider: cfg.provider,
      baseUrl: cfg.baseUrl ?? "",
      model: cfg.model ?? "",
      apiKey: resolveCredential(cfg.credentialRef),
    };
  });
}

// ------------------------------------------------------------------
// Provider adapters. Each adapter returns text + token usage.
// Only ollama_cloud exists today; the registry is the extension point
// for openai / anthropic / gemini / local_ollama later.
// ------------------------------------------------------------------

type Adapter = (args: {
  baseUrl: string;
  model: string;
  apiKey: string;
  operation: AiOperation;
  input: GatewayInput;
}) => Promise<{ text: string; inputTokens?: number; outputTokens?: number }>;

const openAiCompatible: Adapter = async ({ baseUrl, model, apiKey, input }) => {
  const res = await fetch(`${baseUrl.replace(/\/+$/, "")}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      temperature: input.temperature ?? 0.3,
      messages: [
        ...(input.system ? [{ role: "system", content: input.system }] : []),
        { role: "user", content: input.prompt },
      ],
    }),
    cache: "no-store",
    // Bounded: a hung provider must fail into the deterministic fallback,
    // never hang the request holding the caller's transaction.
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    throw new Error(body?.error?.message ?? `provider HTTP ${res.status}`);
  }
  const j = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const text = j.choices?.[0]?.message?.content ?? "";
  if (!text) throw new Error("empty completion");
  return {
    text,
    inputTokens: j.usage?.prompt_tokens,
    outputTokens: j.usage?.completion_tokens,
  };
};

const ADAPTERS: Record<string, Adapter> = {
  ollama_cloud: openAiCompatible, // Ollama Cloud exposes an OpenAI-compatible API
};

// Rough public list pricing (USD / 1M tokens); refine per provider later.
const COST_PER_MTOK: Record<string, { in: number; out: number }> = {
  "gemma4:31b": { in: 0.2, out: 0.6 },
};

function estimateCost(model: string, inTok?: number, outTok?: number): number | null {
  const rate = COST_PER_MTOK[model];
  if (!rate || !inTok || !outTok) return null;
  return Math.round(((inTok * rate.in + outTok * rate.out) / 1_000_000) * 1e6) / 1e6;
}

export interface GatewayCall {
  tenantId: string;
  operation: AiOperation;
  input: GatewayInput;
}

/**
 * Single entry point for ALL WavesCo AI calls. Tenant-scoped, audited,
 * provider-agnostic. Never returns credentials.
 */
export async function wavesAi(call: GatewayCall): Promise<GatewayResult> {
  const started = Date.now();
  const finish = async (r: GatewayResult): Promise<GatewayResult> => {
    try {
      await withTenantContext(call.tenantId, async (tx) => {
        await tx.aiUsageLog.create({
          data: {
            tenantId: call.tenantId,
            operation: call.operation,
            provider: r.provider ?? "unknown",
            model: r.model ?? "none",
            status: r.status,
            inputTokens: r.usage?.inputTokens ?? null,
            outputTokens: r.usage?.outputTokens ?? null,
            estimatedCostUsd: estimateCost(r.model ?? "", r.usage?.inputTokens, r.usage?.outputTokens),
            latencyMs: Date.now() - started,
            error: r.error ?? null,
          },
        });
      });
    } catch {
      // usage ledger must never break the caller
    }
    return r;
  };

  let cfg: ResolvedConfig | null;
  try {
    cfg = await loadClientAiConfig(call.tenantId);
  } catch (e) {
    return finish({ ok: false, status: "failed", error: e instanceof Error ? e.message : "config load failed" });
  }

  if (!cfg) {
    return finish({ ok: false, status: "unconfigured", error: "No AI configuration for this workspace." });
  }
  if (!cfg.aiEnabled) {
    return finish({ ok: false, status: "disabled", error: "AI is disabled for this workspace." });
  }
  const adapter = ADAPTERS[cfg.provider];
  if (!adapter) {
    return finish({ ok: false, status: "unconfigured", error: `Unknown provider "${cfg.provider}".` });
  }
  if (!cfg.apiKey) {
    return finish({ ok: false, status: "unconfigured", error: `Credential reference unresolved (${cfg.provider}).` });
  }

  // The endpoint is server-authoritative. The stored base URL is used only if
  // it matches the provider allowlist, so a tenant-controlled row can never
  // redirect the platform credential to a host of their choosing.
  const endpoint = resolveProviderBaseUrl(cfg.provider, cfg.baseUrl);
  if (!endpoint.ok || !endpoint.url) {
    return finish({
      ok: false,
      status: "unconfigured",
      provider: cfg.provider,
      model: cfg.model,
      error: "No approved AI endpoint is configured for this workspace.",
    });
  }

  try {
    const out = await adapter({
      baseUrl: endpoint.url,
      model: cfg.model,
      apiKey: cfg.apiKey,
      operation: call.operation,
      input: call.input,
    });
    return await finish({
      ok: true,
      status: "completed",
      text: out.text,
      model: cfg.model,
      provider: cfg.provider,
      usage: { inputTokens: out.inputTokens, outputTokens: out.outputTokens, latencyMs: Date.now() - started },
    });
  } catch (e) {
    return finish({
      ok: false,
      status: "failed",
      provider: cfg.provider,
      model: cfg.model,
      error: e instanceof Error ? e.message : "provider call failed",
    });
  }
}
