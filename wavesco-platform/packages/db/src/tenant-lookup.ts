import { PrismaClient } from "./generated/client";

/**
 * Resolves a tenant slug to its id using the migration/owner role.
 * Exists for pre-tenant-context paths (e.g. the Waves AI Gateway engine
 * endpoint) where RLS necessarily hides all rows from the runtime role.
 * Server-side only; never exposes anything beyond the opaque id.
 */
export async function resolveTenantIdBySlug(
  slug: string,
  directUrl?: string,
): Promise<string | null> {
  const url = directUrl ?? process.env.DIRECT_URL ?? "";
  if (!url) return null;
  const admin = new PrismaClient({ datasources: { db: { url } } });
  try {
    const t = await admin.tenant.findUnique({ where: { slug }, select: { id: true } });
    return t?.id ?? null;
  } finally {
    await admin.$disconnect();
  }
}
