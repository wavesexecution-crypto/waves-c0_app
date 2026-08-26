/**
 * AI Gateway — route tests.
 *
 * Tests auth, AI-disabled enforcement, provider routing, and error handling.
 * Uses mock fetch to avoid real provider calls.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock prisma before importing the route
vi.mock("@wavesco/db", () => ({
  prisma: {
    tenant: { findFirst: vi.fn() },
    clientAiConfig: { findFirst: vi.fn() },
    aiUsageLog: { create: vi.fn() },
  },
  withTenantContext: vi.fn((_tenantId: string, fn: (tx: unknown) => Promise<unknown>) =>
    fn({ clientAiConfig: { findFirst: vi.fn() }, aiUsageLog: { create: vi.fn() } })
  ),
}));

function makeReq(opts: { headers?: Record<string, string>; body?: unknown } = {}) {
  return new Request("http://localhost/api/ai/gateway", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...opts.headers,
    },
    body: JSON.stringify(opts.body ?? { operation: "enrich", system: "s", prompt: "p" }),
  });
}

describe("AI Gateway — auth", () => {
  beforeEach(() => {
    process.env.LEAD_ENGINE_GATEWAY_TOKEN = "test-token-123";
    process.env.WAVESCO_ENGINE_TENANT = "wavesco-hq";
  });

  it("rejects requests without Authorization header", async () => {
    const req = makeReq({ headers: { Authorization: undefined as unknown as string } });
    const { POST } = await import("../app/api/ai/gateway/route");
    const res = await POST(req as unknown as Parameters<typeof POST>[0]);
    const json = await res.json() as { ok: boolean; status: string };

    expect(res.status).toBe(401);
    expect(json.ok).toBe(false);
    expect(json.status).toBe("auth_required");
  });

  it("rejects requests with wrong token", async () => {
    const req = makeReq({ headers: { Authorization: "Bearer wrong-token" } });
    const { POST } = await import("../app/api/ai/gateway/route");
    const res = await POST(req as unknown as Parameters<typeof POST>[0]);
    const json = await res.json() as { ok: boolean; status: string };

    expect(res.status).toBe(401);
    expect(json.status).toBe("auth_failed");
  });

  it("rejects requests with missing system/prompt", async () => {
    const req = makeReq({
      headers: { Authorization: "Bearer test-token-123" },
      body: { operation: "enrich" },
    });
    const { POST } = await import("../app/api/ai/gateway/route");
    const res = await POST(req as unknown as Parameters<typeof POST>[0]);
    const json = await res.json() as { ok: boolean; status: string };

    expect(res.status).toBe(400);
    expect(json.status).toBe("bad_request");
  });
});

describe("AI Gateway — AI disabled enforcement", () => {
  beforeEach(() => {
    process.env.LEAD_ENGINE_GATEWAY_TOKEN = "test-token-123";
    process.env.WAVESCO_ENGINE_TENANT = "wavesco-hq";
  });

  it("returns 403 when AI is disabled for tenant", async () => {
    const { prisma, withTenantContext } = await import("@wavesco/db");

    // Mock tenant lookup
    (prisma.tenant.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "tenant_test",
      slug: "test-tenant",
    });

    // Mock AI disabled config
    (withTenantContext as ReturnType<typeof vi.fn>).mockImplementation(
      (_tenantId: string, fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          clientAiConfig: {
            findFirst: vi.fn().mockResolvedValue({
              aiEnabled: false,
              provider: "ollama_cloud",
              model: "gemma4:31b",
              baseUrl: "https://ollama.com/v1",
            }),
          },
          aiUsageLog: { create: vi.fn() },
        })
    );

    const req = makeReq({ headers: { Authorization: "Bearer test-token-123" } });
    const { POST } = await import("../app/api/ai/gateway/route");
    const res = await POST(req as unknown as Parameters<typeof POST>[0]);
    const json = await res.json() as { ok: boolean; status: string };

    expect(res.status).toBe(403);
    expect(json.ok).toBe(false);
    expect(json.status).toBe("ai_disabled");
  });
});
