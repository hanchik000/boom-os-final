# Stage 34.8 — Complimentary Items («ОТ ЗАВЕДЕНИЯ»)

## Flow

```
REQUEST (waiter POS or cashier)  →  manager queue  →  ONE authorised approval
                                                              ↓
                                         a REAL order line at customer price 0
                                                              ↓
                                   real recipe consumed at payment · real cost recorded · audited
```

A waiter or cashier may only **request**. Exactly one authorised manager approves, and **only then**
does an order line appear. Until approval, nothing whatsoever is added to the order — the E2E asserts
the bill and its line count are unchanged while the request is pending.

## Reasons

Defined once, server-side, and served to the POS by `GET /api/orders/compliment-reasons` so the UI
never invents them:

`COMPLIMENT` · `APOLOGY` · `GIFT` · `ESTABLISHMENT_ERROR` · `BIRTHDAY` · `OTHER`

## Customer price 0, establishment cost recorded

The approved line is an **ordinary order item** with `price_snapshot = 0`, so:

- the bill does not grow — the guest pays only for what they ordered;
- because it is an ordinary item with an ordinary recipe, the **existing payment → consumption
  path** consumes its real ingredients and records its real `recipe_cost_snapshot`. The approval
  handler itself touches neither `stock_movements`, `inventory_items` nor `recipe_ingredients` — a
  static guard asserts this, and the E2E proves 50 g of chocolate really left stock and 20.00 of
  cost was recorded against a line the guest paid 0.00 for.

The **normal menu value** is snapshotted at request time, so the give-away can still be valued later
even if the menu price changes.

## Double approval is impossible

Three layers: the decision reads the request `FOR UPDATE`, refuses anything that is not `PENDING`,
and the status update itself re-asserts `AND status='PENDING'`. The requester can never approve
their own request (`SELF_APPROVAL_FORBIDDEN`). Two concurrent approvals produce no second line —
asserted in the E2E.

## History never changes

A compliment is only accepted on an open order (and not on a paid separate check). Once the order is
settled, both requesting and approving are refused, so an old receipt can never change. A rejection
is a status, never a deletion — rejected requests stay on the record with their decision reason.

## The report

`GET /api/orders/compliment-requests?branch_id&status=APPROVED[&from&to]` is both the manager queue
and the give-away report, carrying everything the specification asks for in one place:

**reason · employee · approver · customer · order · item · normal value · real cost · branch ·
date**, plus totals grouped by reason. The cost column is the order line's **own historical**
`recipe_cost_snapshot` — never a recomputation from today's recipe.

## RBAC

Two new permissions: `orders.compliment.request` (managers + cashier; a waiter uses their POS
session) and `orders.compliment.approve` (managers only). Every route is branch- or waiter-scoped
with the existing helpers, and request / approval / rejection are all audited — the approval entry
explicitly records `customer_price: "0.00"`.

## Database

One additive migration, `20260920000000_stage34_8_compliments`: the new `compliment_requests` table.

## UI

- **Cashier POS** — an **ОТ ЗАВЕДЕНИЯ** action on the open order: item, quantity, a reason from the
  backend's list, and a comment. It states that the cashier only sends a request, and that the guest
  pays nothing while the real cost is still recorded. It never approves and never computes a value.
- **Manager approvals screen** — a compliments section above closures and item removals, showing the
  dish, quantity, reason, the snapshotted normal value, the guest and the requester, with approve /
  reject. RU + TK.

## Tests

- `tests/stage34_8_compliments_static.mjs` — 32 source guards.
- `tests/stage34_8_compliments_e2e.mjs` — 87 HTTP calls, 11 denials, 20 fresh-DB post-conditions:
  nothing added while pending, approval creating the zero-price line without growing the bill, no
  stock moving at approval time, real consumption and real cost at payment, double and concurrent
  approval refused, self-approval refused, a rejection adding nothing, a settled order refusing both
  request and approval, and the full report with its totals.
- Negative control: creating the line at request time, and removing the already-decided guard, fails
  8 post-conditions and both corresponding static guards.
