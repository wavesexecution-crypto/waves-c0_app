# Cafe Inventory

Stock tracking, par levels, low-stock alerts and wastage logging.

## Requires

None (no external integrations).

## Tables

| Model | Purpose |
|---|---|
| `CafeInventoryItem` | SKU-level stock, par and reorder levels |
| `CafeStockMovement` | Append-only ledger of stock changes |
| `CafeWastageLog` | Wastage events (costed, bucketed by week) |

## Actions

- `createItem(tenantId, input)`
- `adjustStock(tenantId, input)` — records a movement and updates stock atomically
- `logWastage(tenantId, input)` — deducts stock and costs the wastage
- `listLowStock(tenantId)` — items at or below reorder point

## Webhooks

None.
