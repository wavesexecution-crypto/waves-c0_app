import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

export function PageHeader({
  title,
  description,
  actions,
  eyebrow,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  eyebrow?: string;
}) {
  return (
    <div className="border-b border-border/60 bg-card">
      <div className="mx-auto max-w-[1280px] px-6 py-10 sm:px-8 sm:py-12 lg:px-8">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            {eyebrow ? (
              <p className="font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                {eyebrow}
              </p>
            ) : null}
            <h1 className="mt-3 font-sans text-[28px] font-semibold leading-[1.05] tracking-[-0.02em] text-foreground sm:text-[36px]">
              {title}
            </h1>
            {description ? (
              <p className="mt-3 max-w-2xl text-[15px] leading-6 text-muted-foreground text-balance">
                {description}
              </p>
            ) : null}
          </div>
          {actions ? <div className="flex shrink-0 items-center gap-3">{actions}</div> : null}
        </div>
      </div>
    </div>
  );
}

export function Section({
  title,
  description,
  actions,
  children,
  className,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("py-8 sm:py-10", className)}>
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-[18px] font-semibold tracking-[-0.015em] text-foreground sm:text-[20px]">
            {title}
          </h2>
          {description ? (
            <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}

export function StatGroup({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("grid gap-6 border-y border-border/60 bg-card py-6 sm:grid-cols-4 sm:py-8", className)}>
      {children}
    </div>
  );
}

export function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string | number;
  hint?: string;
}) {
  return (
    <div className="min-w-0">
      <p className="font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </p>
      <p className="mt-2 font-sans text-[28px] font-semibold leading-none tracking-[-0.02em] text-foreground sm:text-[32px]">
        {value}
      </p>
      {hint ? <p className="mt-2 text-xs leading-5 text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export function PremiumCard({
  children,
  className,
  hover,
}: {
  children: ReactNode;
  className?: string;
  hover?: boolean;
}) {
  return (
    <div
      className={cn(
        "bg-card",
        "border border-border/60",
        hover ? "transition-colors hover:bg-muted/20" : "",
        className
      )}
    >
      {children}
    </div>
  );
}

export function StatusDot({ state, label }: { state: "live" | "idle" | "alert" | "muted"; label: string }) {
  const color =
    state === "live" ? "bg-emerald-500" : state === "alert" ? "bg-amber-500" : state === "idle" ? "bg-zinc-400" : "bg-zinc-300";
  return (
    <span className="inline-flex items-center gap-2">
      <span className={cn("h-2 w-2 rounded-full", color)} />
      <span className="font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </span>
    </span>
  );
}

export function Hairline({ className }: { className?: string }) {
  return <div className={cn("hairline", className)} />;
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <h3 className="text-[15px] font-medium text-foreground">{title}</h3>
      <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">{description}</p>
      {action ? <div className="mt-6">{action}</div> : null}
    </div>
  );
}
