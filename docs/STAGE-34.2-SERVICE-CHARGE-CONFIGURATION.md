# Stage 34.2 — Service Charge / Business Configuration

## What changed

The service charge used to be a single mutable row per branch (`percent` + a flat allocation list),
applied only to `DINE_IN` at a percentage that fell back to a hardcoded `10`. It is now a
**configuration version** carrying per-order-type percentages and a category-based distribution
model, resolved through one core: `server/service-charge.ts`.

Two separate questions live in that core and are never confused:

1. **How much** service charge an order carries — a percentage of its subtotal, per order type.
2. **Who** that money belongs to — categories → individual employees or a common pool.

## Versions, not edits

`PUT /api/service-charge/:branchId` no longer updates a row. It archives the version in force
(stamping `effective_to`) and inserts a new `ACTIVE` one, returning **201**. `GET .../history`
returns the whole chain. An order records `service_charge_config_id` at creation, so:

- changing the configuration never re-prices or re-distributes an existing order;
- recalculating an order after an item removal resolves the percentage **at the order's own
  `created_at`**, not at today's configuration.

A version is either `scope=BRANCH` or `scope=ORGANIZATION`. A branch version always wins over the
organisation-wide default; publishing the organisation default additionally requires
organisation-level rights.

## Categories and modes

Five categories: `BAR`, `KITCHEN`, `WAITERS`, `MANAGERS`, `OTHER`. Each carries its own percentage
(of the same base the service charge itself uses, so the numbers are directly comparable), a mode
and — for common mode — a distribution strategy. Modes may be mixed freely across categories.

| Mode | Behaviour |
|---|---|
| `INDIVIDUAL` — *«Индивидуальное начисление»* | Named employees each hold their own percentage inside the category and are paid **immediately at payment time**. A member at `0%` is a legitimate configuration and simply earns nothing — no row, no error. |
| `COMMON` — *«Общее распределение»* | The category percentage forms **one pool per order**, distributed later to its members by the category's strategy. |

Strategies: `EQUAL`, `BY_SALES`, `BY_ORDERS`, `BY_HOURS`. Each is computed from real recorded data
over the distribution period — completed-order subtotals, completed-order counts, and real logged-in
POS session time respectively. The set is a single exported constant, so a future strategy is one
addition, not a rewrite.

## The money can never be exceeded, and is never lost

- Publishing validates that the categories' total ≤ the service charge percentage
  (`ALLOCATIONS_EXCEED_SERVICE_CHARGE`) and that an `INDIVIDUAL` category's members ≤ that category
  (`MEMBER_ALLOCATIONS_EXCEED_CATEGORY`).
- Recording re-checks at runtime: no allocation is written that would push the total past the
  service charge the order **actually collected**.
- Whatever is left over is written as an explicit `ESTABLISHMENT` row, so the ledger reconciles
  exactly to `orders.service_charge` — money is neither invented nor silently dropped. (Previously,
  an unallocated remainder simply did not appear anywhere.)
- The pre-existing rule that only a `PROFESSIONAL` waiter shares in the service charge is preserved
  as a membership filter; an excluded member's share falls to the establishment rather than being
  quietly redistributed.

## Distribution

`POST /api/service-charge/:branchId/distribute { from, to }` splits the `POOLED` rows earned in a
period among their category's members:

- weights come from real data for the same period;
- each pool is split **within its own order**, so every distributed row stays attached to the order
  that earned it and the totals reconcile exactly;
- leftover cents go by largest remainder — nothing is rounded away or invented;
- the pool is then marked `DISTRIBUTED`, so it can never be paid twice (re-running is a no-op);
- a pool whose members all weigh zero is **reported** as `ZERO_WEIGHT` and left `POOLED`. It is
  never split on a guess, and the money is never lost — the manager can change the strategy and
  re-run.

## Order types

`percent` (dine-in), `takeaway_percent` (pickup) and `delivery_percent` are three separate
configurable values on every version, each falling back to its own system setting
(`DINE_IN_SERVICE_CHARGE_PERCENT`, `TAKEAWAY_SERVICE_CHARGE_PERCENT`,
`DELIVERY_SERVICE_CHARGE_PERCENT`) when no version is in force. Nothing is hardcoded in route or UI
code any more, and takeaway is no longer forced to zero by an `if (orderType === 'DINE_IN')`.

