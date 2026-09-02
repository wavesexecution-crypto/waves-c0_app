import { NextResponse } from "next/server";
import { getDirectPrisma } from "@wavesco/db";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const secret = req.headers.get("x-migrate-secret") || "";
  const expected = process.env.MIGRATE_SECRET || "wavesco-migrate-2026-09-02";
  if (secret !== expected) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const sql = `
CREATE TABLE IF NOT EXISTS "WavesHandoffToken" (
    "id" TEXT NOT NULL,
    "jti" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WavesHandoffToken_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "WavesHandoffToken_jti_key" ON "WavesHandoffToken"("jti");
CREATE INDEX IF NOT EXISTS "WavesHandoffToken_tenantId_idx" ON "WavesHandoffToken"("tenantId");
CREATE INDEX IF NOT EXISTS "WavesHandoffToken_expiresAt_idx" ON "WavesHandoffToken"("expiresAt");
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'WavesHandoffToken_tenantId_fkey') THEN ALTER TABLE "WavesHandoffToken" ADD CONSTRAINT "WavesHandoffToken_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE; END IF; END $$;
ALTER TABLE "WavesHandoffToken" ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'waveshandofftoke_isolation') THEN CREATE POLICY "waveshandofftoke_isolation" ON "WavesHandoffToken" USING ("tenantId" = current_setting('app.tenant_id', true)) WITH CHECK ("tenantId" = current_setting('app.tenant_id', true)); END IF; END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON "WavesHandoffToken" TO wavesco_app;
INSERT INTO "_prisma_migrations" (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count) VALUES (gen_random_uuid(), 'handoff-manual', NOW(), '20260903000000_waves_handoff', '', NULL, NOW(), 1) ON CONFLICT DO NOTHING;
`;

  function splitSql(s: string): string[] {
    const out: string[] = [];
    let cur = "";
    let inDollar = false;
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      const next2 = s.slice(i, i + 2);
      if (next2 === "$$") {
        inDollar = !inDollar;
        cur += "$$";
        i += 1;
        continue;
      }
      if (ch === ";" && !inDollar) {
        if (cur.trim()) out.push(cur.trim());
        cur = "";
      } else cur += ch;
    }
    if (cur.trim()) out.push(cur.trim());
    return out;
  }

  let direct: any;
  try {
    direct = getDirectPrisma();
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
  try {
    const statements = splitSql(sql);
    let applied = 0;
    const errors: string[] = [];
    for (const stmt of statements) {
      try {
        await (direct as any).$executeRawUnsafe(stmt + (stmt.endsWith(";") ? "" : ";"));
        applied++;
      } catch (e) {
        const m = e instanceof Error ? e.message : String(e);
        if (m.includes("already exists") || m.includes("duplicate") || m.includes("42P07") || m.includes("42710")) {
          applied++;
          continue;
        }
        errors.push(m);
      }
    }
    await direct.$disconnect();
    if (errors.length) return NextResponse.json({ ok: false, applied, errors }, { status: 500 });
    return NextResponse.json({ ok: true, applied });
  } catch (e) {
    try { await direct.$disconnect(); } catch {}
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
export async function GET() {
  return NextResponse.json({ error: "use POST" }, { status: 405 });
}
