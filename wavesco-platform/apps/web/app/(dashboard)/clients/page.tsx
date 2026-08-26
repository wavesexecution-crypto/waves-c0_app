import type { Metadata } from "next";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { requireTenantId } from "@/lib/tenant";
import { withTenantContext } from "@wavesco/db";
import { ClientCreateForm } from "@/components/clients/forms";
import { formatIST } from "@/lib/wavesco/time";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Clients" };

const STATUS_ORDER = ["onboarding", "active", "lead", "churned"] as const;

export default async function ClientsPage() {
  const session = await auth();
  const tenantId = requireTenantId(session);

  const clients = await withTenantContext(tenantId, async (tx) => {
    const rows = await tx.client.findMany({
      where: { tenantId },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    const projectCounts = await tx.project.groupBy({
      by: ["clientId"],
      where: { tenantId },
      _count: { _all: true },
    });
    return { rows, projectCounts };
  });

  const countFor = (clientId: string): number =>
    clients.projectCounts.find((p) => p.clientId === clientId)?._count._all ?? 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Clients</h1>
        <p className="text-sm text-muted-foreground">
          Tenant-scoped in PostgreSQL with full RLS isolation. Onboarding checklists start automatically.
        </p>
      </div>

      <ClientCreateForm />

      {clients.rows.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          No clients yet. Add the first one above.
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[...clients.rows]
            .sort((a, b) => STATUS_ORDER.indexOf(a.status as (typeof STATUS_ORDER)[number]) - STATUS_ORDER.indexOf(b.status as (typeof STATUS_ORDER)[number]))
            .map((c) => (
              <Link key={c.id} href={`/clients/${c.id}`} className="rounded-lg border bg-card p-4 transition-colors hover:border-primary/40">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{c.name}</p>
                    <p className="truncate text-xs text-muted-foreground">{c.company ?? c.email ?? "—"}</p>
                  </div>
                  <span className="shrink-0 rounded-full border px-2 py-0.5 text-[10px] uppercase text-muted-foreground">{c.status}</span>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  {countFor(c.id)} project{countFor(c.id) === 1 ? "" : "s"} · added {formatIST(c.createdAt)}
                </p>
              </Link>
            ))}
        </div>
      )}
    </div>
  );
}
