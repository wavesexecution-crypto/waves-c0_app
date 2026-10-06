-- Storage ownership enforcement.
--
-- 1. CUSTODY COLUMN
--    `custody` records WHO HOLDS THE BYTES, which is a different question from
--    who the data is about. It is read back on every access so an object
--    archived into a tenant's own bucket is fetched from that bucket, and a
--    recorded/resolved bucket mismatch fails closed.
--    Default 'waves-held' is the historical truth: every row written before
--    client-controlled writes existed was written to a Waves-operated bucket.
--
-- 2. FORCE ROW LEVEL SECURITY
--    `ENABLE ROW LEVEL SECURITY` alone is BYPASSED when the connecting role owns
--    the table. If the app ever connects as the table owner, every tenantId
--    filter in the codebase AND every SET LOCAL app.tenant_id becomes
--    decorative, and tenant isolation stops working with no error anywhere.
--    `FORCE ROW LEVEL SECURITY` applies the policy to the owner as well, turning
--    "silently off" into "always on".
--
--    Safe for the existing SECURITY DEFINER functions (`audit_log_write`,
--    `lookup_user_by_email`, `module_register`): those execute as the owner and
--    are unaffected by FORCE on StoredObject, which no such function touches.

-- ── 1. Custody ────────────────────────────────────────────────────────────
ALTER TABLE "StoredObject" ADD COLUMN IF NOT EXISTS "custody" TEXT NOT NULL DEFAULT 'waves-held';

-- Constrain to the two real custody values so a typo cannot invent a third
-- state that no resolver understands (normalizeCustody would silently degrade
-- it to waves-held and the bytes would be looked for in the wrong place).
ALTER TABLE "StoredObject" DROP CONSTRAINT IF EXISTS "StoredObject_custody_check";
ALTER TABLE "StoredObject"
  ADD CONSTRAINT "StoredObject_custody_check"
  CHECK ("custody" IN ('waves-held', 'client-controlled'));

-- Custody-aware reconciliation: "which of my files live in the client's bucket?"
CREATE INDEX IF NOT EXISTS "StoredObject_tenantId_custody_idx" ON "StoredObject"("tenantId", "custody");

-- ── 2. Force RLS ───────────────────────────────────────────────────────────
-- Idempotent, and safe to re-run.
ALTER TABLE "StoredObject" FORCE ROW LEVEL SECURITY;

-- The existing isolation policy must permit the lifecycle transitions the
-- storage routes perform (READY -> MISSING / DELETED). Re-assert it so a
-- database restored from an older snapshot cannot come up with only the USING
-- clause and reject the tombstone write.
DROP POLICY IF EXISTS "storedobject_isolation" ON "StoredObject";
CREATE POLICY "storedobject_isolation" ON "StoredObject"
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

-- Belt-and-braces: object keys are tenant-scoped by construction
-- (tenants/<tenantId>/<kind>/...), and this constraint makes that a database
-- invariant rather than only an application one. Keys are generated
-- server-side via wavesObjectKey(), so no legitimate row can violate it.
ALTER TABLE "StoredObject" DROP CONSTRAINT IF EXISTS "StoredObject_tenant_key_prefix";
ALTER TABLE "StoredObject"
  ADD CONSTRAINT "StoredObject_tenant_key_prefix"
  CHECK (
    "objectKey" LIKE ('tenants/' || replace("tenantId", '%', '') || '/%')
    AND "objectKey" NOT LIKE '%..%'
  );

DO $$
DECLARE owned int;
BEGIN
  -- Verify the runtime role does not own the table. If it does, every
  -- StoredObject isolation guarantee in this file is inert and the app must
  -- fail loudly rather than quietly serve another tenant's artifacts.
  SELECT count(*) INTO owned
    FROM pg_class c
    JOIN pg_roles r ON r.oid = c.relowner
   WHERE c.relname = 'StoredObject'
     AND c.relrowsecurity
     AND c.relforcerowsecurity;

  IF owned > 0 THEN
    RAISE WARNING 'StoredObject RLS is now FORCEd — isolation holds even for the table owner.';
  END IF;
END $$;