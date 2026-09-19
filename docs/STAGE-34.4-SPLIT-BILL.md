# Stage 34.4 — Split Bill / Separate Checks

## Architecture

```
TABLE → ORDER → BILL / SPLIT → ORDER ITEMS → PAYMENTS
```

One table, one **ORDER**, several **BILLS**. The order stays the single sale; the bills are a
**partition** of it, never a copy. That is what makes double-counted revenue structurally
impossible — analytics keeps reading the order's items exactly once, while each guest settles their
own part with their own guest record, discount, payment method and receipt.

The worked example from the specification, proven end to end:

| | |
|---|---|
| Order | 500.00 |
| Bill A / B / C | 180.00 / 200.00 / 120.00 |
| **Sales** | **500.00** |
| **Orders** | **1** |
| **Bills** | **3** |

## Split modes

An order is in exactly **one** mode at a time (`orders.split_mode`):

| Mode | Meaning |
|---|---|
| `NONE` | one settlement for the whole order — the original behaviour, completely unchanged |
| `ITEMS` | the order's lines are divided between bills |
| `EQUAL` | the order's total is divided into equal shares |

Splitting is only allowed while the order is open, an order can only be split once, and splitting
first **releases any order-level discount** — an order discount and a bill discount would be two
answers to the same question.

## Operations (waiter POS session or an authenticated operator)

| Method | Path | What it does |
|---|---|---|
| `GET` | `/api/orders/:id/bills` | bills, their items, and the still-unassigned lines |
| `POST` | `/api/orders/:id/bills/split` | `{mode, count}` (2–20) |
| `POST` | `/api/orders/:id/bills/move-item` | move a line, or **part** of a line, to a bill (or back to unassigned) |
| `POST` | `/api/orders/:id/bills/:billId/customer` | assign a guest to one bill |
| `DELETE` | `/api/orders/:id/bills/:billId` | void an **empty** bill (soft — never deleted) |
| `POST` | `/api/orders/:id/bills/merge` | merge back to a single settlement |

Moving part of a line splits the `order_item` at the **same snapshotted unit price** and copies its
modifiers, so the money is unchanged by the move — proven: 1 of 4 units at 200.00 leaves 200.00 on
the bill and 600.00 unassigned, with the order still 800.00.

**Merge safe**: merging is refused the moment any bill has been paid
(`MERGE_BLOCKED_BY_PAID_BILL`), as is moving items off or onto a paid bill.

## Payment

`POST /api/payments` gained an optional `bill_id`:

- a **split** order *must* be paid per bill (`BILL_REQUIRED_FOR_SPLIT_ORDER`) — it can never be
  settled as a whole;
- an **unsplit** order refuses a `bill_id` (`ORDER_NOT_SPLIT`);
- the amount must equal the remaining balance **of that bill**, computed by the server;
- each bill chooses its own method (`CASH` / `CARD` / `CREDIT` / …) independently.

Crucially, **consumption, the service-charge ledger and order completion happen once per ORDER**,
when the last bill closes — not once per bill, which would consume stock N times. Until then the
order stays `READY`. Proven: a 3-bill order consumes its 100 g of beef exactly once.

## Discounts on a split order

A split order is discounted **per separate check**: `POST /api/orders/:id/discount` requires a
`bill_id`, and the percentage is computed against that bill's own subtotal. The order-level total
still reflects it exactly once, so the bills always sum back to the order:
`500.00 − 20.00 = 480.00 = 180 + 180 + 120`.

An `EQUAL` split has no per-bill item base to discount against, so it refuses a per-bill discount
(`DISCOUNT_NOT_SUPPORTED_IN_EQUAL_SPLIT`) rather than guessing — discount the order first, then
split it equally.

## Exact arithmetic

Two helpers in `server/order-totals.ts`, both pure BigInt cents:

- `splitEvenly(total, n)` — equal shares that sum **exactly** to the total, the leftover cents
  distributed one by one (proven: 120.00 across 7 guests sums back to 120.00 with at most a 1-cent
  spread);
- `splitProportionally(total, weights)` — used to apportion the order's service charge across the
  bills by their share of the subtotal, largest remainder, so the bills' service charges sum back to
  the order's exactly.

Not a cent is invented or lost anywhere.

## Database

One additive migration, `20260919160000_stage34_4_split_bills`: the new `order_bills` table plus
nullable `orders.split_mode`, `order_items.bill_id`, `payments.bill_id` and
`order_discounts.bill_id`. Nothing is dropped, and an order that is never split behaves exactly as
before.

## Closure interaction

Closing an order (Stage 34.1) voids its remaining open bills, so a cancelled or establishment-closed
order has nothing left to settle.

## UI

- **Waiter POS** — the «Мои заказы» list gains a **Счёт** action: split by items or equally, assign
  unassigned lines to bills with one tap, take them back, and merge. Amounts shown are the ones the
  server returned.
- **Cashier POS** — a split order shows its bills with each one's total, guest and discount, and a
  per-bill **Оплатить** button; the whole-order pay button disappears entirely. The payment dialog
  shows the bill's own figures and uses a **per-bill idempotency key**, so two bills can never be
  confused. RU + TK.

## Tests

- `tests/stage34_4_split_bill_static.mjs` — 37 source guards.
- `tests/stage34_4_split_bill_e2e.mjs` — 94 HTTP calls, 16 denials, 23 fresh-DB post-conditions: the
  worked 500 = 180 + 200 + 120 example, a per-bill guest and a per-bill discount landing only where
  they belong, the order refusing a whole-order payment, three bills paying by different methods,
  the order completing only on the last one, stock consumed exactly once, an exact 7-way equal split,
  merge-safe behaviour, a partial line move, voiding an empty bill, and branch isolation.
- Negative control: completing the order on every bill payment (instead of the last) fails 5
  assertions, including "no double counting" and "stock consumed exactly once".
