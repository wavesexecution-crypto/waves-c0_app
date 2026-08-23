import { NextResponse } from "next/server";
import { getModule } from "@/lib/module-registry";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ module: string; webhook: string }>;
}

/**
 * Mount point for module-owned webhooks. The module package owns the
 * handler; this route only resolves it from the registry and hands off
 * the raw Request. No generic webhook logic lives here.
 */
export async function POST(request: Request, ctx: RouteContext) {
  const { module: moduleName, webhook: webhookName } = await ctx.params;

  const mod = getModule(moduleName);
  if (!mod) {
    return new NextResponse(`Module "${moduleName}" is not installed`, { status: 404 });
  }

  const handler = mod.webhooks[webhookName];
  if (!handler) {
    return new NextResponse(`Webhook "${webhookName}" is not defined by ${moduleName}`, {
      status: 404,
    });
  }

  const tenantId =
    new URL(request.url).searchParams.get("tenantId") ?? request.headers.get("x-tenant-id");
  if (!tenantId) {
    return new NextResponse("Missing tenantId query param or x-tenant-id header", { status: 400 });
  }

  return handler({ request, tenantId });
}
