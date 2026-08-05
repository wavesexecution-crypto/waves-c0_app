import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "./load-env";

loadEnv();

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

interface ModuleContract {
  name: string;
  displayName: string;
  version: string;
  description: string;
  requiresEnv?: string[];
}

function loadContract(name: string): ModuleContract {
  const file = join(ROOT, "modules", name, "module.contract.json");
  if (!existsSync(file)) {
    throw new Error(`No module.contract.json at modules/${name}/`);
  }
  return JSON.parse(readFileSync(file, "utf8")) as ModuleContract;
}

async function main(): Promise<void> {
  const { withTenantContext, prisma, lookupUserByEmail } = await import("@wavesco/db");

  const [moduleNameArg, emailArg] = process.argv.slice(2);

  if (!moduleNameArg || !emailArg) {
    console.error("Usage: pnpm tsx scripts/enable-module.ts <moduleName> <ownerEmail>");
    process.exit(1);
  }

  const contract = loadContract(moduleNameArg);

  const missing = (contract.requiresEnv ?? []).filter((key) => !process.env[key]);
  if (missing.length > 0) {
    console.error(`Module "${moduleNameArg}" requires env vars that are missing: ${missing.join(", ")}`);
    process.exit(1);
  }

  const user = await lookupUserByEmail(emailArg.trim().toLowerCase());
  if (!user) {
    console.error(`No user found for ${emailArg}.`);
    process.exit(1);
  }

  await withTenantContext(user.tenantId, async (tx) => {
    let catalog = await tx.module.findUnique({ where: { name: contract.name } });
    if (!catalog) {
      await prisma.$executeRaw`
        SELECT public.module_register(
          ${`mod_${Math.random().toString(36).slice(2)}`}::text,
          ${contract.name}::text,
          ${contract.displayName}::text,
          ${contract.description ?? ""}::text,
          ${contract.version}::text,
          ${`modules/${contract.name}/module.contract.json`}::text
        )
      `;
      catalog = await tx.module.findUnique({ where: { name: contract.name } });
    }
    if (!catalog) {
      throw new Error(`Failed to register module "${contract.name}".`);
    }

    await tx.tenantModule.upsert({
      where: { tenantId_moduleId: { tenantId: user.tenantId, moduleId: catalog.id } },
      create: { tenantId: user.tenantId, moduleId: catalog.id, status: "enabled", enabledAt: new Date() },
      update: { status: "enabled", enabledAt: new Date(), disabledAt: null },
    });
  });

  console.log(`Enabled "${contract.name}" for tenant ${user.tenantId}.`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});