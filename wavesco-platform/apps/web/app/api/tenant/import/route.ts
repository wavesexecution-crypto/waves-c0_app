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
  const user = requireSession(session) as { tenantId?: string; role?: string };
  // Importing a blob overwrites this tenant's user roles. Without an
  // owner/admin gate, any member could export their own tenant's blob, edit
  // the roles array, and re-import to mint themselves `owner`.
  const role = typeof user?.role === "string" ? user.role : "member";
  if (role !== "owner" && role !== "admin") {
    return NextResponse.json({ error: "Owner or admin role required." }, { status: 403 });
  }
  if (!user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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
