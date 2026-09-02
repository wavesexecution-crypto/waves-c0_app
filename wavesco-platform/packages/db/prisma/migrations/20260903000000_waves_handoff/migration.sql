-- Waves Identity — cross-site handoff (single-use, short-lived, cryptographically protected)
-- JWT signed with AUTH_SECRET, jti tracked for replay prevention, destination validated.

CREATE TABLE "WavesHandoffToken" (
    "id" TEXT NOT NULL,
    "jti" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WavesHandoffToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WavesHandoffToken_jti_key" ON "WavesHandoffToken"("jti");
CREATE INDEX "WavesHandoffToken_tenantId_idx" ON "WavesHandoffToken"("tenantId");
CREATE INDEX "WavesHandoffToken_expiresAt_idx" ON "WavesHandoffToken"("expiresAt");

ALTER TABLE "WavesHandoffToken" ADD CONSTRAINT "WavesHandoffToken_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "WavesHandoffToken" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "waveshandofftoke_isolation" ON "WavesHandoffToken" USING ("tenantId" = current_setting('app.tenant_id', true)) WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

GRANT SELECT, INSERT, UPDATE, DELETE ON "WavesHandoffToken" TO wavesco_app;
