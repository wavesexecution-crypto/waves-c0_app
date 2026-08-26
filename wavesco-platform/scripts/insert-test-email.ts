import { loadEnv } from "./load-env";
loadEnv();
const approvalId = process.argv[2] ?? "";
async function main(): Promise<void> {
  if (!/^\d+$/.test(approvalId)) throw new Error("usage: tsx insert-test-email.ts <approvalId>");
  const mod: any = await import("../packages/db/src/generated/client");
  const admin = new mod.PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL ?? "" } } });
  const tenant = await admin.tenant.findFirst({ where: { slug: "wavesco-hq" }, select: { id: true } });
  if (!tenant) throw new Error("wavesco-hq tenant missing");

  // remove any stale undecided duplicates from prior misfires
  const stale = await admin.outreachEmail.findMany({
    where: { tenantId: tenant.id, leadKey: "TEST-OWNER-MAILBOX", decidedAt: null },
    select: { id: true, approvalId: true },
  });
  for (const s of stale) {
    await admin.outreachEmail.delete({ where: { id: s.id } });
    console.log("removed stale undecided test row", s.id, "(approval", s.approvalId + ")");
  }

  const subject =
    approvalId === "19"
      ? "[WAVESCO TEST] hello@ sender verification - no reply needed"
      : "[WAVESCO TEST] Brevo delivery verification - no reply needed";
  await admin.outreachEmail.create({
    data: {
      tenantId: tenant.id,
      campaignId: null,
      leadKey: "TEST-OWNER-MAILBOX",
      business: "TEST - Owner Mailbox (not a lead)",
      email: "waves.execution@gmail.com",
      subject,
      body: "Production-path connectivity test for the WavesCo Cold Email system via Brevo SMTP (hello@outreach.wavesco.in). If you received this, the new sending provider works. This is NOT outreach.",
      status: "submitted",
      approvalId,
      submittedAt: new Date(),
    },
  });
  console.log("test outreach row inserted (submitted) with approvalId", approvalId);
  await admin.$disconnect();
}
main().catch((e: unknown) => { console.error(e); process.exit(1); });
