import { loadEnv } from "./load-env";
loadEnv();
async function main(): Promise<void> {
  const mod: any = await import("../packages/db/src/generated/client");
  const admin = new mod.PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL ?? "" } } });
  const tenant = await admin.tenant.findFirst({ where: { slug: "wavesco-hq" }, select: { id: true } });
  if (!tenant) throw new Error("wavesco-hq missing");
  await admin.clientAiConfig.upsert({
    where: { tenantId: tenant.id },
    create: {
      tenantId: tenant.id,
      aiEnabled: true,
      provider: "ollama_cloud",
      baseUrl: "https://ollama.com/v1",
      model: "gemma4:31b",
      credentialRef: "env:OPENAI_API_KEY",
    },
    update: {
      aiEnabled: true,
      provider: "ollama_cloud",
      baseUrl: "https://ollama.com/v1",
      model: "gemma4:31b",
      credentialRef: "env:OPENAI_API_KEY",
    },
  });
  console.log("ClientAiConfig upserted for", tenant.id);
  await admin.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
