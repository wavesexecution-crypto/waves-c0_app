import type { Metadata } from "next";
import { auth } from "@/lib/auth";
import { requireTenantId } from "@/lib/tenant";
import { withTenantContext } from "@wavesco/db";
import {
  getLeadStats,
  getLastEngineRun,
  getScheduledTaskInfo,
  listBatchManifests,
} from "@/lib/wavesco/lead-engine";
import { computeIntegrationStatuses } from "@/lib/wavesco/integrations";
import { backfillBatchActivity } from "@/lib/wavesco/activity";
import { getExecutions, getWorkflows, n8nApiKey, type N8nExecutionSummary, type N8nWorkflowSummary } from "@/lib/wavesco/n8n";
import { AutoRefresh } from "@/components/command/auto-refresh";
import { LastUpdated, MetricCard, SectionHeader, StatusPill } from "@/components/command/primitives";
import { formatISTClock, formatIST, relativeFrom } from "@/lib/wavesco/time";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Command Center",
};

interface ActivityRow {
  id: string;
  type: string;
  title: string;
  href: string | null;
  createdAt: Date;
}

async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<{ data: T; error: string | null }> {
  try {
    return { data: await fn(), error: null };
  } catch (e) {
    return { data: fallback, error: e instanceof Error ? e.message : "unavailable" };
  }
}

function tierDetail(byTier: Record<string, number>): string {
  const tier = (k: string): number => byTier[k] ?? 0;
  return `A ${tier("A")} · B ${tier("B")} · C ${tier("C")}`;
}

