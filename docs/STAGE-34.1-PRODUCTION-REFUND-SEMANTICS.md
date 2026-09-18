# Stage 34.1 — Production, Cancellation and Refund Semantics

> **ВОЗВРАТ ДЕНЕГ НЕ РАВЕН ВОЗВРАТУ ИНГРЕДИЕНТОВ.**
> Если бургер уже приготовлен, ингредиенты НЕ возвращаются на склад.

## What changed

Before this phase, refunding a payment unconditionally put every consumed ingredient back on the
shelf (`restoreInventoryForOrder` in `payments.ts`). Because a payment can only be taken once the
kitchen ticket has reached READY, **every refundable order is an order whose food was already
produced** — so that helper was, by construction, always wrong. It is deleted.

What happens to the products is now an explicit, manager-approved decision that travels with the
cancellation itself, and it is applied independently of the money.

## The flow

```
WAITER "ОТКАЗ"  ─┐
CASHIER "ЗАКРЫТО ├─►  OrderClosure (PENDING)  ─►  MANAGER APPROVAL  ─┬─► inventory decision
ЗАВЕДЕНИЕМ"     ─┘    reason + comment                              └─► financial refund
                      + inventory_treatment                              (only if requested
                      + refund_requested                                   and approved)
                      + production_state snapshot
```

- A waiter can only **request** a `CANCELLATION`, on their own order, in their own branch, and can
  never request a refund. A cashier can additionally request `CLOSED_BY_ESTABLISHMENT`, with or
  without a refund.
- Neither can finalise: the request is always inserted as `PENDING`, and the requester can never
  approve their own request (`SELF_APPROVAL_FORBIDDEN`, the same four-eyes rule the existing
  item-removal approvals use).
- Approving a closure that carries a refund additionally requires `payments.refund`.

## The inventory decision is never guessed

`inventory_treatment` is **mandatory** on every request (`INVENTORY_TREATMENT_REQUIRED`) and is
never defaulted in the UI — neither POS screen pre-selects an option, and neither can submit
without one. The chosen, approved value is the source of truth.

| Decision | Effect |
|---|---|
| `WRITE_OFF` — *«Списать продукты»* | Never restores. If the order was already paid, the `SALE` movement already removed the stock, so nothing moves again (moving it twice would double-count) and only the loss **value** is recorded on the closure. If the order was never paid but production had started, the ingredients were physically used without ever being deducted, so they are deducted now as a `WASTE` movement with reason `PRODUCTION_LOSS`, referenced to the closure. |
| `NO_WRITE_OFF` — *«Не списывать продукты»* | Explicitly leaves inventory untouched. |
| `RESTORE_STOCK` | Reverses the recorded `SALE` quantities as `RETURN` movements — and is **refused with `INVENTORY_RESTORE_FORBIDDEN_AFTER_PRODUCTION` once production has started**, checked both when the request is raised and again when it is approved. |

The production lifecycle is the **pre-existing KDS ticket**, not a second state machine:
`NOT_STARTED` (no ticket) → `QUEUED` (NEW) → `PREPARING` → `READY` → `SERVED` (COMPLETED).
"Production started" is derived from `started_at` as well as the status, so a ticket cancelled
mid-production still counts as started.

`write_off_cost` on the closure is always valued from the **recorded historical ledger rows**
(`SALE` quantity × the `unit_cost` stamped at consumption), never re-derived from today's recipe —
the Stage 34 historical-snapshot rule, preserved.

## No arbitrary historical refund

`POST /api/payments/:id/refund` now requires an `APPROVED` closure for that order with
`refund_requested = true` whose refund has not already been applied. Without one it answers
`409 REFUND_REQUIRES_APPROVED_CLOSURE`. A refund is only ever the financial half of an authorised
closure, and it touches **no** inventory.

## Never deleted

No order, payment, order item or stock movement is ever physically deleted. A closed order simply
reaches a terminal status: `CANCELLED`, `REFUNDED`, or the new `CLOSED_BY_ESTABLISHMENT`, and stays
fully readable with its items, its closure record, its reason, its requester and its approver.

## Automatic cancellation

Two configurable thresholds were added to `system_settings` (editable through the existing Settings
screen, never hardcoded in route or UI code):

- `ORDER_CONFIRMATION_TIMEOUT` — minutes an order may stay in `PENDING_CONFIRMATION`.
- `KITCHEN_ACCEPT_TIMEOUT` — minutes a confirmed order may wait for the kitchen to start.

`POST /api/orders/closures/auto-cancel` (permission `orders.closure.approve`) applies them. It is an
explicit, authorised, audited action rather than a hidden background mutation, and it **never**
cancels an order whose production has started — that decision belongs to a human.

## API

