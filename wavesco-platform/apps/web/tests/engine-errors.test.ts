/**
 * Customer-safe error architecture — regression tests.
 *
 * Guarantees: no raw upstream body, URL, status code, or exception text
 * ever reaches the customer UI through toSafeEngineError.
 */
import { describe, it, expect } from "vitest";
import {
  EngineHttpError,
  EngineUnavailableError,
  engineStatusLabel,
  toSafeEngineError,
} from "@/lib/wavesco/engine-errors";

const RAW_HTML = '<!DOCTYPE html><html><body>Tunnel not found</body></html>';
const RAW_JSON = '{"ok":false,"error":"not found"}';

function assertClean(text: string) {
  expect(text).not.toContain("<!DOCTYPE");
  expect(text).not.toContain("<html");
  expect(text).not.toContain("Tunnel");
  expect(text).not.toContain("ngrok");
  expect(text).not.toContain("http");
  expect(text).not.toContain("404");
  expect(text).not.toContain("500");
  expect(text).not.toContain("engine API");
}

describe("toSafeEngineError", () => {
  it("maps 404 with raw HTML body to a safe unavailable state", () => {
    const s = toSafeEngineError(new EngineHttpError(404, RAW_HTML));
    expect(s.title).toBe("Lead research is temporarily unavailable");
    expect(s.retryable).toBe(true);
    assertClean(s.title + " " + s.message);
  });

  it("maps 500 with raw body to a safe state", () => {
    const s = toSafeEngineError(new EngineHttpError(500, RAW_HTML));
    expect(s.retryable).toBe(true);
    assertClean(s.title + " " + s.message);
  });

  it("maps 401/403 without leaking auth internals", () => {
    for (const st of [401, 403]) {
      const s = toSafeEngineError(new EngineHttpError(st, RAW_JSON));
      assertClean(s.title + " " + s.message);
      expect(s.retryable).toBe(true);
    }
  });

  it("maps network failure to unavailable with workspace-safe message", () => {
    const s = toSafeEngineError(new EngineUnavailableError());
    expect(s.kind).toBe("unavailable");
    expect(s.message).toMatch(/workspace/i);
    assertClean(s.title + " " + s.message);
  });

  it("never embeds unknown exception messages (they may contain raw bodies)", () => {
    const evil = new Error(`engine API 404: ${RAW_HTML} at https://internal:8787/leads`);
    const s = toSafeEngineError(evil);
    assertClean(s.title + " " + s.message);
  });

  it("handles non-Error throws safely", () => {
    const s = toSafeEngineError("engine API 500: boom");
    assertClean(s.title + " " + s.message);
  });
});

describe("engineStatusLabel", () => {
  it("is Operational only when there is no error", () => {
    expect(engineStatusLabel(null)).toBe("Operational");
    expect(engineStatusLabel(undefined)).toBe("Operational");
    expect(engineStatusLabel(new EngineHttpError(404, RAW_HTML))).toBe("Temporarily unavailable");
  });
});

describe("EngineHttpError", () => {
  it("keeps its own message generic (body lives in detail for logs only)", () => {
    const e = new EngineHttpError(404, RAW_HTML);
    expect(e.message).not.toContain("<!DOCTYPE");
    expect(e.detail).toContain("<!DOCTYPE");
    expect(e.status).toBe(404);
  });
});
