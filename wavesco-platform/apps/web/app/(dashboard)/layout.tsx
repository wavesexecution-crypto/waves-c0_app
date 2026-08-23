import type { ReactNode } from "react";
import { auth } from "@/lib/auth";
import { signOutAction } from "@/lib/actions";
import { withTenantContext } from "@wavesco/db";
import { Button } from "@wavesco/ui";
import { Sidebar } from "@/components/sidebar";
import { Topbar } from "@/components/topbar";
import { requireTenantId } from "@/lib/tenant";

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const session = await auth();
  const tenantId = requireTenantId(session);

  const data = await withTenantContext(tenantId, async (tx) => {
    const [tenant, auditLogs] = await Promise.all([
      tx.tenant.findUnique({
        where: { id: tenantId },
        select: { name: true, plan: true },
      }),
      tx.auditLog.findMany({
        where: { tenantId },
        orderBy: { createdAt: "desc" },
        take: 6,
        select: { action: true, model: true, createdAt: true },
      }),
    ]);
    return {
      tenantName: tenant?.name ?? "Your workspace",
      plan: tenant?.plan ?? "starter",
      auditEntries: auditLogs.map((log) => ({
        action: log.action,
        model: log.model,
        createdAt: log.createdAt.toISOString(),
      })),
    };
  });

  const user = session?.user as Record<string, unknown> | undefined;
  const name = typeof user?.name === "string" ? user.name : typeof user?.email === "string" ? user.email : "U";
  const initials = name.slice(0, 2).toUpperCase();
  const email = typeof user?.email === "string" ? user.email : "";

  return (
    <div className="flex min-h-screen bg-[#FCFCFD] dark:bg-background">
      {/* Desktop sidebar — fixed, calm, precise */}
      <aside className="hidden w-[264px] shrink-0 flex-col border-r border-border/60 bg-card md:flex">
        <Sidebar plan={data.plan} tenantName={data.tenantName} />
        <div className="border-t border-border/60 p-3">
          <form action={signOutAction}>
            <Button
              variant="ghost"
              size="sm"
              type="submit"
              className="w-full justify-center text-xs font-medium text-muted-foreground hover:text-foreground"
            >
              Sign out
            </Button>
          </form>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar
          tenantName={data.tenantName}
          email={email}
          initials={initials}
          auditEntries={data.auditEntries}
          plan={data.plan}
        />
        <main className="flex-1">
          <div className="mx-auto w-full max-w-[1280px] px-4 py-6 md:px-6 md:py-7 lg:px-8">
            {children}
          </div>
        </main>
        <footer className="border-t border-border/40 px-6 py-4">
          <div className="mx-auto flex max-w-[1280px] items-center justify-between text-[11px] leading-none tracking-wide text-muted-foreground">
            <span>© {new Date().getFullYear()} WavesCo · Carefully built for your business.</span>
            <span className="hidden sm:inline">System status: operational</span>
          </div>
        </footer>
      </div>
    </div>
  );
}
