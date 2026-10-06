import { PrismaClient } from "./generated/client";
import { auditExtension } from "./audit";

/**
 * The Prisma client instance lives in its own module so that `context.ts` and
 * `rls.ts` can derive types from it without importing `client.ts`.
 *
 * `client.ts` re-exports this module AND re-exports `./context` and `./rls`,
 * so any type in those modules that reached back into `client.ts` formed an
 * import cycle that TypeScript could not resolve (`Namespace ... has no
 * exported member 'prisma'`).
 */

const base = new PrismaClient();

/** Runtime-role client: every statement is subject to RLS. */
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

/**
 * The client handed to a `withTenantContext` callback.
 *
 * This is the transaction client of the EXTENDED client, so it carries the
 * audit extension's model methods as well as every model delegate. It is
 * deliberately derived from `prisma.$transaction` rather than from the
 * generated `PrismaClient`: the unextended type is not assignable to the
 * value actually passed to the callback.
 */
export type TenantTx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];