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
  return `Tier A ${tier("A")} · B ${tier("B")} · C ${tier("C")}`;
}

export default async function CommandCenterPage() {
  const session = await auth();
  const tenantId = requireTenantId(session);
  const generatedAt = new Date();

  // ---- ACQUISITION (real sources) -------------------------------------
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

  // Delivery rate is only meaningful once real sends exist — otherwise NO DATA.
  const totalDispatched = platformCounts.emailsSent + platformCounts.emailsFailed;
  const deliveryRate = totalDispatched > 0 ? Math.round((platformCounts.emailsSent / totalDispatched) * 100) : null;

  // ---- AUTOMATION (existing n8n) ---------------------------------------
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

  // ---- SYSTEMS ----------------------------------------------------------
  const systems = await computeIntegrationStatuses(tenantId);

  const engineRun = await safe(async () => getLastEngineRun(), undefined);
  const schedTask = await safe(() => getScheduledTaskInfo(), null);

  // ---- RECENT ACTIVITY --------------------------------------------------
  try {
    await backfillBatchActivity(tenantId);
  } catch {
    // backfill is best-effort; stream still renders recorded events
  }
  const activity = await withTenantContext(tenantId, (tx) =>
    tx.activityEvent.findMany({
      where: { tenantId },
      orderBy: { createdAt: "desc" },
      take: 12,
      select: { id: true, type: true, title: true, href: true, createdAt: true },
    }),
  ) as ActivityRow[];

  const manifests = await safe(async () => (await listBatchManifests()).slice(0, 3), []);
  const n8nSystem = systems.find((s) => s.key === "n8n");

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Command Center</h1>
          <p className="text-sm text-muted-foreground">
            Live state of the WavesCo acquisition and automation stack. Every number comes from the
            connected systems — never estimated.
          </p>
        </div>
        <div className="space-y-1 text-right">
          <AutoRefresh />
          <LastUpdated at={generatedAt} />
        </div>
      </div>

      {/* ACQUISITION */}
      <section className="space-y-3">
        <SectionHeader
          title="Acquisition"
          subtitle={
            stats.error
              ? `Lead Engine unavailable: ${stats.error}`
              : `Corpus last researched ${relativeFrom(stats.data.lastResearchedAt)}`
          }
          right={<StatusPill state={stats.error ? "error" : "live"} />}
        />
        {stats.error ? (
          <div className="rounded-lg border border-dashed border-red-500/40 p-4 text-sm">
            <p className="font-medium">Lead Engine unreachable</p>
            <p className="text-muted-foreground">{stats.error}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              The lead research service is reconnecting. Try Refresh in a moment.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
              <MetricCard label="Total Leads" value={stats.data.total} detail={tierDetail(stats.data.byTier)} href="/acquisition/leads" />
              <MetricCard label="New (7d)" value={stats.data.newLast7d ?? 0} detail="discovered this week" href="/acquisition/leads?sort=recent" />
              <MetricCard label="Email Ready" value={stats.data.emailReady} detail="verified · uncontacted" href="/acquisition/campaigns" />
              <MetricCard label="Queued Emails" value={platformCounts.pendingApprovals} detail={platformCounts.pendingApprovals === 0 ? "Nothing awaiting approval" : "awaiting approval"} href="/acquisition/outreach" />
              <MetricCard
                label="Delivery Rate"
                value={deliveryRate === null ? "NO DATA" : `${deliveryRate}%`}
                detail={totalDispatched === 0 ? "No sends recorded yet" : `${platformCounts.emailsSent}/${totalDispatched} dispatched`}
                href="/acquisition/outreach"
              />
              <MetricCard label="Replies" value={stats.data.replies} detail={stats.data.replies === 0 ? "No replies tracked yet" : "from lead corpus"} href="/acquisition/outreach" />
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
              <MetricCard label="Emails Sent" value={platformCounts.emailsSent} detail={platformCounts.emailsFailed > 0 ? `${platformCounts.emailsFailed} failed` : "no failures"} href="/acquisition/outreach" />
              <MetricCard label="Follow-ups" value={platformCounts.followUpsPending} detail={platformCounts.followUpsPending === 0 ? "None pending" : "pending"} href="/acquisition/follow-ups" />
              <MetricCard label="Campaigns" value={platformCounts.campaignsActive} detail={`${platformCounts.pendingApprovals} awaiting approval`} href="/acquisition/campaigns" />
              <MetricCard label="Clients" value={platformCounts.clientsTotal} detail={`${platformCounts.clientsOnboarding} onboarding`} href="/clients" />
              <MetricCard label="Active Projects" value={platformCounts.projectsActive} href="/clients" />
              <MetricCard label="Open Tasks" value={platformCounts.tasksOpen} detail={platformCounts.tasksOverdue > 0 ? `${platformCounts.tasksOverdue} overdue` : "none overdue"} href="/clients" />
            </div>
          </div>
        )}
        <p className="text-[11px] text-muted-foreground">
          Sources: lead database ({stats.error ? "unreachable" : "live"}) for corpus metrics · PostgreSQL for
          campaign/outreach/follow-up/client state · delivery rate appears only after real sends occur.
        </p>
      </section>

      {/* AUTOMATION */}
      <section className="space-y-3">
        <SectionHeader
          title="Automation"
          subtitle="Automation monitoring"
          right={<StatusPill state={n8nSystem?.state ?? "unknown"} />}
        />
        {!n8nKeyPresent ? (
          <div className="rounded-lg border border-dashed p-4 text-sm">
            <div className="flex items-center justify-between gap-4">
              <p className="font-medium">Automation monitoring is being connected</p>
              <StatusPill state="disconnected" />
            </div>
            <p className="mt-1 text-muted-foreground">
              Workflow activity will appear here automatically once monitoring is enabled for your workspace.
            </p>
          </div>
        ) : workflows.error || !wfData?.data ? (
          <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
            Automation activity is temporarily unavailable.
            <span className="mt-2 block text-xs">Last updated: {formatIST(generatedAt)}</span>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <MetricCard label="Workflows" value={wfData.data.length} href="/automation/workflows" />
            <MetricCard label="Active" value={activeWf} href="/automation/workflows" />
            <MetricCard label="Failed runs (recent)" value={failedRuns} detail={`${exData?.data?.length ?? 0} recent executions scanned`} href="/automation/logs" />
            <MetricCard label="Last successful run" value={lastSuccess ? formatISTClock(lastSuccess) : "—"} href="/automation/logs" />
            <MetricCard
              label="Next scheduled run"
              value={schedTask.data?.nextRunTime ?? "—"}
              detail={schedTask.data ? `Task Scheduler: ${schedTask.data.taskName} (${schedTask.data.state})` : "Scheduler task not found"}
              href="/automation/workflows"
            />
          </div>
        )}
      </section>

      {/* SYSTEMS */}
      <section className="space-y-3">
        <SectionHeader title="Systems" subtitle="Probed live at request time" />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {systems.map((s) => (
            <div key={s.key} className="rounded-lg border bg-card p-4">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium">{s.label}</p>
                <StatusPill state={s.state} />
              </div>
              <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{s.detail}</p>
              <p className="mt-2 text-[11px] text-muted-foreground/70">
                Checked {formatIST(s.lastCheckedAt)}
                {s.lastOkAt && s.state !== "connected" ? ` · last OK ${formatIST(s.lastOkAt)}` : ""}
              </p>
            </div>
          ))}
        </div>
        {engineRun.data && !engineRun.error ? (
          <p className="text-[11px] text-muted-foreground">
            Lead Engine last run: started {formatIST(engineRun.data.started_at)} · finished{" "}
            {formatIST(engineRun.data.finished_at)} · added {engineRun.data.added ?? 0} leads · Telegram:{" "}
            {engineRun.data.telegram_status ?? "—"}
            {schedTask.data?.lastResult ? ` · scheduler exit code ${schedTask.data.lastResult}` : ""}
          </p>
        ) : null}
      </section>

      {/* RECENT ACTIVITY */}
      <section className="space-y-3">
        <SectionHeader title="Recent activity" subtitle="Real events only · linked to source records" />
        {activity.length === 0 ? (
          <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
            No activity yet. Events appear when leads are generated, campaigns run, reports are produced or
            automations fire.
          </div>
        ) : (
          <ol className="divide-y rounded-lg border bg-card">
            {activity.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                <div className="min-w-0">
                  {a.href ? (
                    <a href={a.href} className="truncate font-medium hover:underline">
                      {a.title}
                    </a>
                  ) : (
                    <span className="truncate">{a.title}</span>
                  )}
                  <span className="ml-2 rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] uppercase text-muted-foreground">
                    {a.type.replace(/_/g, " ")}
                  </span>
                </div>
                <time className="shrink-0 text-xs text-muted-foreground">{formatIST(a.createdAt)}</time>
              </li>
            ))}
          </ol>
        )}
        {manifests.data.length > 0 ? (
          <p className="text-[11px] text-muted-foreground">
            Newest batches on disk: {manifests.data.map((m) => m.batchId).join(" · ")}
          </p>
        ) : null}
      </section>
    </div>
  );
}