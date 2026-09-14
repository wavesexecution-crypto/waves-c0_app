import type { FlowStep } from "@/lib/wavesco/lead-labels";

/** Clean 7-stage progress indicator: Define → Convert. Plain language only. */
export function FlowProgress({ steps }: { steps: FlowStep[] }) {
  return (
    <ol aria-label="Acquisition progress" className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
      {steps.map((s, i) => (
        <li
          key={s.id}
          aria-current={s.state === "current" ? "step" : undefined}
          className={`rounded-lg border p-3 ${
            s.state === "done"
              ? "border-emerald-500/30 bg-emerald-500/5"
              : s.state === "current"
                ? "border-primary/40 bg-primary/5"
                : "border-border/60 bg-card"
          }`}
        >
          <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
            <span
              aria-hidden
              className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-[10px] ${
                s.state === "done"
                  ? "bg-emerald-500/15 text-emerald-600"
                  : s.state === "current"
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground"
              }`}
            >
              {s.state === "done" ? "✓" : i + 1}
            </span>
            {s.label}
          </p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">{s.hint}</p>
        </li>
      ))}
    </ol>
  );
}
