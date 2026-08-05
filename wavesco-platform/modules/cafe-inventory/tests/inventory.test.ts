import { describe, expect, it } from "vitest";
import { adjustStockInputSchema, createItemInputSchema, wastageInputSchema } from "../src/actions";

describe("createItemInputSchema", () => {
  it("accepts a valid item", () => {
    const result = createItemInputSchema.safeParse({
      name: "Arabica Beans",
      sku: "ARAB-1KG",
      parLevel: 5,
    });
    expect(result.success).toBe(true);
  });

  it("rejects a blank name", () => {
    expect(createItemInputSchema.safeParse({ name: "  " }).success).toBe(false);
  });
});

describe("adjustStockInputSchema", () => {
  it("rejects a zero quantity", () => {
    const result = adjustStockInputSchema.safeParse({
      itemId: "x",
      quantity: 0,
      type: "ADJUSTMENT",
    });
    expect(result.success).toBe(false);
  });

  it("accepts a restock quantity", () => {
    const result = adjustStockInputSchema.safeParse({
      itemId: "x",
      quantity: 10,
      type: "PURCHASE",
    });
    expect(result.success).toBe(true);
  });
});

describe("wastageInputSchema", () => {
  it("requires a positive quantity and a reason", () => {
    expect(wastageInputSchema.safeParse({ itemId: "x", quantity: -1, reason: "spoiled" }).success).toBe(false);
    expect(wastageInputSchema.safeParse({ itemId: "x", quantity: 1 }).success).toBe(false);
    expect(wastageInputSchema.safeParse({ itemId: "x", quantity: 1, reason: "spoiled" }).success).toBe(true);
  });
});
