-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "Tenant" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "plan" TEXT NOT NULL DEFAULT 'starter',
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Tenant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "passwordHash" TEXT,
    "role" TEXT NOT NULL DEFAULT 'owner',
    "emailVerified" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefreshToken" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Module" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "description" TEXT,
    "version" TEXT NOT NULL,
    "contractPath" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Module_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TenantModule" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "moduleId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'enabled',
    "config" JSONB,
    "enabledAt" TIMESTAMP(3),
    "disabledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenantModule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "recordId" TEXT,
    "before" JSONB,
    "after" JSONB,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IdempotencyKey" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "response" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "IdempotencyKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationToken" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VerificationToken_pkey" PRIMARY KEY ("identifier","token")
);

-- CreateIndex
CREATE UNIQUE INDEX "Tenant_slug_key" ON "Tenant"("slug");

-- CreateIndex
CREATE INDEX "User_email_idx" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_tenantId_email_key" ON "User"("tenantId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "RefreshToken_tokenHash_key" ON "RefreshToken"("tokenHash");

-- CreateIndex
CREATE INDEX "RefreshToken_userId_idx" ON "RefreshToken"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Module_name_key" ON "Module"("name");

-- CreateIndex
CREATE UNIQUE INDEX "TenantModule_tenantId_moduleId_key" ON "TenantModule"("tenantId", "moduleId");

-- CreateIndex
CREATE INDEX "AuditLog_tenantId_idx" ON "AuditLog"("tenantId");

-- CreateIndex
CREATE INDEX "AuditLog_model_recordId_idx" ON "AuditLog"("model", "recordId");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "IdempotencyKey_expiresAt_idx" ON "IdempotencyKey"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "IdempotencyKey_tenantId_scope_key_key" ON "IdempotencyKey"("tenantId", "scope", "key");

-- CreateIndex
CREATE INDEX "VerificationToken_expires_idx" ON "VerificationToken"("expires");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantModule" ADD CONSTRAINT "TenantModule_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantModule" ADD CONSTRAINT "TenantModule_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "Module"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IdempotencyKey" ADD CONSTRAINT "IdempotencyKey_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ==================================================================
-- WavesCo RLS layer
--
-- Runtime role (wavesco_app) does NOT own the tables above, so RLS is
-- enforced for app traffic. `withTenantContext()` runs each transaction
-- with `SET LOCAL app.tenant_id`, and the policies below scope every
-- row operation to that value.
-- ==================================================================

-- Ensure the runtime role exists even if the bootstrap init.sql has not run.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'wavesco_app') THEN
    CREATE ROLE wavesco_app LOGIN PASSWORD 'wavesco_app';
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO wavesco_app;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  "Tenant", "User", "RefreshToken", "TenantModule", "AuditLog", "IdempotencyKey", "VerificationToken"
  TO wavesco_app;
GRANT SELECT ON TABLE "Module" TO wavesco_app;

-- ------------------------------------------------------------------
-- RLS policies. `current_setting('app.tenant_id', true)` is NULL when
-- unset, so a missing tenant context is denied, never silently allowed.
-- ------------------------------------------------------------------

ALTER TABLE "Tenant" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Tenant"
  USING (id = current_setting('app.tenant_id', true)::text)
  WITH CHECK (id = current_setting('app.tenant_id', true)::text);

ALTER TABLE "User" ENABLE ROW LEVEL SECURITY;
CREATE POLICY user_isolation ON "User"
  USING ("tenantId" = current_setting('app.tenant_id', true)::text)
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true)::text);

ALTER TABLE "RefreshToken" ENABLE ROW LEVEL SECURITY;
CREATE POLICY refresh_token_isolation ON "RefreshToken"
  USING ("tenantId" = current_setting('app.tenant_id', true)::text)
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true)::text);

ALTER TABLE "TenantModule" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_module_isolation ON "TenantModule"
  USING ("tenantId" = current_setting('app.tenant_id', true)::text)
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true)::text);

-- Idempotency keys are tenant-scoped.
ALTER TABLE "IdempotencyKey" ENABLE ROW LEVEL SECURITY;
CREATE POLICY idempotency_isolation ON "IdempotencyKey"
  USING ("tenantId" = current_setting('app.tenant_id', true)::text)
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true)::text);

