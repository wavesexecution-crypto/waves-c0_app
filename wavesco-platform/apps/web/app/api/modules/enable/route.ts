import { NextResponse } from "next/server";
import { requireSession } from "@wavesco/auth";
import { withTenantContext } from "@wavesco/db";
import { moduleEnableSchema } from "@wavesco/validators";
import { auth } from "@/lib/auth";
import { getModule } from "@/lib/module-registry";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const session = await auth();
  const user = requireSession(session);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = moduleEnableSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const moduleName = parsed.data.moduleName;
  const mod = getModule(moduleName);
  if (!mod) {
    return NextResponse.json({ error: `Module "${moduleName}" is not installed` }, { status: 404 });
  }

  const missing = mod.contract.requiresEnv.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    return NextResponse.json(
      { error: `Missing required env vars: ${missing.join(", ")}` },
      { status: 500 },
    );
  }

  await withTenantContext(
    user.tenantId,
    async (tx) => {
      const catalog = await tx.module.findUnique({ where: { name: moduleName } });
      if (!catalog) {
        throw new Error(`Module "${moduleName}" is not registered in the catalog.`);
      }
      await tx.tenantModule.upsert({
        where: { tenantId_moduleId: { tenantId: user.tenantId, moduleId: catalog.id } },
        create: {
          tenantId: user.tenantId,
          moduleId: catalog.id,
          status: "enabled",
          enabledAt: new Date(),
        },
        update: { status: "enabled", enabledAt: new Date(), disabledAt: null },
      });
    },
    user.id,
  );

  return NextResponse.json({ ok: true });
}
