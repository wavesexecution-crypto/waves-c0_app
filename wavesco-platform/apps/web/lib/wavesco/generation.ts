import { spawn } from "node:child_process";
import { appendFileSync, existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { withTenantContext } from "@wavesco/db";
import {
  leadEngineMode,
  leadEngineRoot,
  pythonExe,
  runsDir,
  listBatchManifests,
  startGenerationRemote,
  getLastEngineRun,
} from "./lead-engine";
import {
  onCycleStarted,
  onLeadGenerationCompleted,
  onLeadReportReady,
} from "./notify";
import { logEngineError } from "./engine-errors";

/**
 * Spawns the REAL Lead Engine CLI (run.py) as a detached child process
 * and tracks progress in the tenant-scoped GenerationBatch table.
 * The engine pipeline (research → verify → score → export → deliver)
 * is never reimplemented here — we only observe it.
 */

export interface GenerationParams {
  requestedCount: number;
  location?: string;
  category?: string;
  tier?: string;
  minScore?: number;
}

const STAGE_RULES: { match: RegExp; stage: string }[] = [
  { match: /delivery|telegram|notify hub|sendDocument/i, stage: "delivering" },
  { match: /excel|outreach workbook|xlsx|PDF report|platypus/i, stage: "generating_report" },
  { match: /\bai\b|enrich|gpt-4o/i, stage: "scoring" },
  { match: /deep research|verify|tavily extract|website probe/i, stage: "verifying" },
  { match: /discovery|sweep|search|ddg|candidate/i, stage: "researching" },
];

export function logFileFor(requestId: string): string {
  return join(runsDir(), `web-${requestId}.log`);
}

/**
 * Fire client milestone notifications once a GenerationBatch is confirmed
 * completed (REAL transition). Idempotency is keyed per-batch via a
 * deterministic deduplication suffix, so safe across worker retries and the
 * multiple completion code paths.
 */
function notifyGenerationMilestones(args: {
  tenantId: string;
  requestId: string;
  resultLeadCount: number | null;
  emailReadyCount: number | null;
  pdfPath: string | null;
  excelPath: string | null;
}): void {
  const suffix = `batch-${args.requestId}`;
  onLeadGenerationCompleted(
    args.tenantId,
    undefined,
    {
      leadCount: args.resultLeadCount ?? undefined,
      qualifiedCount: args.emailReadyCount ?? undefined,
    },
    undefined,
    suffix,
  );
  // Report is only "ready" when it was actually generated & stored.
  if (args.pdfPath || args.excelPath) {
    onLeadReportReady(args.tenantId, undefined, {}, undefined, suffix);
  }
}

function tailFile(path: string, maxBytes = 4000): string | null {
  if (!existsSync(path)) return null;
  try {
    const size = statSync(path).size;
    const start = Math.max(0, size - maxBytes);
    const buf = readFileSync(path);
    return buf.subarray(start).toString("utf8").slice(-maxBytes);
  } catch {
    return null;
  }
}

export function deriveStage(logTail: string | null): string | null {
  if (!logTail) return null;
  for (const rule of STAGE_RULES) {
    const lines = logTail.trimEnd().split(/\r?\n/);
    for (let i = lines.length - 1; i >= Math.max(0, lines.length - 40); i--) {
      const line = lines[i];
      if (line !== undefined && rule.match.test(line)) return rule.stage;
    }
  }
  return null;
}

/**
 * Starts a generation run. Returns the requestId used to track status,
 * or an error describing why the engine could not be started.
 * In remote mode (Vercel) the engine is driven via its HTTP API; no
 * filesystem or venv is required.
 */
export async function startGeneration(
  tenantId: string,
  userId: string,
  params: GenerationParams,
): Promise<{ ok: true; requestId: string } | { ok: false; error: string }> {
  // ------------------------------------------------------------------
  // Remote mode: drive the engine via HTTP API (production / Vercel)
  // ------------------------------------------------------------------
  if (leadEngineMode() === "remote") {
    const requestId = `gen_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
    const logPath = logFileFor(requestId);

    await withTenantContext(tenantId, async (tx) => {
      await tx.generationBatch.create({
        data: {
          tenantId,
          requestId,
          params: { ...params, logFile: logPath } as never,
          status: "queued",
          requestedCount: params.requestedCount,
        },
      });
    });

    const remote = await startGenerationRemote(params.requestedCount);
    if (!remote.started) {
      logEngineError("generation:remote-start", remote.error ?? "remote start failed");
      const msg = "Lead research couldn't start — it's temporarily unavailable.";
      await withTenantContext(tenantId, async (tx) => {
        await tx.generationBatch.update({
          where: { requestId },
          data: { status: "failed", error: msg, finishedAt: new Date() },
        });
      });
      return { ok: false, error: msg };
    }

    await withTenantContext(tenantId, async (tx) => {
      await tx.generationBatch.update({
        where: { requestId },
        data: { status: "running", startedAt: new Date(), params: { ...params, logFile: logPath } as never },
      });
    });

    // Real transition: batch is now running — the acquisition cycle started working.
    onCycleStarted(tenantId, undefined, undefined, `batch-${requestId}`);

    // Poll the remote engine for completion without blocking the request.
    monitorGenerationRemote(requestId, tenantId);
    return { ok: true, requestId };
  }

  // ------------------------------------------------------------------
  // Local mode: spawn the Python CLI directly (development)
  // ------------------------------------------------------------------
  const py = pythonExe();
  const script = join(leadEngineRoot(), "run.py");
  if (!existsSync(py)) {
    logEngineError("generation:local-env", `venv missing at ${py}`);
    return { ok: false, error: "Lead research can't start here right now." };
  }
  if (!existsSync(script)) {
    logEngineError("generation:local-env", `run script missing at ${script}`);
    return { ok: false, error: "Lead research can't start here right now." };
  }

  const requestId = `gen_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
  const logPath = logFileFor(requestId);

  await withTenantContext(tenantId, async (tx) => {
    await tx.generationBatch.create({
      data: {
        tenantId,
        requestId,
        params: { ...params, logFile: logPath } as never,
        status: "queued",
        requestedCount: params.requestedCount,
      },
    });
  });

  const args = ["run.py", "--limit", String(Math.min(Math.max(params.requestedCount, 1), 60))];
  try {
    // Detached spawn: the engine may take many minutes. We do NOT wait.
    const child = spawn(py, args, {
      cwd: leadEngineRoot(),
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      env: { ...process.env, PYTHONIOENCODING: "utf-8" },
    });

    const write = (chunk: Buffer | string): void => {
      try {
        appendFileSync(logPath, chunk.toString());
      } catch {
        // best-effort logging
      }
    };
    child.stdout.on("data", write);
    child.stderr.on("data", write);

    child.unref();

    const pid = child.pid ?? null;
    await withTenantContext(tenantId, async (tx) => {
      await tx.generationBatch.update({
        where: { requestId },
        data: { status: "running", startedAt: new Date(), params: { ...params, logFile: logPath, pid } as never },
      });
    });

    // Real transition: the engine process is running — cycle started working.
    onCycleStarted(tenantId, undefined, undefined, `batch-${requestId}`);

    monitorGeneration(requestId, tenantId, pid);
    return { ok: true, requestId };
  } catch (e) {
    logEngineError("generation:spawn", e);
    const message = "Lead research couldn't start — please try again.";
    await withTenantContext(tenantId, async (tx) => {
      await tx.generationBatch.update({
        where: { requestId },
        data: { status: "failed", error: message, finishedAt: new Date() },
      });
    });
    return { ok: false, error: message };
  }
}

/** In-process watcher that closes the batch row when the engine exits. */
const watched = new Set<string>();

export function monitorGenerationRemote(requestId: string, tenantId: string): void {
  if (watched.has(requestId)) return;
  watched.add(requestId);
  let checks = 0;
  const timer = setInterval(() => {
    void (async () => {
      checks++;
      try {
        const batch = await withTenantContext(tenantId, (tx) =>
          tx.generationBatch.findUnique({ where: { requestId } }),
        );
        if (batch?.status !== "running") {
          clearInterval(timer);
          watched.delete(requestId);
          return;
        }
        const last = await getLastEngineRun().catch(() => undefined);
        const tail: string | null =
          (last as unknown as { log_tail?: string | null } | undefined)?.log_tail
          ?? (last as unknown as { logTail?: string | null } | undefined)?.logTail
          ?? null;
      const manifest = await newestManifestAfter(batch.startedAt ?? batch.createdAt);
      if (tail) {
        await withTenantContext(tenantId, (tx) =>
          tx.generationBatch.update({ where: { requestId }, data: { logTail: tail.slice(-2000) } }),
        );
      }
      if (manifest) {
        await withTenantContext(tenantId, (tx) =>
          tx.generationBatch.update({
            where: { requestId },
            data: {
              status: "completed",
              stage: "completed",
              engineBatchId: manifest.batchId,
              resultLeadCount: manifest.leadCount ?? null,
              emailReadyCount: manifest.emailReadyCount ?? null,
              pdfPath: manifest.pdfPath ?? null,
              excelPath: manifest.excelPath ?? null,
              finishedAt: new Date(),
              logTail: tail?.slice(-2000) ?? batch.logTail,
            },
          }),
        );
        // Real transition: batch confirmed completed with its report stored.
        notifyGenerationMilestones({
          tenantId,
          requestId,
          resultLeadCount: manifest.leadCount ?? null,
          emailReadyCount: manifest.emailReadyCount ?? null,
          pdfPath: manifest.pdfPath ?? null,
          excelPath: manifest.excelPath ?? null,
        });
        clearInterval(timer);
        watched.delete(requestId);
        return;
      }
      if (checks > 180) {
        await withTenantContext(tenantId, (tx) =>
          tx.generationBatch.update({
            where: { requestId },
            data: {
              status: "failed",
              error: "Engine did not produce a manifest within 30 minutes.",
              finishedAt: new Date(),
            },
          }),
        );
        clearInterval(timer);
        watched.delete(requestId);
      }
    } catch {
      if (checks > 180) {
        clearInterval(timer);
        watched.delete(requestId);
      }
    }
    })();
  }, 10_000);
  timer.unref();
}

export function monitorGeneration(requestId: string, tenantId: string, pid: number | null): void {
  if (watched.has(requestId)) return;
  watched.add(requestId);

  let alive = true;
  if (pid) {
    try {
      process.kill(pid, 0);
    } catch {
      alive = false;
    }
  }
  if (!alive) {
    void finalizeIfComplete(tenantId, requestId);
    watched.delete(requestId);
    return;
  }

  const timer = setInterval(() => {
    let running = false;
    if (pid) {
      try {
        process.kill(pid, 0);
        running = true;
      } catch {
        running = false;
      }
    }
    if (!running) {
      clearInterval(timer);
      watched.delete(requestId);
      void finalizeIfComplete(tenantId, requestId);
    }
  }, 10_000);
  timer.unref();
}

async function finalizeIfComplete(tenantId: string, requestId: string): Promise<void> {
  await withTenantContext(tenantId, async (tx) => {
    const batch = await tx.generationBatch.findUnique({ where: { requestId } });
    if (!batch || batch.status === "completed" || batch.status === "failed") return;

    let tail: string | null = null;
    if (leadEngineMode() === "remote") {
      try {
        const last = await getLastEngineRun();
        tail =
          (last as unknown as { log_tail?: string | null } | undefined)?.log_tail
          ?? (last as unknown as { logTail?: string | null } | undefined)?.logTail
          ?? null;
      } catch {
        tail = null;
      }
    } else {
      tail = tailFile(batch.params && (batch.params as { logFile?: string }).logFile ? (batch.params as { logFile: string }).logFile : "");
    }
    const manifest = await newestManifestAfter(batch.startedAt ?? batch.createdAt);

    if (manifest) {
      await tx.generationBatch.update({
        where: { requestId },
        data: {
          status: "completed",
          stage: "completed",
          engineBatchId: manifest.batchId,
          resultLeadCount: manifest.leadCount ?? null,
          emailReadyCount: manifest.emailReadyCount ?? null,
          pdfPath: manifest.pdfPath ?? null,
          excelPath: manifest.excelPath ?? null,
          finishedAt: new Date(),
          logTail: tail?.slice(-2000) ?? null,
        },
      });
      // Real transition: batch confirmed completed with its report stored.
      notifyGenerationMilestones({
        tenantId,
        requestId,
        resultLeadCount: manifest.leadCount ?? null,
        emailReadyCount: manifest.emailReadyCount ?? null,
        pdfPath: manifest.pdfPath ?? null,
        excelPath: manifest.excelPath ?? null,
      });
    } else {
      await tx.generationBatch.update({
        where: { requestId },
        data: {
          status: "failed",
          error: "Engine exited without producing a batch manifest.",
          finishedAt: new Date(),
          logTail: tail?.slice(-2000) ?? null,
        },
      });
    }
  });
}

async function newestManifestAfter(since: Date): Promise<{ batchId: string; generatedAt?: string; leadCount?: number; emailReadyCount?: number; pdfPath?: string; excelPath?: string } | undefined> {
  const all = await listBatchManifests();
  return all.find((m) => {
    const t = m.generatedAt ? new Date(m.generatedAt).getTime() : 0;
    return t >= since.getTime() - 5000;
  });
}
