# Stage 34.9 — Customer POS / CRM Flow

## One customer, every surface

```
                    ┌──────────────────────────────┐
  waiter POS  ──────┤                              ├────── BOOMCARD cabinet
  cashier POS ──────┤     ONE customer record      ├────── BOOMCOIN / BOOMBACK
  CRM screen  ──────┤  (per guest, per branch)     ├────── credit account
                    └──────────────────────────────┘
```

There is no second customer identity anywhere. Every surface reaches the same `customers` row
through the same `findOrCreateCustomer` routine, so a guest already on file is returned rather than
duplicated — proven in the E2E across the **POS**, the **cashier** and the **credit** surfaces.

## Name required, phone optional

A guest can be created from the POS with a **name alone**. A phone is what lets the same guest be
recognised at the next visit, so:

- when a phone is given, an existing record is returned instead of a duplicate;
- when it is not, a blank is stored as `NULL` — Postgres allows many NULLs in a unique index, so two
  walk-in guests never collide;
- `customers.phone` is now nullable, and the `(branch_id, phone)` uniqueness that prevents
  duplicates is unchanged.

## Identification never changes a price

There is still **no discount field on a customer profile**, and attaching a guest to an order
touches no money column at all — a static guard asserts the attach handler contains no
`recomputeOrderTotals`, `final_amount` or discount write. Both POS screens and the CRM screen say
so in plain words. The E2E attaches a guest to a 400.00 order and asserts the guest pays 400.00.

## The unified identity payload

`GET /api/customers/:id` (CRM) and `GET /api/customers/pos/:id` (waiter POS session) return the
**same** structure, built by one routine:

| Field | Source |
|---|---|
| `orders` | the guest's orders |
| `discounts` | discounts they were granted |
| `boomcard` | their card and its breakfast balance |
| `boomcoin` | balance + qualifying spend, summed from `boomcoin_ledger` |
| `boomback` | balance, summed from `boomback_ledger` |
| `credit` | their credit account, limit and current debt |

Each balance is **recomputed from its own authoritative ledger**, never read from a cached column,
so the waiter POS, the cashier, the cabinet and CRM can never disagree — the E2E asserts the POS and
CRM numbers are identical and that the guest's own cabinet shows the same cashback balance.

## API

| Method | Path | Auth |
|---|---|---|
| `GET` | `/api/customers/pos/search?search=` | waiter POS session |
| `POST` | `/api/customers/pos` | waiter POS session (name required, phone optional) |
| `GET` | `/api/customers/pos/:id` | waiter POS session (own branch) |
| `GET`/`POST` | `/api/customers` | `customers.view` / `customers.manage` |
| `GET` | `/api/customers/:id` | `customers.view` |
| `PATCH` | `/api/customers/:id` | `customers.manage` (name, birth date) |
| `POST` | `/api/orders/:id/customer` | waiter POS session (own order) or `orders.confirm` |

Every authenticated route is branch-checked with the existing `allowed(req, branchId)` helper; the
POS routes are scoped to the session's own branch; a customer from another branch can never be
attached to an order.

## UI

- **Waiter POS** — the «Мои заказы» list gains a **Клиент** action: search by name or phone, quick
  create (name required, phone optional), attach or detach, and — once attached — the guest's
  BOOMCOIN, BOOMBACK, BOOMCARD status and credit debt at a glance. It states that attaching a guest
  does not change the price, and computes none of those numbers itself.
- **Cashier POS** — unchanged from 34.3/34.5/34.7; it already uses the same central client methods.
- **New CRM screen (Клиенты)** — search, create, and a profile showing the loyalty tiles, the birth
  date, recent orders and every discount the guest was granted. RU + TK.

## Database

One migration, `20260920020000_stage34_9_customer_pos`: a single nullability relaxation on
`customers.phone`. Nothing is dropped.

## Tests

- `tests/stage34_9_customer_pos_static.mjs` — 25 source guards.
- `tests/stage34_9_customer_pos_e2e.mjs` — 61 HTTP calls, 6 denials, 18 fresh-DB post-conditions:
  creation with a name alone, two phone-less walk-ins not colliding, the same phone returning the
  same guest from the POS / cashier / credit surfaces, attaching leaving the price untouched, one
  record carrying BOOMCOIN + BOOMBACK + BOOMCARD + credit, the POS and CRM agreeing exactly, the
  cabinet agreeing too, branch isolation, and the guest paying full list price after being
  identified.
- Negative control: storing a blank phone as an empty string, and serving the loyalty balance from
  something other than its ledger, fails 4 post-conditions and both corresponding static guards.
