/**
 * Waves AI Gateway — /api/ai/gateway
 *
 * Every AI call from the Lead Engine MUST route through this gateway.
 * The gateway:
 *   1. Validates the shared-secret Bearer token
 *   2. Resolves the tenant's ClientAiConfig (provider, model, endpoint)
 *   3. If AI is disabled for the tenant → 403 immediately (zero AI calls)
 *   4. Proxies to the configured provider adapter (Ollama Cloud = OpenAI-compat)
 *   5. Logs usage to AiUsageLog
 *   6. Returns { ok, text, model, provider }
 *
 * Contract (consumed by Python enrich_ai.py and platform planner):
 *   POST /api/ai/gateway/
 *   Headers: Authorization: Bearer <GATEWAY_TOKEN>, Content-Type: application/json
 *   Body: { operation: "enrich"|"email", system: string, prompt: string, model?: string }
 *   Response: { ok: true, text: string, model: string, provider: string }
 *   Error: { ok: false, error: string, status: string }
 */

import { type NextRequest, NextResponse } from "next/server";
import { directPrisma, withTenantContext, type DB } from "@wavesco/db";
import { resolveProviderBaseUrl } from "@/lib/ai/endpoints";

const GATEWAY_TOKEN = process.env.LEAD_ENGINE_GATEWAY_TOKEN;

interface ProviderResponse {
  choices?: { message?: { content?: string } }[];
  model?: string;
}

type ProviderAdapter = (
  baseUrl: string,
  apiKey: string,
  model: string,
  system: string,
  prompt: string,
) => Promise<{ text: string; model: string }>;

/**
 * Ollama Cloud adapter — OpenAI-compatible /v1/chat/completions.
 */
const ollamaCloudAdapter: ProviderAdapter = async (
  baseUrl,
  apiKey,
  model,
  system,
  prompt,
) => {
  const url = `${baseUrl.replace(/\/$/, "")}/chat/completions`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: prompt },
      ],
      temperature: 0.3,
    }),
    signal: AbortSignal.timeout(120_000),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `provider HTTP ${res.status}: ${body.substring(0, 300)}`,
    );
  }

  const data = (await res.json()) as ProviderResponse;
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error("provider returned empty response");
  return { text, model: data.model ?? model };
};

const ADAPTERS: Record<string, ProviderAdapter> = {
  ollama_cloud: ollamaCloudAdapter,
  openai: ollamaCloudAdapter,
};

interface GatewayRequest {
  operation: "enrich" | "email";
  system: string;
  prompt: string;
  model?: string;
}

