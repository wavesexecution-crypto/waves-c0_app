import { describe, it, expect } from "vitest";

/**
 * Email operating mode — pure selection logic.
 * Both modes feed the same campaign lifecycle; the client choice is recorded
 * on the tenant profile (no schema change) and surfaced truthfully.
 */

import {
  EMAIL_MODES,
  DEFAULT_EMAIL_MODE,
  isEmailMode,
  readEmailMode,
  withEmailMode,
  emailModeLabel,
} from "@/lib/wavesco/mail-mode";

describe("email operating mode", () => {
  it("defaults to waves_managed for missing or invalid integrations", () => {
    expect(readEmailMode(undefined)).toBe("waves_managed");
    expect(readEmailMode(null)).toBe("waves_managed");
    expect(readEmailMode({})).toBe("waves_managed");
    expect(readEmailMode({ emailMode: "smtp_blast" })).toBe("waves_managed");
    expect(readEmailMode("junk")).toBe("waves_managed");
    expect(DEFAULT_EMAIL_MODE).toBe("waves_managed");
    expect(EMAIL_MODES).toHaveLength(2);
  });

  it("reads a persisted valid mode", () => {
    expect(readEmailMode({ emailMode: "client_managed" })).toBe("client_managed");
    expect(readEmailMode({ emailMode: "waves_managed" })).toBe("waves_managed");
  });

  it("validates mode values strictly", () => {
    expect(isEmailMode("waves_managed")).toBe(true);
    expect(isEmailMode("client_managed")).toBe(true);
    expect(isEmailMode("WAVES_MANAGED")).toBe(false);
    expect(isEmailMode("")).toBe(false);
    expect(isEmailMode(42)).toBe(false);
  });

  it("merges the mode without losing existing integration keys", () => {
    const merged = withEmailMode(
      { crm: "hubspot", email: "outlook" },
      "client_managed",
    );
    expect(merged).toEqual({
      crm: "hubspot",
      email: "outlook",
      emailMode: "client_managed",
    });
    expect(withEmailMode(null, "waves_managed")).toEqual({
      emailMode: "waves_managed",
    });
    expect(
      withEmailMode({ emailMode: "client_managed" }, "waves_managed"),
    ).toEqual({ emailMode: "waves_managed" });
  });

  it("exposes client-facing labels without internal infrastructure terms", () => {
    for (const m of EMAIL_MODES) {
      const label = emailModeLabel(m);
      expect(label.length).toBeGreaterThan(0);
      expect(label.toLowerCase()).not.toMatch(/n8n|brevo|smtp|relay|outbox/);
    }
    expect(emailModeLabel("waves_managed")).toMatch(/waves handles it/i);
    expect(emailModeLabel("client_managed")).toMatch(/connect my email/i);
  });
});
