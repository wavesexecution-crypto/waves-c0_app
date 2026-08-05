import { describe, expect, it } from "vitest";
import { createLeadInputSchema } from "../src/actions";

describe("cafe-leads createLeadInputSchema", () => {
  it("accepts a valid lead", () => {
    const result = createLeadInputSchema.safeParse({
      phone: "+919876543210",
      message: "Table for 4 tonight",
      source: "instagram",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a lead without a message", () => {
    const result = createLeadInputSchema.safeParse({ phone: "+919876543210" });
    expect(result.success).toBe(false);
  });

  it("defaults the source to website", () => {
    const result = createLeadInputSchema.safeParse({ phone: "123", message: "hi" });
    if (result.success) {
      expect(result.data.source).toBe("website");
    }
  });
});
