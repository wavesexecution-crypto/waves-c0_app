import { PrismaClient } from "./generated/client";
import { auditExtension } from "./audit";

const base = new PrismaClient();

export const prisma = base.$extends(auditExtension(base));

export function getDirectPrisma() {
  const url = process.env.DIRECT_URL || process.env.DATABASE_URL;
  if (!url) throw new Error("DIRECT_URL missing");
  return new PrismaClient({ datasources: { db: { url } } } as any);
}

let directRef: PrismaClient | undefined;

/** Owner-role client that bypasses RLS. Use ONLY for cross-tenant scheduler /
 *  lookup reads that cannot carry a tenant context (tenant listing, expiry
 *  sweep, engine tenant resolution). Never for tenant data reads/writes —
 *  those must go through withTenantContext so RLS + audit apply. */
export function directPrisma(): PrismaClient {
  if (!directRef) directRef = getDirectPrisma();
  return directRef;
}

export type DB = typeof prisma;

export { Prisma } from "./generated/client";
export type { PrismaClient } from "./generated/client";
export * from "./context";
export * from "./rls";
export * from "./idempotency";
export * from "./audit";
export * from "./auth-lookup";
