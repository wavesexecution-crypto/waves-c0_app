import { PrismaClient } from "./generated/client";
import { auditExtension } from "./audit";

const base = new PrismaClient();

export const prisma = base.$extends(auditExtension(base));

export type DB = typeof prisma;

export { Prisma } from "./generated/client";
export type { PrismaClient } from "./generated/client";
export * from "./context";
export * from "./rls";
export * from "./idempotency";
export * from "./audit";
export * from "./auth-lookup";
