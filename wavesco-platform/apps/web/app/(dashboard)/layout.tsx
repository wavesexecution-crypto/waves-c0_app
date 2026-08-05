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
        select: { name: true },
      }),
      tx.auditLog.findMany({
        where: { tenantId },
        orderBy: { createdAt: "desc" },
        take: 5,
        select: { action: true, model: true, createdAt: true },
      }),
    ]);
    return {
      tenantName: tenant?.name ?? "Your workspace",
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
    <div className="flex min-h-screen">
      <aside className="hidden w-64 flex-col border-r bg-card md:flex">
        <div className="flex h-14 items-center border-b px-4">
          <span className="text-base font-semibold tracking-tight">WavesCo</span>
        </div>
        <Sidebar />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar tenantName={data.tenantName} email={email} initials={initials} auditEntries={data.auditEntries} />
        <main className="flex-1 p-6">{children}</main>
        <div className="flex h-14 items-center justify-end border-t px-6">
          <form action={signOutAction}>
            <Button variant="outline" size="sm" type="submit">
              Sign out
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
