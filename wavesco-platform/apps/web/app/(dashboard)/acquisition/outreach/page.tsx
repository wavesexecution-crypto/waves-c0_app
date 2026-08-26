import type { Metadata } from "next";
import { auth } from "@/lib/auth";
import { requireTenantId } from "@/lib/tenant";
import { withTenantContext } from "@wavesco/db";
import { DecideButtons } from "@/components/acquisition/submit-panel";
import { StatusPill } from "@/components/command/primitives";
import { formatIST } from "@/lib/wavesco/time";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Cold Email" };

const PIPELINE = ["submitted", "approved", "sent", "rejected", "failed"] as const;

export default async function OutreachPage() {
  const session = await auth();
  const tenantId = requireTenantId(session);

  const emails = await withTenantContext(tenantId, async (tx) =>
    tx.outreachEmail.findMany({
      where: { tenantId },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
  );

  const counts = Object.fromEntries(
    PIPELINE.map((s) => [s, emails.filter((e) => e.status === s).length]),
  ) as Record<(typeof PIPELINE)[number], number>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Cold Email</h1>
        <p className="text-sm text-muted-foreground">
          Pipeline over the existing production path: Approval Queue → Email Outbox → SMTP. Approve or
          reject here or via Telegram — both reach the same delivery pipeline.
        </p>
      </div>

      {emails.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          No cold email activity yet. Queue a campaign under Campaigns; statuses will track real
          submission, approval and dispatch events.
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            {PIPELINE.map((s) => (
              <div key={s} className="rounded-lg border bg-card p-3 text-center">
                <StatusPill state={s === "submitted" ? "queued" : s} />
                <p className="mt-1.5 text-xl font-semibold tabular-nums">{counts[s]}</p>
              </div>
            ))}
          </div>

          <div className="overflow-x-auto rounded-lg border bg-card">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-2.5">Business / recipient</th>
                  <th className="px-4 py-2.5">Subject</th>
                  <th className="px-4 py-2.5">Status</th>
                  <th className="px-4 py-2.5">Approval</th>
                  <th className="px-4 py-2.5">Timeline</th>
                  <th className="px-4 py-2.5 text-right">Decision</th>
                </tr>
              </thead>
              <tbody>
                {emails.map((e) => (
                  <tr key={e.id} className="border-b last:border-0 align-top hover:bg-accent/40">
                    <td className="px-4 py-2.5">
                      <span className="font-medium">{e.business}</span>
                      <span className="block font-mono text-[11px] text-muted-foreground">{e.email}</span>
                    </td>
                    <td className="max-w-[220px] truncate px-4 py-2.5 text-xs">{e.subject}</td>
                    <td className="px-4 py-2.5">
                      <StatusPill state={e.status} />
                      {e.error ? <span className="mt-1 block max-w-[200px] break-words text-[11px] text-red-500">{e.error}</span> : null}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">{e.approvalId ?? "—"}</td>
                    <td className="px-4 py-2.5 text-[11px] leading-relaxed text-muted-foreground">
                      submitted {formatIST(e.submittedAt)}
                      <br />
                      decided {formatIST(e.decidedAt)}
                      <br />
                      sent {formatIST(e.sentAt)}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      {!e.decidedAt && e.status !== "failed" ? (
                        <DecideButtons outreachEmailId={e.id} />
                      ) : (
                        <span className="text-[11px] text-muted-foreground">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="text-[11px] text-muted-foreground">
            Note: &quot;approved&quot; means the decision reached the existing decide endpoint; &quot;sent&quot;
            is set only when that response confirms dispatch through Email Outbox. Delivery/bounce/reply
            telemetry does not exist upstream yet and is therefore never shown here.
          </p>
        </>
      )}
    </div>
  );
}
