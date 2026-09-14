"use client";

import type { ReactNode } from "react";
import { Avatar, AvatarFallback } from "@wavesco/ui";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@wavesco/ui";
import { NotificationBell } from "@/components/notification-bell";
import { MobileNav } from "@/components/mobile-nav";
import { ThemeToggle } from "@/components/theme-toggle";
import type { AuditEntry } from "@/components/notification-bell";
import { signOut } from "next-auth/react";
import Link from "next/link";

export interface TopbarProps {
  tenantName: string;
  email: string;
  initials: string;
  auditEntries: AuditEntry[];
  name?: string;
  milestoneNotifications?: ReactNode;
}

export function Topbar({ tenantName, email, initials, auditEntries, name, milestoneNotifications }: TopbarProps) {
  const displayName = name || email.split("@")[0] || "Waves User";

  return (
    <header className="sticky top-0 z-30 flex h-[56px] items-center justify-between border-b border-border/60 bg-background/80 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/60 sm:px-8">
      <div className="flex min-w-0 items-center gap-1">
        <MobileNav />
        <div className="min-w-0">
        <p className="font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
          {tenantName}
        </p>
        <p className="hidden truncate text-xs text-muted-foreground sm:block">
          Acquisition OS · operating
        </p>
        </div>
      </div>
      <div className="flex items-center gap-1.5">
        {milestoneNotifications}
        <NotificationBell entries={auditEntries} />
        <ThemeToggle />
        <div className="ml-1 h-6 w-px bg-border/60" />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="ml-1 flex h-9 w-9 items-center justify-center rounded-full bg-primary text-[13px] font-medium text-primary-foreground transition hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              aria-label="Profile menu"
            >
              <Avatar className="h-9 w-9">
                <AvatarFallback className="bg-primary text-primary-foreground text-[13px] font-medium">
                  {initials}
                </AvatarFallback>
              </Avatar>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64 p-2">
            <DropdownMenuLabel className="px-2 py-2">
              <div className="flex flex-col gap-1">
                <p className="text-sm font-medium leading-none">{displayName}</p>
                <p className="truncate text-xs font-normal leading-none text-muted-foreground">{email}</p>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator className="my-2" />
            <div className="space-y-0.5">
              <DropdownMenuItem asChild className="px-2 py-2 text-sm">
                <Link href="/settings" className="w-full cursor-pointer">
                  Profile & account
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild className="px-2 py-2 text-sm">
                <Link href="/settings" className="w-full cursor-pointer">
                  Security
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild className="px-2 py-2 text-sm">
                <Link href="/products" className="w-full cursor-pointer">
                  Billing
                </Link>
              </DropdownMenuItem>
            </div>
            <DropdownMenuSeparator className="my-2" />
            <DropdownMenuItem
              className="cursor-pointer px-2 py-2 text-sm text-muted-foreground focus:text-foreground"
              onClick={() => signOut({ callbackUrl: "/login" })}
            >
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
