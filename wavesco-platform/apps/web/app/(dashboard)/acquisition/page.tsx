import type { Metadata } from "next";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { requireTenantId } from "@/lib/tenant";
import { withTenantContext } from "@wavesco/db";
import { getFacets, getLeadStats, getLastEngineRun } from "@/lib/wavesco/lead-engine";
import { MetricCard, SectionHeader, StatusPill } from "@/components/command/primitives";
import { formatIST, relativeFrom } from "@/lib/wavesco/time";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Acquisition OS" };

export default async function AcquisitionPage() {
  const session = await auth();
  const tenantId = requireTenantId(session);

  let statsError: string | null = null;
  let stats: Awaited<ReturnType<typeof getLeadStats>> | null = null;
  let facets: Awaited<ReturnType<typeof getFacets>> | null = null;
  try {
    stats = await getLeadStats();
    facets = await getFacets();
  } catch (e) {
    statsError = e instanceof Error ? e.message : "Lead Engine unreachable";
  }

  const counts = await withTenantContext(tenantId, async (tx) => ({
    campaigns: await tx.campaign.count({ where: { tenantId } }),
    queuedEmails: await tx.outreachEmail.count({
      where: { tenantId, status: { in: ["submitted", "approved"] } },
    }),
    sentEmails: await tx.outreachEmail.count({ where: { tenantId, status: "sent" } }),
    failedEmails: await tx.outreachEmail.count({ where: { tenantId, status: "failed" } }),
    followUpsPending: await tx.followUp.count({ where: { tenantId, status: "pending" } }),
  }));

  const engineRun = stats ? await safeRun() : null;
  async function safeRun() {
    try {
      return await getLastEngineRun();
    } catch {
      return null;
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Acquisition OS</h1>
        <p className="text-sm text-muted-foreground">
          Control layer over the existing Lead Engine, Approval Queue / Email Outbox and Notify Hub.
        </p>
      </div>

      <section className="space-y-3">
        <SectionHeader
          title="Corpus"
          subtitle={statsError ?? `Last researched ${relativeFrom(stats?.lastResearchedAt)}`}
          right={<StatusPill state={statsError ? "error" : "live"} />}
        />
        {stats && facets ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard label="Total Leads" value={stats.total} detail={`${facets.categories.length} categories · ${facets.cities.length} cities`} href="/acquisition/leads" />
            <MetricCard label="Email Ready" value={stats.emailReady} href="/acquisition/campaigns" />
            <MetricCard label="Contacted" value={stats.contacted} href="/acquisition/outreach" />
            <MetricCard label="Replies" value={stats.replies} href="/acquisition/outreach" />
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-red-500/40 p-6 text-sm">
            <p className="font-medium">Lead Engine unavailable</p>
            <p className="text-muted-foreground">{statsError}</p>
            <p className="mt-1 text-xs text-muted-foreground">The lead database is temporarily unavailable. Metrics will return automatically.</p>
          </div>
        )}
      </section>

      <section className="space-y-3">
        <SectionHeader title="Platform state" subtitle="PostgreSQL (tenant-scoped)" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <MetricCard label="Campaigns" value={counts.campaigns} href="/acquisition/campaigns" />
          <MetricCard label="Queued emails" value={counts.queuedEmails} href="/acquisition/outreach" />
          <MetricCard label="Sent" value={counts.sentEmails} href="/acquisition/outreach" />
          <MetricCard label="Failed" value={counts.failedEmails} href="/acquisition/outreach" />
          <MetricCard label="Follow-ups pending" value={counts.followUpsPending} href="/acquisition/follow-ups" />
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { href: "/acquisition/generate", title: "Generate Leads", desc: "Run the existing Lead Engine pipeline." },
          { href: "/acquisition/leads", title: "Leads", desc: "Search the real corpus with filters and profiles." },
          { href: "/acquisition/campaigns", title: "Campaigns", desc: "Exact eligibility preview before any send." },
          { href: "/acquisition/reports", title: "Reports", desc: "Real PDF/XLSX batches + Telegram delivery." },
        ].map((c) => (
          <Link key={c.href} href={c.href} className="rounded-lg border bg-card p-4 transition-colors hover:border-primary/40">
            <p className="text-sm font-medium">{c.title}</p>
            <p className="mt-1 text-xs text-muted-foreground">{c.desc}</p>
          </Link>
        ))}
      </section>

      {engineRun ? (
        <p className="text-[11px] text-muted-foreground">
          Engine last run: {formatIST(engineRun.started_at)} → {formatIST(engineRun.finished_at)} · added{" "}
          {engineRun.added ?? 0} · Telegram {engineRun.telegram_status ?? "—"}
        </p>
      ) : null}
    </div>
  );
}
