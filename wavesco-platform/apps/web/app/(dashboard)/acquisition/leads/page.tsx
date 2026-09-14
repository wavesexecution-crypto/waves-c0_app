import type { Metadata } from "next";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { requireTenantId } from "@/lib/tenant";
import { getFacets, listLeads, type ListLeadsParams } from "@/lib/wavesco/lead-engine";
import { logEngineError, toSafeEngineError, type SafeEngineError } from "@/lib/wavesco/engine-errors";
import { fitScore, leadNextAction } from "@/lib/wavesco/lead-labels";
import { LeadsExportButton } from "@/components/acquisition/leads-export-button";
import { EngineStatusCard } from "@/components/acquisition/engine-status";
import { LeadStatusPill } from "@/components/acquisition/lead-status-pill";
import { PageHeader, Section, Hairline, StatusDot, EmptyState } from "@/components/premium";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Leads" };

interface SearchParams {
  q?: string;
  tier?: string;
  category?: string;
  city?: string;
  outreach?: string;
  sort?: string;
  page?: string;
}

function buildQueryString(base: Record<string, string | undefined>, overrides: Record<string, string | undefined>): string {
  const merged: Record<string, string> = {};
  for (const [k, v] of Object.entries({ ...base, ...overrides })) {
    if (v) merged[k] = v;
  }
  return new URLSearchParams(merged).toString();
}

