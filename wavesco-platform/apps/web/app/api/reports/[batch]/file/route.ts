import { NextResponse } from "next/server";
import { existsSync, readFileSync } from "node:fs";
import { extname } from "node:path";
import { requireSession } from "@wavesco/auth";
import { auth } from "@/lib/auth";
import { getBatchManifest } from "@/lib/wavesco/lead-engine";

export const runtime = "nodejs";

const MIME: Record<string, string> = {
  ".pdf": "application/pdf",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".csv": "text/csv",
};

interface RouteContext {
  params: Promise<{ batch: string }>;
}

export async function GET(request: Request, ctx: RouteContext) {
  const session = await auth();
  try {
    requireSession(session);
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { batch } = await ctx.params;
  const url = new URL(request.url);
  const type = url.searchParams.get("type") === "xlsx" ? "xlsx" : "pdf";

  const manifest = getBatchManifest(batch);
  if (!manifest) {
    return NextResponse.json({ error: `No batch manifest for ${batch}` }, { status: 404 });
  }
  const path = type === "pdf" ? manifest.pdfPath : manifest.excelPath;
  if (!path || !existsSync(path)) {
    return NextResponse.json({ error: `${type.toUpperCase()} file not present on disk` }, { status: 404 });
  }

  const data = readFileSync(path);
  const filename = path.split(/[\\/]/).pop() ?? `${batch}.${type}`;
  return new NextResponse(new Uint8Array(data), {
    headers: {
      "content-type": MIME[extname(path).toLowerCase()] ?? "application/octet-stream",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
    },
  });
}
