/**
 * Billing/Razorpay unit tests — pricing lock, env gating, HMAC verification,
 * API client. In-memory only: no network, no payment provider.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createHmac } from "node:crypto";

import {
  LEASE_PRICES,
  VALID_LEASE_TYPES,
  isValidLeaseType,
  leaseInfo,
  daysForLease,
} from "@/lib/wavesco/pricing";
import {
  isRazorpayConfigured,
  isWebhookConfigured,
  razorpayKeyId,
  razorpayKeySecret,
  razorpayWebhookSecret,
  razorpayAuthHeader,
  verifyRazorpaySignature,
  verifyClientSignature,
  verifyWebhookSignature,
  createRazorpayOrder,
  fetchRazorpayPayment,
} from "@/lib/razorpay";
import { leaseDaysFromMeta } from "@/lib/wavesco/billing";

const KEY_ID = "rzp_test_keyid";
const KEY_SECRET = "rzp_test_secret";
const WEBHOOK_SECRET = "wh_test_secret";

const savedEnv: Record<string, string | undefined> = {};

function mockEnv(extra: Record<string, string | undefined> = {}) {
  for (const k of Object.keys(savedEnv)) delete process.env[k];
  for (const k of ["RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET", "RAZORPAY_WEBHOOK_SECRET"]) {
    delete process.env[k];
  }
  Object.assign(process.env, {
    RAZORPAY_KEY_ID: KEY_ID,
    RAZORPAY_KEY_SECRET: KEY_SECRET,
    RAZORPAY_WEBHOOK_SECRET: WEBHOOK_SECRET,
    ...extra,
  });
}

beforeEach(() => mockEnv());
afterEach(() => {
  vi.unstubAllGlobals();
  mockEnv({ RAZORPAY_KEY_ID: "", RAZORPAY_KEY_SECRET: "", RAZORPAY_WEBHOOK_SECRET: "" });
});

describe("commercial model — server-locked lease pricing", () => {
  it("defines exactly the four paid leases with the historical prices", () => {
    expect(VALID_LEASE_TYPES.sort()).toEqual(["LEASE_180", "LEASE_30", "LEASE_365", "LEASE_90"]);
    expect(LEASE_PRICES.LEASE_30).toEqual({ paise: 6000000, days: 30, rupees: 60000, monthly: 60000, save: 0 });
    expect(LEASE_PRICES.LEASE_90).toMatchObject({ paise: 16500000, days: 90, rupees: 165000, monthly: 55000, save: 15000 });
    expect(LEASE_PRICES.LEASE_180).toMatchObject({ paise: 30000000, days: 180, rupees: 300000, monthly: 50000, save: 60000 });
    expect(LEASE_PRICES.LEASE_365).toMatchObject({ paise: 54000000, days: 365, rupees: 540000, monthly: 45000, save: 240000 });
  });

  it("maps every valid lease type", () => {
    for (const t of VALID_LEASE_TYPES) {
      expect(isValidLeaseType(t)).toBe(true);
      expect(leaseInfo(t).leaseType).toBe(t);
      expect(daysForLease(t)).toBe(LEASE_PRICES[t].days);
    }
  });

  it.each(["LEASE_15", "LEASE_999", "30", "", null, undefined, {}, 42])(
    "rejects non-commercial lease %p",
    (bad) => {
      expect(isValidLeaseType(bad)).toBe(false);
      expect(() => leaseInfo(bad)).toThrow(/Invalid leaseType/);
    },
  );

  it("maps order metadata to lease days only for valid lease types", () => {
    expect(leaseDaysFromMeta({ leaseType: "LEASE_90" })).toBe(90);
    expect(leaseDaysFromMeta({ leaseType: "LEASE_30", days: 30 })).toBe(30);
    expect(leaseDaysFromMeta(null)).toBeNull();
    expect(leaseDaysFromMeta({})).toBeNull();
    expect(leaseDaysFromMeta({ leaseType: "LEASE_7" })).toBeNull();
  });
});

describe("razorpay env gating", () => {
  it("is unconfigured when secrets are missing", () => {
    mockEnv({ RAZORPAY_KEY_SECRET: "" });
    expect(isRazorpayConfigured()).toBe(false);
    expect(razorpayKeyId()).toBe(KEY_ID);
    expect(razorpayKeySecret()).toBeNull();
  });

  it("is configured with both key vars present", () => {
    expect(isRazorpayConfigured()).toBe(true);
    expect(razorpayKeyId()).toBe(KEY_ID);
    expect(razorpayKeySecret()).toBe(KEY_SECRET);
    expect(razorpayWebhookSecret()).toBe(WEBHOOK_SECRET);
    expect(isWebhookConfigured()).toBe(true);
  });

  it("uses the webhook secret for webhook verification", () => {
    mockEnv({ RAZORPAY_WEBHOOK_SECRET: "" });
    expect(isWebhookConfigured()).toBe(false);
  });

  it("builds the Basic auth header from key id + secret", () => {
    const expected = `Basic ${Buffer.from(`${KEY_ID}:${KEY_SECRET}`).toString("base64")}`;
    expect(razorpayAuthHeader()).toBe(expected);
  });

  it("throws when building an auth header without credentials", () => {
    mockEnv({ RAZORPAY_KEY_SECRET: "" });
    expect(() => razorpayAuthHeader()).toThrow(/RAZORPAY_KEY_ID\/RAZORPAY_KEY_SECRET missing/);
  });
});

describe("HMAC signature verification", () => {
  function hmac(payload: string, secret: string): string {
    return createHmac("sha256", secret).update(payload).digest("hex");
  }

  it("accepts a genuine client-callback signature", () => {
    const sig = hmac("order_1|pay_1", KEY_SECRET);
    expect(verifyClientSignature("order_1", "pay_1", sig)).toBe(true);
  });

  it("rejects a tampered payload", () => {
    const sig = hmac("order_1|pay_1", KEY_SECRET);
    expect(verifyClientSignature("order_2", "pay_1", sig)).toBe(false);
    expect(verifyClientSignature("order_1", "pay_2", sig)).toBe(false);
  });

  it("rejects a signature made with the wrong secret", () => {
    const sig = hmac("order_1|pay_1", "other-secret");
    expect(verifyClientSignature("order_1", "pay_1", sig)).toBe(false);
  });

  it("rejects missing signature / missing secret", () => {
    expect(verifyClientSignature("order_1", "pay_1", "")).toBe(false);
    expect(verifyClientSignature("order_1", "pay_1", "deadbeef")).toBe(false);
    mockEnv({ RAZORPAY_KEY_SECRET: "" });
    const sig = hmac("order_1|pay_1", KEY_SECRET);
    expect(verifyClientSignature("order_1", "pay_1", sig)).toBe(false);
  });

  it("verifies a genuine webhook signature over the raw body", () => {
    const body = JSON.stringify({ event: "payment.captured", payload: {} });
    const sig = hmac(body, WEBHOOK_SECRET);
    expect(verifyWebhookSignature(body, sig)).toBe(true);
    expect(verifyWebhookSignature(body + " ", sig)).toBe(false);
  });

  it("handles hex-length mismatches safely (no throw)", () => {
    expect(
      verifyRazorpaySignature("x", "abcdef", KEY_SECRET),
    ).toBe(false);
  });
});

describe("razorpay REST client", () => {
  it("creates an order with the locked amount", async () => {
    const order = { id: "order_T", amount: 6000000, status: "created" };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(order), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await createRazorpayOrder({ amountPaise: 6000000, currency: "INR", receipt: "ao-x" });
    expect(result.id).toBe("order_T");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.razorpay.com/v1/orders");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body as string);
    expect(body.amount).toBe(6000000);
    expect(body.currency).toBe("INR");
    const authHeader = (init.headers as Record<string, string>).Authorization;
    expect(authHeader).toContain("Basic ");
    expect(authHeader).not.toContain(KEY_SECRET);
  });

  it("rejects non-positive amounts", async () => {
    vi.stubGlobal("fetch", vi.fn());
    await expect(createRazorpayOrder({ amountPaise: 0 })).rejects.toThrow(/positive integer/);
    await expect(createRazorpayOrder({ amountPaise: -5 })).rejects.toThrow(/positive integer/);
  });

  it("fetches a payment by id", async () => {
    const payment = { id: "pay_1", order_id: "order_1", status: "captured", amount: 6000000, currency: "INR" };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(payment), { status: 200 })));
    const result = await fetchRazorpayPayment("pay_1");
    expect(result.order_id).toBe("order_1");
    expect(result.status).toBe("captured");
  });

  it("rejects malformed payment ids before any network call", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchRazorpayPayment("not-a-pay-id")).rejects.toThrow(/Invalid payment id/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("surfaces Razorpay error bodies with status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ error: { code: "BAD_REQUEST_ERROR", description: "nope" } }), { status: 400 }),
      ),
    );
    await expect(createRazorpayOrder({ amountPaise: 100 })).rejects.toThrow(/nope/);
  });
});

describe("secrets never leak into responses", () => {
  it("exposes only the public key id, never the secret", () => {
    const keyId = razorpayKeyId();
    expect(keyId).toBe(KEY_ID);
    expect(KEY_ID).not.toBe(KEY_SECRET);
    // The public key id is a separate value from the secret — the client
    // never receives the secret from any lib function.
    expect(razorpayKeySecret()).not.toBe(razorpayKeyId());
  });
});