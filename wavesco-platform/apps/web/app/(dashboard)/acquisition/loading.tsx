export default function AcquisitionLoading() {
  return (
    <div className="space-y-5">
      <div className="h-8 w-64 animate-pulse rounded bg-muted" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-24 animate-pulse rounded-lg border bg-muted/40" />
        ))}
      </div>
      <p className="text-sm text-muted-foreground">Loading acquisition data…</p>
    </div>
  );
}
