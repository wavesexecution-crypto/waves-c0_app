-- WavesCo: remove legacy CafeOS demo tables.
-- The Cafe modules were removed from the module registry earlier; no
-- application code references these tables anymore (dependency-inspected).
-- Tables are empty on the system-of-record database; drops are safe.

DROP TABLE IF EXISTS "CafeOpsSchedule" CASCADE;
DROP TABLE IF EXISTS "CafeOpsReport" CASCADE;
DROP TABLE IF EXISTS "CafeReengagementLog" CASCADE;
DROP TABLE IF EXISTS "CafeCustomerVisit" CASCADE;
DROP TABLE IF EXISTS "CafeCustomer" CASCADE;
DROP TABLE IF EXISTS "CafeWastageLog" CASCADE;
DROP TABLE IF EXISTS "CafeStockMovement" CASCADE;
DROP TABLE IF EXISTS "CafeInventoryItem" CASCADE;
DROP TABLE IF EXISTS "CafeSettlement" CASCADE;
DROP TABLE IF EXISTS "CafeReconciliation" CASCADE;
DROP TABLE IF EXISTS "CafeOrder" CASCADE;
DROP TABLE IF EXISTS "CafeLead" CASCADE;

-- Registry rows seeded by the legacy init migration.
DELETE FROM "Module" WHERE name LIKE 'cafe-%';
