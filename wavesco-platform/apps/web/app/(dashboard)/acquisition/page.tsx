import type { Metadata } from "next";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { requireTenantId } from "@/lib/tenant";
import { withTenantContext } from "@wavesco/db";
import { getFacets, getLeadStats, getLastEngineRun } from "@/lib/wavesco/lead-engine";
import { logEngineError, toSafeEngineError } from "@/lib/wavesco/engine-errors";
import {
  acquisitionFlow,
  getPrimaryAction,
  greeting,
  type PrimaryAction,
} from "@/lib/wavesco/lead-labels";
import { readinessCheck } from "@/lib/wavesco/acquisition-profile";
import { PageHeader, Section, Stat, StatGroup, Hairline } from "@/components/premium";
import { AutoRefresh } from "@/components/command/auto-refresh";
import { formatIST, relativeFrom } from "@/lib/wavesco/time";
import { OverviewLive } from "@/components/acquisition/overview-live";
import { CommandHero } from "@/components/acquisition/command-hero";
import { EngineHealthPill, EngineStatusCard } from "@/components/acquisition/engine-status";
import { FlowProgress } from "@/components/acquisition/flow-progress";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Command Center" };

export default async function AcquisitionPage() {
  const session = await auth();
  const tenantId = requireTenantId(session);

  let engineDown = false;
  let engineFailure: unknown = null;
  let stats: Awaited<ReturnType<typeof getLeadStats>> | null = null;
  let facets: Awaited<ReturnType<typeof getFacets>> | null = null;
  try {
    stats = await getLeadStats();
    facets = await getFacets();
  } catch (e) {
    logEngineError("command-center:stats", e);
    engineDown = true;
    engineFailure = e;
  }

  // Counts prove the database answered. A failure here must degrade to an
  // honest error state — never crash the whole page.
  let dbError: string | null = null;
  let counts = { campaigns: 0, queuedEmails: 0, sentEmails: 0, failedEmails: 0, followUpsPending: 0, meetings: 0 };
  try {
    counts = await withTenantContext(tenantId, async (tx) => {
      // Each count degrades to 0 independently — one missing table must
      // never zero out (or mislabel) the rest.
      const settle = async (fn: () => Promise<number>): Promise<number> => {
        try {
          return await fn();
        } catch {
          return 0;
        }
      };
      const [campaigns, queuedEmails, sentEmails, failedEmails, followUpsPending, meetings] =
        await Promise.all([
          settle(() => tx.campaign.count({ where: { tenantId } })),
          settle(() => tx.outreachEmail.count({ where: { tenantId, status: { in: ["submitted", "approved"] } } })),
          settle(() => tx.outreachEmail.count({ where: { tenantId, status: "sent" } })),
          settle(() => tx.outreachEmail.count({ where: { tenantId, status: "failed" } })),
          settle(() => tx.followUp.count({ where: { tenantId, status: "pending" } })),
          settle(() => tx.leadConversion.count({ where: { tenantId, state: "MEETING" } })),
        ]);
      return { campaigns, queuedEmails, sentEmails, failedEmails, followUpsPending, meetings };
    });
  } catch (e) {
    logEngineError("command-center:db", e);
    dbError = "Database unreachable";
  }
  const dbLive = !dbError;

  const engineRun = stats ? await safeRun() : null;
  async function safeRun() {
    try {
      return await getLastEngineRun();
    } catch {
      return null;
    }
  }

  // Onboarding state: profile completeness drives the primary action.
  let profileBanner: { ready: boolean; missing: string[]; fresh: boolean } | null = null;
  try {
    profileBanner = await withTenantContext(tenantId, async (tx) => {
      const p = await tx.acquisitionProfile.findFirst({ where: { tenantId } });
      const r = readinessCheck(p as any);
      return { ready: r.ready, missing: r.missing, fresh: !p };
    });
  } catch {
    profileBanner = null;
  }

  const rawName =
    ((session?.user as { name?: string; email?: string } | undefined)?.name ??
      (session?.user as { email?: string } | undefined)?.email ??
      "there").split(" ")[0] || "there";

  const actionInput = {
    profileReady: profileBanner?.ready ?? false,
    profileFresh: profileBanner?.fresh ?? true,
    totalLeads: stats?.total ?? 0,
    outreachReady: stats?.emailReady ?? 0,
    queuedEmails: counts.queuedEmails,
    sentEmails: counts.sentEmails,
    replies: stats?.replies ?? 0,
  };
  const primary: PrimaryAction = engineDown
    ? {
        title: "Your workspace is safe — research is reconnecting",
        description:
          counts.queuedEmails > 0
            ? `${counts.queuedEmails} ${counts.queuedEmails === 1 ? "message still needs" : "messages still need"} your review meanwhile.`
            : "Lead research will return automatically. You can review your workspace meanwhile.",
        cta: counts.queuedEmails > 0 ? "Review waiting outreach" : "Check lead research",
        href: counts.queuedEmails > 0 ? "/acquisition/outreach" : "/acquisition/generate",
      }
    : getPrimaryAction(actionInput);

  const kpis = [
    {
      label: "Qualified leads",
      hint: "Researched, ready to contact",
      value: stats ? String(stats.emailReady) : null,
    },
    {
      label: "Ready for review",
      hint: "Nothing sends without approval",
      value: String(counts.queuedEmails),
    },
    {
      label: "In progress",
      hint: "Outreach sent",
      value: String(counts.sentEmails),
    },
    {
      label: "Replies",
      hint: "Conversations started",
      value: stats ? String(stats.replies) : null,
    },
    {
      label: "Meetings",
      hint: "Confirmed outcomes",
      value: String(counts.meetings),
    },
  ];

  return (
    <div className="animate-fade-in">
      <PageHeader
        eyebrow="Acquisition OS"
        title="Command Center"
        description="Here's what is happening across your acquisition system."
        actions={<AutoRefresh intervalMs={30_000} />}
      />

      <div className="mx-auto max-w-[1280px] px-4 py-6 sm:px-8 lg:px-8">
        <CommandHero
          greeting={greeting()}
          name={rawName}
          context={
            engineDown
              ? "Lead research is reconnecting. Everything you've built is intact."
              : stats && stats.total > 0
                ? `Your pipeline holds ${stats.total} ${stats.total === 1 ? "lead" : "leads"}. Here's your next move.`
                : "Welcome to your acquisition system. Let's get your first wins moving."
          }
          action={primary}
        />

        <div className="mt-6">
          <Section
            title="Right now"
            description={
              stats && !engineDown
                ? `Last researched ${relativeFrom(stats.lastResearchedAt)}`
                : undefined
            }
          >
            {engineDown ? (
              <EngineStatusCard error={toSafeEngineError(engineFailure)} />
            ) : stats && facets ? (
              <StatGroup>
                {kpis.map((k) => (
                  <Stat
                    key={k.label}
                    label={k.label}
                    value={k.value === null ? "—" : Number(k.value)}
                    hint={k.value === null ? "Lead research unavailable" : k.hint}
                  />
                ))}
              </StatGroup>
            ) : (
              <StatGroup>
                <Stat label="Qualified leads" value={0} hint="Generate leads to begin" />
                <Stat label="Ready for review" value={counts.queuedEmails} hint="Nothing sends without approval" />
                <Stat label="In progress" value={counts.sentEmails} hint="Outreach sent" />
                <Stat label="Replies" value={0} hint="Conversations started" />
                <Stat label="Meetings" value={counts.meetings} hint="Confirmed outcomes" />
              </StatGroup>
            )}
          </Section>
        </div>

        <Hairline />

        <Section title="Your acquisition flow" description="Where you stand, from profile to meetings">
          <FlowProgress steps={acquisitionFlow(actionInput)} />
        </Section>

        <Hairline />

        {/* Compact system status — health never dominates the UI */}
        <Section title="System" description="Live status from this page load">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
            <EngineHealthPill ok={!engineDown} />
            <span className="inline-flex items-center gap-2">
              <span aria-hidden className={`h-2 w-2 rounded-full ${dbLive ? "bg-emerald-500" : "bg-red-500"}`} />
              <span className="text-muted-foreground">Workspace · {dbLive ? "Operational" : "Temporarily unavailable"}</span>
            </span>
            {process.env.N8N_BASE_URL?.trim() ? (
              <Link href="/acquisition/integrations" className="inline-flex items-center gap-2 text-muted-foreground underline-offset-2 hover:underline">
                <span aria-hidden className="h-2 w-2 rounded-full bg-amber-500" />
                Sending · verify live status
              </Link>
            ) : (
              <Link href="/acquisition/integrations" className="inline-flex items-center gap-2 text-muted-foreground underline-offset-2 hover:underline">
                <span aria-hidden className="h-2 w-2 rounded-full bg-red-500" />
                Sending · not configured
              </Link>
            )}
            {engineRun ? (
              <span className="font-mono text-xs text-muted-foreground">
                Last research {formatIST(engineRun.started_at)} · added {engineRun.added ?? 0}
              </span>
            ) : null}
          </div>
        </Section>

        <Hairline />

        <Section title="Recent activity" description="Live from your workspace">
          <OverviewLive />
        </Section>
      </div>
    </div>
  );
}
