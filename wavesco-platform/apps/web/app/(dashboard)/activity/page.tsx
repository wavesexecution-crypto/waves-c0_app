import type { Metadata } from "next";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { withTenantContext } from "@wavesco/db";
import { requireTenantId } from "@/lib/tenant";
import { Badge } from "@wavesco/ui";
import { CardShell, SectionHeader } from "@/components/dashboard/section";
import { EmptyState } from "@/components/dashboard/empty-state";
import { Activity, Clock3, Filter, ArrowUpRight } from "lucide-react";

export const metadata: Metadata = { title: "Activity" };

type FilterTab = "all" | "leads" | "orders" | "customers" | "system";

const TABS: { key: FilterTab; label: string }[] = [
  { key: "all", label: "All" },
  { key: "leads", label: "Leads" },
  { key: "orders", label: "Orders" },
  { key: "customers", label: "Customers" },
  { key: "system", label: "System" },
];

const MODEL_GROUP: Record<string, FilterTab> = {
  CafeLead: "leads",
  CafeOrder: "orders",
  CafeReconciliation: "orders",
  CafeSettlement: "orders",
  CafeCustomer: "customers",
  CafeCustomerVisit: "customers",
  CafeReengagementLog: "customers",
  Tenant: "system",
  User: "system",
  TenantModule: "system",
  Module: "system",
  CafeInventoryItem: "system",
  CafeOpsReport: "system",
};

function describeLog(log: { action: string; model: string; recordId: string | null; createdAt: Date }) {
  const model = log.model;
  const action = log.action;
  // Humanize
  const verb = action === "create" ? "created" : action === "update" ? "updated" : action === "delete" ? "deleted" : action;
  if (model === "CafeLead") return `Lead ${verb}`;
  if (model === "CafeOrder") return `Order ${verb}`;
  if (model === "CafeCustomer") return `Customer ${verb}`;
  if (model === "CafeInventoryItem") return `Inventory ${verb}`;
  if (model === "TenantModule") return `Module ${verb}`;
  if (model === "User") return `Team member ${verb}`;
  if (model === "CafeOpsReport") return `Report ${verb}`;
  return `${model} ${verb}`;
}

function dotColor(model: string) {
  if (model === "CafeLead") return "bg-violet-500";
  if (model === "CafeOrder") return "bg-emerald-500";
  if (model === "CafeCustomer") return "bg-sky-500";
  if (model === "TenantModule") return "bg-amber-500";
  return "bg-foreground/30";
}