export default async function CommandCenterPage() {
  const session = await auth();
  const tenantId = requireTenantId(session);
  const generatedAt = new Date();

  const stats = await safe(async () => getLeadStats(), {
    total: 0,
    byTier: {},
    newLast7d: 0,
    emailReady: 0,
    contacted: 0,
    optedOut: 0,
    bounced: 0,
    replies: 0,
    lastResearchedAt: null,
  });

  const platformCounts = await withTenantContext(tenantId, async (tx) => ({
    emailsSent: await tx.outreachEmail.count({ where: { tenantId, status: "sent" } }),
    emailsFailed: await tx.outreachEmail.count({ where: { tenantId, status: "failed" } }),
    pendingApprovals: await tx.outreachEmail.count({
      where: { tenantId, status: { in: ["pending_approval", "submitted", "approved"] } },
    }),
    followUpsPending: await tx.followUp.count({ where: { tenantId, status: "pending" } }),
    campaignsActive: await tx.campaign.count({ where: { tenantId, status: { notIn: ["completed", "paused"] } } }),
    clientsTotal: await tx.client.count({ where: { tenantId } }),
    clientsOnboarding: await tx.client.count({ where: { tenantId, status: "onboarding" } }),
    projectsActive: await tx.project.count({ where: { tenantId, status: { notIn: ["completed", "cancelled"] } } }),
    tasksOpen: await tx.projectTask.count({ where: { tenantId, status: { in: ["todo", "in_progress", "blocked"] } } }),
    tasksOverdue: await tx.projectTask.count({
      where: { tenantId, dueDate: { lt: new Date() }, status: { in: ["todo", "in_progress", "blocked"] } },
    }),
  }));

  const totalDispatched = platformCounts.emailsSent + platformCounts.emailsFailed;
  const deliveryRate = totalDispatched > 0 ? Math.round((platformCounts.emailsSent / totalDispatched) * 100) : null;

  const workflows = await safe(() => getWorkflows(), {
    ok: false,
    status: 0,
    reason: "no_api_key" as const,
  });
  const executions = await safe(() => getExecutions(50), {
    ok: false,
    status: 0,
    reason: "no_api_key" as const,
  });

  const wfData = (workflows.data.data ?? null) as { data?: N8nWorkflowSummary[] } | null;
  const exData = (executions.data.data ?? null) as { data?: N8nExecutionSummary[] } | null;
  const activeWf = wfData?.data?.filter((w) => w.active).length ?? 0;
  const failedRuns = exData?.data?.filter((x) => x.status === "error").length ?? 0;
  const lastSuccess = exData?.data?.find((x) => x.status === "success")?.stoppedAt ?? null;
  const n8nKeyPresent = Boolean(n8nApiKey());

  const systems = await computeIntegrationStatuses(tenantId);

  const engineRun = await safe(async () => getLastEngineRun(), undefined);
  const schedTask = await safe(() => getScheduledTaskInfo(), null);

  try {
    await backfillBatchActivity(tenantId);
  } catch {}

  const activity = (await withTenantContext(tenantId, (tx) =>
    tx.activityEvent.findMany({
      where: { tenantId },
      orderBy: { createdAt: "desc" },
      take: 12,
      select: { id: true, type: true, title: true, href: true, createdAt: true },
    }),
  )) as ActivityRow[];

  const manifests = await safe(async () => (await listBatchManifests()).slice(0, 3), []);
  const n8nSystem = systems.find((s) => s.key === "n8n");

  return (
    <div className="space-y-10">
      {/* Header — operational, restrained */}
      <div className="flex flex-wrap items-start justify-between gap-6 border-b border-border/60 pb-6">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <h1 className="font-display text-[22px] font-semibold tracking-[-0.02em] text-foreground">
              Command Center
            </h1>
            <span className="hidden h-4 w-px bg-border sm:block" />
            <span className="hidden items-center gap-2 font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground sm:inline-flex">
              <span className="h-1.5 w-1.5 animate-[pulse-subtle_2s_ease-in-out_infinite] rounded-full bg-emerald-500 shadow-[0_0_8px_hsl(142_76%_36%_/_0.45)]" />
              Live
            </span>
          </div>
          <p className="mt-2 max-w-2xl font-sans text-[13px] leading-6 text-muted-foreground">
            Operational state of the WavesCo acquisition system. Every value is live — sourced from the
            lead corpus, PostgreSQL, and connected automations.
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          <AutoRefresh />
          <LastUpdated at={generatedAt} />
        </div>
      </div>

      {/* ACQUISITION — 12 KPIs in precise 6-col grid */}
      <section className="space-y-4">
        <SectionHeader
          title="Acquisition"
          subtitle={
            stats.error
              ? `Lead Engine unavailable: ${stats.error}`
              : `Corpus last researched ${relativeFrom(stats.data.lastResearchedAt)} · ${stats.data.total.toLocaleString()} leads indexed`
          }
          right={<StatusPill state={stats.error ? "error" : "live"} label={stats.error ? "Degraded" : "Live"} />}
        />
        {stats.error ? (
          <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-4">
            <p className="font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-destructive">Lead Engine unreachable</p>
            <p className="mt-1 font-sans text-[13px] text-muted-foreground">{stats.error}</p>
            <p className="mt-2 font-mono text-[11px] text-muted-foreground/70">The research service is reconnecting. Refresh in a moment.</p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
              <MetricCard label="Total Leads" value={stats.data.total.toLocaleString()} detail={tierDetail(stats.data.byTier)} href="/acquisition/leads" />
              <MetricCard label="New · 7D" value={stats.data.newLast7d ?? 0} detail="discovered this week" href="/acquisition/leads?sort=recent" />
              <MetricCard label="Email Ready" value={stats.data.emailReady} detail="verified · uncontacted" href="/acquisition/campaigns" />
              <MetricCard label="Queued" value={platformCounts.pendingApprovals} detail={platformCounts.pendingApprovals === 0 ? "Nothing awaiting approval" : "awaiting approval"} href="/acquisition/outreach" />
              <MetricCard
                label="Delivery Rate"
                value={deliveryRate === null ? "—" : `${deliveryRate}%`}
                detail={totalDispatched === 0 ? "No sends yet" : `${platformCounts.emailsSent}/${totalDispatched} dispatched`}
                href="/acquisition/outreach"
              />
              <MetricCard label="Replies" value={stats.data.replies} detail={stats.data.replies === 0 ? "No replies yet" : "from corpus"} href="/acquisition/outreach" />
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
              <MetricCard label="Emails Sent" value={platformCounts.emailsSent} detail={platformCounts.emailsFailed > 0 ? `${platformCounts.emailsFailed} failed` : "no failures"} href="/acquisition/outreach" />
              <MetricCard label="Follow-ups" value={platformCounts.followUpsPending} detail={platformCounts.followUpsPending === 0 ? "None pending" : "pending"} href="/acquisition/follow-ups" />
              <MetricCard label="Campaigns" value={platformCounts.campaignsActive} detail="active" href="/acquisition/campaigns" />
              <MetricCard label="Clients" value={platformCounts.clientsTotal} detail={`${platformCounts.clientsOnboarding} onboarding`} href="/clients" />
              <MetricCard label="Projects" value={platformCounts.projectsActive} detail="active" href="/clients" />
              <MetricCard label="Tasks" value={platformCounts.tasksOpen} detail={platformCounts.tasksOverdue > 0 ? `${platformCounts.tasksOverdue} overdue` : "none overdue"} href="/clients" />
            </div>
          </div>
        )}
        <p className="font-mono text-[11px] leading-5 text-muted-foreground/60">
          Sources: lead corpus ({stats.error ? "unreachable" : "live"}) · PostgreSQL for outreach/campaign state · delivery rate only after real sends.
        </p>
      </section>

      {/* AUTOMATION */}
      <section className="space-y-4">
        <SectionHeader
          title="Automation"
          subtitle="Workflow execution and scheduling"
          right={<StatusPill state={n8nSystem?.state ?? "unknown"} />}
        />
        {!n8nKeyPresent ? (
          <div className="rounded-lg border border-border/80 bg-card p-5">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="font-display text-[13px] font-semibold tracking-[-0.01em] text-foreground">Automation not connected</p>
                <p className="mt-1 font-sans text-[13px] text-muted-foreground">Workflow activity will appear here once monitoring is enabled.</p>
              </div>
              <StatusPill state="disconnected" />
            </div>
          </div>
        ) : workflows.error || !wfData?.data ? (
          <div className="rounded-lg border border-dashed border-border bg-card/50 p-5 text-center">
            <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground">Automation temporarily unavailable</p>
            <p className="mt-1 font-mono text-[11px] text-muted-foreground/60">Last updated: {formatIST(generatedAt)}</p>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <MetricCard label="Workflows" value={wfData.data.length} href="/automation/workflows" />
            <MetricCard label="Active" value={activeWf} href="/automation/workflows" />
            <MetricCard label="Failed · Recent" value={failedRuns} detail={`${exData?.data?.length ?? 0} scanned`} href="/automation/logs" />
            <MetricCard label="Last Success" value={lastSuccess ? formatISTClock(lastSuccess) : "—"} href="/automation/logs" />
            <MetricCard
              label="Next Run"
              value={schedTask.data?.nextRunTime ?? "—"}
              detail={schedTask.data ? `${schedTask.data.taskName}` : "No schedule"}
              href="/automation/workflows"
            />
          </div>
        )}
      </section>

      {/* SYSTEMS */}
      <section className="space-y-4">
        <SectionHeader title="Systems" subtitle="Probed live at request time — no cached status" />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {systems.map((s) => (
            <div key={s.key} className="group rounded-lg border border-border/80 bg-card p-5 transition-colors hover:border-border-strong hover:bg-card-hover">
              <div className="flex items-start justify-between gap-3">
                <p className="font-display text-[13px] font-medium tracking-[-0.01em] text-foreground">{s.label}</p>
                <StatusPill state={s.state} />
              </div>
              <p className="mt-2 line-clamp-2 font-sans text-[13px] leading-5 text-muted-foreground">{s.detail}</p>
              <p className="mt-3 flex items-center gap-2 font-mono text-[11px] text-muted-foreground/60">
                <span>Checked {formatIST(s.lastCheckedAt)}</span>
                {s.lastOkAt && s.state !== "connected" ? (
                  <>
                    <span className="h-1 w-1 rounded-full bg-border-strong" />
                    <span>Last OK {formatIST(s.lastOkAt)}</span>
                  </>
                ) : null}
              </p>
            </div>
          ))}
        </div>
        {engineRun.data && !engineRun.error ? (
          <div className="rounded-md border border-border/60 bg-card/50 px-4 py-3 font-mono text-[11px] leading-5 text-muted-foreground">
            <span className="font-medium text-foreground">Lead Engine</span>
            <span className="mx-2 text-border-strong">·</span>
            Started {formatIST(engineRun.data.started_at)} · Finished {formatIST(engineRun.data.finished_at)} · Added {engineRun.data.added ?? 0} · Telegram {engineRun.data.telegram_status ?? "—"}
            {schedTask.data?.lastResult ? ` · Exit ${schedTask.data.lastResult}` : ""}
          </div>
        ) : null}
      </section>

      {/* RECENT ACTIVITY */}
      <section className="space-y-4">
        <SectionHeader title="Recent Activity" subtitle="Real events only — linked to source records · 12 most recent" />
        {activity.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border bg-card/30 p-10 text-center">
            <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground">No activity yet</p>
            <p className="mx-auto mt-2 max-w-md font-sans text-[13px] leading-5 text-muted-foreground">
              Events appear when leads are generated, campaigns run, reports are produced or automations fire.
            </p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border border-border/80 bg-card">
            <ol className="divide-y divide-border/60">
              {activity.map((a) => (
                <li key={a.id} className="group flex items-center justify-between gap-4 px-4 py-3 transition-colors hover:bg-card-hover">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="hidden h-1.5 w-1.5 shrink-0 rounded-full bg-border-strong group-hover:bg-accent sm:block" />
                    <div className="min-w-0">
                      {a.href ? (
                        <a href={a.href} className="truncate font-sans text-[13px] font-medium tracking-[-0.01em] text-foreground hover:text-accent hover:underline">
                          {a.title}
                        </a>
                      ) : (
                        <span className="truncate font-sans text-[13px] font-medium tracking-[-0.01em] text-foreground">{a.title}</span>
                      )}
                      <span className="ml-2 inline-flex rounded border border-border bg-secondary px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.06em] text-muted-foreground">
                        {a.type.replace(/_/g, " ")}
                      </span>
                    </div>
                  </div>
                  <time className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground/70">{formatIST(a.createdAt)}</time>
                </li>
              ))}
            </ol>
          </div>
        )}
        {manifests.data.length > 0 ? (
          <p className="font-mono text-[11px] text-muted-foreground/60">
            Newest batches on disk:{" "}
            <span className="font-medium text-muted-foreground">{manifests.data.map((m) => m.batchId).join(" · ")}</span>
          </p>
        ) : null}
      </section>
    </div>
  );
}
