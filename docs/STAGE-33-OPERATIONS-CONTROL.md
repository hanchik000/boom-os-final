# Stage 33 — Operations Control Center (Live Operations)

## What was implemented

A manager-facing "right now" operational screen, `Live Operations`, built on top of the existing
Order Core, KDS, CashShift, operator/waiter session, credit and inventory tables. It answers a
different question than the Stage 32 Command Center: not "what happened financially/operationally
today" but "what is happening right now and what needs my attention."

- Live order board (active orders only: `PENDING_CONFIRMATION` / `CONFIRMED` / `PREPARING` / `READY`)
  with per-order elapsed time and a backend-computed delay classification.
- KDS operational monitor: NEW/PREPARING/READY counts, active tickets with delay state, oldest
  active ticket, today's average preparation time (real, from `kds_tickets.started_at`/`ready_at`;
  `null` when no samples exist — never fabricated).
- Table occupancy (`dining_tables.status`), only shown to callers with `tables.view`.
- Waiter workload: active session, active orders, open tables, sales today, pending removal
  requests — reusing the existing waiter/session/order/removal-approval tables, not a second KPI
  engine.
- Cashier operations: the branch's one open `CashShift`, its real cashier, whether that cashier
  currently holds an active POS session, and transaction count for that shift.
- Active POS sessions (operator + waiter), name/role/branch/started/last-activity only — no
  tokens or hashes are ever selected.
- Operational alert center: `DELAYED_ORDER`, `PENDING_REMOVAL_REQUEST`, `OPEN_CASH_SHIFT` (carried
  over from a prior day), `CASH_DIFFERENCE` (today's closed shift), `CREDIT_LIMIT_ISSUE`,
  `LOW_STOCK`/out-of-stock. Every alert traces to a real row from a real query; nothing is
  synthesized unconditionally.
- One live manager action: inline **approve/reject** of a pending item-removal request, calling
  the existing, already-permissioned and already-audited
  `POST /api/orders/removal-requests/:id/approve|reject` endpoints. No new mutation logic was
  written for Stage 33.

## Endpoint

`GET /api/operations/live?branch_id=<id>`

Single aggregation endpoint. Every section runs its own `GROUP BY`/aggregate SQL against existing
tables; no raw-row dumps, no N+1 per-order queries. A section is included in the response only
when the caller holds that section's own existing permission (see below) — it is omitted from the
JSON entirely when absent, not merely hidden client-side.

## Delay detection (backend-authoritative, configurable)

Two new rows in the existing `system_settings` table (the same key/value store `settings.ts`
already exposes via `GET/PUT /api/settings`):

- `KDS_PREP_WARNING_MINUTES` (seeded default `15`)
- `KDS_PREP_DELAYED_MINUTES` (seeded default `25`)

`delayState()` classifies an order/ticket as `NORMAL` / `WARNING` / `DELAYED` from the real KDS
`started_at` (falling back to `created_at` when a ticket hasn't started) compared against these
two thresholds. Classification uses the *raw* elapsed minutes, never a value already rounded for
display — a real bug in an early draft (rounding to 6-second buckets before the threshold compare)
was caught by the E2E test and fixed before commit. Editable only by `settings.update`
(Owner/SuperAdmin), same as every other system setting; nothing about the threshold is hardcoded
in the route or in the frontend.

## Permissions

- `operations.view` — new permission, gates the whole endpoint and the Sidebar nav item. Granted
  to Owner / Super Admin / General Manager / Branch Manager, the same role set as `dashboard.view`.
- Every section inside the response is additionally gated by the permission its own existing
  endpoint already requires: `orders.view`, `kds.view`, `tables.view`, `kpi.view` (waiters),
  `cash_shifts.view`, `orders.item_remove.approve` (removal requests), `pos.operator` /
  `waiter_codes.manage` (POS sessions), `credit.reports`, `inventory.view`. This permission was
  never used to grant access to a domain the caller couldn't already reach through its own route.
- Branch authorization uses the same `allowed(req, branchId)` helper as every other route in the
  codebase — `user.isSuperUser || user.allowedBranchIds.includes(branchId)` — never a
  frontend-supplied branch trusted without a server check.

## Financial integrity

No new financial calculation was introduced. `cashier_operations.expected_cash` uses the exact
same formula as Stage 31/32
(`opening_cash + cash_sales + credit_repayments − refunds − voids`), verified in the E2E test
against a direct `GET /api/cash-shifts/current` read to prove there is no independent
recalculation drift. All money fields flow through the same `moneyCents`/`centsText` BigInt-cents
helpers used since Stage 31 — no `Float`.

## Security

- No token/pin hash is ever selected for the POS-sessions list.
- The one mutation this screen offers (approve/reject a removal request) is the pre-existing,
  already-RBAC-checked, already-audited, already-branch-isolated endpoint — verified in the E2E
  test: a `CASHIER` and a manager from a different branch are both denied, and the resulting audit
  row is confirmed present after a successful approval.
- No new tables, no new write path for orders/payments/cash/credit.

## Tests

- `tests/stage33_live_operations_static.mjs` — 36 checks (permission wiring, RBAC-on-server not
  UI-only, reuse of existing tables/helpers, delay-threshold configurability, no new mutation
  routes, RU/TK i18n convention, drill-down wiring).
- `tests/stage33_live_operations_e2e.mjs` — 25 real DB post-conditions on a fresh database:
  manager access, RBAC denial (cashier), branch isolation (Branch A manager vs Branch B),
  superuser cross-branch access, live order board correctness, order-status transitions reflected
  live, real delay detection against a temporarily lowered real threshold, KDS counts, waiter
  workload, cashier/shift state cross-checked against the CashShift source of truth, POS session
  visibility (with a hash/token-leak check), inventory and credit alerts backed by real rows,
  removal-request visibility → inline approval → audit-log confirmation → order dropping off the
  live board once paid.
- Both suites were run against a negative control (files removed/stashed) to confirm they fail
  for the right reason before being restored.
- Regression: Stage 29, 30, 31, 32 E2E suites re-run clean against the final state.

## Known intentional limitations

- Table occupancy shows at most one "active order" per table in the response; if a table were
  (unusually) linked to more than one simultaneously active order, only the most recently created
  one is surfaced. This matches how the existing `dining_tables`/`orders` relationship is used
  elsewhere in the app (one active order per table in normal operation).
- "Overdue credit" (a due-date-based alert) was intentionally not built: no due-date field exists
  on `CreditAccount`, and the task instructions explicitly forbid fabricating data that doesn't
  exist. `CREDIT_LIMIT_ISSUE` (balance ≥ limit) is implemented instead, which is real.
- `FAILED_PAYMENT` and `SYSTEM_ERROR` alert types were not built: there is no failed-payment
  tracking or runtime error log in the existing schema to source them from honestly.
- A "stale POS session" alert was intentionally not built: beyond the session's own `expires_at`
  (already enforced), there is no non-arbitrary way to define staleness without inventing a second
  timeout constant; `last_activity` is still surfaced for the manager to judge.
- Polling refresh is a 20-second `setInterval` (cleaned up on unmount), not WebSockets/SSE, per
  the stage's own instruction not to introduce realtime infrastructure.

## Commit

`ac0d69b`
