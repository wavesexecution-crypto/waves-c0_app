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
          <h1 className="text-2xl font-semibold tracking-tight">Follow-ups</h1>
          <p className="text-sm text-muted-foreground">
            {pending.length} pending · {overdue.length} overdue. Reminders flow through the existing
            Notify Hub when triggered by automations; this tracker is the source of record.
          </p>
        </div>
        <AutoRefresh intervalMs={10_000} />
      </div>

      <FollowUpForm />

      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          <p>No follow-ups yet.</p>
          <Link href="/acquisition/pipeline" className="mt-3 inline-block rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90">
            Go to Pipeline
          </Link>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-2.5">Business</th>
                <th className="px-4 py-2.5">Due</th>
                <th className="px-4 py-2.5">Note</th>
                <th className="px-4 py-2.5">Status</th>
                <th className="px-4 py-2.5 text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((f) => (
                <tr key={f.id} className="border-b last:border-0 hover:bg-accent/40">
                  <td className="px-4 py-2.5 font-medium">
                    {f.leadKey ? (
                      <Link href={`/acquisition/leads/${encodeURIComponent(f.leadKey)}`} className="hover:underline">
                        {f.business}
                      </Link>
                    ) : (
                      f.business
                    )}
                  </td>
                  <td className={`px-4 py-2.5 text-xs ${f.status === "pending" && f.dueAt < now ? "text-red-500" : "text-muted-foreground"}`}>
                    {formatIST(f.dueAt)}
                    {f.status === "pending" && f.dueAt < now ? " · overdue" : ""}
                  </td>
                  <td className="max-w-[260px] truncate px-4 py-2.5 text-xs text-muted-foreground">{f.note ?? "—"}</td>
                  <td className="px-4 py-2.5 text-xs">{f.status}</td>
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
