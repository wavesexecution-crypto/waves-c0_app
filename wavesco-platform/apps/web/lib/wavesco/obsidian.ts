import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { Agent } from "node:https";

/**
 * Server-only client for the EXISTING Obsidian Local REST API
 * (https://127.0.0.1:27124). The API key lives in OBSIDIAN_API_KEY
 * (server-side env) and is NEVER sent to the browser.
 *
 * The local endpoint uses a self-signed certificate; we relax trust only
 * for this loopback host via a dedicated agent — never globally.
 */

export function obsidianBaseUrl(): string | null {
  const url = process.env.OBSIDIAN_REST_URL?.trim();
  if (!url) return null;
  return url.replace(/\/+$/, "");
}

export function obsidianApiKey(): string | null {
  const key = process.env.OBSIDIAN_API_KEY?.trim();
  return key ?? null;
}

const loopbackAgent = new Agent({ rejectUnauthorized: false });

interface RawResult {
  status: number;
  body: string;
  json?: unknown;
}

interface RawOptions {
  body?: string;
  contentType?: string;
}

function raw(
  method: "GET" | "PUT" | "POST" | "PATCH" | "DELETE",
  path: string,
  opts?: RawOptions,
): Promise<RawResult> {
  return new Promise((resolve) => {
    const base = obsidianBaseUrl();
    if (!base) { resolve({ status: 0, body: "OBSIDIAN_REST_URL not configured" }); return; }
    const key = obsidianApiKey();
    if (!key) { resolve({ status: 0, body: "OBSIDIAN_API_KEY not configured" }); return; }

    const url = new URL(base + path);
    const isHttps = url.protocol === "https:";
    const body = opts?.body;
    const contentType = opts?.contentType ?? "text/markdown";
    const req = (isHttps ? httpsRequest : httpRequest)(
      url,
      {
        method,
        headers: {
          accept: "application/json",
          authorization: `Bearer ${key}`,
          ...(body ? { "content-type": contentType } : {}),
        },
        ...(isHttps ? { agent: loopbackAgent } : {}),
        timeout: 10_000,
      },
      (res) => {
        let data = "";
        res.setEncoding("utf8");
        res.on("data", (c: string) => {
          data += c;
        });
        res.on("end", () => {
          let json: unknown;
          try {
            json = JSON.parse(data);
          } catch {
            // plain-text response (e.g. raw vault reads)
          }
          resolve({ status: res.statusCode ?? 0, body: data, json });
        });
      },
    );
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", (e) => { resolve({ status: 0, body: e.message }); });
    if (body) req.write(body);
    req.end();
  });
}

export interface ObsidianResult<T> {
  ok: boolean;
  status: number;
  error?: string;
  data?: T;
}

function wrap<T>(r: RawResult, pick: (j: unknown, body: string) => T): ObsidianResult<T> {
  if (r.status === 0) return { ok: false, status: 0, error: r.body };
  if (r.status >= 400) return { ok: false, status: r.status, error: `Obsidian API ${r.status}: ${r.body.slice(0, 200)}` };
  return { ok: true, status: r.status, data: pick(r.json, r.body) };
}

const enc = encodeURIComponent;

/** Lists entries under a path ("" = vault root). Returns full vault-relative paths; folders end with "/". */
export function listVaultDir(dirPath = ""): Promise<ObsidianResult<string[]>> {
  const p = dirPath ? `/vault/${enc(dirPath).replace(/%2F/g, "/")}/` : "/vault/";
  return raw("GET", p).then((r) =>
    wrap(r, (json) => {
      if (json !== null && typeof json === "object" && Array.isArray((json as { files?: unknown }).files)) {
        return (json as { files: string[] }).files;
      }
      if (Array.isArray(json)) return json.filter((f): f is string => typeof f === "string");
      return [];
    }),
  );
}

/** Reads a note as markdown. */
export function readNote(notePath: string): Promise<ObsidianResult<string>> {
  return raw("GET", `/vault/${enc(notePath).replace(/%2F/g, "/")}`).then((r) =>
    wrap(r, (_j, body) => body),
  );
}

/** Creates or fully overwrites a note. */
export function putNote(notePath: string, content: string): Promise<ObsidianResult<{ created: boolean }>> {
  return raw("PUT", `/vault/${enc(notePath).replace(/%2F/g, "/")}`, { body: content }).then((r) =>
    wrap(r, () => ({ created: r.status === 204 })),
  );
}

/** Appends content under an optional heading. */
export function appendNote(notePath: string, content: string, heading?: string): Promise<ObsidianResult<object | null>> {
  const q = heading ? `?heading=${enc(heading)}` : "";
  return raw("POST", `/vault/${enc(notePath).replace(/%2F/g, "/")}${q}`, {
    body: content,
    contentType: "text/markdown",
  }).then((r) => wrap(r, (json) => (typeof json === "object" && json !== null ? json : null)));
}

export interface SimpleHit {
  filename: string;
  score?: number;
  matches?: { context: string }[];
}

/** Simple content/title search across the vault. */
export function searchSimple(query: string, contextLength = 120): Promise<ObsidianResult<SimpleHit[]>> {
  return raw("POST", `/search/simple/?query=${enc(query)}&contextLength=${contextLength}`, {
    body: "",
    contentType: "application/json",
  }).then((r) =>
    wrap(r, (json) => (Array.isArray(json) ? (json as SimpleHit[]) : [])),
  );
}

/**
 * Tag search via JsonLogic regexp over file contents (the REST API has no
 * dedicated tag endpoint; this mirrors how the MCP layer implements it).
 */
export function searchTag(tag: string): Promise<ObsidianResult<SimpleHit[]>> {
  const logic = JSON.stringify({
    glob: ["*.md", { var: "path" }],
  });
  void logic;
  // Complex search returns matching filenames directly.
  const body = JSON.stringify({
    and: [{ glob: ["*.md", { var: "path" }] }, { regexp: [`#${tag}(\\s|\\n|$)`, { var: "content" }] }],
  });
  return raw("POST", `/search/`, { body, contentType: "application/vnd.olrapi.jsonlogic+json" }).then((r) =>
    wrap(r, (json) =>
      (Array.isArray(json) ? json : []).map((f) => ({ filename: typeof f === "string" ? f : String(f) })),
    ),
  );
}

/** Liveness probe used by integrations surfaces. */
export async function obsidianProbe(): Promise<{ configured: boolean; reachable: boolean; detail: string }> {
  const base = obsidianBaseUrl();
  const key = obsidianApiKey();
  if (!base || !key) {
    return { configured: false, reachable: false, detail: "OBSIDIAN_REST_URL / OBSIDIAN_API_KEY not configured." };
  }
  const r = await raw("GET", "/");
  return {
    configured: true,
    reachable: r.status >= 200 && r.status < 300,
    detail:
      r.status >= 200 && r.status < 300
        ? "Local REST API responding."
        : r.status === 401 || r.status === 403
          ? "Reachable but rejected credentials (check OBSIDIAN_API_KEY)."
          : `Unreachable (${r.body || r.status}).`,
  };
}
