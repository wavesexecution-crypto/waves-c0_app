import { DatabaseSync } from "node:sqlite";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Bindable SQLite value types accepted by node:sqlite. */
type SqlArg = string | number | bigint | null;

/**
 * Server-only access layer for the existing WavesCo Lead Engine
 * (D:\wavesco-lead-engine). The engine owns the lead corpus in SQLite;
 * this module READS it live and writes back only outreach state columns.
 * The engine itself is never duplicated here.
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
  wavesco_service: string | null;
  digital_assessment: string | null;
  contact_name: string | null;
  role: string | null;
  decision_maker: string | null;
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
}

export interface LeadStats {
  total: number;
  byTier: Record<string, number>;
  newLast7d: number;
  emailReady: number;
  contacted: number;
  optedOut: number;
  bounced: number;
  replies: number;
  lastResearchedAt: string | null;
}

export function getLeadStats(): LeadStats {
  const db = openReadonly();
  try {
    const total = (db.prepare("SELECT count(*) c FROM leads").get() as { c: number }).c;
    const tiers = db
      .prepare("SELECT tier t, count(*) c FROM leads GROUP BY tier")
      .all() as { t: string | null; c: number }[];
    const byTier: Record<string, number> = {};
    for (const row of tiers) byTier[row.t ?? "?"] = row.c;

    const scalar = (sql: string): number => {
      const row = db.prepare(sql).get() as { c: number } | undefined;
      return row ? row.c : 0;
    };

    return {
      total,
      byTier,
      newLast7d: scalar(
        `SELECT count(*) c FROM leads
         WHERE first_discovered IS NOT NULL
           AND datetime(first_discovered) >= datetime('now', '-7 days')`,
      ),
      emailReady: scalar(
        `SELECT count(*) c FROM leads
         WHERE email IS NOT NULL AND TRIM(email) <> ''
           AND UPPER(COALESCE(email_status,'')) LIKE '%VERIFIED%'
           AND COALESCE(opted_out, 0) = 0
           AND date_contacted IS NULL`,
      ),
      contacted: scalar("SELECT count(*) c FROM leads WHERE date_contacted IS NOT NULL"),
      optedOut: scalar("SELECT count(*) c FROM leads WHERE COALESCE(opted_out,0) = 1"),
      bounced: scalar("SELECT count(*) c FROM leads WHERE COALESCE(bounced,0) = 1"),
      replies: scalar(
        `SELECT count(*) c FROM leads
         WHERE reply_status IS NOT NULL AND TRIM(reply_status) <> ''
           AND LOWER(reply_status) NOT IN ('none','no reply','no')`,
      ),
      lastResearchedAt: (() => {
        const row = db
          .prepare("SELECT MAX(last_researched) m FROM leads WHERE last_researched IS NOT NULL")
          .get() as { m: string | null } | undefined;
        return row ? (row.m ?? null) : null;
      })(),
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

export function listLeads(params: ListLeadsParams): ListLeadsResult {
  const db = openReadonly();
  try {
  const where: string[] = [];
  const args: SqlArg[] = [];

    if (params.search) {
      where.push(
        "(LOWER(business) LIKE ? OR LOWER(COALESCE(area,'')) LIKE ? OR LOWER(COALESCE(email,'')) LIKE ? OR phone LIKE ?)",
      );
      const q = `%${params.search.toLowerCase()}%`;
      args.push(q, q, q, q);
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
    if (params.verification && params.verification !== "all") {
      where.push("UPPER(COALESCE(verification,'')) LIKE ?");
      args.push(`%${params.verification.toUpperCase()}%`);
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
        where.push(
          "reply_status IS NOT NULL AND TRIM(reply_status) <> '' AND LOWER(reply_status) NOT IN ('none','no reply','no')",
        );
        break;
      default:
        break;
    }

    const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
    const orderSql =
      params.sort === "recent"
        ? "ORDER BY COALESCE(last_researched, first_discovered) DESC"
        : params.sort === "business"
          ? "ORDER BY business ASC"
          : "ORDER BY COALESCE(lead_score, 0) DESC";

    const pageSize = Math.min(Math.max(params.pageSize ?? 25, 5), 100);
    const page = Math.max(params.page ?? 1, 1);
    const offset = (page - 1) * pageSize;

    const total = (db.prepare(`SELECT count(*) c FROM leads ${whereSql}`).get(...args) as { c: number })
      .c;
    const rows = db
      .prepare(
        `SELECT * FROM leads ${whereSql} ${orderSql} LIMIT ? OFFSET ?`,
      )
      .all(...args, pageSize, offset) as unknown as EngineLead[];

    return { rows, total, page, pageSize };
  } finally {
    db.close();
  }
}

export function getLead(nameKey: string): EngineLead | undefined {
  const db = openReadonly();
  try {
    return db.prepare("SELECT * FROM leads WHERE name_key = ?").get(nameKey) as
      | EngineLead
      | undefined;
  } finally {
    db.close();
  }
}

/** Distinct categories/cities present in the corpus (for filters). */
export function getFacets(): { categories: string[]; cities: string[] } {
  const db = openReadonly();
  try {
    const cats = db
      .prepare("SELECT DISTINCT category c FROM leads WHERE category IS NOT NULL ORDER BY c")
      .all() as { c: string }[];
    const cities = db
      .prepare("SELECT DISTINCT city c FROM leads WHERE city IS NOT NULL ORDER BY c")
      .all() as { c: string }[];
    return {
      categories: cats.map((r) => r.c),
      cities: cities.map((r) => r.c),
    };
  } finally {
    db.close();
  }
}

