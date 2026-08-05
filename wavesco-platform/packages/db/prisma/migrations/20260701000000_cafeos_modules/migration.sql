-- CafeOS module tables (Phase 6).
-- Each table is tenant-scoped and gets RLS isolation identical to the
-- platform tables. Grants to wavesco_app are inherited via
-- ALTER DEFAULT PRIVILEGES in docker/postgres/init.sql (created by owner
-- `wavesco`), so only RLS enablement + policies are needed here.

-- CreateTable
CREATE TABLE "CafeLead" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "name" TEXT,
    "email" TEXT,
    "message" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'website',
    "category" TEXT,
    "priority" TEXT,
    "summary" TEXT,
    "suggestedReply" TEXT,
    "alertSent" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CafeLead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CafeOrder" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "externalOrderId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "customerName" TEXT,
    "customerPhone" TEXT,
    "items" JSONB NOT NULL,
    "totalPaise" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RECEIVED',
    "placedAt" TIMESTAMP(3) NOT NULL,
    "dedupHash" TEXT,
    "dupCount" INTEGER NOT NULL DEFAULT 0,
    "rawPayload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CafeOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CafeReconciliation" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "source" TEXT NOT NULL,
    "totalOrders" INTEGER NOT NULL DEFAULT 0,
    "totalPaise" INTEGER NOT NULL DEFAULT 0,
    "missingOrders" INTEGER NOT NULL DEFAULT 0,
    "extraOrders" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "report" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CafeReconciliation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CafeSettlement" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "amountPaise" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "reference" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CafeSettlement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CafeInventoryItem" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sku" TEXT,
    "unit" TEXT NOT NULL DEFAULT 'pcs',
    "currentStock" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "parLevel" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "reorderPoint" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "costPaise" INTEGER NOT NULL DEFAULT 0,
    "forecastReorderBy" TIMESTAMP(3),
    "forecastQty" DOUBLE PRECISION,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CafeInventoryItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CafeStockMovement" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "type" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CafeStockMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CafeWastageLog" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "reason" TEXT NOT NULL,
    "costPaise" INTEGER NOT NULL DEFAULT 0,
    "reportedBy" TEXT,
    "weekStart" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CafeWastageLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CafeCustomer" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "name" TEXT,
    "email" TEXT,
    "tag" TEXT NOT NULL DEFAULT 'NEW',
    "visitCount" INTEGER NOT NULL DEFAULT 0,
    "ltvPaise" INTEGER NOT NULL DEFAULT 0,
    "lastVisitAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CafeCustomer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CafeCustomerVisit" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "orderId" TEXT,
    "totalPaise" INTEGER NOT NULL DEFAULT 0,
    "visitedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CafeCustomerVisit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CafeReengagementLog" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'whatsapp',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CafeReengagementLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CafeOpsReport" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "date" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CafeOpsReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CafeOpsSchedule" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "reportType" TEXT NOT NULL,
    "cronExpr" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastRunAt" TIMESTAMP(3),
    "nextRunAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CafeOpsSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CafeLead_tenantId_idx" ON "CafeLead"("tenantId");
CREATE INDEX "CafeLead_tenantId_phone_idx" ON "CafeLead"("tenantId", "phone");
CREATE INDEX "CafeOrder_tenantId_idx" ON "CafeOrder"("tenantId");
CREATE INDEX "CafeOrder_tenantId_dedupHash_idx" ON "CafeOrder"("tenantId", "dedupHash");
CREATE INDEX "CafeOrder_tenantId_placedAt_idx" ON "CafeOrder"("tenantId", "placedAt");
CREATE UNIQUE INDEX "CafeOrder_tenantId_externalOrderId_source_key" ON "CafeOrder"("tenantId", "externalOrderId", "source");
CREATE INDEX "CafeReconciliation_tenantId_idx" ON "CafeReconciliation"("tenantId");
CREATE UNIQUE INDEX "CafeReconciliation_tenantId_date_source_key" ON "CafeReconciliation"("tenantId", "date", "source");
CREATE INDEX "CafeSettlement_tenantId_idx" ON "CafeSettlement"("tenantId");
CREATE INDEX "CafeInventoryItem_tenantId_idx" ON "CafeInventoryItem"("tenantId");
CREATE UNIQUE INDEX "CafeInventoryItem_tenantId_sku_key" ON "CafeInventoryItem"("tenantId", "sku");
CREATE INDEX "CafeStockMovement_tenantId_idx" ON "CafeStockMovement"("tenantId");
CREATE INDEX "CafeStockMovement_itemId_idx" ON "CafeStockMovement"("itemId");
CREATE INDEX "CafeWastageLog_tenantId_idx" ON "CafeWastageLog"("tenantId");
CREATE INDEX "CafeWastageLog_tenantId_weekStart_idx" ON "CafeWastageLog"("tenantId", "weekStart");
CREATE INDEX "CafeCustomer_tenantId_idx" ON "CafeCustomer"("tenantId");
CREATE INDEX "CafeCustomer_tenantId_tag_idx" ON "CafeCustomer"("tenantId", "tag");
CREATE UNIQUE INDEX "CafeCustomer_tenantId_phone_key" ON "CafeCustomer"("tenantId", "phone");
CREATE INDEX "CafeCustomerVisit_tenantId_idx" ON "CafeCustomerVisit"("tenantId");
CREATE INDEX "CafeCustomerVisit_customerId_idx" ON "CafeCustomerVisit"("customerId");
CREATE INDEX "CafeReengagementLog_tenantId_idx" ON "CafeReengagementLog"("tenantId");
CREATE INDEX "CafeOpsReport_tenantId_idx" ON "CafeOpsReport"("tenantId");
CREATE INDEX "CafeOpsReport_tenantId_type_date_idx" ON "CafeOpsReport"("tenantId", "type", "date");
CREATE INDEX "CafeOpsSchedule_tenantId_idx" ON "CafeOpsSchedule"("tenantId");
CREATE UNIQUE INDEX "CafeOpsSchedule_tenantId_reportType_key" ON "CafeOpsSchedule"("tenantId", "reportType");

