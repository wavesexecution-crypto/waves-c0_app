import type { Metadata } from "next";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { withTenantContext } from "@wavesco/db";
import { requireTenantId } from "@/lib/tenant";
import { Badge, Button } from "@wavesco/ui";
import { CardShell, SectionHeader } from "@/components/dashboard/section";
import { EmptyState } from "@/components/dashboard/empty-state";
import { LifeBuoy, Mail, Phone, Clock3, MessageCircle, ShieldCheck, ArrowUpRight, CheckCircle2 } from "lucide-react";

export const metadata: Metadata = { title: "Support" };

export default async function SupportPage() {
  const session = await auth();
  const tenantId = requireTenantId(session);

  const data = await withTenantContext(tenantId, async (tx) => {
    const [tenant, enabledCount, auditCount] = await Promise.all([
      tx.tenant.findUnique({ where: { id: tenantId }, select: { name: true, plan: true, slug: true, status: true } }),
      tx.tenantModule.count({ where: { tenantId, status: "enabled" } }),
      tx.auditLog.count({ where: { tenantId } }),
    ]);
    return { tenant, enabledCount, auditCount };
  });

  return (
    <div className="space-y-7 animate-fade-in">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-[22px] font-semibold tracking-[-0.03em] leading-none">Support</h1>
          <p className="mt-2 max-w-[58ch] text-[13px] leading-snug text-muted-foreground">
            A clear way to contact WavesCo — your private operating system provider. No bot maze, just help.
          </p>
        </div>
        <Badge variant="outline" className="self-start rounded-full text-[11px] sm:self-auto">
          {data.tenant?.name}
        </Badge>
      </div>

      <div className="grid gap-6 lg:grid-cols-12">
        <div className="space-y-6 lg:col-span-8">
          {/* Open request — premium card */}
          <div className="rounded-[16px] border border-foreground/10 bg-foreground text-background p-6 shadow-card">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-background text-foreground">
                  <LifeBuoy className="h-4 w-4" />
                </span>
                <div>
                  <p className="text-[14px] font-semibold tracking-tight">How can WavesCo help?</p>
                  <p className="text-[12px] text-background/60">We respond within a few hours — calm, precise, human.</p>
                </div>
              </div>
              <span className="hidden sm:inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 text-[11px] font-medium text-white border border-white/10">
                <span className="h-2 w-2 rounded-full bg-emerald-400" />
                Online
              </span>
            </div>

            <div className="mt-6 grid gap-3 sm:grid-cols-3">
              <a href="mailto:support@wavesco.in" className="rounded-[12px] border border-white/10 bg-white/5 p-4 hover:bg-white/10 transition-colors">
                <Mail className="h-4 w-4 text-white/80" />
                <p className="mt-2 text-[12.5px] font-medium text-white">Email support</p>
                <p className="text-[11px] text-white/60">support@wavesco.in</p>
              </a>
              <a href="tel:+919999999999" className="rounded-[12px] border border-white/10 bg-white/5 p-4 hover:bg-white/10 transition-colors">
                <Phone className="h-4 w-4 text-white/80" />
                <p className="mt-2 text-[12.5px] font-medium text-white">Priority line</p>
                <p className="text-[11px] text-white/60">For owners & admins</p>
              </a>
              <div className="rounded-[12px] border border-white/10 bg-white/5 p-4">
                <Clock3 className="h-4 w-4 text-white/80" />
                <p className="mt-2 text-[12.5px] font-medium text-white">Hours</p>
                <p className="text-[11px] text-white/60">Mon–Sat · 10am – 7pm IST</p>
              </div>
            </div>

            <div className="mt-6 flex flex-wrap gap-3">
              <Button asChild className="rounded-full bg-white text-black hover:bg-white/90 h-8 text-xs font-medium">
                <a href="mailto:support@wavesco.in">Open support request</a>
              </Button>
              <span className="inline-flex items-center text-[11px] text-white/60">We’ll CC your team · tenant {data.tenant?.slug}</span>
            </div>
          </div>

          {/* Requests — empty state elegant */}
          <CardShell>
            <SectionHeader
              title="Your requests"
              description="Existing requests and their status"
              action={<Badge variant="outline" className="rounded-full text-[11px]">0 open</Badge>}
            />
            <EmptyState
              icon={MessageCircle}
              title="No open requests"
              description="When you email support, threads appear here. For now, your system is quiet — that’s good."
              className="mt-4"
            />
            <div className="mt-4 rounded-[10px] border border-border/60 bg-muted/20 px-4 py-3 flex items-start gap-3">
              <ShieldCheck className="h-4 w-4 text-muted-foreground mt-0.5" />
              <p className="text-[12px] leading-snug text-muted-foreground">
                <span className="font-medium text-foreground">Managed service:</span> WavesCo monitors your modules proactively. If something needs attention, we reach out first.
              </p>
            </div>
          </CardShell>
        </div>

        <div className="space-y-6 lg:col-span-4">
          <CardShell>
            <SectionHeader title="System status" description="What WavesCo runs for you now" />
            <div className="mt-4 space-y-3">
              <div className="flex items-center justify-between rounded-[10px] border border-emerald-200/50 bg-emerald-50/40 px-3 py-2.5 dark:border-emerald-900/30 dark:bg-emerald-950/20">
                <span className="text-[12.5px] font-medium">Platform</span>
                <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-300">
                  <CheckCircle2 className="h-3.5 w-3.5" /> Operational
                </span>
              </div>
              <div className="flex items-center justify-between rounded-[10px] border border-border/60 px-3 py-2.5">
                <span className="text-[12.5px] font-medium">Active modules</span>
                <span className="font-mono text-xs font-medium">{data.enabledCount}</span>
              </div>
              <div className="flex items-center justify-between rounded-[10px] border border-border/60 px-3 py-2.5">
                <span className="text-[12.5px] font-medium">Events logged</span>
                <span className="font-mono text-xs font-medium">{data.auditCount}</span>
              </div>
              <p className="text-[11px] leading-snug text-muted-foreground">Status is tenant-scoped and real — not a marketing badge.</p>
              <Link href="/system" className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground">
                View My System <ArrowUpRight className="h-3 w-3" />
              </Link>
            </div>
          </CardShell>

          <CardShell>
            <SectionHeader title="Contact information" description="Keep this updated in Settings" />
            <div className="mt-4 space-y-3 text-[12.5px]">
              <div className="flex justify-between border-b border-border/40 pb-2">
                <span className="text-muted-foreground">Business</span>
                <span className="font-medium">{data.tenant?.name}</span>
              </div>
              <div className="flex justify-between border-b border-border/40 pb-2">
                <span className="text-muted-foreground">Workspace</span>
                <span className="font-mono text-xs">{data.tenant?.slug}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Plan</span>
                <span className="font-medium capitalize">{data.tenant?.plan}</span>
              </div>
            </div>
            <Button asChild variant="outline" size="sm" className="mt-4 w-full rounded-full">
              <Link href="/settings">Manage business info</Link>
            </Button>
          </CardShell>
        </div>
      </div>
    </div>
  );
}
