import type { Metadata } from "next";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { requireTenantId } from "@/lib/tenant";
import { withTenantContext } from "@wavesco/db";
import { StatusPill } from "@/components/command/primitives";
import { AutoRefresh } from "@/components/command/auto-refresh";
import { EmailTemplateControls } from "@/components/acquisition/email-template-controls";
import { brevoHealth as sendingHealth, getIntegrationsHealth } from "@/lib/wavesco/integrations";
import { formatIST } from "@/lib/wavesco/time";
import { readEmailMode } from "@/lib/wavesco/mail-mode";
import { plainSendError } from "@/lib/wavesco/send-error-text";
import { EmailModeSelector } from "@/components/acquisition/email-mode-selector";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Email" };

function pillForStatus(s: string): string {
  const t = s.toLowerCase();
  if (t === "sent" || t === "delivered" || t === "approved") return "connected";
  if (t === "submitted" || t === "pending" || t === "queued" || t === "ready_for_approval") return "queued";
  if (t === "failed" || t === "rejected" || t === "error") return "failed";
  if (t === "draft") return "never_connected";
  return t;
}

export default async function EmailControlPage() {
  const session = await auth();
  const tenantId = requireTenantId(session as unknown);

  // Sending / integrations health
  let sending: ReturnType<typeof sendingHealth> | null = null;
  let health: Awaited<ReturnType<typeof getIntegrationsHealth>> | null = null;
  try {
    sending = sendingHealth();
  } catch {
    sending = { status: "BLOCKED", detail: "sendingHealth unavailable", reason: "unavailable" } as any;
  }
  try {
    health = await getIntegrationsHealth(tenantId);
  } catch {
    health = null;
  }
  const sendingEntry = (health as any)?.brevo ?? null;

  // Email operating mode (client choice; both modes share one lifecycle).
  // Defaults to waves_managed on transient failure — never blocks the page.
  // companyName is only used as the plain-language sending identity line.
  let emailMode: "waves_managed" | "client_managed" = "waves_managed";
  let companyName: string | null = null;
  try {
    const prof = await withTenantContext(tenantId, async (tx: any) => {
      return tx.acquisitionProfile.findFirst({
        where: { tenantId },
        select: { integrations: true, companyName: true },
      });
    });
    emailMode = readEmailMode(prof?.integrations);
    companyName = typeof prof?.companyName === "string" && prof.companyName.trim() ? prof.companyName.trim() : null;
  } catch {
    // keep defaults
  }

  // Templates
  let templates: { id: string; subject: string; body: string; createdAt?: string }[] = [];
  let templatesStatus: string = "not_configured";
  try {
    const result: any = await withTenantContext(tenantId, async (tx: any) => {
      if (tx.emailTemplate && typeof tx.emailTemplate.findMany === "function") {
        try {
          const rows = await tx.emailTemplate.findMany({ where: { tenantId }, orderBy: { createdAt: "desc" }, take: 50 });
          return { rows, status: "ok" as const };
        } catch {
          // fall through
        }
      }
      if (tx.activityEvent && typeof tx.activityEvent.findMany === "function") {
        try {
          const events = await tx.activityEvent.findMany({ where: { tenantId, type: "email_template" }, orderBy: { createdAt: "desc" }, take: 50 });
          if (Array.isArray(events) && events.length > 0) {
            return {
              rows: events.map((e: any) => ({
                id: e.id,
                subject: e.title ?? (e.metadata as any)?.subject ?? "",
                body: (e.metadata as any)?.body ?? "",
                createdAt: e.createdAt,
              })),
              status: "ok" as const,
            };
          }
        } catch {
          // ignore
        }
      }
      return { rows: [], status: "not_configured" as const, reason: "templates store unavailable" };
    });
    templates = (result.rows ?? []) as typeof templates;
    templatesStatus = result.status ?? "not_configured";
  } catch {
    templates = [];
    templatesStatus = "not_configured";
  }

  // OutreachEmail for delivery/campaign inspection
  let emails: any[] = [];
  let outreachOrders: any[] = [];
  let campaigns: any[] = [];
  let emailError: string | null = null;
  try {
    const data: any = await withTenantContext(tenantId, async (tx: any) => {
      const em = await tx.outreachEmail.findMany({ where: { tenantId }, orderBy: { createdAt: "desc" }, take: 100 });
      let orders: any[] = [];
      try {
        orders = await tx.outreachOrder.findMany({ where: { tenantId }, orderBy: { createdAt: "desc" }, take: 50 });
      } catch {
        orders = [];
      }
      let camps: any[] = [];
      try {
        camps = await tx.campaign.findMany({ where: { tenantId }, orderBy: { createdAt: "desc" }, take: 20 });
      } catch {
        camps = [];
      }
      return { em, orders, camps };
    });
    emails = data.em ?? [];
    outreachOrders = data.orders ?? [];
    campaigns = data.camps ?? [];
  } catch (e) {
    emailError = e instanceof Error ? e.message : String(e);
  }

  // Delivery state inspection aggregates
  const byStatus = new Map<string, number>();
  for (const e of emails) {
    const s = String(e.status ?? "unknown").toLowerCase();
    byStatus.set(s, (byStatus.get(s) ?? 0) + 1);
  }
  for (const o of outreachOrders) {
    const s = String(o.deliveryStatus ?? o.status ?? "unknown").toLowerCase();
    // only count orders separately if not duplicating email ids
    // we keep separate map for orders
  }
  const orderByStatus = new Map<string, number>();
  for (const o of outreachOrders) {
    const s = String(o.deliveryStatus ?? o.status ?? "unknown").toLowerCase();
    orderByStatus.set(s, (orderByStatus.get(s) ?? 0) + 1);
  }
  const failedEmails = emails.filter((e) => String(e.status).toLowerCase() === "failed");
  const failedOrders = outreachOrders.filter((o) => String(o.deliveryStatus ?? "").toLowerCase() === "failed" || String(o.status).toLowerCase().includes("failed"));

  // Campaign grouping
  const byCampaign = new Map<string, { count: number; sent: number; failed: number; campaignName?: string }>();
  for (const e of emails) {
    const cid = (e.campaignId as string | null) ?? "__no_campaign__";
    const cur = byCampaign.get(cid) ?? { count: 0, sent: 0, failed: 0 };
    cur.count += 1;
    if (String(e.status).toLowerCase() === "sent") cur.sent += 1;
    if (String(e.status).toLowerCase() === "failed") cur.failed += 1;
    byCampaign.set(cid, cur);
  }
  // attach campaign names
  for (const c of campaigns) {
    const entry = byCampaign.get(c.id);
    if (entry) entry.campaignName = c.name;
  }

  const sendingStatus = sendingEntry?.status ?? sending?.status ?? "BLOCKED";

  // Step 04 summary — all derived from data already loaded above. No new reads.
  const sendingOk = sendingStatus === "ok";
  const awaitingApproval = emails.filter((e) => String(e.status).toLowerCase() === "submitted").length;
  const approvedCount = emails.filter((e) => String(e.status).toLowerCase() === "approved").length;
  const sentCount = emails.filter((e) => String(e.status).toLowerCase() === "sent").length;
  const latestMessage = templates[0]?.subject?.trim() ? templates[0].subject.trim() : null;
  const sendingFor = companyName ?? "your business";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">Step 04 · Cold mail</p>
          <h1 className="mt-1 font-display text-[22px] font-semibold tracking-[-0.02em] text-foreground">How should WAVES send your outreach?</h1>
          <p className="mt-1.5 max-w-2xl font-sans text-[13px] leading-5 text-muted-foreground">
            Pick one — connect, authorize, done. Nothing sends without your approval.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <AutoRefresh intervalMs={15_000} />
          <StatusPill state={sendingOk ? "connected" : sendingStatus === "BLOCKED" ? "disconnected" : "error"} />
          <span className="font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">{sendingOk ? "Sending ready" : "Sending needs attention"}</span>
        </div>
      </div>

      {/* Step 04 status — one panel, three honest states, same backend */}
      {emailMode === "client_managed" ? (
        <section className="rounded-lg border border-border/80 bg-card p-5">
          <p className="font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">Your email</p>
          <p className="mt-2 font-sans text-sm font-medium tracking-[-0.01em] text-foreground">
            Connecting your mailbox…
          </p>
          <p className="mt-1 max-w-2xl font-sans text-[13px] leading-5 text-muted-foreground">
            A WAVES specialist connects it with you — nothing for you to configure. Until then your campaigns keep
            sending through WAVES-managed email, so nothing is blocked.
          </p>
          <div className="mt-3 flex flex-wrap gap-2 text-xs">
            <Link href="/acquisition/outreach" className="rounded-md bg-primary px-3 py-1.5 font-medium text-primary-foreground hover:bg-primary/90">
              Review outreach →
            </Link>
            <a href="#email-choice" className="rounded-md border px-3 py-1.5 hover:bg-accent">
              Change email
            </a>
          </div>
        </section>
      ) : !sendingOk ? (
        <section className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-5">
          <p className="font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">Your email</p>
          <p className="mt-2 font-sans text-sm font-medium tracking-[-0.01em] text-foreground">
            Your email connection needs attention.
          </p>
          <p className="mt-1 max-w-2xl font-sans text-[13px] leading-5 text-muted-foreground">
            Your emails stay queued — nothing is lost. WAVES picks them up as soon as sending is connected.
          </p>
          <div className="mt-3 flex flex-wrap gap-2 text-xs">
            <Link href="/acquisition/integrations" className="rounded-md bg-primary px-3 py-1.5 font-medium text-primary-foreground hover:bg-primary/90">
              Try again
            </Link>
            <a href="#email-choice" className="rounded-md border border-border/80 bg-card px-3 py-1.5 hover:bg-accent">
              Change email
            </a>
          </div>
        </section>
      ) : (
        <section className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-5">
          <p className="font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">Cold mail</p>
          <p className="mt-2 font-sans text-sm font-medium tracking-[-0.01em] text-foreground">
            ✓ Sending is ready
          </p>
          <div className="mt-1 space-y-0.5 font-sans text-[13px] leading-5 text-muted-foreground">
            <p>Sending for: <span className="font-medium text-foreground">{sendingFor}</span></p>
            <p>This cycle: <span className="font-mono tabular-nums text-foreground">{emails.length}</span> prospects · <span className="font-mono tabular-nums text-foreground">{approvedCount}</span> approved to send · <span className="font-mono tabular-nums text-foreground">{sentCount}</span> sent</p>
            <p>Message: {latestMessage ? <span className="font-medium text-foreground">“{latestMessage.length > 80 ? `${latestMessage.slice(0, 80)}…` : latestMessage}”</span> : "no message yet — write one below"}</p>
          </div>
          <div className="mt-3 flex flex-wrap gap-2 text-xs">
            <Link href="/acquisition/outreach" className="rounded-md bg-primary px-3 py-1.5 font-medium text-primary-foreground hover:bg-primary/90">
              Review outreach →
            </Link>
            <a href="#email-choice" className="rounded-md border border-border/80 bg-card px-3 py-1.5 hover:bg-accent">
              Change email
            </a>
          </div>
        </section>
      )}

      {/* Email operating mode — client choice, one shared lifecycle */}
      <div id="email-choice" className="scroll-mt-4">
        <EmailModeSelector initialMode={emailMode} />
      </div>

      {/* Sending — plain status, no provider names or keys */}
      <section className="rounded-lg border border-border/80 bg-card p-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="font-sans text-[13px] font-semibold tracking-[-0.01em] text-foreground">Sending</h2>
            <p className="font-sans text-[13px] leading-5 text-muted-foreground">
              Status: <StatusPill state={sendingStatus === "ok" ? "connected" : "disconnected"} />{" "}
              <span className="ml-2">{sendingStatus === "ok" ? "Ready — WAVES can send your approved emails." : "Needs attention — your emails stay queued, nothing is lost."}</span>
            </p>
            <p className="mt-1 font-sans text-[13px] leading-5 text-muted-foreground">
              {emailMode === "waves_managed"
                ? "WAVES handles sending for you. Nothing for you to configure."
                : "You chose your own mailbox — a WAVES specialist connects it with you. Until then, campaigns keep sending through WAVES-managed email."}
            </p>
          </div>
          <div className="flex flex-col items-end gap-2">
            <Link href="/acquisition/integrations" className="rounded-lg border border-border/80 px-3 py-1.5 text-xs hover:bg-accent">
              Open Connections
            </Link>
          </div>
        </div>
        {sendingStatus === "BLOCKED" ? (
          <div className="mt-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs">
            <p className="font-medium text-amber-800 dark:text-amber-200">Email sending isn&apos;t connected yet</p>
            <p className="text-amber-800/80 dark:text-amber-200/80">Your emails stay queued and nothing is lost. WAVES picks them up as soon as sending is connected — check Connections for status.</p>
          </div>
        ) : null}
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <div className="rounded-lg border border-border/80 bg-muted/20 p-3">
            <p className="font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">Approval first</p>
            <p className="mt-1 text-xs">Every email waits for your approval in Outreach before it can send.</p>
          </div>
          <div className="rounded-lg border border-border/80 bg-muted/20 p-3">
            <p className="font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">Delivery</p>
            <p className="mt-1 text-xs">The list below shows every email&apos;s real state — waiting, sent, or failed — with the reason when one fails.</p>
          </div>
        </div>
      </section>

      {/* Templates */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">Message templates</h2>
          <Link href="/acquisition/outreach" className="rounded-lg border border-border/80 px-3 py-1.5 text-xs hover:bg-accent">
            Go to Outreach
          </Link>
        </div>
        <p className="font-sans text-[13px] leading-5 text-muted-foreground">
          <StatusPill state={templatesStatus === "ok" ? "connected" : "disconnected"} /> <span className="ml-2">{templates.length} {templates.length === 1 ? "template" : "templates"}</span>
        </p>
        <EmailTemplateControls initialTemplates={templates} />
        <div className="rounded-lg border border-border/80 bg-muted/20 p-3 text-xs">
          <p className="font-medium">How preview works</p>
          <p className="text-muted-foreground">Preview shows exactly how the email will read for a prospect — with their business name and city filled in. Previews never send anything.</p>
        </div>
      </section>

      {/* Your campaigns */}
      <section className="space-y-3">
        <h2 className="font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">Your campaigns</h2>
        {emailError ? (
          <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-3 text-xs">
            <p className="font-medium text-red-600 dark:text-red-400">Failed to load outreach</p>
            <p className="text-muted-foreground">{emailError}</p>
          </div>
        ) : byCampaign.size === 0 ? (
          <div className="rounded-lg border border-dashed border-border/80 p-6 text-center text-sm text-muted-foreground">
            No campaigns with outreach yet. Campaigns you create appear here once their emails are queued for approval.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border/80 bg-card">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/60 bg-muted/20 text-left font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
                  <th className="px-3 py-2">Campaign</th>
                  <th className="px-3 py-2">Ref</th>
                  <th className="px-3 py-2">Total</th>
                  <th className="px-3 py-2">Sent</th>
                  <th className="px-3 py-2">Failed</th>
                  <th className="px-3 py-2">Rate</th>
                  <th className="px-3 py-2">Open</th>
                </tr>
              </thead>
              <tbody>
                {Array.from(byCampaign.entries()).map(([cid, v]) => {
                  const rate = v.count > 0 ? Math.round((v.sent / v.count) * 100) : 0;
                  const label = cid === "__no_campaign__" ? "(no campaign)" : (v.campaignName ?? cid.slice(0, 12) + ".");
                  return (
                    <tr key={cid} className="border-b border-border/60 last:border-0 hover:bg-card-hover">
                      <td className="px-3 py-2 text-xs font-medium">{label}</td>
                      <td className="px-3 py-2 font-mono text-[11px] text-muted-foreground">{cid === "__no_campaign__" ? "-" : cid}</td>
                      <td className="px-3 py-2 tabular-nums">{v.count}</td>
                      <td className="px-3 py-2 tabular-nums text-emerald-600 dark:text-emerald-400">{v.sent}</td>
                      <td className="px-3 py-2 tabular-nums text-red-500">{v.failed}</td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
                            <div className="h-full bg-emerald-500" style={{ width: `${rate}%` }} />
                          </div>
                          <span className="text-xs tabular-nums">{rate}%</span>
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        {cid !== "__no_campaign__" ? (
                          <Link href={`/acquisition/campaigns/${cid}`} className="rounded border px-2 py-1 text-xs hover:bg-accent">
                            Open
                          </Link>
                        ) : (
                          <Link href="/acquisition/campaigns" className="rounded border px-2 py-1 text-xs hover:bg-accent">
                            Campaigns
                          </Link>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Delivery — every email's state */}
      <section className="space-y-3">
        <h2 className="font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">Delivery — every email&apos;s state</h2>
        <p className="font-sans text-[13px] leading-5 text-muted-foreground">Every email&apos;s real state — waiting, approved, sent or failed — with the reason when one fails. Nothing here is made up.</p>

        <div className="grid gap-3 sm:grid-cols-4">
          {[
            { key: "submitted", label: "Submitted" },
            { key: "approved", label: "Approved" },
            { key: "sent", label: "Sent" },
            { key: "failed", label: "Failed" },
          ].map((s) => {
            const count = byStatus.get(s.key) ?? 0;
            return (
              <div key={s.key} className="rounded-lg border border-border/80 bg-card p-3 text-center">
                <StatusPill state={pillForStatus(s.key)} />
                <p className="mt-1.5 text-xl font-semibold tabular-nums">{count}</p>
                <p className="font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">{s.label}</p>
              </div>
            );
          })}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg border border-border/80 bg-card">
            <div className="border-b border-border/60 p-3">
              <h3 className="font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">Emails — by state</h3>
              <p className="font-mono text-[11px] tracking-[0.02em] text-muted-foreground">{emails.length} total</p>
            </div>
            {emails.length === 0 ? (
              <p className="p-6 text-center text-xs text-muted-foreground">No emails yet.</p>
            ) : (
              <div className="max-h-[320px] overflow-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border/60 text-left uppercase tracking-wide text-muted-foreground">
                      <th className="px-3 py-2">Business</th>
                      <th className="px-3 py-2">State</th>
                      <th className="px-3 py-2">What happened</th>
                    </tr>
                  </thead>
                  <tbody>
                    {emails.slice(0, 20).map((e) => (
                      <tr key={e.id} className="border-b border-border/60 last:border-0 hover:bg-card-hover">
                        <td className="px-3 py-2">
                          <span className="font-medium">{e.business}</span>
                          <span className="block font-mono text-[11px] text-muted-foreground">{e.email}</span>
                        </td>
                        <td className="px-3 py-2">
                          <StatusPill state={pillForStatus(String(e.status))} />
                          <span className="ml-1 font-mono text-[11px]">{String(e.status)}</span>
                        </td>
                        <td className="max-w-[200px] px-3 py-2">
                          {e.error ? (
                            <span className="block break-words text-[11px] text-red-500" title={plainSendError(e.error)}>
                              {plainSendError(e.error).slice(0, 120)}
                            </span>
                          ) : e.sendError ? (
                            <span className="block break-words text-[11px] text-red-500" title={plainSendError((e as any).sendError)}>
                              {plainSendError((e as any).sendError).slice(0, 120)}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">-</span>
                          )}
                          <span className="block font-mono text-[10px] text-muted-foreground">
                            submitted {formatIST(e.submittedAt)} · decided {formatIST(e.decidedAt)} · sent {formatIST(e.sentAt)}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="rounded-lg border border-border/80 bg-card">
            <div className="border-b border-border/60 p-3">
              <h3 className="font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">Pipeline sends</h3>
              <p className="font-mono text-[11px] tracking-[0.02em] text-muted-foreground">{outreachOrders.length} total</p>
            </div>
            {outreachOrders.length === 0 ? (
              <p className="p-6 text-center text-xs text-muted-foreground">No pipeline sends yet.</p>
            ) : (
              <div className="max-h-[320px] overflow-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border/60 text-left uppercase tracking-wide text-muted-foreground">
                      <th className="px-3 py-2">Business</th>
                      <th className="px-3 py-2">State</th>
                      <th className="px-3 py-2">What happened</th>
                    </tr>
                  </thead>
                  <tbody>
                    {outreachOrders.slice(0, 20).map((o) => (
                      <tr key={o.id} className="border-b border-border/60 last:border-0 hover:bg-card-hover">
                        <td className="px-3 py-2">
                          <span className="font-medium">{o.businessName ?? o.business}</span>
                          <span className="block font-mono text-[11px] text-muted-foreground">{o.email}</span>
                        </td>
                        <td className="px-3 py-2">
                          <StatusPill state={pillForStatus(String(o.status))} />
                          <span className="ml-1 font-mono text-[11px]">{String(o.status)}</span>
                        </td>
                        <td className="max-w-[200px] px-3 py-2">
                          <span className="block text-[11px]">
                            delivery: <span className="font-mono">{String(o.deliveryStatus ?? "-")}</span>
                          </span>
                          {o.sendError ? (
                            <span className="block break-words text-[11px] text-red-500" title={plainSendError(o.sendError)}>
                              {plainSendError(o.sendError).slice(0, 120)}
                            </span>
                          ) : null}
                          {o.replyStatus ? <span className="block font-mono text-[11px] tracking-[0.02em] text-muted-foreground">reply: {String(o.replyStatus)}</span> : null}
                          <span className="block font-mono text-[10px] text-muted-foreground">
                            submitted {formatIST(o.submittedAt)} · sent {formatIST(o.sentAt)}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {(failedEmails.length > 0 || failedOrders.length > 0) ? (
          <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-3">
            <p className="text-xs font-medium text-red-600 dark:text-red-400">Failed sends — why</p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-[11px]">
              {failedEmails.slice(0, 5).map((e) => (
                <li key={`fe-${e.id}`} className="break-words">
                  <span className="font-medium">{e.business}</span> ({e.email}) — {plainSendError(e.error ?? (e as any).sendError ?? "unknown").slice(0, 140)}
                </li>
              ))}
              {failedOrders.slice(0, 5).map((o) => (
                <li key={`fo-${o.id}`} className="break-words">
                  <span className="font-medium">{o.businessName ?? o.business}</span> ({o.email}) — {plainSendError(o.sendError ?? "-").slice(0, 140)}
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="font-sans text-[13px] leading-5 text-muted-foreground">No failures to inspect — healthy queue.</p>
        )}

        <p className="font-mono text-[11px] tracking-[0.02em] text-muted-foreground">
          Note: &quot;approved&quot; means you approved the email; &quot;sent&quot; is set only once sending is confirmed. Replies show up when they arrive — nothing is guessed.
        </p>
      </section>

      <div className="flex gap-2">
        <Link href="/acquisition/outreach" className="rounded-lg border border-border/80 px-3 py-1.5 text-xs hover:bg-accent">
          View Outreach
        </Link>
        <Link href="/acquisition/campaigns" className="rounded-lg border border-border/80 px-3 py-1.5 text-xs hover:bg-accent">
          View Campaigns
        </Link>
        <Link href="/acquisition/integrations" className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90">
          Connections
        </Link>
      </div>
    </div>
  );
}
