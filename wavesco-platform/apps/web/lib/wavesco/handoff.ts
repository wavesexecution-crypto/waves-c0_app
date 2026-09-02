import { createHash, randomBytes } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { withTenantContext } from "@wavesco/db";
import { encode } from "next-auth/jwt";

function getHandoffSecret(): Uint8Array {
  const s = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET ?? process.env.JWT_SECRET;
  if (!s || s.length < 32) throw new Error("Handoff secret missing or too short");
  return new TextEncoder().encode(s);
}

function sha256(v: string): string {
  return createHash("sha256").update(v).digest("hex");
}

export interface HandoffClaims {
  sub: string; // userId
  tenantId: string;
  email: string;
  jti: string;
  aud: string; // app.wavesco.in
  destination: string; // validated absolute URL on *.wavesco.in
  iat: number;
  exp: number;
}

export async function createHandoffToken(args: {
  userId: string;
  tenantId: string;
  email: string;
  destination: string;
}): Promise<{ token: string; jti: string; expiresAt: Date }> {
  const jti = `handoff_${randomBytes(12).toString("hex")}`;
  const now = Math.floor(Date.now() / 1000);
  const exp = now + 5 * 60; // 5 minutes short-lived
  const aud = "app.wavesco.in";

  // Validate destination is on *.wavesco.in to prevent open redirect
  const destUrl = new URL(args.destination);
  const allowedHosts = ["wavesco.in", "app.wavesco.in", "www.wavesco.in", "dev.wavesco.in"];
  const host = destUrl.hostname;
  const isAllowed = allowedHosts.some((h) => host === h || host.endsWith(`.${h}`)) || host === "localhost";
  if (!isAllowed) throw new Error("Invalid destination host");

  const token = await new SignJWT({
    tenantId: args.tenantId,
    email: args.email,
    jti,
    destination: args.destination,
  } as any)
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(args.userId)
    .setAudience(aud)
    .setIssuedAt(now)
    .setExpirationTime(exp)
    .setJti(jti)
    .sign(getHandoffSecret());

  const expiresAt = new Date(exp * 1000);

  // Persist jti for single-use / replay prevention (RLS via withTenantContext)
  await withTenantContext(args.tenantId, async (tx: any) => {
    await tx.wavesHandoffToken.create({
      data: {
        jti,
        tenantId: args.tenantId,
        userId: args.userId,
        destination: args.destination,
        expiresAt,
      },
    });
  });

  return { token, jti, expiresAt };
}

export async function consumeHandoffToken(token: string): Promise<{ tenantId: string; userId: string; email: string; destination: string; jti: string }> {
  const secret = getHandoffSecret();
  let payload: any;
  try {
    const { payload: p } = await jwtVerify(token, secret, { audience: "app.wavesco.in", algorithms: ["HS256"] });
    payload = p;
  } catch (e) {
    throw new Error(`Invalid handoff: ${e instanceof Error ? e.message : String(e)}`);
  }

  const sub = payload.sub as string | undefined;
  const tenantId = (payload as any).tenantId as string | undefined;
  const email = (payload as any).email as string | undefined;
  const jti = (payload as any).jti as string | undefined;
  const destination = (payload as any).destination as string | undefined;
  const exp = payload.exp as number | undefined;

  if (!sub || !tenantId || !jti || !destination) throw new Error("Handoff missing required claims");
  if (exp && Date.now() / 1000 > exp) throw new Error("Handoff expired");

  // Validate destination again
  try {
    const destUrl = new URL(destination);
    const allowedHosts = ["wavesco.in", "app.wavesco.in", "www.wavesco.in", "dev.wavesco.in"];
    const host = destUrl.hostname;
    const isAllowed = allowedHosts.some((h) => host === h || host.endsWith(`.${h}`)) || host === "localhost";
    if (!isAllowed) throw new Error("Invalid destination");
  } catch {
    throw new Error("Invalid destination");
  }

  // Check single-use: jti must exist and not already used, and not expired
  const result = await withTenantContext(tenantId, async (tx: any) => {
    const row = await tx.wavesHandoffToken.findUnique({ where: { jti } });
    if (!row) throw new Error("Handoff not found — invalid jti");
    if (row.usedAt) throw new Error("Handoff already used — replay rejected");
    if (row.expiresAt < new Date()) throw new Error("Handoff expired");
    if (row.tenantId !== tenantId || row.userId !== sub) throw new Error("Handoff tenant/user mismatch");
    if (row.destination !== destination) throw new Error("Handoff destination mismatch");
    // Mark used
    await tx.wavesHandoffToken.update({ where: { jti }, data: { usedAt: new Date() } });
    return row;
  });

  void result;

  return { tenantId, userId: sub, email: email || "", destination, jti };
}

// Helper to create a NextAuth session cookie value for the handoff user
// Uses next-auth/jwt encode with same secret and tenantId claim
export async function createAppSessionCookie(args: { userId: string; tenantId: string; email: string; role?: string }): Promise<string> {
  const secret = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET missing");
  const token = await encode({
    token: {
      id: args.userId,
      tenantId: args.tenantId,
      email: args.email,
      role: args.role ?? "owner",
      name: args.email,
    } as any,
    secret,
    maxAge: 30 * 24 * 60 * 60,
  });
  return token;
}

export function hashTokenForAudit(token: string): string {
  return sha256(token);
}
