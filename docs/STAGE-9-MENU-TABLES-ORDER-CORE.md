# BOOM OS — Stage 9: Menu, Tables & Unified Order Core

Implemented on top of Stage 8 corrected foundation.

## Scope
- Branch-scoped Menu Engine (categories and items)
- Branch-scoped Dining Areas / Tables
- Unified Order Core entry for waiter POS
- DINE_IN / TAKEAWAY order types
- POS source for waiter orders
- Server-side pricing using precise integer cents and PostgreSQL DECIMAL storage
- DINE_IN service charge from `DINE_IN_SERVICE_CHARGE_PERCENT` (default 10)
- Order item snapshots: title, price, quantity, subtotal
- Idempotent order creation with `Idempotency-Key`
- Atomic per-branch order numbering
- Waiter identity derived exclusively from Waiter POS session
- Cashier/manager confirmation transition: `PENDING_CONFIRMATION -> CONFIRMED`
- Branch isolation on every business query
- Audit events for order creation and confirmation
- OpenAPI entries for new endpoints

## Intentionally not implemented yet
- Payments / refunds
- Cash shifts / X / Z
- KDS state machine
- Inventory deduction
- Approval workflow for item removal / voids
- Promotions engine
- CRM / BOOMCARD / BOOMCOIN

Those modules must attach to this Order Core rather than create parallel order storage.

## Verification
- Stage 1 hardening static acceptance: PASSED
- Stage 7 waiter-code static acceptance: PASSED
- Stage 9 menu/tables/order-core static acceptance: PASSED
- TypeScript syntax scan of changed TS/TSX: no TS syntax diagnostics detected
- Full `tsc --noEmit`: NOT VERIFIED because dependency/type packages are unavailable in the runtime environment
- Prisma validation / migration deployment: NOT VERIFIED because Prisma package is unavailable in the runtime environment
- PostgreSQL integration: NOT VERIFIED because no live database was available
- Production Vite build: NOT VERIFIED because Vite/esbuild packages are unavailable in the runtime environment
