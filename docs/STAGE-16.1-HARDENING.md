# BOOM OS Stage 16.1 — Hardening

Stage 16 was re-audited against the physical source tree. This patch fixes functional and integrity defects without replacing the existing architecture.

## Fixed

- Modifier groups are loaded independently of selected modifiers; required groups cannot be bypassed by sending no modifier.
- `required=true` requires `min_select >= 1`.
- Menu item and modifier prices reject negative values.
- Waiter POS now loads modifier groups/options and sends `modifier_ids` into Order Core.
- Menu Engine now uses a category selector, exposes required-group configuration, and correctly targets a modifier group when adding a modifier.
- Order item removal approval remains available through `PREPARING`/`READY` while payment has not completed.
- KDS `COMPLETED` no longer marks an unpaid order financially completed; the order remains `READY` until payment.
- Payments require a `READY` order and a `READY`/`COMPLETED` KDS ticket, preventing payment from bypassing cashier confirmation and kitchen readiness.
- Successful payment releases the dining table only when no other active order remains on that table.
- Refunds restore inventory through immutable `RETURN` stock movements and only cash refunds affect expected cash.
- Cash shift single-open-per-branch database constraint from the existing Stage 13 migration is retained and verified.
- Cashier/KDS/shift/payment UI is now reachable from the admin application.
- Operational and modifier endpoints are documented in OpenAPI.
- Redis is treated as optional infrastructure because the current application does not require a Redis client for core operation; PostgreSQL remains the system of record.
- The unused `inventory` future-module reservation was removed because the inventory router is active.

## Verification

- All existing static acceptance suites pass.
- Stage 16.1 hardening static acceptance: 17/17 checks passed.
- 60 TypeScript/TSX files parsed with the globally available TypeScript transpiler: 0 syntax diagnostics.
- Local relative-import sanity check: PASS.
- Package name and lockfile name: `boom-os` / `boom-os`.
- The project archive must still be runtime-verified with installed dependencies and PostgreSQL before claiming production readiness.
