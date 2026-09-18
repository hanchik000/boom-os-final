# STAGE 20 — ASYNC ERROR HANDLING & OPERATIONAL RUNTIME VERIFICATION

Constitution reference: §4 (AUDIT → … → VERIFY), §19 (cash shift), §20 (financial
integrity), §23–§26 (inventory, recipes, food cost), §46 (API), §47 (error handling),
§49–§52 (testing and runtime verification), §55 (no false PASS).

Continues from Stage 19, which is accepted as the prior source of truth. No new business
feature was started; no module was rewritten; the stack is unchanged.

## 1. Async request error handling — FIXED and VERIFIED

Stage 19 left a known issue: a rejected promise from an async handler kept the process
alive but left the request hanging with no response.

`server/async-errors.ts` adds `enableAsyncErrorForwarding(router)`, which walks a router's
already-registered layers once and wraps each handler so a rejection becomes `next(err)`.
It recurses into nested routers and skips arity-4 error handlers. `server.ts` applies it to
all 26 API routers in a single statement. No route file was modified, and no dependency
was added.

`tests/stage20_async_error_handling.ts` covers async throw, rejected promise, synchronous
throw, nested router, the success path, and the absence of unhandled rejections. It was
validated as a real regression test: with the patch removed the first case hangs and the
suite fails.

Verified additionally against the running server by stopping PostgreSQL mid-flight: the
request answered with a structured 500 immediately instead of hanging, and the log recorded
no unhandled rejection.

### Two defects this exposed, both fixed

- **Internal detail disclosure (§47).** Making async failures reach the error handler
  widened what it returns, and it echoed `err.message` — an unauthenticated caller received
  the Prisma invocation text and the database host and port. The handler now logs the full
  error with method and path for operators and returns a generic message. The structured
  shape, the `code` and route-supplied `details` are unchanged.
- **Unmapped validation errors in `service-charge.ts`.** `INVALID_TARGET_TYPE`,
  `USER_REQUIRED`, `DEPARTMENT_REQUIRED` and `USER_BRANCH_MISMATCH` were thrown with no
  local catch, so they surfaced as 500 (previously they hung). They now map to 400/403
  using the same idiom every other route already uses.

## 2. Docker deployment — PARTIALLY VERIFIED, container build BLOCKED

`dockerd` runs in this environment, but Docker Hub's blob CDN
(`production.cloudfront.docker.com`) is refused by the egress policy with HTTP 403 on
CONNECT, and no base images are cached. `postgres:15-alpine`, `redis:7-alpine` and
`node:20-alpine` cannot be pulled, so `docker compose up --build` cannot run here.

This is an environment restriction, not a project defect. **The containerised deployment is
therefore NOT VERIFIED by execution.** What was executed instead:

- `docker compose config` renders and validates with only the README-required variables
  (`POSTGRES_PASSWORD`, `JWT_SECRET`), confirming the Stage 19 fix: all four
  `BOOTSTRAP_OWNER_*` variables are passed through and optional.
- The container's `CMD` was run directly against PostgreSQL 16:
  `prisma migrate deploy` followed by `node dist/server.cjs` with `NODE_ENV=production`.
  Stage 19 only ever ran the `tsx` dev server, so **the production bundle had never actually
  been executed**. It boots, connects, seeds the baseline and serves `/api/health`.
- Bootstrap behaviour, executed: with all three variables supplied exactly one OWNER is
  created; a restart with the same configuration logs "Existing OWNER account detected" and
  still yields one OWNER; `POST /api/auth/bootstrap` then returns 409.
- All three runtime E2E suites pass against the production bundle, not just the dev server.

One deployment hazard is worth stating plainly: `docker compose config` shows that a host
which exports `BOOTSTRAP_OWNER_PASSWORD` without the matching email and name produces
exactly the fatal combination the seed rejects. That is the intended all-or-nothing
contract, but operators must supply all three or none.

## 3–9. Operational modules — VERIFIED by execution

`tests/stage20_operations_runtime_e2e.mjs` (45 checks) runs against a live server on an
empty database and reads persisted state back. Covered:

