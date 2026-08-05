import { describe, expect, it } from "vitest";
import { loginSchema, passwordSchema, signupSchema, tenantSlugSchema } from "../src";

describe("passwordSchema", () => {
  it("accepts a strong password", () => {
    expect(passwordSchema.safeParse("Password123!").success).toBe(true);
  });

  it("rejects short / weak passwords", () => {
    expect(passwordSchema.safeParse("short").success).toBe(false);
    expect(passwordSchema.safeParse("alllowercase1").success).toBe(false);
    expect(passwordSchema.safeParse("NOLOWERCASE1").success).toBe(false);
  });
});

describe("tenantSlugSchema", () => {
  it("accepts kebab-case slugs", () => {
    expect(tenantSlugSchema.safeParse("demo-cafe").success).toBe(true);
  });

  it("rejects invalid slugs", () => {
    expect(tenantSlugSchema.safeParse("Demo Cafe").success).toBe(false);
    expect(tenantSlugSchema.safeParse("demo_cafe").success).toBe(false);
    expect(tenantSlugSchema.safeParse("-demo").success).toBe(false);
  });
});

describe("signupSchema", () => {
  it("validates a full signup payload", () => {
    const result = signupSchema.safeParse({
      email: "owner@cafe.com",
      password: "Password123!",
      name: "Owner",
      tenantName: "Demo Cafe",
      tenantSlug: "demo-cafe",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.email).toBe("owner@cafe.com");
    }
  });
});

describe("loginSchema", () => {
  it("requires email and password", () => {
    expect(loginSchema.safeParse({ email: "a@b.co", password: "x" }).success).toBe(true);
    expect(loginSchema.safeParse({ email: "a@b.co" }).success).toBe(false);
  });
});
