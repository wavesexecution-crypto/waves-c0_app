import { loadEnv } from "./load-env";
loadEnv();
async function main(): Promise<void> {
  const { PrismaClient } = await import("../packages/db/src/generated/client");
  const admin = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL ?? "" } } });
  const tenants = await admin.$queryRawUnsafe<{ id: string; slug: string; name: string }[]>(
    `SELECT id, slug, name FROM "Tenant" ORDER BY "createdAt"`,
  );
  console.log("ALL tenants:", JSON.stringify(tenants));
  const users = await admin.$queryRawUnsafe<{ email: string; role: string; status: string }[]>(
    `SELECT email, role, status FROM "User" ORDER BY email`,
  );
  console.log("ALL users:", JSON.stringify(users));
  const counts = await admin.$queryRawUnsafe<{ t: string; c: bigint }[]>(`
    SELECT 'Tenant' t, count(*) c FROM "Tenant"
    UNION ALL SELECT 'AuditLog', count(*) FROM "AuditLog"`);
  console.log("counts:", JSON.stringify(counts.map((r) => ({ [r.t]: Number(r.c) }))));
  await admin.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
