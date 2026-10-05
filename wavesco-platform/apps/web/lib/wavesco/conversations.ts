import { withTenantContext } from "@wavesco/db";
import { isPositiveReply } from "./outreach-logic";
import { suppressRecipient } from "./unsubscribe";

/**
 * Inbound conversations — the source of truth for WHO REPLIED / WHAT THEY
 * SAID / WHAT STATE IT IS IN / WHAT HAPPENS NEXT.
 *
 * One thread per (tenant, leadKey). Written by:
 *   - POST /api/acquisition/replies/ingest (mailbox/Brevo/n8n webhooks)
 *   - syncOrderReplyStates (corpus-synced telemetry, deduped by providerMsgId)
 *
 * Side effects per kind (all inside the same tenant transaction):
 *   reply       → order.replyStatus, conversation REPLIED/POSITIVE, follow-ups kept
 *   bounce      → order.deliveryStatus=bounced, pending follow-ups cancelled
 *   unsubscribe → recipient suppressed, live orders CANCELLED, follow-ups cancelled
 *   complaint   → treated as unsubscribe (spam complaints must suppress)
 *   note        → thread annotation only, no state change
 */

export type InboundKind = "reply" | "bounce" | "unsubscribe" | "complaint" | "note";

export interface InboundMessage {
  leadKey?: string | null;
  email?: string | null;
  businessName?: string | null;
  direction?: "IN" | "OUT";
  kind: InboundKind;
  body: string;
  providerMsgId?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface RecordResult {
  ok: boolean;
  deduped?: boolean;
  conversationId?: string;
  messageId?: string;
  status?: string;
  actions?: string[];
  error?: string;
}

type Tx = Parameters<Parameters<typeof withTenantContext>[1]>[0];

const KIND_SET = new Set(["reply", "bounce", "unsubscribe", "complaint", "note"]);

export function validateInbound(input: Record<string, unknown>): { ok: boolean; error?: string; value?: InboundMessage } {
  const kind = typeof input.kind === "string" ? input.kind.trim().toLowerCase() : "";
  if (!KIND_SET.has(kind)) return { ok: false, error: "kind must be reply|bounce|unsubscribe|complaint|note" };
  const body = typeof input.body === "string" ? input.body.trim() : "";
  if (!body) return { ok: false, error: "body is required" };
  if (body.length > 4000) return { ok: false, error: "body must be ≤ 4000 chars" };
  const direction = typeof input.direction === "string" && input.direction.toUpperCase() === "OUT" ? "OUT" : "IN";
  return {
    ok: true,
    value: {
      leadKey: typeof input.leadKey === "string" && input.leadKey.trim() ? input.leadKey.trim().slice(0, 200) : null,
      email: typeof input.email === "string" && input.email.trim() ? input.email.trim().toLowerCase().slice(0, 200) : null,
      businessName: typeof input.businessName === "string" && input.businessName.trim() ? input.businessName.trim().slice(0, 200) : null,
      direction,
      kind: kind as InboundKind,
      body: body.slice(0, 4000),
      providerMsgId: typeof input.providerMsgId === "string" && input.providerMsgId.trim() ? input.providerMsgId.trim().slice(0, 200) : null,
      metadata: input.metadata && typeof input.metadata === "object" ? (input.metadata as Record<string, unknown>) : null,
    },
  };
}

/** Non-empty trimmed string or null (runtime-safe even if a source returns ""). */
function text(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/** Resolve which lead this message belongs to (leadKey direct, else email lookup). */
async function resolveLead(tx: Tx, tenantId: string, msg: InboundMessage): Promise<{ leadKey: string; businessName: string | null; email: string | null } | null> {
  if (msg.leadKey) {
    const research = await tx.leadResearch.findUnique({ where: { tenantId_leadKey: { tenantId, leadKey: msg.leadKey } } });
    if (research) {
      return {
        leadKey: msg.leadKey,
        businessName: text(research.business) ?? text(msg.businessName),
        email: text(research.email) ?? text(msg.email),
      };
    }
    const order = await tx.outreachOrder.findFirst({ where: { tenantId, leadKey: msg.leadKey }, orderBy: { createdAt: "desc" } });
    if (order) {
      return {
        leadKey: msg.leadKey,
        businessName: text(order.businessName) ?? text(msg.businessName),
        email: text(order.email) ?? text(msg.email),
      };
    }
    // Unknown leadKey but an email was supplied: still thread it so nothing is lost.
    if (msg.email) return { leadKey: msg.leadKey, businessName: text(msg.businessName), email: msg.email };
    return null;
  }
  if (msg.email) {
    const order = await tx.outreachOrder.findFirst({
      where: { tenantId, email: { equals: msg.email, mode: "insensitive" } },
      orderBy: { createdAt: "desc" },
    });
    if (order) {
      return {
        leadKey: order.leadKey,
        businessName: text(order.businessName) ?? text(msg.businessName),
        email: text(order.email) ?? text(msg.email),
      };
    }
    const research = await tx.leadResearch.findFirst({ where: { tenantId, email: msg.email } });
    if (research) {
      return {
        leadKey: research.leadKey,
        businessName: text(research.business) ?? text(msg.businessName),
        email: text(research.email) ?? text(msg.email),
      };
    }
  }
  return null;
}

export async function recordInboundMessageTx(
  tx: Tx,
  tenantId: string,
  msg: InboundMessage,
  source: string,
): Promise<RecordResult> {
  // Idempotency: same provider message twice → same result, no duplicates.
  // Scoped to this tenant — an unscoped lookup returns the *other* workspace's
  // conversationId on a colliding id and silently drops this message.
  if (msg.providerMsgId) {
    const dupe = await tx.conversationMessage.findFirst({
      where: { providerMsgId: msg.providerMsgId, tenantId },
    });
    if (dupe) {
      const conv = await tx.conversation.findUnique({ where: { id: dupe.conversationId } });
      return { ok: true, deduped: true, conversationId: dupe.conversationId, messageId: dupe.id, status: conv?.status ?? undefined, actions: [] };
    }
  }

  const lead = await resolveLead(tx, tenantId, msg);
  if (!lead) {
    return { ok: false, error: "Cannot attribute message: supply a known leadKey or a recipient email that matches an order." };
  }

  let conv = await tx.conversation.findUnique({ where: { tenantId_leadKey: { tenantId, leadKey: lead.leadKey } } });
  conv ??= await tx.conversation.create({
    data: {
      tenantId, leadKey: lead.leadKey,
      businessName: lead.businessName, email: lead.email,
      status: "OPEN", lastMessageAt: new Date(),
    },
  });

  const message = await tx.conversationMessage.create({
    data: {
      conversationId: conv.id, tenantId,
      direction: msg.direction ?? "IN", kind: msg.kind,
      body: msg.body, providerMsgId: msg.providerMsgId ?? null,
      metadata: { ...(msg.metadata ?? {}), source } as never,
    },
  });

  const actions: string[] = [`message:${message.id}`];
  let nextStatus = conv.status;

  if (msg.kind === "note") {
    // Annotation only.
  } else if (msg.kind === "bounce") {
    nextStatus = "BOUNCED";
    const orders = await tx.outreachOrder.findMany({ where: { tenantId, leadKey: lead.leadKey, status: { in: ["SENT", "DELIVERED"] } }, select: { id: true } });
    for (const o of orders) {
      await tx.outreachOrder.update({ where: { id: o.id }, data: { deliveryStatus: "bounced" } });
    }
    if (orders.length) {
      await tx.followUp.updateMany({ where: { tenantId, leadKey: lead.leadKey, status: "pending" }, data: { status: "cancelled" } });
      actions.push(`orders_bounced:${orders.length}`, "followups_cancelled");
    }
  } else if (msg.kind === "unsubscribe" || msg.kind === "complaint") {
    nextStatus = "UNSUBSCRIBED";
    if (lead.email) {
      const sup = await suppressRecipient(tx, tenantId, lead.email, `conversation:${conv.id}`);
      actions.push(`suppressed(marked:${sup.marked},cancelled:${sup.cancelled})`);
      await tx.followUp.updateMany({ where: { tenantId, leadKey: lead.leadKey, status: "pending" }, data: { status: "cancelled" } });
      actions.push("followups_cancelled");
    }
  } else {
    // reply
    const positive = isPositiveReply(msg.body);
    nextStatus = positive ? "POSITIVE" : "REPLIED";
    const orders = await tx.outreachOrder.findMany({ where: { tenantId, leadKey: lead.leadKey, status: { in: ["SENT", "DELIVERED"] } }, select: { id: true, replyStatus: true } });
    for (const o of orders) {
      if (o.replyStatus !== msg.body.slice(0, 200)) {
        await tx.outreachOrder.update({ where: { id: o.id }, data: { replyStatus: msg.body.slice(0, 200) } });
        actions.push(`order_reply:${o.id}`);
      }
    }
    if (positive) actions.push("positive_detected");
  }

  await tx.conversation.update({
    where: { id: conv.id },
    data: {
      status: nextStatus, lastMessageAt: new Date(),
      businessName: lead.businessName ?? conv.businessName,
      email: lead.email ?? conv.email,
    },
  });
  await tx.activityEvent.create({
    data: {
      tenantId, type: `conversation_${msg.kind}`,
      title: `${msg.kind === "reply" ? "Reply" : msg.kind} from ${lead.businessName ?? lead.leadKey}`,
      entityType: "conversation", entityId: conv.id,
      href: `/acquisition/replies?thread=${conv.id}`,
      metadata: { leadKey: lead.leadKey, status: nextStatus } as never,
    },
  });

  return { ok: true, conversationId: conv.id, messageId: message.id, status: nextStatus, actions };
}

export async function recordInboundMessage(
  tenantId: string,
  msg: InboundMessage,
  source: string,
): Promise<RecordResult> {
  return withTenantContext(tenantId, async (tx) => recordInboundMessageTx(tx, tenantId, msg, source));
}
