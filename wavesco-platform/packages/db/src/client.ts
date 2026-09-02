import { PrismaClient } from "./generated/client";
import { auditExtension } from "./audit";

const base = new PrismaClient();

export const prisma = base.$extends(auditExtension(base));

export function getDirectPrisma() {
  const url = process.env.DIRECT_URL || process.env.DATABASE_URL;
  if (!url) throw new Error("DIRECT_URL missing");
  return new PrismaClient({ datasources: { db: { url } } } as any);
}

export type DB = typeof prisma;

export { Prisma } from "./generated/client";
export type { PrismaClient } from "./generated/client";
export * from "./context";
export * from "./rls";
export * from "./idempotency";
export * from "./audit";
export * from "./auth-lookup";
