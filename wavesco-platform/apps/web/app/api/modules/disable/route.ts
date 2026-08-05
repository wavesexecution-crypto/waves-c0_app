import { NextResponse } from "next/server";
import { requireSession } from "@wavesco/auth";
import { withTenantContext } from "@wavesco/db";
import { moduleDisableSchema } from "@wavesco/validators";
import { auth } from "@/lib/auth";

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

  const parsed = moduleDisableSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  await withTenantContext(
    user.tenantId,
    async (tx) => {
      await tx.tenantModule.updateMany({
        where: { tenantId: user.tenantId, module: { name: parsed.data.moduleName } },
        data: { status: "disabled", disabledAt: new Date() },
      });
    },
    user.id,
  );

  return NextResponse.json({ ok: true });
}