/** Safe GROUP BY counts for whitelisted columns (for analytics). */
export function getCountsBy(column: "category" | "city" | "tier"): Record<string, number> {
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

/**
 * Returns every corpus lead matching the segment filter with its
 * outreach state so the UI can compute exact eligibility counts.
 */
export function selectCampaignCandidates(filters: CandidateFilters): CampaignCandidate[] {
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
    const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
    return (
      db
        .prepare(
          `SELECT name_key, business, email,
                  CASE WHEN UPPER(COALESCE(email_status,'')) LIKE '%VERIFIED%' THEN 1 ELSE 0 END AS emailVerified,
                  CASE WHEN date_contacted IS NOT NULL THEN 1 ELSE 0 END AS contacted,
                  COALESCE(opted_out,0) AS optedOut,
                  COALESCE(bounced,0) AS bounced,
                  CASE WHEN reply_status IS NOT NULL AND TRIM(reply_status) <> ''
                        AND LOWER(reply_status) NOT IN ('none','no reply','no') THEN 1 ELSE 0 END AS replied,
                  tier, category, city
           FROM leads ${whereSql} ORDER BY COALESCE(lead_score,0) DESC`,
        )
        .all(...args) as unknown as {
        name_key: string;
        business: string;
        email: string | null;
        emailVerified: number;
        contacted: number;
        optedOut: number;
        bounced: number;
        replied: number;
        tier: string | null;
        category: string | null;
        city: string | null;
      }[]
    ).map((r) => ({
      nameKey: r.name_key,
      business: r.business,
      email: r.email && r.email.trim() !== "" ? r.email : null,
      emailVerified: r.emailVerified === 1,
      contacted: r.contacted === 1,
      optedOut: r.optedOut === 1,
      bounced: r.bounced === 1,
      replied: r.replied === 1,
      tier: r.tier,
      category: r.category,
      city: r.city,
    }));
  } finally {
    db.close();
  }
}

/**
 * Writes back ONLY outreach-state columns to the engine DB so PDF/Excel
 exports and dedupe stay consistent with what the operator did here.
 */
export function updateLeadOutreachState(
  nameKey: string,
  fields: {
    email_status?: string;
    date_contacted?: string | null;
    reply_status?: string | null;
    opted_out?: boolean;
    bounced?: boolean;
    next_follow_up?: string | null;
  },
): void {
  const sets: string[] = [];
  const args: SqlArg[] = [];
  if (fields.email_status !== undefined) {
    sets.push("email_status = ?");
    args.push(fields.email_status);
  }
  if (fields.date_contacted !== undefined) {
    sets.push("date_contacted = ?");
    args.push(fields.date_contacted);
  }
  if (fields.reply_status !== undefined) {
    sets.push("reply_status = ?");
    args.push(fields.reply_status);
  }
  if (fields.opted_out !== undefined) {
    sets.push("opted_out = ?");
    args.push(fields.opted_out ? 1 : 0);
  }
  if (fields.bounced !== undefined) {
    sets.push("bounced = ?");
    args.push(fields.bounced ? 1 : 0);
  }
  if (fields.next_follow_up !== undefined) {
    sets.push("next_follow_up = ?");
    args.push(fields.next_follow_up);
  }
  if (sets.length === 0) return;

  const db = openWritable();
  try {
    db.prepare(`UPDATE leads SET ${sets.join(", ")} WHERE name_key = ?`).run(...args, nameKey);
  } finally {
    db.close();
  }
}

