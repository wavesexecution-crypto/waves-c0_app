import { describe, expect, it } from "vitest";
import { reengagementInputSchema, upsertCustomerInputSchema } from "../src/actions";

describe("upsertCustomerInputSchema", () => {
  it("accepts a valid customer", () => {
    const result = upsertCustomerInputSchema.safeParse({ phone: "+911234567890", name: "A" });
    expect(result.success).toBe(true);
  });

  it("rejects an invalid phone", () => {
    expect(upsertCustomerInputSchema.safeParse({ phone: "12" }).success).toBe(false);
  });
});

describe("reengagementInputSchema", () => {
  it("requires a customerId and message", () => {
    expect(reengagementInputSchema.safeParse({ customerId: "x", message: "" }).success).toBe(false);
    expect(reengagementInputSchema.safeParse({ customerId: "x", message: "come back!" }).success).toBe(true);
  });
});
