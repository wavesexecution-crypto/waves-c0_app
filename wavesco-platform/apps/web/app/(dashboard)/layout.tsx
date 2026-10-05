import type { ReactNode } from "react";
import { auth } from "@/lib/auth";
import { withTenantContext } from "@wavesco/db";
import { Sidebar } from "@/components/sidebar";
import { Topbar } from "@/components/topbar";
import { MilestoneNotificationCenterServer } from "@/components/milestone-notification-center-server";
import { hasInternalAccess, requireTenantId } from "@/lib/tenant";
import Image from "next/image";

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const session = await auth();
  const tenantId = requireTenantId(session);
  const internalAccess = hasInternalAccess(session);

  // A transient database or notification failure must not take down every
  // dashboard route — degrade to an empty shell instead of a 500.
  let tenantName = "Your workspace";
  let auditEntries: { action: string; model: string; createdAt: string }[] = [];
  let notifications: ReactNode = null;
  try {
    const data = await withTenantContext(tenantId, async (tx) => {
      const [tenant, auditLogs] = await Promise.all([
        tx.tenant.findUnique({ where: { id: tenantId }, select: { name: true } }),
        tx.auditLog.findMany({
          where: { tenantId },
          orderBy: { createdAt: "desc" },
          take: 5,
          select: { action: true, model: true, createdAt: true },
        }),
      ]);
      return { tenantName: tenant?.name, auditLogs };
    });
    if (data.tenantName) tenantName = data.tenantName;
    auditEntries = data.auditLogs.map((log) => ({
      action: log.action,
      model: log.model,
      createdAt: log.createdAt.toISOString(),
    }));
  } catch (error) {
    console.error("[layout] workspace summary unavailable", error);
  }

  try {
    notifications = <MilestoneNotificationCenterServer />;
  } catch (error) {
    console.error("[layout] notifications unavailable", error);
  }

  const user = session?.user as Record<string, unknown> | undefined;
  const name = typeof user?.name === "string" ? user.name : typeof user?.email === "string" ? user.email : "U";
  const initials = name.slice(0, 2).toUpperCase();
  const email = typeof user?.email === "string" ? user.email : "";

  return (
    <div className="flex min-h-screen bg-background">
      <aside className="hidden w-[220px] shrink-0 flex-col border-r border-border/80 bg-card md:flex">
        <div className="flex h-[56px] shrink-0 items-center gap-3 border-b border-border/60 px-5">
          <Image
            src="/apple-touch-icon.png"
            alt="Waves"
            width={24}
            height={24}
            className="h-6 w-6 shrink-0 rounded-sm object-cover"
            priority
          />
          <span className="font-mono text-[13px] font-semibold tracking-[0.08em] text-foreground">WAVES OS</span>
          <span className="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500 shadow-[0_0_6px_hsl(142_76%_36%_/_0.45)]" />
        </div>
        <Sidebar internalAccess={internalAccess} />
        <div className="shrink-0 border-t border-border/60 p-3">
          <div className="rounded-md border border-border/60 bg-card-hover/50 px-2.5 py-2">
            <p className="font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground/70">Workspace</p>
            <p className="mt-1 truncate font-sans text-[11px] font-medium tracking-[-0.01em] text-foreground">{tenantName}</p>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <Topbar
          tenantName={tenantName}
          email={email}
          initials={initials}
          auditEntries={auditEntries}
          milestoneNotifications={notifications}
          internalAccess={internalAccess}
        />
        <main className="flex-1 overflow-auto bg-background">
          <div className="mx-auto max-w-[1280px] px-4 py-6 sm:px-8 sm:py-10">{children}</div>
        </main>
      </div>
    </div>
  );
}