import { timingSafeEqual } from "node:crypto";

/**
 * Operator-only gate for actions that grant commercial access without a
 * verified payment (off-band/manual grants).
 *
 * Why this exists: the tenant's own `owner` role is NOT an operator. Before
 * this gate, any tenant owner could POST their own workspace id with an
 * arbitrary duration and be granted paid access for nothing — the single
 * largest revenue hole in the billing surface. `role: "owner"` only means
 * "owner of my workspace"; it must never mean "allowed to mint entitlement".
 *
 * Payment-originated activation does NOT use this gate: it goes through
 * `activatePaid` from the Razorpay verify/webhook paths, which re-check the
 * captured amount against `LEASE_PRICES`.
 */

/** Returns true when `ACQUISITION_GRANT_KEY` is configured and matches. */
export function isOperatorRequest(provided: string | null | undefined): boolean {
  return secretMatches(provided, process.env.ACQUISITION_GRANT_KEY);
}

export const OPERATOR_KEY_HEADER = "x-acquisition-grant-key";

/** Reason to show when the gate denies, without leaking whether the key exists. */
export const OPERATOR_DENIED_REASON =
  "Recording access off-band is an operator action. Renew or extend through Billing instead.";

/**
 * Generic constant-time shared-secret check for server-to-server routes
 * (internal reconcile, ingest, cron). Fails closed when the expected secret is
 * unset, and requires equal length before comparing so `timingSafeEqual` cannot
 * throw on a length mismatch.
 */
export function secretMatches(provided: string | null | undefined, expected: string | null | undefined): boolean {
  const want = expected?.trim() ?? "";
  const got = provided?.trim() ?? "";
  if (want.length === 0 || got.length === 0) return false;
  const a = Buffer.from(got, "utf8");
  const b = Buffer.from(want, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
