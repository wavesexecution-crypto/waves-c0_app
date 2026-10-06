import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { getUserFromSession } from "@/lib/tenant";
import { acquisitionDenied } from "@/lib/wavesco/control";
import { getWorkflows, getExecutions } from "@/lib/wavesco/n8n";

/**
 * Shared guard for the Automation OS surfaces.
 *
 * Both handlers below proxy to n8n using the PLATFORM-WIDE `N8N_API_KEY` and
 * return workflow definitions and execution history for every tenant on the
 * platform. They previously called only `requireTenantId`, which proves a
 * session but not a role or an entitlement — so any authenticated user of any
 * workspace, including one whose Acquisition OS subscription had lapsed, could
 * enumerate and read the platform's automation internals.
 *
 * Reads are limited to owner/admin with a live entitlement. This changes no
 * UI: the Automation pages already render from these routes behind the same
 * owner/admin check.
 */
async function guard(): Promise<
  | { ok: true; tenantId: string }
  | { ok: false; response: NextResponse }
> {
  let session: unknown = null;
  try {
    session = await auth();
  } catch {
    return {
      ok: false,
      response: NextResponse.json({ error: "unauthorized" }, { status: 401 }),
    };
  }

  const user = getUserFromSession(session);
  const role = typeof user?.role === "string" ? user.role : "member";
  const tenantId = typeof user?.tenantId === "string" ? user.tenantId : null;

  if (!tenantId) {
    return {
      ok: false,
      response: NextResponse.json({ error: "unauthorized" }, { status: 401 }),
    };
  }
  if (role !== "owner" && role !== "admin") {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "forbidden", reason: "Owner role required to view automations." },
        { status: 403 },
      ),
    };
  }

  const denied = await acquisitionDenied(tenantId);
  if (denied) {
    return {
      ok: false,
      response: NextResponse.json(denied.body, { status: denied.status }),
    };
  }
  return { ok: true, tenantId };
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const gate = await guard();
  if (!gate.ok) return gate.response;
  const { path } = await params;
  const seg = path.join("/");

  if (seg === "workflows") {
    const result = await getWorkflows();
    return NextResponse.json(result);
  }

  if (seg === "executions") {
    const result = await getExecutions();
    return NextResponse.json(result);
  }

  return NextResponse.json({ error: "Not found" }, { status: 404 });
}

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const gate = await guard();
  if (!gate.ok) return gate.response;
  await params;
  // Truthful: workflow triggering from the dashboard is not implemented yet.
  return NextResponse.json(
    { ok: false, error: "Workflow triggering is not implemented. Use the n8n editor or Approval Queue." },
    { status: 501 },
  );
}