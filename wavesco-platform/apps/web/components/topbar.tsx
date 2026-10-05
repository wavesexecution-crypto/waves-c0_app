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
import { ThemeToggle } from "@/components/theme-toggle";
import type { AuditEntry } from "@/components/notification-bell";
import { MobileNav } from "@/components/mobile-nav";
import { signOut } from "next-auth/react";
import Link from "next/link";

export interface TopbarProps {
  tenantName: string;
  email: string;
  initials: string;
  auditEntries: AuditEntry[];
  name?: string;
  milestoneNotifications?: ReactNode;
  internalAccess?: boolean;
}

export function Topbar({
  tenantName,
  email,
  initials,
  auditEntries,
  name,
  milestoneNotifications,
  internalAccess = false,
}: TopbarProps) {
  const displayName = name ?? email.split("@")[0] ?? "Waves User";

  return (
    <header className="flex h-[56px] shrink-0 items-center justify-between gap-2 border-b border-border/60 bg-card/80 px-4 backdrop-blur-sm sm:gap-4 sm:px-6">
      <MobileNav internalAccess={internalAccess} />
      <div className="min-w-0 flex-1">
        <p className="truncate font-sans text-[13px] font-medium tracking-[-0.01em] text-foreground">{tenantName}</p>
        <p className="hidden truncate font-mono text-[11px] tracking-[0.02em] text-muted-foreground/60 sm:block">
          One Waves account across all platforms
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {milestoneNotifications}
        <NotificationBell entries={auditEntries} />
        <ThemeToggle />
        <div className="ml-1 h-4 w-px shrink-0 bg-border/60" />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="rounded-md p-0.5 focus:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-0"
              aria-label="Profile menu"
            >
              <Avatar className="h-7 w-7 cursor-pointer rounded-md border border-border">
                <AvatarFallback className="rounded-md bg-secondary font-mono text-[11px] font-medium text-foreground">
                  {initials}
                </AvatarFallback>
              </Avatar>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64 rounded-lg border-border bg-card">
            <DropdownMenuLabel>
              <div className="flex flex-col space-y-1">
                <p className="font-sans text-sm font-medium leading-none tracking-[-0.01em] text-foreground">{displayName}</p>
                <p className="truncate font-mono text-xs leading-none text-muted-foreground">{email}</p>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator className="bg-border/60" />
            <DropdownMenuItem asChild>
              <Link href="/settings" className="w-full cursor-pointer font-sans text-[13px]">
                Workspace settings
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href="/billing" className="w-full cursor-pointer font-sans text-[13px]">
                Billing
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href="/products" className="w-full cursor-pointer font-sans text-[13px]">
                Your Products
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href="/command" className="w-full cursor-pointer font-sans text-[13px]">
                Command Center
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator className="bg-border/60" />
            <DropdownMenuItem
              className="cursor-pointer font-sans text-[13px] text-destructive focus:text-destructive"
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
