import type { LucideIcon } from "lucide-react";

interface StatCardProps {
  label: string;
  value: string;
  detail: string;
  icon: LucideIcon;
  trend?: { value: string; positive?: boolean };
}

export function StatCard({ label, value, detail, icon: Icon, trend }: StatCardProps) {
  return (
    <div className="group relative flex flex-col rounded-[14px] border border-border/60 bg-card p-5 shadow-subtle transition-all duration-200 hover:shadow-card hover:border-border">
      <div className="flex items-start justify-between">
        <div className="flex h-8 w-8 items-center justify-center rounded-[9px] border border-border/60 bg-muted/40">
          <Icon className="h-3.5 w-3.5 text-muted-foreground" strokeWidth={1.7} />
        </div>
        {trend ? (
          <span
            className={`inline-flex items-center rounded-full px-2 py-1 text-[11px] font-medium leading-none tracking-wide ${
              trend.positive
                ? "bg-emerald-50 text-emerald-700 border border-emerald-200/60 dark:bg-emerald-950/30 dark:text-emerald-300 dark:border-emerald-900/50"
                : "bg-muted text-muted-foreground border border-border/60"
            }`}
          >
            {trend.value}
          </span>
        ) : null}
      </div>
      <div className="mt-4">
        <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">{label}</p>
        <p className="mt-1.5 font-mono-data text-[22px] font-[600] leading-none tracking-[-0.03em] text-foreground">
          {value}
        </p>
        <p className="mt-1.5 line-clamp-1 text-[12px] leading-snug text-muted-foreground">{detail}</p>
      </div>
    </div>
  );
}
