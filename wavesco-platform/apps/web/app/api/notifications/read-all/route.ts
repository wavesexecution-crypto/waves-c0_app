/**
 * POST /api/notifications/read-all — Mark all notifications as read for the
 * authenticated tenant. Server-side session + RLS-enforced.
 */

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireSession } from "@wavesco/auth";
import { markAllNotificationsRead } from "@wavesco/db";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const session = await auth();
    const user = requireSession(session);
    const count = await markAllNotificationsRead(user.tenantId);
    return NextResponse.json({ ok: true, count });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("UNAUTHORIZED") || msg.includes("NEXT_REDIRECT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ error: "internal", detail: msg }, { status: 500 });
  }
}
