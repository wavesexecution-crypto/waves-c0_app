import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { prisma, withTenantContext } from "@wavesco/db";
import { auth } from "@/lib/auth";
import { requireApiUser } from "@/lib/api";
import { buildRegistry } from "@/lib/module-registry";

export const runtime = "nodejs";

export async function GET() {
  const session = await auth();
  const { user, response } = requireApiUser(session);
  if (response) return response;

  const registry = buildRegistry();
  const enabled = await withTenantContext(user.tenantId, async (tx) =>
    tx.tenantModule.findMany({
      where: { tenantId: user.tenantId },
      select: { module: { select: { name: true } }, status: true },
    }),
  );

  const enabledNames = new Map(enabled.map((e) => [e.module.name, e.status]));

  const modules = Object.values(registry).map((mod) => ({
    contract: mod.contract,
    enabled: enabledNames.has(mod.contract.name),
    status: enabledNames.get(mod.contract.name) ?? "disabled",
  }));

  return NextResponse.json({ modules });
}

export async function POST(request: Request) {
  const session = await auth();
  const guard = requireApiUser(session);
  if (guard.response) return guard.response;

  let body: { name?: string };
  try {
    body = (await request.json()) as { name?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.name) {
    return NextResponse.json({ error: "Module name is required" }, { status: 400 });
  }

  const registry = buildRegistry();
  const mod = registry[body.name];
  if (!mod) {
    return NextResponse.json({ error: `Module "${body.name}" is not installed` }, { status: 404 });
  }

  await prisma.$executeRaw`
    SELECT public.module_register(
      ${`mod_${randomUUID().replace(/-/g, "")}`}::text,
      ${mod.contract.name}::text,
      ${mod.contract.displayName}::text,
      ${mod.contract.description}::text,
      ${mod.contract.version}::text,
      ${mod.contract.entry}::text
    )
  `;

  return NextResponse.json({ ok: true, registered: mod.contract.name });
}
