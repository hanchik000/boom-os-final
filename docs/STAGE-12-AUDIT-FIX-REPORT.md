# BOOM OS Stage 12 — Audit & Hardening Report

Date: 2026-09-08

## Scope

Audit and targeted hardening of the existing Stage 12 source. No new project or replacement architecture was created.

## Findings fixed

1. Removed fictional quick-login identities from the production login UI.
2. Removed fictional OpenAPI example identities/names and replaced them with neutral examples.
3. Dashboard foundation metrics now default to `0` rather than invented numbers when API data is empty; recent activity shows an explicit empty state.
4. Dashboard no longer hardcodes an unconditional "ALL SYSTEMS HEALTHY" state; it reflects the database connection state returned by the server.
5. Added franchise counts to `/api/system/stats` so the dashboard receives real franchise totals.
6. Added first-run owner bootstrap API:
   - `GET /api/auth/bootstrap-status`
   - `POST /api/auth/bootstrap`
   - only available while no OWNER/SUPER_ADMIN exists;
   - owner password minimum 12 characters;
   - password is bcrypt-hashed;
   - user, employee profile and OWNER role are created atomically;
   - bootstrap is audited.
7. Strengthened user provisioning password minimum to 8 characters.
8. Hardened role assignment against privilege escalation: non-superusers cannot assign a role that grants permissions they do not themselves possess. Both role IDs and role codes are resolved server-side.
9. Hardened user updates with server-side branch existence and branch-scope validation.
10. Added a dedicated static acceptance test for the Stage 12 runtime/security contract.
11. Added `package-lock.json` to the distributable baseline and synchronized the package name to `boom-os`.

## Existing protections retained

- PostgreSQL + Prisma schema and migrations remain the source of truth.
- Waiter access codes remain hashed and branch-bound.
- Waiter POS sessions remain server-issued and revocable.
- Waiter order creation derives waiter and branch from the server-side waiter session.
- Order creation uses transactional table locking, exact-cent integer arithmetic before DECIMAL persistence, snapshots, and Idempotency-Key.
- Legacy SQLite/JSON business-data files and legacy importer are not present in the distributable baseline.
- `server/seed.ts` creates only RBAC/system infrastructure plus an optional explicitly configured bootstrap owner; it does not create demo branches, franchises, employees, menu, tables, orders or sales.

## Verification performed

### Passed

- `node tests/stage1_hardening.mjs`
- `node tests/stage7_waiter_codes.mjs`
- `node tests/stage8_order_core_static.mjs`
- `node tests/stage11_empty_baseline_static.mjs`
- `node tests/stage12_clean_source_static.mjs`
- `node tests/stage12_clean_runtime_contract_static.mjs`
- TypeScript/TSX transpile-level syntax parsing: 52 files, no syntax diagnostics.

### Not verified in this environment

- `npm ci` / full dependency installation: network/dependency installation timed out in the execution environment.
- `npm run lint`: cannot complete because the installed runtime lacks the project's dependency/type tree.
- `npm run build`: cannot be completed after dependency installation failure because Vite/esbuild are unavailable in the current runtime.
- `npx prisma validate`: cannot be completed because the Prisma CLI/client are not installed in the current runtime.
- Live PostgreSQL migration and HTTP integration tests: no configured `DATABASE_URL` / PostgreSQL instance is available.

These are environment limitations and are intentionally reported as NOT VERIFIED rather than PASS.
