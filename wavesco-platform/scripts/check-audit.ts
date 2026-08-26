import { loadEnv } from "./load-env";
loadEnv();
async function main(): Promise<void> {
  const { PrismaClient } = await import("../packages/db/src/generated/client");
  const admin = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL ?? "" } } });
  const rows = await admin.$queryRawUnsafe<{ action: string; model: string; created: Date }[]>(
    `SELECT action, model, "createdAt" created FROM "AuditLog" ORDER BY "createdAt" DESC LIMIT 6`,
  );
  console.log(JSON.stringify(rows, null, 1));
  await admin.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
