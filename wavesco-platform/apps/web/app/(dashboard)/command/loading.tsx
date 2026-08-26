export default function CommandLoading() {
  return (
    <div className="space-y-6">
      <div className="h-8 w-56 animate-pulse rounded bg-muted" />
      {[0, 1, 2].map((i) => (
        <div key={i} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((j) => (
            <div key={j} className="h-24 animate-pulse rounded-lg border bg-muted/40" />
          ))}
        </div>
      ))}
      <p className="text-sm text-muted-foreground">Loading live system state…</p>
    </div>
  );
}
