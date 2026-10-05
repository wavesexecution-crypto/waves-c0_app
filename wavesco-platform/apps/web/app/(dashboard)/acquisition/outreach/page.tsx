import type { Metadata } from "next";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { requireTenantId } from "@/lib/tenant";
import { withTenantContext } from "@wavesco/db";
import { DecideButtons } from "@/components/acquisition/submit-panel";
import { StatusPill } from "@/components/command/primitives";
import { AutoRefresh } from "@/components/command/auto-refresh";
import { formatIST } from "@/lib/wavesco/time";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Cold Email" };

const PIPELINE = ["submitted", "approved", "sent", "rejected", "failed"] as const;

function renderPreview(subject: string, body: string, vars: Record<string, string>) {
  const render = (s: string) => s.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k: string) => vars[k] ?? `{{${k}}}`);
  return { subject: render(subject), body: render(body) };
}

export default async function OutreachPage() {
  const session = await auth();
  const tenantId = requireTenantId(session);

  const emails = await withTenantContext(tenantId, async (tx) =>
    tx.outreachEmail.findMany({
      where: { tenantId },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
  );

  // Also fetch OutreachOrder for deliveryState inspection
  let orders: any[] = [];
  try {
    orders = await withTenantContext(tenantId, async (tx: any) => {
      if (tx.outreachOrder && typeof tx.outreachOrder.findMany === "function") {
        return await tx.outreachOrder.findMany({ where: { tenantId }, orderBy: { createdAt: "desc" }, take: 50 });
      }
      return [];
    });
  } catch {
    orders = [];
  }

  // Templates for management section
  let templates: any[] = [];
  let templatesStatus: string = "not_configured";
  try {
    const res: any = await withTenantContext(tenantId, async (tx: any) => {
      if (tx.emailTemplate && typeof tx.emailTemplate.findMany === "function") {
        try {
          const rows = await tx.emailTemplate.findMany({ where: { tenantId }, orderBy: { createdAt: "desc" }, take: 10 });
          return { rows, status: "ok" };
        } catch {}
      }
      if (tx.activityEvent && typeof tx.activityEvent.findMany === "function") {
        try {
          const evs = await tx.activityEvent.findMany({ where: { tenantId, type: "email_template" }, orderBy: { createdAt: "desc" }, take: 10 });
          if (Array.isArray(evs) && evs.length > 0) {
            return {
              rows: evs.map((e: any) => ({ id: e.id, subject: e.title ?? (e.metadata as any)?.subject ?? "", body: (e.metadata as any)?.body ?? "", createdAt: e.createdAt })),
              status: "ok",
            };
          }
        } catch {}
      }
      return { rows: [], status: "not_configured" };
    });
    templates = res.rows ?? [];
    templatesStatus = res.status ?? "not_configured";
  } catch {
    templates = [];
    templatesStatus = "not_configured";
  }

  const counts = Object.fromEntries(
    PIPELINE.map((s) => [s, emails.filter((e) => e.status === s).length]),
  ) as Record<(typeof PIPELINE)[number], number>;

  const orderByStatus = new Map<string, number>();
  for (const o of orders) {
    const s = String(o.deliveryStatus ?? o.status ?? "unknown").toLowerCase();
    orderByStatus.set(s, (orderByStatus.get(s) ?? 0) + 1);
  }
  const failedEmails = emails.filter((e) => String(e.status).toLowerCase() === "failed");
  const failedOrders = orders.filter((o) => String(o.deliveryStatus ?? "").toLowerCase() === "failed" || String(o.sendError ?? "").length > 0);

  // Preview example
  const sampleVars = { business: "Acme Corp", city: "Pune", email: "acme@example.com" };
  const sampleTemplate = templates[0] ?? { subject: "Hello {{business}} — quick intro", body: "Hi {{business}} in {{city}},\n\nWe help businesses in {{city}} bring in more customers. Reply to {{email}}?\n\n— WavesCo" };
  const preview = renderPreview(String(sampleTemplate.subject), String(sampleTemplate.body), sampleVars);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-[22px] font-semibold tracking-[-0.02em] text-foreground">Cold Email</h1>
          <p className="mt-1 max-w-3xl font-sans text-[13px] leading-5 text-muted-foreground">
            Pipeline over the existing production path: Approval Queue → Email Outbox → SMTP. Approve or reject here or via Telegram — both reach the same delivery pipeline. Delivery state is tenant-scoped and audit-logged.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <AutoRefresh intervalMs={10_000} />
          <Link href="/acquisition/email" className="rounded-lg bg-primary px-3 py-1.5 font-sans text-[13px] font-medium text-primary-foreground hover:bg-primary/90">
            Email Control
          </Link>
          <Link href="/acquisition/campaigns" className="rounded-lg border border-border/80 bg-card px-3 py-1.5 font-sans text-[13px] text-foreground hover:bg-muted/50">
            Campaigns
          </Link>
        </div>
      </div>

      {/* Delivery State Inspection */}
      <section className="rounded-lg border border-border/80 bg-card p-4">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-[13px] font-semibold uppercase tracking-[0.08em] text-foreground">Delivery State — Inspection</h2>
          <span className="font-mono text-[11px] tracking-[0.02em] text-muted-foreground">{emails.length} OutreachEmail · {orders.length} OutreachOrder</span>
        </div>
        <p className="mt-1 font-mono text-[11px] tracking-[0.02em] text-muted-foreground">Real statuses: submitted / approved / sent / failed plus <span className="font-mono">sendError</span> / <span className="font-mono">error</span> verbatim. No fake telemetry.</p>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {PIPELINE.slice(0, 4).map((s) => (
            <div key={`email-${s}`} className="rounded-lg border border-border/80 bg-muted/20 p-3 text-center">
              <StatusPill state={s === "submitted" ? "queued" : s === "sent" ? "connected" : s === "failed" ? "failed" : s} />
              <p className="mt-1.5 font-mono text-[20px] font-medium tabular-nums tracking-[-0.02em] text-foreground">{counts[s as keyof typeof counts] ?? 0}</p>
              <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground">{s} (email)</p>
            </div>
          ))}
        </div>
        {orders.length > 0 ? (
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {["submitted", "approved", "sent", "failed"].map((s) => {
              const c = orderByStatus.get(s) ?? 0;
              return (
                <div key={`order-${s}`} className="rounded-lg border border-dashed border-border/80 p-2 text-center">
                  <p className="font-mono text-[13px] font-semibold tabular-nums tracking-[-0.02em] text-foreground">{c}</p>
                  <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground">{s} (order deliveryStatus)</p>
                </div>
              );
            })}
          </div>
        ) : null}
        {(failedEmails.length > 0 || failedOrders.length > 0) ? (
          <div className="mt-3 rounded-lg border border-red-500/20 bg-red-500/5 p-3">
            <p className="font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-red-600 dark:text-red-400">Failed — inspect sendError</p>
            <ul className="mt-2 list-disc space-y-1 pl-5 font-mono text-[11px] tracking-[0.02em] text-muted-foreground">
              {failedEmails.slice(0, 5).map((e) => (
                <li key={e.id} className="break-words">
                  <span className="font-medium text-foreground">{e.business}</span> ({e.email}) — error: {String(e.error ?? (e as any).sendError ?? "unknown").slice(0, 140)}
                </li>
              ))}
              {failedOrders.slice(0, 5).map((o) => (
                <li key={`o-${o.id}`} className="break-words">
                  <span className="font-medium text-foreground">{(o as any).businessName ?? o.business}</span> ({o.email}) — sendError: {String(o.sendError ?? "-").slice(0, 140)} deliveryStatus={String(o.deliveryStatus ?? "-")}
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="mt-3 font-mono text-[11px] tracking-[0.02em] text-muted-foreground">No failures to inspect — healthy queue. Timeline per email shows submitted / decided / sent via <code className="rounded bg-muted px-1 font-mono">formatIST</code>.</p>
        )}
      </section>

      {/* Templates Management */}
      <section className="rounded-lg border border-border/80 bg-card p-4">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-[13px] font-semibold uppercase tracking-[0.08em] text-foreground">Templates — Manage</h2>
          <div className="flex items-center gap-2">
            <StatusPill state={templatesStatus === "ok" ? "connected" : "disconnected"} />
            <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground">{templatesStatus} · {templates.length} templates</span>
            <Link href="/acquisition/email" className="rounded-lg border border-border/80 px-2.5 py-1 font-sans text-[13px] text-foreground hover:bg-muted/50">
              Manage in Email Control
            </Link>
          </div>
        </div>
        <p className="mt-1 font-mono text-[11px] tracking-[0.02em] text-muted-foreground">Tenant-scoped via <code className="rounded bg-muted px-1 font-mono">withTenantContext</code> + RLS. CRUD via <code className="rounded bg-muted px-1 font-mono">POST /api/acquisition/email/templates</code> with <code className="rounded bg-muted px-1 font-mono">auditControl(action=email.template.*)</code>. Preview renders without sending.</p>
        {templates.length === 0 ? (
          <div className="mt-3 rounded-lg border border-dashed border-border/80 p-4 text-center">
            <p className="font-sans text-[13px] text-muted-foreground">
              No templates yet — create one in Email Control. Supports <code className="rounded bg-muted px-1 font-mono">{"{{business}}"}</code> <code className="rounded bg-muted px-1 font-mono">{"{{city}}"}</code> vars. API returns <span className="font-mono tabular-nums">not_configured</span> when EmailTemplate table missing, with empty array (never 500).
            </p>
            <div className="mt-2">
              <Link href="/acquisition/email" className="rounded-lg bg-primary px-3 py-1.5 font-sans text-[13px] font-medium text-primary-foreground hover:bg-primary/90">
                Create First Template
              </Link>
            </div>
          </div>
        ) : (
          <div className="mt-3 overflow-x-auto rounded-lg border border-border/80">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border/60 bg-muted/20 text-left font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
                  <th className="px-3 py-2 font-medium">Template</th>
                  <th className="px-3 py-2 font-medium">Subject</th>
                  <th className="px-3 py-2 font-medium">Created</th>
                </tr>
              </thead>
              <tbody>
                {templates.slice(0, 5).map((t) => (
                  <tr key={t.id} className="border-b border-border/60 last:border-0 hover:bg-muted/20">
                    <td className="px-3 py-2 font-mono text-[11px] tracking-[0.02em] text-muted-foreground">{String(t.id).slice(0, 14)}…</td>
                    <td className="max-w-[260px] truncate px-3 py-2 font-sans text-[13px] text-foreground" title={String(t.subject)}>{String(t.subject)}</td>
                    <td className="px-3 py-2 font-mono text-[11px] tracking-[0.02em] text-muted-foreground">{t.createdAt ? new Date(String(t.createdAt)).toLocaleString() : "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Preview */}
      <section className="rounded-lg border border-border/80 bg-card p-4">
        <h2 className="font-display text-[13px] font-semibold uppercase tracking-[0.08em] text-foreground">Preview — Render without sending</h2>
        <p className="mt-1 font-mono text-[11px] tracking-[0.02em] text-muted-foreground">Preview calls <code className="rounded bg-muted px-1 font-mono">POST /api/acquisition/email/templates</code> with <span className="font-mono">{"{ action: \"preview\", template: { subject, body }, vars: { business, city } }"}</span> — pure server-side render, audit-logged as <span className="font-mono">email.template.preview</span>, never hits Brevo/SMTP.</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg border border-border/80 bg-muted/20 p-3">
            <p className="font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">Template (raw)</p>
            <p className="mt-1 font-mono text-[11px] tracking-[0.02em] text-foreground">Subject: {String(sampleTemplate.subject)}</p>
            <pre className="mt-2 whitespace-pre-wrap break-words rounded-lg border border-border/80 bg-card p-2 font-mono text-[11px] leading-5 tracking-[0.02em] text-foreground">{String(sampleTemplate.body)}</pre>
            <p className="mt-2 font-mono text-[11px] tracking-[0.02em] text-muted-foreground">Vars: business={sampleVars.business}, city={sampleVars.city}</p>
          </div>
          <div className="rounded-lg border border-border/80 bg-emerald-500/5 p-3">
            <p className="font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">Rendered — no send</p>
            <p className="mt-1 font-sans text-[13px] font-medium text-foreground">Subject: {preview.subject}</p>
            <pre className="mt-2 whitespace-pre-wrap break-words rounded-lg border border-border/80 bg-card p-2 font-mono text-[11px] leading-5 tracking-[0.02em] text-foreground">{preview.body}</pre>
            <p className="mt-2 font-mono text-[11px] tracking-[0.02em] text-muted-foreground">Try live preview in Email Control → Templates → Preview (no send).</p>
            <Link href="/acquisition/email" className="mt-2 inline-flex rounded-lg border border-border/80 px-2.5 py-1 font-sans text-[13px] text-foreground hover:bg-muted/50">
              Open Email Control
            </Link>
          </div>
        </div>
      </section>

      {emails.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border/80 bg-card p-8 text-center">
          <p className="font-sans text-[13px] text-muted-foreground">No cold email activity yet. Queue a campaign under Campaigns; statuses will track real submission, approval and dispatch events.</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            {PIPELINE.map((s) => (
              <div key={s} className="rounded-lg border border-border/80 bg-card p-3 text-center">
                <StatusPill state={s === "submitted" ? "queued" : s} />
                <p className="mt-1.5 font-mono text-[20px] font-medium tabular-nums tracking-[-0.02em] text-foreground">{counts[s]}</p>
                <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground">{s}</p>
              </div>
            ))}
          </div>

          <div className="overflow-x-auto rounded-lg border border-border/80 bg-card">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border/60 text-left font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
                  <th className="px-4 py-2.5 font-medium">Business / recipient</th>
                  <th className="px-4 py-2.5 font-medium">Subject</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                  <th className="px-4 py-2.5 font-medium">Approval</th>
                  <th className="px-4 py-2.5 font-medium">Timeline</th>
                  <th className="px-4 py-2.5 text-right font-medium">Decision</th>
                </tr>
              </thead>
              <tbody>
                {emails.map((e) => (
                  <tr key={e.id} className="border-b border-border/60 last:border-0 align-top hover:bg-muted/20">
                    <td className="px-4 py-2.5">
                      <span className="font-sans text-[13px] font-medium text-foreground">{e.business}</span>
                      <span className="block font-mono text-[11px] tracking-[0.02em] text-muted-foreground">{e.email}</span>
                      {e.campaignId ? <span className="block font-mono text-[11px] tracking-[0.02em] text-muted-foreground">campaign: {String(e.campaignId).slice(0, 12)}…</span> : null}
                    </td>
                    <td className="max-w-[220px] truncate px-4 py-2.5 font-sans text-[13px] text-foreground">{e.subject}</td>
                    <td className="px-4 py-2.5">
                      <StatusPill state={e.status} />
                      {e.error ? <span className="mt-1 block max-w-[200px] break-words font-mono text-[11px] tracking-[0.02em] text-red-500">{e.error}</span> : null}
                      {(e as any).sendError ? <span className="mt-1 block max-w-[200px] break-words font-mono text-[11px] tracking-[0.02em] text-red-500">sendError: {String((e as any).sendError).slice(0, 120)}</span> : null}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-[11px] tracking-[0.02em] text-muted-foreground">{e.approvalId ?? "-"}</td>
                    <td className="px-4 py-2.5 font-mono text-[11px] leading-relaxed tracking-[0.02em] text-muted-foreground">
                      submitted {formatIST(e.submittedAt)}
                      <br />
                      decided {formatIST(e.decidedAt)}
                      <br />
                      sent {formatIST(e.sentAt)}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      {!e.decidedAt && e.status !== "failed" ? (
                        <DecideButtons outreachEmailId={e.id} recipient={e.email} subject={e.subject} />
                      ) : (
                        <span className="font-mono text-[11px] tracking-[0.02em] text-muted-foreground">-</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="font-mono text-[11px] leading-relaxed tracking-[0.02em] text-muted-foreground">
            Note: &quot;approved&quot; means the decision reached the existing decide endpoint; &quot;sent&quot; is set only when that response confirms dispatch through Email Outbox. Delivery/bounce/reply telemetry does not exist upstream yet and is therefore never shown here — see Email Control for deliveryState + sendError when OutreachOrder is present.
          </p>
        </>
      )}
    </div>
  );
}
