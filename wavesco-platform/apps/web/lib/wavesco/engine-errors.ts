/**
 * Customer-safe error architecture for upstream service failures.
 *
 * RULE: customer-facing UI must NEVER render raw upstream bodies, URLs,
 * status codes, or exception messages. Those go to server logs only.
 *
 * This module is pure (no Node APIs) so both server components and client
 * components can map errors without leaking internals.
 */

export type EngineErrorKind =
  | "unavailable"
  | "not-found"
  | "unauthorized"
  | "forbidden"
  | "bad-request"
  | "internal";

/** Thrown when the engine cannot be reached at all (network, DNS, tunnel down, unconfigured). */
export class EngineUnavailableError extends Error {
  constructor(reason = "Lead Engine unreachable") {
    super(reason);
    this.name = "EngineUnavailableError";
  }
}

/**
 * Thrown for HTTP error responses from the engine.
 * `message` stays generic on purpose — the upstream body lives in `detail`
 * and must only ever reach server logs, never the customer UI.
 */
export class EngineHttpError extends Error {
  public readonly status: number;
  public readonly detail: string;
  constructor(status: number, detail = "") {
    super("Lead Engine request failed");
    this.name = "EngineHttpError";
    this.status = status;
    this.detail = detail;
  }
}

export interface SafeEngineError {
  kind: EngineErrorKind;
  /** Short customer-facing title. No technical terms. */
  title: string;
  /** One-line explanation + what happens next. No URLs, codes, or bodies. */
  message: string;
  retryable: boolean;
}

const UNAVAILABLE: SafeEngineError = {
  kind: "unavailable",
  title: "Lead research is temporarily unavailable",
  message: "Your workspace is still safe. We'll reconnect automatically.",
  retryable: true,
};

/**
 * Map any thrown value to a customer-safe error. NEVER embeds the original
 * message — upstream libraries include raw HTML/JSON bodies in messages.
 */
export function toSafeEngineError(e: unknown): SafeEngineError {
  if (e instanceof EngineUnavailableError) return UNAVAILABLE;
  if (e instanceof EngineHttpError) {
    if (e.status === 404) return UNAVAILABLE;
    if (e.status === 401 || e.status === 403) {
      return {
        kind: e.status === 401 ? "unauthorized" : "forbidden",
        title: "Lead research is temporarily unavailable",
        message: "Your workspace is still safe. We'll reconnect automatically.",
        retryable: true,
      };
    }
    if (e.status === 400) {
      return {
        kind: "bad-request",
        title: "That request couldn't be completed",
        message: "Please adjust your filters and try again.",
        retryable: true,
      };
    }
    if (e.status >= 500) {
      return {
        kind: "unavailable",
        title: "Lead research is temporarily unavailable",
        message: "Your workspace is still safe. We'll reconnect automatically.",
        retryable: true,
      };
    }
    return UNAVAILABLE;
  }
  return {
    kind: "internal",
    title: "Something went wrong",
    message: "Please try again. Your workspace data is safe.",
    retryable: true,
  };
}

/** Compact one-line status label for headers/sidebars. Never technical. */
export function engineStatusLabel(e: unknown): "Operational" | "Temporarily unavailable" {
  return e === null || e === undefined ? "Operational" : "Temporarily unavailable";
}

/**
 * Server-only: record technical detail where operators can find it.
 * Call from server components / route handlers, never from the browser.
 */
export function logEngineError(scope: string, err: unknown): void {
  if (err instanceof EngineHttpError) {
    console.error(`[lead-engine:${scope}] http ${err.status} ${err.detail}`);
  } else if (err instanceof Error) {
    console.error(`[lead-engine:${scope}] ${err.name}: ${err.message}`);
  } else {
    console.error(`[lead-engine:${scope}]`, err);
  }
}
