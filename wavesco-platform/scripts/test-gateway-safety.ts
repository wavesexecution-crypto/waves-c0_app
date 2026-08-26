import { loadEnv } from "./load-env";
loadEnv();

/**
 * Gateway safety matrix:
 *  1. disabled client  -> status "disabled", no AI call
 *  2. tenant isolation -> usage rows invisible cross-tenant (RLS)
 * Restores aiEnabled=true afterwards.
 */
async function main(): Promise<void> {
  const mod: any = await import("../packages/db/src/generated/client");
  const admin = new mod.PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL ?? "" } } });
  const hq = await admin.tenant.findFirst({ where: { slug: "wavesco-hq" }, select: { id: true } });
  if (!hq) throw new Error("missing wavesco-hq");
  const other = await admin.tenant.findFirst({ where: { slug: "wavesco" }, select: { id: true } });
  if (!other) throw new Error("missing wavesco tenant");

  await admin.clientAiConfig.update({ where: { tenantId: hq.id }, data: { aiEnabled: false } });
  await admin.$disconnect();
  console.log("aiEnabled=false set for wavesco-hq");

  const tok = process.env.LEAD_ENGINE_GATEWAY_TOKEN ?? "";
  const res = await fetch("http://localhost:3000/api/ai/gateway", {
    method: "POST",
    headers: { authorization: `Bearer ${tok}`, "content-type": "application/json" },
    body: JSON.stringify({ operation: "summarize", prompt: "Say DISABLED-TEST" }),
  });
  const j = (await res.json()) as { ok: boolean; status?: string; error?: string };
  console.log("disabled-mode response:", res.status, JSON.stringify(j));

  const admin2 = new mod.PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL ?? "" } } });
  await admin2.clientAiConfig.update({ where: { tenantId: hq.id }, data: { aiEnabled: true } });

  const { withTenantContext } = await import("@wavesco/db");
  const hqCount = await withTenantContext(hq.id, (tx) => tx.aiUsageLog.count());
  const otherCount = await withTenantContext(other.id, (tx) => tx.aiUsageLog.count());
  console.log(`isolation: wavesco-hq sees ${hqCount} rows; wavesco sees ${otherCount}`);
  await admin2.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
