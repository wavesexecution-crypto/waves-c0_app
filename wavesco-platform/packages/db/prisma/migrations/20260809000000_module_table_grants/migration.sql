-- Module tables were created in 20260701000000_cafeos_modules with RLS
-- policies but no explicit GRANTs to wavesco_app. The init migration
-- granted platform tables explicitly; the module migration instead relied
-- on ALTER DEFAULT PRIVILEGES in docker/postgres/init.sql, which does not
-- exist in pg_default_acl for freshly-created tables when the container
-- was already bootstrapped. Add explicit grants for every module table.

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  "CafeLead",
  "CafeOrder",
  "CafeReconciliation",
  "CafeSettlement",
  "CafeInventoryItem",
  "CafeStockMovement",
  "CafeWastageLog",
  "CafeCustomer",
  "CafeCustomerVisit",
  "CafeReengagementLog",
  "CafeOpsReport",
  "CafeOpsSchedule"
  TO wavesco_app;
