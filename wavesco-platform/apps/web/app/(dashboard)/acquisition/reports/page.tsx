import type { Metadata } from "next";
import { auth } from "@/lib/auth";
import { requireTenantId } from "@/lib/tenant";
import { withTenantContext } from "@wavesco/db";
import { listBatchManifests } from "@/lib/wavesco/lead-engine";
import { ResendButton } from "@/components/acquisition/resend-button";
import { StatusPill } from "@/components/command/primitives";
import { formatIST } from "@/lib/wavesco/time";
import { DocumentsGenerateControl } from "@/components/acquisition/documents-generate-button";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Documents — Generated Reports" };

type GenerationBatchRow = {
  id: string;
  requestId: string;
  tenantId: string;
  params: unknown;
  status: string;
  stage?: string | null;
  requestedCount?: number | null;
  resultLeadCount?: number | null;
  emailReadyCount?: number | null;
  engineBatchId?: string | null;
  pdfPath?: string | null;
  excelPath?: string | null;
  logTail?: string | null;
  error?: string | null;
  createdAt: Date | string;
  finishedAt?: Date | string | null;
  startedAt?: Date | string | null;
};

type ActivityRow = {
  id: string;
  sourceKey: string | null;
  type: string;
  title: string;
  createdAt: Date | string;
};

function paramsSummary(params: unknown): string {
  if (!params || typeof params !== "object") return "—";
  const p = params as Record<string, unknown>;
  const parts: string[] = [];
  if (typeof p.category === "string" && p.category) parts.push(`cat:${p.category}`);
  if (typeof p.city === "string" && p.city) parts.push(`city:${p.city}`);
  if (typeof p.tier === "string" && p.tier) parts.push(`tier:${p.tier}`);
  if (typeof p.count === "number") parts.push(`count:${p.count}`);
  if (typeof (p as Record<string, unknown>).requestedCount === "number") parts.push(`count:${(p as Record<string, unknown>).requestedCount}`);
  // location fallback
  if (typeof (p as Record<string, unknown>).location === "string" && (p as Record<string, unknown>).location) parts.push(`loc:${(p as Record<string, unknown>).location}`);
  return parts.length > 0 ? parts.join(" · ") : JSON.stringify(p).slice(0, 80);
}

