import { NextResponse } from "next/server";
import { getModule } from "@/lib/module-registry";
import { auth } from "@/lib/auth";
import { requireSession } from "@wavesco/auth";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ module: string; webhook: string }>;
}

/**
 * Mount point for module-owned webhooks. The module package owns the
 * handler; this route only resolves it from the registry and hands off
 * the raw Request. No generic webhook logic lives here.
 *
 * SECURITY: the tenant is taken from the authenticated session ONLY. This
 * route previously had no authentication at all and read `tenantId` from
 * `?tenantId=` / `X-Tenant-Id`, so any anonymous caller could write into any
 * workspace. It happened to be dormant only because every module currently
 * registers no webhooks; that is not a security control.
 *
 * External providers that must call a webhook need a per-module HMAC
 * signature (the contract already declares `signature` per webhook) rather
 * than a caller-supplied tenant id.
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

  // Authenticate before resolving the tenant.
  let tenantId: string;
  try {
    const user = requireSession(await auth()) as { tenantId?: string; id?: string };
    if (!user?.tenantId) {
      return new NextResponse("Unauthorized", { status: 401 });
    }
    tenantId = user.tenantId;
  } catch {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  return handler({ request, tenantId });
}
