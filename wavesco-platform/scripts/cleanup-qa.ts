import { loadEnv } from "./load-env";
loadEnv();
async function main(): Promise<void> {
  const { PrismaClient } = await import("../packages/db/src/generated/client");
  const admin = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL ?? "" } } });
  const client = await admin.client.findFirst({ where: { name: "QA Verification Co" } });
  if (!client) {
    console.log("no QA client — nothing to clean");
    return;
  }
  const projects = await admin.project.findMany({ where: { clientId: client.id } });
  for (const p of projects) {
    await admin.activityEvent.deleteMany({ where: { entityType: "project", entityId: p.id } });
    await admin.project.delete({ where: { id: p.id } });
  }
  await admin.onboardingStep.deleteMany({ where: { clientId: client.id } });
  await admin.activityEvent.deleteMany({ where: { entityType: "client", entityId: client.id } });
  await admin.client.delete({ where: { id: client.id } });
  console.log("removed QA Verification Co workspace test rows");
  await admin.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
