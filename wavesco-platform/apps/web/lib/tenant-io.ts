import { SignJWT, jwtVerify } from "jose";
import { withTenantContext } from "@wavesco/db";
import { tenantExportSchema, type TenantExportBlob } from "@wavesco/validators";

const EXPORT_TTL_SECONDS = 24 * 60 * 60;

function getExportSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET ?? process.env.NEXTAUTH_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET (or NEXTAUTH_SECRET) must be set for tenant export/import.");
  }
  return new TextEncoder().encode(secret);
}

export interface ExportTokenClaims {
  sub: string;
  purpose: "tenant-export";
}

export async function signExportToken(tenantId: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ purpose: "tenant-export" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(tenantId)
    .setIssuedAt(now)
    .setExpirationTime(now + EXPORT_TTL_SECONDS)
    .sign(getExportSecret());
}

export async function verifyExportToken(token: string): Promise<ExportTokenClaims> {
  const { payload } = await jwtVerify(token, getExportSecret(), { algorithms: ["HS256"] });
  if (!payload.sub || payload.purpose !== "tenant-export") {
    throw new Error("Invalid or expired export token.");
  }
  return { sub: payload.sub, purpose: "tenant-export" };
}

/**
 * Builds the full tenant export blob inside the tenant context.
 */
export async function buildExportBlob(tenantId: string): Promise<TenantExportBlob> {
  return withTenantContext(tenantId, async (tx) => {
    const [tenant, users, modules] = await Promise.all([
      tx.tenant.findUniqueOrThrow({ where: { id: tenantId } }),
      tx.user.findMany({
        where: { tenantId },
        select: { id: true, email: true, name: true, role: true },
      }),
      tx.tenantModule.findMany({
        where: { tenantId },
        select: { moduleId: true, status: true, config: true },
      }),
    ]);

    const token = await signExportToken(tenantId);

    return tenantExportSchema.parse({
      dataSchemaVersion: 1,
      exportedAt: new Date().toISOString(),
      tenant: {
        id: tenant.id,
        name: tenant.name,
        slug: tenant.slug,
        plan: tenant.plan,
        status: tenant.status,
      },
      users: users.map((u) => ({ id: u.id, email: u.email, name: u.name, role: u.role })),
      modules: modules.map((m) => ({ moduleId: m.moduleId, status: m.status, config: m.config ?? undefined })),
      token,
    });
  });
}

/**
 * Imports a validated export blob into the target tenant inside a single
 * transaction. The one-time token must verify for the target tenant.
 */
export async function importTenantBlob(tenantId: string, blob: unknown): Promise<void> {
  const parsed = tenantExportSchema.parse(blob);
  const claims = await verifyExportToken(parsed.token);
  if (claims.sub !== tenantId) {
    throw new Error("Export token does not match the target tenant.");
  }

  await withTenantContext(tenantId, async (tx) => {
    for (const user of parsed.users) {
      const existing = await tx.user.findUnique({
        where: { tenantId_email: { tenantId, email: user.email } },
        select: { id: true },
      });
      if (existing) {
        await tx.user.update({
          where: { id: existing.id },
          data: { name: user.name, role: user.role },
        });
      } else {
        await tx.user.create({
          data: {
            tenantId,
            email: user.email,
            name: user.name,
            role: user.role,
          },
        });
      }
    }
  });
}
