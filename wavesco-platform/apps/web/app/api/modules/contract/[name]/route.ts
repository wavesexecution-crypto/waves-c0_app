import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireApiUser } from "@/lib/api";
import { getModule } from "@/lib/module-registry";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ name: string }>;
}

export async function GET(_request: Request, ctx: RouteContext) {
  const session = await auth();
  const { response } = requireApiUser(session);
  if (response) return response;

  const { name } = await ctx.params;
  const mod = getModule(name);
  if (!mod) {
    return NextResponse.json({ error: `Module "${name}" is not installed` }, { status: 404 });
  }

  return NextResponse.json(mod.contract);
}
