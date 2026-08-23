import { cn } from "@wavesco/ui";
import type { LucideIcon } from "lucide-react";

export function SectionHeader({
  title,
  description,
  action,
  icon: Icon,
  className,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  icon?: LucideIcon;
  className?: string;
}) {
  return (
    <div className={cn("flex items-start justify-between gap-4", className)}>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          {Icon ? <Icon className="h-3.5 w-3.5 text-muted-foreground" /> : null}
          <h2 className="text-[13px] font-semibold tracking-[-0.02em]">{title}</h2>
        </div>
        {description ? <p className="mt-1 text-[12.5px] leading-snug text-muted-foreground">{description}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

export function CardShell({
  children,
  className,
  padded = true,
}: {
  children: React.ReactNode;
  className?: string;
  padded?: boolean;
}) {
  return (
    <div className={cn("rounded-[14px] border border-border/60 bg-card shadow-subtle", padded ? "p-5" : "", className)}>
      {children}
    </div>
  );
}
