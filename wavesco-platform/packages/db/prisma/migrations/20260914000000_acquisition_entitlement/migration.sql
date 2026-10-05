-- Acquisition OS production hardening: authoritative entitlement, provider-agnostic
-- order ledger, inbound conversations, verified conversions.
--
-- - AcquisitionEntitlement is the single source of truth for access
--   (TRIAL, ACTIVE, EXPIRED, CANCELLED, REFUNDED, SUSPENDED). It replaces the
--   derived TenantModule read; provisioning keeps TenantModule enabled for
--   backward compatibility.
-- - AcquisitionOrder records grant attempts without coupling to any payment
--   provider (`provider` is free text; amounts are optional/informational).
-- - Conversation / ConversationMessage is the source of truth for inbound
--   replies, bounces and unsubscribes (one thread per tenant+leadKey).
-- - LeadConversion records operator-verified outcomes (MEETING, WON, LOST).
-- RLS: runtime role `wavesco_app` only sees/writes its own tenant's rows
-- (enforced by `SET LOCAL app.tenant_id` inside withTenantContext).

-- CreateTable
CREATE TABLE "AcquisitionEntitlement" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'TRIAL',
    "source" TEXT NOT NULL DEFAULT 'TRIAL',
    "trialStartedAt" TIMESTAMP(3),
    "trialExpiresAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "suspendedAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "orderId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AcquisitionEntitlement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AcquisitionOrder" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "entitlementId" TEXT,
    "amountPaise" INTEGER,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "provider" TEXT NOT NULL DEFAULT 'manual',
    "providerRef" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AcquisitionOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Conversation" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "leadKey" TEXT NOT NULL,
    "businessName" TEXT,
    "email" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "lastMessageAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConversationMessage" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'reply',
    "body" TEXT NOT NULL,
    "providerMsgId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConversationMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadConversion" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "leadKey" TEXT NOT NULL,
    "businessName" TEXT,
    "state" TEXT NOT NULL,
    "note" TEXT,
    "orderId" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeadConversion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AcquisitionEntitlement_tenantId_key" ON "AcquisitionEntitlement"("tenantId");

-- CreateIndex
CREATE INDEX "AcquisitionEntitlement_tenantId_status_idx" ON "AcquisitionEntitlement"("tenantId", "status");

-- CreateIndex
CREATE INDEX "AcquisitionEntitlement_expiresAt_idx" ON "AcquisitionEntitlement"("expiresAt");

-- CreateIndex
CREATE INDEX "AcquisitionEntitlement_status_idx" ON "AcquisitionEntitlement"("status");

-- CreateIndex
CREATE UNIQUE INDEX "AcquisitionOrder_providerRef_key" ON "AcquisitionOrder"("providerRef");

-- CreateIndex
CREATE UNIQUE INDEX "AcquisitionOrder_idempotencyKey_key" ON "AcquisitionOrder"("idempotencyKey");

-- CreateIndex
CREATE INDEX "AcquisitionOrder_tenantId_status_idx" ON "AcquisitionOrder"("tenantId", "status");

-- CreateIndex
CREATE INDEX "AcquisitionOrder_entitlementId_idx" ON "AcquisitionOrder"("entitlementId");

-- CreateIndex
CREATE INDEX "AcquisitionOrder_idempotencyKey_idx" ON "AcquisitionOrder"("idempotencyKey");

-- CreateIndex
CREATE INDEX "Conversation_tenantId_status_idx" ON "Conversation"("tenantId", "status");

-- CreateIndex
CREATE INDEX "Conversation_tenantId_email_idx" ON "Conversation"("tenantId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "Conversation_tenantId_leadKey_key" ON "Conversation"("tenantId", "leadKey");

-- CreateIndex
CREATE UNIQUE INDEX "ConversationMessage_providerMsgId_key" ON "ConversationMessage"("providerMsgId");

-- CreateIndex
CREATE INDEX "ConversationMessage_conversationId_createdAt_idx" ON "ConversationMessage"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "ConversationMessage_tenantId_idx" ON "ConversationMessage"("tenantId");

-- CreateIndex
CREATE INDEX "LeadConversion_tenantId_state_idx" ON "LeadConversion"("tenantId", "state");

-- CreateIndex
CREATE UNIQUE INDEX "LeadConversion_tenantId_leadKey_key" ON "LeadConversion"("tenantId", "leadKey");

-- AddForeignKey
ALTER TABLE "AcquisitionEntitlement" ADD CONSTRAINT "AcquisitionEntitlement_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AcquisitionOrder" ADD CONSTRAINT "AcquisitionOrder_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AcquisitionOrder" ADD CONSTRAINT "AcquisitionOrder_entitlementId_fkey" FOREIGN KEY ("entitlementId") REFERENCES "AcquisitionEntitlement"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationMessage" ADD CONSTRAINT "ConversationMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationMessage" ADD CONSTRAINT "ConversationMessage_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadConversion" ADD CONSTRAINT "LeadConversion_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Row level security -------------------------------------------------
ALTER TABLE "AcquisitionEntitlement" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AcquisitionOrder" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Conversation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ConversationMessage" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LeadConversion" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "acquisitionentitlement_isolation" ON "AcquisitionEntitlement" USING ("tenantId" = current_setting('app.tenant_id', true)) WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));
CREATE POLICY "acquisitionorder_isolation" ON "AcquisitionOrder" USING ("tenantId" = current_setting('app.tenant_id', true)) WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));
CREATE POLICY "conversation_isolation" ON "Conversation" USING ("tenantId" = current_setting('app.tenant_id', true)) WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));
CREATE POLICY "conversationmessage_isolation" ON "ConversationMessage" USING ("tenantId" = current_setting('app.tenant_id', true)) WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));
CREATE POLICY "leadconversion_isolation" ON "LeadConversion" USING ("tenantId" = current_setting('app.tenant_id', true)) WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

GRANT SELECT, INSERT, UPDATE, DELETE ON "AcquisitionEntitlement", "AcquisitionOrder", "Conversation", "ConversationMessage", "LeadConversion" TO wavesco_app;
