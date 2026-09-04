/**
 * Acquisition OS reconciliation.
 *
 * REAL server-side lifecycle processing — never frontend polling:
 *   1. Self-heals orders stuck in APPROVED/pending_reconciliation by
 *      re-reading the authoritative Email Outbox execution record.
 *   2. Syncs reply/bounce telemetry from the engine corpus onto sent orders
 *      (fires NEW_RESPONSES_DETECTED / POSITIVE_RESPONSE_DETECTED).
 *   3. Evaluates due follow-ups against real elapsed time (fires
 *      FOLLOW_UP_READY / FOLLOW_UP_WINDOW_COMPLETED; advances follow-up
 *      state idempotently).
 *
 * Invoked from: the internal reconcile API route (session or internal-key
 * auth, suitable for n8n scheduled triggers) and the pipeline "Sync now"
 * server action. Safe to run repeatedly and concurrently: every downstream
 * step is idempotent (deterministic dedup keys, status-guarded updates).
 */

import {
  processDueFollowUpMilestones,
} from "./notify";
import { reconcileOrderSend, syncOrderReplyStates } from "./pipeline";
import { withTenantContext } from "@wavesco/db";

export interface ReconciliationResult {
  ok: boolean;
  sendsReconciled: number;
  sendsStillPending: number;
  repliesUpdated: number;
  followUpsReady: number;
  followUpsWindowCompleted: number;
  errors: string[];
}

const MAX_STUCK_SENDS = 25;

export async function runAcquisitionReconciliation(
  tenantId: string,
  opts: { skipSends?: boolean } = {},
): Promise<ReconciliationResult> {
  const errors: string[] = [];
  let sendsReconciled = 0;
  let sendsStillPending = 0;

  // 1. Reconcile sends that were approved but never confirmed by the outbox.
  if (!opts.skipSends) {
    try {
      const stuck = await withTenantContext(tenantId, (tx) =>
        tx.outreachOrder.findMany({
          where: {
            tenantId,
            status: "APPROVED",
            deliveryStatus: "pending_reconciliation",
          },
          orderBy: { decidedAt: "asc" },
          take: MAX_STUCK_SENDS,
          select: { id: true },
        }),
      );
      for (const o of stuck) {
        try {
          const r = await reconcileOrderSend(tenantId, o.id);
          if (r.sent) sendsReconciled += 1;
          else sendsStillPending += 1;
        } catch (e) {
          errors.push(
            `send ${o.id}: ${e instanceof Error ? e.message : String(e)}`,
          );
        }
      }
    } catch (e) {
      errors.push(`stuck-send query: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // 2. Reply + bounce telemetry sync (idempotent; also advances follow-ups).
  let repliesUpdated = 0;
  try {
    repliesUpdated = await syncOrderReplyStates(tenantId);
  } catch (e) {
    errors.push(`reply sync: ${e instanceof Error ? e.message : String(e)}`);
  }

  // 3. Explicit time-based follow-up evaluation (idempotent).
  let followUpsReady = 0;
  let followUpsWindowCompleted = 0;
  try {
    const fu = await processDueFollowUpMilestones(tenantId);
    followUpsReady = fu.ready;
    followUpsWindowCompleted = fu.windowsCompleted;
  } catch (e) {
    errors.push(`follow-ups: ${e instanceof Error ? e.message : String(e)}`);
  }

  const result: ReconciliationResult = {
    ok: errors.length === 0,
    sendsReconciled,
    sendsStillPending,
    repliesUpdated,
    followUpsReady,
    followUpsWindowCompleted,
    errors,
  };

  console.log(
    JSON.stringify({
      event: "acquisition.reconciliation",
      tenantId,
      ...result,
    }),
  );

  return result;
}
