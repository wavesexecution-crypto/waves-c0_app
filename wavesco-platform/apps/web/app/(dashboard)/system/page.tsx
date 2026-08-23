import type { Metadata } from "next";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { withTenantContext } from "@wavesco/db";
import { buildRegistry } from "@/lib/module-registry";
import { requireTenantId } from "@/lib/tenant";
import { Badge, Button } from "@wavesco/ui";
import { Boxes, ArrowUpRight, CheckCircle2, CircleDashed, Activity, Settings2 } from "lucide-react";
import { CardShell, SectionHeader } from "@/components/dashboard/section";

export const metadata: Metadata = { title: "My System" };

const moduleIcons: Record<string, string> = {
  "cafe-leads": "◐",
  "cafe-orders": "⬢",
  "cafe-inventory": "⬣",
  "cafe-crm": "⬥",
  "cafe-ops": "⬔",
};

function describeUsage(name: string, counts: { leads: number; orders: number; revenuePaise: number; customers: number; visits: number; inventory: number; lowStock: number; reports: number }) {
  switch (name) {
    case "cafe-leads":
      return counts.leads > 0 ? `${counts.leads} leads captured` : "No leads yet";
    case "cafe-orders":
      return counts.orders > 0 ? `${counts.orders} orders · ${(counts.revenuePaise / 100).toLocaleString("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 })} processed` : "Awaiting orders";
    case "cafe-crm":
      return counts.customers > 0 ? `${counts.customers} contacts · ${counts.visits} visits` : "No contacts yet";
    case "cafe-inventory":
      return counts.inventory > 0 ? `${counts.inventory} items · ${counts.lowStock} low stock` : "Inventory empty";
    case "cafe-ops":
      return counts.reports > 0 ? `${counts.reports} reports generated` : "Reports ready when data arrives";
    default:
      return "Ready";
  }
}

