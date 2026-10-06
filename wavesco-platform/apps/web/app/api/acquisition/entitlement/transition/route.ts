import { NextResponse } from "next/server";
import { requireControlAuth, sessionRole } from "@/lib/wavesco/control";
import { hasAccess, transitionEntitlement } from "@/lib/wavesco/entitlements";
import { isValidLeaseType, leaseInfo } from "@/lib/wavesco/pricing";
import {
  OPERATOR_DENIED_REASON,
  OPERATOR_KEY_HEADER,
  isOperatorRequest,
} from "@/lib/wavesco/operator-gate";

export const dynamic = "force-dynamic";

const VALID = ["suspend", "resume", "cancel", "refund", "renew"] as const;

/** Actions that only an operator may perform. */
const OPERATOR_ONLY: ReadonlySet<string> = new Set(["renew", "refund"]);

/**
 * POST /api/acquisition/entitlement/transition — suspend/resume/cancel/refund/renew.
 *
 * SECURITY: `renew` and `refund` are commercial decisions, so they are
 * operator-only. Previously any workspace owner could call
 * `{action:"renew", expiresAt:"2999-01-01"}` and receive ~973 years of paid
 * access for nothing, or loop `renew` with an arbitrary `days`.
 *
 * PRICING: the renewal duration is derived SERVER-SIDE from the locked table.
 * The caller may only choose a `leaseType`; a `days`/`expiresAt` in the body is
 * ignored rather than trusted.
 *
 * Deliberately NOT entitlement-gated: resume/renew/cancel must work from
 * expired/suspended states. Invalid transitions return 400 with the exact
 * reason (never silent).
 */
export async function POST(req: Request) {
  let tenantId: string;
  let userId: string | null | undefined;
  let role: string;
  try {
    const auth = await requireControlAuth();
    tenantId = auth.tenantId;
    userId = auth.userId;
    role = sessionRole(auth.session);
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (role !== "owner") {
    return NextResponse.json(
      { error: "forbidden", reason: "Owner role required to change access state." },
      { status: 403 },
    );
  }
  let body: Record<string, unknown> = {};
  try {
    const raw = await req.text();
    if (raw) body = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const action = typeof body.action === "string" ? body.action.trim() : "";
  if (!(VALID as readonly string[]).includes(action)) {
    return NextResponse.json({ error: "invalid action", valid: VALID, received: action || null }, { status: 400 });
  }

  if (OPERATOR_ONLY.has(action) && !isOperatorRequest(req.headers.get(OPERATOR_KEY_HEADER))) {
    return NextResponse.json(
      {
        error: "forbidden",
        reason: `${action === "renew" ? "Renewing" : "Refunding"} access is an operator action.`,
        whatNext:
          action === "renew"
            ? "Extend your lease from Billing — payment is verified there. Remaining paid time is preserved."
            : OPERATOR_DENIED_REASON,
      },
      { status: 403 },
    );
  }

  // Duration comes from the lock table, never from the request.
  let renewDays: number | undefined;
  if (action === "renew") {
    if (!isValidLeaseType(body.leaseType)) {
      return NextResponse.json(
        {
          error: "invalid_lease_type",
          reason: "leaseType must be one of LEASE_30, LEASE_90, LEASE_180, LEASE_365.",
        },
        { status: 400 },
      );
    }
    renewDays = leaseInfo(body.leaseType).days;
  }

  try {
    const { entitlement } = await transitionEntitlement(
      tenantId,
      action as (typeof VALID)[number],
      {
        reason: typeof body.reason === "string" ? body.reason : undefined,
        ...(renewDays !== undefined ? { days: renewDays } : {}),
      },
      userId,
    );
    return NextResponse.json({ ok: true, entitlement, hasAccess: hasAccess(entitlement.status) }, { status: 200 });
  } catch (e) {
    console.error("[entitlement:transition] failed", e);
    return NextResponse.json(
      { error: "transition_failed", reason: "We could not change your access state." },
      { status: 400 },
    );
  }
}
