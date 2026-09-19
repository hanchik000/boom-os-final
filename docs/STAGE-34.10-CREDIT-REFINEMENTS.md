# Stage 34.10 — Credit (Долговая книга) refinements

Credit Mode was built in Stage 31 and has settled real sales ever since. Stage 34.10 does **not**
rebuild it. It closes the gaps between what Stage 31 shipped and what the 34.x specification asks
for, and it states the two accounting rules that everything else hangs off, in the reports and in
the tests, so they cannot quietly rot.

Nothing here is a second payment path, a second customer core or a second employee model.

---

## The two rules

**1. A credit sale IS a sale. It is NOT cash received.**

The sale settles through the one `POST /api/payments` route, exactly as CASH and CARD do: the same
order lock, the same idempotency key, the same READY/KDS gate, the same consumption and completion
at the end. The only difference is that `CREDIT` does not touch a shift total — it calls
`applyCreditSale()` inside the *same* transaction, which raises the account balance and writes one
`credit_transactions` row of type `CREDIT`. Revenue is recognised; the drawer is untouched.

**2. A repayment IS cash received. It is NOT a new sale.**

`POST /api/credit/repay` creates no order and no payment. It lowers the balance and writes a
`REPAYMENT` (or `PAYROLL_DEDUCTION`) row. A **CASH** repayment does move the drawer, but into
`cash_shifts.credit_repayments` — its own column, never `cash_sales` — so the shift reconciles
without the money being counted as a second sale. CARD, ONLINE, BONUS and OTHER repayments move
neither; `PAYROLL_DEDUCTION` moves nothing at all, because no money changed hands at the till.

Both rules are guarded statically (checks 13–17, 20) and proven at runtime (E2E steps 7, 8, 11c).

---

## What Stage 31 already had (and was left alone)

| Requirement | Where it already lived |
| --- | --- |
| Individual limit per customer / per employee | `credit_accounts.credit_limit`, set per account |
| Cashier issues within the limit | `applyCreditSale()` refuses `amount > available` |
| Manager may exceed it | the existing `credit.manage_limit` permission is the approval gate |
| Full / partial repayment, several methods | `POST /api/credit/repay`, idempotent on branch + key |
| Reports by customer / staff / branch / cashier | `/api/credit/reports/*` |
| Employee credit reuses the HR identity | `credit_accounts.employee_id → users.id`; no second profile |
| Money never Float | BigInt cents in, `CAST(? AS numeric)` out, `Decimal(12,2)` stored |

## What Stage 34.10 added

### 1. A debtor-status filter, applied by the server

```
GET /api/credit/reports/customers?branch_id=…&status=WITH_DEBT|SETTLED|OVER_LIMIT
GET /api/credit/reports/staff?branch_id=…&status=…
```

`CREDIT_DEBTOR_STATUSES` is declared once and turned into SQL by one `debtorStatusFilter()`:

* `WITH_DEBT` — `current_balance > 0`
* `SETTLED` — `current_balance <= 0`
* `OVER_LIMIT` — `current_balance > credit_limit`, i.e. each account against **its own** limit,
  never a shared one.

An unrecognised value means *no filter*, not an empty report. The applied status is echoed back, and
every row now carries `over_limit` and `available` computed server-side. The browser filters nothing
and computes nothing.

### 2. An archived employee keeps their debt and their history

A debt does not disappear because someone left. The staff report deliberately does **not** filter on
`users.deleted_at`; it selects `employment_status` and `(deleted_at IS NOT NULL) AS archived`
instead, so the row is visibly archived rather than silently gone. `GET /api/credit/accounts/:id`
does the same for the account owner. Static checks 26–29 pin this, including that nothing on this
path physically deletes an account or a movement.

### 3. A period-scoped, explainable drill-down

```
GET /api/credit/accounts/:id?start=…&end=…
```

