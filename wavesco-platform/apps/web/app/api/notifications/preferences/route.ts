/**
 * GET /api/notifications/preferences — Get notification preferences.
 * PUT /api/notifications/preferences — Update notification preferences.
 * Server-side session + RLS-enforced via withTenantContext.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireSession } from "@wavesco/auth";
import {
  getPreferences,
  updatePreferences,
  PREFERENCE_CATEGORIES,
  NOTIFICATION_CHANNELS,
  type PreferenceUpdate,
  type PreferenceCategory,
  type NotificationChannel,
} from "@wavesco/db";

export const dynamic = "force-dynamic";

async function requireUser(): Promise<{ tenantId: string }> {
  const session = await auth();
  const user = requireSession(session);
  return { tenantId: user.tenantId };
}

export async function GET() {
  try {
    const { tenantId } = await requireUser();
    const preferences = await getPreferences(tenantId);
    return NextResponse.json({ preferences });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("UNAUTHORIZED") || msg.includes("NEXT_REDIRECT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ error: "internal", detail: msg }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const { tenantId } = await requireUser();

    const body = await request.json();
    const { preferences } = body ?? {};

    if (!Array.isArray(preferences)) {
      return NextResponse.json(
        { error: "preferences must be an array" },
        { status: 400 },
      );
    }

    const validCategories = Object.values(PREFERENCE_CATEGORIES);
    const validChannels = Object.values(NOTIFICATION_CHANNELS);
    const updates: PreferenceUpdate[] = [];

    for (const pref of preferences) {
      if (
        !validCategories.includes(pref?.category) ||
        !validChannels.includes(pref?.channel) ||
        typeof pref?.enabled !== "boolean"
      ) {
        return NextResponse.json(
          { error: `Invalid preference: ${JSON.stringify(pref)}` },
          { status: 400 },
        );
      }
      updates.push({
        category: pref.category as PreferenceCategory,
        channel: pref.channel as NotificationChannel,
        enabled: pref.enabled,
      });
    }

    await updatePreferences(tenantId, updates);
    const result = await getPreferences(tenantId);
    return NextResponse.json({ preferences: result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("UNAUTHORIZED") || msg.includes("NEXT_REDIRECT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ error: "internal", detail: msg }, { status: 500 });
  }
}