-- Audit log: reads are tenant-scoped; writes are routed through a
-- SECURITY DEFINER function so RLS never blocks them.
ALTER TABLE "AuditLog" ENABLE ROW LEVEL SECURITY;
CREATE POLICY auditlog_select ON "AuditLog"
  FOR SELECT
  USING ("tenantId" = current_setting('app.tenant_id', true)::text);
CREATE POLICY auditlog_insert ON "AuditLog"
  FOR INSERT
  WITH CHECK (true);

-- Revoke direct INSERT on AuditLog; the audit extension writes via the
-- SECURITY DEFINER function below instead.
REVOKE INSERT ON TABLE "AuditLog" FROM wavesco_app;

-- Module catalog is global read-only for the app role.
ALTER TABLE "Module" ENABLE ROW LEVEL SECURITY;
CREATE POLICY module_readable ON "Module"
  USING (true)
  WITH CHECK (false);

-- Auth-level verification tokens are not tenant-scoped; Auth.js writes
-- them via the base client without a tenant context.
ALTER TABLE "VerificationToken" ENABLE ROW LEVEL SECURITY;
CREATE POLICY verification_token_permissive ON "VerificationToken"
  USING (true)
  WITH CHECK (true);

-- ------------------------------------------------------------------
-- Auth lookup: SECURITY DEFINER function (owner bypasses RLS) so login
-- can resolve a user by email before any tenant context exists.
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lookup_user_by_email(target_email text)
RETURNS TABLE (
  id text,
  "tenantId" text,
  email text,
  name text,
  "passwordHash" text,
  role text,
  "emailVerified" timestamptz,
  status text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT u.id, u."tenantId", u.email, u.name, u."passwordHash", u.role, u."emailVerified", u.status
  FROM "User" u
  WHERE u.email = target_email
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.lookup_user_by_email(text) TO wavesco_app;

-- ------------------------------------------------------------------
-- Audit write helper: SECURITY DEFINER function (owner bypasses RLS).
-- The audit extension calls this via $executeRaw on a pooled connection
-- that has no tenant GUC set. RLS is bypassed because the function
-- runs as the table owner.
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.audit_log_write(
  p_tenant_id text,
  p_user_id text,
  p_action text,
  p_model text,
  p_record_id text,
  p_after jsonb,
  p_metadata jsonb
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO "AuditLog" (id, "tenantId", "userId", action, model, "recordId", after, metadata)
  VALUES (
    replace(gen_random_uuid()::text, '-', ''),
    p_tenant_id,
    p_user_id,
    p_action,
    p_model,
    p_record_id,
    p_after,
    p_metadata
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.audit_log_write(text,text,text,text,text,jsonb,jsonb) TO wavesco_app;

-- ------------------------------------------------------------------
-- Module catalog seed (Phase 6 modules; contracts validated by
-- `pnpm verify:contracts`). Inserted here so the owner role bypasses
-- RLS during migrations.
-- ------------------------------------------------------------------
INSERT INTO "Module" ("id", "name", "displayName", "description", "version", "contractPath")
VALUES
  ('mod_cafe_leads',     'cafe-leads',     'Cafe Leads',     'Lead capture, AI enrichment and Telegram notifications', '0.1.0', 'modules/cafe-leads/module.contract.json'),
  ('mod_cafe_orders',    'cafe-orders',    'Cafe Orders',    'Swiggy/Zomato order intake with HMAC webhook verification', '0.1.0', 'modules/cafe-orders/module.contract.json'),
  ('mod_cafe_inventory', 'cafe-inventory', 'Cafe Inventory', 'Stock, par levels, low-stock alerts and wastage', '0.1.0', 'modules/cafe-inventory/module.contract.json'),
  ('mod_cafe_crm',       'cafe-crm',       'Cafe CRM',       'Customer tags, LTV and WhatsApp re-engagement', '0.1.0', 'modules/cafe-crm/module.contract.json'),
  ('mod_cafe_ops',       'cafe-ops',       'Cafe Ops',       'Daily briefings and weekly reports across modules', '0.1.0', 'modules/cafe-ops/module.contract.json')
ON CONFLICT ("name") DO NOTHING;