| Area | What was proven |
| --- | --- |
| Refunds | Payment moves to REFUNDED, stock restored (11 → 15), shift refunds total updated, service-charge ledger row marked REVERSED |
| Cash shift lifecycle | OPEN → payment → refund → X-report → Z-report → CLOSED, persisted: opening 500.00, cash_sales 100.10, refunds 100.10, expected 500.00, actual 495.00, difference −5.00; a second Z-report is rejected |
| Inventory | Receiving a purchase (100 units), WASTE write-off (−15), TRANSFER_OUT (−70), low-stock filter returns the item at 15 against a reorder point of 20, movement rows PURCHASE/WASTE/TRANSFER_OUT/SALE/RETURN |
| Recipes / food cost | Recipe created and read back; paying an order consumed ingredients through the recipe (2 burgers × 2 buns = 4) and the refund returned them |
| Service-charge ledger | base 91.00 × 5.00% = 4.55 written for the waiter; a waiter on PROBATION earns nothing until promoted to PROFESSIONAL (§10) |
| KPI | `metric_value` persisted as 100.10 with reward 5.00 and status EARNED; re-evaluating the same period returns the same ledger row and creates no second bonus |
| Decimal serialization | Asserted per field across every endpoint the suite touches |

### Defects found and fixed while running these

- **Creating a purchase was impossible.** `purchase_items` were inserted before the parent
  `purchases` row, so every attempt violated `purchase_items_purchase_id_fkey`. The parent
  is now inserted first and the total applied afterwards with a SQL `SUM`, keeping all money
  arithmetic in PostgreSQL `numeric` — no floating point.
- **Listing orders was impossible.** `GET /api/orders` filtered on unqualified `branch_id`
  and `status` while joining `users` and `dining_tables`, which carry the same column names:
  PostgreSQL rejected it with `42702 column reference "branch_id" is ambiguous`. The filter
  is now qualified with the `orders` alias.
- **Unknown API paths returned the SPA.** In production any unmatched `/api/*` GET fell
  through to the SPA fallback and answered HTTP 200 with HTML. A JSON 404
  (`ENDPOINT_NOT_FOUND`) is now returned before that fallback. `/api/health`, `/api/docs`,
  the reserved 501 modules and the SPA itself are unaffected.

### A false PASS caught in this stage

The first version of the KPI check looped over `evaluated.body.earned` and asserted inside
the loop. The array was empty — the only payment had been refunded, so the waiter's PAID
sales were zero and no bonus was due — and the suite reported PASS while proving nothing.
The KPI section now runs before the refund and asserts `earned.length >= 1` with exact
values. This is the same failure mode Stage 19 documented in the old static suites, so it is
recorded rather than quietly corrected.

## 9. Decimal serialization — VERIFIED

A sweep of 24 JSON endpoints inspected 47 money-bearing fields: no `[object Object]`, no raw
`Decimal {s,e,d}` objects, no money returned as a JSON number. `order_items.quantity` is
returned as a number because it is a genuine integer column, not money.

## 10–11. Full re-verification

| Check | Result |
| --- | --- |
| `tsc --noEmit` | 0 errors |
| `npm run build` | PASS |
| `prisma validate` | valid |
| `prisma migrate deploy` (19 migrations) | applied |
| `prisma migrate diff` | no difference |
| `npm run test:static` (20 suites, incl. the new async test) | PASS |
| `tests/stage18_8_full_runtime.mjs` on a clean DB | PASS |
| `tests/stage19_core_flow_e2e.mjs` on a clean DB | PASS |
| `tests/stage20_operations_runtime_e2e.mjs` on a clean DB | PASS (45 checks) |

All three E2E suites were run against the production bundle, each on a freshly created
database with migrations applied.

## NOT VERIFIED

- **Containerised deployment.** `docker compose up --build` was never executed: base images
  cannot be pulled here (egress policy). Everything verifiable without the images was
  executed and is listed in section 2.
- **Redis.** Reports `DISCONNECTED`; no exercised path depends on it.
- **Frontend UI.** No browser-level verification was done in this stage.
- **Not exercised at runtime:** order item removal/approval flow, print profiles and jobs,
  promotions, smart menu search ranking, offline/sync, franchise and organization
  management beyond listing, X/Z report printing.
- **Multi-branch isolation** was exercised only implicitly through a single branch.

## KNOWN ISSUES

- A request whose handler rejects now receives a structured 500 rather than hanging, but the
  status is always 500 for anything reaching the global handler. Routes that attach
  `httpStatus` to thrown errors still rely on their own local catch to produce 4xx; the
  global handler deliberately ignores `httpStatus` so existing semantics are unchanged.
  Making it honour `httpStatus` is a candidate follow-up, not done here to avoid changing
  response codes without a decision.
- Money serializes as its exact value (`45.5`, not `45.50`). Correct and lossless; display
  formatting belongs to the clients, and the same path serves 4-decimal quantity columns.
- Low stock is a query filter (`?low_stock=true`). The notification path to a manager
  described in Constitution §24 is not implemented.
- BOOMCARD, BOOMCOIN, CRM and promotions remain unimplemented; `/api/boomcard`, `/api/crm`
  and `/api/analytics` answer 501 by design. No parallel systems were introduced.