export default async function SystemPage() {
  const session = await auth();
  const tenantId = requireTenantId(session);
  const registry = buildRegistry();

  const data = await withTenantContext(tenantId, async (tx) => {
    const [tenant, enabledRows, leadCount, orderAgg, customerCount, visitCount, inventoryCount, lowStock, reportCount, auditLogs] =
      await Promise.all([
        tx.tenant.findUnique({ where: { id: tenantId }, select: { name: true, plan: true, status: true, slug: true } }),
        tx.tenantModule.findMany({ where: { tenantId, status: "enabled" }, select: { module: { select: { name: true } }, enabledAt: true, updatedAt: true } }),
        tx.cafeLead.count({ where: { tenantId } }),
        tx.cafeOrder.aggregate({ where: { tenantId }, _count: true, _sum: { totalPaise: true } }),
        tx.cafeCustomer.count({ where: { tenantId } }),
        tx.cafeCustomerVisit.count({ where: { tenantId } }),
        tx.cafeInventoryItem.count({ where: { tenantId, isActive: true } }),
        tx.cafeInventoryItem.count({ where: { tenantId, isActive: true, currentStock: { lte: 5 } } }),
        tx.cafeOpsReport.count({ where: { tenantId } }),
        tx.auditLog.findMany({ where: { tenantId }, orderBy: { createdAt: "desc" }, take: 10, select: { model: true, createdAt: true } }),
      ]);
    return {
      tenant,
      enabledRows,
      counts: {
        leads: leadCount,
        orders: orderAgg._count,
        revenuePaise: orderAgg._sum.totalPaise ?? 0,
        customers: customerCount,
        visits: visitCount,
        inventory: inventoryCount,
        lowStock,
        reports: reportCount,
      },
      auditLogs,
    };
  });

  const enabledSet = new Set(data.enabledRows.map((r) => r.module.name));
  const modules = Object.values(registry);
  const enabled = modules.filter((m) => enabledSet.has(m.contract.name));
  const disabled = modules.filter((m) => !enabledSet.has(m.contract.name));

  const lastActivityByModule = new Map<string, Date>();
  for (const log of data.auditLogs) {
    const key = log.model;
    if (!lastActivityByModule.has(key)) lastActivityByModule.set(key, log.createdAt);
  }

  return (
    <div className="space-y-7 animate-fade-in">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-[22px] font-semibold tracking-[-0.03em] leading-none">My System</h1>
          <p className="mt-2 max-w-[56ch] text-[13px] leading-snug text-muted-foreground">
            Everything WavesCo has deployed for <span className="font-medium text-foreground">{data.tenant?.name}</span>.
            Live status, usage, health and controls — one calm view.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="hidden items-center gap-2 rounded-full border border-border/60 bg-card px-3 py-1.5 text-xs font-medium shadow-subtle sm:inline-flex">
            <span className="h-2 w-2 rounded-full bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.4)]" />
            {enabled.length} live · {disabled.length} available
          </span>
          <Button asChild size="sm" className="h-8 rounded-full">
            <Link href="/modules">Manage modules</Link>
          </Button>
        </div>
      </div>

      {/* Health strip — precise */}
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-[12px] border border-border/60 bg-card px-4 py-3 shadow-subtle flex items-center justify-between">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Platform</p>
            <p className="text-[13px] font-semibold tracking-tight">{data.tenant?.status === "active" ? "Operational" : data.tenant?.status}</p>
          </div>
          <CheckCircle2 className="h-4 w-4 text-emerald-500" />
        </div>
        <div className="rounded-[12px] border border-border/60 bg-card px-4 py-3 shadow-subtle flex items-center justify-between">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Data residency</p>
            <p className="text-[13px] font-semibold tracking-tight font-mono text-xs">{data.tenant?.slug}.wavesco</p>
          </div>
          <Activity className="h-4 w-4 text-muted-foreground" />
        </div>
        <div className="rounded-[12px] border border-border/60 bg-card px-4 py-3 shadow-subtle flex items-center justify-between">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Plan</p>
            <p className="text-[13px] font-semibold tracking-tight capitalize">{data.tenant?.plan}</p>
          </div>
          <Badge variant="secondary" className="rounded-full text-[10px]">Managed</Badge>
        </div>
      </div>

      {/* Active */}
      <div>
        <SectionHeader
          title="Active"
          description={`${enabled.length} systems running for your business`}
          action={<Badge variant="success" className="rounded-full">{enabled.length} Live</Badge>}
        />
        {enabled.length === 0 ? (
          <CardShell className="mt-4">
            <div className="flex flex-col items-center justify-center py-10 text-center">
              <div className="flex h-10 w-10 items-center justify-center rounded-full border border-border/60 bg-muted/30">
                <Boxes className="h-5 w-5 text-muted-foreground" />
              </div>
              <p className="mt-3 text-[13px] font-medium">No systems active yet</p>
              <p className="mt-1 max-w-[40ch] text-[12.5px] leading-snug text-muted-foreground">Enable your first module — your operating system builds around your business.</p>
              <Button asChild size="sm" className="mt-4 rounded-full">
                <Link href="/modules">Browse modules</Link>
              </Button>
            </div>
          </CardShell>
        ) : (
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {enabled.map((m) => {
              const usage = describeUsage(m.contract.name, data.counts);
              const lastActivity = lastActivityByModule.get( (m.contract.tables[0] ?? "") ) ?? lastActivityByModule.get(m.contract.name);
              return (
                <div key={m.contract.name} className="group relative flex flex-col rounded-[14px] border border-emerald-200/50 bg-emerald-50/20 p-4 shadow-subtle transition-all hover:shadow-card hover:border-emerald-200 dark:border-emerald-900/30 dark:bg-emerald-950/10">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-card border border-border/60 shadow-subtle text-[14px]">
                        {moduleIcons[m.contract.name] ?? "•"}
                      </div>
                      <div>
                        <p className="text-[13px] font-semibold tracking-tight leading-none">{m.contract.displayName}</p>
                        <p className="mt-1 text-[11px] font-mono text-muted-foreground">v{m.contract.version} · {m.contract.name}</p>
                      </div>
                    </div>
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-white shadow-sm">
                      <span className="h-1.5 w-1.5 rounded-full bg-white animate-pulse" />
                      Live
                    </span>
                  </div>
                  <p className="mt-3 line-clamp-2 text-[12.5px] leading-snug text-muted-foreground">{m.contract.description}</p>
                  <div className="mt-4 space-y-2 rounded-[10px] border border-border/60 bg-card px-3 py-2.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Usage</span>
                      <span className="text-[11px] text-muted-foreground">{lastActivity ? `${Math.floor((Date.now() - lastActivity.getTime()) / 3600000)}h ago` : "Active"}</span>
                    </div>
                    <p className="text-[12.5px] font-medium tracking-tight">{usage}</p>
                    <div className="flex items-center gap-1.5 pt-1">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                      <span className="text-[11px] font-medium text-emerald-700 dark:text-emerald-300">Healthy</span>
                      <span className="text-[11px] text-muted-foreground">· Last activity {lastActivity ? lastActivity.toLocaleDateString() : "recently"}</span>
                    </div>
                  </div>
                  <div className="mt-3 flex gap-2">
                    <Button asChild size="sm" variant="outline" className="h-7 flex-1 rounded-full text-xs border-border/70">
                      <Link href="/modules">Manage</Link>
                    </Button>
                    <Button asChild size="sm" variant="ghost" className="h-7 rounded-full text-xs">
                      <Link href="/activity" className="inline-flex items-center gap-1">
                        Activity <ArrowUpRight className="h-3 w-3" />
                      </Link>
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Available */}
      {disabled.length > 0 ? (
        <div>
          <SectionHeader title="Available" description={`${disabled.length} more systems you can enable`} />
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {disabled.map((m) => (
              <div key={m.contract.name} className="flex flex-col rounded-[14px] border border-border/60 bg-card p-4 opacity-90 transition-all hover:opacity-100 hover:shadow-subtle">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-muted/40 border border-border/60 text-[14px] text-muted-foreground">
                      {moduleIcons[m.contract.name] ?? "•"}
                    </div>
                    <div>
                      <p className="text-[13px] font-semibold tracking-tight leading-none">{m.contract.displayName}</p>
                      <p className="mt-1 text-[11px] font-mono text-muted-foreground">v{m.contract.version}</p>
                    </div>
                  </div>
                  <span className="rounded-full border border-border/60 bg-muted px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    Off
                  </span>
                </div>
                <p className="mt-3 line-clamp-2 text-[12.5px] leading-snug text-muted-foreground">{m.contract.description}</p>
                <div className="mt-3 flex items-center gap-2 text-[11px] text-muted-foreground">
                  <CircleDashed className="h-3.5 w-3.5" />
                  {m.contract.requiresEnv.length > 0 ? `Requires ${m.contract.requiresEnv.join(", ")}` : "No credentials required"}
                </div>
                <Button asChild size="sm" className="mt-4 h-7 rounded-full w-full">
                  <Link href="/modules">Enable</Link>
                </Button>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <CardShell className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-foreground text-background">
            <Settings2 className="h-4 w-4" />
          </div>
          <div>
            <p className="text-[13px] font-medium tracking-tight">Need something custom?</p>
            <p className="text-[12px] text-muted-foreground">WavesCo builds bespoke modules — your system grows with your business.</p>
          </div>
        </div>
        <Button asChild variant="outline" size="sm" className="rounded-full">
          <Link href="/support">Talk to WavesCo</Link>
        </Button>
      </CardShell>
    </div>
  );
}

