# Claude Handoff — BOOM OS 34.13

Current checkpoint: **Stage 34.13 functional integration implemented locally.**

## Work completed in this checkpoint

1. Continued from Stage 34.12 without rewriting the project.
2. Fixed an existing JSX syntax defect in `src/components/BoomcardJournalView.tsx`; the manager journal now has valid structured JSX and an explicit empty state.
3. Fixed cash-shift expected-cash reconciliation in `server/routes/payments.ts` so cash sales and card payments preserve `credit_repayments` in the formula:
   `opening_cash + cash_sales + credit_repayments - refunds - voids`
4. Fixed the controlled-closure refund path in `server/order-closure.ts` to reverse all service-charge allocation states for the closed/refunded order: `EARNED`, `POOLED`, and `DISTRIBUTED`.
5. Added `tests/stage34_13_final_integration_static.mjs` with 22 integration invariants.
6. Added `docs/STAGE-34.13-FINAL-FUNCTIONAL-INTEGRATION.md`.
7. Added `test:stage34.13` to `package.json` and included it in `test:static`.
8. Updated the older Stage 34.11 static assertion so it checks the actual manager-permission invariant rather than depending on a brittle array ordering string.

## Static verification completed

- Stage 34.12 static: **15/15 PASS**
- Stage 34.13 integration static: **22/22 PASS**
- Stage 34 static regression batch: **PASS**

## Environment limitation

The uploaded development archive does not contain a complete installable TypeScript/Vite dependency tree. `tsc` currently reports missing `@types/node` and `vite/client`, and the attempted `npm ci` could not complete in the handoff environment. Therefore this checkpoint does **not** claim a production build or PostgreSQL E2E verification.

Do not convert this into a fake PASS. Restore the normal dependency/runtime environment and run the real checks.

## Next action in Claude

First run:

- `npm install` or `npm ci`
- `npm run lint`
- `npx prisma validate`
- `npm run build`
- `npm run test:static`

Then run the relevant PostgreSQL E2E suites, especially 19, 29, 31, 34, 34.1, 34.3, 34.4, 34.5, 34.6, 34.7, 34.8, 34.9, 34.10, 34.11 and any 34.12 runtime test available.

If a real regression appears, fix it in the existing architecture and rerun the affected tests.

Do NOT redo 34.1–34.12.
Do NOT rewrite the project.
Do NOT start 35.x.

After runtime/build verification, report the final HEAD/commit state, tests, verified flows, manual acceptance items and remaining deferred 35.x work.
