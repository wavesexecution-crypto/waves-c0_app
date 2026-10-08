"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { createCampaignAction, type ActionState } from "@/lib/actions/acquisition";
import { computeEligibilityAction } from "@/lib/actions/campaigns";

const initialAction: ActionState = { ok: false };

export function CampaignCreateForm({
  cities,
  categories,
  initial,
}: {
  cities: string[];
  categories: string[];
  initial?: { name?: string; location?: string; category?: string; tier?: string };
}) {
  const [state, formAction, pending] = useActionState(createCampaignAction, initialAction);
  // Prefill (e.g. "run again" from a previous campaign) only applies values
  // that still exist in the live facets — stale values fall back to "all".
  const initialLocation = initial?.location && cities.includes(initial.location) ? initial.location : undefined;
  const initialCategory = initial?.category && categories.includes(initial.category) ? initial.category : undefined;
  const initialTier = initial?.tier === "A" || initial?.tier === "B" || initial?.tier === "C" ? initial.tier : undefined;
  const [filters, setFilters] = useState<{ location?: string; category?: string; tier?: string }>({
    location: initialLocation,
    category: initialCategory,
    tier: initialTier,
  });
  const [eligibility, setEligibility] = useState<Awaited<ReturnType<typeof computeEligibilityAction>> | null>(null);
  const [loading, startTransition] = useTransition();

  useEffect(() => {
    startTransition(async () => {
      try {
        setEligibility(await computeEligibilityAction(filters));
      } catch {
        setEligibility(null);
      }
    });
  }, [filters]);

  return (
    <form
      action={formAction}
      onChange={(e) => {
        const fd = new FormData(e.currentTarget);
        setFilters({
          location: (fd.get("location") as string) || undefined,
          category: (fd.get("category") as string) || undefined,
          tier: (fd.get("tier") as string) || undefined,
        });
      }}
      className="space-y-4 rounded-lg border border-border/80 bg-card p-4"
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <label className="font-sans text-[13px] leading-5 text-muted-foreground">
          Campaign name *
          <input name="name" required minLength={2} maxLength={80} defaultValue={initial?.name ?? ""} className="mt-1 w-full rounded-lg border border-border/80 bg-transparent px-2 py-1.5 font-sans text-[13px]" />
        </label>
        <label className="font-sans text-[13px] leading-5 text-muted-foreground">
          Location / city
          <select name="location" defaultValue={initialLocation ?? ""} className="mt-1 w-full rounded-lg border border-border/80 bg-transparent px-2 py-1.5 font-sans text-[13px]">
            <option value="">All locations</option>
            {cities.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </label>
        <label className="font-sans text-[13px] leading-5 text-muted-foreground">
          Category
          <select name="category" defaultValue={initialCategory ?? ""} className="mt-1 w-full rounded-lg border border-border/80 bg-transparent px-2 py-1.5 font-sans text-[13px]">
            <option value="">All categories</option>
            {categories.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </label>
        <label className="font-sans text-[13px] leading-5 text-muted-foreground">
          Lead tier
          <select name="tier" defaultValue={initialTier ?? "all"} className="mt-1 w-full rounded-lg border border-border/80 bg-transparent px-2 py-1.5 font-sans text-[13px]">
            <option value="all">All tiers</option>
            <option value="A">Tier A</option>
            <option value="B">Tier B</option>
            <option value="C">Tier C</option>
          </select>
        </label>
        <label className="font-sans text-[13px] leading-5 text-muted-foreground">
          Sending limit
          <input name="sendingLimit" type="number" min={1} max={200} placeholder="no cap" className="mt-1 w-full rounded-lg border border-border/80 bg-transparent px-2 py-1.5 font-sans text-[13px]" />
        </label>
      </div>

      {/* Exact eligibility from real data */}
      <div className="rounded-lg border border-border/80 p-3 font-sans text-[13px]">
        {loading && !eligibility ? (
          <p className="font-sans text-[13px] leading-5 text-muted-foreground">Counting against the live corpus…</p>
        ) : eligibility ? (
          <>
            <p className="mb-2 font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">Eligibility (live)</p>
            <div className="grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-5">
              <Stat label="Selected" value={eligibility.selected} />
              <Stat label="With email" value={eligibility.withEmail} />
              <Stat label="Verified" value={eligibility.verified} />
              <Stat label="Previously contacted" value={eligibility.previouslyContacted} />
              <Stat label="Opted out" value={eligibility.optedOut} />
            </div>
            <p className="mt-2 font-semibold">
              Eligible now: <span className="tabular-nums">{eligibility.eligible}</span>
            </p>
          </>
        ) : (
          <p className="text-xs text-red-500">Lead Engine unreachable — cannot verify eligibility.</p>
        )}
      </div>

      <div className="flex items-center gap-3">
        <button type="submit" disabled={pending} className="rounded-lg bg-primary px-4 py-1.5 font-sans text-[13px] font-medium text-primary-foreground disabled:opacity-50">
          {pending ? "Creating…" : "Create campaign"}
        </button>
        {state.error ? <span className="text-xs text-red-500">{state.error}</span> : null}
        {state.ok ? <span className="text-xs text-emerald-600 dark:text-emerald-400">{state.message}</span> : null}
      </div>
    </form>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="font-semibold tabular-nums">{value}</p>
    </div>
  );
}