## Database

One migration, `20260919120000_stage34_2_service_charge_config`:

- `service_charge_configs`: `branch_id` becomes nullable and loses its unique constraint (a branch
  now has a version history, and `NULL` means the organisation default); adds `scope`,
  `takeaway_percent`, `delivery_percent`, `effective_from`, `effective_to`, `note`, `created_by`.
- new `service_charge_categories`.
- `service_charge_allocations`: adds `category_id`.
- `service_charge_ledger`: adds `category`, `config_id`, `strategy`, `allocation_key`, `pool_id`;
  the uniqueness that makes recording idempotent moves to `(order_id, allocation_key)`.
- `orders`: adds `service_charge_config_id`.

The migration backfills `effective_from` from `created_at` and `allocation_key` from the existing
columns **before** the `NOT NULL` and `UNIQUE` constraints are applied, so it is safe on an existing
installation.

### Why the uniqueness key changed

The old constraint was `(order_id, user_id, target_type, department)`. Postgres treats `NULL`s as
distinct, so any row with a null `user_id` or `department` — exactly the new pool and establishment
rows — would have slipped past it and been duplicated on a retry. `allocation_key` is never null and
is derived deterministically, so `ON CONFLICT DO NOTHING` genuinely holds.

## API

| Method | Path | Permission |
|---|---|---|
| `GET` | `/api/service-charge/:branchId` | `service_charge.view` |
| `GET` | `/api/service-charge/:branchId/history` | `service_charge.view` |
| `PUT` | `/api/service-charge/:branchId` → **201** (new version) | `service_charge.manage` |
| `GET` | `/api/service-charge/:branchId/ledger` | `service_charge.view` |
| `POST` | `/api/service-charge/:branchId/distribute` | `service_charge.manage` |

No new permissions were added — the existing `service_charge.view` / `service_charge.manage` pair
covers the whole feature. Every route keeps the existing `allowed(req, branchId)` branch check.

**Removed contract:** the flat `allocations[]` payload no longer exists. Rather than ignoring it and
leaving a caller believing they had configured a distribution they had not, it is refused with
`400 ALLOCATIONS_REPLACED_BY_CATEGORIES`, naming what replaced it.

## UI

New **Сервисный сбор / Hyzmat ýygymy** screen (`service_charge.view`), with three tabs: the
configuration builder (per-order-type percentages, categories with mode/strategy/members, a live
"allocated / remaining to the establishment" readout), the version history, and the ledger with the
period distribution control. RU + TK throughout. The form's own validation is explicitly documented
as guidance — the backend refuses an over-allocation regardless — and the screen never computes an
authoritative distributed amount itself.

## Tests

- `tests/stage34_2_service_charge_static.mjs` — 42 source guards.
- `tests/stage34_2_service_charge_e2e.mjs` — 80 HTTP calls, 10 denials, 30 fresh-DB post-conditions,
  including the exact worked example from the specification (15% split BAR 1 / KITCHEN 2 / WAITERS 5
  individual / MANAGERS 4 / OTHER 3), a 0% member earning nothing, the establishment remainder, the
  ledger reconciling exactly, an already-paid order surviving two later version publications
  unchanged, takeaway using its own percentage, and real `EQUAL` / `BY_SALES` distribution with an
  exact split and a reported zero-weight pool.
- Negative control: removing the runtime cap and the establishment remainder fails 5 of the
  post-conditions, including the reconciliation check.
- Regression: all static suites and all E2E suites (19–34.1) re-run clean.

### Prior tests updated

Six suites sent the removed `allocations[]` payload or expected `200` from a publish. Each was
migrated to the category model and the version semantics — including the isolation suites
(21/22/23/24), where sending an invalid payload would have turned a genuine **authorization**
denial into a mere validation error. `stage28_5` asserted "no allocations configured → zero ledger
rows"; that is exactly the behaviour this stage corrects, so it now asserts that the whole service
charge is booked to the establishment and reconciles. Three Stage 17/18 static assertions were
re-pointed at the service-charge core the routes now delegate to, and the Stage 17 item-removal
assertion was **strengthened** to require the order's own creation moment.
