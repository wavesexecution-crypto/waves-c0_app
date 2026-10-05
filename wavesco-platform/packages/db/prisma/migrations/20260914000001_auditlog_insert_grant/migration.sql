-- Restore direct AuditLog INSERT for the runtime role.
--
-- The init migration revoked INSERT because, at the time, only the auto-audit
-- extension wrote rows (via the audit_log_write SECURITY DEFINER function).
-- The codebase has since standardized on EXPLICIT audit writes
-- (auditControl, entitlement/provisioning flows, billing) issued as
-- `tx.auditLog.create` inside the tenant transaction so each audit row
-- commits atomically with the mutation it describes. Under RLS those fail
-- with 42501 permission-denied, rolling back the mutation too.
--
-- This grant restores the pre-revoke behavior. Reads stay tenant-scoped
-- (auditlog_select); the insert policy (WITH CHECK true) matches the trust
-- model of audit_log_write, which likewise accepts the tenant id from the
-- caller. Application code always passes its own tenant id.

GRANT INSERT ON TABLE "AuditLog" TO wavesco_app;
