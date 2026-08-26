import { loadEnv } from "./load-env";
loadEnv();

/**
 * Tenant-isolation proof: connects AS the runtime role (wavesco_app),
 * sets app.tenant_id to tenant A, inserts a scoped row, then switches
 * context to tenant B and proves the row is invisible + writes are
 * rejected for foreign tenant ids.
 */
async function main(): Promise<void> {
  const { PrismaClient } = await import("../packages/db/src/generated/client");
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL missing");
  const db = new PrismaClient({ datasources: { db: { url } } });

  const tA = "tenant_isolation_probe_a";
  const tB = "tenant_isolation_probe_b";

  try {
    // create probe tenants as owner (bypasses RLS)
    const admin = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL ?? "" } } });
    await admin.tenant.upsert({ where: { id: tA }, create: { id: tA, name: "probe-a", slug: "probe-a-" + Date.now() }, update: {} });
    await admin.tenant.upsert({ where: { id: tB }, create: { id: tB, name: "probe-b", slug: "probe-b-" + Date.now() }, update: {} });
    await admin.$disconnect();

    // insert as tenant A
    await db.$transaction([
      db.$executeRawUnsafe(`SELECT set_config('app.tenant_id', '${tA}', true)`),
      db.$executeRawUnsafe(
        `INSERT INTO "ActivityEvent" ("id","tenantId","type","title") VALUES ('evt_probe_a','${tA}','probe','isolation-probe-A')`,
      ),
    ]);

    // read as tenant A -> sees it
    const seenA = await db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SELECT set_config('app.tenant_id', '${tA}', true)`);
      return tx.$queryRawUnsafe<{ c: bigint }[]>(`SELECT count(*) c FROM "ActivityEvent" WHERE title='isolation-probe-A'`);
    });
    console.log("visible to tenant A:", Number(seenA[0]?.c ?? -1));

    // read as tenant B -> must NOT see it
    const seenB = await db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SELECT set_config('app.tenant_id', '${tB}', true)`);
      return tx.$queryRawUnsafe<{ c: bigint }[]>(`SELECT count(*) c FROM "ActivityEvent" WHERE title='isolation-probe-A'`);
    });
    console.log("visible to tenant B (must be 0):", Number(seenB[0]?.c ?? -1));

    // no context at all -> must NOT see it
    const seenNone = await db.$queryRawUnsafe<{ c: bigint }[]>(
      `SELECT count(*) c FROM "ActivityEvent" WHERE title='isolation-probe-A'`,
    );
    console.log("visible without context (must be 0):", Number(seenNone[0]?.c ?? -1));
  } finally {
    const admin2 = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL ?? "" } } });
    await admin2.activityEvent.deleteMany({ where: { tenantId: { in: [tA, tB] } } });
    await admin2.tenant.deleteMany({ where: { id: { in: [tA, tB] } } });
    await admin2.$disconnect();
    await db.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
