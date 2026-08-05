import type { Metadata } from "next";
import { auth } from "@/lib/auth";
import { withTenantContext } from "@wavesco/db";
import { buildRegistry } from "@/lib/module-registry";
import { ModuleCard } from "@/components/module-card";
import { requireTenantId } from "@/lib/tenant";

export const metadata: Metadata = {
  title: "Modules",
};

export default async function ModulesPage() {
  const session = await auth();
  const tenantId = requireTenantId(session);

  const registry = buildRegistry();
  const enabledSet = await withTenantContext(tenantId, async (tx) => {
    const rows = await tx.tenantModule.findMany({
      where: { tenantId, status: "enabled" },
      select: { module: { select: { name: true } } },
    });
    return new Set(rows.map((r) => r.module.name));
  });

  const modules = Object.values(registry);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Modules</h1>
        <p className="text-sm text-muted-foreground">
          Enable CafeOS feature modules. Enabling validates required credentials first — missing keys fail loudly.
        </p>
      </div>

      {modules.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center">
          <p className="text-sm font-medium">No modules installed</p>
          <p className="text-sm text-muted-foreground">
            Drop a module bundle into <span className="font-mono">modules/</span> to see it here.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {modules.map((mod) => (
            <ModuleCard
              key={mod.contract.name}
              name={mod.contract.name}
              displayName={mod.contract.displayName}
              description={mod.contract.description}
              version={mod.contract.version}
              requiresEnv={mod.contract.requiresEnv}
              enabled={enabledSet.has(mod.contract.name)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
