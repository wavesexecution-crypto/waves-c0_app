import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { requireTenantId } from "@/lib/tenant";

/**
 * Google Workspace proxy — NOT BUILT YET.
 * Returns a truthful 501 (never a fake success) until the Google
 * integration ships.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const session = await auth();
  requireTenantId(session as unknown);
  const { path } = await params;
  return NextResponse.json({ ok: false, error: "Google Workspace integration is not built yet.", path }, { status: 501 });
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const session = await auth();
  requireTenantId(session as unknown);
  const { path } = await params;
  return NextResponse.json({ ok: false, error: "Google Workspace integration is not built yet.", path }, { status: 501 });
}