export default async function ActivityPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const raw = Array.isArray(sp.filter) ? sp.filter[0] : sp.filter;
  const filter: FilterTab = (TABS.some((t) => t.key === raw) ? raw : "all") as FilterTab;

  const session = await auth();
  const tenantId = requireTenantId(session);

  const logs = await withTenantContext(tenantId, async (tx) =>
    tx.auditLog.findMany({
      where: { tenantId },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: { action: true, model: true, recordId: true, createdAt: true, userId: true },
    }),
  );

  const filtered = filter === "all" ? logs : logs.filter((l) => MODEL_GROUP[l.model] === filter);

  // Group by date
  const groups: Record<string, typeof filtered> = {};
  for (const log of filtered) {
    const key = log.createdAt.toISOString().slice(0, 10);
    groups[key] ??= []; groups[key].push(log);
  }

  return (
    <div className="space-y-7 animate-fade-in">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-[22px] font-semibold tracking-[-0.03em] leading-none">Activity</h1>
          <p className="mt-2 max-w-[58ch] text-[13px] leading-snug text-muted-foreground">
            Unified feed — website updates, leads, bookings, payments, automations, AI and system alerts. One place, precise time.
          </p>
        </div>
        <Badge variant="outline" className="self-start rounded-full text-[11px] sm:self-auto">
          {filtered.length} events
        </Badge>
      </div>

      {/* Filter — pills, calm */}
      <div className="inline-flex flex-wrap gap-1.5 rounded-full border border-border/60 bg-muted/20 p-1">
        {TABS.map((tab) => (
          <Link
            key={tab.key}
            href={`/activity?filter=${tab.key}`}
            className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${filter === tab.key ? "bg-card shadow-subtle border border-border/60 text-foreground" : "text-muted-foreground hover:text-foreground"}`}
          >
            {tab.label}
          </Link>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-12">
        <div className="lg:col-span-8">
          <CardShell>
            <SectionHeader
              title={filter === "all" ? "All activity" : `${TABS.find((t) => t.key === filter)?.label} activity`}
              description={filtered.length > 0 ? "Automatic audit — every mutation, tenant-scoped" : "No events in this filter"}
              action={
                <span className="hidden sm:inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <Filter className="h-3.5 w-3.5" />
                  {filter}
                </span>
              }
            />

            {filtered.length === 0 ? (
              <EmptyState
                icon={Clock3}
                title={logs.length === 0 ? "No activity yet" : "No matches"}
                description={logs.length === 0 ? "Mutations inside modules appear here automatically — no fake entries." : `No ${filter} activity. Try All.`}
                className="mt-6"
              />
            ) : (
              <div className="mt-6 space-y-6">
                {Object.entries(groups).map(([date, items]) => (
                  <div key={date}>
                    <div className="sticky top-0 z-[1] -mx-5 bg-card px-5 py-2 flex items-center gap-2 border-b border-border/40">
                      <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                        {new Date(date).toLocaleDateString("en-IN", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}
                      </span>
                      <span className="ml-auto text-[11px] font-mono text-muted-foreground">{items.length}</span>
                    </div>
                    <div className="relative mt-3 pl-6 border-l border-border/40 space-y-0">
                      {items.map((log) => (
                        <div key={`${log.model}-${log.recordId}-${log.createdAt.toISOString()}`} className="relative py-3 flex gap-3">
                          <span className={`absolute -left-[25px] top-[14px] h-2 w-2 rounded-full border-2 border-card shadow-sm ${dotColor(log.model)}`} />
                          <div className="min-w-0 flex-1">
                            <p className="text-[12.5px] font-medium tracking-tight">
                              {describeLog(log)}
                              <span className="mx-1.5 font-mono text-[11px] font-normal text-muted-foreground">{log.model}</span>
                              <span className="hidden sm:inline font-mono text-[11px] text-muted-foreground">· {log.recordId?.slice(0, 12) ?? "—"}…</span>
                            </p>
                            <p className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
                              <Clock3 className="h-3 w-3" />
                              {log.createdAt.toLocaleString("en-IN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "short" })}
                              <span className="hidden sm:inline">· {log.action} · tenant-scoped</span>
                            </p>
                          </div>
                          <span className="hidden sm:inline-flex shrink-0 rounded-full border border-border/60 bg-muted/30 px-2 py-1 text-[11px] font-mono">
                            {log.action}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardShell>
        </div>

        <div className="space-y-6 lg:col-span-4">
          <CardShell>
            <SectionHeader title="What counts as activity?" description="Every system writes here" />
            <div className="mt-4 space-y-2 text-[12.5px] leading-relaxed">
              <div className="flex gap-2">
                <span className="mt-1 h-1.5 w-1.5 rounded-full bg-violet-500 shrink-0" />
                <p><span className="font-medium">Leads</span> <span className="text-muted-foreground">— website form, WhatsApp, AI enrichment</span></p>
              </div>
              <div className="flex gap-2">
                <span className="mt-1 h-1.5 w-1.5 rounded-full bg-emerald-500 shrink-0" />
                <p><span className="font-medium">Bookings & orders</span> <span className="text-muted-foreground">— Swiggy / Zomato / booking system</span></p>
              </div>
              <div className="flex gap-2">
                <span className="mt-1 h-1.5 w-1.5 rounded-full bg-sky-500 shrink-0" />
                <p><span className="font-medium">Customers</span> <span className="text-muted-foreground">— CRM visits, re-engagement</span></p>
              </div>
              <div className="flex gap-2">
                <span className="mt-1 h-1.5 w-1.5 rounded-full bg-amber-500 shrink-0" />
                <p><span className="font-medium">System</span> <span className="text-muted-foreground">— module enable/disable, team changes</span></p>
              </div>
            </div>
          </CardShell>

          <CardShell className="bg-muted/20">
            <div className="flex items-center gap-2">
              <Activity className="h-4 w-4 text-muted-foreground" />
              <p className="text-[13px] font-medium tracking-tight">Stay in the loop</p>
            </div>
            <p className="mt-2 text-[12.5px] leading-snug text-muted-foreground">This feed is the single source of truth. No duplicate navigation, no decorative labels — just what happened and when.</p>
            <Link href="/overview" className="mt-4 inline-flex items-center gap-1 text-xs font-medium text-foreground">
              Back to overview <ArrowUpRight className="h-3 w-3" />
            </Link>
          </CardShell>
        </div>
      </div>
    </div>
  );
}

