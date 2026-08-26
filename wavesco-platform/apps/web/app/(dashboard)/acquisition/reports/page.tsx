import type { Metadata } from "next";
import { auth } from "@/lib/auth";
import { requireTenantId } from "@/lib/tenant";
import { listBatchManifests } from "@/lib/wavesco/lead-engine";
import { ResendButton } from "@/components/acquisition/resend-button";
import { StatusPill } from "@/components/command/primitives";
import { formatIST } from "@/lib/wavesco/time";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Reports" };

export default async function ReportsPage() {
  const session = await auth();
  requireTenantId(session);

  let manifests: Awaited<ReturnType<typeof listBatchManifests>> = [];
  let error: string | null = null;
  try {
    manifests = listBatchManifests();
  } catch (e) {
    error = e instanceof Error ? e.message : "Reports directory unreachable";
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Reports</h1>
        <p className="text-sm text-muted-foreground">
          Real batch manifests and files produced by the Lead Engine on this machine. Existing reports
          are never regenerated — downloads stream from disk.
        </p>
      </div>

      {error ? (
        <div className="rounded-lg border border-dashed border-red-500/40 p-6 text-sm">
          <p className="font-medium">Report storage unavailable</p>
          <p className="text-muted-foreground">{error}</p>
          <p className="mt-1 text-xs text-muted-foreground">Produced by the lead research service</p>
        </div>
      ) : manifests.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          No batches recorded yet. Run the Lead Engine to produce the first report.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-2.5">Batch</th>
                <th className="px-4 py-2.5">Generated</th>
                <th className="px-4 py-2.5">Leads</th>
                <th className="px-4 py-2.5">Email-ready</th>
                <th className="px-4 py-2.5">Telegram</th>
                <th className="px-4 py-2.5">Files</th>
                <th className="px-4 py-2.5 text-right">Resend</th>
              </tr>
            </thead>
            <tbody>
              {manifests.map((m) => {
                const deliveryStatus = m.telegramDeliveryStatus ?? "";
                const delivered = deliveryStatus.includes("delivered");
                return (
                  <tr key={m.batchId} className="border-b last:border-0 hover:bg-accent/40">
                    <td className="px-4 py-2.5 font-mono text-xs">{m.batchId}</td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground">{formatIST(m.generatedAt ?? null)}</td>
                    <td className="px-4 py-2.5 tabular-nums">{m.leadCount ?? "—"}</td>
                    <td className="px-4 py-2.5 tabular-nums">{m.emailReadyCount ?? "—"}</td>
                    <td className="px-4 py-2.5">
                      {deliveryStatus ? (
                        <StatusPill state={delivered ? "connected" : "queued"} />
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                      {!delivered && deliveryStatus ? (
                        <span className="mt-1 block text-[11px] text-muted-foreground">{deliveryStatus}</span>
                      ) : null}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="flex gap-1.5 text-[11px]">
                        {m.pdfPath ? (
                          <a className="rounded border px-2 py-0.5 hover:bg-accent" href={`/api/reports/${m.batchId}/file?type=pdf`}>
                            PDF
                          </a>
                        ) : (
                          <span className="text-muted-foreground/60">no PDF</span>
                        )}
                        {m.excelPath ? (
                          <a className="rounded border px-2 py-0.5 hover:bg-accent" href={`/api/reports/${m.batchId}/file?type=xlsx`}>
                            XLSX
                          </a>
                        ) : (
                          <span className="text-muted-foreground/60">no XLSX</span>
                        )}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <ResendButton batchId={m.batchId} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
