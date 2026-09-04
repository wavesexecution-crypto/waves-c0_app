"use client";

import type { ReactNode } from "react";

import { Avatar, AvatarFallback } from "@wavesco/ui";
import { Button } from "@wavesco/ui";
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
    <header className="flex h-14 items-center justify-between border-b px-6 bg-card">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{tenantName}</p>
        <p className="truncate text-xs text-muted-foreground">One Waves account across all platforms.</p>
      </div>
      <div className="flex items-center gap-2">
        {milestoneNotifications}
        <NotificationBell entries={auditEntries} />
        <ThemeToggle />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="rounded-full focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2" aria-label="Profile menu">
              <Avatar className="h-8 w-8 cursor-pointer">
                <AvatarFallback className="bg-primary text-primary-foreground text-xs">{initials}</AvatarFallback>
              </Avatar>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            <DropdownMenuLabel>
              <div className="flex flex-col space-y-1">
                <p className="text-sm font-medium leading-none">{displayName}</p>
                <p className="text-xs leading-none text-muted-foreground truncate">{email}</p>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/settings" className="w-full cursor-pointer">Profile</Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href="/settings" className="w-full cursor-pointer">Account</Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href="/settings" className="w-full cursor-pointer">Security</Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href="/products" className="w-full cursor-pointer">Billing</Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href="/settings" className="w-full cursor-pointer">Settings</Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="cursor-pointer text-destructive focus:text-destructive"
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

