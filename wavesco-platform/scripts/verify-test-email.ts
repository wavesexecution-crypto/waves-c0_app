import { loadEnv } from "./load-env";
loadEnv();
async function main(): Promise<void> {
  const mod: any = await import("../packages/db/src/generated/client");
  const admin = new mod.PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL ?? "" } } });
  const row = await admin.outreachEmail.findFirst({
    where: { approvalId: "18" },
    select: { status: true, messageId: true, sentAt: true, decidedAt: true, error: true },
  });
  console.log("OutreachEmail:", JSON.stringify(row));
  const audits = await admin.auditLog.findMany({
    where: { model: "OutreachEmail", recordId: { not: null } },
    orderBy: { createdAt: "desc" },
    take: 3,
    select: { action: true, model: true, recordId: true, createdAt: true },
  });
  console.log("AuditLog:", JSON.stringify(audits));
  const acts = await admin.activityEvent.findMany({
    orderBy: { createdAt: "desc" },
    take: 3,
    select: { type: true, title: true },
  });
  console.log("Activity:", JSON.stringify(acts));
  await admin.$disconnect();
}
main().catch((e: unknown) => { console.error(e); process.exit(1); });
