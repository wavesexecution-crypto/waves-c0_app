import type { Metadata } from "next";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { withTenantContext } from "@wavesco/db";
import { Badge, Button } from "@wavesco/ui";
import { requireTenantId } from "@/lib/tenant";
import { CardShell, SectionHeader } from "@/components/dashboard/section";
import { Building2, Users2, Shield, Bell, Plug2, Lock, Crown, UserCog, User } from "lucide-react";

export const metadata: Metadata = { title: "Settings" };

function roleBadge(role: string) {
  if (role === "owner") return { label: "Owner", icon: Crown, cls: "bg-foreground text-background border-foreground" };
  if (role === "admin") return { label: "Admin", icon: UserCog, cls: "bg-amber-500 text-white border-amber-500" };
  return { label: "Member", icon: User, cls: "bg-muted text-muted-foreground border-border" };
}

function roleDescription(role: string) {
  if (role === "owner") return "Full access · billing, modules, team, danger zone";
  if (role === "admin") return "Manage modules & data · cannot delete workspace";
  return "Read & operate · no admin changes";
}

export default async function SettingsPage() {
  const session = await auth();
  const tenantId = requireTenantId(session);
  const currentUser = session?.user as Record<string, unknown> | undefined;
  const currentRole = typeof currentUser?.role === "string" ? currentUser.role : "member";

  const data = await withTenantContext(tenantId, async (tx) => {
    const [tenant, users] = await Promise.all([
      tx.tenant.findUnique({
        where: { id: tenantId },
        select: { id: true, name: true, slug: true, plan: true, status: true, createdAt: true },
      }),
      tx.user.findMany({
        where: { tenantId },
        orderBy: { createdAt: "asc" },
        select: { id: true, email: true, name: true, role: true, status: true, createdAt: true },
      }),
    ]);
    return { tenant, users };
  });

  return (
    <div className="space-y-7 animate-fade-in">
      <div className="flex flex-col gap-2">
        <h1 className="text-[22px] font-semibold tracking-[-0.03em] leading-none">Settings</h1>
        <p className="max-w-[58ch] text-[13px] leading-snug text-muted-foreground">
          Business info, team, permissions, notifications, integrations and security — calm, Apple-like, tenant-isolated. You only ever see your organization.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-12">
        {/* Left — main */}
        <div className="space-y-6 lg:col-span-8">
          {/* Business */}
          <CardShell>
            <SectionHeader title="Business information" description="How WavesCo identifies your workspace. Managed, not decorative." />
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <div className="rounded-[10px] border border-border/60 bg-muted/20 px-4 py-3">
                <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Business name</p>
                <p className="mt-1 text-[13px] font-medium tracking-tight">{data.tenant?.name}</p>
                <p className="text-[11px] text-muted-foreground">Public display across invoices & system</p>
              </div>
              <div className="rounded-[10px] border border-border/60 bg-muted/20 px-4 py-3">
                <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Workspace slug</p>
                <p className="mt-1 font-mono text-[12px] font-medium">{data.tenant?.slug}</p>
                <p className="text-[11px] text-muted-foreground break-all">{data.tenant?.id}</p>
              </div>
              <div className="rounded-[10px] border border-border/60 bg-muted/20 px-4 py-3">
                <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Plan</p>
                <p className="mt-1 text-[13px] font-medium capitalize">{data.tenant?.plan}</p>
                <p className="text-[11px] text-muted-foreground">Since {data.tenant?.createdAt.toLocaleDateString()}</p>
              </div>
              <div className="rounded-[10px] border border-border/60 bg-muted/20 px-4 py-3">
                <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Status</p>
                <p className="mt-1 inline-flex items-center gap-1.5 text-[13px] font-medium">
                  <span className="h-2 w-2 rounded-full bg-emerald-500" />
                  {data.tenant?.status}
                </p>
                <p className="text-[11px] text-muted-foreground">Tenant-isolated · RLS enforced</p>
              </div>
            </div>
            <div className="mt-4 flex gap-2">
              <Button variant="outline" size="sm" className="h-7 rounded-full text-xs" disabled>
                Edit business info
              </Button>
              <span className="text-[11px] text-muted-foreground self-center">Contact WavesCo to update</span>
            </div>
          </CardShell>

          {/* Team */}
          <CardShell>
            <SectionHeader
              title="Team"
              description={`${data.users.length} members · you are ${currentRole} · clients only see their own organization`}
              action={<Badge variant="outline" className="rounded-full text-[11px]">{data.users.length} seats</Badge>}
            />
            <div className="mt-4 overflow-hidden rounded-[12px] border border-border/60">
              {/* Header */}
              <div className="hidden sm:grid grid-cols-[1.4fr_1.6fr_110px_90px] gap-3 bg-muted/30 px-4 py-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground border-b border-border/60">
                <span>Name</span>
                <span>Email</span>
                <span>Role</span>
                <span>Status</span>
              </div>
              <div className="divide-y divide-border/60">
                {data.users.map((user) => {
                  const r = roleBadge(user.role);
                  const Icon = r.icon;
                  const isYou = currentUser?.email === user.email;
                  return (
                    <div key={user.id} className="grid gap-2 px-4 py-3 sm:grid-cols-[1.4fr_1.6fr_110px_90px] sm:items-center">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border/60 bg-card text-[11px] font-medium">
                          {(user.name ?? user.email).slice(0, 2).toUpperCase()}
                        </span>
                        <div className="min-w-0">
                          <p className="truncate text-[13px] font-medium tracking-tight">
                            {user.name ?? "—"} {isYou ? <span className="text-[11px] font-normal text-muted-foreground">· you</span> : null}
                          </p>
                          <p className="truncate text-[11px] text-muted-foreground sm:hidden">{user.email}</p>
                        </div>
                      </div>
                      <span className="hidden sm:block truncate font-mono text-[12px] text-muted-foreground">{user.email}</span>
                      <span className="inline-flex sm:justify-start">
                        <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[11px] font-medium leading-none ${r.cls}`}>
                          <Icon className="h-3 w-3" />
                          {r.label}
                        </span>
                      </span>
                      <span className="flex items-center justify-between sm:justify-start gap-2">
                        <span className={`inline-flex rounded-full px-2 py-1 text-[11px] font-medium ${user.status === "active" ? "bg-emerald-50 text-emerald-700 border border-emerald-200/60 dark:bg-emerald-950/30 dark:text-emerald-300" : "bg-muted text-muted-foreground border border-border/60"}`}>
                          {user.status}
                        </span>
                        <span className="sm:hidden text-[11px] text-muted-foreground">{user.role}</span>
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="mt-4 rounded-[10px] border border-border/60 bg-muted/20 px-4 py-3 space-y-2">
              <p className="text-[12px] font-medium flex items-center gap-2">
                <Shield className="h-3.5 w-3.5 text-muted-foreground" />
                Permissions
              </p>
              <div className="grid gap-2 text-[11px] leading-snug text-muted-foreground sm:grid-cols-3">
                <div>
                  <span className="font-medium text-foreground">Owner</span>
                  <p>{roleDescription("owner")}</p>
                </div>
                <div>
                  <span className="font-medium text-foreground">Admin</span>
                  <p>{roleDescription("admin")}</p>
                </div>
                <div>
                  <span className="font-medium text-foreground">Member</span>
                  <p>{roleDescription("member")}</p>
                </div>
              </div>
              <p className="text-[11px] text-muted-foreground border-t border-border/40 pt-2">
                WavesCo internal users never appear in your team list — strict tenant isolation, enforced by <span className="font-mono">withTenantContext + RLS</span>.
              </p>
            </div>
          </CardShell>

          {/* Permissions detail */}
          <CardShell>
            <SectionHeader title="Permissions & boundaries" description="Clear distinction, no weakening of auth" />
            <div className="mt-4 space-y-3 text-[12.5px] leading-relaxed">
              <div className="flex gap-3 rounded-[10px] border border-border/60 px-4 py-3">
                <Crown className="h-4 w-4 text-foreground mt-0.5 shrink-0" />
                <div>
                  <p className="font-medium tracking-tight">You are {currentRole}</p>
                  <p className="text-muted-foreground">{roleDescription(currentRole)} · Tenant {data.tenant?.slug} — you only see your data.</p>
                </div>
              </div>
              <div className="rounded-[10px] border border-dashed border-border/60 bg-muted/20 px-4 py-3">
                <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Security guarantee</p>
                <p className="mt-1 text-[12px] leading-snug text-muted-foreground">
                  Authentication via Auth.js v5 (JWT carries tenantId+role). Every DB query runs inside <span className="font-mono">withTenantContext(tenantId)</span> with{" "}
                  <span className="font-mono">SET LOCAL app.tenant_id</span> and PostgreSQL RLS. No cross-tenant leaks — by design.
                </p>
              </div>
            </div>
          </CardShell>
        </div>

        {/* Right — controls */}
        <div className="space-y-6 lg:col-span-4">
          <CardShell>
            <SectionHeader title="Notifications" description="What reaches your team" />
            <div className="mt-4 space-y-2">
              {[
                { label: "New lead", desc: "Telegram · Email", enabled: true },
                { label: "Order received", desc: "In-app · Audit", enabled: true },
                { label: "Low stock", desc: "In-app alert", enabled: true },
                { label: "Weekly briefing", desc: "Email · Cafe Ops", enabled: false },
              ].map((n) => (
                <div key={n.label} className="flex items-center justify-between rounded-[10px] border border-border/60 px-3 py-2.5">
                  <div>
                    <p className="text-[12.5px] font-medium tracking-tight flex items-center gap-1.5">
                      <Bell className="h-3.5 w-3.5 text-muted-foreground" /> {n.label}
                    </p>
                    <p className="text-[11px] text-muted-foreground">{n.desc}</p>
                  </div>
                  <span className={`h-5 w-9 rounded-full p-0.5 flex items-center transition-colors ${n.enabled ? "bg-foreground justify-end" : "bg-muted justify-start"}`}>
                    <span className="h-4 w-4 rounded-full bg-white shadow-sm" />
                  </span>
                </div>
              ))}
            </div>
            <p className="mt-3 text-[11px] text-muted-foreground">Toggles are preview — wiring to real preferences is next.</p>
          </CardShell>

          <CardShell>
            <SectionHeader title="Integrations" description="Credentials — env-driven, module-gated" />
            <div className="mt-4 space-y-2">
              {[
                { name: "Resend", desc: "Magic-link email", env: "RESEND_API_KEY", ok: false },
                { name: "OpenAI", desc: "Lead enrichment", env: "OPENAI_API_KEY", ok: false },
                { name: "Telegram", desc: "Alerts", env: "TELEGRAM_BOT_TOKEN", ok: false },
                { name: "WhatsApp", desc: "Re-engagement", env: "WHATSAPP_API_KEY", ok: false },
                { name: "Swiggy / Zomato", desc: "Order webhooks", env: "SWIGGY_SECRET", ok: false },
              ].map((i) => (
                <div key={i.name} className="flex items-center gap-3 rounded-[10px] border border-border/60 px-3 py-2.5">
                  <span className="flex h-7 w-7 items-center justify-center rounded-[8px] border border-border/60 bg-muted/30">
                    <Plug2 className="h-3.5 w-3.5 text-muted-foreground" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[12.5px] font-medium tracking-tight">{i.name}</p>
                    <p className="text-[11px] text-muted-foreground truncate">
                      {i.desc} · <span className="font-mono">{i.env}</span>
                    </p>
                  </div>
                  <span className={`h-2 w-2 rounded-full ${i.ok ? "bg-emerald-500" : "bg-muted-foreground/30"}`} title={i.ok ? "Configured" : "Not set"} />
                </div>
              ))}
            </div>
            <p className="mt-3 rounded-[9px] border border-border/60 bg-muted/20 px-3 py-2 text-[11px] leading-snug text-muted-foreground">
              Credentials live in <span className="font-mono">.env</span> — modules refuse to enable if keys are missing (loud failure, not silent).
            </p>
          </CardShell>

          <CardShell>
            <SectionHeader title="Security" description="Account & access" />
            <div className="mt-4 space-y-3">
              <div className="rounded-[10px] border border-border/60 px-3 py-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Lock className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <p className="text-[12.5px] font-medium">Password</p>
                    <p className="text-[11px] text-muted-foreground">Auth.js credentials · bcrypt</p>
                  </div>
                </div>
                <Button variant="outline" size="sm" className="h-7 rounded-full text-xs" asChild>
                  <Link href="/reset">Reset</Link>
                </Button>
              </div>
              <div className="rounded-[10px] border border-dashed border-border/60 bg-muted/20 px-3 py-3">
                <p className="text-[12.5px] font-medium">Two-factor</p>
                <p className="text-[11px] text-muted-foreground">Coming — for owners & admins.</p>
              </div>
              <div className="rounded-[10px] border border-border/60 bg-card px-3 py-2.5">
                <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Session</p>
                <p className="font-mono text-[11px] break-all text-muted-foreground">JWT · tenantId {data.tenant?.id.slice(0, 12)}… · role {currentRole}</p>
              </div>
            </div>
          </CardShell>

          <CardShell className="bg-muted/20">
            <p className="text-[13px] font-medium tracking-tight flex items-center gap-2">
              <Users2 className="h-4 w-4" /> Need more seats?
            </p>
            <p className="mt-1 text-[12px] leading-snug text-muted-foreground">Owners can invite members — WavesCo provisions the tenant and managed billing.</p>
            <Button variant="outline" size="sm" className="mt-3 w-full rounded-full" disabled>
              Invite member — soon
            </Button>
          </CardShell>
        </div>
      </div>
    </div>
  );
}

