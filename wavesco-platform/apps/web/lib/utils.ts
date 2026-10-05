import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Client-safe error text.
 *
 * Internal services (the Lead Engine HTTP API, Prisma/Postgres, the filesystem)
 * surface their raw messages, which reach the browser as things like
 * `engine API 500: <200 chars of upstream body>` or a Postgres constraint text.
 * Those are for the server log, not for a paying client.
 *
 * Logs the original server-side and returns `fallback` to the caller. Messages
 * that are clearly product-level copy (no stack/env/path/markup) are passed
 * through, so genuine user-facing validation text still reaches the UI.
 */
export function safeErrorText(
  error: unknown,
  fallback = "Something went wrong on our side. Try again in a moment.",
  context?: string,
): string {
  const raw = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  if (context) console.error(`[${context}]`, error);
  else console.error("[safeErrorText]", error);

  const text = raw.trim();
  if (!text) return fallback;
  if (text.length > 200) return fallback;

  // Never let these through: stack frames, env vars, absolute paths, SQL,
  // URLs with hosts, HTML/JSON blobs, or driver chatter.
  const forbidden =
    /\n\s*at\s|stack|NODE_ENV|DATABASE_URL|API_KEY|SECRET|TOKEN|PASSWORD|CREDENTIAL/i.test(text) ||
    /(^|[\s"'(])([A-Za-z]:\\|\/home\/|\/var\/|\/Users\/|D:\\)/i.test(text) ||
    /\b(SELECT|INSERT|UPDATE|DELETE)\b[\s\S]*\b(FROM|WHERE|SET)\b/i.test(text) ||
    /https?:\/\/(?!localhost|127\.0\.0\.1)/i.test(text) ||
    /<[a-z][\s\S]*>/i.test(text) ||
    /^\s*[[{]/.test(text) ||
    /\bPrismaClient|ECONNREFUSED|ETIMEDOUT|getaddrinfo|timeout of/i.test(text);

  if (forbidden) return fallback;
  return text;
}