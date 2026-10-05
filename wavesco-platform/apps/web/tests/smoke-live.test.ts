/**
 * LIVE smoke test — real Postgres (local docker dev DB), synthetic tenant.
 * Runs ONLY when SMOKE_LIVE=1 and DATABASE_URL/DIRECT_URL are set; otherwise
 * skipped. Synthetic `tenant_smoke_*` data, cascade-cleaned afterwards.
 * NEVER run against production.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";

const LIVE = process.env.SMOKE_LIVE === "1" && !!process.env.DATABASE_URL && !!process.env.DIRECT_URL;
const t = (s: string) => (LIVE ? s : `[SKIPPED] ${s}`);

// The lead engine's node:sqlite import cannot load under vitest. The engine
// host is never touched here (this file proves the Postgres + object layers);
// stub only the module boundary.
vi.mock("@/lib/wavesco/lead-engine", () => ({
  leadEngineMode: () => "local",
  getBatchManifest: async () => undefined,
  fetchManifestFile: async () => ({ ok: false as const, error: "stubbed" }),
  listBatchManifests: async () => [],
}));

describe.skipIf(!LIVE)("live smoke — entitlement → provision → reply → convert → expire", () => {
  const tid = `tenant_smoke_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const uid = `user_smoke_${randomUUID().replace(/-/g, "").slice(0, 12)}`;

  beforeAll(async () => {
    const { getDirectPrisma } = await import("@wavesco/db");
    const direct = getDirectPrisma();
    await direct.module.upsert({
      where: { name: "acquisition-os" },
      create: { name: "acquisition-os", displayName: "Acquisition OS", version: "1.0.0", contractPath: "modules/acquisition-os/module.contract.json" },
      update: {},
    });
    const { withTenantContext } = await import("@wavesco/db");
    await withTenantContext(tid, async (tx: any) => {
      await tx.tenant.create({ data: { id: tid, name: "Smoke Fitness (SYNTHETIC)", slug: `smoke-${tid.slice(-8)}` } });
      await tx.user.create({ data: { id: uid, tenantId: tid, email: `smoke-${tid.slice(-8)}@example.test`, passwordHash: "x", role: "owner", status: "active" } });
    }, uid);
  });

  afterAll(async () => {
    const { getDirectPrisma, prisma } = await import("@wavesco/db");
    const direct = getDirectPrisma();
    // Children before parent: several FKs are ON DELETE RESTRICT.
    await direct.followUp.deleteMany({ where: { tenantId: tid } });
    await direct.conversationMessage.deleteMany({ where: { tenantId: tid } });
    await direct.conversation.deleteMany({ where: { tenantId: tid } });
    await direct.leadConversion.deleteMany({ where: { tenantId: tid } });
    await direct.outreachOrder.deleteMany({ where: { tenantId: tid } });
    await direct.leadResearch.deleteMany({ where: { tenantId: tid } });
    await direct.activityEvent.deleteMany({ where: { tenantId: tid } });
    await direct.leadLifecycleEvent.deleteMany({ where: { tenantId: tid } });
    await direct.acquisitionOrder.deleteMany({ where: { tenantId: tid } });
    await direct.acquisitionEntitlement.deleteMany({ where: { tenantId: tid } });
    await direct.notificationPreference.deleteMany({ where: { tenantId: tid } });
    await direct.acquisitionDataImport.deleteMany({ where: { tenantId: tid } });
    await direct.acquisitionProfile.deleteMany({ where: { tenantId: tid } });
    await direct.clientAiConfig.deleteMany({ where: { tenantId: tid } });
    await direct.tenantModule.deleteMany({ where: { tenantId: tid } });
    await direct.user.deleteMany({ where: { tenantId: tid } });
    await direct.tenant.deleteMany({ where: { id: tid } });
    await prisma.$disconnect();
  });

  it(t("fresh tenant has no access (never fake-active)"), async () => {
    const { getAcquisitionOSEntitlement, hasAccess } = await import("@/lib/wavesco/entitlements");
    const e = await getAcquisitionOSEntitlement(tid);
    expect(e.status).toBe("not_configured");
    expect(hasAccess(e.status)).toBe(false);
  });

  it(t("trial start provisions module/profile/ai-config/15 preferences"), async () => {
    const { startTrial } = await import("@/lib/wavesco/entitlements");
    const { withTenantContext } = await import("@wavesco/db");
    const r = await startTrial(tid, uid, 14);
    expect(r.entitlement.status).toBe("trial");
    const prov: any = await withTenantContext(tid, async (tx: any) => ({
      tm: await tx.tenantModule.count({ where: { tenantId: tid } }),
      prof: await tx.acquisitionProfile.count({ where: { tenantId: tid } }),
      ai: await tx.clientAiConfig.count({ where: { tenantId: tid } }),
      prefs: await tx.notificationPreference.count({ where: { tenantId: tid } }),
    }));
    expect(prov).toMatchObject({ tm: 1, prof: 1, ai: 1, prefs: 15 });
  });

  it(t("reply ingestion classifies POSITIVE; conversion WON stops follow-ups"), async () => {
    const { withTenantContext } = await import("@wavesco/db");
    await withTenantContext(tid, async (tx: any) => {
      await tx.outreachOrder.create({
        data: { tenantId: tid, leadKey: "smoke-lead", businessName: "Smoke Gym", email: "owner@smoke-test.example", emailStatus: "VERIFIED", researchSnapshot: {}, subject: "Hi", body: "Hello", followupPlan: [], status: "SENT" },
      });
      await tx.followUp.create({ data: { tenantId: tid, leadKey: "smoke-lead", business: "Smoke Gym", dueAt: new Date(Date.now() + 86400000), status: "pending" } });
    });
    const { recordInboundMessage } = await import("@/lib/wavesco/conversations");
    const im = await recordInboundMessage(tid, { leadKey: "smoke-lead", kind: "reply", body: "Yes, interested — call Tuesday", providerMsgId: `smoke-${tid}` }, "smoke-live");
    expect(im.status).toBe("POSITIVE");
    const { recordConversion } = await import("@/lib/wavesco/conversions");
    const cv = await recordConversion(tid, { leadKey: "smoke-lead", state: "WON", note: "Annual plan", businessName: "Smoke Gym" }, uid);
    expect(cv.followUpsCancelled).toBe(1);
  });

  it(t("suspend denies 402; forced expiry sweeps to EXPIRED"), async () => {
    const { transitionEntitlement, getAcquisitionOSEntitlement, requireAcquisitionAccess, expireDueEntitlements } = await import("@/lib/wavesco/entitlements");
    await transitionEntitlement(tid, "suspend", {}, uid);
    expect((await getAcquisitionOSEntitlement(tid)).status).toBe("suspended");
    try {
      await requireAcquisitionAccess(tid);
      expect.unreachable("gate must deny");
    } catch (e: any) {
      expect(e.status).toBe(402);
    }
    const { getDirectPrisma } = await import("@wavesco/db");
    await getDirectPrisma().acquisitionEntitlement.update({
      where: { tenantId: tid },
      data: { status: "ACTIVE", suspendedAt: null, startedAt: new Date(), expiresAt: new Date(Date.now() - 1000) },
    });
    const sw = await expireDueEntitlements();
    expect(sw.expired).toBeGreaterThanOrEqual(1);
    expect((await getAcquisitionOSEntitlement(tid)).status).toBe("expired");
  });

  it(t("storage round-trip persists bytes; RLS hides other tenants' rows"), async () => {
    const { mkdtempSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    process.env.STORAGE_PROVIDER = "local";
    process.env.STORAGE_LOCAL_ROOT = mkdtempSync(join(tmpdir(), "waves-smoke-storage-"));
    const { storeUpload } = await import("@/lib/wavesco/artifacts");
    const { withTenantContext, prisma } = await import("@wavesco/db");
    const stored = await storeUpload(tid, uid, { bytes: Buffer.from("a,b\n1,2\n"), filename: "leads.csv" }, "smoke");
    expect(stored.ok).toBe(true);
    // Same tenant with context: visible.
    const seen = await withTenantContext(tid, async (tx: any) =>
      tx.storedObject.findMany({ where: { tenantId: tid } }),
    );
    expect(seen.length).toBeGreaterThanOrEqual(1);
    // Runtime role WITHOUT context (simulates Tenant B / anonymous): invisible.
    const leaked: any[] = await (prisma as any).storedObject.findMany({ where: { tenantId: tid } });
    expect(leaked).toHaveLength(0);
    // Download path resolves through the registry (unit-covered); registry is the gate.
    delete process.env.STORAGE_LOCAL_ROOT;
  });
});
