# Stage 2 — Waiter POS Design

## Scope implemented
- Dedicated Waiter POS visual shell at `/?screen=waiter`.
- Idle state with animated BOOM mark and tap-to-start behavior.
- Personal waiter code entry screen (UI only in this stage; no fake backend authentication).
- Waiter identity display (`WA-0042`) as a visual placeholder for the future EmployeeProfile binding.
- DINE_IN table selection, categories, menu cards, cart quantities and send-order interaction.
- Order Core pricing boundary is visually represented: subtotal is local UI; service charge/final pricing are explicitly marked as server-calculated.
- Responsive layout for tablet/desktop waiter devices.

## Not yet claimed as production functionality
- Waiter code verification is not connected to the server yet.
- Menu, tables and orders are not persisted yet.
- No payment, KDS, inventory deduction or real branch isolation is introduced by this UI shell.
- No production waiter statistics are calculated here.

## Next implementation stage
Build the backend domain models and APIs for Menu Engine + DiningArea/Table + Order Core, then replace the UI placeholders with authenticated branch-scoped data.

## Waiter identity & access-code governance

- Every active `WAITER` employee may have one active 4-digit Waiter POS code.
- The code is stored only as an HMAC-SHA256 digest keyed by `JWT_SECRET`; plaintext is returned only once when management creates/replaces it.
- Code management requires `waiter_codes.manage` and is branch-scoped. Seeded authority: OWNER, SUPER_ADMIN, GENERAL_MANAGER and BRANCH_MANAGER. The WAITER role does not receive management permission.
- Replacing a code immediately invalidates the previous code. Revocation is a soft state (`REVOKED`) so audit/history remains intact.
- Moving a waiter to another primary branch automatically revokes the branch-bound code; management must issue a new code.
- Code creation/replacement/revocation and branch-change revocation are written to AuditLog.
- `/api/waiters/authenticate-code` is intentionally unauthenticated so a dedicated Waiter POS device can sign in using its personal code; the application-level rate limiter remains active.
- No order or sales statistics are duplicated in the waiter credential table. Future Order Core records will reference the employee identity.
