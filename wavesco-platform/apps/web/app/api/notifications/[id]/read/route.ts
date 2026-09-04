/**
 * POST /api/notifications/[id]/read — Mark a single notification as read.
 * Server-side session + RLS-enforced via withTenantContext.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireSession } from "@wavesco/auth";
import { markNotificationRead } from "@wavesco/db";

export const dynamic = "force-dynamic";

export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    const user = requireSession(session);

    const { id } = await ctx.params;
    const updated = await markNotificationRead(user.tenantId, id);

    return NextResponse.json({ ok: updated });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("UNAUTHORIZED") || msg.includes("NEXT_REDIRECT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ error: "internal", detail: msg }, { status: 500 });
  }
}
