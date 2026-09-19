# Stage 34.3 — Customer Manual Discounts

## The rule

**There is no automatic discount in BOOM OS.** A customer profile has no discount field of any kind
(a static test asserts the schema itself), attaching a guest to an order never changes its price,
and a discount exists only because an authorised employee granted it on one specific order.

## Flow

```
ПОИСК КЛИЕНТА  →  выбрать / создать  →  привязать к Order  →  "+ Скидка"
                                                                 ↓
                                        10 / 15 / 20 / 30 / custom  (configurable presets)
                                                                 ↓
                                        server validates and COMPUTES the amount
                                                                 ↓
                                        snapshot row + audit + order recomputed
```

The amount is **always** computed by the server from the order's real subtotal. The POS sends a
percentage (or a fixed amount) and a reason; it never sends or computes a total.

## What is recorded

Every grant writes an `order_discounts` row — the audit-grade snapshot the specification asks for:

| Field | Meaning |
|---|---|
| `customer_id` | the guest the order is attached to |
| `percent` | the granted percentage (`null` for a fixed-amount discount — no percentage is invented) |
| `amount` / `base_amount` | what it is worth, and the subtotal it was computed from |
| `applied_by_user_id` / `applied_by_role` / `source` | who granted it, in what role, from which POS |
| `reason` | free text where applicable |
| `created_at` / `removed_at` / `removed_by` | when |

Removing a discount is a **soft** reversal: the row is marked `REMOVED`, never deleted, and the
order is recomputed. Both the grant and the removal are audited (`ORDER_DISCOUNT_APPLIED` /
`ORDER_DISCOUNT_REMOVED`), as is attaching a guest (`ORDER_CUSTOMER_ATTACHED`).

## Old receipts never change

A discount — and a customer attachment — is only accepted while the order is
`PENDING_CONFIRMATION | CONFIRMED | PREPARING | READY`. Once it is settled or closed, every one of
these endpoints answers `409 ORDER_NOT_EDITABLE`. A paid order's discount, total and customer are
exactly what was printed.

## Limits

Two configurable settings, not numbers in the UI:

- `MANUAL_DISCOUNT_PRESETS` (default `10,15,20,30`) — the buttons the POS offers.
- `MAX_MANUAL_DISCOUNT_PERCENT` (default `30`) — above this, a grant needs
  `orders.discount.override`; a cashier is refused with `403 DISCOUNT_EXCEEDS_LIMIT` naming the
  ceiling. A discount larger than the subtotal is refused outright.

The POS reads both from `GET /api/orders/discount-options`.

## One order-pricing rule

The item-removal path used to recompute subtotal / service charge / final amount inline. Discounts
need exactly the same recomputation, so it now lives once in `server/order-totals.ts` and both paths
call it:

- a **percentage** discount follows the subtotal — removing half the items halves the discount;
- a **fixed-amount** discount never exceeds the subtotal;
- the service charge keeps its existing base (the pre-discount subtotal) at the percentage of the
  configuration version that priced the order, never today's (Stage 34.2);
- `final_amount = subtotal − discount − promotion + service_charge`, never negative.

All of it is BigInt-cents arithmetic; no Float.

## One customer core

Customers already existed under `/api/credit/customers`, gated by credit permissions. They are now
also a first-class CRM surface at `/api/customers` with `customers.view` / `customers.manage` — on
the **same** `customers` table. Both surfaces share one `findOrCreateCustomer` routine, so reaching
a guest through either door returns the same record and a branch + phone already on file is never
duplicated (proven in the E2E). The frontend's `createCustomer` / `getCustomers` were repointed at
the CRM surface; the credit module keeps only its own detail accessor (renamed
`getCreditCustomer`), because that response additionally carries the credit account.

## API

| Method | Path | Auth |
|---|---|---|
| `POST` | `/api/orders/:id/customer` | waiter POS session (own order) **or** JWT + `orders.confirm` |
| `GET` | `/api/orders/discount-options` | `orders.view` |
| `POST` | `/api/orders/:id/discount` | waiter POS session (own order) **or** JWT + `orders.discount.apply` |
| `DELETE` | `/api/orders/:id/discount` | same |
| `GET` | `/api/orders/:id/discounts` | `orders.view` |
| `GET`/`POST` | `/api/customers`, `GET /api/customers/:id` | `customers.view` / `customers.manage` |
| `GET`/`POST` | `/api/customers/pos/search`, `/api/customers/pos` | waiter POS session |

A waiter may act only on their own order in their own branch; an operator is branch-checked with the
existing `allowed(req, branchId)` helper. Every grant records the acting role, so a waiter-granted
discount is distinguishable from a cashier-granted one.

## RBAC

Four new permissions: `orders.discount.apply`, `orders.discount.override`, `customers.view`,
`customers.manage`. Managers get all four; the cashier gets `orders.discount.apply`,
`customers.view` and `customers.manage` but **not** `orders.discount.override`.

## Database

One additive migration, `20260919140000_stage34_3_manual_discounts`: the new `order_discounts`
table plus a nullable `orders.customer_id`.

## UI

Cashier POS gains, on the selected open order: the attached guest with a **Поиск клиента** dialog
(search by name/phone, plus quick create) and a **+ Скидка** dialog whose preset buttons and ceiling
come from the backend. The screen states explicitly that attaching a guest does not change the
price, never computes a discounted total itself, and always re-reads the order the server returned.
RU + TK throughout. (The waiter-side customer search is wired in the API client here and surfaced in
the POS in 34.9, which owns the cross-surface CRM flow.)

## Tests

- `tests/stage34_3_discounts_static.mjs` — 36 source guards.
- `tests/stage34_3_discounts_e2e.mjs` — 68 HTTP calls, 12 denials, 21 fresh-DB post-conditions:
  attaching a guest leaves the price untouched, the same phone never duplicates a guest across the
  CRM and credit surfaces, the server computes 15% of 100.00, the ceiling is enforced for a cashier
  and overridable by a manager, a waiter-granted discount is recorded against the waiter role, a
  settled order refuses every further change, a percentage discount follows an item removal, and a
  fixed-amount discount invents no percentage.
