-- Migration: Smart Lead Engine schema additions
-- Adds AI tracking fields to OutreachOrder, followUpNumber to FollowUp,
-- and creates LeadLifecycleEvent for full observability.

-- 1. OutreachOrder: AI tracking fields
ALTER TABLE "OutreachOrder" ADD COLUMN "aiEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "OutreachOrder" ADD COLUMN "aiModel" TEXT;
ALTER TABLE "OutreachOrder" ADD COLUMN "enrichmentStatus" TEXT;
ALTER TABLE "OutreachOrder" ADD COLUMN "selectedService" TEXT;
ALTER TABLE "OutreachOrder" ADD COLUMN "personalizationContext" JSONB;

-- 2. FollowUp: sequence tracking
ALTER TABLE "FollowUp" ADD COLUMN "followUpNumber" INTEGER NOT NULL DEFAULT 1;

-- 3. LeadLifecycleEvent: per-lead observability
CREATE TABLE "LeadLifecycleEvent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "leadKey" TEXT NOT NULL,
    "batchId" TEXT,
    "stage" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "reason" TEXT,
    "aiEnabled" BOOLEAN NOT NULL DEFAULT false,
    "aiProvider" TEXT,
    "aiModel" TEXT,
    "enrichmentStatus" TEXT,
    "emailStatus" TEXT,
    "eligibility" TEXT,
    "orderId" TEXT,
    "approvalId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadLifecycleEvent_pkey" PRIMARY KEY ("id")
);

-- Indexes for LeadLifecycleEvent
CREATE INDEX "LeadLifecycleEvent_tenantId_leadKey_idx" ON "LeadLifecycleEvent"("tenantId", "leadKey");
CREATE INDEX "LeadLifecycleEvent_tenantId_stage_idx" ON "LeadLifecycleEvent"("tenantId", "stage");
CREATE INDEX "LeadLifecycleEvent_tenantId_createdAt_idx" ON "LeadLifecycleEvent"("tenantId", "createdAt");
CREATE INDEX "LeadLifecycleEvent_batchId_idx" ON "LeadLifecycleEvent"("batchId");

-- 4. Seed AI config for wavesco-hq tenant (the only production tenant)
INSERT INTO "ClientAiConfig" ("id", "tenantId", "aiEnabled", "provider", "baseUrl", "model", "credentialRef", "createdAt", "updatedAt")
VALUES (
    'seed_wavesco_hq_ai',
    'tenant_fb5d3a4684c344968d6eeaa783b735d9',
    true,
    'ollama_cloud',
    'https://ollama.com/v1',
    'gemma4:31b',
    'env:OPENAI_API_KEY',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
)
ON CONFLICT ("tenantId") DO NOTHING;

-- 5. RLS policy for LeadLifecycleEvent
ALTER TABLE "LeadLifecycleEvent" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON "LeadLifecycleEvent"
    USING ("tenantId" = current_setting('app.tenant_id', true)::text);

CREATE POLICY "service_role_all" ON "LeadLifecycleEvent"
    USING (current_setting('role') = 'service_role');

-- 6. Grants
GRANT SELECT, INSERT, UPDATE, DELETE ON "LeadLifecycleEvent" TO wavesco_app;