-- ==================================================================
-- RLS for CafeOS module tables. Same tenant isolation pattern as the
-- platform tables: `SET LOCAL app.tenant_id` from withTenantContext().
-- ==================================================================

ALTER TABLE "CafeLead" ENABLE ROW LEVEL SECURITY;
CREATE POLICY cafe_lead_isolation ON "CafeLead"
  USING ("tenantId" = current_setting('app.tenant_id', true)::text)
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true)::text);

ALTER TABLE "CafeOrder" ENABLE ROW LEVEL SECURITY;
CREATE POLICY cafe_order_isolation ON "CafeOrder"
  USING ("tenantId" = current_setting('app.tenant_id', true)::text)
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true)::text);

ALTER TABLE "CafeReconciliation" ENABLE ROW LEVEL SECURITY;
CREATE POLICY cafe_reconciliation_isolation ON "CafeReconciliation"
  USING ("tenantId" = current_setting('app.tenant_id', true)::text)
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true)::text);

ALTER TABLE "CafeSettlement" ENABLE ROW LEVEL SECURITY;
CREATE POLICY cafe_settlement_isolation ON "CafeSettlement"
  USING ("tenantId" = current_setting('app.tenant_id', true)::text)
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true)::text);

ALTER TABLE "CafeInventoryItem" ENABLE ROW LEVEL SECURITY;
CREATE POLICY cafe_inventory_item_isolation ON "CafeInventoryItem"
  USING ("tenantId" = current_setting('app.tenant_id', true)::text)
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true)::text);

ALTER TABLE "CafeStockMovement" ENABLE ROW LEVEL SECURITY;
CREATE POLICY cafe_stock_movement_isolation ON "CafeStockMovement"
  USING ("tenantId" = current_setting('app.tenant_id', true)::text)
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true)::text);

ALTER TABLE "CafeWastageLog" ENABLE ROW LEVEL SECURITY;
CREATE POLICY cafe_wastage_log_isolation ON "CafeWastageLog"
  USING ("tenantId" = current_setting('app.tenant_id', true)::text)
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true)::text);

ALTER TABLE "CafeCustomer" ENABLE ROW LEVEL SECURITY;
CREATE POLICY cafe_customer_isolation ON "CafeCustomer"
  USING ("tenantId" = current_setting('app.tenant_id', true)::text)
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true)::text);

ALTER TABLE "CafeCustomerVisit" ENABLE ROW LEVEL SECURITY;
CREATE POLICY cafe_customer_visit_isolation ON "CafeCustomerVisit"
  USING ("tenantId" = current_setting('app.tenant_id', true)::text)
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true)::text);

ALTER TABLE "CafeReengagementLog" ENABLE ROW LEVEL SECURITY;
CREATE POLICY cafe_reengagement_log_isolation ON "CafeReengagementLog"
  USING ("tenantId" = current_setting('app.tenant_id', true)::text)
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true)::text);

ALTER TABLE "CafeOpsReport" ENABLE ROW LEVEL SECURITY;
CREATE POLICY cafe_ops_report_isolation ON "CafeOpsReport"
  USING ("tenantId" = current_setting('app.tenant_id', true)::text)
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true)::text);

ALTER TABLE "CafeOpsSchedule" ENABLE ROW LEVEL SECURITY;
CREATE POLICY cafe_ops_schedule_isolation ON "CafeOpsSchedule"
  USING ("tenantId" = current_setting('app.tenant_id', true)::text)
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true)::text);

-- ------------------------------------------------------------------
-- Module catalog registration helper (SECURITY DEFINER, owner runs it
-- so RLS on Module does not block app-role writes).
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.module_register(
  p_id text,
  p_name text,
  p_display_name text,
  p_description text,
  p_version text,
  p_contract_path text
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO "Module" (id, name, "displayName", description, version, "contractPath")
  VALUES (p_id, p_name, p_display_name, p_description, p_version, p_contract_path)
  ON CONFLICT ("name") DO UPDATE
    SET "displayName" = EXCLUDED."displayName",
        description = EXCLUDED.description,
        version = EXCLUDED.version,
        "contractPath" = EXCLUDED."contractPath";
  RETURN p_name;
END;
$$;

GRANT EXECUTE ON FUNCTION public.module_register(text,text,text,text,text,text) TO wavesco_app;
