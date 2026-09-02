import { auth } from "@/lib/auth";
import { requireTenantId } from "@/lib/tenant";
import { withTenantContext } from "@wavesco/db";
import { readinessCheck, buildAgentContext } from "@/lib/wavesco/acquisition-profile";
import { getIntegrationsHealth } from "@/lib/wavesco/integrations";
import { MetricCard, SectionHeader, StatusPill } from "@/components/command/primitives";
import { AutoRefresh } from "@/components/command/auto-refresh";
import { ProfileLifecycleControls, ProfileQuickForm, DataImportControl } from "@/components/acquisition/profile-controls";
import Link from "next/link";

export const dynamic = "force-dynamic";

function pill(status: string): "live" | "error" | "disconnected" | "pending" {
  const s = status.toUpperCase();
  if (s === "ACTIVE") return "live";
  if (s === "READY") return "live";
  if (s === "PAUSED") return "pending";
  if (s === "SUSPENDED") return "error";
  if (s === "INCOMPLETE") return "disconnected";
  return "disconnected";
}

export default async function AcquisitionProfilePage() {
  const session = await auth();
  const tenantId = requireTenantId(session as any);

  let profile: any = null;
  let imports: any[] = [];
  let readiness: ReturnType<typeof readinessCheck> = readinessCheck(null);
  let integrationsHealth: any = null;
  let agentPreview: any = null;
  let dbError: string | null = null;

  try {
    const data = await withTenantContext(tenantId, async (tx: any) => {
      const p = await (tx as any).acquisitionProfile.findFirst({
        where: { tenantId },
        include: { dataImports: { orderBy: { createdAt: "desc" }, take: 5 } },
      });
      const imps = p ? await (tx as any).acquisitionDataImport.findMany({ where: { tenantId, profileId: p.id }, orderBy: { createdAt: "desc" }, take: 5 }) : [];
      return { p, imps };
    });
    profile = data.p;
    imports = data.imps;
    readiness = readinessCheck(profile);
  } catch (e) {
    dbError = e instanceof Error ? e.message : String(e);
  }

  try {
    integrationsHealth = await getIntegrationsHealth(tenantId);
  } catch {}

  try {
    agentPreview = await buildAgentContext(tenantId, profile as any, { integrationsHealth });
  } catch {}

  const status = profile?.status ?? readiness.status;

  return (
    <div className="space-y-6 p-6">
      <AutoRefresh intervalMs={15000} />
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Acquisition OS — Company Profile</h1>
          <p className="text-sm text-muted-foreground">Choose. Rent. Operate. — one OS, no tiers. Provide business context; the OS operates.</p>
          <div className="mt-2 flex items-center gap-2">
            <StatusPill state={pill(status)} label={status} />
            <span className="text-xs text-muted-foreground">v{profile?.version ?? 0} · {tenantId.slice(0, 8)}… tenant-isolated</span>
            <Link href="/acquisition" className="text-xs text-primary hover:underline ml-2">
              ← Overview
            </Link>
          </div>
        </div>
        <ProfileLifecycleControls status={status} ready={readiness.ready} />
      </div>

      {dbError && (
        <div className="border border-destructive/50 bg-destructive/10 rounded-md p-3 text-sm">
          DB error: {dbError} <Link href="/system" className="underline ml-2">System → Retry</Link>
        </div>
      )}

      {/* Readiness */}
      <section className="border rounded-lg p-4 bg-card">
        <SectionHeader title="ACQUISITION OS — Readiness" subtitle={readiness.ready ? "Ready to operate" : "Complete required fields to activate"} />
        <div className="grid md:grid-cols-2 gap-4 mt-3">
          <div>
            <h4 className="text-sm font-medium mb-2">Ready checklist</h4>
            <ul className="space-y-1 text-sm">
              {readiness.present.map((x) => (
                <li key={x} className="flex items-center gap-2">
                  <span className="text-green-600">✓</span> {x}
                </li>
              ))}
              {readiness.missing.map((x) => (
                <li key={x} className="flex items-center gap-2 text-muted-foreground">
                  <span>○</span> {x} <span className="text-xs border rounded px-1">missing</span>
                </li>
              ))}
            </ul>
            {!readiness.ready && <p className="text-xs text-muted-foreground mt-2">Activation blocked until all ✓. Optional fields never block.</p>}
            {readiness.ready && status !== "ACTIVE" && <p className="text-xs text-green-600 mt-2">All required present — you can Activate.</p>}
            {status === "ACTIVE" && <p className="text-xs text-primary mt-2">OS is ACTIVE — Nemotron is orchestrating Discover → Enrich → Verify → Qualify → Score → Segment → Outreach → Follow-up → Analyze.</p>}
          </div>
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-3">
              <MetricCard label="Status" value={status} />
              <MetricCard label="Ready" value={readiness.ready ? "Yes" : "No"} />
              <MetricCard label="Present" value={`${readiness.present.length}/${readiness.required.length}`} />
              <MetricCard label="Imports" value={`${imports.length}`} />
            </div>
            <div className="text-xs text-muted-foreground">
              Deterministic validator — no AI. Required: {readiness.required.join(", ")}
            </div>
          </div>
        </div>
      </section>

      {/* 8 sections — Company → Objective → ICP → Data → Offer → Brand → Integrations → Rules */}
      <div className="grid gap-6 md:grid-cols-2">
        <ProfileQuickForm
          title="1 — Company"
          initial={
            profile
              ? {
                  companyName: profile.companyName,
                  website: profile.website,
                  industry: profile.industry,
                  whatWeSell: profile.whatWeSell,
                  businessModel: profile.businessModel,
                }
              : {}
          }
          fields={[
            { key: "companyName", label: "Company name", placeholder: "WavesCo Pvt Ltd" },
            { key: "website", label: "Website", placeholder: "https://wavesco.in" },
            { key: "industry", label: "Industry", placeholder: "B2B SaaS / Cafe / Agency" },
            { key: "whatWeSell", label: "What the company sells", placeholder: "Operating system installs for founder-led companies", type: "textarea" },
            { key: "businessModel", label: "Business model (B2B/B2C)", placeholder: "B2B" },
          ]}
        />

        <ProfileQuickForm
          title="2 — Acquisition Objective"
          initial={
            profile
              ? {
                  acquisitionObjective: profile.acquisitionObjective,
                  primaryObjective: profile.primaryObjective,
                  targetQuantity: profile.targetQuantity,
                  targetTimeframe: profile.targetTimeframe,
                  priorityProductService: profile.priorityProductService,
                }
              : {}
          }
          fields={[
            { key: "acquisitionObjective", label: "What to acquire", placeholder: "Leads / Meetings / Customers / Sales" },
            { key: "primaryObjective", label: "Primary objective", placeholder: "30 qualified leads" },
            { key: "targetQuantity", label: "Target quantity", placeholder: "30", type: "number" },
            { key: "targetTimeframe", label: "Target timeframe", placeholder: "30 days" },
            { key: "priorityProductService", label: "Priority product/service", placeholder: "Acquisition OS rental" },
          ]}
        />

        <ProfileQuickForm
          title="3 — Ideal Customer Profile"
          initial={
            profile
              ? {
                  "icp.targetCustomer": (profile.icp as any)?.targetCustomer,
                  "icp.b2bB2c": (profile.icp as any)?.b2bB2c,
                  "icp.industry": (profile.icp as any)?.industry,
                  "icp.companySize": (profile.icp as any)?.companySize,
                  "icp.decisionMakerTitles": (profile.icp as any)?.decisionMakerTitles,
                  "icp.geography": (profile.icp as any)?.geography,
                  "icp.characteristics": (profile.icp as any)?.characteristics,
                  "icp.buyingSignals": (profile.icp as any)?.buyingSignals,
                  "icp.disqualifiers": (profile.icp as any)?.disqualifiers,
                }
              : {}
          }
          fields={[
            { key: "icp.targetCustomer", label: "Target customer", placeholder: "Founder-led companies, 5-50 employees" },
            { key: "icp.b2bB2c", label: "B2B/B2C", placeholder: "B2B" },
            { key: "icp.industry", label: "Target industry/category", placeholder: "Professional services, F&B, retail" },
            { key: "icp.companySize", label: "Company size", placeholder: "5-50 employees" },
            { key: "icp.decisionMakerTitles", label: "Decision-maker titles", placeholder: "Founder, Owner, CEO" },
            { key: "icp.geography", label: "Geography", placeholder: "Navi Mumbai — Vashi, Nerul, Ulwe" },
            { key: "icp.characteristics", label: "Customer characteristics", placeholder: "Uses WhatsApp for ops, has website" },
            { key: "icp.buyingSignals", label: "Buying signals", placeholder: "Hiring, new outlet, fundraising" },
            { key: "icp.disqualifiers", label: "Disqualifiers", placeholder: "Enterprise >500, government" },
          ]}
        />

        <ProfileQuickForm
          title="5 — Offer"
          initial={
            profile
              ? {
                  "offer.productService": (profile.offer as any)?.productService,
                  "offer.pricing": (profile.offer as any)?.pricing,
                  "offer.valueProp": (profile.offer as any)?.valueProp,
                  "offer.promotions": (profile.offer as any)?.promotions,
                  "offer.cta": (profile.offer as any)?.cta,
                  "offer.differentiators": (profile.offer as any)?.differentiators,
                  "offer.proof": (profile.offer as any)?.proof,
                }
              : {}
          }
          fields={[
            { key: "offer.productService", label: "Product/service promoted", placeholder: "Acquisition OS — rent & operate" },
            { key: "offer.pricing", label: "Pricing/range", placeholder: "₹25k/mo, no tier gating" },
            { key: "offer.valueProp", label: "Value proposition", placeholder: "Founder stops doing midnight reconciliation" },
            { key: "offer.cta", label: "CTA", placeholder: "Book Architecture Review — cal.com/wavesco.in" },
            { key: "offer.differentiators", label: "Differentiators", placeholder: "Boring is a feature — boring, reliable OS" },
            { key: "offer.proof", label: "Proof / case studies", placeholder: "Vidya Sindhu NGO, cafe chain 4 outlets", type: "textarea" },
            { key: "offer.promotions", label: "Promotions", placeholder: "First month implementation free" },
          ]}
        />

        <ProfileQuickForm
          title="6 — Brand + Communication"
          initial={
            profile
              ? {
                  "brand.brandInfo": (profile.brand as any)?.brandInfo,
                  "brand.toneOfVoice": (profile.brand as any)?.toneOfVoice,
                  "brand.messagingPrefs": (profile.brand as any)?.messagingPrefs,
                  "brand.avoidSaying": (profile.brand as any)?.avoidSaying,
                  "brand.claimsProof": (profile.brand as any)?.claimsProof,
                }
              : {}
          }
          fields={[
            { key: "brand.brandInfo", label: "Brand information", placeholder: "WavesCo — boring, reliable, no jazz", type: "textarea" },
            { key: "brand.toneOfVoice", label: "Tone of voice", placeholder: "Direct, plain English, expert but not glossy" },
            { key: "brand.messagingPrefs", label: "Messaging preferences", placeholder: "Short sentences, no buzzwords" },
            { key: "brand.avoidSaying", label: "Must avoid saying", placeholder: "Never promise guaranteed leads" },
            { key: "brand.claimsProof", label: "Claims / proof to use", placeholder: "Show audit cycle, not marketing fluff" },
          ]}
        />

        <ProfileQuickForm
          title="8 — Rules + Constraints"
          initial={
            profile
              ? {
                  "rules.geoRestrictions": (profile.rules as any)?.geoRestrictions,
                  "rules.industriesExclude": (profile.rules as any)?.industriesExclude,
                  "rules.customerTypesExclude": (profile.rules as any)?.customerTypesExclude,
                  "rules.outreachRestrictions": (profile.rules as any)?.outreachRestrictions,
                  "rules.approvalRequirements": (profile.rules as any)?.approvalRequirements,
                  "rules.complianceConstraints": (profile.rules as any)?.complianceConstraints,
                }
              : {}
          }
          fields={[
            { key: "rules.geoRestrictions", label: "Geographic restrictions", placeholder: "Only Navi Mumbai, exclude Pune" },
            { key: "rules.industriesExclude", label: "Industries to exclude", placeholder: "Gambling, adult" },
            { key: "rules.customerTypesExclude", label: "Customer types to exclude", placeholder: "Govt, >500 employees" },
            { key: "rules.outreachRestrictions", label: "Outreach restrictions", placeholder: "No calls after 8pm, max 2 follow-ups" },
            { key: "rules.approvalRequirements", label: "Approval requirements", placeholder: "All outreach requires approval" },
            { key: "rules.complianceConstraints", label: "Compliance constraints", placeholder: "Do not email @gov.in" },
          ]}
        />

        <ProfileQuickForm
          title="7 — Existing Infrastructure (refs only, no secrets)"
          initial={
            profile
              ? {
                  "integrations.crm": (profile.integrations as any)?.crm,
                  "integrations.email": (profile.integrations as any)?.email,
                  "integrations.calendar": (profile.integrations as any)?.calendar,
                  "integrations.website": (profile.integrations as any)?.website,
                  "integrations.whatsapp": (profile.integrations as any)?.whatsapp,
                  "integrations.other": (profile.integrations as any)?.other,
                }
              : {}
          }
          fields={[
            { key: "integrations.crm", label: "CRM", placeholder: "HubSpot / Sheets / none — ref only" },
            { key: "integrations.email", label: "Email (sending)", placeholder: "Brevo / Resend — configured via env, not here" },
            { key: "integrations.calendar", label: "Calendar", placeholder: "Google Calendar" },
            { key: "integrations.website", label: "Website", placeholder: "https://wavesco.in" },
            { key: "integrations.whatsapp", label: "WhatsApp", placeholder: "WABA number — if supported" },
            { key: "integrations.other", label: "Other", placeholder: "n8n, Supabase, Neon — health in Integrations" },
          ]}
        />

        <DataImportControl profileId={profile?.id} />
      </div>

      {/* Integrations health — masked, never leaks keys */}
      <section className="border rounded-lg p-4 bg-card">
        <SectionHeader title="Infrastructure health — masked" subtitle="Uses existing Integrations matrix; never stores raw keys in profile" />
        <div className="grid md:grid-cols-3 gap-3 mt-3 text-sm">
          {integrationsHealth ? (
            Object.entries(integrationsHealth as any).map(([k, v]: any) => (
              <div key={k} className="border rounded p-2">
                <div className="font-medium">{k}</div>
                <div className="text-xs text-muted-foreground">
                  {(v as any)?.status ?? "unknown"} — {(v as any)?.detail ?? ""}
                </div>
              </div>
            ))
          ) : (
            <div className="text-muted-foreground">Health unavailable</div>
          )}
        </div>
        <Link href="/acquisition/integrations" className="text-sm text-primary hover:underline mt-2 inline-block">
          Test connections → Integrations
        </Link>
      </section>

      {/* Acquisition Brief — review */}
      <section className="border rounded-lg p-4 bg-card">
        <SectionHeader title="ACQUISITION BRIEF — review" subtitle="Structured context supplied to Nemotron 3 Super (masked)" />
        <pre className="mt-3 text-xs bg-muted p-3 rounded overflow-auto max-h-96">
          {JSON.stringify(
            {
              company: {
                name: profile?.companyName ?? null,
                website: profile?.website ?? null,
                industry: profile?.industry ?? null,
                whatWeSell: profile?.whatWeSell ?? null,
                businessModel: profile?.businessModel ?? null,
              },
              objective: {
                acquisitionObjective: profile?.acquisitionObjective ?? null,
                primaryObjective: profile?.primaryObjective ?? null,
                targetQuantity: profile?.targetQuantity ?? null,
                targetTimeframe: profile?.targetTimeframe ?? null,
              },
              icp: profile?.icp ?? null,
              offer: profile?.offer ?? null,
              brand: profile?.brand ?? null,
              integrations: profile?.integrations ?? null,
              rules: profile?.rules ?? null,
              status,
              readiness,
            },
            null,
            2
          )}
        </pre>
        <div className="mt-2 text-xs text-muted-foreground">Never exposes provider credentials to browser; credentialRef → env:VAR only.</div>
      </section>

      {/* Agent context preview */}
      <section className="border rounded-lg p-4 bg-card">
        <SectionHeader title="Agent context — Nemotron 3 Super" subtitle="Deterministic services execute; model reasons & orchestrates" />
        <p className="text-xs text-muted-foreground mt-1">Flow: Company → Objective → ICP → Data → Offer → Brand → Integrations → Rules → Brief → Operational Context → Nemotron → Discover → Enrich → Verify → Qualify → Score → Segment → Outreach → Follow-up → Analyze → Optimize</p>
        <pre className="mt-3 text-xs bg-muted p-3 rounded overflow-auto max-h-96">
          {agentPreview ? JSON.stringify(agentPreview, null, 2) : "No context — create profile first"}
        </pre>
        <Link href="/api/acquisition/profile/context" className="text-xs text-primary hover:underline mt-2 inline-block" target="_blank">
          Open /api/acquisition/profile/context (tenant-scoped, masked)
        </Link>
      </section>

      {/* Imports */}
      {imports.length > 0 && (
        <section className="border rounded-lg p-4 bg-card">
          <SectionHeader title="Data imports" subtitle={`${imports.length} recorded`} />
          <ul className="mt-2 text-sm space-y-1">
            {imports.map((imp: any) => (
              <li key={imp.id} className="flex justify-between border-b py-1">
                <span>
                  {imp.fileName} · {imp.fileType} · {imp.rowCount ?? "—"} rows · {imp.status}
                </span>
                <span className="text-xs text-muted-foreground">{new Date(imp.createdAt).toLocaleString()}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
