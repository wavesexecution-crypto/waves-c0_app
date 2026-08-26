import { loadEnv } from "./load-env";
loadEnv();
async function main(): Promise<void> {
  const { PrismaClient } = await import("../packages/db/src/generated/client");
  const admin = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL ?? "" } } });
  const res = await admin.$executeRawUnsafe(`DELETE FROM "Tenant" WHERE slug = 'demo-cafe'`);
  console.log("deleted demo-cafe rows:", res);
  const left = await admin.$queryRawUnsafe<{ slug: string }[]>(`SELECT slug FROM "Tenant" ORDER BY slug`);
  console.log("tenants now:", JSON.stringify(left));
  await admin.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
