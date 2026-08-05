import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ENV_FILE = join(ROOT, ".env");

function newSecret() {
  return randomBytes(32).toString("base64");
}

function valueOf(line) {
  return line
    .slice(line.indexOf("=") + 1)
    .trim()
    .replace(/^["']|["']$/g, "");
}

/**
 * Fills missing or empty auth secrets in the root .env. Never overwrites
 * an existing non-empty value >= 32 chars. Ensures AUTH_SECRET and
 * NEXTAUTH_SECRET are identical (Auth.js v5 reads AUTH_SECRET, NextAuth
 * v4 reads NEXTAUTH_SECRET — they must match).
 */
function generateSecrets() {
  if (!existsSync(ENV_FILE)) {
    console.error(`[generate:secrets] No .env at ${ENV_FILE}. Copy .env.example to .env first.`);
    process.exit(1);
  }

  const lines = readFileSync(ENV_FILE, "utf8").split(/\r?\n/);

  const find = (key) => {
    const line = lines.find((l) => l.trim().startsWith(`${key}=`));
    return line ? valueOf(line) : undefined;
  };
  const set = (key, value) => {
    const index = lines.findIndex((l) => l.trim().startsWith(`${key}=`));
    if (index === -1) lines.push(`${key}="${value}"`);
    else lines[index] = `${key}="${value}"`;
  };

  const existingAuth = find("NEXTAUTH_SECRET") || find("AUTH_SECRET");
  const authSecret = existingAuth && existingAuth.length >= 32 ? existingAuth : newSecret();

  const existingJwt = find("JWT_SECRET");
  const jwtSecret = existingJwt && existingJwt.length >= 32 ? existingJwt : newSecret();

  set("AUTH_SECRET", authSecret);
  set("NEXTAUTH_SECRET", authSecret);
  set("JWT_SECRET", jwtSecret);

  writeFileSync(ENV_FILE, lines.join("\n") + "\n", "utf8");
  console.log("[generate:secrets] AUTH_SECRET, NEXTAUTH_SECRET, JWT_SECRET are set (all >= 32 chars).");
}

generateSecrets();