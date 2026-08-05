import { createHash, randomBytes } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { withTenantContext } from "@wavesco/db";

export interface AccessTokenClaims {
  sub: string;
  tenantId: string;
  email: string;
  role: string;
  name?: string;
}

export interface VerifiedAccessToken {
  sub: string;
  tenantId: string;
  email: string;
  role: string;
}

function getJwtSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET ?? process.env.NEXTAUTH_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET (or NEXTAUTH_SECRET) must be set before signing tokens.");
  }
  return new TextEncoder().encode(secret);
}

export function parseDuration(ttl: string): number {
  const match = /^(\d+)(s|m|h|d)$/.exec(ttl.trim());
  if (!match) {
    throw new Error(`Invalid TTL "${ttl}". Use a format like "15m", "8h" or "30d".`);
  }
  const value = Number(match[1]);
  const unit = match[2] ?? "s";
  const multiplier: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };
  return value * (multiplier[unit] ?? 1);
}

export async function signAccessToken(claims: AccessTokenClaims): Promise<string> {
  const ttlSeconds = parseDuration(process.env.ACCESS_TOKEN_TTL ?? "15m");
  const now = Math.floor(Date.now() / 1000);

  return new SignJWT({
    tenantId: claims.tenantId,
    email: claims.email,
    role: claims.role,
    name: claims.name ?? "",
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.sub)
    .setIssuedAt(now)
    .setExpirationTime(now + ttlSeconds)
    .sign(getJwtSecret());
}

export async function verifyAccessToken(token: string): Promise<VerifiedAccessToken> {
  const { payload } = await jwtVerify(token, getJwtSecret(), { algorithms: ["HS256"] });
  const sub = payload.sub;
  const tenantId = payload.tenantId;
  const email = payload.email;
  const role = payload.role;
  if (typeof sub !== "string" || typeof tenantId !== "string" || typeof role !== "string") {
    throw new Error("Access token is missing required claims (sub, tenantId, role).");
  }
  return {
    sub,
    tenantId,
    email: typeof email === "string" ? email : "",
    role,
  };
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export interface RefreshTokenResult {
  token: string;
  tokenId: string;
  expiresAt: Date;
}

/**
 * Issues a new refresh token, storing only its SHA-256 hash in the DB
 * inside the tenant context (RLS-enforced).
 */
export async function rotateRefreshToken(
  userId: string,
  tenantId: string,
): Promise<RefreshTokenResult> {
  const raw = randomBytes(32).toString("hex");
  const tokenId = `rt_${randomBytes(12).toString("hex")}`;
  const ttlMs = parseDuration(process.env.REFRESH_TOKEN_TTL ?? "30d") * 1000;
  const expiresAt = new Date(Date.now() + ttlMs);

  await withTenantContext(tenantId, async (tx) => {
    await tx.refreshToken.create({
      data: { id: tokenId, tenantId, userId, tokenHash: sha256(raw), expiresAt },
    });
  });

  return { token: raw, tokenId, expiresAt };
}

export async function revokeRefreshToken(tenantId: string, token: string): Promise<void> {
  const tokenHash = sha256(token);
  await withTenantContext(tenantId, async (tx) => {
    await tx.refreshToken.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  });
}

export function hashToken(token: string): string {
  return sha256(token);
}
