import { NextResponse } from "next/server";
import { requireSession } from "@wavesco/auth";
import { auth } from "@/lib/auth";
import { getModule } from "@/lib/module-registry";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ name: string }>;
}

export async function GET(_request: Request, ctx: RouteContext) {
  const session = await auth();
  requireSession(session);

  const { name } = await ctx.params;
  const mod = getModule(name);
  if (!mod) {
    return NextResponse.json({ error: `Module "${name}" is not installed` }, { status: 404 });
  }

  return NextResponse.json(mod.contract);
}
