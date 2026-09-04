/**
 * Unsubscribe tokens + recipient suppression (launch-critical).
 *
 * TOKENS
 * A recipient-facing unsubscribe link carries an HMAC-SHA256 signed token:
 *   v1.<b64url(payload)>.<b64url(sig)>
 * payload = JSON { t: tenantId, e: email, iat: epochSeconds }
 * Timing-safe verified. Tokens do not expire — an unsubscribe link must keep
 * working for the life of the recipient record.
 *
 * SECRET
 * UNSUBSCRIBE_SECRET (or legacy UNRESUBSCRIBE_SECRET). No default secret is
 * ever invented — unconfigured means the system is disabled: fail closed,
 * never fake success.
 *
 * SUPPRESSION
 * Persisted on OutreachOrder (no schema change): replyStatus =
 * "unsubscribed" for every order of that recipient; non-terminal orders are
 * CANCELLED. Generation, queueing and approval check isRecipientSuppressed()
 * so future sends are blocked.
 */

import crypto from "crypto";

const SUPPRESSED_REPLY_STATUS = "unsubscribed";

export interface UnsubscribeClaims {
  t: string;
  e: string;
  iat: number;
}

/** Wire-format claim names (short for compact links). */
interface TokenPayload {
  t: string;
  e: string;
  iat: number;
}

export function getUnsubscribeSecret(): string {
  return (
    process.env.UNSUBSCRIBE_SECRET?.trim() ||
    process.env.UNRESUBSCRIBE_SECRET?.trim() ||
    ""
  );
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function b64url(buf: Buffer): string {
  return buf.toString("base64url");
}

function sign(payloadB64: string, secret: string): string {
  return b64url(crypto.createHmac("sha256", secret).update(payloadB64).digest());
}

/** Issue an unsubscribe token for a recipient. Returns null when unconfigured. */
export function generateUnsubscribeToken(
  tenantId: string,
  email: string,
): string | null {
  const secret = getUnsubscribeSecret();
  if (!secret || !tenantId || !email) return null;
  const payload = JSON.stringify({
    t: tenantId,
    e: normalizeEmail(email),
    iat: Math.floor(Date.now() / 1000),
  } satisfies TokenPayload);
  const payloadB64 = b64url(Buffer.from(payload, "utf8"));
  return `v1.${payloadB64}.${sign(payloadB64, secret)}`;
}

/** Verify + parse a token. Returns null for any invalid/tampered token. */
export function verifyUnsubscribeToken(
  token: string | null | undefined,
): UnsubscribeClaims | null {
  const secret = getUnsubscribeSecret();
  if (!secret || !token) return null;
  const parts = token.trim().split(".");
  if (parts.length !== 3 || parts[0] !== "v1") return null;
  const [, payloadB64, sigB64] = parts;
  if (!payloadB64 || !sigB64) return null;
  const expected = Buffer.from(sign(payloadB64, secret), "base64url");
  let provided: Buffer;
  try {
    provided = Buffer.from(sigB64, "base64url");
  } catch {
    return null;
  }
  if (provided.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(provided, expected)) return null;
  try {
    const claims = JSON.parse(
      Buffer.from(payloadB64, "base64url").toString("utf8"),
    ) as Partial<TokenPayload>;
    if (
      typeof claims.t !== "string" ||
      !claims.t ||
      typeof claims.e !== "string" ||
      !claims.e.includes("@")
    ) {
      return null;
    }
    return {
      t: claims.t,
      e: claims.e,
      iat: typeof claims.iat === "number" ? claims.iat : 0,
    };
  } catch {
    return null;
  }
}

/** Build the client-facing unsubscribe URL for an outbound email footer. */
export function buildUnsubscribeUrl(
  tenantId: string,
  email: string,
): string | null {
  const token = generateUnsubscribeToken(tenantId, email);
  if (!token) return null;
  const base = (
    process.env.NEXT_PUBLIC_APP_URL ??
    process.env.NEXTAUTH_URL ??
    "https://app.wavesco.in"
  ).replace(/\/+$/, "");
  return `${base}/api/unsubscribe?token=${encodeURIComponent(token)}`;
}

/** Append the mandatory unsubscribe footer to an outbound email body. */
export function appendUnsubscribeFooter(
  body: string,
  businessName: string,
  unsubscribeUrl: string | null,
): string {
  if (!unsubscribeUrl) return body;
  const footer = [
    "",
    "",
    "—",
    `You received this one-to-one email because we believe Waves can help ${businessName} grow. Not relevant? No hard feelings:`,
    `Unsubscribe: ${unsubscribeUrl}`,
  ].join("\n");
  return body + footer;
}

// ─── Suppression (persisted, tenant-scoped) ─────────────────────────────

/**
 * Minimal structural view of the Prisma transaction client used by the
 * suppression helpers. Parameter positions are `any` because concrete Prisma
 * overload signatures are neither co- nor contra-variant enough for a
 * structural match; runtime behavior is fully type-checked by Prisma itself.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
type Tx = {
  outreachOrder: {
    findFirst: (args: any) => Promise<{ id: string } | null>;
    updateMany: (args: any) => Promise<{ count: number }>;
  };
  activityEvent: { create: (args: any) => Promise<unknown> };
};
/* eslint-enable @typescript-eslint/no-explicit-any */

/** True when the recipient has previously unsubscribed in this tenant. */
export async function isRecipientSuppressed(
  tx: Tx,
  tenantId: string,
  email: string,
): Promise<boolean> {
  const hit = await tx.outreachOrder.findFirst({
    where: {
      tenantId,
      email: { equals: normalizeEmail(email), mode: "insensitive" },
      replyStatus: SUPPRESSED_REPLY_STATUS,
    },
    select: { id: true },
  });
  return hit !== null;
}

/**
 * Persistently suppress a recipient: mark every order's replyStatus and
 * cancel all non-terminal orders so nothing further can be sent. Idempotent.
 * Returns truthful counts of what actually changed.
 */
export async function suppressRecipient(
  tx: Tx,
  tenantId: string,
  email: string,
  source: string,
): Promise<{ alreadySuppressed: boolean; marked: number; cancelled: number }> {
  const normalized = normalizeEmail(email);
  const existing = await tx.outreachOrder.findFirst({
    where: {
      tenantId,
      email: { equals: normalized, mode: "insensitive" },
      replyStatus: SUPPRESSED_REPLY_STATUS,
    },
    select: { id: true },
  });

  const marked = await tx.outreachOrder.updateMany({
    where: {
      tenantId,
      email: { equals: normalized, mode: "insensitive" },
      NOT: { replyStatus: SUPPRESSED_REPLY_STATUS },
    },
    data: { replyStatus: SUPPRESSED_REPLY_STATUS },
  });

  const cancelled = await tx.outreachOrder.updateMany({
    where: {
      tenantId,
      email: { equals: normalized, mode: "insensitive" },
      status: { in: ["READY_FOR_APPROVAL", "PENDING", "APPROVED"] },
    },
    data: {
      status: "CANCELLED",
      decidedAt: new Date(),
      sendError: "Recipient unsubscribed",
    },
  });

  if (marked.count > 0 || cancelled.count > 0 || !existing) {
    await tx.activityEvent.create({
      data: {
        tenantId,
        type: "recipient_unsubscribed",
        title: `Recipient unsubscribed: ${normalized}`,
        entityType: "outreach_order",
        entityId: null,
        href: "/acquisition/pipeline",
        metadata: { source, marked: marked.count, cancelled: cancelled.count },
      },
    });
  }

  return {
    alreadySuppressed: existing !== null,
    marked: marked.count,
    cancelled: cancelled.count,
  };
}

