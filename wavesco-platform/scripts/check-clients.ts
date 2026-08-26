import { loadEnv } from "./load-env";
loadEnv();
async function main(): Promise<void> {
  const { PrismaClient } = await import("../packages/db/src/generated/client");
  const admin = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL ?? "" } } });
  const clients = await admin.client.findMany({
    select: { name: true, status: true, createdAt: true },
    orderBy: { createdAt: "desc" },
    take: 5,
  });
  for (const c of clients) {
    console.log(`${c.name} | ${c.status} | ${c.createdAt.toISOString()}`);
  }
  const steps = await admin.onboardingStep.count();
  console.log("total onboarding steps:", steps);
  await admin.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
