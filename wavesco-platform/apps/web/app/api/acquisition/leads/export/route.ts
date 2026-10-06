import { NextResponse } from "next/server";
import { acquisitionDenied, auditControl, requireControlAuth } from "@/lib/wavesco/control";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const { tenantId, userId } = await requireControlAuth();
    const denied = await acquisitionDenied(tenantId);
    if (denied) return NextResponse.json(denied.body, { status: denied.status });

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
    const outreachRaw = typeof body.outreach === "string" ? body.outreach.trim() : "";
    const outreach = ["contacted", "uncontacted", "opted_out", "replied"].includes(outreachRaw)
      ? (outreachRaw as "contacted" | "uncontacted" | "opted_out" | "replied")
      : undefined;
    if (outreach) {
      // TENANT ISOLATION: `date_contacted` / `opted_out` / `reply_status` live
      // in the single shared Lead Engine corpus with no tenant column, so
      // filtering by them selects rows according to ANOTHER tenant's outreach
      // history — letting a tenant enumerate who everyone else has contacted
      // (and whose prospects have opted out, which is consent state).
      // The export never emits those columns anyway, so accepting the filter
      // only ever produced a misleading file. Refuse it explicitly.
      return NextResponse.json(
        {
          error:
            "Outreach filters cannot be exported — contact history is not per-workspace data.",
          whatNext: "Clear the outreach filter and export again.",
        },
        { status: 400 },
      );
    }
    const limitRaw = typeof body.limit === "number" ? (body.limit as number) : 1000;
    const limit = Math.min(Math.max(Math.trunc(limitRaw) || 1000, 1), 1000);

    // Export the SAME dataset the Leads table renders. This previously queried
    // the tenant's LeadResearch snapshots while the page shows the Lead Engine
    // corpus, so a client could filter Tier A in Pune, see 25 rows, and export a
    // header-only file — or an entirely different set.
    const { listLeads } = await import("@/lib/wavesco/lead-engine");
    const { rows, total } = await listLeads({
      search: q || undefined,
      tier: tier && tier !== "all" ? tier : undefined,
      category: category && category !== "all" ? category : undefined,
      city: city && city !== "all" ? city : undefined,
      outreach,
      sort: "score",
      page: 1,
      pageSize: limit,
    });

    await auditControl({
      tenantId,
      userId,
      action: "leads.export",
      model: "LeadCorpus",
      metadata: {
        filters: { q: q || undefined, tier, category, city, outreach: outreach ?? undefined, limit },
        count: rows.length,
        totalMatching: total,
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
      "email_status",
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

    const csvRows = (rows as unknown as Record<string, unknown>[]).map((r) =>
      header.map((h) => escape(r[h])).join(",")
    );
    // When the filter matches more rows than the cap, say so inside the file —
    // a silently truncated export reads as "these are all your leads".
    const truncated = total > rows.length
      ? [`# Exported the top ${rows.length} of ${total} matching leads by score. Narrow the filters to see the rest.`]
      : [];
    const csv = [header.join(","), ...csvRows, ...truncated].join("\n");

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");

    return new NextResponse(csv, {
      status: 200,
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="leads-export-${timestamp}.csv"`,
        "x-total-rows": String(total ?? rows.length),
        "x-exported-rows": String(rows.length),
        "x-truncated": total > rows.length ? "true" : "false",
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
    console.error("[leads:export] failed", e);
    return NextResponse.json(
      { error: "We could not export your leads. Try again in a moment." },
      { status: 500 }
    );
  }
}
