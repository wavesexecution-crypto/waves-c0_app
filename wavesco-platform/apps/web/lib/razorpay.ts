import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Razorpay server integration — SERVER-ONLY.
 *
 * This module is imported exclusively by API routes and never by client
 * components. It reads the key secret and webhook secret from the server
 * environment (Vercel Secret-typed vars / local .env.local) and NEVER leaks
 * them: only `razorpayKeyId()` (the public key) is ever returned to the
 * browser, and only inside the orders API response.
 *
 * Secrets expected in the environment:
 *   RAZORPAY_KEY_ID       — public key id (safe to expose)
 *   RAZORPAY_KEY_SECRET   — private secret (server-only)
 *   RAZORPAY_WEBHOOK_SECRET — secret for webhook signature verification
 */

const RAZORPAY_API = "https://api.razorpay.com/v1";

// --- environment gating -----------------------------------------------------

export function razorpayKeyId(): string | null {
  const v = process.env.RAZORPAY_KEY_ID;
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

export function razorpayKeySecret(): string | null {
  const v = process.env.RAZORPAY_KEY_SECRET;
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

export function razorpayWebhookSecret(): string | null {
  const v = process.env.RAZORPAY_WEBHOOK_SECRET;
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

export function isRazorpayConfigured(): boolean {
  return Boolean(razorpayKeyId() && razorpayKeySecret());
}

export function isWebhookConfigured(): boolean {
  return Boolean(razorpayWebhookSecret());
}

export function razorpayAuthHeader(): string {
  const keyId = razorpayKeyId();
  const secret = razorpayKeySecret();
  if (!keyId || !secret) throw new Error("RAZORPAY_KEY_ID/RAZORPAY_KEY_SECRET missing");
  return `Basic ${Buffer.from(`${keyId}:${secret}`).toString("base64")}`;
}

// --- signatures -------------------------------------------------------------

function safeEqualHex(a: string, b: string): boolean {
  const ba = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/**
 * Constant-time HMAC-SHA256 verification. Used for both the client-callback
 * scheme (`payload` = `${orderId}|${paymentId}`, secret = key secret) and the
 * webhook scheme (`payload` = raw request body, secret = webhook secret).
 */
export function verifyRazorpaySignature(
  payload: string | Buffer,
  signature: string | null | undefined,
  secret: string | null | undefined,
): boolean {
  if (!secret || !signature) return false;
  const expected = createHmac("sha256", secret).update(payload).digest("hex");
  return safeEqualHex(expected, signature);
}

/** Client-callback verification: HMAC(orderId|paymentId, key secret). */
export function verifyClientSignature(
  orderId: string,
  paymentId: string,
  signature: string,
): boolean {
  return verifyRazorpaySignature(`${orderId}|${paymentId}`, signature, razorpayKeySecret());
}

/** Webhook verification: HMAC(raw body, webhook secret). */
export function verifyWebhookSignature(rawBody: string | Buffer, signature: string): boolean {
  return verifyRazorpaySignature(rawBody, signature, razorpayWebhookSecret());
}

// --- Razorpay REST (server-side) --------------------------------------------

export interface RazorpayOrder {
  id: string;
  amount: number;
  amount_paid: number;
  amount_due: number;
  currency: string;
  receipt: string | null;
  status: string;
  attempts: number;
  notes: Record<string, unknown>;
  created_at: number;
}

export interface RazorpayPayment {
  id: string;
  order_id: string | null;
  status: string;
  amount: number;
  currency: string;
  captured: boolean;
  description: string | null;
  email: string | null;
  contact: string | null;
  method: string | null;
  error_description: string | null;
  created_at: number;
}

interface RazorpayErrorBody {
  error?: { code?: string; description?: string; source?: string; step?: string; reason?: string };
}

class RazorpayApiError extends Error {
  status: number;
  code?: string;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function razorpayFetch(path: string, init?: RequestInit): Promise<Record<string, unknown>> {
  const res = await fetch(`${RAZORPAY_API}${path}`, {
    ...init,
    headers: {
      Authorization: razorpayAuthHeader(),
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    json = {};
  }
  if (!res.ok) {
    const errBody = json as RazorpayErrorBody;
    const message =
      errBody?.error?.description ?? errBody?.error?.reason ?? `Razorpay ${res.status}: ${text.slice(0, 200)}`;
    throw new RazorpayApiError(res.status, message, errBody?.error?.code);
  }
  return json;
}

export async function createRazorpayOrder(input: {
  amountPaise: number;
  currency?: string;
  receipt?: string;
  notes?: Record<string, string>;
}): Promise<RazorpayOrder> {
  if (!Number.isInteger(input.amountPaise) || input.amountPaise <= 0) {
    throw new Error("amountPaise must be a positive integer");
  }
  const json = await razorpayFetch("/orders", {
    method: "POST",
    body: JSON.stringify({
      amount: input.amountPaise,
      currency: input.currency ?? "INR",
      receipt: input.receipt,
      notes: input.notes ?? {},
    }),
  });
  return json as unknown as RazorpayOrder;
}

export async function fetchRazorpayPayment(paymentId: string): Promise<RazorpayPayment> {
  if (!/^pay_/.test(paymentId)) {
    throw new RazorpayApiError(400, "Invalid payment id");
  }
  const json = await razorpayFetch(`/payments/${paymentId}`);
  return json as unknown as RazorpayPayment;
}