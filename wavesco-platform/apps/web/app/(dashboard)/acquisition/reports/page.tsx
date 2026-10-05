import type { Metadata } from "next";
import { auth } from "@/lib/auth";
import { requireTenantId } from "@/lib/tenant";
import { withTenantContext } from "@wavesco/db";
import { listBatchManifests } from "@/lib/wavesco/lead-engine";
import { ResendButton } from "@/components/acquisition/resend-button";
import { StatusPill } from "@/components/command/primitives";
import { AutoRefresh } from "@/components/command/auto-refresh";
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

  // Tenant scope for engine manifests: the engine's manifest directory is
  // GLOBAL (no tenant attribution), so only batches linked to this tenant's
  // GenerationBatch rows are shown. Otherwise any tenant could enumerate
  // every other tenant's batch IDs and download their reports.
  const ownedEngineIds = new Set(
    batches.map((b) => b.engineBatchId).filter((v): v is string => !!v),
  );
  const visibleManifests = manifests.filter((m) => ownedEngineIds.has(m.batchId));

  // Durable status per visible batch for this tenant.
  let archivedByBatch = new Map<string, { pdf: boolean; xlsx: boolean }>();
  try {
    const archived = await withTenantContext(tenantId, async (tx: any) =>
      tx.storedObject.findMany({
        where: { tenantId, kind: "report", status: "READY" },
        select: { batchId: true, mime: true, fileName: true },
      }),
    );
    for (const o of archived as { batchId: string | null; mime: string; fileName: string }[]) {
      if (!o.batchId) continue;
      const cur = archivedByBatch.get(o.batchId) ?? { pdf: false, xlsx: false };
      if (o.mime === "application/pdf") cur.pdf = true;
      if (o.mime.includes("spreadsheetml") || o.fileName.endsWith(".xlsx")) cur.xlsx = true;
      archivedByBatch.set(o.batchId, cur);
    }
  } catch {
    archivedByBatch = new Map();
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">Documents</p>
          <h1 className="mt-1 font-display text-[22px] font-semibold tracking-[-0.02em] text-foreground">Documents — Generated Reports</h1>
          <p className="mt-1.5 max-w-2xl font-sans text-[13px] leading-5 text-muted-foreground">
            View generated reports, generate new documents, download via tenant-scoped files, and inspect lineage (workflow + engine batch).
            Every generation is audit-logged.
          </p>
        </div>
        <AutoRefresh intervalMs={15_000} />
      </div>

      <DocumentsGenerateControl />

      {/* Generation history — DB-backed, tenant-scoped */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">Generation History</h2>
          <span className="font-mono text-[11px] tracking-[0.02em] text-muted-foreground">{batches.length} batches · via GenerationBatch.engineBatchId + ActivityEvent.sourceKey</span>
        </div>

        {historyError ? (
          <div className="rounded-lg border border-dashed border-border/80 border-red-500/30 bg-card p-6">
            <p className="font-sans text-[13px] font-medium text-foreground">Generation history unavailable</p>
            <p className="mt-1 font-mono text-[11px] leading-5 tracking-[0.02em] text-muted-foreground">{historyError}</p>
            <a href="/acquisition/reports" className="mt-2 inline-flex rounded-lg border border-border/80 bg-card px-3 py-1.5 font-mono text-[11px] font-medium uppercase tracking-[0.08em] hover:bg-muted/50">
              Retry
            </a>
          </div>
        ) : batches.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border/80 bg-card p-6 text-center">
            <p className="font-sans text-[13px] text-muted-foreground">No generation batches yet. Use Generate above to queue the first document.</p>
            <p className="mt-1 font-mono text-[11px] tracking-[0.02em] text-muted-foreground">Params example: category=Salon, city=Pune, tier=A, count=10 → queued.</p>
            <p className="mt-2 font-mono text-[11px] tracking-[0.02em] text-muted-foreground">Live polling every 15s — new batches appear automatically.</p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border/80 bg-card">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border/60 text-left font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
                  <th className="px-4 py-2.5 font-medium">Batch</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                  <th className="px-4 py-2.5 font-medium">Created</th>
                  <th className="px-4 py-2.5 font-medium">Engine Batch</th>
                  <th className="px-4 py-2.5 font-medium">Workflow</th>
                  <th className="px-4 py-2.5 font-medium">Params</th>
                  <th className="px-4 py-2.5 font-medium">Files</th>
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
                    <tr key={b.id} className="border-b border-border/60 last:border-0 hover:bg-card-hover">
                      <td className="px-4 py-2.5 font-mono text-[11px] tabular-nums tracking-[0.02em] text-foreground" title={b.requestId}>
                        {b.id.slice(0, 8)}…<span className="block font-mono text-[11px] tracking-[0.02em] text-muted-foreground">{b.requestId.slice(0, 12)}…</span>
                        {b.resultLeadCount != null ? <span className="block font-mono text-[11px] tabular-nums tracking-[0.02em] text-muted-foreground">{b.resultLeadCount} leads</span> : null}
                      </td>
                      <td className="px-4 py-2.5">
                        <StatusPill state={statusState} />
                        {b.error ? <span className="mt-1 block max-w-[160px] truncate font-mono text-[11px] tracking-[0.02em] text-red-500" title={b.error}>{b.error}</span> : null}
                        {b.stage ? <span className="mt-1 block font-mono text-[11px] tracking-[0.02em] text-muted-foreground">{b.stage}</span> : null}
                      </td>
                      <td className="px-4 py-2.5 font-mono text-[11px] tracking-[0.02em] text-muted-foreground">{formatIST(b.createdAt as string)}</td>
                      <td className="px-4 py-2.5 font-mono text-[11px] tracking-[0.02em] text-foreground">
                        {b.engineBatchId ? (
                          <span title={b.engineBatchId}>{b.engineBatchId.slice(0, 12)}…</span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        <span className="font-sans text-[13px] text-foreground">{workflowLabel}</span>
                        <span className="block max-w-[180px] truncate font-mono text-[11px] tracking-[0.02em] text-muted-foreground" title={workflowTitle}>{workflowTitle}</span>
                        {sourceKey ? <span className="block font-mono text-[11px] tracking-[0.02em] text-muted-foreground/70">{sourceKey}</span> : null}
                      </td>
                      <td className="px-4 py-2.5 font-mono text-[11px] tracking-[0.02em] text-muted-foreground">
                        <span className="line-clamp-2 max-w-[160px] font-sans text-[13px] leading-5 text-foreground" title={JSON.stringify(b.params)}>{paramsSummary(b.params)}</span>
                        {b.logTail ? <span className="mt-1 block max-w-[160px] truncate font-mono text-[11px] tracking-[0.02em] text-muted-foreground/70" title={b.logTail}>log: {b.logTail.slice(-40)}…</span> : null}
                      </td>
                      <td className="px-4 py-2.5">
                        <span className="flex gap-1.5 font-mono text-[11px]">
                          {b.engineBatchId && b.pdfPath ? (
                            <a className="rounded-lg border border-border/80 px-2 py-0.5 font-mono text-[11px] uppercase tracking-[0.08em] hover:bg-muted/50" href={`/api/reports/${b.engineBatchId}/file?type=pdf`}>
                              PDF
                            </a>
                          ) : b.pdfPath ? (
                            <span className="rounded-lg border border-border/80 px-2 py-0.5 font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground/60" title={b.pdfPath}>PDF (local)</span>
                          ) : (
                            <span className="font-mono text-[11px] tracking-[0.02em] text-muted-foreground/60">no PDF</span>
                          )}
                          {b.engineBatchId && b.excelPath ? (
                            <a className="rounded-lg border border-border/80 px-2 py-0.5 font-mono text-[11px] uppercase tracking-[0.08em] hover:bg-muted/50" href={`/api/reports/${b.engineBatchId}/file?type=xlsx`}>
                              XLSX
                            </a>
                          ) : b.excelPath ? (
                            <span className="rounded-lg border border-border/80 px-2 py-0.5 font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground/60" title={b.excelPath}>XLSX (local)</span>
                          ) : (
                            <span className="font-mono text-[11px] tracking-[0.02em] text-muted-foreground/60">no XLSX</span>
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
          <h2 className="font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">Engine Manifests — Files on Disk</h2>
          <span className="font-mono text-[11px] tracking-[0.02em] text-muted-foreground">Real batch manifests produced by Lead Engine · downloads stream via RLS file route</span>
        </div>

        {manifestsError ? (
          <div className="rounded-lg border border-dashed border-border/80 border-red-500/30 bg-card p-6">
            <p className="font-sans text-[13px] font-medium text-foreground">Report storage unavailable</p>
            <p className="mt-1 font-mono text-[11px] leading-5 tracking-[0.02em] text-muted-foreground">{manifestsError}</p>
            <p className="mt-1 font-mono text-[11px] tracking-[0.02em] text-muted-foreground">Produced by the lead research service</p>
            <a href="/acquisition/reports" className="mt-2 inline-flex rounded-lg border border-border/80 bg-card px-3 py-1.5 font-mono text-[11px] font-medium uppercase tracking-[0.08em] hover:bg-muted/50">
              Retry
            </a>
          </div>
        ) : visibleManifests.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border/80 bg-card p-8 text-center">
            <p className="font-sans text-[13px] text-muted-foreground">No batches recorded yet. Run the Lead Engine to produce the first report.</p>
            <a href="/acquisition/generate" className="mt-3 inline-flex rounded-lg bg-primary px-3 py-1.5 font-sans text-[13px] font-medium text-primary-foreground hover:bg-primary/90">
              Go to Lead Engine
            </a>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border/80 bg-card">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border/60 text-left font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
                  <th className="px-4 py-2.5 font-medium">Batch</th>
                  <th className="px-4 py-2.5 font-medium">Generated</th>
                  <th className="px-4 py-2.5 font-medium">Leads</th>
                  <th className="px-4 py-2.5 font-medium">Email-ready</th>
                  <th className="px-4 py-2.5 font-medium">Telegram</th>
                  <th className="px-4 py-2.5 font-medium">Files</th>
                  <th className="px-4 py-2.5 font-medium">Durable</th>
                  <th className="px-4 py-2.5 text-right font-medium">Resend</th>
                </tr>
              </thead>
              <tbody>
                {visibleManifests.map((m) => {
                  const deliveryStatus = m.telegramDeliveryStatus ?? "";
                  const delivered = deliveryStatus.includes("delivered");
                  const archived = archivedByBatch.get(m.batchId);
                  return (
                    <tr key={m.batchId} className="border-b border-border/60 last:border-0 hover:bg-card-hover">
                      <td className="px-4 py-2.5 font-mono text-[11px] tracking-[0.02em] text-foreground">{m.batchId}</td>
                      <td className="px-4 py-2.5 font-mono text-[11px] tracking-[0.02em] text-muted-foreground">{formatIST(m.generatedAt ?? null)}</td>
                      <td className="px-4 py-2.5 font-mono text-[13px] tabular-nums tracking-[-0.02em] text-foreground">{m.leadCount ?? "—"}</td>
                      <td className="px-4 py-2.5 font-mono text-[13px] tabular-nums tracking-[-0.02em] text-foreground">{m.emailReadyCount ?? "—"}</td>
                      <td className="px-4 py-2.5">
                        {deliveryStatus ? (
                          <StatusPill state={delivered ? "connected" : "queued"} />
                        ) : (
                          <span className="font-mono text-[11px] tracking-[0.02em] text-muted-foreground">—</span>
                        )}
                        {!delivered && deliveryStatus ? (
                          <span className="mt-1 block font-mono text-[11px] tracking-[0.02em] text-muted-foreground">{deliveryStatus}</span>
                        ) : null}
                      </td>
                      <td className="px-4 py-2.5">
                        <span className="flex gap-1.5 font-mono text-[11px]">
                          {m.pdfPath ? (
                            <a className="rounded-lg border border-border/80 px-2 py-0.5 font-mono text-[11px] uppercase tracking-[0.08em] hover:bg-muted/50" href={`/api/reports/${m.batchId}/file?type=pdf`}>
                              PDF
                            </a>
                          ) : (
                            <span className="font-mono text-[11px] tracking-[0.02em] text-muted-foreground/60">no PDF</span>
                          )}
                          {m.excelPath ? (
                            <a className="rounded-lg border border-border/80 px-2 py-0.5 font-mono text-[11px] uppercase tracking-[0.08em] hover:bg-muted/50" href={`/api/reports/${m.batchId}/file?type=xlsx`}>
                              XLSX
                            </a>
                          ) : (
                            <span className="font-mono text-[11px] tracking-[0.02em] text-muted-foreground/60">no XLSX</span>
                          )}
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        {archived && (archived.pdf || archived.xlsx) ? (
                          <span className="inline-block rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-1.5 py-0.5 font-mono text-[11px] uppercase tracking-[0.08em] text-emerald-700" title="Durable Waves-held copy — survives restarts and deployments">
                            stored{archived.pdf && archived.xlsx ? "" : archived.pdf ? " · pdf" : " · xlsx"}
                          </span>
                        ) : (
                          <span className="inline-block rounded-lg border border-amber-500/20 bg-amber-500/10 px-1.5 py-0.5 font-mono text-[11px] uppercase tracking-[0.08em] text-amber-700" title="Only on the engine host — download once or use Resend to archive durably">
                            engine-only
                          </span>
                        )}
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
