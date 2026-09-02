import { NextResponse } from "next/server";
import { requireControlAuth, auditControl } from "@/lib/wavesco/control";
import { createHandoffToken } from "@/lib/wavesco/handoff";

export const dynamic = "force-dynamic";

function isUnauthorized(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  const d = (e as any)?.digest as string | undefined;
  return msg.includes("UNAUTHORIZED") || msg.includes("NEXT_REDIRECT") || !!(d && d.includes("NEXT_REDIRECT"));
}

// POST { destination: "https://app.wavesco.in/command" }
export async function POST(req: Request) {
  try {
    const { tenantId, userId } = await requireControlAuth();
    const body = await req.json().catch(() => ({}));
    const destination = (body as any)?.destination as string | undefined;
    if (!destination || typeof destination !== "string") {
      return NextResponse.json({ error: "destination required" }, { status: 400 });
    }
    let destUrl: URL;
    try {
      destUrl = new URL(destination);
    } catch {
      return NextResponse.json({ error: "invalid destination" }, { status: 400 });
    }
    const allowed = ["wavesco.in", "app.wavesco.in", "www.wavesco.in", "dev.wavesco.in", "localhost", "127.0.0.1"];
    const host = destUrl.hostname;
    const isAllowed = allowed.some((h) => host === h || host.endsWith(`.${h}`)) || host === "localhost";
    if (!isAllowed) {
      return NextResponse.json({ error: "destination not allowed" }, { status: 400 });
    }

    const session = await requireControlAuth().then((r) => r.session).catch(() => null);
    const email = ((session as any)?.user?.email as string | undefined) || "";

    const { token, jti, expiresAt } = await createHandoffToken({ userId: userId!, tenantId, email, destination });

    await auditControl({
      tenantId,
      userId,
      action: "waves.handoff.create",
      model: "WavesHandoffToken",
      recordId: jti,
      after: { destination, expiresAt: expiresAt.toISOString() },
      metadata: { jtiHash: jti.slice(0, 8) + "***" },
    });

    // Do NOT log raw token, do NOT put in URL query — return in POST body for form submission
    return NextResponse.json({ ok: true, jti, expiresAt: expiresAt.toISOString(), token });
  } catch (e) {
    if (isUnauthorized(e)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: "internal", detail: msg }, { status: 500 });
  }
}