returns the account, the owner (with `archived` / `employment_status`), `available_credit`,
`over_limit`, the echoed `period`, and the movements in that period joined to the **cashier** who
took each one, the **manager who approved** it where one did, and the **order number** it came from.
A balance can now be explained line by line instead of asserted.

### 4. The manager screen

`CreditReportsView` gains the three status chips, a period filter on the overview and cashier tabs,
an `АРХИВ` / `ARHIW` badge, a `СВЕРХ ЛИМИТА` / `ÇÄKDEN AŞA` badge, and a per-account history modal.
Every one of those is rendered from a server field. RU + TM throughout.

---

## Payroll deduction

It never happens automatically. `POST /api/credit/repay` with `method: PAYROLL_DEDUCTION` is refused
with `PAYROLL_DEDUCTION_REQUIRES_APPROVAL` unless the requesting user holds `credit.manage_limit`;
when they do, their id is stamped into `approved_by` and surfaced as `approver_name` in the
drill-down. This is the existing RBAC-as-approval-gate pattern used for over-limit sales — not a
second approval workflow with its own table and states.

---

## Isolation and audit

Every route is `requirePermission('credit.*')` and branch-checked through the same `allowed()` helper
the rest of the codebase uses: a branch A manager cannot read branch B receivables, open a branch B
account detail, or change a branch B limit (E2E 18, 18b, 18c). Account creation, limit changes and
repayments all go through the shared `insertAuditLog`.

---

## Tests

`tests/stage34_10_credit_refinements_static.mjs` — 44 source guards
`tests/stage34_10_credit_refinements_e2e.mjs` — 90 HTTP calls, 6 denials, 22 DB post-conditions

```
npm run test:stage34.10        # static
npm run test:e2e:stage34.10    # fresh-DB E2E
```

The E2E walks one branch end to end: two accounts with **different** individual limits; a cashier
issuing 200.00 inside a 250.00 limit and being refused at 300.00; a manager pushing that same sale
through; CASH and CARD repayments; a payroll deduction refused for the cashier and accepted from the
manager; the employee then archived and their 60.00 still present and flagged; and the four reports
filtered by status, period, branch and cashier.

### Negative control

Four forbidden behaviours were injected and each produced genuine failures before the source was
restored:

| Injected | Caught by |
| --- | --- |
| staff report filters archived employees out | static 26; E2E 12b, 16 |
| a CASH repayment books into `cash_sales` | static 15 |
| payroll deduction gate removed | static 18; E2E 10b, 10c, 11b |
| cashier limit check removed | static 9 |

---

## Repairs made to older stage tests

Running the full static suite surfaced six assertions from Stages 17, 31, 34.1–34.4 and 34.6 that
had gone stale as later stages moved or extended the code they pointed at. Each was **generalized to
the invariant it was actually defending**, never relaxed, and each was negative-controlled:

* **17 / 34.2** — item-removal re-pricing moved into `recomputeOrderTotals`; the checks now assert
  the delegation *and* that the core resolves the service charge from the order's own `created_at`.
* **31** — the payment-method and Cashier POS method lists are now parsed and checked for CREDIT
  *membership* (34.7 legitimately added BOOMBACK), the Customer-model check asserts there is exactly
  one guest model rather than measuring its length, and get-or-create is asserted where 34.3 moved
  it (`customers.ts`) plus that `credit.ts` never inserts a guest itself.
* **34.1** — the cashier permission check now parses the seed's cashier grant list and asserts
  membership of `orders.closure.request` and absence of `orders.closure.approve`.
* **34.3** — the discount base was renamed `scopeBase` in 34.4; the settled-order guard is now
  asserted by its own body plus a call-site floor, since 34.8 added a fourth route behind it.
* **34.4** — 34.7 made BOOMBACK the one partial-settlement method; the exact-amount and
  consume-once checks now assert the partial-aware forms, including that a partially settled order
  consumes nothing.
* **34.6** — the cabinet's cashback balance was `null` before the BOOMBACK ledger existed; it now
  asserts the balance is read from `boomback_ledger`, which is the stronger form of the same rule.
