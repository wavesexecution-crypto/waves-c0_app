"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@wavesco/auth";
import { withTenantContext } from "@wavesco/db";
import { moduleDisableSchema, moduleEnableSchema } from "@wavesco/validators";
import { auth } from "@/lib/auth";
import { getModule } from "@/lib/module-registry";

export interface ModuleActionResult {
  ok: boolean;
  error?: string;
}

async function currentUser(): Promise<{ tenantId: string; id: string }> {
  const session = await auth();
  const user = requireSession(session);
  return { tenantId: user.tenantId, id: user.id };
}

function missingEnv(requiresEnv: string[]): string[] {
  return requiresEnv.filter((name) => !process.env[name]);
}

export async function enableModuleAction(
  _prev: ModuleActionResult,
  formData: FormData,
): Promise<ModuleActionResult> {
  const parsed = moduleEnableSchema.safeParse({ moduleName: formData.get("moduleName") });
  if (!parsed.success) {
    return { ok: false, error: "Invalid module name." };
  }

  const moduleName = parsed.data.moduleName;
  const mod = getModule(moduleName);
  if (!mod) {
    return { ok: false, error: `Module "${moduleName}" is not installed.` };
  }

  const missing = missingEnv(mod.contract.requiresEnv);
  if (missing.length > 0) {
    return {
      ok: false,
      error: `Missing required env vars: ${missing.join(", ")}`,
    };
  }

  const user = await currentUser();
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

  revalidatePath("/modules");
  return { ok: true };
}

export async function disableModuleAction(
  _prev: ModuleActionResult,
  formData: FormData,
): Promise<ModuleActionResult> {
  const parsed = moduleDisableSchema.safeParse({ moduleName: formData.get("moduleName") });
  if (!parsed.success) {
    return { ok: false, error: "Invalid module name." };
  }

  const moduleName = parsed.data.moduleName;
  const user = await currentUser();
  await withTenantContext(
    user.tenantId,
    async (tx) => {
      await tx.tenantModule.updateMany({
        where: { tenantId: user.tenantId, module: { name: moduleName } },
        data: { status: "disabled", disabledAt: new Date() },
      });
    },
    user.id,
  );

  revalidatePath("/modules");
  return { ok: true };
}
