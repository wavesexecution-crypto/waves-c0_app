"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@wavesco/auth";
import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import {
  activatePaid,
  startTrial,
  transitionEntitlement,
} from "@/lib/wavesco/entitlements";
import { isValidLeaseType, leaseInfo } from "@/lib/wavesco/pricing";
import {
  OPERATOR_DENIED_REASON,
  OPERATOR_KEY_HEADER,
  isOperatorRequest,
} from "@/lib/wavesco/operator-gate";
import { headers } from "next/headers";

async function requireUser(): Promise<{ tenantId: string; userId: string; role: string }> {
  const session = await auth();
  const user = requireSession(session);
  return { tenantId: user.tenantId, userId: user.id, role: user.role };
}

export interface EntitlementActionState {
  ok: boolean;
  error?: string;
  message?: string;
  status?: string;
}

function refresh() {
  revalidatePath("/products");
  revalidatePath("/billing");
  revalidatePath("/acquisition");
  revalidatePath("/acquisition/profile");
}

/** Server actions cannot read request headers synchronously in every runtime,
 *  so the operator key is read defensively. */
async function operatorKeyPresent(): Promise<boolean> {
  try {
    const h = await headers();
    return isOperatorRequest(h.get(OPERATOR_KEY_HEADER));
  } catch {
    return false;
  }
}

/** Self-serve trial start (admin+). Idempotent — already-trialed tenants get a clear 409-style message. */
export async function startTrialAction(): Promise<EntitlementActionState> {
  const user = await requireUser();
  if (!can({ role: user.role }, "create", "acquisition")) {
    return { ok: false, error: "Admin role required to start a trial." };
  }
  try {
    const { entitlement } = await startTrial(user.tenantId, user.userId);
    refresh();
    return {
      ok: true,
      status: entitlement.status,
      message: `Trial started — access until ${entitlement.trialExpiresAt ? new Date(entitlement.trialExpiresAt).toLocaleDateString() : "expiry"}. Complete your Company Profile next.`,
    };
  } catch (e) {
    console.error("[entitlement:startTrial] failed", e);
    return { ok: false, error: "We could not start the trial. Please try again." };
  }
}

function str(formData: FormData, name: string): string {
  const v = formData.get(name);
  return typeof v === "string" ? v.trim() : "";
}

/**
 * Record a verified off-band grant. OPERATOR ONLY.
 *
 * The workspace `owner` role is not an operator: before this gate, any tenant
 * owner could POST `days=732` and be granted a year of paid access for nothing.
 * Duration and amount are now derived server-side from the locked price table;
 * only `leaseType` selects which one.
 */
export async function activatePaidAction(
  _prev: EntitlementActionState,
  formData: FormData,
): Promise<EntitlementActionState> {
  const user = await requireUser();
  if (!can({ role: user.role }, "admin", "acquisition")) {
    return { ok: false, error: "Owner role required to record paid access." };
  }
  if (!(await operatorKeyPresent())) {
    return { ok: false, error: OPERATOR_DENIED_REASON };
  }
  const leaseType = str(formData, "leaseType");
  if (!isValidLeaseType(leaseType)) {
    return { ok: false, error: "Select a lease duration." };
  }
  const lease = leaseInfo(leaseType);
  try {
    const { entitlement } = await activatePaid(
      user.tenantId,
      {
        provider: str(formData, "provider") || "manual",
        providerRef: str(formData, "providerRef") || undefined,
        idempotencyKey: str(formData, "idempotencyKey") || undefined,
        // Server-derived; the body's days/expiresAt/amount are ignored.
        days: lease.days,
        amountPaise: lease.paise,
        currency: "INR",
        note: str(formData, "note") || undefined,
      },
      user.userId,
    );
    refresh();
    return {
      ok: true,
      status: entitlement.status,
      message: `Paid access active until ${entitlement.expiresAt ? new Date(entitlement.expiresAt).toLocaleDateString() : "expiry"}.`,
    };
  } catch (e) {
    console.error("[entitlement:activatePaid] operator grant failed", e);
    return { ok: false, error: "We could not record this access grant." };
  }
}

/**
 * Lifecycle transitions. `renew` and `refund` are commercial decisions and are
 * therefore OPERATOR ONLY; `suspend`/`resume`/`cancel` remain workspace-owner
 * actions. The renewal duration is derived from the locked price table.
 */
export async function transitionEntitlementAction(
  _prev: EntitlementActionState,
  formData: FormData,
): Promise<EntitlementActionState> {
  const user = await requireUser();
  if (!can({ role: user.role }, "admin", "acquisition")) {
    return { ok: false, error: "Owner role required to change access state." };
  }
  const action = str(formData, "action");
  if (!["suspend", "resume", "cancel", "refund", "renew"].includes(action)) {
    return { ok: false, error: "Unknown transition." };
  }
  if ((action === "renew" || action === "refund") && !(await operatorKeyPresent())) {
    return {
      ok: false,
      error:
        action === "renew"
          ? "Extending a lease happens in Billing, where payment is verified."
          : OPERATOR_DENIED_REASON,
    };
  }

  let days: number | undefined;
  if (action === "renew") {
    const leaseType = str(formData, "leaseType");
    if (!isValidLeaseType(leaseType)) {
      return { ok: false, error: "Select a lease duration." };
    }
    days = leaseInfo(leaseType).days;
  }

  try {
    const { entitlement } = await transitionEntitlement(
      user.tenantId,
      action as "suspend" | "resume" | "cancel" | "refund" | "renew",
      {
        reason: str(formData, "reason") || undefined,
        ...(days !== undefined ? { days } : {}),
      },
      user.userId,
    );
    refresh();
    return { ok: true, status: entitlement.status, message: `Access is now ${entitlement.status}.` };
  } catch (e) {
    console.error("[entitlement:transition] failed", e);
    return { ok: false, error: "We could not change your access state." };
  }
}
