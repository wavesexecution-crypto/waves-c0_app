import type { Metadata } from "next";
import { auth } from "@/lib/auth";
import { withTenantContext } from "@wavesco/db";
import { buildRegistry } from "@/lib/module-registry";
import { ModuleCard } from "@/components/module-card";
import { requireTenantId } from "@/lib/tenant";
import { Badge } from "@wavesco/ui";
import { CardShell, SectionHeader } from "@/components/dashboard/section";

export const metadata: Metadata = { title: "Modules" };

export default async function ModulesPage() {
  const session = await auth();
  const tenantId = requireTenantId(session);
  const registry = buildRegistry();

  const data = await withTenantContext(tenantId, async (tx) => {
    const [enabledRows, counts] = await Promise.all([
      tx.tenantModule.findMany({
        where: { tenantId, status: "enabled" },
        select: { module: { select: { name: true } } },
      }),
      Promise.all([
        tx.cafeLead.count({ where: { tenantId } }),
        tx.cafeOrder.count({ where: { tenantId } }),
        tx.cafeCustomer.count({ where: { tenantId } }),
        tx.cafeInventoryItem.count({ where: { tenantId } }),
        tx.cafeOpsReport.count({ where: { tenantId } }),
      ]).then(([leads, orders, customers, inventory, reports]) => ({
        "cafe-leads": leads,
        "cafe-orders": orders,
        "cafe-crm": customers,
        "cafe-inventory": inventory,
        "cafe-ops": reports,
      })),
    ]);
    return {
      enabledSet: new Set(enabledRows.map((r) => r.module.name)),
      counts: counts,
    };
  });

  const modules = Object.values(registry);
  const enabled = modules.filter((m) => data.enabledSet.has(m.contract.name));
  const disabled = modules.filter((m) => !data.enabledSet.has(m.contract.name));

  function usageFor(name: string) {
    const count = (data.counts as Record<string, number>)[name] ?? 0;
    switch (name) {
      case "cafe-leads":
        return count > 0 ? `${count.toLocaleString("en-IN")} leads captured` : "No leads yet — forms will appear here";
      case "cafe-orders":
        return count > 0 ? `${count.toLocaleString("en-IN")} orders synced` : "Awaiting Swiggy / Zomato orders";
      case "cafe-crm":
        return count > 0 ? `${count.toLocaleString("en-IN")} contacts` : "No contacts yet";
      case "cafe-inventory":
        return count > 0 ? `${count.toLocaleString("en-IN")} items tracked` : "Add inventory items to start";
      case "cafe-ops":
        return count > 0 ? `${count.toLocaleString("en-IN")} reports generated` : "Daily briefings when data arrives";
      default:
        return undefined;
    }
  }

  return (
    <div className="space-y-7 animate-fade-in">
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-[22px] font-semibold tracking-[-0.03em] leading-none">Modules</h1>
          <Badge variant="secondary" className="rounded-full text-[11px] font-medium">
            {modules.length} installed
          </Badge>
        </div>
        <p className="mt-2 max-w-[60ch] text-[13px] leading-snug text-muted-foreground">
          Every client&apos;s modules are different — this is data-driven. Enabling validates required credentials first — missing keys fail loudly, as designed.
        </p>
      </div>

      {modules.length === 0 ? (
        <CardShell>
          <div className="py-10 text-center">
            <p className="text-[13px] font-medium">No modules installed</p>
            <p className="mt-1 text-[12.5px] text-muted-foreground">
              Drop a module bundle into <span className="font-mono">modules/</span> to see it here.
            </p>
          </div>
        </CardShell>
      ) : (
        <div className="space-y-8">
          {enabled.length > 0 ? (
            <div>
              <SectionHeader
                title="Enabled"
                description={`${enabled.length} active — these power your business right now`}
                action={<Badge variant="success" className="rounded-full">{enabled.length} live</Badge>}
              />
              <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {enabled.map((mod) => (
                  <ModuleCard
                    key={mod.contract.name}
                    name={mod.contract.name}
                    displayName={mod.contract.displayName}
                    description={mod.contract.description}
                    version={mod.contract.version}
                    requiresEnv={mod.contract.requiresEnv}
                    enabled={true}
                    usage={usageFor(mod.contract.name)}
                    tables={mod.contract.tables}
                  />
                ))}
              </div>
            </div>
          ) : null}

          <div>
            <SectionHeader
              title={enabled.length > 0 ? "Available" : "All modules"}
              description={
                disabled.length > 0
                  ? `${disabled.length} ready to enable — expands your operating system`
                  : "All installed modules are enabled"
              }
            />
            {disabled.length === 0 && enabled.length > 0 ? (
              <CardShell className="mt-4">
                <p className="py-6 text-center text-[13px] text-muted-foreground">Every module is already active. Your system is at full power.</p>
              </CardShell>
            ) : (
              <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {disabled.map((mod) => (
                  <ModuleCard
                    key={mod.contract.name}
                    name={mod.contract.name}
                    displayName={mod.contract.displayName}
                    description={mod.contract.description}
                    version={mod.contract.version}
                    requiresEnv={mod.contract.requiresEnv}
                    enabled={false}
                    usage={usageFor(mod.contract.name)}
                    tables={mod.contract.tables}
                  />
                ))}
              </div>
            )}
          </div>

          <CardShell className="flex flex-col gap-1">
            <p className="text-[12px] font-medium">How modules work</p>
            <p className="text-[12.5px] leading-relaxed text-muted-foreground">
              Modules are isolated feature bundles — each declares its own tables, webhooks and permissions in{" "}
              <span className="font-mono text-xs">module.contract.json</span>. The registry is statically built, and{" "}
              <span className="font-mono text-xs">withTenantContext</span> enforces row-level security. No hardcoding — add a folder under{" "}
              <span className="font-mono text-xs">modules/</span> and it appears here.
            </p>
          </CardShell>
        </div>
      )}
    </div>
  );
}


