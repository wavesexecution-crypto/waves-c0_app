import type { Metadata } from "next";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { requireTenantId } from "@/lib/tenant";
import { withTenantContext } from "@wavesco/db";
import { FollowUpForm, FollowUpRowActions } from "@/components/acquisition/follow-ups";
import { AutoRefresh } from "@/components/command/auto-refresh";
import { formatIST } from "@/lib/wavesco/time";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Follow-ups" };

export default async function FollowUpsPage() {
  const session = await auth();
  const tenantId = requireTenantId(session);

  const rows = await withTenantContext(tenantId, (tx) =>
    tx.followUp.findMany({ where: { tenantId }, orderBy: [{ status: "asc" }, { dueAt: "asc" }], take: 100 }),
  );

  const now = new Date();
  const pending = rows.filter((r) => r.status === "pending");
  const overdue = pending.filter((r) => r.dueAt < now);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-[22px] font-semibold tracking-[-0.02em] text-foreground">Follow-ups</h1>
          <p className="mt-1 max-w-3xl font-sans text-[13px] leading-5 text-muted-foreground">
            <span className="font-mono tabular-nums text-foreground">{pending.length}</span> pending · <span className="font-mono tabular-nums text-foreground">{overdue.length}</span> overdue. Nudges you've scheduled for prospects who haven't replied — work them from here.
          </p>
        </div>
        <AutoRefresh intervalMs={10_000} />
      </div>

      <FollowUpForm />

      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border/80 bg-card p-8 text-center">
          <p className="font-sans text-[13px] text-muted-foreground">No follow-ups yet.</p>
          <Link href="/acquisition/pipeline" className="mt-3 inline-flex rounded-lg bg-primary px-3 py-1.5 font-sans text-[13px] font-medium text-primary-foreground hover:bg-primary/90">
            Go to Pipeline
          </Link>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border/80 bg-card">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border/60 text-left font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
                <th className="px-4 py-2.5 font-medium">Business</th>
                <th className="px-4 py-2.5 font-medium">Due</th>
                <th className="px-4 py-2.5 font-medium">Note</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
                <th className="px-4 py-2.5 text-right font-medium">Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((f) => (
                <tr key={f.id} className="border-b border-border/60 last:border-0 hover:bg-muted/20">
                  <td className="px-4 py-2.5 font-sans text-[13px] font-medium text-foreground">
                    {f.leadKey ? (
                      <Link href={`/acquisition/leads/${encodeURIComponent(f.leadKey)}`} className="hover:underline">
                        {f.business}
                      </Link>
                    ) : (
                      f.business
                    )}
                  </td>
                  <td className={`px-4 py-2.5 font-mono text-[11px] tracking-[0.02em] ${f.status === "pending" && f.dueAt < now ? "text-red-500" : "text-muted-foreground"}`}>
                    {formatIST(f.dueAt)}
                    {f.status === "pending" && f.dueAt < now ? " · overdue" : ""}
                  </td>
                  <td className="max-w-[260px] truncate px-4 py-2.5 font-sans text-[13px] text-muted-foreground">{f.note ?? "—"}</td>
                  <td className="px-4 py-2.5 font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground">{f.status}</td>
                  <td className="px-4 py-2.5 text-right">
                    <FollowUpRowActions id={f.id} status={f.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
