import { NextResponse } from "next/server";
import { acquisitionDenied, requireControlAuth, auditControl } from "@/lib/wavesco/control";
import { withTenantContext } from "@wavesco/db";

export const dynamic = "force-dynamic";

function isUnauthorized(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  const digest = (e as any)?.digest as string | undefined;
  return msg === "UNAUTHORIZED" || msg.includes("UNAUTHORIZED") || msg.includes("NEXT_REDIRECT") || !!(digest && digest.includes("NEXT_REDIRECT"));
}

// POST { fileName, fileType: "csv"|"excel"|"json", rowCount?, summary? }
// The actual file bytes should be uploaded via direct storage or via GenerationBatch/lead import flow;
// this endpoint records the import metadata tenant-scoped and audited, never storing raw secrets.
export async function POST(req: Request) {
  try {
    const { tenantId, userId } = await requireControlAuth();
    const denied = await acquisitionDenied(tenantId);
    if (denied) return NextResponse.json(denied.body, { status: denied.status });
    const body = await req.json().catch(() => ({}));
    const { fileName, fileType, rowCount, summary } = body as any;

    if (!fileName || typeof fileName !== "string") {
      return NextResponse.json({ error: "fileName required" }, { status: 400 });
    }
    const allowed = new Set(["csv", "excel", "xlsx", "xls", "json"]);
    const ft = (fileType || "csv").toLowerCase();
    if (!allowed.has(ft)) {
      return NextResponse.json({ error: "fileType must be csv|excel|json" }, { status: 400 });
    }
    if (rowCount !== undefined && rowCount !== null && (!Number.isFinite(Number(rowCount)) || Number(rowCount) < 0)) {
      return NextResponse.json({ error: "rowCount must be non-negative" }, { status: 400 });
    }

    const result = await withTenantContext(tenantId, async (tx: any) => {
      let profile = await (tx as any).acquisitionProfile.findFirst({ where: { tenantId } });
      if (!profile) {
        // Auto-create DRAFT profile so import has a parent
        profile = await (tx as any).acquisitionProfile.create({
          data: { tenantId, status: "DRAFT" },
        });
        await auditControl({
          tenantId,
          userId,
          action: "acquisition_profile.create",
          model: "AcquisitionProfile",
          recordId: profile.id,
          after: profile,
        });
      }

      const imp = await (tx as any).acquisitionDataImport.create({
        data: {
          tenantId,
          profileId: profile.id,
          fileName: String(fileName).slice(0, 200),
          fileType: ft,
          rowCount: rowCount ? Number(rowCount) : null,
          status: "processed",
          summary: summary ? (summary as any) : null,
        },
      });

      await auditControl({
        tenantId,
        userId,
        action: "acquisition_profile.import",
        model: "AcquisitionDataImport",
        recordId: imp.id,
        after: { fileName, fileType: ft, rowCount },
        metadata: { profileId: profile.id },
      });

      return { import: imp, profileId: profile.id };
    });

    return NextResponse.json(result, { status: 200 });
  } catch (e) {
    if (isUnauthorized(e)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: "internal", detail: msg }, { status: 500 });
  }
}

export async function GET(req: Request) {
  try {
    const { tenantId } = await requireControlAuth();
    const denied = await acquisitionDenied(tenantId);
    if (denied) return NextResponse.json(denied.body, { status: denied.status });
    const url = new URL(req.url);
    const limit = Math.min(Math.max(Number(url.searchParams.get("limit") || "10"), 1), 50);
    const imports = await withTenantContext(tenantId, async (tx: any) => {
      return (tx as any).acquisitionDataImport.findMany({
        where: { tenantId },
        orderBy: { createdAt: "desc" },
        take: limit,
      });
    });
    return NextResponse.json({ imports, limit, count: imports.length });
  } catch (e) {
    if (isUnauthorized(e)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: "internal", detail: msg }, { status: 500 });
  }
}
