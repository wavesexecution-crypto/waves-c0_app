import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { requireTenantId } from "@/lib/tenant";
import { withTenantContext } from "@wavesco/db";
import { getLead } from "@/lib/wavesco/lead-engine";
import { LeadOutreachForm } from "@/components/acquisition/outreach-form";

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
      <div className="flex justify-between gap-4 border-b py-1.5 text-sm last:border-0">
        <span className="text-muted-foreground">{label}</span>
        <span className="text-muted-foreground/60">—</span>
      </div>
    );
  }
  return (
    <div className="flex justify-between gap-4 border-b py-1.5 text-sm last:border-0">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="text-right">{value}</span>
    </div>
  );
}

export default async function LeadProfilePage({ params }: PageProps) {
  const session = await auth();
  const tenantId = requireTenantId(session);
  const { nameKey: rawKey } = await params;
  const nameKey = decodeURIComponent(rawKey);

  const lead = (() => {
    try {
      return getLead(nameKey);
    } catch {
      return undefined;
    }
  })();
  if (!lead) notFound();

  const { emails, followUps } = await withTenantContext(tenantId, async (tx) => ({
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
          <Link href="/acquisition/leads" className="text-xs text-muted-foreground hover:underline">
            ← Leads
          </Link>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">{lead.business}</h1>
          <p className="text-sm text-muted-foreground">
            {[lead.category, lead.area, lead.city].filter(Boolean).join(" · ") || "—"}
            {" · "}
            batch {lead.batch_id ?? "—"}
          </p>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <div className="rounded-lg border px-3 py-2 text-center">
            <p className="text-[11px] uppercase text-muted-foreground">Score</p>
            <p className="text-xl font-semibold tabular-nums">{lead.lead_score ?? "—"}</p>
          </div>
          <div className="rounded-lg border px-3 py-2 text-center">
            <p className="text-[11px] uppercase text-muted-foreground">Digital</p>
            <p className="text-xl font-semibold tabular-nums">{lead.digital_score ?? "—"}</p>
          </div>
          <div className="rounded-lg border px-3 py-2 text-center">
            <p className="text-[11px] uppercase text-muted-foreground">Tier</p>
            <p className="text-xl font-semibold">{lead.tier ?? "—"}</p>
          </div>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        {/* Contact + research */}
        <section className="space-y-4">
          <div className="rounded-lg border bg-card p-4">
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-widest text-muted-foreground">Contact</h2>
            <Row label="Phone" value={lead.phone} />
            <Row label="WhatsApp" value={lead.whatsapp} />
            <Row
              label="Email"
              value={
                lead.email ? (
                  <span className="font-mono text-xs">
                    {lead.email}
                    {lead.email_status ? ` · ${lead.email_status}` : ""}
                  </span>
                ) : null
              }
            />
            <Row label="Website" value={lead.website ? <a className="hover:underline" href={lead.website} target="_blank" rel="noreferrer noopener">{lead.website}</a> : null} />
            <Row label="Instagram" value={lead.instagram} />
            <Row label="Rating" value={lead.rating != null ? `${lead.rating} (${lead.reviews ?? "?"} reviews)` : null} />
            <Row label="Site class" value={lead.site_class} />
            <Row label="Verification" value={lead.verification} />
          </div>

          <div className="rounded-lg border bg-card p-4">
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-widest text-muted-foreground">Research (engine output)</h2>
            {[
              ["Problem", lead.problem],
              ["Opportunity", lead.opportunity],
              ["Reason", lead.reason],
              ["Outreach angle", lead.outreach_angle],
            ].map(([label, val]) =>
              val ? (
                <div key={label} className="border-b py-2 text-sm last:border-0">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
                  <p className="mt-0.5 whitespace-pre-line">{val}</p>
                </div>
              ) : null,
            )}
            {sourceUrls.length > 0 ? (
              <div className="pt-2">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Source URLs</p>
                <ul className="mt-1 space-y-1 text-xs">
                  {sourceUrls.map((u) => (
                    <li key={u} className="truncate">
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

          <div className="rounded-lg border bg-card p-4">
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-widest text-muted-foreground">Platform history</h2>
            {emails.length === 0 && followUps.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">
                No campaigns, queued emails or follow-ups touch this lead yet.
              </p>
            ) : (
              <>
                {emails.map((e) => (
                  <div key={e.id} className="flex items-center justify-between border-b py-1.5 text-sm last:border-0">
                    <span className="truncate">
                      Email → <span className="font-mono text-xs">{e.email}</span>
                    </span>
                    <span className="text-xs text-muted-foreground">{e.status}</span>
                  </div>
                ))}
                {followUps.map((f) => (
                  <div key={f.id} className="flex items-center justify-between border-b py-1.5 text-sm last:border-0">
                    <span>Follow-up · {f.dueAt.toISOString().slice(0, 10)}</span>
                    <span className="text-xs text-muted-foreground">{f.status}</span>
                  </div>
                ))}
              </>
            )}
          </div>

          <div className="rounded-lg border bg-card p-4 text-xs text-muted-foreground">
            First discovered {lead.first_discovered ?? "—"} · last researched {lead.last_researched ?? "—"} ·
            contacted {lead.date_contacted ?? "never"}
          </div>
        </section>
      </div>
    </div>
  );
}
