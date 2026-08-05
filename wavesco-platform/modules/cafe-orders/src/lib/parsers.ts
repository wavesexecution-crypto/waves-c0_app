export interface NormalizedOrder {
  externalOrderId: string;
  source: string;
  customerName?: string;
  customerPhone?: string;
  items: { name: string; quantity: number; totalPaise?: number }[];
  totalPaise: number;
  placedAt: Date;
}

function toNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n) : 0;
}

function pluck(obj: unknown, key: string): unknown {
  if (obj && typeof obj === "object") {
    return (obj as Record<string, unknown>)[key];
  }
  return undefined;
}

function pluckString(obj: unknown, key: string): string | undefined {
  const value = pluck(obj, key);
  return typeof value === "string" && value.trim() ? value : undefined;
}

function pluckNumber(obj: unknown, key: string): number | undefined {
  const value = pluck(obj, key);
  if (value === undefined || value === null) return undefined;
  return toNumber(value);
}

function firstNumber(...values: (number | undefined)[]): number {
  for (const value of values) {
    if (value !== undefined) return value;
  }
  return 0;
}

function parseItems(items: unknown): { name: string; quantity: number; totalPaise?: number }[] {
  if (!Array.isArray(items)) return [];
  return items.map((item) => {
    const record = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
    const rawName = record.name ?? record.item_name ?? "item";
    const name = typeof rawName === "string" ? rawName : "item";
    return {
      name,
      quantity: toNumber(record.quantity ?? record.qty ?? 1),
      totalPaise: firstNumber(
        pluckNumber(record, "total_price"),
        pluckNumber(record, "total"),
        pluckNumber(record, "price"),
      ),
    };
  });
}

/**
 * Normalizes a Swiggy webhook payload.
 * Assumption: monetary values arrive in paise.
 */
export function parseSwiggyPayload(payload: unknown): NormalizedOrder {
  const root = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const customer = root.customer;

  return {
    externalOrderId: pluckString(root, "order_id") ?? pluckString(root, "id") ?? "",
    source: "SWIGGY",
    customerName: pluckString(customer, "name"),
    customerPhone: pluckString(customer, "phone") ?? pluckString(customer, "mobile"),
    items: parseItems(root.order_items ?? root.items),
    totalPaise: firstNumber(pluckNumber(root, "order_amount"), pluckNumber(root, "total_amount")),
    placedAt: new Date(
      typeof root.order_time === "string" ? root.order_time : new Date().toISOString(),
    ),
  };
}

/**
 * Normalizes a Zomato webhook payload.
 * Assumption: monetary values arrive in paise.
 */
export function parseZomatoPayload(payload: unknown): NormalizedOrder {
  const root = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const customer = root.customer;
  const details =
    root.order_details && typeof root.order_details === "object"
      ? (root.order_details as Record<string, unknown>)
      : {};

  return {
    externalOrderId: pluckString(root, "order_id") ?? pluckString(root, "id") ?? "",
    source: "ZOMATO",
    customerName: pluckString(customer, "name"),
    customerPhone: pluckString(customer, "phone_number") ?? pluckString(customer, "phone"),
    items: parseItems(details.items ?? root.items),
    totalPaise: firstNumber(pluckNumber(root, "total_amount"), pluckNumber(details, "total")),
    placedAt: new Date(
      typeof root.created_at === "string" ? root.created_at : new Date().toISOString(),
    ),
  };
}
