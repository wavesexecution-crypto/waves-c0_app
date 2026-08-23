"use client";

import { useState } from "react";
import { Menu, Search, Command } from "lucide-react";
import { Avatar, AvatarFallback, Button, Sheet, SheetContent, SheetTrigger } from "@wavesco/ui";
import { NotificationBell, type AuditEntry } from "@/components/notification-bell";
import { ThemeToggle } from "@/components/theme-toggle";
import { Sidebar } from "@/components/sidebar";

export interface TopbarProps {
  tenantName: string;
  email: string;
  initials: string;
  auditEntries: AuditEntry[];
  plan?: string;
}

export function Topbar({ tenantName, email, initials, auditEntries, plan }: TopbarProps) {
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-20 flex h-[56px] shrink-0 items-center justify-between gap-4 border-b border-border/60 bg-background/80 px-4 backdrop-blur-[12px] supports-[backdrop-filter]:bg-background/70 md:px-6">
      {/* Left: mobile menu + context */}
      <div className="flex min-w-0 items-center gap-3">
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" className="-ml-2 h-8 w-8 md:hidden" aria-label="Open navigation">
              <Menu className="h-[18px] w-[18px]" />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-[296px] p-0 [&>button]:hidden">
            <Sidebar plan={plan} tenantName={tenantName} onNavigate={() => { setOpen(false); }} />
          </SheetContent>
        </Sheet>

        <div className="hidden min-w-0 md:block">
          <p className="truncate text-[13px] font-[550] leading-none tracking-[-0.02em]">{tenantName}</p>
          <p className="truncate text-[11px] leading-none tracking-wide text-muted-foreground mt-1">{email}</p>
        </div>

        {/* Mobile: just show tenant */}
        <div className="min-w-0 md:hidden">
          <p className="truncate text-[13px] font-[550] tracking-[-0.02em]">{tenantName}</p>
        </div>
      </div>

      {/* Center: search — calm, not dominant */}
      <div className="hidden flex-1 justify-center px-8 lg:flex">
        <div className="flex h-8 w-full max-w-[420px] items-center gap-2 rounded-full border border-border/60 bg-muted/30 px-3 text-muted-foreground transition-colors hover:bg-muted/50">
          <Search className="h-3.5 w-3.5 shrink-0 opacity-60" />
          <span className="flex-1 truncate text-left text-[12.5px] font-[400] tracking-[-0.01em]">Search modules, orders, customers…</span>
          <span className="hidden items-center gap-1 rounded-md border bg-background px-1.5 py-0.5 text-[10px] font-medium tracking-wide sm:flex">
            <Command className="h-3 w-3" />K
          </span>
        </div>
      </div>

      {/* Right: actions */}
      <div className="flex shrink-0 items-center gap-1">
        <div className="hidden sm:flex">
          <NotificationBell entries={auditEntries} />
        </div>
        <div className="sm:hidden">
          <NotificationBell entries={auditEntries} />
        </div>
        <ThemeToggle />
        <div className="ml-1 hidden h-6 w-px bg-border/60 sm:block" />
        <div className="flex items-center gap-2.5 pl-1">
          <div className="hidden text-right sm:block">
            <p className="text-[12px] font-medium leading-none tracking-tight">{initials === "U" ? email : initials}</p>
            <p className="text-[11px] leading-none text-muted-foreground mt-0.5 hidden lg:block">Owner</p>
          </div>
          <Avatar className="h-8 w-8 border border-border/60 shadow-subtle">
            <AvatarFallback className="bg-foreground text-background text-xs font-medium tracking-wide">
              {initials}
            </AvatarFallback>
          </Avatar>
        </div>
      </div>
    </header>
  );
}

