export default function AcquisitionLoading() {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="h-6 w-32 animate-pulse rounded-lg bg-card border border-border/80" />
        <div className="h-4 w-20 animate-pulse rounded bg-muted" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-[88px] animate-pulse rounded-lg border border-dashed border-border/80 bg-card p-5" />
        ))}
      </div>
      <div className="rounded-lg border border-dashed border-border/80 bg-card/50 p-6 text-center">
        <p className="font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">Loading — Acquisition OS</p>
        <p className="mt-2 font-sans text-[13px] text-muted-foreground">Syncing corpus and platform state…</p>
      </div>
    </div>
  );
}
