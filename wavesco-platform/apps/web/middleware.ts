import { NextResponse, type NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";

const PROTECTED_PREFIXES = [
  "/overview",
  "/system",
  "/modules",
  "/analytics",
  "/ai",
  "/activity",
  "/billing",
  "/support",
  "/settings",
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
    const loginUrl = new URL("/login", request.nextUrl);
    const callback = pathname + request.nextUrl.search;
    if (callback !== "/login" && callback !== "/signup" && !callback.startsWith("/login?") && !callback.startsWith("/signup?")) {
      loginUrl.searchParams.set("callbackUrl", callback);
    }
    const res = NextResponse.redirect(loginUrl);
    // If a stale invalid session cookie exists, clear it to break loops
    if (token === null && request.cookies.has("authjs.session-token")) {
      res.cookies.set("authjs.session-token", "", { maxAge: 0, path: "/" });
      res.cookies.set("__Secure-authjs.session-token", "", { maxAge: 0, path: "/" });
    }
    return res;
  }

  if ((pathname === "/login" || pathname === "/signup") && isAuthenticated) {
    const callbackUrl = request.nextUrl.searchParams.get("callbackUrl");
    const isSafeCallback = callbackUrl && callbackUrl.startsWith("/") && !callbackUrl.startsWith("//") && callbackUrl !== "/login" && callbackUrl !== "/signup" && !callbackUrl.startsWith("/login?") && !callbackUrl.startsWith("/signup?");
    if (isSafeCallback) {
      return NextResponse.redirect(new URL(callbackUrl, request.nextUrl));
    }
    return NextResponse.redirect(new URL("/overview", request.nextUrl));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};
