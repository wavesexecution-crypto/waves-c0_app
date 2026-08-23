import type { LucideIcon } from "lucide-react";
import { cn } from "@wavesco/ui";

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon?: LucideIcon;
  title: string;
  description: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center rounded-[12px] border border-dashed border-border/70 bg-muted/20 px-6 py-10 text-center", className)}>
      {Icon ? (
        <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-full border border-border/60 bg-card shadow-subtle">
          <Icon className="h-4 w-4 text-muted-foreground" strokeWidth={1.6} />
        </div>
      ) : null}
      <p className="text-[13px] font-[550] tracking-tight">{title}</p>
      <p className="mt-1 max-w-[32ch] text-[12.5px] leading-snug text-muted-foreground text-balance">{description}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
