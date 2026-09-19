# Stage 34.7 — BOOMBACK + Breakfast

## BOOMBACK is not a discount

It is **money the guest holds and spends**. Paying 500 BOOMBACK against a 1000 order leaves 500 to
settle in cash or card, and the order's `subtotal`, `discount` and `final_amount` never move. The
receipt prints it as a payment line:

```
ИТОГО              1000.00
BOOMBACK           -500.00
Оплата             CASH 500.00
```

Because it is a payment rather than a price change, it is the **one** method that may settle an
order only partially. Every other method still has to settle the remainder exactly, and the order —
or the separate check — is completed **only when it is fully paid**.

If the balance exceeds the bill, the guest can only spend what the bill is worth: a 520.00 balance
against a 480.00 order spends 480.00 and leaves 40.00 (a request for 520.00 is refused).

## The ledger is authoritative

`boomback_ledger` records every `EARNED` / `REDEEMED` / `ADJUSTMENT` / `REVERSED` entry with the
amount (signed), the balance before and after, and the order, bill, payment, actor and timestamp.
The balance is the **sum of that ledger**; `customers.boomback_balance` is a cache shown beside the
computed value. Every entry carries a never-null unique `entry_key`, and the customer row is locked
`FOR UPDATE`, so a retry or a concurrent till cannot spend or grant the same money twice.

Guards on spending: the order must have an identified guest (`BOOMBACK_REQUIRES_CUSTOMER`), the
balance is checked before the payment is written **and** re-checked under the row lock when the
ledger entry is written (`BOOMBACK_INSUFFICIENT_BALANCE`).

## Refunds give it back

Closing or refunding an order writes its own `REVERSED` rows: the BOOMBACK the guest spent comes
back to them, and any cashback earned on that order is taken back. Nothing is ever edited or
deleted.

## Cashback is configuration, not an invented rule

| Setting | Default |
|---|---|
| `BOOMBACK_CASHBACK_ENABLED` | `false` |
| `BOOMBACK_CASHBACK_PERCENT` | `0` |

BOOM OS does not decide that cashback exists or at what rate. With the switch on and a percentage
set, an **ACTIVE** BOOMCARD holder earns that percentage of what they actually settled — a candidate
or expired card earns nothing.

## Breakfast redemption uses the one inventory path

`POST /api/boomcard/:id/breakfast/redeem { order_id, menu_item_id, quantity }` adds a **real** menu
line to a real open order at a **customer price of 0**:

- the bill does not grow — the guest pays nothing for it;
- because it is an ordinary order item with an ordinary recipe, the **existing payment →
  consumption path** consumes its real ingredients and records its real `recipe_cost_snapshot`.
  There is no second inventory path here (a static guard asserts the redemption handler touches
  neither `stock_movements`, `inventory_items` nor `recipe_ingredients`);
- the card's allowance decreases and cannot be exceeded (`BREAKFAST_BALANCE_EXHAUSTED`);
- only an `ACTIVE` card and only an open order qualify;
- the redemption is recorded in the card's **own** event ledger (`BREAKFAST_REDEEMED`), separate
  from BOOMBACK.

BOOM OS does not hardcode which dishes count as breakfast — the cashier names the item the guest
actually took, and the card's remaining allowance is what limits it.

## The guest's cabinet

Stage 34.6's cabinet now reports the real cashback balance from the BOOMBACK ledger, alongside the
breakfast balance as granted / used / remaining.

## API

| Method | Path | Auth |
|---|---|---|
| `GET` | `/api/loyalty/boomback/customers/:id` | `loyalty.view` |
| `GET` | `/api/loyalty/boomback/ledger?branch_id&customer_id` | `loyalty.view` |
| `POST` | `/api/loyalty/boomback/adjust` | `loyalty.manage` (non-zero amount **and** a reason) |
| `POST` | `/api/boomcard/:id/breakfast/redeem` | `boomcard.manage` |
| `POST` | `/api/payments` with `method: "BOOMBACK"` | `payments.create` (partial allowed) |

## Database

One additive migration, `20260919220000_stage34_7_boomback`: the new `boomback_ledger` table plus a
cache column on `customers`.

## UI

Cashier POS gains `BOOMBACK` as a payment method: the dialog shows the guest's balance, accepts a
partial amount, states plainly that it is not a discount, and uses a **separate idempotency key** so
a BOOMBACK payment can never collide with the cash payment that settles the rest. The receipt prints
the BOOMBACK line. RU + TK.

## Tests

- `tests/stage34_7_boomback_static.mjs` — 36 source guards.
- `tests/stage34_7_boomback_e2e.mjs` — 133 HTTP calls, 8 denials, 22 fresh-DB post-conditions: the
  worked 1000 = 500 BOOMBACK + 500 cash example with the order untouched and completing only on the
  second payment, a balance larger than the bill, refusal without a guest or without balance, ledger
  reconciliation, a breakfast line at price 0 consuming 2 × 3 real eggs through the payment path with
  its cost still recorded, the allowance limiting it, cashback off by default then earning 10%, and
  both refund directions giving the money back as their own rows.
- Negative control: treating a partially settled order as settled, and ignoring the breakfast
  allowance, fails 6 E2E post-conditions and both corresponding static guards.
