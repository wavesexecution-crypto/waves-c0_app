import type { Metadata } from "next";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { requireTenantId } from "@/lib/tenant";
import { withTenantContext } from "@wavesco/db";
import { DecideButtons } from "@/components/acquisition/submit-panel";
import { StatusPill } from "@/components/command/primitives";
import { outreachStatusLabel } from "@/lib/wavesco/lead-labels";
import { AutoRefresh } from "@/components/command/auto-refresh";
import { formatIST } from "@/lib/wavesco/time";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Outreach" };

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

  // Stuck orders: queued/approved long ago with no provider confirmation.
  // The scheduler heals these every 15 min; this box makes them visible now.
  const STUCK_MS = 2 * 60 * 60 * 1000;
  const nowTs = Date.now();
  const stuckOrders = orders.filter((o) => {
    const st = String(o.status ?? "").toUpperCase();
    if (st !== "PENDING" && st !== "APPROVED") return false;
    if (String(o.deliveryStatus ?? "") !== "" && String(o.deliveryStatus) !== "pending_reconciliation") return false;
    const ts = o.submittedAt ?? o.decidedAt ?? o.createdAt;
    const t = ts ? new Date(ts).getTime() : NaN;
    return Number.isFinite(t) && nowTs - t > STUCK_MS;
  });

  // Preview example
  const sampleVars = { business: "Acme Corp", city: "Pune", email: "acme@example.com" };
  const sampleTemplate = templates[0] ?? { subject: "Hello {{business}} — quick intro", body: "Hi {{business}} in {{city}},\n\nWe help businesses in {{city}} bring in more customers. Reply to {{email}}?\n\n— WavesCo" };
  const preview = renderPreview(String(sampleTemplate.subject), String(sampleTemplate.body), sampleVars);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Outreach</h1>
          <p className="text-sm text-muted-foreground">
            Every message waits for your approval before it sends. Approve or reject here — approved messages go out automatically.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <AutoRefresh intervalMs={10_000} />
          <Link href="/acquisition/email" className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90">
            Email Control
          </Link>
          <Link href="/acquisition/campaigns" className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent">
            Campaigns
          </Link>
        </div>
      </div>

      {/* Outreach status */}
      <section className="rounded-lg border bg-card p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Outreach status</h2>
          <span className="text-xs text-muted-foreground">{emails.length} messages · {orders.length} deliveries</span>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">Where every message stands — from your review to delivery.</p>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {PIPELINE.slice(0, 4).map((s) => (
            <div key={`email-${s}`} className="rounded-lg border bg-muted/20 p-3 text-center">
              <StatusPill state={s === "submitted" ? "queued" : s === "sent" ? "connected" : s === "failed" ? "failed" : s} />
              <p className="mt-1.5 text-xl font-semibold tabular-nums">{counts[s as keyof typeof counts] ?? 0}</p>
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{outreachStatusLabel(s)}</p>
            </div>
          ))}
        </div>
        {orders.length > 0 ? (
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {["submitted", "approved", "sent", "failed"].map((s) => {
              const c = orderByStatus.get(s) ?? 0;
              return (
                <div key={`order-${s}`} className="rounded-lg border border-dashed p-2 text-center">
                  <p className="text-sm font-semibold tabular-nums">{c}</p>
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{outreachStatusLabel(s)}</p>
                </div>
              );
            })}
          </div>
        ) : null}
        {(failedEmails.length > 0 || failedOrders.length > 0) ? (
          <div className="mt-3 rounded-md border border-red-500/30 bg-red-500/5 p-3">
            <p className="text-xs font-medium text-red-600 dark:text-red-400">Needs attention — these messages couldn&apos;t be sent</p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-[11px]">
              {failedEmails.slice(0, 5).map((e) => (
                <li key={e.id} className="break-words">
                  <span className="font-medium">{e.business}</span> ({e.email}) — sending failed, will retry automatically
                </li>
              ))}
              {failedOrders.slice(0, 5).map((o) => (
                <li key={`o-${o.id}`} className="break-words">
                  <span className="font-medium">{(o as any).businessName ?? o.business}</span> ({o.email}) — {outreachStatusLabel(String(o.deliveryStatus ?? o.status ?? "failed"))}
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="mt-3 text-xs text-muted-foreground">No failures — your queue is healthy.</p>
        )}
        {stuckOrders.length > 0 && (
          <div className="mt-3 rounded-md border border-amber-500/40 bg-amber-500/5 p-3">
            <p className="text-xs font-medium text-amber-700">Needs attention — {stuckOrders.length} {stuckOrders.length === 1 ? "message has" : "messages have"} been waiting unusually long</p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-[11px]">
              {stuckOrders.slice(0, 5).map((o) => (
                <li key={`stuck-${o.id}`} className="break-words">
                  <span className="font-medium">{(o as any).businessName ?? o.business}</span> ({o.email}) — {outreachStatusLabel(String(o.status))} since{" "}
                  {o.submittedAt ?? o.decidedAt ?? o.createdAt ? new Date(o.submittedAt ?? o.decidedAt ?? o.createdAt).toLocaleString() : "unknown"}
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[11px] text-muted-foreground">
              These retry automatically. To force it now: Pipeline → Sync delivery &amp; replies.
            </p>
          </div>
        )}
      </section>

      {/* Templates */}
      <section className="rounded-lg border bg-card p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Message templates</h2>
          <div className="flex items-center gap-2">
            <StatusPill state={templatesStatus === "ok" ? "connected" : "disconnected"} />
            <span className="text-xs uppercase tracking-wide text-muted-foreground">{templates.length} templates</span>
            <Link href="/acquisition/email" className="rounded-md border px-2.5 py-1 text-xs hover:bg-accent">
              Manage templates
            </Link>
          </div>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">Reusable messages with {"{{business}}"} and {"{{city}}"} personalization. Preview renders without sending.</p>
        {templates.length === 0 ? (
          <div className="mt-3 rounded-md border border-dashed p-4 text-center text-xs text-muted-foreground">
            No templates yet — create one to speed up your outreach.
            <div className="mt-2">
              <Link href="/acquisition/email" className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90">
                Create your first template
              </Link>
            </div>
          </div>
        ) : (
          <div className="mt-3 overflow-x-auto rounded-md border">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b bg-muted/20 text-left uppercase tracking-wide text-muted-foreground">
                  <th className="px-3 py-2">Template</th>
                  <th className="px-3 py-2">Subject</th>
                  <th className="px-3 py-2">Created</th>
                </tr>
              </thead>
              <tbody>
                {templates.slice(0, 5).map((t) => (
                  <tr key={t.id} className="border-b last:border-0 hover:bg-accent/40">
                    <td className="px-3 py-2 font-mono text-[11px]">{String(t.id).slice(0, 14)}…</td>
                    <td className="max-w-[260px] truncate px-3 py-2" title={String(t.subject)}>{String(t.subject)}</td>
                    <td className="px-3 py-2 text-muted-foreground">{t.createdAt ? new Date(String(t.createdAt)).toLocaleString() : "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Preview */}
      <section className="rounded-lg border bg-card p-4">
        <h2 className="text-sm font-semibold">Preview before you send</h2>
        <p className="mt-1 text-xs text-muted-foreground">See exactly what a prospect receives — previews never send anything.</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div className="rounded-md border bg-muted/20 p-3">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Template (raw)</p>
            <p className="mt-1 font-mono text-xs">Subject: {String(sampleTemplate.subject)}</p>
            <pre className="mt-2 whitespace-pre-wrap break-words rounded bg-card p-2 text-xs">{String(sampleTemplate.body)}</pre>
            <p className="mt-2 text-[11px] text-muted-foreground">Vars: business={sampleVars.business}, city={sampleVars.city}</p>
          </div>
          <div className="rounded-md border bg-emerald-500/5 p-3">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Rendered — no send</p>
            <p className="mt-1 text-sm font-medium">Subject: {preview.subject}</p>
            <pre className="mt-2 whitespace-pre-wrap break-words rounded bg-card p-2 text-xs">{preview.body}</pre>
            <p className="mt-2 text-[11px] text-muted-foreground">Try live preview in Email Control → Templates → Preview (no send).</p>
            <Link href="/acquisition/email" className="mt-2 inline-block rounded-md border px-2.5 py-1 text-xs hover:bg-accent">
              Open Email Control
            </Link>
          </div>
        </div>
      </section>

      {emails.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          <p className="font-medium text-foreground">No outreach yet</p>
          <p className="mt-1">Build a campaign and approve your first messages to start conversations.</p>
          <Link href="/acquisition/campaigns" className="mt-4 inline-block rounded-md bg-primary px-4 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90">
            Go to campaigns
          </Link>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            {PIPELINE.map((s) => (
              <div key={s} className="rounded-lg border bg-card p-3 text-center">
                <StatusPill state={s === "submitted" ? "queued" : s} />
                <p className="mt-1.5 text-xl font-semibold tabular-nums">{counts[s]}</p>
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{outreachStatusLabel(s)}</p>
              </div>
            ))}
          </div>

          <div className="overflow-x-auto rounded-lg border bg-card">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-2.5">Business / recipient</th>
                  <th className="px-4 py-2.5">Subject</th>
                  <th className="px-4 py-2.5">Status</th>
                  <th className="px-4 py-2.5">Approval</th>
                  <th className="px-4 py-2.5">Timeline</th>
                  <th className="px-4 py-2.5 text-right">Decision</th>
                </tr>
              </thead>
              <tbody>
                {emails.map((e) => (
                  <tr key={e.id} className="border-b last:border-0 align-top hover:bg-accent/40">
                    <td className="px-4 py-2.5">
                      <span className="font-medium">{e.business}</span>
                      <span className="block font-mono text-[11px] text-muted-foreground">{e.email}</span>
                      {e.campaignId ? <span className="block font-mono text-[10px] text-muted-foreground">campaign: {String(e.campaignId).slice(0, 12)}…</span> : null}
                    </td>
                    <td className="max-w-[220px] truncate px-4 py-2.5 text-xs">{e.subject}</td>
                    <td className="px-4 py-2.5">
                      <StatusPill state={e.status} />
                      <span className="mt-1 block text-[11px] text-muted-foreground">{outreachStatusLabel(String(e.status))}</span>
                      {e.error || (e as any).sendError ? <span className="mt-1 block max-w-[200px] break-words text-[11px] text-red-500">Sending failed — retrying automatically</span> : null}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground">{e.decidedAt ? "Reviewed" : "Waiting for review"}</td>
                    <td className="px-4 py-2.5 text-[11px] leading-relaxed text-muted-foreground">
                      submitted {formatIST(e.submittedAt)}
                      <br />
                      decided {formatIST(e.decidedAt)}
                      <br />
                      sent {formatIST(e.sentAt)}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      {!e.decidedAt && e.status !== "failed" ? (
                        <DecideButtons outreachEmailId={e.id} />
                      ) : (
                        <span className="text-[11px] text-muted-foreground">-</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="text-[11px] text-muted-foreground">
            Approved means you reviewed it. Sent means it left your outbox.
          </p>
        </>
      )}
    </div>
  );
}
