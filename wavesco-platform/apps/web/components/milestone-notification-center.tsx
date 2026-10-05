"use client";

/**
 * MilestoneNotificationCenter — in-app panel for the Acquisition OS milestone
 * notification engine.
 *
 * Server wrapper (`milestone-notification-center.server.tsx`) loads the initial
 * list through withTenantContext (RLS); this client component renders it,
 * keeps the unread badge live, and marks notifications read / all read.
 */

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { Bell, Check, CheckCheck, Inbox } from "lucide-react";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@wavesco/ui";

export interface MsnNotification {
  id: string;
  eventType: string;
  title: string;
  message: string;
  cycleId: string | null;
  campaignId: string | null;
  resourceType: string | null;
  resourceHref: string | null;
  channel: string;
  read: boolean;
  readAt: string | null;
  createdAt: string;
}

interface MsnPayload {
  notifications: MsnNotification[];
  total: number;
  unreadCount: number;
}

function relativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMin = Math.floor((now - then) / 60_000);
  if (diffMin < 1) return "Just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d ago`;
  return new Date(dateStr).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

const EVENT_DOT_COLORS: Record<string, string> = {
  CYCLE_STARTED: "bg-primary",
  LEAD_GENERATION_COMPLETED: "bg-emerald-500",
  LEAD_REPORT_READY: "bg-primary",
  EMAILS_READY_FOR_REVIEW: "bg-indigo-500",
  CAMPAIGN_DEPLOYED: "bg-primary",
  NEW_RESPONSES_DETECTED: "bg-emerald-500",
  POSITIVE_RESPONSE_DETECTED: "bg-emerald-500",
  FOLLOW_UP_READY: "bg-indigo-500",
  FOLLOW_UP_WINDOW_COMPLETED: "bg-primary",
  CAMPAIGN_RESULTS_FINALIZED: "bg-primary",
  CYCLE_REPORT_READY: "bg-primary",
};

export function MilestoneNotificationCenter({
  initial,
}: {
  initial: MsnPayload;
}) {
  const [notifications, setNotifications] = useState<MsnNotification[]>(initial.notifications);
  const [unreadCount, setUnreadCount] = useState(initial.unreadCount);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/notifications?limit=20", { cache: "no-store" });
      if (!res.ok) return;
      const data: MsnPayload = await res.json();
      setNotifications(data.notifications);
      setUnreadCount(data.unreadCount);
    } catch {
      // keep current state on transient failure
    }
  }, []);

  useEffect(() => {
    // Poll while the dropdown is considered reachable; light and idempotent.
    const id = window.setInterval(() => void refresh(), 30_000);
    return () => window.clearInterval(id);
  }, [refresh]);

  const markRead = useCallback(
    async (id: string) => {
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, read: true } : n)),
      );
      setUnreadCount((c) => Math.max(0, c - 1));
      try {
        await fetch(`/api/notifications/${id}/read`, { method: "POST" });
      } catch {
        // optimistic; next poll reconciles
      }
    },
    [],
  );

  const markAllRead = useCallback(async () => {
    try {
      await fetch("/api/notifications/read-all", { method: "POST" });
    } catch {
      // ignore
    }
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    setUnreadCount(0);
  }, []);

  return (
    <DropdownMenu onOpenChange={(open) => open && void refresh()}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Milestone notifications" className="relative text-muted-foreground">
          <Bell className="h-4 w-4" />
          {unreadCount > 0 ? (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[10px] font-semibold text-primary-foreground">
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          ) : null}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[min(22rem,calc(100vw-1rem))]">
        <div className="flex items-center justify-between px-2 py-1.5">
          <DropdownMenuLabel>Notifications</DropdownMenuLabel>
          {unreadCount > 0 ? (
            <Button variant="ghost" size="sm" className="h-6 gap-1 text-xs" onClick={markAllRead}>
              <CheckCheck className="h-3.5 w-3.5" /> Mark all read
            </Button>
          ) : null}
        </div>
        <DropdownMenuSeparator />
        {notifications.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-2 py-8 text-center text-sm text-muted-foreground">
            <Inbox className="h-6 w-6" />
            <span>Nothing here yet.</span>
            <span className="max-w-[16rem] text-xs">
              You will be notified when leads finish generating, a campaign needs approval, a prospect replies, or a
              report is ready.
            </span>
          </div>
        ) : (
          notifications.slice(0, 10).map((n) => (
            <DropdownMenuItem
              key={n.id}
              className="cursor-pointer items-start gap-2 whitespace-normal py-2"
              onClick={() => void markRead(n.id)}
              asChild
            >
              {/* The destination was loaded but never rendered, so every
                  notification was a dead end: clicking only marked it read. */}
              <Link href={n.resourceHref ?? "/acquisition"}>
                <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${EVENT_DOT_COLORS[n.eventType] ?? "bg-muted"}`} />
                <span className="flex w-full min-w-0 flex-col gap-0.5">
                  <span className={`text-sm ${n.read ? "text-muted-foreground" : "font-semibold text-foreground"}`}>
                    {n.title}
                  </span>
                  <span className="line-clamp-2 text-xs text-muted-foreground">{n.message}</span>
                  <span className="text-[11px] text-muted-foreground/70">{relativeTime(n.createdAt)}</span>
                </span>
                {n.read ? <Check className="mt-1 h-3.5 w-3.5 shrink-0 text-muted-foreground" /> : null}
              </Link>
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
