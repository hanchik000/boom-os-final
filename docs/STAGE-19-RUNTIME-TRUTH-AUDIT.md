# STAGE 19 — RUNTIME TRUTH AUDIT & CORE FLOW REPAIR

Constitution reference: §2 (source of truth), §4 (AUDIT → … → VERIFY), §20 (financial
integrity), §45 (migration rule), §50 (critical E2E), §52 (runtime verification),
§55 (no false PASS).

## Why this stage exists

The Stage 18.8 baseline reported PASS from static suites only. Those suites match strings
in source files; they never executed the server against PostgreSQL. Running the system for
real showed that the documented deployment path could not boot and that the core order and
payment flow could not complete a single transaction.

The lesson is recorded here deliberately: a static assertion is not a runtime verification.
One of the shipped checks asserted `metric_value:valueText` and passed, while the adjacent
SQL insert actually bound an undefined `value` identifier.

## Verified environment

PostgreSQL 16.13, all 19 migrations applied with `prisma migrate deploy`, server started
with `npm run dev`, checks executed over HTTP against the running API.

## Defects found and fixed

### Blocking — the system could not run

1. **`docker compose up` could never boot.** `docker-compose.yml` required
   `BOOTSTRAP_OWNER_PASSWORD` and passed it to the API, but never passed
   `BOOTSTRAP_OWNER_EMAIL`/`NAME`. `server/seed.ts` treats bootstrap configuration as
   all-or-nothing and throws a fatal configuration error, so the container always exited.
   All four variables are now passed through and optional, matching `.env.example`
   and the "starts empty by design" intent.
2. **Both runtime harnesses could never pass.** `stage18_7_runtime.sh` and
   `stage18_8_full_runtime.sh` exported a bootstrap password without the other required
   fields. 18.7 now supplies the full triple; 18.8 keeps the API empty because its own
   suite asserts that `/api/auth/bootstrap` returns 201.
3. **`/api/auth/bootstrap` crashed the entire process.** `pg_advisory_xact_lock()` returns
   SQL type `void`, which the raw-query deserializer cannot decode. The advisory lock is
   now taken with `execute()` instead of `queryOne()`.
4. **`INSERT INTO orders` was malformed** — 18 columns against 17 values (16 placeholders
   for 17 parameters). Order creation could never succeed. The missing placeholder was added.

### Financial and data integrity

5. **Money and quantities could not be written at all.** BOOM OS carries money as exact
   decimal strings (§20, correctly never `Float`), but raw parameters reach PostgreSQL typed
   as `text`, so every write to a `numeric` column failed with `42804`, and every
   `column = column + ?` failed with `42883` (`operator does not exist: numeric + text`).
   46 bind sites across menu, orders, payments, inventory, cash shifts, KPI, recipes and
   service charge now cast explicitly with `CAST(? AS numeric)`.
6. **Money serialized to clients as `[object Object]`.** `sanitizeBigInt` rebuilt result
   rows field by field, which destroyed the `Decimal` instances returned by raw queries.
   The customer menu returned `"price":"[object Object]"` for a dish stored as `45.50`.
   `Decimal` values are now rendered as exact decimal strings, and `Date` values preserved.
7. **`expected_cash` lagged one transaction behind.** Every SQL `SET` expression reads the
   pre-update row, so recomputing `expected_cash` from `cash_sales` in the same statement
   that incremented `cash_sales` stored a stale figure. The Z-report reads that stored
   column, so a cashier would have been reported short or over by the amount of the last
   payment. Both the sale and refund paths now apply the delta explicitly.
8. **KPI bonuses wrote an undefined value.** `kpi_ledger.metric_value` was bound to an
   undeclared `value` identifier instead of `valueText`, raising a `ReferenceError` inside
   the KPI evaluation transaction. Corrected to `valueText`.

### Schema and types

9. **Schema drift.** `prisma migrate diff` reported four indexes, three column defaults and
   13 constraint names present in the migrations but absent from `schema.prisma`. A future
   `prisma migrate dev` would have generated a migration dropping them. `schema.prisma` now
   declares what the migrations actually create; `migrate diff` reports no difference.
