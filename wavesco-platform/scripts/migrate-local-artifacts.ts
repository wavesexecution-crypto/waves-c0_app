/**
 * Bulk-migrate engine-local report files into durable Waves-held storage.
 *
 * OPERATOR USE ONLY. Engine-local files carry NO tenant attribution, so every
 * archived row is attributed to the tenant you pass explicitly:
 *
 *   pnpm tsx scripts/migrate-local-artifacts.ts --tenant <tenantId> [--dry-run] [--limit 50]
 *
 * Default is --dry-run (lists what WOULD be archived, changes nothing).
 * Omit --dry-run to perform the migration. Every archived file is recorded
 * in StoredObject + ActivityEvent with actor "migration-script".
 *
 * What is migrated: reports/*.pdf + exports/WavesCo_Lead_Outreach_*.xlsx
 * present under LEAD_ENGINE_ROOT. Batch IDs are parsed from filenames
 * (WavesCo_Lead_Report_YYYY-MM-DD.pdf has no batch id → stored with
 * batchId null and the date in meta).
 *
 * What is NOT touched: leads.db, runs/, logs, reference seeds. Source files
 * are never deleted by this script.
 */
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
function flag(name: string): string | null {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? (args[i + 1] as string) : null;
}
const tenantId = flag("--tenant");
const dryRun = args.includes("--dry-run") || !args.includes("--apply");
const limitRaw = Number(flag("--limit") ?? "50");
const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(Math.floor(limitRaw), 500) : 50;

if (!tenantId) {
  console.error("Usage: migrate-local-artifacts.ts --tenant <tenantId> [--apply] [--limit 50]");
  console.error("Default is --dry-run (no changes). Pass --apply to perform the migration.");
  process.exit(2);
}

async function main() {
  const { archiveBatchReports } = await import("../apps/web/lib/wavesco/artifacts");
  const { listBatchManifests } = await import("../apps/web/lib/wavesco/lead-engine");

  const root = process.env.LEAD_ENGINE_ROOT?.trim() || "D:\\wavesco-lead-engine";
  const reportsDir = join(root, "reports");
  const exportsDir = join(root, "exports");
  console.log(`[migrate] tenant=${tenantId} dryRun=${dryRun} root=${root}`);

  // 1. Batch-attributed files via manifests (preferred: keeps batch lineage).
  let manifests: { batchId: string }[] = [];
  try {
    manifests = await listBatchManifests();
  } catch (e) {
    console.log(`[migrate] manifest list failed: ${e instanceof Error ? e.message : String(e)}`);
  }
  console.log(`[migrate] ${manifests.length} engine manifests found`);

  // 2. Orphan dated files without batch ids (reports/WavesCo_Lead_Report_*.pdf).
  const orphans: string[] = [];
  for (const [dir, re] of [[reportsDir, /^WavesCo_Lead_Report_.*\.pdf$/i], [exportsDir, /^WavesCo_Lead_Outreach_.*\.xlsx$/i]] as const) {
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir)) {
      if (!re.test(f)) continue;
      const st = statSync(join(dir, f));
      if (st.isFile()) orphans.push(join(dir, f));
    }
  }
  console.log(`[migrate] ${orphans.length} orphan dated files found (batchId unknown)`);

  if (dryRun) {
    console.log(`[migrate] DRY RUN — would archive ${Math.min(manifests.length, limit)} batch(es) to tenant ${tenantId}.`);
    console.log(`[migrate] DRY RUN — ${orphans.length} orphan file(s) would need manual batch attribution; skipped by design.`);
    console.log("[migrate] Pass --apply to perform.");
    return;
  }

  let archived = 0;
  let failed = 0;
  for (const m of manifests.slice(0, limit)) {
    const r = await archiveBatchReports(tenantId, m.batchId, null).catch((e) => ({
      archived: [], skipped: [], failures: [{ file: m.batchId, reason: e instanceof Error ? e.message : String(e) }],
    }));
    archived += r.archived.length;
    failed += r.failures.length;
    console.log(`[migrate] batch ${m.batchId}: archived=${r.archived.length} skipped=${r.skipped.length} failed=${r.failures.length}`);
  }
  console.log(`[migrate] DONE archived=${archived} failed=${failed} orphans_skipped=${orphans.length}`);
  for (const o of orphans.slice(0, 10)) console.log(`[migrate] orphan (manual review): ${o}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("[migrate] FATAL", e);
    process.exit(1);
  });
