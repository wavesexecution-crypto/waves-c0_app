/**
 * Server-only access layer for the WavesCo Lead Engine.
 *
 * DUAL MODE — selected by LEAD_ENGINE_MODE:
 *   "local"  (default, development): read the engine's SQLite corpus and
 *            spawn its CLI directly. Requires filesystem access.
 *   "remote" (production): call the engine's authenticated HTTP API
 *            (serve.py) via LEAD_ENGINE_API_URL + LEAD_ENGINE_API_TOKEN.
 *            No filesystem or venv assumptions.
 *
 * Every exported function keeps the same signature in both modes so
 * pages and actions never care which mode is active.
 */
import { DatabaseSync } from "node:sqlite";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  EngineHttpError,
  EngineUnavailableError,
  logEngineError,
} from "./engine-errors";

export { EngineHttpError, EngineUnavailableError };

const execFileAsync = promisify(execFile);

/** Bindable SQLite value types accepted by node:sqlite. */
type SqlArg = string | number | bigint | null;

type EngineMode = "local" | "remote";

function mode(): EngineMode {
  return process.env.LEAD_ENGINE_MODE === "remote" ? "remote" : "local";
}

export function leadEngineMode(): EngineMode {
  return mode();
}

function apiUrl(): string {
  return (process.env.LEAD_ENGINE_API_URL ?? "").replace(/\/+$/, "");
}

function apiToken(): string {
  return process.env.LEAD_ENGINE_API_TOKEN ?? "";
}

async function apiGet<T>(path: string): Promise<T> {
  const base = apiUrl();
  // Never fetch a relative URL: an empty base would hit the Next app itself
  // and surface its HTML 404 page as an "engine" error.
  if (!base) throw new EngineUnavailableError("remote engine URL not configured");
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, {
      headers: { authorization: `Bearer ${apiToken()}`, "ngrok-skip-browser-warning": "true" },
      cache: "no-store",
    });
  } catch (e) {
    logEngineError(`GET ${path}`, e);
    throw new EngineUnavailableError();
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    logEngineError(`GET ${path}`, new EngineHttpError(res.status, body.slice(0, 200)));
    throw new EngineHttpError(res.status, body.slice(0, 200));
  }
  return (await res.json()) as T;
}

