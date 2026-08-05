import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyHmacSignature } from "../src/lib/hmac";
import { parseSwiggyPayload, parseZomatoPayload } from "../src/lib/parsers";

function sign(secret: string, body: string): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

describe("verifyHmacSignature", () => {
  const body = '{"order_id":"S123"}';
  const good = sign("swiggy-secret", body);

  it("accepts a valid signature", () => {
    expect(verifyHmacSignature("swiggy-secret", body, good)).toBe(true);
  });

  it("rejects a wrong secret", () => {
    expect(verifyHmacSignature("wrong-secret", body, good)).toBe(false);
  });

  it("rejects a missing signature header", () => {
    expect(verifyHmacSignature("swiggy-secret", body, null)).toBe(false);
  });
});

describe("parseSwiggyPayload", () => {
  it("normalizes a swiggy order", () => {
    const order = parseSwiggyPayload({
      order_id: "S123",
      customer: { name: "A", phone: "111" },
      order_items: [{ name: "Latte", quantity: 2, total_price: 400 }],
      order_amount: 400,
      order_time: "2026-01-01T10:00:00Z",
    });
    expect(order.source).toBe("SWIGGY");
    expect(order.externalOrderId).toBe("S123");
    expect(order.totalPaise).toBe(400);
    expect(order.items[0]).toMatchObject({ name: "Latte", quantity: 2 });
  });
});

describe("parseZomatoPayload", () => {
  it("normalizes a zomato order", () => {
    const order = parseZomatoPayload({
      order_id: "Z99",
      customer: { name: "B", phone_number: "222" },
      order_details: { items: [{ item_name: "Cold Coffee", qty: 1 }] },
      total_amount: 250,
      created_at: "2026-01-01T11:00:00Z",
    });
    expect(order.source).toBe("ZOMATO");
    expect(order.customerPhone).toBe("222");
    expect(order.totalPaise).toBe(250);
  });
});
