import type { Metadata } from "next";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { requireTenantId } from "@/lib/tenant";
import { withTenantContext } from "@wavesco/db";
import { getFacets } from "@/lib/wavesco/lead-engine";
import { logEngineError, toSafeEngineError } from "@/lib/wavesco/engine-errors";
import { EngineStatusCard } from "@/components/acquisition/engine-status";
import { classifyEmail, type EmailStatus } from "@/lib/wavesco/outreach-logic";
import { listPipelineLeads } from "@/lib/wavesco/pipeline";
import { MetricCard, SectionHeader, StatusPill } from "@/components/command/primitives";
import { AutoRefresh } from "@/components/command/auto-refresh";
import { formatIST } from "@/lib/wavesco/time";
import { BatchPanel, LeadStageButtons, OrderButtons } from "@/components/acquisition/pipeline-actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Outreach Pipeline" };

interface SearchParams {
  emailStatus?: string;
  outreachStatus?: string;
  approvalStatus?: string;
  sendStatus?: string;
  replyStatus?: string;
  category?: string;
  location?: string;
}

interface OrderRow {
  id: string;
  version: number;
  status: string;
  subject: string;
  plannerModel: string | null;
  deliveryStatus: string | null;
  replyStatus: string | null;
  approvalId: string | null;
  decidedAt: Date | null;
  sentAt: Date | null;
  createdAt: Date;
}

