-- Acquisition Brief / Company Acquisition Profile. One per tenant, tenant-isolated.
-- No tier gating — "Choose. Rent. Operate." Canonical context for Nemotron orchestration.

CREATE TABLE "AcquisitionProfile" (
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

CREATE TABLE "AcquisitionDataImport" (
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

CREATE UNIQUE INDEX "AcquisitionProfile_tenantId_key" ON "AcquisitionProfile"("tenantId");
CREATE INDEX "AcquisitionProfile_tenantId_status_idx" ON "AcquisitionProfile"("tenantId", "status");

CREATE INDEX "AcquisitionDataImport_tenantId_profileId_idx" ON "AcquisitionDataImport"("tenantId", "profileId");
CREATE INDEX "AcquisitionDataImport_tenantId_status_idx" ON "AcquisitionDataImport"("tenantId", "status");

ALTER TABLE "AcquisitionProfile" ADD CONSTRAINT "AcquisitionProfile_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AcquisitionDataImport" ADD CONSTRAINT "AcquisitionDataImport_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "AcquisitionProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AcquisitionDataImport" ADD CONSTRAINT "AcquisitionDataImport_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Row level security -------------------------------------------------
ALTER TABLE "AcquisitionProfile" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AcquisitionDataImport" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "acquisitionprofile_isolation" ON "AcquisitionProfile" USING ("tenantId" = current_setting('app.tenant_id', true)) WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));
CREATE POLICY "acquisitiondataimport_isolation" ON "AcquisitionDataImport" USING ("tenantId" = current_setting('app.tenant_id', true)) WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

GRANT SELECT, INSERT, UPDATE, DELETE ON "AcquisitionProfile", "AcquisitionDataImport" TO wavesco_app;
