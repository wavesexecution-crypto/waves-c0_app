# Document Generation — Acquisition OS

## Artifact types

- **Batch report PDF** `GenerationBatch.pdfPath` (`reports/{batchId}.pdf`) via `engine/pdf_report.py` (18298 B) + helper `pdf.py` (2415 B).
- **Outreach pack XLSX** `GenerationBatch.excelPath` (`exports/{batchId}.xlsx`) via `engine/excel_outreach.py` (11595 B) + `sheets_sync.py` (5839 B, mode local → XLSX mirror).
- **Batch manifests** `data/runs/*.json` (`batchId, generatedAt, leadCount, emailReadyCount, pdfPath, excelPath, telegramDeliveryStatus`) via `listBatchManifests()`.

## Lifecycle

```
GenerationBatch queued (requestId @unique, requestedCount, params Json)
  → engine discovery+runs (batch_id, added/discovered) via discovery.py / research.py / scoring.py
  → report.py + pdf_report.py + excel_outreach.py produce artifacts
  → GenerationBatch completed|failed (resultLeadCount, emailReadyCount, engineBatchId, pdfPath/excelPath, logTail/error, finishedAt)
  → ActivityEvent type generation + IntegrationStatus lastOkAt
  → Notify Hub telegramDeliveryStatus
```

Lineage: `GenerationBatch.engineBatchId` ↔ `ActivityEvent.sourceKey` ↔ `LeadLifecycleEvent.batchId`.

## How to use

- **Generate:** `/acquisition/generate` (request `requestedCount=25` default `batch_size`) or `POST /api/acquisition/documents/generate { batchId }` (validates `GenerationBatch` exists, writes `AuditLog action documents.generate`).
- **View:** `/acquisition/reports` (Documents) — table `generated reports` (batchId, generatedAt, leadCount/emailReady, pdfPath/excelPath, lineage). CTA when empty: `Generate`.
- **Download:** `GET /api/reports/[batch]/file` streams PDF/XLSX with RLS (`auth() + withTenantContext`). Remote mode: `fetchManifestFile(batchId, pdf|xlsx)` proxies `GET /manifests/{id}/file?type=`.
- **Resend:** `resendReportAction` re-triggers `notify.py` bridge.
- **Inspect failure:** failed `GenerationBatch.error` + `logTail` shown on reports error drawer; System Errors section also surfaces `generationBatchesFailed` count.

## Remote vs local

- Local: reads `data/runs/*.json` manifests + `reports/` directly.
- Remote: `GET /manifests` + `GET /manifests/{id}/file?type=` Bearer `LEAD_ENGINE_API_TOKEN` (no tunnel-specific headers — Cloudflare Tunnel needs none). Missing `LEAD_ENGINE_API_URL` → `BLOCKED` in integrations/health, Docs shows empty state not 500.

## Operate

- Check `D:\wavesco-lead-engine\reports\` for local files.
- Verify via `listBatchManifests()` length + `getBatchManifest(batchId)` truthy.
- Tests: `tests/documents.test.ts` (generate 401/400/200 + AuditLog).

