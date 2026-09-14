/**
 * Cloudflare Tunnel migration — regression tests.
 *
 * Production Lead Engine must be reached at the stable Cloudflare hostname
 * (engine.wavesco.in), never ngrok. Auth (Bearer) is preserved, an empty
 * base URL must never degenerate into a relative fetch, and the engine's
 * response contract + auth gate are verified live when a token is present.
 */
import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("node:sqlite", () => ({
  DatabaseSync: class MockSync {
    prepare() {
      return { get: () => ({ c: 0 }), all: () => [] };
    }
    exec() {
      // mock: no-op
    }
    close() {
      // mock: no-op
    }
  },
}));

import {
  EngineUnavailableError,
  leadEngineMode,
  listLeads,
} from "@/lib/wavesco/lead-engine";

const STABLE_HOST = "https://engine.wavesco.in";

const OLD_ENV = { ...process.env };
afterEach(() => {
  process.env = { ...OLD_ENV };
  vi.unstubAllGlobals();
});

function remoteEnv(url: string) {
  process.env.LEAD_ENGINE_MODE = "remote";
  process.env.LEAD_ENGINE_API_URL = url;
  process.env.LEAD_ENGINE_API_TOKEN = "test-token";
}

describe("stable production hostname", () => {
  it("calls the configured stable host with Bearer auth and no tunnel headers", async () => {
    remoteEnv(STABLE_HOST);
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ ok: true, rows: [], total: 0, page: 1, pageSize: 25 }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    await listLeads({ page: 1, pageSize: 25 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit & { headers: Record<string, string> },
    ];
    expect(url.startsWith(STABLE_HOST)).toBe(true);
    expect(url).not.toContain("ngrok");
    expect(url).not.toContain("trycloudflare");
    expect(init.headers.authorization).toBe("Bearer test-token");
    expect(Object.keys(init.headers).join(",")).not.toMatch(/ngrok/i);
  });

  it("never fetches relative URLs when the base URL is empty", async () => {
    remoteEnv("");
    const fetchMock = vi.fn(() => Promise.resolve(new Response("{}", { status: 200 })));
    vi.stubGlobal("fetch", fetchMock);
    await expect(listLeads({ page: 1 })).rejects.toBeInstanceOf(EngineUnavailableError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("mode selector honors LEAD_ENGINE_MODE", () => {
    process.env.LEAD_ENGINE_MODE = "remote";
    expect(leadEngineMode()).toBe("remote");
    process.env.LEAD_ENGINE_MODE = "local";
    expect(leadEngineMode()).toBe("local");
  });
});

describe.runIf(!!process.env.ENGINE_API_TOKEN)("live engine contract (needs ENGINE_API_TOKEN)", () => {
  const base = "http://127.0.0.1:8787";
  const auth = () => ({ authorization: `Bearer ${process.env.ENGINE_API_TOKEN}` });

  it("rejects unauthenticated requests", async () => {
    const res = await fetch(`${base}/health`, { cache: "no-store" });
    expect(res.status).toBe(401);
  });

  it("serves health / stats / leads contract", async () => {
    const health = (await (await fetch(`${base}/health`, { headers: auth() })).json()) as Record<string, unknown>;
    expect(health.ok).toBe(true);
    const stats = (await (await fetch(`${base}/stats`, { headers: auth() })).json()) as {
      stats: { total: number; byTier: Record<string, number> };
    };
    expect(typeof stats.stats.total).toBe("number");
    const leads = (await (
      await fetch(`${base}/leads?page=1&pageSize=5`, { headers: auth() })
    ).json()) as { rows: unknown[]; total: number; page: number; pageSize: number };
    expect(Array.isArray(leads.rows)).toBe(true);
    expect(typeof leads.total).toBe("number");
  });
});
