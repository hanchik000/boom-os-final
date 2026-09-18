# BOOM OS — Corrective Audit / 2026-09-08

## Source-of-truth rule

This corrective package preserves the Stage 6 BOOM OS project structure and applies only the corrections required for the Waiter POS layer and previously identified foundation issues. It does not create a parallel `boom-next` application and does not delete the original project modules.

## Corrected issues

1. **Waiter POS was previously only a UI shell.** It remains a UI shell by design until Menu Engine / Tables / Order Core are implemented; it no longer falsely presents local data as a server-backed order flow.
2. **Waiter code had no dedicated session.** Added `waiter_pos_sessions` with hashed session tokens, expiry, idle timeout and device ID.
3. **Waiter identity could have been treated as mutable code.** The session resolves to the immutable user/employee identity. Future Order Core must store employee/user ID, never the access code.
4. **Code replacement did not revoke active sessions.** Replacement/revocation now invalidates active waiter POS sessions.
5. **Only permission was checked for code management.** Management endpoints now require the permission plus an explicit management role: OWNER, SUPER_ADMIN, GENERAL_MANAGER or BRANCH_MANAGER.
6. **Credential lifecycle was incomplete.** Branch changes, status deactivation/suspension/termination, waiter-role removal and user termination revoke waiter codes/sessions.
7. **Branch binding was insufficiently strict.** Waiter authentication requires the employee primary branch to equal the code branch.
8. **Brute-force protection was weak for a four-digit credential.** Added a specific in-process attempt budget in addition to the global API limiter. Multi-node production deployment should move this counter to Redis.
9. **Frontend had no separate waiter-session storage.** Added a dedicated browser storage key and `X-Waiter-Session` request path.
10. **Stage 7 archive was nested under `boom-next`.** The corrected package uses the existing project root and preserves Stage 6 files.
11. **Two i18n components referenced `t` without destructuring it.** Fixed `AcceptanceTestModal` and `LoginModal`.
12. **OpenAPI was left inconsistent during the previous edit.** Restored the Stage 6 OpenAPI file and added valid Waiter POS paths/schemas.
13. **Legacy seed defaults were Russian/RUB-oriented.** Fresh-install seed branch/default settings now use Turkmenistan/TMT/Aşgabat defaults.

## Verification performed

- Stage 1 hardening static acceptance: **PASSED**
- Stage 7 Waiter POS static acceptance: **PASSED**
- package.json JSON validation: **PASSED**
- TypeScript/TSX syntax transpile parse: **PASSED — 50 files**
- Migration files present and non-empty: **PASSED**

## Verification not possible in this environment

- Full `tsc --noEmit`: **NOT VERIFIED** — project dependencies are incomplete in the provided runtime and network package installation timed out.
- Vite production build: **NOT VERIFIED** for the same dependency reason.
- Prisma schema validation / client generation: **NOT VERIFIED** because the Prisma CLI/client package is not available in the runtime.
- Prisma migration deployment: **NOT VERIFIED** — no PostgreSQL client/server is available in the runtime.
- Live API integration, RBAC integration, branch-isolation integration and browser E2E: **NOT VERIFIED**.

## Current functional boundary

The foundation and Waiter POS identity layer are corrected. The following restaurant domains are still not implemented in this package and therefore must not be represented as completed:

- Menu Engine
- Dining Areas / Tables API
- Unified Order Core
- Pricing Engine
- Cashier POS
- Payments / Receipts
- Cash Shifts / X / Z
- KDS
- Inventory / Recipes / Suppliers
- CRM / BOOMCARD / BOOMCOIN
- Promotions
- Customer Menu / Online Orders
- Delivery / Takeaway workflows
- Offline POS / Sync
- Operational analytics
- Customer feedback workflow

The next implementation stage must build these domains against the existing foundation rather than creating duplicate systems.
