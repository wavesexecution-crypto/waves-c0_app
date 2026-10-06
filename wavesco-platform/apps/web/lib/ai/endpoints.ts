/**
 * Server-authoritative AI provider endpoints.
 *
 * SECURITY: `ClientAiConfig.baseUrl` is tenant-writable, and both AI call
 * paths sent the platform credential (`credentialRef` → `env:…`) to whatever
 * URL was stored there. A tenant could therefore point `baseUrl` at their own
 * host and harvest the platform API key, or at an internal address for SSRF
 * (cloud metadata, private ranges).
 *
 * The endpoint is therefore NOT tenant data. A tenant row may only carry a
 * base URL that matches the allowlist for its provider; anything else is
 * rejected on write and re-checked on call, so a row written before this
 * policy existed still cannot exfiltrate a credential.
 *
 * This is a security policy, not a pricing or product decision: no provider,
 * model, or plan is added or removed here.
 */

/** Canonical endpoints, server-owned. */
const PROVIDER_BASE_URLS: Record<string, string> = {
  ollama_cloud: "https://ollama.com/v1",
};

/** Hosts that must never be reachable, whatever the allowlist says. */
const FORBIDDEN_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "::1",
  "[::1]",
  "169.254.169.254",
  "metadata.google.internal",
  "metadata",
]);

function ipv4IsPrivate(host: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  if (a === 127 || a === 10 || a === 0) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true;
  return false;
}

function hostIsPrivate(host: string): boolean {
  const h = host.toLowerCase();
  if (FORBIDDEN_HOSTS.has(h)) return true;
  if (ipv4IsPrivate(h)) return true;
  if (h.endsWith(".local") || h.endsWith(".internal") || h.endsWith(".localhost")) return true;
  if (h === "::1" || h.startsWith("fc") || h.startsWith("fd") || h.startsWith("fe80")) return true;
  return false;
}

/**
 * Hosts allowed for a provider: the provider's own canonical host, plus any
 * operator-added hosts in `AI_ALLOWED_BASE_URL_HOSTS` (comma-separated
 * exact hosts or `.suffix` entries, for approved proxies/regions).
 */
export function allowedHostsFor(provider: string): Set<string> {
  const allowed = new Set<string>();
  const canonical = PROVIDER_BASE_URLS[provider];
  if (canonical) {
    try {
      allowed.add(new URL(canonical).hostname.toLowerCase());
    } catch {
      /* a malformed constant must not widen the allowlist */
    }
  }
  for (const raw of (process.env.AI_ALLOWED_BASE_URL_HOSTS ?? "").split(",")) {
    const host = raw.trim().toLowerCase();
    if (host) allowed.add(host);
  }
  return allowed;
}

/** Exact host, or a `.suffix` entry matching any host under that domain. */
function hostIsAllowed(host: string, allowed: Set<string>): boolean {
  if (allowed.has(host)) return true;
  for (const entry of allowed) {
    if (entry.startsWith(".") && host.endsWith(entry) && host.length > entry.length) {
      return true;
    }
  }
  return false;
}

export interface BaseUrlCheck {
  ok: boolean;
  /** Normalised origin+path, present only when `ok`. */
  url?: string;
  /** Operator-facing reason for a rejection. */
  reason?: string;
}

/**
 * Validate a candidate base URL for a provider. Fails closed: an unknown
 * provider, a non-HTTPS scheme, embedded credentials, a private/loopback
 * host, or a host outside the allowlist is all rejected.
 */
export function checkProviderBaseUrl(provider: string, candidate: string): BaseUrlCheck {
  const trimmed = candidate.trim();
  if (!trimmed) return { ok: false, reason: "baseUrl must not be empty" };

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { ok: false, reason: "baseUrl must be a valid absolute URL" };
  }

  if (url.username || url.password) {
    return { ok: false, reason: "baseUrl must not embed credentials" };
  }
  // Local development against Ollama needs plain HTTP, so http is permitted
  // only for loopback — and loopback is otherwise forbidden, so this stays
  // unreachable in production by construction.
  const isLoopbackHttp = url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname);
  if (url.protocol !== "https:" && !isLoopbackHttp) {
    return { ok: false, reason: "baseUrl must use https" };
  }
  if (hostIsPrivate(url.hostname)) {
    return { ok: false, reason: "baseUrl must not point at a private or loopback address" };
  }

  const allowed = allowedHostsFor(provider);
  if (!hostIsAllowed(url.hostname.toLowerCase(), allowed)) {
    return { ok: false, reason: "baseUrl host is not an approved endpoint for this provider" };
  }
  return { ok: true, url: `${url.origin}${url.pathname.replace(/\/+$/, "")}` };
}

/**
 * Resolve the endpoint to actually call. A stored base URL is used only when
 * it passes the allowlist; otherwise the provider's canonical endpoint is
 * used. Never returns a URL that has not passed `checkProviderBaseUrl`.
 */
export function resolveProviderBaseUrl(provider: string, configured?: string | null): BaseUrlCheck {
  const canonical = PROVIDER_BASE_URLS[provider];
  if (typeof configured === "string" && configured.trim()) {
    const checked = checkProviderBaseUrl(provider, configured);
    if (checked.ok) return checked;
    if (canonical) {
      const fallback = checkProviderBaseUrl(provider, canonical);
      if (fallback.ok) return fallback;
    }
    return checked;
  }
  if (!canonical) return { ok: false, reason: `Unknown provider "${provider}"` };
  return checkProviderBaseUrl(provider, canonical);
}

/** Mask a base URL for display: keeps scheme+host, hides path. */
export function maskBaseUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    return `${u.origin}/***`;
  } catch {
    return "***";
  }
}