# Stage 18.4 — Runtime Hardening Foundation

## Changes

1. Operator POS session enforcement now resolves the authoritative branch from the protected order/payment before validating the session. A caller cannot select a different `branch_id` to reuse a session from another branch.
2. Active operator POS sessions are protected by a PostgreSQL partial unique index per `(user_id, branch_id)`.
3. Active POS lookup has a supporting index on `(user_id, branch_id, status, expires_at)`.
4. Existing KPI attribution remains explicit: waiter sales use `orders.waiter_user_id`; cashier/operator sales use `payments.cashier_user_id`.
5. Static acceptance was extended with Stage 18.4 checks.

## Verification

- `npm install --package-lock-only --ignore-scripts --no-audit --no-fund` — PASS; lockfile is synchronized with package.json.
- `npm ci --dry-run --ignore-scripts --no-audit --no-fund` — PASS; dependency graph is accepted by npm without the previous lockfile-sync error.
- `node tests/stage18_4_runtime_hardening_static.mjs` — PASS (12/12).
- `npm run test:static` — PASS through Stage 18.4.

## Runtime status

Live PostgreSQL/API behavior is not claimed as verified in this stage. The next runtime environment must apply the new migration and execute concurrent unlock, cross-branch session, expiry, lock, payment and refund scenarios.
