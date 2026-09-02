import { NextResponse } from "next/server";
import { consumeHandoffToken, createAppSessionCookie } from "@/lib/wavesco/handoff";
import { cookies } from "next/headers";

export const dynamic = "force-dynamic";

// POST { token: "<jwt>" } — single-use, short-lived, destination-validated, no secrets in URL
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const token = (body as any)?.token as string | undefined;
    if (!token || typeof token !== "string") {
      return NextResponse.json({ error: "token required" }, { status: 400 });
    }

    const { tenantId, userId, email, destination } = await consumeHandoffToken(token);

    // Create NextAuth session cookie for app.wavesco.in
    // Use same secret and tenantId claim as normal sign-in
    const sessionToken = await createAppSessionCookie({ userId, tenantId, email, role: "owner" });

    const cookieStore = await cookies();
    const domain = process.env.NEXTAUTH_COOKIE_DOMAIN || undefined;
    // NextAuth v5 cookie name is __Secure-authjs.session-token when secure
    const cookieName = "__Secure-authjs.session-token";
    cookieStore.set(cookieName, sessionToken, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: 30 * 24 * 60 * 60,
      ...(domain ? { domain } : {}),
    });
    // Also set non-secure fallback for http dev
    if (process.env.NODE_ENV !== "production") {
      cookieStore.set("authjs.session-token", sessionToken, {
        httpOnly: true,
        secure: false,
        sameSite: "lax",
        path: "/",
        maxAge: 30 * 24 * 60 * 60,
      });
    }

    // Validate destination is still allowed (prevent open redirect)
    let safeDestination = "/command";
    try {
      const destUrl = new URL(destination);
      const allowed = ["wavesco.in", "app.wavesco.in", "www.wavesco.in", "dev.wavesco.in", "localhost", "127.0.0.1"];
      const host = destUrl.hostname;
      const ok = allowed.some((h) => host === h || host.endsWith(`.${h}`)) || host === "localhost";
      if (ok) safeDestination = destination;
    } catch {
      safeDestination = "/command";
    }

    return NextResponse.json({ ok: true, destination: safeDestination, tenantId, userId });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // Map known errors to 401/400
    if (msg.includes("Invalid handoff") || msg.includes("expired") || msg.includes("already used") || msg.includes("not found") || msg.includes("mismatch")) {
      return NextResponse.json({ error: msg }, { status: 401 });
    }
    return NextResponse.json({ error: "internal", detail: msg }, { status: 500 });
  }
}
