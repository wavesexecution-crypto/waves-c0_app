import type { Metadata } from "next";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { requireTenantId } from "@/lib/tenant";
import { withTenantContext } from "@wavesco/db";
import { getFacets, getLeadStats, getLastEngineRun } from "@/lib/wavesco/lead-engine";
import { MetricCard, SectionHeader, StatusPill } from "@/components/command/primitives";
import { AutoRefresh } from "@/components/command/auto-refresh";
import { formatIST, relativeFrom } from "@/lib/wavesco/time";
import { OverviewLive } from "@/components/acquisition/overview-live";
import { safeErrorText } from "@/lib/utils";

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
    statsError = safeErrorText(
      e,
      "The lead database is temporarily unavailable. Metrics will return automatically.",
      "acquisition:corpus"
    );
  }

  // Platform counts must never take the whole dashboard down.
  let counts = { campaigns: 0, queuedEmails: 0, sentEmails: 0, failedEmails: 0, followUpsPending: 0 };
  let countsError: string | null = null;
  try {
    counts = await withTenantContext(tenantId, async (tx) => ({
      campaigns: await tx.campaign.count({ where: { tenantId } }),
      queuedEmails: await tx.outreachEmail.count({
        where: { tenantId, status: { in: ["submitted", "approved"] } },
      }),
      sentEmails: await tx.outreachEmail.count({ where: { tenantId, status: "sent" } }),
      failedEmails: await tx.outreachEmail.count({ where: { tenantId, status: "failed" } }),
      followUpsPending: await tx.followUp.count({ where: { tenantId, status: "pending" } }),
    }));
  } catch (e) {
    countsError = safeErrorText(e, "Platform counters are temporarily unavailable.", "acquisition:counts");
  }

  const engineRun = stats ? await safeRun() : null;
  async function safeRun() {
    try {
      return await getLastEngineRun();
    } catch {
      return null;
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
            Acquisition
          </p>
          <h1 className="mt-1 font-display text-[22px] font-semibold tracking-[-0.02em] text-foreground">
            Acquisition OS
          </h1>
          <p className="mt-1.5 max-w-2xl font-sans text-[13px] leading-5 text-muted-foreground">
            Control layer over the existing Lead Engine, Approval Queue / Email Outbox and Notify Hub.
          </p>
        </div>
        <AutoRefresh intervalMs={30_000} />
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
            <MetricCard label="Replies" value={stats.replies} href="/acquisition/replies" />
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-red-500/30 bg-card p-6">
            <p className="font-sans text-sm font-medium tracking-[-0.01em] text-foreground">Lead database unavailable</p>
            <p className="mt-1 font-sans text-[13px] text-muted-foreground">{statsError}</p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {/* Was a raw <a href>, forcing a full document reload. */}
              <Link href="/acquisition" className="rounded-lg border border-border/80 bg-card px-3 py-1.5 font-mono text-[11px] font-medium uppercase tracking-[0.08em] hover:bg-accent">
                Retry
              </Link>
              <span className="font-mono text-[11px] tracking-[0.02em] text-muted-foreground">
                Refreshes automatically every 30s — no need to reload
              </span>
            </div>
          </div>
        )}
      </section>

      <section className="space-y-3">
        <SectionHeader
          title="Platform state"
          subtitle={countsError ?? "Your workspace — campaigns, sends and follow-ups"}
          right={countsError ? <StatusPill state="error" /> : undefined}
        />
        {countsError ? (
          <div className="rounded-lg border border-dashed border-red-500/30 bg-card p-5">
            <p className="font-sans text-[13px] text-muted-foreground">{countsError}</p>
            <p className="mt-1 font-sans text-xs text-muted-foreground">
              Nothing is lost. Open Leads, Campaigns or Follow-ups directly — those pages load independently.
            </p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <MetricCard label="Campaigns" value={counts.campaigns} href="/acquisition/campaigns" />
            <MetricCard label="Queued emails" value={counts.queuedEmails} href="/acquisition/outreach" />
            <MetricCard label="Sent" value={counts.sentEmails} href="/acquisition/outreach" />
            <MetricCard label="Failed" value={counts.failedEmails} href="/acquisition/outreach" />
            <MetricCard label="Follow-ups pending" value={counts.followUpsPending} href="/acquisition/follow-ups" />
          </div>
        )}
      </section>

      {/* First-run guidance. A brand-new tenant has all zeros; the four tiles
          below all assume data already exists and none pointed at the one page
          that says what to do next. */}
      {stats && stats.total === 0 ? (
        <section className="rounded-lg border border-border/80 bg-card p-5">
          <p className="font-sans text-sm font-medium tracking-[-0.01em] text-foreground">
            Start here — three steps to your first campaign
          </p>
          <ol className="mt-3 grid gap-3 sm:grid-cols-3">
            {[
              { n: 1, href: "/acquisition/profile", title: "Describe your business", desc: "Tell the OS who you sell to, where, and what you offer." },
              { n: 2, href: "/acquisition/generate", title: "Generate leads", desc: "Run the Lead Engine to research and verify prospects." },
              { n: 3, href: "/acquisition/campaigns", title: "Create a campaign", desc: "Pick a segment, review eligibility, then queue for approval." },
            ].map((s) => (
              <li key={s.n}>
                <Link href={s.href} className="block h-full rounded-lg border border-border/80 bg-card-hover/40 p-4 transition-colors hover:border-border-strong hover:bg-card-hover">
                  <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Step {s.n}</p>
                  <p className="mt-1 font-sans text-[13px] font-medium tracking-[-0.01em] text-foreground">{s.title}</p>
                  <p className="mt-1 font-sans text-xs leading-5 text-muted-foreground">{s.desc}</p>
                </Link>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { href: "/acquisition/profile", title: "Company Profile", desc: "What the OS knows about your business." },
          { href: "/acquisition/generate", title: "Generate Leads", desc: "Run the Lead Engine pipeline." },
          { href: "/acquisition/leads", title: "Leads", desc: "Search the corpus with filters and profiles." },
          { href: "/acquisition/campaigns", title: "Campaigns", desc: "Exact eligibility preview before any send." },
        ].map((c) => (
          <Link key={c.href} href={c.href} className="rounded-lg border border-border/80 bg-card p-4 transition-colors hover:border-border-strong hover:bg-card-hover">
            <p className="font-sans text-[13px] font-medium tracking-[-0.01em] text-foreground">{c.title}</p>
            <p className="mt-1 font-sans text-xs leading-5 text-muted-foreground">{c.desc}</p>
          </Link>
        ))}
      </section>

      {engineRun ? (
        <p className="font-mono text-[11px] tracking-[0.02em] text-muted-foreground">
          Engine last run: {formatIST(engineRun.started_at)} → {formatIST(engineRun.finished_at)} · added{" "}
          <span className="tabular-nums">{engineRun.added ?? 0}</span> · Telegram {engineRun.telegram_status ?? "—"}
        </p>
      ) : null}

      <OverviewLive />
    </div>
  );
}
