import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { requireTenantId } from "@/lib/tenant";
import { withTenantContext } from "@wavesco/db";
import { getLead } from "@/lib/wavesco/lead-engine";
import { LeadOutreachForm } from "@/components/acquisition/outreach-form";
import { LeadDetailActions } from "@/components/acquisition/lead-detail-actions";
import { ConversionPanel } from "@/components/acquisition/conversion-panel";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ nameKey: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { nameKey } = await params;
  return { title: `Lead · ${decodeURIComponent(nameKey)}` };
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  if (value === null || value === undefined || value === "") {
    return (
      <div className="flex justify-between gap-4 border-b border-border/60 py-2 last:border-0">
        <span className="shrink-0 font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">{label}</span>
        <span className="font-mono text-[11px] text-muted-foreground/60">—</span>
      </div>
    );
  }
  return (
    <div className="flex justify-between gap-4 border-b border-border/60 py-2 last:border-0">
      <span className="shrink-0 font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">{label}</span>
      <span className="text-right font-sans text-[13px] tracking-[-0.01em]">{value}</span>
    </div>
  );
}

export default async function LeadProfilePage({ params }: PageProps) {
  const session = await auth();
  const tenantId = requireTenantId(session);
  const { nameKey: rawKey } = await params;
  const nameKey = decodeURIComponent(rawKey);

  const lead = await getLead(nameKey).catch(() => undefined);
  if (!lead) notFound();

  const { emails, followUps, conversion, conversation } = await withTenantContext(tenantId, async (tx) => ({
    emails: await tx.outreachEmail.findMany({
      where: { tenantId, leadKey: nameKey },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
    followUps: await tx.followUp.findMany({
      where: { tenantId, leadKey: nameKey },
      orderBy: { dueAt: "desc" },
      take: 10,
    }),
    conversion: await tx.leadConversion.findUnique({
      where: { tenantId_leadKey: { tenantId, leadKey: nameKey } },
    }).catch(() => null),
    conversation: await tx.conversation.findUnique({
      where: { tenantId_leadKey: { tenantId, leadKey: nameKey } },
      select: { id: true, status: true },
    }).catch(() => null),
  }));

  const sourceUrls: string[] = (() => {
    try {
      const parsed = JSON.parse(lead.source_urls ?? "[]") as unknown;
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return [];
    }
  })();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/acquisition/leads" className="font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground hover:text-foreground hover:underline">
            ← Leads
          </Link>
          <h1 className="mt-1 font-display text-[22px] font-semibold tracking-[-0.02em] text-foreground">{lead.business}</h1>
          <p className="mt-1 font-sans text-[13px] leading-5 text-muted-foreground">
            {[lead.category, lead.area, lead.city].filter(Boolean).join(" · ") || "—"}
            {" · "}
            <span className="font-mono text-[11px] tracking-[0.02em]">batch {lead.batch_id ?? "—"}</span>
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="rounded-lg border border-border/80 bg-card px-3 py-2 text-center">
            <p className="font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">Score</p>
            <p className="font-mono text-[20px] font-medium leading-none tracking-[-0.02em] tabular-nums">{lead.lead_score ?? "—"}</p>
          </div>
          <div className="rounded-lg border border-border/80 bg-card px-3 py-2 text-center">
            <p className="font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">Digital</p>
            <p className="font-mono text-[20px] font-medium leading-none tracking-[-0.02em] tabular-nums">{lead.digital_score ?? "—"}</p>
          </div>
          <div className="rounded-lg border border-border/80 bg-card px-3 py-2 text-center">
            <p className="font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">Tier</p>
            <p className="font-mono text-[20px] font-medium leading-none tracking-[-0.02em]">{lead.tier ?? "—"}</p>
          </div>
        </div>
      </div>

      {/* Lead Control — Enrich / Verify / Qualify / Score (tenant-scoped, audited, idempotent) */}
      <div className="rounded-lg border border-border/80 bg-card p-4">
        <h2 className="mb-3 font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">Lead Control</h2>
        <LeadDetailActions nameKey={nameKey} />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        {/* Contact + research */}
        <section className="space-y-4">
          <div className="rounded-lg border border-border/80 bg-card p-4">
            <h2 className="mb-3 font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">Contact</h2>
            <Row label="Phone" value={lead.phone} />
            <Row label="WhatsApp" value={lead.whatsapp} />
            <Row
              label="Email"
              value={
                lead.email ? (
                  <span className="font-mono text-[13px] tracking-[-0.005em]">
                    {lead.email}
                    {lead.email_status ? <span className="font-mono text-[11px] tracking-[0.02em] text-muted-foreground"> · {lead.email_status}</span> : ""}
                  </span>
                ) : null
              }
            />
            <Row label="Website" value={lead.website ? <a className="font-sans text-[13px] hover:underline" href={lead.website} target="_blank" rel="noreferrer noopener">{lead.website}</a> : null} />
            <Row label="Instagram" value={lead.instagram} />
            <Row label="Rating" value={lead.rating != null ? `${lead.rating} (${lead.reviews ?? "?"} reviews)` : null} />
            <Row label="Site class" value={lead.site_class} />
            <Row label="Verification" value={lead.verification} />
          </div>

          <div className="rounded-lg border border-border/80 bg-card p-4">
            <h2 className="mb-3 font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">Research (engine output)</h2>
            {[
              ["Problem", lead.problem],
              ["Opportunity", lead.opportunity],
              ["Reason", lead.reason],
              ["Outreach angle", lead.outreach_angle],
            ].map(([label, val]) =>
              val ? (
                <div key={label} className="border-b border-border/60 py-2.5 last:border-0">
                  <p className="font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">{label}</p>
                  <p className="mt-1 font-sans text-[13px] leading-5 whitespace-pre-line">{val}</p>
                </div>
              ) : null,
            )}
            {sourceUrls.length > 0 ? (
              <div className="pt-3">
                <p className="font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">Source URLs</p>
                <ul className="mt-1.5 space-y-1">
                  {sourceUrls.map((u) => (
                    <li key={u} className="truncate font-mono text-[11px]">
                      <a href={u} target="_blank" rel="noreferrer noopener" className="text-primary hover:underline">
                        {u}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </section>

        {/* Outreach + history */}
        <section className="space-y-4">
          <LeadOutreachForm
            nameKey={nameKey}
            emailStatus={lead.email_status}
            optedOut={(lead.opted_out ?? 0) === 1}
            bounced={(lead.bounced ?? 0) === 1}
            replyStatus={lead.reply_status}
            contacted={Boolean(lead.date_contacted)}
          />

          <div className="rounded-lg border border-border/80 bg-card p-4">
            <h2 className="mb-3 font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">Platform history</h2>
            {emails.length === 0 && followUps.length === 0 ? (
              <p className="py-4 text-center font-sans text-[13px] text-muted-foreground">
                No campaigns, queued emails or follow-ups touch this lead yet.
              </p>
            ) : (
              <>
                {emails.map((e) => (
                  <div key={e.id} className="flex items-center justify-between border-b border-border/60 py-2 last:border-0">
                    <span className="truncate font-sans text-[13px]">
                      Email → <span className="font-mono text-[11px] tracking-[-0.005em]">{e.email}</span>
                    </span>
                    <span className="font-mono text-[11px] tracking-[0.02em] text-muted-foreground">{e.status}</span>
                  </div>
                ))}
                {followUps.map((f) => (
                  <div key={f.id} className="flex items-center justify-between border-b border-border/60 py-2 last:border-0">
                    <span className="font-sans text-[13px]">Follow-up · <span className="font-mono text-[11px] tabular-nums">{f.dueAt.toISOString().slice(0, 10)}</span></span>
                    <span className="font-mono text-[11px] tracking-[0.02em] text-muted-foreground">{f.status}</span>
                  </div>
                ))}
              </>
            )}
          </div>

          <div className="rounded-lg border border-border/80 bg-card p-4 font-mono text-[11px] tracking-[0.02em] text-muted-foreground">
            First discovered {lead.first_discovered ?? "—"} · last researched {lead.last_researched ?? "—"} ·
            contacted {lead.date_contacted ?? "never"}
            {conversation && (
              <> · <Link href={`/acquisition/replies?thread=${conversation.id}`} className="underline underline-offset-2 hover:text-foreground">conversation: {conversation.status.toLowerCase()}</Link></>
            )}
          </div>

          <ConversionPanel
            leadKey={nameKey}
            businessName={lead.business}
            initial={conversion ? { state: conversion.state, note: conversion.note ?? null, updatedAt: new Date(conversion.updatedAt).toISOString() } : null}
          />
        </section>
      </div>
    </div>
  );
}
