/**
 * READ-ONLY RLS / grant diagnostics. Issues SELECTs only.
 * Usage: node scripts/rls-diag.mjs
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

// The Prisma client is generated to a custom output dir (see schema.prisma),
// so import it from there rather than from @prisma/client.
const require = createRequire(import.meta.url);
const { PrismaClient } = require("../src/generated/client/index.js");

function envFrom(file) {
  const out = {};
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

const env = envFrom(process.argv[2] ?? "../../.env");
const db = new PrismaClient({ datasources: { db: { url: env.DIRECT_URL || env.DATABASE_URL } } });

const queries = [
  ["connected role", `SELECT current_user AS role, current_database() AS db,
     (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS super,
     (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) AS bypassrls`],
  ["known roles", `SELECT rolname, rolsuper, rolbypassrls FROM pg_roles
     WHERE rolname IN ('wavesco_app','wavesco','neondb_owner') ORDER BY rolname`],
  ["AuditLog grants", `SELECT grantee, privilege_type FROM information_schema.role_table_grants
     WHERE table_name = 'AuditLog' ORDER BY grantee, privilege_type`],
  ["AuditLog RLS", `SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = 'AuditLog'`],
  ["AuditLog policies", `SELECT policyname, cmd, roles::text AS roles, with_check FROM pg_policies
     WHERE tablename = 'AuditLog' ORDER BY policyname`],
  ["recent migrations", `SELECT migration_name,
       (finished_at IS NOT NULL) AS finished,
       (rolled_back_at IS NOT NULL) AS rolled_back
     FROM _prisma_migrations ORDER BY started_at DESC LIMIT 8`],
];

try {
  for (const [label, sql] of queries) {
    const rows = await db.$queryRawUnsafe(sql);
    console.log(`\n--- ${label} ---`);
    console.log(JSON.stringify(rows, null, 1));
  }
} catch (e) {
  console.error("DIAG FAILED:", e.message);
  process.exitCode = 1;
} finally {
  await db.$disconnect();
}
