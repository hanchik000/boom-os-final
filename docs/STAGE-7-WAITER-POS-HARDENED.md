# BOOM OS — Stage 7 Waiter POS Hardened

## Scope

This stage hardens the dedicated Waiter POS identity layer without inventing an Order Core or Menu Engine that is not yet present in the source project.

## Rules

- Each waiter has one personal POS access code.
- Code management is restricted to OWNER, SUPER_ADMIN, GENERAL_MANAGER and BRANCH_MANAGER.
- Waiters cannot create, replace or revoke codes.
- Codes are bound to the waiter's primary branch and active WAITER role.
- Codes are not stored in plaintext.
- Replacing or revoking a code immediately revokes active waiter POS sessions.
- Branch change, role removal, termination/suspension and account deactivation revoke waiter credentials.
- Waiter POS receives a separate short-lived session token after code authentication.
- The frontend never supplies waiter identity for later POS operations; the server derives it from the waiter session.
- Failed code attempts are rate-limited in addition to the global request limiter.
- Code changes and revocations are audited.
- Historical waiter identity must later be stored on Order Core records by employee/user ID, not by the mutable access code.

## Deliberate boundary

Menu, Tables and Unified Order Core are not faked here. The current Waiter POS visual layer remains a UI shell until those real domain models and APIs are implemented.

## Verification

Static acceptance is provided by `tests/stage7_waiter_codes.mjs`.

Full TypeScript compilation, Prisma validation/deployment and PostgreSQL integration remain environment-dependent and must be marked `NOT VERIFIED` when the required dependencies/database are unavailable.