export async function POST(request: NextRequest) {
  // 1. Validate Bearer token
  const auth = request.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) {
    return NextResponse.json(
      { ok: false, error: "missing or invalid Authorization header", status: "auth_required" },
      { status: 401 },
    );
  }
  const token = auth.slice(7);
  if (!GATEWAY_TOKEN || token !== GATEWAY_TOKEN) {
    return NextResponse.json(
      { ok: false, error: "invalid gateway token", status: "auth_failed" },
      { status: 401 },
    );
  }

  // 2. Parse body
  let body: GatewayRequest;
  try {
    body = (await request.json()) as GatewayRequest;
  } catch {
    return NextResponse.json(
      { ok: false, error: "invalid JSON body", status: "bad_request" },
      { status: 400 },
    );
  }

  if (!body.system || !body.prompt) {
    return NextResponse.json(
      { ok: false, error: "missing required fields: system, prompt", status: "bad_request" },
      { status: 400 },
    );
  }

  // 3. Resolve tenant from header or env (slug or ID)
  const tenantRef =
    request.headers.get("x-wavesco-tenant") ??
    process.env.WAVESCO_ENGINE_TENANT ??
    "wavesco-hq";

  // 4. Resolve slug → tenant ID if needed (ClientAiConfig.tenantId stores the full ID).
  // Owner-role read: engine callers carry no tenant RLS context, so an
  // RLS-bound lookup would always miss and every AI call would 404.
  const tenant = await directPrisma().tenant.findFirst({
    where: { OR: [{ id: tenantRef }, { slug: tenantRef }] },
  });
  if (!tenant) {
    return NextResponse.json(
      { ok: false, error: `unknown tenant: ${tenantRef}`, status: "unknown_tenant" },
      { status: 404 },
    );
  }
  const tenantId = tenant.id;

  // 5. Look up ClientAiConfig for this tenant
  const config = await withTenantContext(tenantId, async (tx) => {
    return (tx as DB).clientAiConfig.findFirst({
      where: { tenantId },
      orderBy: { createdAt: "desc" },
    });
  });

  if (!config) {
    return NextResponse.json(
      { ok: false, error: `no AI config for tenant: ${tenantRef}`, status: "no_config" },
      { status: 404 },
    );
  }

  // 6. If AI is disabled → zero calls
  if (!config.aiEnabled) {
    return NextResponse.json(
      {
        ok: false,
        error: "AI is disabled for this client",
        status: "ai_disabled",
      },
      { status: 403 },
    );
  }

  // 7. Resolve provider adapter
  const adapter = ADAPTERS[config.provider];
  if (!adapter) {
    return NextResponse.json(
      { ok: false, error: `unknown provider: ${config.provider}`, status: "unknown_provider" },
      { status: 400 },
    );
  }

  const model = body.model ?? config.model ?? "gemma4:31b";
  // The endpoint is server-authoritative. The tenant-writable baseUrl is only
  // honoured when it matches the provider allowlist, so it cannot redirect
  // OPENAI_API_KEY to an attacker host or an internal address.
  const endpoint = resolveProviderBaseUrl(config.provider, config.baseUrl);
  if (!endpoint.ok || !endpoint.url) {
    return NextResponse.json(
      { ok: false, error: "no approved endpoint for this provider", status: "endpoint_not_allowed" },
      { status: 400 },
    );
  }
  const baseUrl = endpoint.url;
  const apiKey = process.env.OPENAI_API_KEY ?? "";

  // 8. Call provider
  const startTime = Date.now();
  let result: { text: string; model: string };
  try {
    result = await adapter(baseUrl, apiKey, model, body.system, body.prompt);
  } catch (err) {
    const elapsed = Date.now() - startTime;
    const errorMsg = err instanceof Error ? err.message : String(err);

    // Log failure
    await logUsage({
      tenantId,
      operation: body.operation,
      provider: config.provider,
      model,
      inputTokens: 0,
      outputTokens: 0,
      latencyMs: elapsed,
      status: "error",
      error: errorMsg,
    });

    return NextResponse.json(
      { ok: false, error: errorMsg, status: "provider_error" },
      { status: 502 },
    );
  }

  // 9. Log success
  const elapsed = Date.now() - startTime;
  // Rough token estimate (4 chars ≈ 1 token)
  const inputTokens = Math.ceil((body.system.length + body.prompt.length) / 4);
  const outputTokens = Math.ceil(result.text.length / 4);

  await logUsage({
    tenantId,
    operation: body.operation,
    provider: config.provider,
    model: result.model,
    inputTokens,
    outputTokens,
    latencyMs: elapsed,
    status: "success",
  });

  // 10. Return OpenAI-compatible response
  return NextResponse.json({
    ok: true,
    text: result.text,
    model: result.model,
    provider: config.provider,
  });
}

async function logUsage(entry: {
  tenantId: string;
  operation: string;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  status: string;
  error?: string;
}): Promise<void> {
  try {
    await withTenantContext(entry.tenantId, async (tx) => {
      await (tx as DB).aiUsageLog.create({
        data: {
          tenantId: entry.tenantId,
          provider: entry.provider,
          model: entry.model,
          operation: entry.operation,
          inputTokens: entry.inputTokens,
          outputTokens: entry.outputTokens,
          latencyMs: entry.latencyMs,
          status: entry.status,
          error: entry.error ?? null,
        },
      });
    });
  } catch {
    // Non-critical — don't fail the request
  }
}
