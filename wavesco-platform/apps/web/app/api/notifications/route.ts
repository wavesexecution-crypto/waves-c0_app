/**
 * GET /api/notifications — List client-facing milestone notifications for the
 * authenticated tenant (server-side session; RLS-enforced via withTenantContext).
 * POST /api/notifications — Create a notification (internal only; the engine
 * creates notifications from real lifecycle transitions, never the client).
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireSession } from "@wavesco/auth";
import {
  listNotifications,
  createNotification,
  NOTIFICATION_EVENT_TYPES,
  type NotificationEventType,
} from "@wavesco/db";

export const dynamic = "force-dynamic";

async function requireUser(): Promise<{ tenantId: string; userId: string; role: string }> {
  const session = await auth();
  const user = requireSession(session);
  return { tenantId: user.tenantId, userId: user.id, role: user.role };
}

export async function GET(request: NextRequest) {
  try {
    const user = await requireUser();

    const { searchParams } = new URL(request.url);
    const limit = Math.min(parseInt(searchParams.get("limit") ?? "50", 10), 100);
    const offset = Math.max(parseInt(searchParams.get("offset") ?? "0", 10), 0);
    const unreadOnly = searchParams.get("unreadOnly") === "true";
    const eventTypeRaw = searchParams.get("eventType");

    let eventType: NotificationEventType | undefined;
    if (eventTypeRaw) {
      if (!Object.values(NOTIFICATION_EVENT_TYPES).includes(eventTypeRaw as NotificationEventType)) {
        return NextResponse.json({ error: "Invalid eventType" }, { status: 400 });
      }
      eventType = eventTypeRaw as NotificationEventType;
    }

    const result = await listNotifications({
      tenantId: user.tenantId,
      userId: user.userId,
      unreadOnly,
      limit,
      offset,
      eventType,
    });

    return NextResponse.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (
      msg === "UNAUTHORIZED" ||
      msg.includes("UNAUTHORIZED") ||
      msg.includes("NEXT_REDIRECT")
    ) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ error: "internal", detail: msg }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireUser();

    // Engine only — the client must not create notifications.
    // Requiring an internal role keeps this from being a public write path.
    if (user.role !== "owner" && user.role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await request.json();
    const { eventType, cycleId, campaignId, context, deduplicationSuffix, channel } = body;

    if (!eventType || !Object.values(NOTIFICATION_EVENT_TYPES).includes(eventType)) {
      return NextResponse.json({ error: "Invalid eventType" }, { status: 400 });
    }

    const result = await createNotification({
      tenantId: user.tenantId,
      userId: user.userId,
      eventType: eventType as NotificationEventType,
      cycleId: cycleId ?? undefined,
      campaignId: campaignId ?? undefined,
      context: context ?? {},
      deduplicationSuffix: deduplicationSuffix ?? undefined,
      channel: channel ?? undefined,
    });

    return NextResponse.json(result, { status: result.created ? 201 : 200 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("UNAUTHORIZED") || msg.includes("NEXT_REDIRECT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ error: "internal", detail: msg }, { status: 500 });
  }
}
