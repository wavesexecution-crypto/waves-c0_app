import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/**
 * Unsubscribe tokens + recipient suppression — unit tests.
 *
 * The unsubscribe path is launch-critical: tokens must be tamper-evident,
 * fail closed when unconfigured, and suppression must be persistent,
 * idempotent, and tenant-scoped.
 */

const SECRET = "test-secret-key-123";

let originalEnv: { UNSUBSCRIBE_SECRET?: string; UNRESUBSCRIBE_SECRET?: string };

beforeEach(() => {
  originalEnv = {
    UNSUBSCRIBE_SECRET: process.env.UNSUBSCRIBE_SECRET,
    UNRESUBSCRIBE_SECRET: process.env.UNRESUBSCRIBE_SECRET,
  };
  process.env.UNSUBSCRIBE_SECRET = SECRET;
  delete process.env.UNRESUBSCRIBE_SECRET;
});

afterEach(() => {
  if (originalEnv.UNSUBSCRIBE_SECRET === undefined) delete process.env.UNSUBSCRIBE_SECRET;
  else process.env.UNSUBSCRIBE_SECRET = originalEnv.UNSUBSCRIBE_SECRET;
  if (originalEnv.UNRESUBSCRIBE_SECRET === undefined) delete process.env.UNRESUBSCRIBE_SECRET;
  else process.env.UNRESUBSCRIBE_SECRET = originalEnv.UNRESUBSCRIBE_SECRET;
  vi.restoreAllMocks();
});

import {
  appendUnsubscribeFooter,
  buildUnsubscribeUrl,
  generateUnsubscribeToken,
  isRecipientSuppressed,
  normalizeEmail,
  suppressRecipient,
  verifyUnsubscribeToken,
} from "@/lib/wavesco/unsubscribe";

describe("unsubscribe tokens", () => {
  it("round-trips a valid token", () => {
    const token = generateUnsubscribeToken("tenant_1", "Owner@Bakery.com ");
    expect(token).not.toBeNull();
    const claims = verifyUnsubscribeToken(token!);
    expect(claims).not.toBeNull();
    expect(claims!.t).toBe("tenant_1");
    expect(claims!.e).toBe("owner@bakery.com");
    expect(claims!.iat).toBeGreaterThan(0);
  });

  it("normalizes email case/whitespace", () => {
    expect(normalizeEmail("  A@B.CoM ")).toBe("a@b.com");
  });

  it("rejects tampered payloads", () => {
    const token = generateUnsubscribeToken("tenant_1", "a@b.com")!;
    const parts = token.split(".");
    const forged = Buffer.from(
      JSON.stringify({ t: "tenant_EVIL", e: "x@y.com", iat: 1 }),
    ).toString("base64url");
    expect(verifyUnsubscribeToken(`v1.${forged}.${parts[2]}`)).toBeNull();
  });

  it("rejects tokens signed with a different secret", () => {
    const token = generateUnsubscribeToken("tenant_1", "a@b.com")!;
    process.env.UNSUBSCRIBE_SECRET = "another-secret";
    expect(verifyUnsubscribeToken(token)).toBeNull();
  });

  it("rejects malformed tokens and fails closed without a secret", () => {
    expect(verifyUnsubscribeToken("garbage")).toBeNull();
    expect(verifyUnsubscribeToken("v1.abc.def")).toBeNull();
    delete process.env.UNSUBSCRIBE_SECRET;
    expect(generateUnsubscribeToken("t", "a@b.com")).toBeNull();
    expect(verifyUnsubscribeToken("v1.abc.def")).toBeNull();
    expect(buildUnsubscribeUrl("t", "a@b.com")).toBeNull();
  });

  it("builds a URL containing the token", () => {
    const url = buildUnsubscribeUrl("tenant_1", "a@b.com");
    expect(url).toContain("/api/unsubscribe?token=");
  });

  it("appends the footer only when a URL exists", () => {
    const withFooter = appendUnsubscribeFooter("Hello", "Bakery", "https://x/unsub");
    expect(withFooter).toContain("Unsubscribe: https://x/unsub");
    expect(appendUnsubscribeFooter("Hello", "Bakery", null)).toBe("Hello");
  });
});

function makeTx(existing: boolean) {
  return {
    outreachOrder: {
      findFirst: vi.fn(async () => (existing ? { id: "o1" } : null)),
      updateMany: vi.fn(async () => ({ count: 2 })),
    },
    activityEvent: { create: vi.fn(async () => ({})) },
  };
}

describe("recipient suppression", () => {
  it("marks + cancels with truthful counts (first time)", async () => {
    const tx = makeTx(false);
    const r = await suppressRecipient(tx as never, "t1", "A@B.com", "test");
    expect(r.alreadySuppressed).toBe(false);
    expect(r.marked).toBe(2);
    expect(r.cancelled).toBe(2);
    expect(tx.outreachOrder.updateMany).toHaveBeenCalledTimes(2);
    expect(tx.activityEvent.create).toHaveBeenCalledTimes(1);
    const markWhere = (
      (tx.outreachOrder.updateMany as ReturnType<typeof vi.fn>).mock
        .calls[0]?.[0] as { where: { tenantId: string } } | undefined
    )?.where;
    expect(markWhere?.tenantId).toBe("t1"); // tenant-scoped
  });

  it("is idempotent (already suppressed)", async () => {
    const tx = makeTx(true);
    const r = await suppressRecipient(tx as never, "t1", "a@b.com", "test");
    expect(r.alreadySuppressed).toBe(true);
  });

  it("isRecipientSuppressed detects suppression", async () => {
    const tx = makeTx(true);
    expect(await isRecipientSuppressed(tx as never, "t1", "a@b.com")).toBe(true);
    const tx2 = makeTx(false);
    expect(await isRecipientSuppressed(tx2 as never, "t1", "a@b.com")).toBe(false);
  });
});
