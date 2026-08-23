import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireApiUser } from "@/lib/api";
import { buildExportBlob } from "@/lib/tenant-io";

export const runtime = "nodejs";

/**
 * Exports the full tenant data set as a JSON blob signed with a one-time
 * token (24h expiry). The blob is accepted by POST /api/tenant/import.
 */
export async function POST() {
  const session = await auth();
  const { user, response } = requireApiUser(session);
  if (response) return response;

  const blob = await buildExportBlob(user.tenantId);
  return NextResponse.json(blob);
}
