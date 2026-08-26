import { loadEnv } from "./load-env";

loadEnv();

async function main(): Promise<void> {
  const { prisma } = await import("@wavesco/db");
  const { PrismaClient } = await import("../packages/db/src/generated/client");

  const admin = new PrismaClient({
    datasources: { db: { url: process.env.DIRECT_URL ?? "" } },
  });
  const migrations = await admin.$queryRawUnsafe<{ migration_name: string }[]>(
    `SELECT migration_name FROM "_prisma_migrations" ORDER BY finished_at DESC LIMIT 3`,
  );
  console.log("migrations:", JSON.stringify(migrations));
  await admin.$disconnect();

  const modules = await prisma.module.findMany({ select: { name: true, version: true }, orderBy: { name: "asc" } });
  console.log("catalog:", modules.map((m) => `${m.name}@${m.version}`).join(", "));

  const tenants = await prisma.tenant.findMany({ select: { id: true, slug: true, name: true } });
  console.log("tenants:", tenants.map((t) => `${t.slug}(${t.id})`).join(", ") || "(none)");

  const demo = tenants.find((t) => t.slug === "demo-cafe");
  if (demo) {
    await prisma.tenant.delete({ where: { id: demo.id } });
    console.log("purged demo tenant:", demo.id);
  }

  const users = await prisma.user.count();
  console.log("users after purge:", users);

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
