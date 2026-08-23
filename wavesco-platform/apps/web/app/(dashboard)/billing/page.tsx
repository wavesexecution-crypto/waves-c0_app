import type { Metadata } from "next";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { withTenantContext } from "@wavesco/db";
import { Badge, Button } from "@wavesco/ui";
import { requireTenantId } from "@/lib/tenant";
import { CardShell, SectionHeader } from "@/components/dashboard/section";
import { EmptyState } from "@/components/dashboard/empty-state";
import { CreditCard, Receipt, ShieldCheck, Calendar, ArrowUpRight, Check } from "lucide-react";

export const metadata: Metadata = { title: "Billing" };

// Simple plan pricing map — precise, not decorative. Replace with Stripe when ENABLE_BILLING=true
const PLAN_PRICE: Record<string, { monthly: number; label: string }> = {
  starter: { monthly: 299900, label: "Starter" },
  growth: { monthly: 599900, label: "Growth" },
  scale: { monthly: 999900, label: "Scale" },
};

function formatINR(paise: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(paise / 100);
}

export default async function BillingPage() {
  const session = await auth();
  const tenantId = requireTenantId(session);

  const data = await withTenantContext(tenantId, async (tx) => {
    const [tenant, enabledModules, aiUsage] = await Promise.all([
      tx.tenant.findUnique({ where: { id: tenantId }, select: { plan: true, status: true, name: true, createdAt: true } }),
      tx.tenantModule.findMany({
        where: { tenantId, status: "enabled" },
        select: { module: { select: { displayName: true, name: true } } },
      }),
      tx.cafeLead.count({ where: { tenantId, summary: { not: null } } }),
    ]);
    return { tenant, enabledModules, aiUsage };
  });

  const billingEnabled = process.env.ENABLE_BILLING === "true";
  const planKey = data.tenant?.plan ?? "starter";
  const plan = PLAN_PRICE[planKey] ?? PLAN_PRICE.starter; // eslint-disable-line @typescript-eslint/dot-notation
  if (!plan) throw new Error("Missing plan pricing");
  const monthlyPaise = plan.monthly;
  // AI usage: first 100 enrichments included, then ₹2 each — example, restrained
  const aiIncluded = 100;
  const aiExtra = Math.max(0, data.aiUsage - aiIncluded);
  const aiChargePaise = aiExtra * 200; // ₹2
  const totalPaise = monthlyPaise + aiChargePaise;
  const nextBilling = new Date(data.tenant?.createdAt ?? new Date());
  nextBilling.setMonth(nextBilling.getMonth() + 1);

  return (
    <div className="space-y-7 animate-fade-in">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-[22px] font-semibold tracking-[-0.03em] leading-none">Billing</h1>
          <p className="mt-2 max-w-[60ch] text-[13px] leading-snug text-muted-foreground">
            Clean, honest billing — what you pay for, what&apos;s included, what&apos;s next. No internal implementation details.
          </p>
        </div>
        <Badge variant={billingEnabled ? "success" : "secondary"} className="self-start rounded-full text-[11px] sm:self-auto">
          {billingEnabled ? "Live billing" : "Preview · ENABLE_BILLING=false"}
        </Badge>
      </div>

      {!billingEnabled ? (
        <div className="rounded-[12px] border border-amber-200/60 bg-amber-50/50 px-4 py-3 flex gap-3 dark:border-amber-900/30 dark:bg-amber-950/20">
          <ShieldCheck className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
          <p className="text-[12.5px] leading-snug text-amber-900 dark:text-amber-100">
            <span className="font-medium">Billing is in preview.</span> Amounts below are illustrative — real invoices (Stripe) land here when billing is enabled. Your data and modules are unaffected.
          </p>
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-12">
        <div className="space-y-6 lg:col-span-8">
          {/* Current plan — hero */}
          <CardShell className="p-0 overflow-hidden">
            <div className="p-6">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-center gap-3">
                  <span className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-foreground text-background">
                    <CreditCard className="h-4 w-4" />
                  </span>
                  <div>
                    <p className="text-[13px] font-semibold tracking-tight leading-none">{plan.label}</p>
                    <p className="text-[11px] text-muted-foreground">Managed by WavesCo · {data.tenant?.status}</p>
                  </div>
                </div>
                <Badge className="bg-foreground text-background rounded-full text-[11px]">Current plan</Badge>
              </div>

              <div className="mt-6 grid gap-6 sm:grid-cols-3">
                <div>
                  <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Monthly</p>
                  <p className="mt-1 font-mono-data text-[22px] font-semibold tracking-tight leading-none">{formatINR(monthlyPaise)}</p>
                  <p className="text-[11px] text-muted-foreground">Excl. AI overage</p>
                </div>
                <div>
                  <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Next billing</p>
                  <p className="mt-1 text-[13px] font-medium tracking-tight flex items-center gap-1.5">
                    <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                    {nextBilling.toLocaleDateString("en-IN", { day: "2-digit", month: "long", year: "numeric" })}
                  </p>
                  <p className="text-[11px] text-muted-foreground">Auto-renew · invoice emailed</p>
                </div>
                <div>
                  <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Workspace</p>
                  <p className="mt-1 text-[13px] font-medium tracking-tight">{data.tenant?.name}</p>
                  <p className="font-mono text-[11px] text-muted-foreground">{planKey}</p>
                </div>
              </div>
            </div>

            <div className="border-t border-border/60 bg-muted/20 px-6 py-4">
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">What&apos;s included</p>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {data.enabledModules.length > 0 ? (
                  data.enabledModules.map((m) => (
                    <div key={m.module.name} className="flex items-center gap-2 text-[12.5px]">
                      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500 text-white">
                        <Check className="h-3 w-3" />
                      </span>
                      <span className="font-medium tracking-tight">{m.module.displayName}</span>
                      <span className="ml-auto text-[11px] text-muted-foreground">Included</span>
                    </div>
                  ))
                ) : (
                  <p className="text-[12.5px] text-muted-foreground">No modules enabled yet — your plan starts when you enable your first system.</p>
                )}
              </div>
            </div>
          </CardShell>

          {/* Breakdown — thin, precise table */}
          <CardShell>
            <SectionHeader title="This month" description="Transparent breakdown — setup, modules, AI usage" />
            <div className="mt-4 overflow-hidden rounded-[10px] border border-border/60">
              <div className="divide-y divide-border/60">
                <div className="flex items-center justify-between px-4 py-3 bg-card">
                  <div>
                    <p className="text-[13px] font-medium tracking-tight">{plan.label} plan</p>
                    <p className="text-[11px] text-muted-foreground">Base platform, support, updates</p>
                  </div>
                  <span className="font-mono text-[13px] font-medium">{formatINR(monthlyPaise)}</span>
                </div>
                <div className="flex items-center justify-between px-4 py-3 bg-muted/20">
                  <div>
                    <p className="text-[13px] font-medium tracking-tight">Active modules</p>
                    <p className="text-[11px] text-muted-foreground">{data.enabledModules.length} enabled · included in plan</p>
                  </div>
                  <span className="text-[12px] font-medium text-muted-foreground">—</span>
                </div>
                <div className="flex items-center justify-between px-4 py-3 bg-card">
                  <div>
                    <p className="text-[13px] font-medium tracking-tight">AI usage</p>
                    <p className="text-[11px] text-muted-foreground">{data.aiUsage} enrichments · {aiIncluded} included · {aiExtra} overage</p>
                  </div>
                  <span className="font-mono text-[13px] font-medium">{aiChargePaise > 0 ? formatINR(aiChargePaise) : "Included"}</span>
                </div>
                <div className="flex items-center justify-between px-4 py-3 bg-foreground text-background">
                  <p className="text-[13px] font-medium">Total due</p>
                  <span className="font-mono text-[14px] font-semibold">{formatINR(totalPaise)}</span>
                </div>
              </div>
            </div>
            <p className="mt-3 text-[11px] leading-snug text-muted-foreground">
              Setup charges: none · Taxes as applicable · AI overage example @ ₹2/enrichment beyond 100 — real pricing confirmed by WavesCo.
            </p>
          </CardShell>
        </div>

        <div className="space-y-6 lg:col-span-4">
          <CardShell>
            <SectionHeader title="Payment method" description="Where invoices are charged" />
            <div className="mt-4 rounded-[10px] border border-border/60 bg-muted/20 px-4 py-4 flex items-center gap-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-[9px] bg-card border border-border/60 shadow-subtle">
                <CreditCard className="h-4 w-4 text-muted-foreground" />
              </span>
              <div>
                <p className="text-[12.5px] font-medium">No card on file</p>
                <p className="text-[11px] text-muted-foreground">WavesCo invoices directly for now</p>
              </div>
            </div>
            <Button asChild variant="outline" size="sm" className="mt-3 w-full rounded-full">
              <Link href="/support">Contact billing</Link>
            </Button>
          </CardShell>

          <CardShell>
            <SectionHeader
              title="Invoices"
              description="Payment history"
              action={<Badge variant="outline" className="rounded-full text-[11px]">0 issued</Badge>}
            />
            <EmptyState
              icon={Receipt}
              title="No invoices yet"
              description="When billing is live, invoices appear here with download and payment status."
              className="mt-4"
            />
            <div className="mt-4 flex items-center justify-between rounded-[10px] border border-border/60 bg-muted/20 px-3 py-2.5">
              <span className="text-[11px] text-muted-foreground">Need an invoice quickly?</span>
              <Link href="/support" className="inline-flex items-center gap-1 text-xs font-medium text-foreground">
                Ask support <ArrowUpRight className="h-3 w-3" />
              </Link>
            </div>
          </CardShell>

          <CardShell className="bg-muted/20">
            <p className="text-[12.5px] font-medium">Questions about your bill?</p>
            <p className="text-[11px] leading-snug text-muted-foreground mt-1">We keep it simple — you see exactly what you pay for. No hidden implementation details.</p>
            <Link href="/support" className="mt-3 inline-flex text-xs font-medium text-foreground underline underline-offset-4">
              Talk to WavesCo →
            </Link>
          </CardShell>
        </div>
      </div>
    </div>
  );
}


