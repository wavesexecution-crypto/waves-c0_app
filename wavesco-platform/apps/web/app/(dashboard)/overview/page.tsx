import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { withTenantContext } from "@wavesco/db";
import { buildRegistry } from "@/lib/module-registry";
import { Badge, Button } from "@wavesco/ui";
import {
  AlertTriangle,
  ArrowUpRight,
  Boxes,
  IndianRupee,
  ShoppingBag,
  Users,
  UserPlus,
  TrendingUp,
  Activity,
  Sparkles,
  Package,
  Clock3,
} from "lucide-react";
import { StatCard } from "@/components/dashboard/stat-card";
import { SectionHeader, CardShell } from "@/components/dashboard/section";
import { EmptyState } from "@/components/dashboard/empty-state";

export const metadata: Metadata = { title: "Overview" };

function formatINR(paise: number) {
  const rupees = paise / 100;
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(rupees);
}

function formatNumber(n: number) {
  return new Intl.NumberFormat("en-IN").format(n);
}

function relativeTime(d: Date) {
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export default async function OverviewPage() {
  const session = await auth();
  const user = session?.user as Record<string, unknown> | undefined;
  const tenantId = typeof user?.tenantId === "string" ? user.tenantId : null;
  if (!tenantId) redirect("/login");

  const registry = buildRegistry();

  const data = await withTenantContext(tenantId, async (tx) => {
    const now = new Date();
    const sevenDaysAgo = new Date(now);
    sevenDaysAgo.setDate(now.getDate() - 7);

    const [tenant, memberCount, enabledRows, auditLogs, leadCount, recentLeads, orderAgg, recentOrders, customerCount, lowStockCount, opsReports] =
      await Promise.all([
        tx.tenant.findUnique({
          where: { id: tenantId },
          select: { name: true, plan: true, status: true, slug: true },
        }),
        tx.user.count({ where: { tenantId } }),
        tx.tenantModule.findMany({
          where: { tenantId, status: "enabled" },
          select: { module: { select: { name: true, displayName: true } }, enabledAt: true },
        }),
        tx.auditLog.findMany({
          where: { tenantId },
          orderBy: { createdAt: "desc" },
          take: 8,
          select: { action: true, model: true, recordId: true, createdAt: true },
        }),
        tx.cafeLead.count({ where: { tenantId } }),
        tx.cafeLead.findMany({
          where: { tenantId },
          orderBy: { createdAt: "desc" },
          take: 4,
          select: { id: true, name: true, phone: true, source: true, createdAt: true, category: true },
        }),
        tx.cafeOrder.aggregate({
          where: { tenantId },
          _count: true,
          _sum: { totalPaise: true },
        }),
        tx.cafeOrder.findMany({
          where: { tenantId },
          orderBy: { placedAt: "desc" },
          take: 4,
          select: { id: true, externalOrderId: true, source: true, totalPaise: true, status: true, placedAt: true, customerName: true },
        }),
        tx.cafeCustomer.count({ where: { tenantId } }),
        tx.cafeInventoryItem.count({
          where: { tenantId, isActive: true, currentStock: { lte: 5 } },
        }),
        tx.cafeOpsReport.findMany({
          where: { tenantId },
          orderBy: { createdAt: "desc" },
          take: 2,
          select: { id: true, title: true, type: true, createdAt: true },
        }),
      ]);

    // Revenue last 7 days for mini chart
    const ordersLast7 = await tx.cafeOrder.findMany({
      where: { tenantId, placedAt: { gte: sevenDaysAgo } },
      select: { totalPaise: true, placedAt: true },
    });

    const dailyRevenue = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(sevenDaysAgo);
      d.setDate(sevenDaysAgo.getDate() + i);
      const key = d.toISOString().slice(0, 10);
      const sum = ordersLast7
        .filter((o) => o.placedAt.toISOString().slice(0, 10) === key)
        .reduce((acc, o) => acc + o.totalPaise, 0);
      return { key, sum };
    });

    const maxDaily = Math.max(1, ...dailyRevenue.map((d) => d.sum));

    return {
      tenant,
      memberCount,
      enabledRows,
      auditLogs,
      leadCount,
      recentLeads,
      orderCount: orderAgg._count,
      revenuePaise: orderAgg._sum.totalPaise ?? 0,
      recentOrders,
      customerCount,
      lowStockCount,
      opsReports,
      dailyRevenue,
      maxDaily,
    };
  });

  if (!data.tenant) redirect("/login");

  const enabledModuleNames = new Set(data.enabledRows.map((r) => r.module.name));
  const enabledModules = Object.values(registry).filter((m) => enabledModuleNames.has(m.contract.name));
  const disabledModules = Object.values(registry).filter((m) => !enabledModuleNames.has(m.contract.name));
  const totalModules = Object.keys(registry).length;

  const conversion = data.leadCount > 0 ? Math.round((data.customerCount / data.leadCount) * 100) : null;

  const hasAnyData = data.orderCount > 0 || data.leadCount > 0 || data.customerCount > 0;

  return (
    <div className="space-y-7 animate-fade-in">
      {/* Header — calm, executive */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="text-[22px] font-semibold tracking-[-0.03em] leading-none">Overview</h1>
            <Badge variant="secondary" className="hidden sm:inline-flex h-5 rounded-full px-2 text-[11px] font-medium">
              {data.tenant.plan}
            </Badge>
          </div>
          <p className="mt-2 text-[13px] leading-snug text-muted-foreground">
            Welcome back to <span className="font-medium text-foreground">{data.tenant.name}</span> ·{" "}
            <span className="font-mono text-xs">{data.tenant.slug}</span> · {hasAnyData ? "Live" : "Setup in progress"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button asChild variant="outline" size="sm" className="h-8 rounded-full border-border/70 text-xs font-medium">
            <Link href="/system">
              <Boxes className="h-3.5 w-3.5" />
              My System
            </Link>
          </Button>
          <Button asChild size="sm" className="h-8 rounded-full text-xs font-medium shadow-subtle">
            <Link href="/modules">
              Manage modules
              <ArrowUpRight className="h-3.5 w-3.5" />
            </Link>
          </Button>
        </div>
      </div>

      {/* KPIs — high density, no clutter */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Revenue"
          value={data.revenuePaise > 0 ? formatINR(data.revenuePaise) : "—"}
          detail={`${formatNumber(data.orderCount)} orders · ${data.tenant.status}`}
          icon={IndianRupee}
          trend={data.orderCount > 0 ? { value: `${data.orderCount} total`, positive: true } : undefined}
        />
        <StatCard
          label="Leads"
          value={formatNumber(data.leadCount)}
          detail={data.leadCount > 0 ? `${data.recentLeads[0]?.source ?? "Across sources"} · last lead ${data.recentLeads[0] ? relativeTime(data.recentLeads[0].createdAt) : "—"}` : "No leads yet"}
          icon={UserPlus}
        />
        <StatCard
          label="Customers"
          value={formatNumber(data.customerCount)}
          detail={
            conversion !== null ? `${conversion}% lead → customer` : `${formatNumber(data.memberCount)} team members`
          }
          icon={Users}
        />
        <StatCard
          label="Bookings & Orders"
          value={formatNumber(data.orderCount)}
          detail={data.revenuePaise > 0 ? `Avg ${formatINR(Math.round(data.revenuePaise / Math.max(1, data.orderCount)))}` : "Awaiting first order"}
          icon={ShoppingBag}
        />
      </div>

      {/* Secondary metrics — thin, precise */}
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="flex items-center justify-between rounded-[12px] border border-border/60 bg-card px-4 py-3 shadow-subtle">
          <div className="flex items-center gap-2.5">
            <span className="flex h-7 w-7 items-center justify-center rounded-full border border-border/60 bg-muted/40">
              <TrendingUp className="h-3.5 w-3.5 text-muted-foreground" />
            </span>
            <div>
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Conversion</p>
              <p className="text-[13px] font-semibold tracking-tight">{conversion !== null ? `${conversion}%` : "—"}</p>
            </div>
          </div>
          <span className="text-[11px] text-muted-foreground">Leads → customers</span>
        </div>

        <div className="flex items-center justify-between rounded-[12px] border border-border/60 bg-card px-4 py-3 shadow-subtle">
          <div className="flex items-center gap-2.5">
            <span className="flex h-7 w-7 items-center justify-center rounded-full border border-border/60 bg-muted/40">
              <Boxes className="h-3.5 w-3.5 text-muted-foreground" />
            </span>
            <div>
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Active systems</p>
              <p className="text-[13px] font-semibold tracking-tight">
                {data.enabledRows.length} / {totalModules}
              </p>
            </div>
          </div>
          <Badge variant={data.enabledRows.length > 0 ? "success" : "secondary"} className="rounded-full text-[10px]">
            {data.enabledRows.length > 0 ? "Operational" : "Setup needed"}
          </Badge>
        </div>

        <div className="flex items-center justify-between rounded-[12px] border border-border/60 bg-card px-4 py-3 shadow-subtle">
          <div className="flex items-center gap-2.5">
            <span className="flex h-7 w-7 items-center justify-center rounded-full border border-amber-200 bg-amber-50 dark:bg-amber-950/30">
              <Package className="h-3.5 w-3.5 text-amber-600" />
            </span>
            <div>
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Inventory alerts</p>
              <p className="text-[13px] font-semibold tracking-tight">{data.lowStockCount} low stock</p>
            </div>
          </div>
          <span className="text-[11px] text-muted-foreground">{data.lowStockCount > 0 ? "Needs attention" : "All stocked"}</span>
        </div>
      </div>

      {/* Main grid — executive command center */}
      <div className="grid gap-6 lg:grid-cols-12">
        {/* Left — 8 cols */}
        <div className="space-y-6 lg:col-span-8">
          {/* Revenue insight — restrained chart */}
          <CardShell>
            <SectionHeader
              title="Revenue · last 7 days"
              description={hasAnyData ? "Daily order value — precise, calm visualization" : "Waiting for orders to visualize revenue"}
              action={
                <Link href="/analytics" className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors">
                  View analytics <ArrowUpRight className="h-3 w-3" />
                </Link>
              }
            />
            {hasAnyData && data.dailyRevenue.some((d) => d.sum > 0) ? (
              <div className="mt-5">
                <div className="flex h-[96px] items-end gap-1.5">
                  {data.dailyRevenue.map((day) => {
                    const h = Math.round((day.sum / data.maxDaily) * 80) + 6;
                    const isToday = day.key === new Date().toISOString().slice(0, 10);
                    return (
                      <div key={day.key} className="flex flex-1 flex-col items-center gap-2">
                        <div
                          className={`w-full rounded-[6px] transition-all duration-500 ${isToday ? "bg-foreground" : "bg-foreground/15 hover:bg-foreground/25"}`}
                          style={{ height: `${h}px` }}
                          title={`${day.key}: ${formatINR(day.sum)}`}
                        />
                        <span className="text-[10px] font-medium tracking-wide text-muted-foreground">
                          {new Date(day.key).toLocaleDateString("en-IN", { weekday: "narrow" })}
                        </span>
                      </div>
                    );
                  })}
                </div>
                <div className="mt-4 flex items-center justify-between border-t border-border/60 pt-3 text-[11px] text-muted-foreground">
                  <span>Total {formatINR(data.revenuePaise)}</span>
                  <span className="font-mono text-xs">{formatNumber(data.orderCount)} orders</span>
                </div>
              </div>
            ) : (
              <EmptyState
                icon={TrendingUp}
                title="No revenue yet"
                description="Orders from Swiggy, Zomato and your website will appear here. The chart stays quiet until data arrives."
                className="mt-4 py-8"
              />
            )}
          </CardShell>

          {/* Recent orders & leads — high information density, thin borders */}
          <div className="grid gap-6 md:grid-cols-2">
            <CardShell>
              <SectionHeader
                title="Recent orders"
                description={data.recentOrders.length > 0 ? `${data.recentOrders.length} latest` : "No orders yet"}
                action={
                  <Badge variant="outline" className="rounded-full text-[10px] font-medium">
                    {data.orderCount} total
                  </Badge>
                }
              />
              {data.recentOrders.length === 0 ? (
                <EmptyState
                  icon={ShoppingBag}
                  title="Awaiting first order"
                  description="Connect Swiggy / Zomato or your booking system — orders land here instantly."
                  className="mt-4 py-7"
                />
              ) : (
                <div className="mt-4 divide-y divide-border/60 rounded-[10px] border border-border/60">
                  {data.recentOrders.map((o) => (
                    <div key={o.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                      <div className="min-w-0">
                        <p className="truncate text-[13px] font-medium tracking-tight">{o.customerName ?? o.externalOrderId}</p>
                        <p className="truncate text-[11px] text-muted-foreground">
                          {o.source} · {o.status} · {relativeTime(o.placedAt)}
                        </p>
                      </div>
                      <p className="shrink-0 font-mono-data text-[13px] font-semibold">{formatINR(o.totalPaise)}</p>
                    </div>
                  ))}
                </div>
              )}
              {data.recentOrders.length > 0 ? (
                <Link href="/analytics" className="mt-3 inline-flex text-xs font-medium text-muted-foreground hover:text-foreground">
                  View all orders →
                </Link>
              ) : null}
            </CardShell>

            <CardShell>
              <SectionHeader
                title="Recent leads"
                description={data.recentLeads.length > 0 ? `${data.recentLeads.length} latest` : "No leads yet"}
                action={
                  <Badge variant="outline" className="rounded-full text-[10px] font-medium">
                    {data.leadCount} total
                  </Badge>
                }
              />
              {data.recentLeads.length === 0 ? (
                <EmptyState
                  icon={UserPlus}
                  title="No leads yet"
                  description="Website forms, WhatsApp and campaign leads appear here with AI enrichment."
                  className="mt-4 py-7"
                />
              ) : (
                <div className="mt-4 divide-y divide-border/60 rounded-[10px] border border-border/60">
                  {data.recentLeads.map((l) => (
                    <div key={l.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                      <div className="min-w-0">
                        <p className="truncate text-[13px] font-medium tracking-tight">{l.name ?? l.phone}</p>
                        <p className="truncate text-[11px] text-muted-foreground">
                          {l.source} {l.category ? `· ${l.category}` : ""} · {relativeTime(l.createdAt)}
                        </p>
                      </div>
                      <span className="shrink-0 rounded-full border border-border/60 bg-muted/40 px-2 py-1 text-[10px] font-medium">
                        {l.phone.slice(-4)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </CardShell>
          </div>

          {/* System modules snapshot */}
          <CardShell>
            <SectionHeader
              title="Your system"
              description={`${data.enabledRows.length} active · ${disabledModules.length} available`}
              action={
                <Button asChild variant="ghost" size="sm" className="h-7 rounded-full text-xs">
                  <Link href="/system">Open My System</Link>
                </Button>
              }
            />
            <div className="mt-4 grid gap-2.5 sm:grid-cols-2">
              {enabledModules.slice(0, 4).map((m) => (
                <div key={m.contract.name} className="flex items-center gap-3 rounded-[10px] border border-emerald-200/50 bg-emerald-50/40 px-3 py-2.5 dark:border-emerald-900/30 dark:bg-emerald-950/20">
                  <span className="h-2 w-2 rounded-full bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.4)]" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium tracking-tight">{m.contract.displayName}</p>
                    <p className="truncate text-[11px] text-muted-foreground">Active · v{m.contract.version}</p>
                  </div>
                  <span className="text-[10px] font-medium uppercase tracking-wide text-emerald-700 dark:text-emerald-300">Live</span>
                </div>
              ))}
              {enabledModules.length === 0 ? (
                <div className="col-span-2">
                  <EmptyState
                    icon={Boxes}
                    title="No modules enabled"
                    description="Enable Leads, Orders, Inventory, CRM and Ops to build your operating system."
                    action={
                      <Button asChild size="sm" className="rounded-full">
                        <Link href="/modules">Browse modules</Link>
                      </Button>
                    }
                    className="py-6"
                  />
                </div>
              ) : null}
              {disabledModules.slice(0, 2).map((m) => (
                <div key={m.contract.name} className="flex items-center gap-3 rounded-[10px] border border-border/60 bg-muted/20 px-3 py-2.5 opacity-70">
                  <span className="h-2 w-2 rounded-full bg-muted-foreground/40" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium tracking-tight">{m.contract.displayName}</p>
                    <p className="truncate text-[11px] text-muted-foreground">Disabled · {m.contract.description.slice(0, 48)}…</p>
                  </div>
                </div>
              ))}
            </div>
          </CardShell>
        </div>

        {/* Right — 4 cols — alerts, health, activity, AI */}
        <div className="space-y-6 lg:col-span-4">
          {/* Attention */}
          <CardShell>
            <SectionHeader title="Needs attention" description="Only what matters right now" />
            <div className="mt-4 space-y-2.5">
              {data.lowStockCount > 0 ? (
                <div className="flex gap-3 rounded-[10px] border border-amber-200/70 bg-amber-50/60 px-3 py-3 dark:border-amber-900/40 dark:bg-amber-950/20">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                  <div>
                    <p className="text-[13px] font-medium tracking-tight">{data.lowStockCount} items low on stock</p>
                    <p className="text-[12px] leading-snug text-muted-foreground">Par levels breached — reorder suggested.</p>
                  </div>
                </div>
              ) : null}

              {data.enabledRows.length === 0 ? (
                <div className="flex gap-3 rounded-[10px] border border-border/60 bg-muted/20 px-3 py-3">
                  <Boxes className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                  <div>
                    <p className="text-[13px] font-medium tracking-tight">Complete your setup</p>
                    <p className="text-[12px] leading-snug text-muted-foreground">Enable your first module to go live.</p>
                    <Link href="/modules" className="mt-1 inline-flex text-xs font-medium text-foreground underline underline-offset-4">
                      Enable modules
                    </Link>
                  </div>
                </div>
              ) : null}

              {data.lowStockCount === 0 && data.enabledRows.length > 0 ? (
                <div className="flex gap-3 rounded-[10px] border border-emerald-200/50 bg-emerald-50/40 px-3 py-3 dark:border-emerald-900/30 dark:bg-emerald-950/20">
                  <Activity className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                  <div>
                    <p className="text-[13px] font-medium tracking-tight">All clear</p>
                    <p className="text-[12px] leading-snug text-muted-foreground">No urgent alerts. System is calm.</p>
                  </div>
                </div>
              ) : null}
            </div>
          </CardShell>

          {/* AI insights — premium, restrained */}
          <CardShell className="bg-[#0A0A0B] text-white border-[#1A1A1E] dark:bg-[#0A0A0B]">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-white/10">
                  <Sparkles className="h-3.5 w-3.5 text-white" />
                </span>
                <div>
                  <p className="text-[13px] font-semibold tracking-tight text-white">WavesCo Intelligence</p>
                  <p className="text-[11px] text-white/60">AI • Quiet insights</p>
                </div>
              </div>
              <Badge className="bg-white/10 text-white border-white/10 hover:bg-white/15 rounded-full text-[10px]">Soon</Badge>
            </div>
            <div className="mt-4 space-y-2.5">
              {hasAnyData ? (
                <>
                  <p className="text-[12.5px] leading-relaxed text-white/80">
                    {data.orderCount > 0
                      ? `You processed ${formatNumber(data.orderCount)} orders totaling ${formatINR(data.revenuePaise)}. Keep inventory aligned for peak hours.`
                      : `You have ${formatNumber(data.leadCount)} leads and ${formatNumber(data.customerCount)} customers. Focus on converting warm leads this week.`}
                  </p>
                  <p className="text-[12px] leading-relaxed text-white/50">
                    AI enrichment (OpenAI) for leads and Telegram alerts are ready once enabled.
                  </p>
                </>
              ) : (
                <p className="text-[12.5px] leading-relaxed text-white/80">
                  As your business data grows, quiet insights will appear here — conversion hints, prep recommendations, and anomalies.
                </p>
              )}
            </div>
            <Link
              href="/ai"
              className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-xs font-medium text-black transition-colors hover:bg-white/90"
            >
              Open AI
              <ArrowUpRight className="h-3 w-3" />
            </Link>
          </CardShell>

          {/* System health */}
          <CardShell>
            <SectionHeader
              title="System health"
              description="Everything WavesCo runs for you"
              action={
                <span className="inline-flex h-2 w-2 rounded-full bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.4)]" />
              }
            />
            <div className="mt-4 space-y-2">
              {Object.values(registry)
                .slice(0, 5)
                .map((m) => {
                  const enabled = enabledModuleNames.has(m.contract.name);
                  return (
                    <div key={m.contract.name} className="flex items-center justify-between rounded-[9px] border border-border/60 px-3 py-2">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${enabled ? "bg-emerald-500" : "bg-zinc-300 dark:bg-zinc-600"}`} />
                        <span className="truncate text-[12.5px] font-medium tracking-tight">{m.contract.displayName}</span>
                      </div>
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${enabled ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300" : "bg-muted text-muted-foreground"}`}>
                        {enabled ? "Live" : "Off"}
                      </span>
                    </div>
                  );
                })}
            </div>
            <Link href="/system" className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground">
              View full system <ArrowUpRight className="h-3 w-3" />
            </Link>
          </CardShell>

          {/* Recent activity — unified */}
          <CardShell>
            <SectionHeader
              title="Recent activity"
              description="Automatic audit trail"
              action={
                <Link href="/activity" className="text-xs font-medium text-muted-foreground hover:text-foreground">
                  View all
                </Link>
              }
            />
            {data.auditLogs.length === 0 ? (
              <EmptyState
                icon={Clock3}
                title="No activity yet"
                description="Actions inside modules appear here automatically."
                className="mt-4 py-6"
              />
            ) : (
              <div className="mt-4 space-y-0 divide-y divide-border/50">
                {data.auditLogs.slice(0, 5).map((log) => (
                  <div key={`${log.action}-${log.recordId}-${log.createdAt.toISOString()}`} className="flex gap-3 py-2.5 first:pt-0 last:pb-0">
                    <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-foreground/30" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[12.5px] font-[450] tracking-tight">
                        <span className="font-mono text-[11px] text-muted-foreground">{log.model}</span>
                        <span className="mx-1 text-muted-foreground">·</span>
                        {log.action}
                      </p>
                      <p className="truncate font-mono text-[11px] text-muted-foreground">{(log.recordId ?? "").slice(0, 16)}…</p>
                    </div>
                    <span className="shrink-0 text-[11px] text-muted-foreground">{relativeTime(log.createdAt)}</span>
                  </div>
                ))}
              </div>
            )}
          </CardShell>
        </div>
      </div>
    </div>
  );
}

