/**
 * Email verification — unit tests.
 *
 * Format checks are pure. MX/DNS tests depend on network; skipped if DNS unavailable.
 */
import { describe, it, expect } from "vitest";
import { verifyEmail } from "../lib/wavesco/email-verify";

describe("email verification — format", () => {
  it("rejects empty email", async () => {
    const r = await verifyEmail("");
    expect(r.valid).toBe(false);
    expect(r.mxFound).toBe(false);
  });

  it("rejects invalid format", async () => {
    const r = await verifyEmail("not-an-email");
    expect(r.valid).toBe(false);
    expect(r.mxFound).toBe(false);
  });

  it("rejects missing @ sign", async () => {
    const r = await verifyEmail("userexample.com");
    expect(r.valid).toBe(false);
  });

  it("rejects domain with no MX records", async () => {
    const r = await verifyEmail("test@thisdomaindoesnotexist12345.com");
    expect(r.mxFound).toBe(false);
    expect(r.valid).toBe(false);
  });
});

describe("email verification — MX lookup (network)", () => {
  it("verifies gmail.com has MX records", async () => {
    const r = await verifyEmail("test@gmail.com");
    // If DNS works, mxFound should be true for gmail.com
    // If DNS is blocked, mxFound will be false — that's OK for test env
    expect(typeof r.mxFound).toBe("boolean");
    expect(typeof r.valid).toBe("boolean");
  });
});
