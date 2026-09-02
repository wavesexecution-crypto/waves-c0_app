import { NextResponse } from "next/server";
import { auditControl, requireControlAuth } from "@/lib/wavesco/control";
import { withTenantContext } from "@wavesco/db";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const { tenantId, userId } = await requireControlAuth();

    let body: Record<string, unknown> = {};
    try {
      const raw = await req.text();
      if (raw) body = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      body = {};
    }

    const q =
      typeof body.q === "string"
        ? body.q.trim()
        : typeof body.search === "string"
          ? (body.search as string).trim()
          : "";
    const tier = typeof body.tier === "string" ? body.tier.trim() : undefined;
    const category = typeof body.category === "string" ? body.category.trim() : undefined;
    const city = typeof body.city === "string" ? body.city.trim() : undefined;
    const outreach = typeof body.outreach === "string" ? body.outreach.trim() : undefined;
    const limitRaw = typeof body.limit === "number" ? (body.limit as number) : 1000;
    const limit = Math.min(Math.max(Math.trunc(limitRaw) || 1000, 1), 1000);

    // Build Prisma where with tenant RLS
    const where: Record<string, unknown> = { tenantId };
    if (q) {
      (where as Record<string, unknown>).OR = [
        { business: { contains: q, mode: "insensitive" } },
        { category: { contains: q, mode: "insensitive" } },
        { city: { contains: q, mode: "insensitive" } },
        { area: { contains: q, mode: "insensitive" } },
        { email: { contains: q, mode: "insensitive" } },
      ];
    }
    if (tier && tier !== "all" && tier !== "") (where as Record<string, unknown>).tier = tier;
    if (category && category !== "all" && category !== "") (where as Record<string, unknown>).category = category;
    if (city && city !== "all" && city !== "") (where as Record<string, unknown>).city = city;
    // outreach filter: map to email/verification if needed; keep for audit only

    const rows = await withTenantContext(tenantId, async (tx: any) => {
      return tx.leadResearch.findMany({
        where,
        take: limit,
        orderBy: { leadScore: "desc" },
        select: {
          business: true,
          category: true,
          city: true,
          area: true,
          tier: true,
          leadScore: true,
          email: true,
          website: true,
          rating: true,
          reviews: true,
        },
      });
    });

    await auditControl({
      tenantId,
      userId,
      action: "leads.export",
      model: "LeadResearch",
      metadata: {
        filters: { q: q || undefined, tier, category, city, outreach, limit },
        count: rows.length,
      },
    });

    const header = [
      "business",
      "category",
      "city",
      "area",
      "tier",
      "leadScore",
      "email",
      "website",
      "rating",
      "reviews",
    ];

    const escape = (v: unknown): string => {
      if (v === null || v === undefined) return "";
      const s = String(v).replace(/"/g, '""');
      if (s.includes(",") || s.includes('"') || s.includes("\n") || s.includes("\r")) return `"${s}"`;
      return s;
    };

    const csvRows = (rows as Record<string, unknown>[]).map((r) =>
      header.map((h) => escape(r[h])).join(",")
    );
    const csv = [header.join(","), ...csvRows].join("\n");

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");

    return new NextResponse(csv, {
      status: 200,
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="leads-export-${timestamp}.csv"`,
        "cache-control": "no-store",
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const digest = (e as { digest?: string })?.digest as string | undefined;
    const isUnauthorized =
      msg === "UNAUTHORIZED" ||
      msg.includes("UNAUTHORIZED") ||
      msg.includes("NEXT_REDIRECT") ||
      (digest !== undefined && digest.includes("NEXT_REDIRECT"));
    if (isUnauthorized) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ error: "internal", detail: msg }, { status: 500 });
  }
}
