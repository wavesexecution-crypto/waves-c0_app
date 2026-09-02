import { NextResponse } from "next/server";
import { PrismaClient } from "@wavesco/db/src/generated/client";

export const dynamic = "force-dynamic";

// POST with header x-migrate-secret: must match env MIGRATE_SECRET or fallback to allow in production once
export async function POST(req: Request) {
  const secret = req.headers.get("x-migrate-secret") || "";
  const expected = process.env.MIGRATE_SECRET || "wavesco-migrate-2026-09-02";
  if (secret !== expected) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const sql = `
CREATE TABLE IF NOT EXISTS "AcquisitionProfile" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "companyName" TEXT,
    "website" TEXT,
    "industry" TEXT,
    "whatWeSell" TEXT,
    "productsServices" JSONB,
    "locationsServed" JSONB,
    "businessModel" TEXT,
    "acquisitionObjective" TEXT,
    "primaryObjective" TEXT,
    "targetQuantity" INTEGER,
    "targetTimeframe" TEXT,
    "priorityProductService" TEXT,
    "icp" JSONB,
    "offer" JSONB,
    "brand" JSONB,
    "integrations" JSONB,
    "rules" JSONB,
    "readiness" JSONB,
    "activatedAt" TIMESTAMP(3),
    "pausedAt" TIMESTAMP(3),
    "suspendedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AcquisitionProfile_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "AcquisitionProfile_tenantId_key" ON "AcquisitionProfile"("tenantId");
CREATE INDEX IF NOT EXISTS "AcquisitionProfile_tenantId_status_idx" ON "AcquisitionProfile"("tenantId", "status");

CREATE TABLE IF NOT EXISTS "AcquisitionDataImport" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileType" TEXT NOT NULL,
    "rowCount" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "summary" JSONB,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AcquisitionDataImport_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "AcquisitionDataImport_tenantId_profileId_idx" ON "AcquisitionDataImport"("tenantId", "profileId");
CREATE INDEX IF NOT EXISTS "AcquisitionDataImport_tenantId_status_idx" ON "AcquisitionDataImport"("tenantId", "status");
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AcquisitionProfile_tenantId_fkey') THEN
    ALTER TABLE "AcquisitionProfile" ADD CONSTRAINT "AcquisitionProfile_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AcquisitionDataImport_profileId_fkey') THEN
    ALTER TABLE "AcquisitionDataImport" ADD CONSTRAINT "AcquisitionDataImport_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "AcquisitionProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AcquisitionDataImport_tenantId_fkey') THEN
    ALTER TABLE "AcquisitionDataImport" ADD CONSTRAINT "AcquisitionDataImport_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;
ALTER TABLE "AcquisitionProfile" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AcquisitionDataImport" ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'acquisitionprofile_isolation') THEN
    CREATE POLICY "acquisitionprofile_isolation" ON "AcquisitionProfile" USING ("tenantId" = current_setting('app.tenant_id', true)) WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'acquisitiondataimport_isolation') THEN
    CREATE POLICY "acquisitiondataimport_isolation" ON "AcquisitionDataImport" USING ("tenantId" = current_setting('app.tenant_id', true)) WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));
  END IF;
END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON "AcquisitionProfile", "AcquisitionDataImport" TO wavesco_app;
INSERT INTO "_prisma_migrations" (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count) VALUES (gen_random_uuid(), 'acquisition-profile-manual', NOW(), '20260902000000_acquisition_profile', '', NULL, NOW(), 1) ON CONFLICT DO NOTHING;
  `;

  const directUrl = process.env.DIRECT_URL || process.env.DATABASE_URL;
  if (!directUrl) return NextResponse.json({ error: "DIRECT_URL missing" }, { status: 500 });
  const direct = new PrismaClient({ datasources: { db: { url: directUrl } } } as any);
  try {
    const statements = sql.split(";").map(s => s.trim()).filter(s => s.length > 0);
    for (const stmt of statements) {
      await (direct as any).$executeRawUnsafe(stmt + ";");
    }
    await direct.$disconnect();
    return NextResponse.json({ ok: true, applied: statements.length });
  } catch (e) {
    try { await direct.$disconnect(); } catch {}
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({ error: "use POST with x-migrate-secret" }, { status: 405 });
}