export default async function ReportsPage() {
  const session = await auth();
  const tenantId = requireTenantId(session);

  let manifests: Awaited<ReturnType<typeof listBatchManifests>> = [];
  let manifestsError: string | null = null;
  try {
    manifests = await listBatchManifests();
  } catch (e) {
    manifestsError = e instanceof Error ? e.message : "Reports directory unreachable";
  }

  let batches: GenerationBatchRow[] = [];
  let activities: ActivityRow[] = [];
  let historyError: string | null = null;
  try {
    const result = await withTenantContext(tenantId, async (tx: any) => {
      const b: GenerationBatchRow[] = await tx.generationBatch.findMany({
        where: { tenantId },
        orderBy: { createdAt: "desc" },
        take: 20,
      });
      const a: ActivityRow[] = await tx.activityEvent.findMany({
        where: { tenantId, sourceKey: { not: null } },
        orderBy: { createdAt: "desc" },
        take: 50,
        select: { id: true, sourceKey: true, type: true, title: true, createdAt: true },
      });
      return { batches: b, activities: a };
    });
    batches = result.batches;
    activities = result.activities;
  } catch (e) {
    historyError = e instanceof Error ? e.message : "Generation history unavailable";
  }

  // Build lineage map: sourceKey -> activity
  const activityBySource = new Map<string, ActivityRow>();
  for (const a of activities) {
    if (a.sourceKey && !activityBySource.has(a.sourceKey)) activityBySource.set(a.sourceKey, a);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Documents — Generated Reports</h1>
        <p className="text-sm text-muted-foreground">
          View generated reports, generate new documents, download via tenant-scoped files, and inspect lineage (workflow + engine batch).
          Every generation is audit-logged.
        </p>
      </div>

      <DocumentsGenerateControl />

      {/* Generation history — DB-backed, tenant-scoped */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">Generation History</h2>
          <span className="text-xs text-muted-foreground">{batches.length} batches · via GenerationBatch.engineBatchId + ActivityEvent.sourceKey</span>
        </div>

        {historyError ? (
          <div className="rounded-lg border border-dashed border-red-500/40 p-6 text-sm">
            <p className="font-medium">Generation history unavailable</p>
            <p className="text-muted-foreground">{historyError}</p>
          </div>
        ) : batches.length === 0 ? (
          <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
            No generation batches yet. Use Generate above to queue the first document.
            <p className="mt-1 text-xs">Params example: category=Salon, city=Pune, tier=A, count=10 → queued.</p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border bg-card">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-2.5">Batch</th>
                  <th className="px-4 py-2.5">Status</th>
                  <th className="px-4 py-2.5">Created</th>
                  <th className="px-4 py-2.5">Engine Batch</th>
                  <th className="px-4 py-2.5">Workflow</th>
                  <th className="px-4 py-2.5">Params</th>
                  <th className="px-4 py-2.5">Files</th>
                </tr>
              </thead>
              <tbody>
                {batches.map((b) => {
                  const sourceKey = b.engineBatchId ? `batch:${b.engineBatchId}` : null;
                  const lineage = sourceKey ? activityBySource.get(sourceKey) : null;
                  const workflowLabel = lineage ? `${lineage.type}` : b.engineBatchId ? "engine" : "queued";
                  const workflowTitle = lineage?.title ?? (b.engineBatchId ? `Engine batch ${b.engineBatchId}` : "—");
                  const statusState =
                    b.status === "completed" ? "connected" : b.status === "failed" ? "failed" : b.status === "running" ? "running" : b.status === "queued" ? "queued" : "unavailable";
                  return (
                    <tr key={b.id} className="border-b last:border-0 hover:bg-accent/40">
                      <td className="px-4 py-2.5 font-mono text-xs" title={b.requestId}>
                        {b.id.slice(0, 8)}…<span className="block text-[11px] text-muted-foreground">{b.requestId.slice(0, 12)}…</span>
                        {b.resultLeadCount != null ? <span className="block text-[11px] tabular-nums">{b.resultLeadCount} leads</span> : null}
                      </td>
                      <td className="px-4 py-2.5">
                        <StatusPill state={statusState} />
                        {b.error ? <span className="mt-1 block max-w-[160px] truncate text-[11px] text-red-500" title={b.error}>{b.error}</span> : null}
                        {b.stage ? <span className="mt-1 block text-[11px] text-muted-foreground">{b.stage}</span> : null}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-muted-foreground">{formatIST(b.createdAt as string)}</td>
                      <td className="px-4 py-2.5 font-mono text-xs">
                        {b.engineBatchId ? (
                          <span title={b.engineBatchId}>{b.engineBatchId.slice(0, 12)}…</span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        <span className="text-xs">{workflowLabel}</span>
                        <span className="block max-w-[180px] truncate text-[11px] text-muted-foreground" title={workflowTitle}>{workflowTitle}</span>
                        {sourceKey ? <span className="block font-mono text-[10px] text-muted-foreground/70">{sourceKey}</span> : null}
                      </td>
                      <td className="px-4 py-2.5 text-xs">
                        <span className="line-clamp-2 max-w-[160px]" title={JSON.stringify(b.params)}>{paramsSummary(b.params)}</span>
                        {b.logTail ? <span className="mt-1 block max-w-[160px] truncate font-mono text-[10px] text-muted-foreground/70" title={b.logTail}>log: {b.logTail.slice(-40)}…</span> : null}
                      </td>
                      <td className="px-4 py-2.5">
                        <span className="flex gap-1.5 text-[11px]">
                          {b.engineBatchId && b.pdfPath ? (
                            <a className="rounded border px-2 py-0.5 hover:bg-accent" href={`/api/reports/${b.engineBatchId}/file?type=pdf`}>
                              PDF
                            </a>
                          ) : b.pdfPath ? (
                            <span className="rounded border px-2 py-0.5 text-muted-foreground/60" title={b.pdfPath}>PDF (local)</span>
                          ) : (
                            <span className="text-muted-foreground/60">no PDF</span>
                          )}
                          {b.engineBatchId && b.excelPath ? (
                            <a className="rounded border px-2 py-0.5 hover:bg-accent" href={`/api/reports/${b.engineBatchId}/file?type=xlsx`}>
                              XLSX
                            </a>
                          ) : b.excelPath ? (
                            <span className="rounded border px-2 py-0.5 text-muted-foreground/60" title={b.excelPath}>XLSX (local)</span>
                          ) : (
                            <span className="text-muted-foreground/60">no XLSX</span>
                          )}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Engine manifests — files on disk */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">Engine Manifests — Files on Disk</h2>
          <span className="text-xs text-muted-foreground">Real batch manifests produced by Lead Engine · downloads stream via RLS file route</span>
        </div>

        {manifestsError ? (
          <div className="rounded-lg border border-dashed border-red-500/40 p-6 text-sm">
            <p className="font-medium">Report storage unavailable</p>
            <p className="text-muted-foreground">{manifestsError}</p>
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
      </section>
    </div>
  );
}
