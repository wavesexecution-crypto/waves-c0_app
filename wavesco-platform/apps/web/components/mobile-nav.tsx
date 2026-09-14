"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Menu } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger, cn } from "@wavesco/ui";
import { NAV_SECTIONS } from "@/components/nav-sections";

/** Mobile navigation drawer — the desktop sidebar is hidden below md. */
export function MobileNav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <button
          type="button"
          aria-label="Open navigation"
          className="inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:hidden"
        >
          <Menu className="h-5 w-5" />
        </button>
      </SheetTrigger>
      <SheetContent side="left" className="w-[280px] overflow-y-auto p-0">
        <SheetHeader className="border-b border-border/60 px-5 py-4 text-left">
          <SheetTitle className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em]">
            WavesCo OS
          </SheetTitle>
        </SheetHeader>
        <nav aria-label="Primary" className="flex flex-col gap-6 px-3 py-5">
          {NAV_SECTIONS.map((section, si) => (
            <div key={si} className="space-y-1">
              {section.title ? (
                <p className="px-3 pb-1 font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground/70">
                  {section.title}
                </p>
              ) : null}
              {section.items.map((item) => {
                const Icon = item.icon;
                const active =
                  pathname === item.href || (item.href !== "/" && pathname.startsWith(`${item.href}/`));
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => {
                      setOpen(false);
                    }}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex items-center gap-3 rounded-md px-3 py-2.5 text-sm transition-colors",
                      active
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground"
                    )}
                  >
                    <Icon className="h-[16px] w-[16px] shrink-0" strokeWidth={1.7} />
                    <span className={active ? "font-medium" : "font-normal"}>{item.label}</span>
                  </Link>
                );
              })}
            </div>
          ))}
          <Link
            href="/settings"
            onClick={() => {
              setOpen(false);
            }}
            className="flex items-center gap-3 rounded-md px-3 py-2.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            Settings
          </Link>
        </nav>
      </SheetContent>
    </Sheet>
  );
}
