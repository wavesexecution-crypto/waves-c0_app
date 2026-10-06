-- Scope the explicit AuditLog INSERT policy to the caller's own tenant.
--
-- 20260630000000_init created:
--     CREATE POLICY auditlog_insert ON "AuditLog" FOR INSERT WITH CHECK (true);
-- `WITH CHECK (true)` means any tenant can insert an audit row bearing ANOTHER
-- tenant's id. The migration that restored the INSERT grant relied on an
-- unenforced invariant ("Application code always passes its own tenant id").
-- That invariant is now enforced in code, but the policy should enforce it too.
--
-- Why this is safe for the auto-audit path: `public.audit_log_write` is
-- SECURITY DEFINER, so it executes as the table owner and is unaffected by this
-- policy. The audit extension (packages/db/src/audit.ts) keeps working
-- unchanged.
--
-- Why this is required for the explicit path: application audit writes now run
-- on the tenant transaction, where `SET LOCAL app.tenant_id` is set. With the
-- policy scoped, a write for another tenant is rejected by the database rather
-- than trusted to the caller.
--
-- Reads are unchanged (auditlog_select is already tenant-scoped), so no tenant
-- can read another tenant's audit records.

DROP POLICY IF EXISTS auditlog_insert ON "AuditLog";

CREATE POLICY auditlog_insert ON "AuditLog"
  FOR INSERT
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true)::text);
