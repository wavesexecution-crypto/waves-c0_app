-- Outreach Order Pipeline: LeadResearch + OutreachOrder.
-- Same pattern as 20260825010000_wavesco_product_models: tenant FK,
-- RLS isolation for runtime role `wavesco_app`, explicit DML grants.

CREATE TABLE "LeadResearch" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "leadKey" TEXT NOT NULL,
    "engineLeadId" INTEGER,
    "business" TEXT NOT NULL,
    "category" TEXT,
    "area" TEXT,
    "city" TEXT,
    "website" TEXT,
    "instagram" TEXT,
    "rating" DOUBLE PRECISION,
    "reviews" INTEGER,
    "tier" TEXT,
    "leadScore" INTEGER,
    "digitalPresence" TEXT,
    "problem" TEXT,
    "opportunity" TEXT,
    "serviceFit" TEXT,
    "angleSeed" TEXT,
    "contactName" TEXT,
    "contactRole" TEXT,
    "email" TEXT,
    "sourceUrls" JSONB,
    "verification" TEXT,
    "notes" TEXT,
    "researchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "checkedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeadResearch_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OutreachOrder" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "leadKey" TEXT NOT NULL,
    "engineLeadId" INTEGER,
    "businessName" TEXT NOT NULL,
    "contactName" TEXT,
    "contactRole" TEXT,
    "email" TEXT NOT NULL,
    "emailStatus" TEXT NOT NULL DEFAULT 'VERIFIED',
    "researchSnapshot" JSONB NOT NULL,
    "opportunity" TEXT,
    "outreachAngle" TEXT,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "followupPlan" JSONB NOT NULL,
    "plannerModel" TEXT,
    "confidence" TEXT NOT NULL DEFAULT 'medium',
    "status" TEXT NOT NULL DEFAULT 'READY_FOR_APPROVAL',
    "approvalId" TEXT,
    "sendId" TEXT,
    "deliveryStatus" TEXT,
    "replyStatus" TEXT,
    "sendError" TEXT,
    "senderIdentity" TEXT,
    "submittedAt" TIMESTAMP(3),
    "decidedAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OutreachOrder_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "FollowUp" ADD COLUMN "outreachOrderId" TEXT;

CREATE UNIQUE INDEX "LeadResearch_tenantId_leadKey_key" ON "LeadResearch"("tenantId", "leadKey");
CREATE INDEX "LeadResearch_tenantId_researchedAt_idx" ON "LeadResearch"("tenantId", "researchedAt");

CREATE UNIQUE INDEX "OutreachOrder_tenantId_leadKey_version_key" ON "OutreachOrder"("tenantId", "leadKey", "version");
CREATE INDEX "OutreachOrder_tenantId_status_idx" ON "OutreachOrder"("tenantId", "status");
CREATE INDEX "OutreachOrder_tenantId_email_idx" ON "OutreachOrder"("tenantId", "email");

-- Data integrity guard: an email can hold at most ONE live (non-terminal)
-- order per tenant, so the same address can never receive two initial
-- outreach emails in parallel. Cancelled/rejected orders free the address.
CREATE UNIQUE INDEX "OutreachOrder_live_email_guard"
  ON "OutreachOrder"("tenantId", lower("email"))
  WHERE status IN ('READY_FOR_APPROVAL','PENDING','APPROVED','SENT','DELIVERED');

ALTER TABLE "LeadResearch" ADD CONSTRAINT "LeadResearch_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OutreachOrder" ADD CONSTRAINT "OutreachOrder_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Row level security -------------------------------------------------
ALTER TABLE "LeadResearch" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OutreachOrder" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "leadresearch_isolation" ON "LeadResearch" USING ("tenantId" = current_setting('app.tenant_id', true)) WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));
CREATE POLICY "outreachorder_isolation" ON "OutreachOrder" USING ("tenantId" = current_setting('app.tenant_id', true)) WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

GRANT SELECT, INSERT, UPDATE, DELETE ON
  "LeadResearch", "OutreachOrder"
TO wavesco_app;
