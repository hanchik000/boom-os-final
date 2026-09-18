# BOOM OS Stage 13 — Cashier, Payments, Cash Shifts & KDS

## Scope

This stage extends the existing Order Core without replacing it. It adds the financial and kitchen execution slice required after waiter order creation and manager/cashier confirmation.

## Implemented

- Cash shifts: OPEN/CLOSED, opening cash, method totals, expected/actual cash and difference.
- One open cash shift per branch enforced by a PostgreSQL partial unique index.
- X report is read-only and does not close the shift.
- Z report closes the shift atomically and records the difference.
- Payments: CASH/CARD/ONLINE/BONUS/OTHER.
- Payment creation requires an idempotency key and exact remaining order amount.
- CASH/CARD require an open branch cash shift.
- Refunds change payment state to REFUNDED; no deletion is used.
- KDS tickets are created when an order is confirmed.
- KDS state machine: NEW -> PREPARING -> READY -> COMPLETED, with cancellation only before completion.
- KDS status is mirrored to the unified Order Core status.
- All mutations are branch-scoped and audited.
- Finance/KDS reserved endpoints are activated; BOOMCARD, CRM, Inventory and Analytics remain reserved.

## Migration

`20260908000900_cashier_kds_payments`

## Verification

`npm run test:static` passed all existing Stage 1/7/11/12 tests plus Stage 13 static acceptance.

Runtime PostgreSQL, Prisma generation and production build remain environment-dependent and must be verified in the deployment environment before claiming full runtime PASS.
