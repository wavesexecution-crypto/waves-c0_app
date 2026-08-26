import { spawn } from "node:child_process";
import { appendFileSync, existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { withTenantContext } from "@wavesco/db";
import { leadEngineRoot, pythonExe, runsDir, listBatchManifests } from "./lead-engine";

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
 */
export async function startGeneration(
  tenantId: string,
  userId: string,
  params: GenerationParams,
): Promise<{ ok: true; requestId: string } | { ok: false; error: string }> {
  const py = pythonExe();
  const script = join(leadEngineRoot(), "run.py");
  if (!existsSync(py)) {
    return { ok: false, error: `Lead Engine venv not found at ${py}` };
  }
  if (!existsSync(script)) {
    return { ok: false, error: `run.py not found at ${script}` };
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

    monitorGeneration(requestId, tenantId, pid);
    return { ok: true, requestId };
  } catch (e) {
    const message = e instanceof Error ? e.message : "spawn failed";
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

    const tail = tailFile(batch.params && (batch.params as { logFile?: string }).logFile ? (batch.params as { logFile: string }).logFile : "");
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