10. **13 TypeScript errors** in `kpi.ts`, `orders.ts` and `payments.ts`. The transaction
    surface is now exported as `TxClient` from `server/db.ts` and used by the route helpers
    that previously took `tx: any`.

### Reliability

11. **One failed request took the whole system down.** Express 4 does not forward a rejected
    promise from an async handler to the error middleware, so any unexpected async failure
    terminated the process and every branch lost its POS. An `unhandledRejection` guard now
    keeps BOOM OS serving and logs the failure. This is a safety net, not a substitute for
    the proper fix — see Known issues.

### Packaging

12. `.gitignore` excluded `.env.docker.example` via `.env*`, so a template the project ships
    would never reach the repository. Added the negation.

## Verification

| Check | Result |
| --- | --- |
| `tsc --noEmit` | 0 errors |
| `npm run build` (Vite + esbuild) | PASS |
| `prisma validate` | valid |
| `prisma migrate deploy` (19 migrations, PostgreSQL 16) | applied |
| `prisma migrate diff` (migrations vs datamodel) | no difference |
| `npm run test:static` (19 suites) | PASS |
| `tests/stage18_8_full_runtime.mjs` against live server | PASS |
| `tests/stage19_core_flow_e2e.mjs` against live server | PASS |

`tests/stage19_core_flow_e2e.mjs` is new and covers the flow the Constitution requires:
WAITER → CREATE ORDER → KDS → READY → CASHIER → PAYMENT → CLOSED, asserting order totals
(2 × 45.50 = 91.00 subtotal, 9.10 service charge, 100.10 final), idempotent replay of both
order and payment, KDS transitions, order closure, table release and cash reconciliation
(`expected_cash` = 600.10 on a 500.00 float plus a 100.10 cash sale).

It requires an empty database because it bootstraps the first OWNER itself.

## Status after Stage 20

Superseded items are marked below. See `docs/STAGE-20-RUNTIME-HARDENING.md` for the
follow-up stage, which fixed async error handling, executed the production bundle, and
runtime-verified refunds, cash shifts, inventory, recipes, the service-charge ledger and KPI.

## Known issues / NOT VERIFIED

- **Async error handling.** RESOLVED in Stage 20 via `server/async-errors.ts`; the note
  below describes the Stage 19 state. The `unhandledRejection` guard keeps the process
  alive, but a request whose handler rejects still receives no response and hangs until the
  client times out. The proper fix is an async wrapper around route handlers (or Express 5)
  so failures reach the existing global error handler as a structured 500. Not done here
  because it changes error semantics across all 25 routers.
- **Decimal string formatting.** Money now serializes as its exact value (`45.5`, not
  `45.50`). This is correct and lossless, and deliberately not forced to two decimals
  because the same code path serves 4-decimal quantity columns. Display formatting belongs
  in the clients.
- **Docker path not executed.** The compose fix was verified by reading the seed contract
  and reproducing the exact failure locally; `docker compose up` itself was not run in this
  environment. NOT VERIFIED by execution. Stage 20 confirmed the container images cannot be
  pulled here at all (egress policy), executed the container's `CMD` directly instead, and
  validated the rendered compose environment.
- **Redis** reports `DISCONNECTED` in local runs; it is not required by the flows exercised.
- **Not exercised at runtime:** refunds, Z-report closure, inventory consumption and
  purchases, recipes/food cost, service-charge ledger distribution, KPI evaluation,
  promotions, CRM/BOOMCARD/BOOMCOIN, offline/sync, and the frontend UI. Their numeric
  binds were corrected by the same sweep, but only the paths listed in the table above
  were proven by execution. Stage 20 has since runtime-verified refunds, the cash shift
  lifecycle and Z-report, inventory, recipes, the service-charge ledger and KPI; the rest
  remain unverified.
- BOOMCARD, BOOMCOIN, CRM, promotions and delivery remain unimplemented in this baseline
  (Constitution stages 11–13); no parallel systems were introduced.
