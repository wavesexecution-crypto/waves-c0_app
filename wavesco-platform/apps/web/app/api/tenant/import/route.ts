import { NextResponse } from "next/server";
import { requireSession } from "@wavesco/auth";
import { auth } from "@/lib/auth";
import { importTenantBlob } from "@/lib/tenant-io";

export const runtime = "nodejs";

/**
 * Imports an export blob (validated against the tenant export schema and
 * its signed token) into the requesting tenant inside a single
 * transaction.
 */
export async function POST(request: Request) {
  const session = await auth();
  const user = requireSession(session);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    await importTenantBlob(user.tenantId, body);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Import failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
