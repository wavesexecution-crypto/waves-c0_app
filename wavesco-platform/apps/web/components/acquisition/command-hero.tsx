import Link from "next/link";
import type { PrimaryAction } from "@/lib/wavesco/lead-labels";

/**
 * Command Center hero — premium welcome band.
 * Visual language adapted from the jelly hero concept (strong typography,
 * ambient gradient glow, depth) built with CSS only: no external images,
 * video, or commercial links.
 */
export function CommandHero({
  greeting,
  name,
  context,
  action,
}: {
  greeting: string;
  name: string;
  context: string;
  action: PrimaryAction;
}) {
  return (
    <section
      aria-label="Command center"
      className="relative overflow-hidden rounded-2xl border border-border/60 bg-card"
    >
      {/* ambient glow — pure CSS */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-32 left-1/4 h-72 w-[70%] rounded-full bg-primary/10 blur-[110px]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-40 right-0 h-72 w-[45%] rounded-full bg-emerald-500/10 blur-[110px]"
      />
      <div className="relative px-6 py-10 sm:px-10 sm:py-12">
        <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
          Command Center
        </p>
        <h1 className="mt-3 max-w-2xl text-3xl font-semibold tracking-[-0.02em] text-foreground sm:text-4xl">
          {greeting}, {name}.
        </h1>
        <p className="mt-2 max-w-xl text-[15px] leading-7 text-muted-foreground">{context}</p>
        <div className="mt-6 rounded-xl border border-border/60 bg-background/70 p-5 backdrop-blur-sm sm:flex sm:items-center sm:gap-6">
          <div className="min-w-0 flex-1">
            <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
              Your next step
            </p>
            <p className="mt-1 text-base font-semibold tracking-tight">{action.title}</p>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">{action.description}</p>
          </div>
          <Link
            href={action.href}
            className="mt-4 inline-flex h-10 shrink-0 items-center justify-center rounded-md bg-primary px-5 text-sm font-medium text-primary-foreground transition-transform hover:bg-primary/90 sm:mt-0"
          >
            {action.cta} →
          </Link>
        </div>
      </div>
    </section>
  );
}
