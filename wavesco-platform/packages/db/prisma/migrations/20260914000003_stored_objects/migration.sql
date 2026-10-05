-- StoredObject registry: authoritative index for every Waves-held binary
-- artifact (client uploads, archived PDF/XLSX reports, generated artifacts).
--
-- Bytes live in object storage (local directory for dev, S3-compatible in
-- production). This table is the source of truth for serving: bytes are
-- NEVER served without a READY row scoped to the requesting tenant.
--
-- Lifecycle: PENDING → READY → DELETED (bytes removed, row kept as an audit
-- tombstone). Entitlement expiry NEVER deletes rows (EXPIRY ≠ DELETION);
-- only explicit purge removes them.
-- RLS: runtime role `wavesco_app` only sees/writes its own tenant's rows
-- (enforced by `SET LOCAL app.tenant_id` inside withTenantContext).

CREATE TABLE "StoredObject" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "batchId" TEXT,
    "fileName" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "bucket" TEXT,
    "objectKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'READY',
    "createdByUserId" TEXT,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "StoredObject_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "StoredObject_tenantId_status_idx" ON "StoredObject"("tenantId", "status");
CREATE INDEX "StoredObject_tenantId_kind_idx" ON "StoredObject"("tenantId", "kind");
CREATE INDEX "StoredObject_tenantId_batchId_idx" ON "StoredObject"("tenantId", "batchId");
CREATE INDEX "StoredObject_objectKey_idx" ON "StoredObject"("objectKey");

ALTER TABLE "StoredObject" ADD CONSTRAINT "StoredObject_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Row level security -------------------------------------------------
ALTER TABLE "StoredObject" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "storedobject_isolation" ON "StoredObject" USING ("tenantId" = current_setting('app.tenant_id', true)) WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

GRANT SELECT, INSERT, UPDATE, DELETE ON "StoredObject" TO wavesco_app;