export default async function PipelinePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const session = await auth();
  const tenantId = requireTenantId(session);
  const sp = await searchParams;

  let engineFailure: unknown = null;
  let leads: Awaited<ReturnType<typeof listPipelineLeads>> = [];
  let facets: Awaited<ReturnType<typeof getFacets>> | null = null;
  try {
    leads = listPipelineLeads();
    facets = await getFacets();
  } catch (e) {
    logEngineError("pipeline:facets", e);
    engineFailure = e;
  }

  const researches = new Map<
    string,
    { researchedAt: Date; checkedAt: Date | null; business: string }
  >();
  const ordersByLead = new Map<string, OrderRow>();
  let followUpDue = 0;

  if (!engineFailure) {
    await withTenantContext(tenantId, async (tx) => {
      for (const r of await tx.leadResearch.findMany({
        where: { tenantId },
        select: { leadKey: true, researchedAt: true, checkedAt: true, business: true },
      })) {
        researches.set(r.leadKey, { researchedAt: r.researchedAt, checkedAt: r.checkedAt, business: r.business });
      }
      for (const o of await tx.outreachOrder.findMany({
        where: { tenantId },
        orderBy: [{ leadKey: "asc" }, { version: "desc" }],
      })) {
        if (!ordersByLead.has(o.leadKey)) {
          ordersByLead.set(o.leadKey, {
            id: o.id,
            version: o.version,
            status: o.status,
            subject: o.subject,
            plannerModel: (o as { plannerModel?: string | null }).plannerModel ?? null,
            deliveryStatus: o.deliveryStatus,
            replyStatus: o.replyStatus,
            approvalId: o.approvalId,
            decidedAt: o.decidedAt,
            sentAt: o.sentAt,
            createdAt: o.createdAt,
          });
        }
      }
      followUpDue = await tx.followUp.count({
        where: { tenantId, status: "pending", dueAt: { lte: new Date() } },
      });
    });
  }

  // Classify every lead's email for display (authoritative per-lead checks
  // that consider global dedupe run inside checkLeadEmail).
  const emailStatuses = new Map<string, EmailStatus>();
  for (const l of leads) {
    emailStatuses.set(l.name_key, classifyEmail(l, new Set()).status);
  }

  const activeLeads = leads.filter((l) => l.status !== "reference");
  const countsByStatus = { VERIFIED: 0, UNVERIFIED: 0, NOT_FOUND: 0, BOUNCED: 0, OPTED_OUT: 0, ALREADY_CONTACTED: 0 };
  for (const s of emailStatuses.values()) countsByStatus[s] += 1;

  const orderCounts = {
    pendingApproval: 0,
    readyToQueue: 0,
    approved: 0,
    sent: 0,
    delivered: 0,
    bounced: 0,
    replied: 0,
    failed: 0,
    cancelled: 0,
    rejected: 0,
  };
  for (const o of ordersByLead.values()) {
    switch (o.status) {
      case "PENDING":
        orderCounts.pendingApproval += 1;
        break;
      case "READY_FOR_APPROVAL":
        orderCounts.readyToQueue += 1;
        break;
      case "APPROVED":
        orderCounts.approved += 1;
        break;
      case "SENT":
      case "DELIVERED":
        orderCounts.sent += 1;
        if ((o.deliveryStatus ?? "").startsWith("accepted")) orderCounts.delivered += 1;
        if (o.deliveryStatus === "bounced") orderCounts.bounced += 1;
        break;
      case "FAILED":
        orderCounts.failed += 1;
        break;
      case "CANCELLED":
        orderCounts.cancelled += 1;
        break;
      case "REJECTED":
        orderCounts.rejected += 1;
        break;
      default:
        break;
    }
    if (o.replyStatus) orderCounts.replied += 1;
  }

  const liveOrderKeys = new Set(
    [...ordersByLead.entries()].filter(([, o]) => ["READY_FOR_APPROVAL", "PENDING", "APPROVED", "SENT", "DELIVERED"].includes(o.status)).map(([k]) => k),
  );
  const readyForOutreach = [...emailStatuses.entries()].filter(
    ([key, s]) => s === "VERIFIED" && !liveOrderKeys.has(key),
  ).length;

  // ---- table rows with filters ------------------------------------
  interface TableRow {
    key: string;
    leadId: string;
    business: string;
    email: string | null;
    emailStatus: EmailStatus;
    researchedAt: Date | null;
    checkedAt: Date | null;
    order: OrderRow | undefined;
    nextFollowUp: Date | null;
    category: string | null;
    location: string;
  }
  const rows: TableRow[] = activeLeads.map((l) => ({
    key: l.name_key,
    leadId: `WV-${String(l.id).padStart(4, "0")}`,
    business: l.business,
    email: l.email?.trim() ?? null,
    emailStatus: emailStatuses.get(l.name_key) ?? "NOT_FOUND",
    researchedAt: researches.get(l.name_key)?.researchedAt ?? null,
    checkedAt: researches.get(l.name_key)?.checkedAt ?? null,
    order: ordersByLead.get(l.name_key),
    nextFollowUp: l.next_follow_up ? new Date(l.next_follow_up) : null,
    category: l.category,
    location: [l.area, l.city].filter(Boolean).join(", "),
  }));

  const filtered = rows.filter((r) => {
    if (sp.emailStatus && r.emailStatus !== sp.emailStatus) return false;
    if (sp.outreachStatus) {
      const hasLive = r.order && ["READY_FOR_APPROVAL", "PENDING", "APPROVED", "SENT", "DELIVERED"].includes(r.order.status);
      if (sp.outreachStatus === "none" && hasLive) return false;
      if (sp.outreachStatus !== "none" && r.order?.status !== sp.outreachStatus) return false;
    }
    if (sp.approvalStatus) {
      if (sp.approvalStatus === "pending" && r.order?.status !== "PENDING") return false;
      if (sp.approvalStatus === "decided" && !r.order?.decidedAt) return false;
      if (sp.approvalStatus === "queued" && !r.order?.approvalId) return false;
    }
    if (sp.sendStatus) {
      if (sp.sendStatus === "sent" && !(r.order?.sentAt && r.order.deliveryStatus !== "bounced")) return false;
      if (sp.sendStatus === "failed" && r.order?.status !== "FAILED") return false;
      if (sp.sendStatus === "not_sent" && r.order?.sentAt) return false;
    }
    if (sp.replyStatus) {
      const replied = Boolean(r.order?.replyStatus);
      if (sp.replyStatus === "replied" && !replied) return false;
      if (sp.replyStatus === "no_reply" && replied) return false;
    }
    if (sp.category && sp.category !== "all" && r.category !== sp.category) return false;
    if (sp.location && sp.location !== "all" && !r.location.toLowerCase().includes(sp.location.toLowerCase())) return false;
    return true;
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Outreach Pipeline</h1>
          <p className="text-sm text-muted-foreground">
            Lead Intelligence → Research → Email Check → Individual Outreach Orders → Approval Queue →
            existing cold-email infrastructure → Follow-ups. Every number below is computed from the live
            corpus and database — zero means zero.
          </p>
        </div>
        <AutoRefresh intervalMs={10_000} />
      </div>

      {engineFailure ? (
        <EngineStatusCard error={toSafeEngineError(engineFailure)} />
      ) : (
        <>
          {/* Metrics */}
          <section className="space-y-3">
            <SectionHeader title="Pipeline" subtitle={`${activeLeads.length} active leads · ${leads.length - activeLeads.length} reference seeds excluded`} />
            <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-7">
              <MetricCard label="Total Leads" value={leads.length} href="/acquisition/leads" />
              <MetricCard label="Researched" value={researches.size} />
              <MetricCard label="Email Verified" value={countsByStatus.VERIFIED} />
              <MetricCard label="Email Not Found" value={countsByStatus.NOT_FOUND} />
              <MetricCard label="Ready For Outreach" value={readyForOutreach} />
              <MetricCard label="Pending Approval" value={orderCounts.pendingApproval} />
              <MetricCard label="Approved" value={orderCounts.approved} />
              <MetricCard label="Sent" value={orderCounts.sent} />
              <MetricCard label="Delivered" value={orderCounts.delivered} />
              <MetricCard label="Bounced" value={orderCounts.bounced + countsByStatus.BOUNCED} />
              <MetricCard label="Replied" value={orderCounts.replied} />
              <MetricCard label="Follow-up Due" value={followUpDue} href="/acquisition/follow-ups" />
              <MetricCard label="Opted Out" value={countsByStatus.OPTED_OUT} />
            </div>
          </section>

          {/* Batch actions */}
          <section className="space-y-3">
            <SectionHeader title="Batch actions" subtitle="Bounded at 40 per run · batch summaries go to Telegram + Obsidian · nothing sends without individual approvals" />
            <BatchPanel
              counts={{
                researchable: rows.filter((r) => !r.researchedAt).length,
                checkable: activeLeads.length,
                generatable: readyForOutreach,
                readyToQueue: orderCounts.readyToQueue,
              }}
            />
          </section>

          {/* Filters */}
          <form action="/acquisition/pipeline" className="grid gap-2 rounded-lg border bg-card p-3 sm:grid-cols-3 lg:grid-cols-8">
            <select name="emailStatus" defaultValue={sp.emailStatus ?? ""} className="rounded-md border bg-transparent px-2 py-1.5 text-sm">
              <option value="">Email status · all</option>
              {Object.keys(countsByStatus).map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            <select name="outreachStatus" defaultValue={sp.outreachStatus ?? ""} className="rounded-md border bg-transparent px-2 py-1.5 text-sm">
              <option value="">Outreach status · all</option>
              <option value="none">no order</option>
              {["READY_FOR_APPROVAL", "PENDING", "APPROVED", "SENT", "DELIVERED", "FAILED", "REJECTED", "CANCELLED"].map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            <select name="approvalStatus" defaultValue={sp.approvalStatus ?? ""} className="rounded-md border bg-transparent px-2 py-1.5 text-sm">
              <option value="">Approval · all</option>
              <option value="queued">queued</option>
              <option value="pending">pending decision</option>
              <option value="decided">decided</option>
            </select>
            <select name="sendStatus" defaultValue={sp.sendStatus ?? ""} className="rounded-md border bg-transparent px-2 py-1.5 text-sm">
              <option value="">Send · all</option>
              <option value="sent">sent</option>
              <option value="failed">failed</option>
              <option value="not_sent">not sent</option>
            </select>
            <select name="replyStatus" defaultValue={sp.replyStatus ?? ""} className="rounded-md border bg-transparent px-2 py-1.5 text-sm">
              <option value="">Reply · all</option>
              <option value="replied">replied</option>
              <option value="no_reply">no reply</option>
            </select>
            <select name="category" defaultValue={sp.category ?? ""} className="rounded-md border bg-transparent px-2 py-1.5 text-sm">
              <option value="">Category · all</option>
              {(facets?.categories ?? []).map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
            <input name="location" defaultValue={sp.location ?? ""} placeholder="Location contains…" className="rounded-md border bg-transparent px-2 py-1.5 text-sm" />
            <button type="submit" className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground">
              Apply filters
            </button>
          </form>

          {/* Table */}
          <div className="overflow-x-auto rounded-lg border bg-card">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-3 py-2.5">Lead</th>
                  <th className="px-3 py-2.5">Business</th>
                  <th className="px-3 py-2.5">Email</th>
                  <th className="px-3 py-2.5">Email Status</th>
                  <th className="px-3 py-2.5">Research</th>
                  <th className="px-3 py-2.5">Outreach</th>
                  <th className="px-3 py-2.5">Approval / Send / Reply</th>
                  <th className="px-3 py-2.5">Next Follow-up</th>
                  <th className="px-3 py-2.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-4 py-10 text-center text-muted-foreground">
                      No leads match these filters.
                    </td>
                  </tr>
                ) : (
                  filtered.slice(0, 60).map((r) => (
                    <tr key={r.key} className="border-b last:border-0 align-top hover:bg-accent/40">
                      <td className="px-3 py-2.5 font-mono text-[11px]">
                        {r.leadId}
                        <Link href={`/acquisition/leads/${encodeURIComponent(r.key)}`} className="mt-0.5 block text-[10px] text-muted-foreground underline-offset-2 hover:underline">
                          View lead
                        </Link>
                      </td>
                      <td className="max-w-[160px] truncate px-3 py-2.5">
                        <span className="font-medium">{r.business}</span>
                        <span className="block text-[11px] text-muted-foreground">{r.location || "—"}</span>
                      </td>
                      <td className="px-3 py-2.5 font-mono text-[11px]">{r.email ?? "—"}</td>
                      <td className="px-3 py-2.5"><StatusPill state={r.emailStatus.toLowerCase()} /></td>
                      <td className="px-3 py-2.5 text-[11px] text-muted-foreground">
                        {r.researchedAt ? `yes · ${formatIST(r.researchedAt)}` : "not yet"}
                      </td>
                      <td className="px-3 py-2.5">
                        {r.order ? (
                          <>
                            <StatusPill state={r.order.status.toLowerCase()} />
                            <span className="mt-1 block max-w-[200px] truncate text-[10px] text-muted-foreground">{r.order.subject}</span>
                            {r.order.plannerModel === "fact-composer" ? (
                              <span
                                title="AI enrichment was unavailable when this was drafted, so a deterministic template was used. The copy is safe but generic — review before approving."
                                className="mt-1 inline-block rounded-sm border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-amber-700"
                              >
                                Drafted without AI
                              </span>
                            ) : r.order.plannerModel ? (
                              <span
                                title={`Drafted with AI model ${r.order.plannerModel}. Still review before approving.`}
                                className="mt-1 inline-block max-w-[200px] truncate rounded-sm border border-line px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-muted-foreground"
                              >
                                AI · {r.order.plannerModel}
                              </span>
                            ) : null}
                          </>
                        ) : (
                          <span className="text-[11px] text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-[11px] leading-relaxed text-muted-foreground">
                        #{r.order?.approvalId ?? "—"}
                        <br />
                        send: {r.order?.deliveryStatus ?? (r.order?.sentAt ? "dispatched" : "—")}
                        <br />
                        reply: {r.order?.replyStatus ?? "none"}
                      </td>
                      <td className="px-3 py-2.5 text-[11px] text-muted-foreground">{formatIST(r.nextFollowUp)}</td>
                      <td className="px-3 py-2.5">
                        <div className="flex flex-col items-end gap-2">
                          <LeadStageButtons nameKey={r.key} />
                          {r.order ? (
                            <OrderButtons orderId={r.order.id} status={r.order.status} decided={Boolean(r.order.decidedAt)} />
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          {filtered.length > 60 ? (
            <p className="text-[11px] text-muted-foreground">Showing first 60 of {filtered.length} filtered rows — narrow the filters to see more.</p>
          ) : null}

          <p className="text-[11px] text-muted-foreground">
            Approve dispatches synchronously through the existing n8n decide endpoint → Email Outbox → SMTP.
            &quot;SENT&quot; is recorded only when the provider accepts; failures keep their reason. Follow-ups are
            scheduled automatically after a successful send and stop on bounce, opt-out or reply.
          </p>
        </>
      )}
    </div>
  );
}