export default async function LeadsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const session = await auth();
  requireTenantId(session);
  const sp = await searchParams;
  const params: ListLeadsParams = {
    search: sp.q,
    tier: sp.tier,
    category: sp.category,
    city: sp.city,
    outreach: sp.outreach === "contacted" || sp.outreach === "uncontacted" || sp.outreach === "opted_out" || sp.outreach === "replied" ? sp.outreach : undefined,
    sort: sp.sort === "recent" || sp.sort === "business" ? sp.sort : "score",
    page: Number(sp.page ?? "1") || 1,
    pageSize: 25,
  };

  let safeError: SafeEngineError | null = null;
  let result: Awaited<ReturnType<typeof listLeads>> | null = null;
  let facets: Awaited<ReturnType<typeof getFacets>> | null = null;
  try {
    result = await listLeads(params);
    facets = await getFacets();
  } catch (e) {
    // Technical detail stays in server logs; the UI gets a safe message only.
    logEngineError("leads:list", e);
    safeError = toSafeEngineError(e);
  }

  const qs = (overrides: Record<string, string | undefined>): string =>
    buildQueryString({ q: sp.q, tier: sp.tier, category: sp.category, city: sp.city, outreach: sp.outreach, sort: sp.sort }, overrides);

  return (
    <div className="animate-fade-in">
      <PageHeader
        eyebrow="Acquisition OS"
        title="Leads"
        description="Your researched acquisition pipeline."
        actions={
          <>
            <Link href="/acquisition/generate" className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90">
              + Generate leads
            </Link>
            <LeadsExportButton filters={{ q: sp.q, tier: sp.tier, category: sp.category, city: sp.city, outreach: sp.outreach }} />
          </>
        }
      />

      <div className="mx-auto max-w-[1280px] px-6 py-8 sm:px-8 lg:px-8">
        {/* Segment */}
        <div className="flex flex-wrap items-center gap-3 border-y border-border/60 bg-card px-4 py-3">
          <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground">Segment</span>
          <div className="flex items-center gap-1.5">
            {(["A", "B", "C"] as const).map((t) => (
              <Link
                key={t}
                href={`/acquisition/leads?${qs({ tier: t, page: undefined })}`}
                className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${sp.tier === t ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground"}`}
              >
                Tier {t}
              </Link>
            ))}
            {sp.tier ? (
              <Link href={`/acquisition/leads?${qs({ tier: undefined, page: undefined })}`} className="rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground hover:text-foreground">
                Clear
              </Link>
            ) : null}
          </div>
          <span className="ml-auto hidden font-mono text-xs text-muted-foreground lg:inline">Workspace leads · CSV export</span>
        </div>

        {safeError ? (
          <div className="mt-8">
            <EngineStatusCard error={safeError} />
          </div>
        ) : result && facets ? (
          <>
            {/* Filters */}
            <Section title="Filters" description="Refine the corpus before you export or build a campaign">
              <form className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6" action="/acquisition/leads">
                <input name="q" defaultValue={sp.q ?? ""} placeholder="Business, area, email, phone" className="h-9 rounded-md border border-input bg-background px-3 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:col-span-2" />
                <select name="tier" defaultValue={sp.tier ?? ""} className="h-9 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <option value="">All tiers</option>
                  <option value="A">Tier A</option>
                  <option value="B">Tier B</option>
                  <option value="C">Tier C</option>
                </select>
                <select name="category" defaultValue={sp.category ?? ""} className="h-9 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <option value="">All categories</option>
                  {facets.categories.slice(0, 20).map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
                <select name="city" defaultValue={sp.city ?? ""} className="h-9 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <option value="">All cities</option>
                  {facets.cities.slice(0, 20).map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
                <button type="submit" className="h-9 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90">
                  Apply
                </button>
              </form>
            </Section>

            <Hairline />

            {/* Results */}
            <Section
              title={`${result.total} leads`}
              description={`Page ${result.page} of ${Math.max(1, Math.ceil(result.total / 25))} · sorted by ${params.sort === "recent" ? "most recent" : params.sort === "business" ? "business name" : "fit score"}`}
              actions={<span className="font-mono text-xs text-muted-foreground">{result.rows.length} on this page</span>}
            >
              <div className="divide-y divide-border/60 border-y border-border/60 bg-card">
                {result.rows.length === 0 ? (
                  <EmptyState
                    title="No leads yet"
                    description={sp.q || sp.tier || sp.category || sp.city ? "No leads match this filter. Try a broader search or clear the filters." : "Your acquisition profile is ready. Generate your first batch to start building your pipeline."}
                    action={
                      <Link href="/acquisition/generate" className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90">
                        Generate leads
                      </Link>
                    }
                  />
                ) : (
                  result.rows.map((lead) => {
                    const score = fitScore(lead);
                    return (
                      <Link
                        key={lead.name_key ?? lead.business}
                        href={`/acquisition/leads/${encodeURIComponent(lead.name_key ?? lead.business)}`}
                        className="flex items-center justify-between gap-4 px-4 py-4 hover:bg-muted/30 sm:px-6"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{lead.business}</p>
                          <p className="mt-0.5 truncate text-xs text-muted-foreground">
                            {lead.category ?? "Uncategorized"} · {lead.area ?? lead.city ?? "Unknown area"}
                            {lead.tier ? ` · Tier ${lead.tier}` : ""}
                            {score !== null ? ` · Fit ${score}` : ""}
                          </p>
                          <div className="mt-1.5 sm:hidden">
                            <LeadStatusPill lead={lead} />
                          </div>
                        </div>
                        <div className="hidden shrink-0 flex-col items-end gap-1.5 sm:flex">
                          <LeadStatusPill lead={lead} />
                          <span className="font-mono text-[11px] text-muted-foreground">
                            {leadNextAction(lead)}
                          </span>
                        </div>
                      </Link>
                    );
                  })
                )}
              </div>

              <div className="mt-6 flex items-center justify-between">
                <p className="font-mono text-xs text-muted-foreground">
                  {result.total} total � {facets.categories.length} categories � {facets.cities.length} cities
                </p>
                <div className="flex gap-2">
                  {result.page > 1 ? (
                    <Link href={`/acquisition/leads?${qs({ page: String(result.page - 1) })}`} className="rounded-md border border-border bg-card px-3 py-1.5 text-xs hover:bg-muted">
                      Previous
                    </Link>
                  ) : null}
                  {result.page * 25 < result.total ? (
                    <Link href={`/acquisition/leads?${qs({ page: String(result.page + 1) })}`} className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90">
                      Next
                    </Link>
                  ) : null}
                </div>
              </div>
            </Section>
          </>
        ) : null}
      </div>
    </div>
  );
}