async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const base = apiUrl();
  if (!base) throw new EngineUnavailableError("remote engine URL not configured");
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiToken()}`,
        "content-type": "application/json",
        "ngrok-skip-browser-warning": "true",
      },
      body: JSON.stringify(body),
      cache: "no-store",
    });
  } catch (e) {
    logEngineError(`POST ${path}`, e);
    throw new EngineUnavailableError();
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    logEngineError(`POST ${path}`, new EngineHttpError(res.status, text.slice(0, 200)));
    throw new EngineHttpError(res.status, text.slice(0, 200));
  }
  return (await res.json()) as T;
}

/** Non-throwing probe used by callers that need a graceful degraded state. */
export async function remoteAvailability(): Promise<{ available: boolean; detail: string }> {
  if (mode() !== "remote") return { available: true, detail: "local mode" };
  try {
    const j = await apiGet<{ ok: boolean }>("/health");
    const healthy = j.ok;
    return { available: healthy, detail: healthy ? "reachable" : "unhealthy" };
  } catch (e) {
    logEngineError("GET /health", e);
    return { available: false, detail: "unreachable" };
  }
}

/**
 * Server-only access layer for the existing WavesCo Lead Engine.
 * The engine owns the lead corpus; this module reads it live and writes
 * back only outreach state columns. The engine itself is never duplicated.
 */

export function leadEngineRoot(): string {
  return process.env.LEAD_ENGINE_ROOT ?? "D:\\wavesco-lead-engine";
}

function dbPath(): string {
  return join(leadEngineRoot(), "data", "leads.db");
}

export function runsDir(): string {
  return join(leadEngineRoot(), "data", "runs");
}

export function pythonExe(): string {
  return join(leadEngineRoot(), ".venv", "Scripts", "python.exe");
}

export function openReadonly(): DatabaseSync {
  const db = new DatabaseSync(dbPath(), { readOnly: true });
  return db;
}

function openWritable(): DatabaseSync {
  const db = new DatabaseSync(dbPath());
  db.exec("PRAGMA busy_timeout = 3000");
  return db;
}

// ------------------------------------------------------------------
// Row shapes (subset of engine schema that the UI consumes)
// ------------------------------------------------------------------

export interface EngineLead {
  id: number;
  business: string;
  category: string | null;
  area: string | null;
  city: string | null;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  website: string | null;
  instagram: string | null;
  rating: number | null;
  reviews: number | null;
  digital_score: number | null;
  lead_score: number | null;
  tier: string | null;
  problem: string | null;
  opportunity: string | null;
  reason: string | null;
  outreach_angle: string | null;
  source_urls: string | null;
  verification: string | null;
  site_class: string | null;
  status: string;
  email_status: string | null;
  date_contacted: string | null;
  reply_status: string | null;
  opted_out: number | null;
  bounced: number | null;
  next_follow_up: string | null;
  name_key: string;
  batch_id: string | null;
  first_discovered: string | null;
  last_researched: string | null;
  digital_assessment?: string | null;
  wavesco_service?: string | null;
  business_summary?: string | null;
  personalization_context?: string | null;
  ai_confidence?: number | null;
  ai_model?: string | null;
  contact_name?: string | null;
  role?: string | null;
  decision_maker?: string | null;
  qualification?: string | null;
  notes?: string | null;
}

export interface LeadStats {
  total: number;
  byTier: Record<string, number>;
  newLast7d?: number;
  emailReady: number;
  contacted: number;
  optedOut: number;
  bounced: number;
  replies: number;
  lastResearchedAt: string | null;
}

interface ApiStatsResponse {
  ok: boolean;
  stats: {
    total: number;
    byTier: Record<string, number>;
    newLast7d: number;
    emailReady: number;
    contacted: number;
    optedOut: number;
    bounced: number;
    replies: number;
  };
}

interface ApiLeadsResponse {
  ok: boolean;
  rows: Record<string, unknown>[];
  total: number;
  page: number;
  pageSize: number;
}

interface ApiCandidatesResponse {
  ok: boolean;
  candidates: {
    nameKey: string;
    business: string;
    email: string | null;
    emailVerified: boolean;
    contacted: boolean;
    optedOut: boolean;
    bounced: boolean;
    replied: boolean;
    tier: string | null;
    category: string | null;
    city: string | null;
  }[];
}

interface ApiRunResponse {
  ok: boolean;
  run: {
    id: string;
    batch_id: string | null;
    status: string | null;
    added: number | null;
    discovered: number | null;
    report_path: string | null;
    telegram_status: string | null;
    started_at: string | null;
    finished_at: string | null;
  } | null;
  logTail: string | null;
}

export async function getLeadStats(): Promise<LeadStats> {
  if (mode() === "remote") {
    const j = await apiGet<ApiStatsResponse>("/stats");
    return { ...j.stats, lastResearchedAt: null };
  }
  const db = openReadonly();
  try {
    const total = (db.prepare("SELECT count(*) c FROM leads").get() as { c: number }).c;
    const tiers = db
      .prepare("SELECT tier t, count(*) c FROM leads WHERE tier IN ('A','B','C') GROUP BY tier")
      .all() as { t: string | null; c: number }[];
    const byTier: Record<string, number> = {};
    for (const row of tiers) if (row.t) byTier[row.t] = row.c;
    const one = (sql: string): number =>
      (db.prepare(sql).get() as { c: number }).c;
    const last = db
      .prepare(
        "SELECT MAX(COALESCE(last_researched, first_discovered)) m FROM leads WHERE last_researched IS NOT NULL OR first_discovered IS NOT NULL",
      )
      .get() as { m: string | null };
    return {
      total,
      byTier,
      newLast7d: one(
        "SELECT count(*) FROM leads WHERE COALESCE(first_discovered,last_researched) >= datetime('now','-7 days')",
      ),
      emailReady: one(
        "SELECT count(*) FROM leads WHERE email IS NOT NULL AND TRIM(email)<>'' "
        + "AND UPPER(COALESCE(email_status,'')) LIKE '%VERIFIED%' "
        + "AND COALESCE(opted_out,0)=0 AND date_contacted IS NULL",
      ),
      contacted: one("SELECT count(*) FROM leads WHERE date_contacted IS NOT NULL"),
      optedOut: one("SELECT count(*) FROM leads WHERE COALESCE(opted_out,0)=1"),
      bounced: one("SELECT count(*) FROM leads WHERE COALESCE(bounced,0)=1"),
      replies: one(
        "SELECT count(*) FROM leads WHERE reply_status IS NOT NULL AND TRIM(reply_status)<>''",
      ),
      lastResearchedAt: last.m,
    };
  } finally {
    db.close();
  }
}

export interface ListLeadsParams {
  search?: string;
  tier?: string;
  category?: string;
  city?: string;
  emailStatus?: string;
  outreach?: "contacted" | "uncontacted" | "opted_out" | "replied";
  verification?: string;
  sort?: "score" | "recent" | "business";
  page?: number;
  pageSize?: number;
}

export interface ListLeadsResult {
  rows: EngineLead[];
  total: number;
  page: number;
  pageSize: number;
}

export async function listLeads(params: ListLeadsParams): Promise<ListLeadsResult> {
  if (mode() === "remote") {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== "") q.set(k, String(v));
    }
    const j = await apiGet<ApiLeadsResponse>(`/leads?${q.toString()}`);
    return {
      rows: j.rows as unknown as EngineLead[],
      total: j.total,
      page: j.page,
      pageSize: j.pageSize,
    };
  }
  const db = openReadonly();
  try {
    const where: string[] = [];
    const args: SqlArg[] = [];
    if (params.search) {
      where.push(
        "(LOWER(business) LIKE ? OR LOWER(COALESCE(area,'')) LIKE ? OR LOWER(COALESCE(email,'')) LIKE ? OR phone LIKE ?)",
      );
      const like = `%${params.search.toLowerCase()}%`;
      args.push(like, like, like, like);
    }
    if (params.tier && params.tier !== "all") {
      where.push("tier = ?");
      args.push(params.tier);
    }
    if (params.category && params.category !== "all") {
      where.push("category = ?");
      args.push(params.category);
    }
    if (params.city && params.city !== "all") {
      where.push("city = ?");
      args.push(params.city);
    }
    if (params.emailStatus && params.emailStatus !== "all") {
      where.push("UPPER(COALESCE(email_status,'')) LIKE ?");
      args.push(`%${params.emailStatus.toUpperCase()}%`);
    }
    switch (params.outreach) {
      case "contacted":
        where.push("date_contacted IS NOT NULL");
        break;
      case "uncontacted":
        where.push("date_contacted IS NULL");
        break;
      case "opted_out":
        where.push("COALESCE(opted_out,0) = 1");
        break;
      case "replied":
        where.push("reply_status IS NOT NULL AND TRIM(reply_status) <> ''");
        break;
      default:
        break;
    }
    const wsql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
    const orderSql =
      params.sort === "recent"
        ? "ORDER BY COALESCE(last_researched, first_discovered) DESC"
        : params.sort === "business"
          ? "ORDER BY business ASC"
          : "ORDER BY COALESCE(lead_score, 0) DESC";
    const pageSize = Math.min(Math.max(params.pageSize ?? 25, 5), 100);
    const page = Math.max(params.page ?? 1, 1);
    const offset = (page - 1) * pageSize;
    const total = (
      db.prepare(`SELECT count(*) c FROM leads ${wsql}`).get(...args) as { c: number }
    ).c;
    const rows = db
      .prepare(`SELECT * FROM leads ${wsql} ${orderSql} LIMIT ? OFFSET ?`)
      .all(...args, pageSize, offset) as unknown as EngineLead[];
    return { rows, total, page, pageSize };
  } finally {
    db.close();
  }
}

export async function getLead(nameKey: string): Promise<EngineLead | undefined> {
  const res = await listLeads({ search: nameKey, page: 1, pageSize: 5 });
  return res.rows.find((r) => r.name_key === nameKey);
}

export async function getFacets(): Promise<{ categories: string[]; cities: string[] }> {
  if (mode() === "remote") {
    const j = await apiGet<{ ok: boolean; categories: string[]; cities: string[] }>("/facets");
    return { categories: j.categories, cities: j.cities };
  }
  const db = openReadonly();
  try {
    const cats = db
      .prepare("SELECT DISTINCT category c FROM leads WHERE category IS NOT NULL ORDER BY c")
      .all() as { c: string }[];
    const cities = db
      .prepare("SELECT DISTINCT city c FROM leads WHERE city IS NOT NULL ORDER BY c")
      .all() as { c: string }[];
    return { categories: cats.map((r) => r.c), cities: cities.map((r) => r.c) };
  } finally {
    db.close();
  }
}

export async function getCountsBy(column: "category" | "city" | "tier"): Promise<Record<string, number>> {
  if (mode() === "remote") {
    const j = await apiGet<{ ok: boolean; counts: Record<string, number> }>(
      `/groupby?column=${column}`,
    );
    return j.counts;
  }
  const allowed = { category: "category", city: "city", tier: "tier" } as const;
  const col = allowed[column];
  const db = openReadonly();
  try {
    const rows = db
      .prepare(`SELECT ${col} k, count(*) c FROM leads WHERE ${col} IS NOT NULL GROUP BY ${col}`)
      .all() as { k: string; c: number }[];
    return Object.fromEntries(rows.map((r) => [r.k, r.c]));
  } finally {
    db.close();
  }
}

export async function updateLeadOutreachState(
  nameKey: string,
  fields: {
    email_status?: string;
    date_contacted?: string | null;
    reply_status?: string | null;
    opted_out?: boolean;
    bounced?: boolean;
    next_follow_up?: string | null;
  },
): Promise<void> {
  if (mode() === "remote") {
    await apiPost("/outreach", { nameKey, fields });
    return;
  }
  const sets: string[] = [];
  const args: SqlArg[] = [];
  for (const [k, v] of Object.entries(fields)) {
    
    sets.push(`${k} = ?`);
    args.push(v as SqlArg);
  }
  if (sets.length === 0) return;
  const db = openWritable();
  try {
    db.prepare(`UPDATE leads SET ${sets.join(", ")} WHERE name_key = ?`).run(...args, nameKey);
  } finally {
    db.close();
  }
}

export interface BatchManifest {
  batchId: string;
  generatedAt?: string;
  leadCount?: number;
  emailReadyCount?: number;
  pdfPath?: string;
  excelPath?: string;
  telegramDeliveryStatus?: string;
  [k: string]: unknown;
}

export async function listBatchManifests(): Promise<BatchManifest[]> {
  if (mode() === "remote") {
    const j = await apiGet<{ ok: boolean; manifests: BatchManifest[] }>("/manifests");
    return j.manifests.map((m) => ({
      batchId: m.batchId,
      generatedAt: m.generatedAt,
      leadCount: m.leadCount,
      emailReadyCount: m.emailReadyCount,
      pdfPath: m.pdfPath,
      excelPath: m.excelPath,
      telegramDeliveryStatus: m.telegramDeliveryStatus,
    }));
  }
  const dir = runsDir();
  if (!existsSync(dir)) return [];
  const out: BatchManifest[] = [];
  for (const entry of readdirSync(dir)) {
    if (!entry.endsWith(".json")) continue;
    try {
      out.push(JSON.parse(readFileSync(join(dir, entry), "utf8")) as BatchManifest);
    } catch {
      // unreadable manifest — skip
    }
  }
  out.sort((a, b) => (b.generatedAt ?? "").localeCompare(a.generatedAt ?? ""));
  return out;
}

export async function getBatchManifest(batchId: string): Promise<BatchManifest | undefined> {
  const all = await listBatchManifests();
  return all.find((m) => m.batchId === batchId);
}

/** Streams a report file from the engine host. Remote mode only —
 * local mode reads the filesystem directly via the reports file route. */
export async function fetchManifestFile(
  batchId: string,
  type: "pdf" | "xlsx" | "excel",
): Promise<{ ok: true; body: ArrayBuffer; contentType: string; filename: string } | { ok: false; error: string }> {
  const res = await fetch(
    `${apiUrl()}/manifests/${encodeURIComponent(batchId)}/file?type=${type}`,
    { headers: { authorization: `Bearer ${apiToken()}` }, cache: "no-store" },
  );
  if (!res.ok) {
    return { ok: false, error: `engine file fetch ${res.status}` };
  }
  const cd = res.headers.get("content-disposition") ?? "";
  const m = /filename="?([^";]+)"?/.exec(cd);
  return {
    ok: true,
    body: await res.arrayBuffer(),
    contentType: res.headers.get("content-type") ?? "application/octet-stream",
    filename: m?.[1] ?? `${batchId}.${type}`,
  };
}

export interface ScheduledTaskInfo {
  taskName: string;
  state: string;
  nextRunTime: string | null;
  lastRunTime: string | null;
  lastResult: string | null;
}

export async function getScheduledTaskInfo(): Promise<ScheduledTaskInfo | null> {
  // Windows Task Scheduler is a local-machine concept; in remote mode the
  // engine host's scheduler is not observable from here.
  if (mode() === "remote") return null;
  if (schedCache && Date.now() - schedCache.at < 30_000) return schedCache.data;
  try {
    const { stdout } = await execFileAsync(
      "powershell.exe",
      [
        "-NoProfile",
        "-Command",
        `$t = Get-ScheduledTask -TaskName 'WavesCo Lead Engine' -ErrorAction Stop; `
        + `$i = $t | Get-ScheduledTaskInfo; `
        + `[pscustomobject]@{ state = $t.State; `
        + `nextRunTime = $(if ($i.NextRunTime) { ([datetime]$i.NextRunTime).ToString('yyyy-MM-dd HH:mm') } else { $null }); `
        + `lastRunTime = $(if ($i.LastRunTime) { ([datetime]$i.LastRunTime).ToString('yyyy-MM-dd HH:mm') } else { $null }); `
        + `lastResult = [string]$i.LastTaskResult } | ConvertTo-Json -Compress`,
      ],
      { timeout: 10_000 },
    );
    const parsed = JSON.parse(stdout) as Omit<ScheduledTaskInfo, "taskName">;
    schedCache = { at: Date.now(), data: { taskName: "WavesCo Lead Engine", ...parsed } };
    return schedCache.data;
  } catch {
    schedCache = { at: Date.now(), data: null };
    return null;
  }
}

let schedCache: { at: number; data: ScheduledTaskInfo | null } | null = null;

// ------------------------------------------------------------------
// Campaign audience selection (reads the REAL corpus)
// ------------------------------------------------------------------

export interface CampaignCandidate {
  nameKey: string;
  business: string;
  email: string | null;
  emailVerified: boolean;
  contacted: boolean;
  optedOut: boolean;
  bounced: boolean;
  replied: boolean;
  tier: string | null;
  category: string | null;
  city: string | null;
}

export interface CandidateFilters {
  location?: string;
  category?: string;
  tier?: string;
}

export async function selectCampaignCandidates(
  filters: CandidateFilters,
): Promise<CampaignCandidate[]> {
  if (mode() === "remote") {
    const q = new URLSearchParams();
    if (filters.location) q.set("location", filters.location);
    if (filters.category) q.set("category", filters.category);
    if (filters.tier) q.set("tier", filters.tier);
    const j = await apiGet<ApiCandidatesResponse>(`/candidates?${q.toString()}`);
    return j.candidates;
  }
  const db = openReadonly();
  try {
    const where: string[] = [];
    const args: SqlArg[] = [];
    if (filters.location && filters.location !== "all") {
      where.push("(city = ? OR area = ?)");
      args.push(filters.location, filters.location);
    }
    if (filters.category && filters.category !== "all") {
      where.push("category = ?");
      args.push(filters.category);
    }
    if (filters.tier && filters.tier !== "all") {
      where.push("tier = ?");
      args.push(filters.tier);
    }
    const wsql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
    const rows = db
      .prepare(
        `SELECT name_key,business,email,
           CASE WHEN UPPER(COALESCE(email_status,'')) LIKE '%VERIFIED%' THEN 1 ELSE 0 END AS verified,
           CASE WHEN date_contacted IS NOT NULL THEN 1 ELSE 0 END AS contacted,
           COALESCE(opted_out,0) AS opted_out,
           COALESCE(bounced,0) AS bounced,
           CASE WHEN reply_status IS NOT NULL AND TRIM(reply_status)<>'' 
                AND LOWER(reply_status) NOT IN ('none','no reply','no') THEN 1 ELSE 0 END AS replied,
           tier,category,city
         FROM leads ${wsql} ORDER BY COALESCE(lead_score,0) DESC`,
      )
      .all(...args) as { name_key: string; business: string; email: string | null;
        verified: number; contacted: number; opted_out: number; bounced: number;
        replied: number; tier: string | null; category: string | null; city: string | null }[];
    return rows.map((r) => ({
      nameKey: r.name_key,
      business: r.business,
      email: r.email ?? null,
      emailVerified: !!r.verified,
      contacted: !!r.contacted,
      optedOut: !!r.opted_out,
      bounced: !!r.bounced,
      replied: !!r.replied,
      tier: r.tier,
      category: r.category,
      city: r.city,
    }));
  } finally {
    db.close();
  }
}

// ------------------------------------------------------------------
// Generation runs (local: spawn CLI · remote: POST to engine API)
// ------------------------------------------------------------------

export interface LastRunInfo {
  id: string;
  batch_id: string | null;
  status: string | null;
  added: number | null;
  discovered: number | null;
  report_path: string | null;
  telegram_status: string | null;
  started_at: string | null;
  finished_at: string | null;
  log_tail?: string | null;
}

export async function getLastEngineRun(): Promise<LastRunInfo | undefined> {
  if (mode() === "remote") {
    const j = await apiGet<ApiRunResponse>("/runs/latest");
    if (!j.run) return undefined;
    return {
      id: j.run.id,
      batch_id: j.run.batch_id,
      status: j.run.status,
      added: j.run.added,
      discovered: j.run.discovered,
      report_path: j.run.report_path,
      telegram_status: j.run.telegram_status,
      started_at: j.run.started_at,
      finished_at: j.run.finished_at,
      log_tail: j.logTail,
    };
  }
  const db = openReadonly();
  try {
    const row = db
      .prepare(
        "SELECT id,batch_id,status,added,discovered,report_path,telegram_status,"
        + "started_at,finished_at FROM runs ORDER BY started_at DESC LIMIT 1",
      )
      .get() as LastRunInfo | undefined;
    return row;
  } finally {
    db.close();
  }
}

export interface StartGenerationResult {
  started: boolean;
  error?: string;
}

export async function startGenerationRemote(
  requestedCount: number,
): Promise<StartGenerationResult> {
  try {
    const j = await apiPost<{ ok: boolean; message?: string; error?: string }>(
      "/generate",
      { requestedCount },
    );
    const started: boolean = j.ok;
    return { started, error: j.error };
  } catch (e) {
    return { started: false, error: e instanceof Error ? e.message : "engine unreachable" };
  }
}