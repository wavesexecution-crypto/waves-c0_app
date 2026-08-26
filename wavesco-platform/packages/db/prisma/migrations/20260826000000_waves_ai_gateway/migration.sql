-- Waves AI Gateway: per-tenant AI configuration + usage ledger.
-- Same isolation pattern as the product-models migration: tenantId + RLS
-- for runtime role `wavesco_app`, explicit DML grants.

CREATE TABLE "ClientAiConfig" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "aiEnabled" BOOLEAN NOT NULL DEFAULT false,
    "provider" TEXT NOT NULL DEFAULT 'ollama_cloud',
    "baseUrl" TEXT,
    "model" TEXT,
    "credentialRef" TEXT,
    "obsidianRoot" TEXT,
    "config" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientAiConfig_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AiUsageLog" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "estimatedCostUsd" DOUBLE PRECISION,
    "latencyMs" INTEGER,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiUsageLog_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ClientAiConfig_tenantId_key" ON "ClientAiConfig"("tenantId");
CREATE INDEX "ClientAiConfig_tenantId_idx" ON "ClientAiConfig"("tenantId");
CREATE INDEX "AiUsageLog_tenantId_createdAt_idx" ON "AiUsageLog"("tenantId", "createdAt");

ALTER TABLE "ClientAiConfig" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "clientaicfg_isolation" ON "ClientAiConfig"
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "AiUsageLog" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "aiusagelog_isolation" ON "AiUsageLog"
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

GRANT SELECT, INSERT, UPDATE, DELETE ON
  "ClientAiConfig", "AiUsageLog"
TO wavesco_app;
