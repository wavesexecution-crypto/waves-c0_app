import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Loads the root .env into process.env if present. Missing vars are
 * resolved by prisma lazily at first query, so this must run before the
 * db client is imported (use dynamic imports in scripts).
 */
export function loadEnv(): void {
  const envFile = join(ROOT, ".env");
  if (!existsSync(envFile)) {
    console.error(`[env] No ${envFile} found — continuing with existing process.env.`);
    return;
  }
  const content = readFileSync(envFile, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}