| Method | Path | Auth |
|---|---|---|
| `POST` | `/api/orders/:id/closure-requests` | waiter POS session **or** JWT + `orders.closure.request` |
| `GET` | `/api/orders/closure-requests?branch_id&status` | `orders.closure.approve` |
| `POST` | `/api/orders/closure-requests/:closureId/approve` | `orders.closure.approve` (+ `payments.refund` when a refund is attached) |
| `POST` | `/api/orders/closure-requests/:closureId/reject` | `orders.closure.approve` |
| `POST` | `/api/orders/closures/auto-cancel` | `orders.closure.approve` |
| `GET` | `/api/orders/pos/mine` | waiter POS session (that waiter's own open orders, for the ОТКАЗ screen) |

Every route re-uses the existing `allowed(req, branchId)` branch-authorization helper; the waiter
path is additionally scoped to that waiter's own order.

## Database

One additive migration, `20260918210000_stage34_1_order_closures`:

- new table `order_closures` (type, reason, comment, `inventory_treatment`, `refund_requested`,
  status, `production_state`, requester + role, approver + decision reason, `refund_payment_id`,
  `inventory_applied`, `paid_at_request`, `write_off_cost`, timestamps);
- `stock_movements.unit_cost` widened `DECIMAL(14,2)` → `DECIMAL(14,4)`.

### A real Stage 34 defect this uncovered

Stage 34 started stamping the ingredient's weighted-average cost (a `DECIMAL(14,4)` value) onto
`SALE` stock movements, but `stock_movements.unit_cost` held only two decimals: a real average cost
of `0.0250` was silently stored as `0.03` — a 20% error on every cost read back from the ledger.
Stage 34's own assertion missed it because it compared with a 0.01 tolerance. The column is widened
and that assertion is now exact.

## RBAC

Two new permissions, granted through the existing role machinery:

- `orders.closure.request` — Owner, Super Admin, General Manager, Branch Manager **and** Cashier.
- `orders.closure.approve` — Owner, Super Admin, General Manager, Branch Manager only.

## UI

- **Waiter POS** — a «Мои заказы» panel listing that waiter's open orders with an **ОТКАЗ** action:
  reason, optional comment, and a mandatory *Списать продукты / Не списывать продукты* choice.
  Submitting shows "sent to the manager for approval"; an order with a pending request shows that
  instead of the button.
- **Cashier POS** — a **ЗАКРЫТО ЗАВЕДЕНИЕМ** action on the selected order: reason, comment, the same
  mandatory product choice, and (only for a paid order) a "return the money" checkbox.
- **Manager approvals screen** — the existing Order Approvals view now has a closures section above
  item removals, showing each request's type, the requested product treatment, the production state
  it was raised at, whether a refund is attached, the reason and the requester. RU + TK throughout.

## Tests

- `tests/stage34_1_closure_static.mjs` — 44 source guards (the restore helper is gone, the refund
  route cannot run without an approved closure, the treatment can't be guessed or defaulted, the
  waiter can't finalise, self-approval is impossible, one closure core rather than a second
  Order/Payment/Inventory path, BigInt-only cost maths, nothing physically deleted, RBAC/branch/
  audit, configurable timeouts, RU+TK UI).
- `tests/stage34_1_closure_e2e.mjs` — 125 real HTTP calls, 16 denials, 32 DB post-conditions on a
  fresh database, including the core rule end to end: a paid, produced order is refunded, the money
  comes back, the cash shift moves, and the stock does **not** change while a production loss of the
  real consumed value is recorded.
- Negative control: re-introducing the old restore-on-refund behaviour fails exactly the two
  core-rule assertions (30 and 30b); removing the refund authorisation guard fails static check 13.

### Prior tests that encoded the old semantics

Three suites asserted the behaviour this phase deliberately overrides. They were **migrated, not
weakened** — each now drives the same scenario through the approved-closure flow and asserts the new
rule:

- `stage20_operations_runtime_e2e.mjs` — an arbitrary refund is now refused; the closure flow
  refunds the money and asserts stock stays at 11 (not restored to 15) with a `5.00` production loss.
- `stage32_manager_dashboard_e2e.mjs` — the dashboard's refund figure is produced through the
  cashier-requests / manager-approves path.
- `stage34_food_cost_e2e.mjs` — "refund restores exactly the historical 600g" became "the refund
  restores nothing, and the production loss is valued from the historical v1 consumption
  (600g × 0.025 = 15.00), not from the current v2 recipe".

Two further static assertions were replaced for the same reason (`stage16_1` — "a refund must
restore inventory" became "a refund must never restore inventory on its own, and a RETURN may only
follow an approved pre-production RESTORE_STOCK"), and three were generalized rather than pinned to
the literal end of a list that this phase legitimately extends (`stage13`, `stage18_6`, `stage31`,
`stage34`).

## Known intentional limitations

- **Packaged, unopened goods cannot be restored once the order was paid.** The spec allows
  restoring sealed goods while opened/used products are written off, but the schema has no per-item
  "prepared vs packaged" classification, and inventing one would be fabricated data. Restoration is
  therefore permitted only while the order's production never started. Adding that classification
  is a clean, additive follow-up.
- Auto-cancel is an invoked endpoint, not a scheduler. The system has no background job runner, and
  introducing one was out of scope for this phase.
