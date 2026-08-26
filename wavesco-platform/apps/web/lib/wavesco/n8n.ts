import { readFileSync } from "node:fs";

/**
 * Server-only client for the EXISTING n8n instance (localhost:5678).
 * - REST API (/api/v1) requires N8N_API_KEY; without it the platform
 *   reports Automation OS as DISCONNECTED (never faked).
 * - Webhook helpers call the existing Notify Hub bridge and Approval
 *   Queue endpoints that production flows already use.
 */

export function n8nBaseUrl(): string | null {
  const trimmed = process.env.N8N_BASE_URL?.trim() ?? "";
  if (trimmed.length === 0) return null;
  return trimmed.replace(/\/+$/, "");
}

export function n8nApiKey(): string | null {
  const key = process.env.N8N_API_KEY?.trim() ?? "";
  return key.length > 0 ? key : null;
}

export interface ApiResult<T> {
  ok: boolean;
  status: number;
  data?: T;
  error?: string;
  reason?: "no_base_url" | "no_api_key" | "http_error" | "network";
}

async function api<T>(path: string): Promise<ApiResult<T>> {
  const base = n8nBaseUrl();
  if (!base) return { ok: false, status: 0, reason: "no_base_url", error: "N8N_BASE_URL is not configured" };
  const key = n8nApiKey();
  if (!key) {
    return {
      ok: false,
      status: 0,
      reason: "no_api_key",
      error:
        "No n8n API key configured. Create one in n8n (Settings → n8n API → Create API key) and set N8N_API_KEY.",
    };
  }
  try {
    const res = await fetch(`${base}${path}`, {
      headers: { accept: "application/json", "X-N8N-API-KEY": key },
      cache: "no-store",
    });
    if (!res.ok) {
      return { ok: false, status: res.status, reason: "http_error", error: `n8n API ${res.status}` };
    }
    return { ok: true, status: res.status, data: (await res.json()) as T };
  } catch (e) {
    return { ok: false, status: 0, reason: "network", error: e instanceof Error ? e.message : "network error" };
  }
}

export interface N8nWorkflowSummary {
  id: string;
  name: string;
  active: boolean;
  updatedAt?: string;
  tags?: { id: string; name: string }[];
}

export interface N8nExecutionSummary {
  id: string;
  workflowId?: string;
  status?: string;
  startedAt?: string;
  stoppedAt?: string;
  mode?: string;
}

export async function getWorkflows(): Promise<ApiResult<{ data: N8nWorkflowSummary[] }>> {
  return api("/api/v1/workflows?limit=100");
}

export async function getExecutions(limit = 50): Promise<ApiResult<{ data: N8nExecutionSummary[] }>> {
  return api(`/api/v1/executions?limit=${limit}&includeData=false`);
}

export async function getHealth(): Promise<ApiResult<{ status?: string }>> {
  const base = n8nBaseUrl();
  if (!base) return { ok: false, status: 0, reason: "no_base_url", error: "N8N_BASE_URL missing" };
  try {
    const res = await fetch(`${base}/healthz`, { cache: "no-store" });
    return { ok: res.ok, status: res.status, data: res.ok ? ({ status: "ok" } as const) : undefined };
  } catch (e) {
    return { ok: false, status: 0, reason: "network", error: e instanceof Error ? e.message : "unreachable" };
  }
}

// ------------------------------------------------------------------
// Offline manifest of the Personal Automation Suite (real artifact on
// disk, maintained next to the workflows). Shown ONLY as a labelled
// inventory when the REST API is unavailable — never as live state.
// ------------------------------------------------------------------

export interface ManifestWorkflow {
  name: string;
  id: string;
  trigger: string;
  purpose: string;
}

export function readAutomationManifest(): {
  ok: boolean;
  suite?: string;
  instance?: string;
  generatedAt?: string;
  allActive?: boolean;
  workflows?: ManifestWorkflow[];
  error?: string;
} {
  const manifestPath = process.env.N8N_MANIFEST_PATH?.trim() ?? "";
  const resolved = manifestPath.length > 0 ? manifestPath : "D:\\n8n-personal-automations\\workflows-manifest.json";
  try {
    const raw = JSON.parse(readFileSync(resolved, "utf8")) as {
      suite?: string;
      instance?: string;
      generated_at?: string;
      all_active?: boolean;
      workflows?: ManifestWorkflow[];
    };
    return {
      ok: true,
      suite: raw.suite,
      instance: raw.instance,
      generatedAt: raw.generated_at,
      allActive: raw.all_active,
      workflows: raw.workflows ?? [],
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "manifest unreadable" };
  }
}

// ------------------------------------------------------------------
// Existing webhook surfaces
// ------------------------------------------------------------------

/** Submits an outbound email into the existing Approval Queue. */
export async function submitApproval(payload: {
  type: string;
  recipient: string;
  subject: string;
  body: string;
}): Promise<ApiResult<unknown>> {
  const base = n8nBaseUrl();
  if (!base) return { ok: false, status: 0, reason: "no_base_url" };
  try {
    const res = await fetch(`${base}/webhook/personal/approval`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      cache: "no-store",
    });
    let data: unknown = undefined;
    try {
      data = await res.json();
    } catch {
      // non-JSON response body
    }
    return res.ok ? { ok: true, status: res.status, data } : { ok: false, status: res.status, reason: "http_error" };
  } catch (e) {
    return { ok: false, status: 0, reason: "network", error: e instanceof Error ? e.message : "unreachable" };
  }
}

/** Decides a queued approval through the existing endpoint (approve → Email Outbox dispatch). */
export async function decideApproval(id: number, decision: "approve" | "reject"): Promise<ApiResult<unknown>> {
  const base = n8nBaseUrl();
  if (!base) return { ok: false, status: 0, reason: "no_base_url" };
  try {
    const res = await fetch(
      `${base}/webhook/personal/approval-decide?id=${encodeURIComponent(String(id))}&decision=${decision}`,
      { cache: "no-store" },
    );
    let data: unknown = undefined;
    try {
      data = await res.json();
    } catch {
      // non-JSON response body
    }
    return res.ok ? { ok: true, status: res.status, data } : { ok: false, status: res.status, reason: "http_error" };
  } catch (e) {
    return { ok: false, status: 0, reason: "network", error: e instanceof Error ? e.message : "unreachable" };
  }
}
