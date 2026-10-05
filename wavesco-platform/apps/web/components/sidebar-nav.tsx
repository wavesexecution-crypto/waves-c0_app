"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@wavesco/ui";
import { buildNavSections, isActiveHref } from "@/lib/nav";

/** Navigation list body shared by the desktop rail and the mobile drawer so
 *  both stay identical. Callers supply their own scroll container.
 *  `onNavigate` lets the drawer close itself after a link is followed. */
export function SidebarNav({
  internalAccess = false,
  onNavigate,
}: {
  internalAccess?: boolean;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const sections = buildNavSections(internalAccess);

  return (
    <div className="space-y-5">
      {sections.map((section, si) => (
        <div key={si} className="space-y-1">
          {section.title ? (
            <p className="px-3 pb-1 pt-3 font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground/60">
              {section.title}
            </p>
          ) : si !== 0 ? (
            <div className="mx-3 my-2 h-px bg-border/60" />
          ) : null}
          {section.items.map((item) => {
            const Icon = item.icon;
            const active = isActiveHref(item.href, pathname);

            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onNavigate}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "group flex items-center gap-3 rounded-md px-2.5 py-1.5 text-[13px] transition-all duration-150",
                  active
                    ? "bg-card-hover font-medium tracking-[-0.01em] text-foreground"
                    : "font-medium tracking-[-0.01em] text-muted-foreground hover:bg-card-hover hover:text-foreground",
                )}
              >
                <Icon
                  className={cn(
                    "h-3.5 w-3.5 shrink-0 transition-colors",
                    active ? "text-foreground" : "text-muted-foreground/60 group-hover:text-foreground",
                  )}
                />
                <span className="font-sans">{item.label}</span>
                {active && (
                  <span className="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-accent shadow-[0_0_8px_hsl(var(--accent)_/_0.4)]" />
                )}
              </Link>
            );
          })}
        </div>
      ))}
    </div>
  );
}