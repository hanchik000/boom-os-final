# BOOM OS Stage 10 — Audit Corrections & Order Concurrency Hardening

Date: 2026-09-08

## Purpose

Re-audit Stage 9 against the external AI Studio report without replacing the existing architecture.

## Confirmed findings

- `package-lock.json` exists at repository root with lockfileVersion 3.
- `package.json` contains `@prisma/client` and `prisma`.
- `prisma/schema.prisma` exists.
- `prisma/migrations/` contains the Stage 1–9 migrations.
- `server.ts` starts Express, registers `/api/*` routes, and runs Vite middleware/static serving.
- `tests/` exists and includes Stage 1, 2, 4, 7 and 8 acceptance tests.
- Waiter authentication is server-side with HMAC-hashed waiter codes and dedicated Waiter POS sessions.
- Waiter order identity and branch are derived from the waiter POS session; the order endpoint does not accept waiter_user_id or branch_id as trusted identity fields.
- Order money calculations use integer cents (`bigint`) in application logic and PostgreSQL `DECIMAL(12,2)` for persisted amounts.
- Order idempotency is backed by a `(branch_id, idempotency_key)` unique constraint.
- Order item snapshots contain the required title, price, quantity and subtotal fields.

## Corrections implemented in Stage 10

1. **Concurrent table access**: selected dining-table rows are locked with `SELECT ... FOR UPDATE` inside the same database transaction that creates the order. This prevents concurrent waiters from racing on the table state.
2. **Idempotency enforcement**: waiter order creation now requires `Idempotency-Key`; duplicate submissions are replayed from the existing branch-scoped order.
3. **Money rounding**: service charge calculation rounds to the nearest cent using integer arithmetic rather than truncating fractional cents.
4. **Branch currency**: order currency is read from the active branch record instead of being hard-coded to TMT in the order transaction.
5. **Static regression checks**: acceptance tests now assert the concurrency lock, idempotency requirement, exact-cent rounding and branch-currency lookup.

## Verification status

- Static Stage 1 hardening test: PASSED.
- Static waiter-code acceptance: PASSED.
- Static Menu/Tables/Order Core acceptance: PASSED.
- TypeScript/TSX syntax transpilation: PASSED (53 files, zero syntax diagnostics).
- `npm ci`: NOT VERIFIED in this environment because registry access timed out; offline install fails when a package is absent from npm cache. The repository does contain a valid root `package-lock.json`.
- Full `tsc --noEmit`: NOT VERIFIED in this environment because dependencies are not installed.
- Vite/esbuild production build: NOT VERIFIED in this environment because local dependencies are not installed and global esbuild is unavailable.
- Prisma validate/generate/migrate deploy: NOT VERIFIED because Prisma CLI and PostgreSQL are not installed/running in this environment.
- Live HTTP/API integration: NOT VERIFIED because the required dependency tree and PostgreSQL runtime are unavailable.

## Important interpretation of the AI Studio report

The external report describes a different/older client-only project state. Its claims that Prisma, migrations, backend, tests, RBAC server enforcement, waiter sessions and server-side order handling are absent are contradicted by this Stage 9/10 repository. Those claims are therefore classified as **FALSE POSITIVE for this archive**.

Its runtime-verification concerns remain valid as a reason to perform a real CI/DB environment verification before production acceptance.
