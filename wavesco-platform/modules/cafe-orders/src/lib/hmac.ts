import { createHmac, timingSafeEqual } from "node:crypto";

function signatureIsValid(expected: string, received: string): boolean {
  if (expected.length !== received.length) return false;
  return timingSafeEqual(Buffer.from(expected, "utf8"), Buffer.from(received, "utf8"));
}

/**
 * Verifies an HMAC-SHA256 signature over the raw webhook body.
 *
 * Secret selection is per-source (SWIGGY_SECRET / ZOMATO_SECRET); the
 * caller passes the secret for the channel the webhook belongs to.
 */
export function verifyHmacSignature(
  secret: string,
  rawBody: string,
  signatureHeader: string | null,
): boolean {
  if (!signatureHeader) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  return signatureIsValid(expected, signatureHeader.trim().toLowerCase());
}