// ------------------------------------------------------------------
// Batch manifests + reports on disk
// ------------------------------------------------------------------

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

export function listBatchManifests(): BatchManifest[] {
  const dir = runsDir();
  if (!existsSync(dir)) return [];
  const out: BatchManifest[] = [];
  for (const entry of readdirSync(dir)) {
    if (!entry.endsWith(".json")) continue;
    try {
      const raw = JSON.parse(readFileSync(join(dir, entry), "utf8")) as BatchManifest;
      out.push(raw);
    } catch {
      // unreadable manifest — skip
    }
  }
  out.sort((a, b) => (b.generatedAt ?? "").localeCompare(a.generatedAt ?? ""));
  return out;
}

export function getBatchManifest(batchId: string): BatchManifest | undefined {
  return listBatchManifests().find((m) => m.batchId === batchId);
}

// ------------------------------------------------------------------
// Generation runs (spawns the REAL engine CLI)
// ------------------------------------------------------------------

export interface LastRunInfo {
  started_at: string | null;
  finished_at: string | null;
  discovered: number | null;
  added: number | null;
  report_path: string | null;
  telegram_status: string | null;
}

export function getLastEngineRun(): LastRunInfo | undefined {
  const db = openReadonly();
  try {
    return db
      .prepare("SELECT started_at, finished_at, discovered, added, report_path, telegram_status FROM runs ORDER BY started_at DESC LIMIT 1")
      .get() as LastRunInfo | undefined;
  } finally {
    db.close();
  }
}

interface ScheduledTaskInfo {
  taskName: string;
  state: string;
  nextRunTime: string | null;
  lastRunTime: string | null;
  lastResult: string | null;
}

let schedCache: { at: number; data: ScheduledTaskInfo | null } | null = null;

/** Reads the real Windows Task Scheduler entry that drives the engine. */
export async function getScheduledTaskInfo(): Promise<ScheduledTaskInfo | null> {
  if (schedCache && Date.now() - schedCache.at < 30_000) return schedCache.data;
  try {
    const { stdout } = await execFileAsync(
      "powershell.exe",
      [
        "-NoProfile",
        "-Command",
        `$t = Get-ScheduledTask -TaskName 'WavesCo Lead Engine' -ErrorAction Stop; $i = $t | Get-ScheduledTaskInfo; [pscustomobject]@{ state = [string]$t.State; nextRunTime = $(if ($i.NextRunTime) { ([datetime]$i.NextRunTime).ToString('yyyy-MM-dd HH:mm') } else { $null }); lastRunTime = $(if ($i.LastRunTime) { ([datetime]$i.LastRunTime).ToString('yyyy-MM-dd HH:mm') } else { $null }); lastResult = [string]$i.LastTaskResult } | ConvertTo-Json -Compress`,
      ],
      { timeout: 10_000 },
    );
    const parsed = JSON.parse(stdout) as {
      state?: string;
      nextRunTime?: string | null;
      lastRunTime?: string | null;
      lastResult?: number | string | null;
    };
    const data: ScheduledTaskInfo = {
      taskName: "WavesCo Lead Engine",
      state: parsed.state ?? "Unknown",
      nextRunTime: parsed.nextRunTime ?? null,
      lastRunTime: parsed.lastRunTime ?? null,
      lastResult:
        typeof parsed.lastResult === "number"
          ? String(parsed.lastResult)
          : (parsed.lastResult ?? null),
    };
    schedCache = { at: Date.now(), data };
    return data;
  } catch {
    schedCache = { at: Date.now(), data: null };
    return null;
  }
}
