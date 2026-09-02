import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { requireTenantId } from "@/lib/tenant";
import { getFacets, listLeads, type ListLeadsParams } from "@/lib/wavesco/lead-engine";
import { LeadsExportButton } from "@/components/acquisition/leads-export-button";
import { AutoRefresh } from "@/components/command/auto-refresh";

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

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const session = await auth();
  requireTenantId(session);

  const sp = await searchParams;
  const params: ListLeadsParams = {
    search: sp.q,
    tier: sp.tier,
    category: sp.category,
    city: sp.city,
    outreach:
      sp.outreach === "contacted" || sp.outreach === "uncontacted" || sp.outreach === "opted_out" || sp.outreach === "replied"
        ? sp.outreach
        : undefined,
    sort: sp.sort === "recent" || sp.sort === "business" ? sp.sort : "score",
    page: Number(sp.page ?? "1") || 1,
    pageSize: 25,
  };

  let error: string | null = null;
  let result: Awaited<ReturnType<typeof listLeads>> | null = null;
  let facets: Awaited<ReturnType<typeof getFacets>> | null = null;
  try {
    result = await listLeads(params);
    facets = await getFacets();
  } catch (e) {
    error = e instanceof Error ? e.message : "Lead Engine unreachable";
  }

  const qs = (overrides: Record<string, string | undefined>): string =>
    buildQueryString(
      { q: sp.q, tier: sp.tier, category: sp.category, city: sp.city, outreach: sp.outreach, sort: sp.sort },
      overrides,
    );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Leads</h1>
          <p className="text-sm text-muted-foreground">
            Live corpus from the Lead Engine database. Nothing is cached or copied.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <AutoRefresh intervalMs={15_000} />
          <Link href="/acquisition/generate" className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent">
            + Generate leads
          </Link>
        </div>
      </div>

      {/* Control bar — Discover / Import / Export / Segment */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-card p-3">
        <Link
          href="/acquisition/generate"
          className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          Discover
        </Link>
        <Link
          href="/acquisition/generate?tab=import"
          className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent"
          title="Import CSV — placeholder, uses Generate pipeline"
        >
          Import
        </Link>
        <LeadsExportButton
          filters={{
            q: sp.q,
            tier: sp.tier,
            category: sp.category,
            city: sp.city,
            outreach: sp.outreach,
          }}
        />
        <span className="ml-2 hidden text-xs font-medium uppercase tracking-widest text-muted-foreground sm:inline">Segment:</span>
        <div className="flex items-center gap-1">
          {(["A", "B", "C"] as const).map((t) => (
            <Link
              key={t}
              href={`/acquisition/leads?${qs({ tier: t, page: undefined })}`}
              className={`rounded-full border px-2.5 py-1 text-xs font-medium ${
                sp.tier === t ? "border-primary/40 bg-primary/10 text-primary" : "text-muted-foreground hover:bg-accent"
              }`}
            >
              Tier {t}
            </Link>
          ))}
          {sp.tier ? (
            <Link
              href={`/acquisition/leads?${qs({ tier: undefined, page: undefined })}`}
              className="rounded-full border px-2.5 py-1 text-xs text-muted-foreground hover:bg-accent"
            >
              All
            </Link>
          ) : null}
        </div>
        <span className="ml-auto hidden text-[11px] text-muted-foreground lg:inline">
          Export is tenant-scoped · max 1000 rows · CSV
        </span>
      </div>

      {error ? (
        <div className="rounded-lg border border-dashed border-red-500/40 p-6 text-sm">
          <p className="font-medium">Lead Engine unavailable</p>
          <p className="text-muted-foreground">{error}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Last known good state cannot be shown — the engine DB is the only source.
          </p>
          <Link href="/acquisition/leads" className="mt-3 inline-block rounded-md border px-3 py-1.5 text-xs hover:bg-accent">
            Retry
          </Link>
        </div>
      ) : result && facets ? (
        <>
          {/* Filters */}
          <form className="grid gap-2 rounded-lg border bg-card p-3 sm:grid-cols-2 lg:grid-cols-6" action="/acquisition/leads">
            <input name="q" defaultValue={sp.q ?? ""} placeholder="Search business / area / email / phone" className="rounded-md border bg-transparent px-2 py-1.5 text-sm lg:col-span-2" />
            <select name="tier" defaultValue={sp.tier ?? ""} className="rounded-md border bg-transparent px-2 py-1.5 text-sm">
              <option value="">Tier · all</option>
              {["A", "B", "C"].map((t) => (
                <option key={t} value={t}>Tier {t}</option>
              ))}
            </select>
            <select name="category" defaultValue={sp.category ?? ""} className="rounded-md border bg-transparent px-2 py-1.5 text-sm">
              <option value="">Category · all</option>
              {facets.categories.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
            <select name="city" defaultValue={sp.city ?? ""} className="rounded-md border bg-transparent px-2 py-1.5 text-sm">
              <option value="">City · all</option>
              {facets.cities.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
            <select name="outreach" defaultValue={sp.outreach ?? ""} className="rounded-md border bg-transparent px-2 py-1.5 text-sm">
              <option value="">Outreach · any</option>
              <option value="uncontacted">Not contacted</option>
              <option value="contacted">Contacted</option>
              <option value="replied">Replied</option>
              <option value="opted_out">Opted out</option>
            </select>
            <input type="hidden" name="sort" value={params.sort} />
            <button type="submit" className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground lg:col-span-6">
              Apply filters
            </button>
          </form>

          {/* Sort tabs */}
          <div className="flex gap-2 text-xs">
            {[
              ["score", "Top score"],
              ["recent", "Recently researched"],
              ["business", "A–Z"],
            ].map(([key, label]) => (
              <Link
                key={key}
                href={`/acquisition/leads?${qs({ sort: key, page: undefined })}`}
                className={`rounded-full border px-3 py-1 ${params.sort === key ? "border-primary/40 bg-primary/10 text-primary" : "text-muted-foreground hover:bg-accent"}`}
              >
                {label}
              </Link>
            ))}
          </div>

          {result.total === 0 ? (
            <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
              <p>No leads found{params.search ? ` for "${params.search}"` : ""}. Adjust filters or generate a new batch.</p>
              <div className="mt-3 flex items-center justify-center gap-2">
                <Link href="/acquisition/generate" className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90">
                  Generate Leads
                </Link>
                <Link href="/acquisition/leads" className="rounded-md border px-3 py-1.5 text-xs hover:bg-accent">
                  Clear Filters
                </Link>
              </div>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto rounded-lg border bg-card">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                      <th className="px-4 py-2.5">Business</th>
                      <th className="px-4 py-2.5">Area</th>
                      <th className="px-4 py-2.5">Score</th>
                      <th className="px-4 py-2.5">Tier</th>
                      <th className="px-4 py-2.5">Email</th>
                      <th className="px-4 py-2.5">Site</th>
                      <th className="px-4 py-2.5">Outreach</th>
                      <th className="px-4 py-2.5">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.rows.map((l) => (
                      <tr key={l.name_key} className="border-b last:border-0 hover:bg-accent/40">
                        <td className="px-4 py-2.5">
                          <Link href={`/acquisition/leads/${encodeURIComponent(l.name_key)}`} className="font-medium hover:underline">
                            {l.business}
                          </Link>
                          <span className="block text-[11px] text-muted-foreground">{l.category ?? "—"}</span>
                        </td>
                        <td className="px-4 py-2.5 text-muted-foreground">{[l.area, l.city].filter(Boolean).join(", ") || "—"}</td>
                        <td className="px-4 py-2.5 tabular-nums">
                          <span className="inline-flex items-center gap-1">
                            {l.lead_score ?? "—"}
                            {l.lead_score != null && l.lead_score >= 80 ? (
                              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" title="High score" />
                            ) : null}
                          </span>
                        </td>
                        <td className="px-4 py-2.5">{tierBadge(l.tier)}</td>
                        <td className="px-4 py-2.5 text-xs">{emailCell(l.email, l.email_status)}</td>
                        <td className="px-4 py-2.5 text-xs text-muted-foreground">{l.site_class ?? "—"}</td>
                        <td className="px-4 py-2.5 text-xs">{outreachCell(l)}</td>
                        <td className="px-4 py-2.5 text-xs">
                          <div className="flex flex-col gap-1">
                            <Link
                              href={`/acquisition/leads/${encodeURIComponent(l.name_key)}`}
                              className="font-medium text-primary hover:underline"
                            >
                              Inspect
                            </Link>
                            <Link href={`/acquisition/leads/${encodeURIComponent(l.name_key)}#enrich`} className="text-muted-foreground hover:text-foreground hover:underline">
                              Enrich
                            </Link>
                            <Link href={`/acquisition/leads/${encodeURIComponent(l.name_key)}#verify`} className="text-muted-foreground hover:text-foreground hover:underline">
                              Verify
                            </Link>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>
                  Page {result.page} of {Math.max(1, Math.ceil(result.total / result.pageSize))} ·{" "}
                  {result.total} leads
                </span>
                <span className="flex gap-2">
                  {result.page > 1 ? (
                    <Link className="rounded border px-2 py-1 hover:bg-accent" href={`/acquisition/leads?${qs({ page: String(result.page - 1) })}`}>
                      ← Prev
                    </Link>
                  ) : null}
                  {result.page * result.pageSize < result.total ? (
                    <Link className="rounded border px-2 py-1 hover:bg-accent" href={`/acquisition/leads?${qs({ page: String(result.page + 1) })}`}>
                      Next →
                    </Link>
                  ) : null}
                </span>
              </div>
            </>
          )}
        </>
      ) : null}
    </div>
  );
}

function tierBadge(tier: string | null): ReactNode {
  if (!tier) return "—";
  const cls =
    tier === "A"
      ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
      : tier === "B"
        ? "bg-amber-500/15 text-amber-600 dark:text-amber-400"
        : "bg-zinc-500/15 text-zinc-500";
  return <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${cls}`}>{tier}</span>;
}

function emailCell(email: string | null, status: string | null): ReactNode {
  if (!email) return <span className="text-muted-foreground">—</span>;
  const verified = (status ?? "").toUpperCase().includes("VERIFIED");
  return (
    <span className="flex flex-col">
      <span className="truncate font-mono text-[11px]">{email}</span>
      <span className={verified ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"}>
        {status ?? "unmarked"}
      </span>
    </span>
  );
}

function outreachCell(l: { opted_out: number | null; bounced: number | null; date_contacted: string | null; reply_status: string | null }): ReactNode {
  if ((l.opted_out ?? 0) === 1) return <span className="text-red-500">opted out</span>;
  if ((l.bounced ?? 0) === 1) return <span className="text-amber-600">bounced</span>;
  if (l.reply_status && l.reply_status.trim() !== "" && !["none", "no reply", "no"].includes(l.reply_status.toLowerCase()))
    return <span className="text-sky-600 dark:text-sky-400">{l.reply_status}</span>;
  if (l.date_contacted) return <span className="text-muted-foreground">contacted</span>;
  return <span className="text-muted-foreground/60">untouched</span>;
}
