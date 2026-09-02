import { NextResponse, type NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";

const PROTECTED_PREFIXES = [
  "/command",
  "/overview",
  "/acquisition",
  "/products",
  "/clients",
  "/automation",
  "/intelligence",
  "/knowledge",
  "/modules",
  "/billing",
  "/settings",
  "/system",
  "/analytics",
  "/ai",
  "/activity",
  "/support",
];




function resolveAuthSecret(): string {
  const secret = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("AUTH_SECRET is missing or too short. Set a 32+ char secret in .env.");
  }
  return secret;
}

export async function middleware(request: NextRequest) {
  let secret: string;
  try {
    secret = resolveAuthSecret();
  } catch (err) {
    const message = err instanceof Error ? err.message : "Auth secret not configured.";
    return new NextResponse(
      JSON.stringify({
        error: "auth_secret_missing",
        message,
        fix: "Set AUTH_SECRET in .env (or NEXTAUTH_SECRET for legacy). See README.",
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  const token = (await getToken({
    req: request,
    secret,
    // Match Auth.js cookie naming: secure cookies are prefixed `__Secure-`
    // and are used whenever the app is served over HTTPS (i.e. production).
    // Without this, getToken reads the non-secure cookie name behind the
    // proxy and every authenticated page request redirects to /login.
    secureCookie: request.nextUrl.protocol === "https:",
  })) as unknown as
    | { tenantId?: string; role?: string }
    | null;

  const isAuthenticated = typeof token?.tenantId === "string" && token.tenantId.length > 0;
  const { pathname } = request.nextUrl;

  const isProtected = PROTECTED_PREFIXES.some((prefix) => pathname.startsWith(prefix));
  if (isProtected && !isAuthenticated) {
    // Waves identity: app.wavesco.in has no independent login — redirect to main Waves site
    const wavesMain = (process.env.WAVES_MAIN_URL || "https://wavesco.in").replace(/\/$/, "");
    const host = request.headers.get("host") || request.nextUrl.host || "";
    const isAppHost = host.includes("app.wavesco.in") || host.includes("app.wavesco") ;
    const isLocal = host.includes("localhost") || host.includes("127.0.0.1");
    const callback = pathname + request.nextUrl.search;
    const hasValidCallback =
      callback !== "/login" &&
      callback !== "/signup" &&
      !callback.startsWith("/login?") &&
      !callback.startsWith("/signup?");
    // Only use cross-domain handoff in production app host; local dev keeps local /login for testability
    const useWavesLogin = isAppHost && !isLocal && wavesMain.startsWith("https://");
    let loginUrl: URL;
    if (useWavesLogin) {
      // Validate callbackUrl destination is same app host to prevent open redirect
      const appOrigin = `${request.nextUrl.protocol}//${host}`;
      const intended = hasValidCallback ? new URL(callback, appOrigin).toString() : appOrigin + "/command";
      // Only allow *.wavesco.in destinations
      let safeCallback = intended;
      try {
        const dest = new URL(intended);
        const allowed = ["wavesco.in", "app.wavesco.in", "www.wavesco.in"];
        const ok = allowed.some((h) => dest.hostname === h || dest.hostname.endsWith(`.${h}`));
        if (!ok) safeCallback = `${appOrigin}/command`;
      } catch {
        safeCallback = `${appOrigin}/command`;
      }
      loginUrl = new URL("/login", wavesMain);
      loginUrl.searchParams.set("callbackUrl", safeCallback);
    } else {
      loginUrl = new URL("/login", request.nextUrl);
      if (hasValidCallback) loginUrl.searchParams.set("callbackUrl", callback);
    }
    const res = NextResponse.redirect(loginUrl);
    if (token === null && request.cookies.has("authjs.session-token")) {
      res.cookies.set("authjs.session-token", "", { maxAge: 0, path: "/" });
      res.cookies.set("__Secure-authjs.session-token", "", { maxAge: 0, path: "/" });
    }
    return res;
  }

  if ((pathname === "/login" || pathname === "/signup") && token) {
    return NextResponse.redirect(new URL("/command", request.nextUrl));

  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};
