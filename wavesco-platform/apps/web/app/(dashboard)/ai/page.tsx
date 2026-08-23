import type { Metadata } from "next";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { withTenantContext } from "@wavesco/db";
import { requireTenantId } from "@/lib/tenant";
import { Badge, Button } from "@wavesco/ui";
import { CardShell, SectionHeader } from "@/components/dashboard/section";
import { EmptyState } from "@/components/dashboard/empty-state";
import { Sparkles, MessageCircle, Brain, Zap, Shield, Clock3, ArrowUpRight } from "lucide-react";

export const metadata: Metadata = { title: "AI" };

export default async function AIPage() {
  const session = await auth();
  const tenantId = requireTenantId(session);

  const data = await withTenantContext(tenantId, async (tx) => {
    const [totalLeads, enrichedLeads, recentLeads, tenant] = await Promise.all([
      tx.cafeLead.count({ where: { tenantId } }),
      tx.cafeLead.count({ where: { tenantId, summary: { not: null } } }),
      tx.cafeLead.findMany({
        where: { tenantId, summary: { not: null } },
        orderBy: { createdAt: "desc" },
        take: 3,
        select: { id: true, name: true, phone: true, summary: true, suggestedReply: true, createdAt: true, category: true },
      }),
      tx.tenant.findUnique({ where: { id: tenantId }, select: { plan: true, name: true } }),
    ]);
    return { totalLeads, enrichedLeads, recentLeads, tenant };
  });

  const usagePct = data.totalLeads > 0 ? Math.round((data.enrichedLeads / data.totalLeads) * 100) : 0;
  const hasAI = data.enrichedLeads > 0;

  return (
    <div className="space-y-7 animate-fade-in">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-[22px] font-semibold tracking-[-0.03em] leading-none">Intelligence</h1>
            <Badge className="bg-foreground text-background rounded-full text-[11px] font-medium">AI</Badge>
          </div>
          <p className="mt-2 max-w-[58ch] text-[13px] leading-snug text-muted-foreground">
            Your AI capabilities — quiet, useful, never noisy. Enrichment, suggested replies and handling — managed by WavesCo.
          </p>
        </div>
        <Button asChild variant="outline" size="sm" className="h-8 rounded-full">
          <Link href="/system">View system</Link>
        </Button>
      </div>

      {/* Hero — premium, dark */}
      <div className="rounded-[16px] border border-[#1A1A1E] bg-[#0A0A0B] p-6 text-white shadow-card overflow-hidden relative">
        <div className="absolute inset-0 bg-gradient-to-br from-white/[0.06] via-transparent to-transparent pointer-events-none" />
        <div className="relative flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white text-black">
                <Sparkles className="h-4 w-4" />
              </span>
              <div>
                <p className="text-[13px] font-semibold tracking-tight text-white">WavesCo Intelligence</p>
                <p className="text-[11px] text-white/60">OpenAI gpt-4o-mini · Telegram · WhatsApp</p>
              </div>
            </div>
            <p className="mt-4 max-w-[52ch] text-[13px] leading-relaxed text-white/80">
              {hasAI
                ? `${data.enrichedLeads} of ${data.totalLeads} leads enriched with category, priority, summary and suggested reply. Your assistant is active.`
                : "AI quietly classifies incoming leads, drafts replies and alerts your team on Telegram. Enable cafe-leads to start."}
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Badge className="bg-white/10 text-white border-white/10 rounded-full text-[11px]">Enrichment</Badge>
              <Badge className="bg-white/10 text-white border-white/10 rounded-full text-[11px]">Suggested replies</Badge>
              <Badge className="bg-white/10 text-white border-white/10 rounded-full text-[11px]">Telegram alerts</Badge>
            </div>
          </div>
          <div className="shrink-0 rounded-[14px] border border-white/10 bg-white/5 p-4 backdrop-blur min-w-[220px]">
            <p className="text-[11px] font-medium uppercase tracking-wide text-white/60">Usage this workspace</p>
            <p className="mt-2 font-mono-data text-[22px] font-semibold tracking-tight text-white">{data.enrichedLeads} <span className="text-[13px] font-normal text-white/60">/ {data.totalLeads} leads</span></p>
            <div className="mt-3 h-1.5 w-full rounded-full bg-white/10 overflow-hidden">
              <div className="h-full bg-white rounded-full transition-all duration-700" style={{ width: `${usagePct}%` }} />
            </div>
            <p className="mt-2 text-[11px] text-white/50">{usagePct}% enriched · Plan: {data.tenant?.plan}</p>
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-12">
        <div className="space-y-6 lg:col-span-8">
          <CardShell>
            <SectionHeader
              title="Recent AI activity"
              description={hasAI ? "Enriched leads — summaries and suggested replies" : "No AI activity yet"}
              action={<Badge variant="outline" className="rounded-full text-[11px]">{data.enrichedLeads} enriched</Badge>}
            />
            {data.recentLeads.length === 0 ? (
              <EmptyState
                icon={Brain}
                title="Quiet for now"
                description="When a lead arrives, AI adds category, priority, summary and a draft reply — you just approve and send."
                className="mt-4"
              />
            ) : (
              <div className="mt-4 space-y-3">
                {data.recentLeads.map((lead) => (
                  <div key={lead.id} className="rounded-[12px] border border-border/60 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-[13px] font-medium tracking-tight">{lead.name ?? lead.phone}</p>
                        <p className="text-[11px] text-muted-foreground">{lead.category ?? "Lead"} · {lead.createdAt.toLocaleDateString()}</p>
                      </div>
                      <Badge variant="secondary" className="rounded-full text-[11px]">AI enriched</Badge>
                    </div>
                    {lead.summary ? <p className="mt-3 text-[12.5px] leading-relaxed text-muted-foreground line-clamp-2">“{lead.summary}”</p> : null}
                    {lead.suggestedReply ? (
                      <div className="mt-3 rounded-[10px] border border-border/60 bg-muted/20 px-3 py-2.5">
                        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Suggested reply</p>
                        <p className="mt-1 text-[12.5px] leading-snug">{lead.suggestedReply.slice(0, 160)}{lead.suggestedReply.length > 160 ? "…" : ""}</p>
                      </div>
                    ) : null}
                  </div>
                ))}
                <Link href="/activity" className="inline-flex text-xs font-medium text-muted-foreground hover:text-foreground">View all activity →</Link>
              </div>
            )}
          </CardShell>

          <div className="grid gap-6 md:grid-cols-2">
            <CardShell>
              <SectionHeader title="Available AI tools" description="What WavesCo provides" />
              <div className="mt-4 space-y-2.5">
                {[
                  { icon: MessageCircle, title: "Lead enrichment", desc: "Category, priority, summary, reply draft" },
                  { icon: Zap, title: "Telegram alerts", desc: "Instant alert to your team channel" },
                  { icon: Brain, title: "WhatsApp re-engagement", desc: "CRM reactivates dormant customers" },
                ].map((tool) => {
                  const Icon = tool.icon;
                  return (
                    <div key={tool.title} className="flex gap-3 rounded-[10px] border border-border/60 px-3 py-3">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border/60 bg-muted/30">
                        <Icon className="h-4 w-4 text-muted-foreground" />
                      </span>
                      <div>
                        <p className="text-[13px] font-medium tracking-tight">{tool.title}</p>
                        <p className="text-[11px] leading-snug text-muted-foreground">{tool.desc}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardShell>

            <CardShell>
              <SectionHeader title="Conversations" description="AI-handled threads" />
              <EmptyState
                icon={MessageCircle}
                title="342 conversations"
                description="Placeholder — connect WhatsApp automation to see real threads. For now, your AI handles leads."
                className="mt-4 py-7"
                action={<Badge variant="outline" className="rounded-full">Example</Badge>}
              />
              <p className="mt-3 text-[11px] text-muted-foreground">Elegant empty state instead of fake numbers — real data appears when WhatsApp is connected.</p>
            </CardShell>
          </div>
        </div>

        <div className="space-y-6 lg:col-span-4">
          <CardShell>
            <SectionHeader title="Usage & limits" description={`Plan ${data.tenant?.plan} · managed billing`} />
            <div className="mt-4 space-y-4">
              <div className="rounded-[10px] border border-border/60 px-3 py-3">
                <div className="flex items-center justify-between">
                  <span className="text-[12.5px] font-medium">Lead enrichments</span>
                  <span className="font-mono text-xs">{data.enrichedLeads} / ∞</span>
                </div>
                <p className="mt-1 text-[11px] text-muted-foreground">Included with your system — no per-call surprise.</p>
              </div>
              <div className="rounded-[10px] border border-border/60 bg-muted/20 px-3 py-3 flex gap-3">
                <Shield className="h-4 w-4 shrink-0 text-muted-foreground mt-0.5" />
                <div>
                  <p className="text-[12.5px] font-medium">Privacy-first</p>
                  <p className="text-[11px] leading-snug text-muted-foreground">Your data stays in your tenant. AI calls are tenant-scoped and audited.</p>
                </div>
              </div>
              <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                <Clock3 className="h-3.5 w-3.5" />
                Next billing review — see Billing
                <Link href="/billing" className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-foreground">Billing <ArrowUpRight className="h-3 w-3" /></Link>
              </div>
            </div>
          </CardShell>

          <CardShell className="bg-muted/20">
            <p className="text-[13px] font-medium tracking-tight">Need more AI?</p>
            <p className="mt-1 text-[12.5px] leading-snug text-muted-foreground">WavesCo configures custom assistants — menu Q&A, order help, FAQ automation — without rebuilding your system.</p>
            <Button asChild size="sm" className="mt-4 rounded-full w-full">
              <Link href="/support">Talk to WavesCo</Link>
            </Button>
          </CardShell>
        </div>
      </div>
    </div>
  );
}
