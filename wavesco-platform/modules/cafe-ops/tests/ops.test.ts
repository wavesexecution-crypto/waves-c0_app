import { describe, expect, it } from "vitest";
import { reportInputSchema } from "../src/actions";

describe("cafe-ops reportInputSchema", () => {
  it("accepts DAILY and WEEKLY", () => {
    expect(reportInputSchema.safeParse({ type: "DAILY" }).success).toBe(true);
    expect(reportInputSchema.safeParse({ type: "WEEKLY" }).success).toBe(true);
  });

  it("rejects unknown report types", () => {
    expect(reportInputSchema.safeParse({ type: "MONTHLY" }).success).toBe(false);
  });
});
