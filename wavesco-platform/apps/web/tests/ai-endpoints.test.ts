/**
 * The AI provider endpoint is server-authoritative. A tenant-writable
 * `ClientAiConfig.baseUrl` used to receive the platform credential, so these
 * tests pin the allowlist that stops that.
 */
import { describe, it, expect, afterEach } from "vitest";
import {
  checkProviderBaseUrl,
  resolveProviderBaseUrl,
  allowedHostsFor,
} from "@/lib/ai/endpoints";

const OLD_ENV = { ...process.env };
afterEach(() => {
  process.env = { ...OLD_ENV };
});

describe("AI provider endpoint allowlist", () => {
  it("accepts the provider's own canonical endpoint", () => {
    const r = checkProviderBaseUrl("ollama_cloud", "https://ollama.com/v1");
    expect(r.ok).toBe(true);
    expect(r.url).toBe("https://ollama.com/v1");
  });

  it("rejects an attacker host — the credential must never be sent there", () => {
    for (const hostile of [
      "https://evil.example/v1",
      "https://ollama.com.evil.example/v1",
      "https://evil.example/v1?x=https://ollama.com",
      "https://user:pass@ollama.com/v1",
    ]) {
      const r = checkProviderBaseUrl("ollama_cloud", hostile);
      expect(r.ok, `expected rejection for ${hostile}`).toBe(false);
    }
  });

  it("rejects cloud metadata and loopback (SSRF)", () => {
    for (const internal of [
      "http://169.254.169.254/latest/meta-data/",
      "https://metadata.google.internal/",
      "https://localhost:11434/v1",
      "https://127.0.0.1/v1",
      "https://10.0.0.5/v1",
      "https://192.168.1.10/v1",
      "https://172.16.0.1/v1",
    ]) {
      const r = checkProviderBaseUrl("ollama_cloud", internal);
      expect(r.ok, `expected rejection for ${internal}`).toBe(false);
    }
  });

  it("rejects non-https schemes", () => {
    expect(checkProviderBaseUrl("ollama_cloud", "http://ollama.com/v1").ok).toBe(false);
    expect(checkProviderBaseUrl("ollama_cloud", "ftp://ollama.com/v1").ok).toBe(false);
    expect(checkProviderBaseUrl("ollama_cloud", "not a url").ok).toBe(false);
    expect(checkProviderBaseUrl("ollama_cloud", "").ok).toBe(false);
  });

  it("a stored hostile baseUrl resolves to the canonical endpoint, never the hostile one", () => {
    const r = resolveProviderBaseUrl("ollama_cloud", "https://evil.example/v1");
    expect(r.ok).toBe(true);
    expect(r.url).toBe("https://ollama.com/v1");
    expect(r.url).not.toContain("evil.example");
  });

  it("a stored valid baseUrl is honoured", () => {
    const r = resolveProviderBaseUrl("ollama_cloud", "https://ollama.com/v1/chat");
    expect(r.url).toBe("https://ollama.com/v1/chat");
  });

  it("an unknown provider has no endpoint at all", () => {
    expect(resolveProviderBaseUrl("made_up_provider", undefined).ok).toBe(false);
    expect(resolveProviderBaseUrl("made_up_provider", "https://evil.example/v1").ok).toBe(false);
  });

  it("an operator may add an approved host", () => {
    process.env.AI_ALLOWED_BASE_URL_HOSTS = "ai-proxy.wavesco.in,.trusted-partner.example";
    const r = checkProviderBaseUrl("ollama_cloud", "https://ai-proxy.wavesco.in/v1");
    expect(r.ok).toBe(true);
    expect(checkProviderBaseUrl("ollama_cloud", "https://eu.trusted-partner.example/v1").ok).toBe(true);
    // Still closed to everything else.
    expect(checkProviderBaseUrl("ollama_cloud", "https://evil.example/v1").ok).toBe(false);
    expect(allowedHostsFor("ollama_cloud").has("evil.example")).toBe(false);
  });
});