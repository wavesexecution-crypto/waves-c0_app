import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { requireTenantId } from "@/lib/tenant";
import { getWorkflows, getExecutions } from "@/lib/wavesco/n8n";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const session = await auth();
  requireTenantId(session as unknown); // session guard — no anonymous proxy access
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
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const session = await auth();
  requireTenantId(session as unknown);
  const { path } = await params;
  // Truthful: workflow triggering from the dashboard is not implemented yet.
  return NextResponse.json(
    { ok: false, error: "Workflow triggering is not implemented. Use the n8n editor or Approval Queue." },
    { status: 501 },
  );
}
