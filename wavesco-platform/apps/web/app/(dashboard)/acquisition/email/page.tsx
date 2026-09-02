import type { Metadata } from "next";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { requireTenantId } from "@/lib/tenant";
import { withTenantContext } from "@wavesco/db";
import { StatusPill } from "@/components/command/primitives";
import { TestConnectionButton } from "@/components/acquisition/integrations-controls";
import { EmailTemplateControls } from "@/components/acquisition/email-template-controls";
import { brevoHealth, getIntegrationsHealth } from "@/lib/wavesco/integrations";
import { formatIST } from "@/lib/wavesco/time";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Email Control" };

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

  // Brevo / integrations health
  let brevo: ReturnType<typeof brevoHealth> | null = null;
  let health: Awaited<ReturnType<typeof getIntegrationsHealth>> | null = null;
  try {
    brevo = brevoHealth();
  } catch {
    brevo = { status: "BLOCKED", detail: "brevoHealth unavailable", reason: "unavailable" } as any;
  }
  try {
    health = await getIntegrationsHealth(tenantId);
  } catch {
    health = null;
  }
  const brevoEntry = health?.brevo ?? null;

  // Templates
  let templates: { id: string; subject: string; body: string; createdAt?: string }[] = [];
  let templatesStatus: string = "not_configured";
  let templatesReason: string | undefined;
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
      return { rows: [], status: "not_configured" as const, reason: "EmailTemplate table not configured, no templates" };
    });
    templates = (result.rows ?? []) as typeof templates;
    templatesStatus = result.status ?? "not_configured";
    templatesReason = result.reason;
  } catch (e) {
    templates = [];
    templatesStatus = "not_configured";
    templatesReason = e instanceof Error ? e.message : String(e);
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

  const brevoDetail = brevoEntry?.detail ?? brevo?.detail ?? "Brevo status unavailable";
  const brevoStatus = brevoEntry?.status ?? brevo?.status ?? "BLOCKED";
  const brevoReason = brevoEntry?.reason ?? (brevo as any)?.reason ?? undefined;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Email Control</h1>
          <p className="text-sm text-muted-foreground">
            Manage templates, preview renders without sending, inspect campaigns grouped by campaignId, inspect delivery state (submitted/approved/sent/failed + sendError), and configure Brevo sending integration — server-side only, audit-logged.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <StatusPill state={brevoStatus === "ok" ? "connected" : brevoStatus === "BLOCKED" ? "disconnected" : "error"} />
          <span className="text-xs uppercase tracking-widest text-muted-foreground">Brevo {brevoStatus}</span>
        </div>
      </div>

      {/* Sending Integration — Brevo */}
      <section className="rounded-lg border bg-card p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">Sending Integration — Brevo / SMTP</h2>
            <p className="text-xs text-muted-foreground">Brevo API key is server-side only (env: BREVO_API_KEY via credentialRef). Test Connection is server-side and never leaks the key; URLs are masked. For SMTP outbox, delivery goes via n8n Email Outbox.</p>
            <p className="mt-1 font-mono text-xs">
              Status: <StatusPill state={brevoStatus === "ok" ? "connected" : "disconnected"} /> <span className="ml-2">{brevoDetail}</span>
            </p>
            {brevoReason && brevoReason !== brevoDetail ? <p className="text-[11px] text-muted-foreground">Reason: {brevoReason}</p> : null}
            <p className="mt-1 text-[11px] text-muted-foreground">Key: <span className="font-mono">BREVO_API_KEY</span> — masked, never exposed to browser. Health via <code className="rounded bg-muted px-1 py-0.5">getIntegrationsHealth</code> + <code className="rounded bg-muted px-1 py-0.5">brevoHealth()</code>.</p>
          </div>
          <div className="flex flex-col items-end gap-2">
            <TestConnectionButton integrationKey="brevo" label="Brevo" />
            <Link href="/acquisition/integrations" className="rounded-md border px-3 py-1.5 text-xs hover:bg-accent">
              Open Integrations
            </Link>
          </div>
        </div>
        {brevoStatus === "BLOCKED" ? (
          <div className="mt-3 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs">
            <p className="font-medium text-amber-800 dark:text-amber-200">Brevo not configured</p>
            <p className="text-amber-800/80 dark:text-amber-200/80">Set <span className="font-mono">BREVO_API_KEY</span> server-side (env or credentialRef). Until then, sending integration Test returns BLOCKED without leaking secrets; outreach still queues via Approval → Email Outbox → SMTP path.</p>
          </div>
        ) : null}
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          <div className="rounded-md border bg-muted/20 p-3">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Policy</p>
            <p className="mt-1 text-xs">Dashboard never exposes provider keys to browser; all sends are server-side via Brevo/SMTP, audit-logged.</p>
          </div>
          <div className="rounded-md border bg-muted/20 p-3">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Test</p>
            <p className="mt-1 text-xs">Test Connection hits <code className="rounded bg-muted px-1">/api/acquisition/integrations/test</code> with <span className="font-mono">key=brevo</span> — server-side Brevo <code className="rounded bg-muted px-1">/v3/account</code> probe.</p>
          </div>
          <div className="rounded-md border bg-muted/20 p-3">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Delivery</p>
            <p className="mt-1 text-xs">Delivery state below shows real <span className="font-mono">OutreachEmail.status</span> + <span className="font-mono">sendError</span> and OutreachOrder <span className="font-mono">deliveryStatus</span>.</p>
          </div>
        </div>
      </section>

      {/* Templates */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">Templates — List / Create / Update / Preview</h2>
          <Link href="/acquisition/outreach" className="rounded-md border px-3 py-1.5 text-xs hover:bg-accent">
            Go to Outreach
          </Link>
        </div>
        <p className="text-xs text-muted-foreground">
          Status: <StatusPill state={templatesStatus === "ok" ? "connected" : "disconnected"} /> <span className="ml-2">{templatesStatus}</span>
          {templatesReason ? <span className="ml-2 text-[11px]">— {templatesReason.slice(0, 120)}</span> : null} · {templates.length} templates · API <code className="rounded bg-muted px-1 py-0.5">/api/acquisition/email/templates</code> with RLS tenant scoping, auditControl.
        </p>
        <EmailTemplateControls initialTemplates={templates} />
        <div className="rounded-md border bg-muted/20 p-3 text-xs">
          <p className="font-medium">How preview works</p>
          <p className="text-muted-foreground">Preview calls <code className="rounded bg-muted px-1">POST /api/acquisition/email/templates</code> with <span className="font-mono">{"{ action: \"preview\", template: { subject, body }, vars: { business, city } }"}</span>. Server renders <code className="rounded bg-muted px-1">{"{{business}}"}</code> / <code className="rounded bg-muted px-1">{"{{city}}"}</code> via pure string replace, writes <span className="font-mono">AuditLog action=email.template.preview model=EmailTemplate</span> without sending. No SMTP/Brevo call is made during preview.</p>
          <p className="mt-2 font-mono text-[11px] text-muted-foreground">Example: subject &quot;Hello {"{{business}}"}&quot; with vars {"{ business: \"Acme\", city: \"Pune\" }"} → &quot;Hello Acme&quot;; body &quot;Hi {"{{business}}"} in {"{{city}}"}&quot; → &quot;Hi Acme in Pune&quot;</p>
        </div>
      </section>

      {/* Inspect Campaigns — grouped by campaignId */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">Inspect Campaigns — OutreachEmail grouped by campaignId</h2>
        {emailError ? (
          <div className="rounded-md border border-red-500/30 bg-red-500/5 p-3 text-xs">
            <p className="font-medium text-red-600 dark:text-red-400">Failed to load outreach</p>
            <p className="text-muted-foreground">{emailError}</p>
          </div>
        ) : byCampaign.size === 0 ? (
          <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
            No campaigns with outreach yet. Campaigns are created under Campaigns; OutreachEmail rows group by <span className="font-mono">campaignId</span> once queued via Approval Queue.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border bg-card">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/20 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-3 py-2">Campaign</th>
                  <th className="px-3 py-2">CampaignId</th>
                  <th className="px-3 py-2">Total</th>
                  <th className="px-3 py-2">Sent</th>
                  <th className="px-3 py-2">Failed</th>
                  <th className="px-3 py-2">Rate</th>
                  <th className="px-3 py-2">Inspect</th>
                </tr>
              </thead>
              <tbody>
                {Array.from(byCampaign.entries()).map(([cid, v]) => {
                  const rate = v.count > 0 ? Math.round((v.sent / v.count) * 100) : 0;
                  const label = cid === "__no_campaign__" ? "(no campaign)" : (v.campaignName ?? cid.slice(0, 12) + ".");
                  return (
                    <tr key={cid} className="border-b last:border-0 hover:bg-accent/40">
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

      {/* Delivery State Inspection */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">Delivery State — Inspect (submitted / approved / sent / failed + sendError)</h2>
        <p className="text-xs text-muted-foreground">Real statuses from <span className="font-mono">OutreachEmail.status</span> and <span className="font-mono">OutreachOrder.deliveryStatus / sendError</span>. No fake telemetry; failed rows surface <span className="font-mono">error / sendError</span> verbatim.</p>

        <div className="grid gap-3 sm:grid-cols-4">
          {[
            { key: "submitted", label: "Submitted" },
            { key: "approved", label: "Approved" },
            { key: "sent", label: "Sent" },
            { key: "failed", label: "Failed" },
          ].map((s) => {
            const count = byStatus.get(s.key) ?? 0;
            const orderCount = orderByStatus.get(s.key) ?? 0;
            return (
              <div key={s.key} className="rounded-lg border bg-card p-3 text-center">
                <StatusPill state={pillForStatus(s.key)} />
                <p className="mt-1.5 text-xl font-semibold tabular-nums">{count}</p>
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{s.label} (OutreachEmail)</p>
                {orderCount > 0 ? <p className="text-[11px] text-muted-foreground">Orders: {orderCount}</p> : null}
              </div>
            );
          })}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg border bg-card">
            <div className="border-b p-3">
              <h3 className="text-xs font-semibold uppercase tracking-wide">OutreachEmail — by status</h3>
              <p className="text-[11px] text-muted-foreground">{emails.length} total · tenant-scoped via withTenantContext</p>
            </div>
            {emails.length === 0 ? (
              <p className="p-6 text-center text-xs text-muted-foreground">No OutreachEmail rows.</p>
            ) : (
              <div className="max-h-[320px] overflow-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b text-left uppercase tracking-wide text-muted-foreground">
                      <th className="px-3 py-2">Business</th>
                      <th className="px-3 py-2">Status</th>
                      <th className="px-3 py-2">sendError / error</th>
                    </tr>
                  </thead>
                  <tbody>
                    {emails.slice(0, 20).map((e) => (
                      <tr key={e.id} className="border-b last:border-0 hover:bg-accent/30">
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
                            <span className="block break-words text-[11px] text-red-500" title={String(e.error)}>
                              {String(e.error).slice(0, 120)}
                            </span>
                          ) : e.sendError ? (
                            <span className="block break-words text-[11px] text-red-500" title={String((e as any).sendError)}>
                              {String((e as any).sendError).slice(0, 120)}
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

          <div className="rounded-lg border bg-card">
            <div className="border-b p-3">
              <h3 className="text-xs font-semibold uppercase tracking-wide">OutreachOrder — deliveryState</h3>
              <p className="text-[11px] text-muted-foreground">{outreachOrders.length} total · includes sendError, deliveryStatus, replyStatus</p>
            </div>
            {outreachOrders.length === 0 ? (
              <p className="p-6 text-center text-xs text-muted-foreground">No OutreachOrder rows yet — orders are created via pipeline enrichment/qualification.</p>
            ) : (
              <div className="max-h-[320px] overflow-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b text-left uppercase tracking-wide text-muted-foreground">
                      <th className="px-3 py-2">Business</th>
                      <th className="px-3 py-2">Status</th>
                      <th className="px-3 py-2">deliveryStatus / sendError</th>
                    </tr>
                  </thead>
                  <tbody>
                    {outreachOrders.slice(0, 20).map((o) => (
                      <tr key={o.id} className="border-b last:border-0 hover:bg-accent/30">
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
                            <span className="block break-words text-[11px] text-red-500" title={String(o.sendError)}>
                              {String(o.sendError).slice(0, 120)}
                            </span>
                          ) : null}
                          {o.replyStatus ? <span className="block text-[11px] text-muted-foreground">reply: {String(o.replyStatus)}</span> : null}
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
          <div className="rounded-md border border-red-500/30 bg-red-500/5 p-3">
            <p className="text-xs font-medium text-red-600 dark:text-red-400">Failed deliveries — inspect sendError</p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-[11px]">
              {failedEmails.slice(0, 5).map((e) => (
                <li key={`fe-${e.id}`} className="break-words">
                  <span className="font-medium">{e.business}</span> ({e.email}) — error: {String(e.error ?? (e as any).sendError ?? "unknown").slice(0, 120)}
                </li>
              ))}
              {failedOrders.slice(0, 5).map((o) => (
                <li key={`fo-${o.id}`} className="break-words">
                  <span className="font-medium">{o.businessName ?? o.business}</span> ({o.email}) — sendError: {String(o.sendError ?? "-").slice(0, 120)} deliveryStatus={String(o.deliveryStatus ?? "-")}
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">No failures to inspect — healthy queue.</p>
        )}

        <p className="text-[11px] text-muted-foreground">
          Note: &quot;approved&quot; means the decision reached the decide endpoint; &quot;sent&quot; is set only when dispatch via Email Outbox / Brevo is confirmed. Bounce/reply telemetry is shown via OutreachOrder.replyStatus when available; otherwise delivery/bounce is not fabricated.
        </p>
      </section>

      <div className="flex gap-2">
        <Link href="/acquisition/outreach" className="rounded-md border px-3 py-1.5 text-xs hover:bg-accent">
          View Outreach Pipeline
        </Link>
        <Link href="/acquisition/campaigns" className="rounded-md border px-3 py-1.5 text-xs hover:bg-accent">
          View Campaigns
        </Link>
        <Link href="/acquisition/integrations" className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90">
          Integrations Health
        </Link>
      </div>
    </div>
  );
}
