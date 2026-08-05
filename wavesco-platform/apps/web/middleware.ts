import { NextResponse, type NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";

const PROTECTED_PREFIXES = ["/overview", "/modules", "/billing", "/settings"];

function resolveAuthSecret(): string {
  // Auth.js v5 convention: AUTH_SECRET is the canonical variable.
  // NEXTAUTH_SECRET is the legacy NextAuth v4 alias — still supported.
  const secret = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      "AUTH_SECRET (or NEXTAUTH_SECRET) is missing or too short. " +
        "Set a 32+ character secret in .env. Generate one with: " +
        "node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\"",
    );
  }
  return secret;
}

export async function middleware(request: NextRequest) {
  let secret: string;
  try {
    secret = resolveAuthSecret();
  } catch (err) {
    // Surface a clear response instead of a 500 so the user sees the actual fix.
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

  const token = await getToken({ req: request, secret });
  const { pathname } = request.nextUrl;

  const isProtected = PROTECTED_PREFIXES.some((prefix) => pathname.startsWith(prefix));
  if (isProtected && !token) {
    const loginUrl = new URL("/login", request.nextUrl);
    loginUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(loginUrl);
  }

  if ((pathname === "/login" || pathname === "/signup") && token) {
    return NextResponse.redirect(new URL("/overview", request.nextUrl));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};
