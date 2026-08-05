"use client";

import { Avatar, AvatarFallback } from "@wavesco/ui";
import { NotificationBell } from "@/components/notification-bell";
import { ThemeToggle } from "@/components/theme-toggle";
import type { AuditEntry } from "@/components/notification-bell";

export interface TopbarProps {
  tenantName: string;
  email: string;
  initials: string;
  auditEntries: AuditEntry[];
}

export function Topbar({ tenantName, email, initials, auditEntries }: TopbarProps) {
  return (
    <header className="flex h-14 items-center justify-between border-b px-6">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{tenantName}</p>
        <p className="truncate text-xs text-muted-foreground">{email}</p>
      </div>
      <div className="flex items-center gap-2">
        <NotificationBell entries={auditEntries} />
        <ThemeToggle />
        <Avatar>
          <AvatarFallback>{initials}</AvatarFallback>
        </Avatar>
      </div>
    </header>
  );
}
