"use client";

import { Bell } from "lucide-react";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@wavesco/ui";

export interface AuditEntry {
  action: string;
  model: string;
  createdAt: string;
}

export function NotificationBell({ entries }: { entries: AuditEntry[] }) {
  const unread = entries.length;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Notifications" className="relative text-muted-foreground">
          <Bell className="h-4 w-4" />
          {unread > 0 ? (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[10px] font-semibold text-primary-foreground">
              {unread}
            </span>
          ) : null}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuLabel>Recent audit activity</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {entries.length === 0 ? (
          <div className="px-2 py-6 text-center text-sm text-muted-foreground">No activity yet.</div>
        ) : (
          entries.map((entry, index) => (
            <DropdownMenuItem key={`${entry.action}-${entry.model}-${index}`} disabled>
              <span className="flex w-full flex-col gap-0.5">
                <span className="font-mono text-xs">{entry.model}.{entry.action}</span>
                <span className="text-xs text-muted-foreground">{new Date(entry.createdAt).toLocaleString()}</span>
              </span>
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
