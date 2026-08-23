import type { Metadata } from "next";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { withTenantContext } from "@wavesco/db";
import { requireTenantId } from "@/lib/tenant";
import { Badge } from "@wavesco/ui";
import { CardShell, SectionHeader } from "@/components/dashboard/section";
import { EmptyState } from "@/components/dashboard/empty-state";
import { BarChart3, TrendingUp, Users, UserPlus, ShoppingBag } from "lucide-react";

export const metadata: Metadata = { title: "Analytics" };

type Range = "7d" | "30d" | "90d" | "12m";

const RANGE_LABEL: Record<Range, string> = { "7d": "7D", "30d": "30D", "90d": "90D", "12m": "12M" };

function parseRange(v: string | string[] | undefined): Range {
  const s = Array.isArray(v) ? v[0] : v;
  if (s === "30d" || s === "90d" || s === "12m") return s;
  return "7d";
}

function rangeToDays(range: Range) {
  if (range === "7d") return 7;
  if (range === "30d") return 30;
  if (range === "90d") return 90;
  return 365;
}

function formatINR(paise: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(paise / 100);
}

export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const range = parseRange(sp.range);
  const days = rangeToDays(range);
  const session = await auth();
  const tenantId = requireTenantId(session);

  const now = new Date();
  const start = new Date(now);
  start.setDate(now.getDate() - days);
  const prevStart = new Date(start);
  prevStart.setDate(start.getDate() - days);

  const data = await withTenantContext(tenantId, async (tx) => {
    const [ordersCurrent, ordersPrev, leadsCurrent, leadsPrev, customersCurrent, customersPrev, ordersByDay] = await Promise.all([
      tx.cafeOrder.aggregate({ where: { tenantId, placedAt: { gte: start } }, _count: true, _sum: { totalPaise: true } }),
      tx.cafeOrder.aggregate({ where: { tenantId, placedAt: { gte: prevStart, lt: start } }, _count: true, _sum: { totalPaise: true } }),
      tx.cafeLead.count({ where: { tenantId, createdAt: { gte: start } } }),
      tx.cafeLead.count({ where: { tenantId, createdAt: { gte: prevStart, lt: start } } }),
      tx.cafeCustomer.count({ where: { tenantId, createdAt: { gte: start } } }),
      tx.cafeCustomer.count({ where: { tenantId, createdAt: { gte: prevStart, lt: start } } }),
      tx.cafeOrder.findMany({ where: { tenantId, placedAt: { gte: start } }, select: { totalPaise: true, placedAt: true } }),
    ]);

    // Bucket by day (or month for 12m)
    const buckets: { label: string; sum: number; count: number }[] = [];
    if (range === "12m") {
      for (let i = 11; i >= 0; i--) {
        const d = new Date(now);
        d.setMonth(now.getMonth() - i);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
        const label = d.toLocaleDateString("en-IN", { month: "short" });
        const sum = ordersByDay
          .filter((o) => `${o.placedAt.getFullYear()}-${String(o.placedAt.getMonth() + 1).padStart(2, "0")}` === key)
          .reduce((a, o) => a + o.totalPaise, 0);
        const count = ordersByDay.filter((o) => `${o.placedAt.getFullYear()}-${String(o.placedAt.getMonth() + 1).padStart(2, "0")}` === key).length;
        buckets.push({ label, sum, count });
      }
    } else {
      for (let i = days - 1; i >= 0; i--) {
        const d = new Date(now);
        d.setDate(now.getDate() - i);
        const key = d.toISOString().slice(0, 10);
        const label = d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
        const sum = ordersByDay.filter((o) => o.placedAt.toISOString().slice(0, 10) === key).reduce((a, o) => a + o.totalPaise, 0);
        const count = ordersByDay.filter((o) => o.placedAt.toISOString().slice(0, 10) === key).length;
        buckets.push({ label, sum, count });
      }
    }

    const max = Math.max(1, ...buckets.map((b) => b.sum));
    return {
      ordersCurrent: ordersCurrent._count,
      revenueCurrent: ordersCurrent._sum.totalPaise ?? 0,
      ordersPrev: ordersPrev._count,
      revenuePrev: ordersPrev._sum.totalPaise ?? 0,
      leadsCurrent,
      leadsPrev,
      customersCurrent,
      customersPrev,
      buckets,
      max,
    };
  });

  const hasData = data.ordersCurrent > 0 || data.leadsCurrent > 0 || data.customersCurrent > 0;

  function delta(current: number, prev: number) {
    if (prev === 0 && current === 0) return null;
    if (prev === 0) return { label: "new", positive: true };
    const pct = Math.round(((current - prev) / prev) * 100);
    // eslint-disable-next-line @typescript-eslint/restrict-plus-operands
    return { label: `${pct >= 0 ? "+" : ""}${pct}%`, positive: pct >= 0 };
  }

  const revenueDelta = delta(data.revenueCurrent, data.revenuePrev);
  const ordersDelta = delta(data.ordersCurrent, data.ordersPrev);
  const leadsDelta = delta(data.leadsCurrent, data.leadsPrev);
  const customersDelta = delta(data.customersCurrent, data.customersPrev);

  return (
    <div className="space-y-7 animate-fade-in">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-[22px] font-semibold tracking-[-0.03em] leading-none">Analytics</h1>
          <p className="mt-2 text-[13px] leading-snug text-muted-foreground">Revenue, leads, conversion and automation — restrained, readable.</p>
        </div>
        <div className="inline-flex rounded-full border border-border/60 bg-muted/30 p-1">
          {(Object.keys(RANGE_LABEL) as Range[]).map((r) => (
            <Link
              key={r}
              href={`/analytics?range=${r}`}
              className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${range === r ? "bg-card shadow-subtle border border-border/60 text-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              {RANGE_LABEL[r]}
            </Link>
          ))}
        </div>
      </div>

      {/* KPI strip */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: "Revenue", value: data.revenueCurrent > 0 ? formatINR(data.revenueCurrent) : "—", delta: revenueDelta, icon: TrendingUp },
          { label: "Orders", value: String(data.ordersCurrent), delta: ordersDelta, icon: ShoppingBag },
          { label: "Leads", value: String(data.leadsCurrent), delta: leadsDelta, icon: UserPlus },
          { label: "New customers", value: String(data.customersCurrent), delta: customersDelta, icon: Users },
        ].map((kpi) => {
          const Icon = kpi.icon;
          return (
            <div key={kpi.label} className="rounded-[12px] border border-border/60 bg-card px-4 py-4 shadow-subtle">
              <div className="flex items-center justify-between">
                <span className="flex h-7 w-7 items-center justify-center rounded-[8px] border border-border/60 bg-muted/40">
                  <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                </span>
                {kpi.delta ? (
                  <span className={`rounded-full px-2 py-1 text-[11px] font-medium ${kpi.delta.positive ? "bg-emerald-50 text-emerald-700 border border-emerald-200/60 dark:bg-emerald-950/30 dark:text-emerald-300" : "bg-amber-50 text-amber-700 border border-amber-200/60"}`}>
                    {kpi.delta.label}
                  </span>
                ) : null}
              </div>
              <p className="mt-3 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{kpi.label}</p>
              <p className="mt-1 font-mono-data text-[18px] font-semibold tracking-tight leading-none">{kpi.value}</p>
              <p className="mt-1 text-[11px] text-muted-foreground">vs previous {RANGE_LABEL[range].toLowerCase()}</p>
            </div>
          );
        })}
      </div>

      {/* Charts */}
      <div className="grid gap-6 lg:grid-cols-12">
        <CardShell className="lg:col-span-8">
          <SectionHeader
            title="Revenue trend"
            description={`${RANGE_LABEL[range]} · daily order value`}
            action={<Badge variant="outline" className="rounded-full text-[11px]">{hasData ? formatINR(data.revenueCurrent) + " total" : "No data"}</Badge>}
          />
          {hasData && data.buckets.some((b) => b.sum > 0) ? (
            <div className="mt-6">
              <div className="flex h-[160px] items-end gap-1 sm:gap-1.5">
                {data.buckets.map((b, i) => {
                  const h = Math.round((b.sum / data.max) * 120) + 8;
                  const isLast = i === data.buckets.length - 1;
                  return (
                    <div key={b.label + i} className="flex flex-1 flex-col items-center gap-1.5">
                      <div
                        className={`w-full rounded-[6px] transition-all duration-500 ${isLast ? "bg-foreground" : "bg-foreground/20 hover:bg-foreground/30"} ${b.sum === 0 ? "opacity-30" : ""}`}
                        style={{ height: `${h}px` }}
                        title={`${b.label}: ${formatINR(b.sum)} (${b.count} orders)`}
                      />
                      <span className="hidden text-[10px] font-medium tracking-wide text-muted-foreground sm:block truncate w-full text-center">
                        {b.label}
                      </span>
                    </div>
                  );
                })}
              </div>
              <div className="mt-4 flex justify-between border-t border-border/60 pt-3 text-[11px] text-muted-foreground">
                <span>{data.buckets[0]?.label} → {data.buckets[data.buckets.length - 1]?.label}</span>
                <span className="font-mono">Peak {formatINR(data.max)}</span>
              </div>
            </div>
          ) : (
            <EmptyState icon={BarChart3} title="No revenue in this range" description="Select a longer range or check after orders arrive." className="mt-6 py-10" />
          )}
        </CardShell>

        <div className="space-y-6 lg:col-span-4">
          <CardShell>
            <SectionHeader title="Funnel" description="Lead → customer flow" />
            <div className="mt-4 space-y-3">
              <div className="flex items-center justify-between rounded-[10px] border border-border/60 px-3 py-2.5">
                <span className="text-[12.5px] font-medium">Leads</span>
                <span className="font-mono text-[13px] font-semibold">{data.leadsCurrent}</span>
              </div>
              <div className="flex justify-center">
                <span className="text-[11px] text-muted-foreground">↓ {data.leadsCurrent > 0 ? Math.round((data.customersCurrent / Math.max(1, data.leadsCurrent)) * 100) : 0}% conversion</span>
              </div>
              <div className="flex items-center justify-between rounded-[10px] border border-border/60 bg-muted/20 px-3 py-2.5">
                <span className="text-[12.5px] font-medium">Customers</span>
                <span className="font-mono text-[13px] font-semibold">{data.customersCurrent}</span>
              </div>
              <p className="text-[11px] leading-snug text-muted-foreground">Conversion is leads in range → new customers. Elegant, not noisy.</p>
            </div>
          </CardShell>

          <CardShell>
            <SectionHeader title="Automation activity" description="Audit-backed · last 7 days" />
            <div className="mt-4 rounded-[10px] border border-dashed border-border/60 bg-muted/20 px-4 py-6 text-center">
              <p className="text-[12.5px] font-medium">All automations quiet</p>
              <p className="mt-1 text-[11px] text-muted-foreground">WhatsApp, Telegram and AI actions log here when enabled.</p>
            </div>
          </CardShell>
        </div>
      </div>

      <CardShell>
        <SectionHeader title="Campaign performance" description="Reserved for marketing automation — appears when campaigns run" />
        <EmptyState
          icon={BarChart3}
          title="No campaigns yet"
          description="When you launch campaigns, performance (opens, clicks, conversions) appears here — restrained tables, no chart spam."
          className="mt-4"
        />
      </CardShell>
    </div>
  );
}

