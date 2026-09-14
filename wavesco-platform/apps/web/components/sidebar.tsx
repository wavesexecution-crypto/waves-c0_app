"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Settings } from "lucide-react";
import { cn } from "@wavesco/ui";
import { NAV_SECTIONS } from "@/components/nav-sections";

export function Sidebar({ internalAccess = true }: { internalAccess?: boolean }) {
  const pathname = usePathname();

  return (
    <nav aria-label="Primary" className="flex flex-1 flex-col gap-7 overflow-y-auto px-3 py-6">
      {NAV_SECTIONS.map((section, si) => (
        <div key={si} className="space-y-1.5">
          {section.title ? (
            <p className="px-3 pb-1 font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground/70">
              {section.title}
            </p>
          ) : si !== 0 ? (
            <div className="mx-3 my-2 h-px bg-border/60" />
          ) : null}
          <div className="space-y-0.5">
            {section.items.map((item) => {
              const Icon = item.icon;
              const active =
                pathname === item.href || (item.href !== "/" && pathname.startsWith(`${item.href}/`));
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "group flex items-center gap-3 rounded-md px-3 py-2 text-[13.5px] leading-none transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    active
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  )}
                >
                  <Icon
                    className={cn(
                      "h-[16px] w-[16px] shrink-0",
                      active ? "text-primary-foreground" : "text-muted-foreground group-hover:text-foreground"
                    )}
                    strokeWidth={1.7}
                  />
                  <span className={cn(active ? "font-medium" : "font-normal")}>{item.label}</span>
                </Link>
              );
            })}
          </div>
        </div>
      ))}
      {internalAccess ? (
        <div className="mt-auto pt-6">
          <Link
            href="/settings"
            className={cn(
              "flex items-center gap-3 rounded-md px-3 py-2 text-[13.5px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              pathname === "/settings"
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
          >
            <Settings className="h-[16px] w-[16px]" strokeWidth={1.7} />
            Settings
          </Link>
        </div>
      ) : null}
    </nav>
  );
}
