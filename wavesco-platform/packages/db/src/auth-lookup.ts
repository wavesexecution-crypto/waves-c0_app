import { prisma } from "./client";
import { Prisma } from "./generated/client";

export interface AuthUserRow {
  id: string;
  tenantId: string;
  email: string;
  name: string | null;
  passwordHash: string | null;
  role: string;
  emailVerified: Date | null;
  status: string;
}

/**
 * Finds a user by email across ALL tenants.
 *
 * Uses a SECURITY DEFINER function (owner-privileged, RLS-bypassing) so
 * the login flow can authenticate a user before a tenant context exists.
 * Only this path may read credentials outside a tenant context.
 */
export async function lookupUserByEmail(email: string): Promise<AuthUserRow | null> {
  const rows = await prisma.$queryRaw<AuthUserRow[]>(Prisma.sql`
    SELECT * FROM public.lookup_user_by_email(${email})
  `);
  return rows[0] ?? null;
}
