# Stage 34.13 — Final Functional Integration

Status: **IMPLEMENTED / STATICALLY VERIFIED**

Stage 34.13 is the final functional integration checkpoint before the 35.x design roadmap. It does not redesign the UI and does not introduce a second business-logic layer.

## Integration invariants

- **Order Core** remains the single order source of truth.
- Waiter POS creates orders through the existing waiter-session flow; branch and waiter identity are server-derived.
- KDS gates payment readiness.
- Payment performs inventory consumption and records historical recipe/cost snapshots at the consumption point.
- Refund is not an inventory operation. A money refund requires an approved controlled closure.
- Prepared food is not returned to stock. `RESTORE_STOCK` is only legal before production starts; otherwise the approved closure decides `WRITE_OFF` / `NO_WRITE_OFF`.
- Split bills remain children of one Order Core order; analytics uses the order once.
- Credit repayment changes receivables/cash-shift reconciliation but is not a sale and does not create an order payment.
- Analytics defines sold revenue as `Order.status = COMPLETED` and uses historical `recipe_cost_snapshot` rather than today's recipe or average inventory cost.
- BOOMCARD/BOOMCOIN/BOOMBACK history is sourced from the existing ledgers/events; the unified journal is read-only.
- Branch and franchise access remains server-enforced.
- Financial amounts remain integer/Decimal based; no Float is introduced into the payment path.

## Real integration defect fixed during 34.13

Cash-shift `expected_cash` calculations in the payment/refund paths did not include `credit_repayments`. This could make a shift's expected drawer value temporarily wrong after a credit repayment followed by a cash sale or refund, even though the Z-report already included repayments.

The payment/refund formulas were corrected to consistently use:

`opening_cash + cash_sales + credit_repayments - refunds - voids`

The controlled-closure refund path now also marks all service-charge allocation states for the order (`EARNED`, `POOLED`, `DISTRIBUTED`) as `REVERSED`, preserving history while preventing a refunded order's service charge from remaining operationally active.

## Verification

Static integration test:

- `tests/stage34_13_final_integration_static.mjs`
- 22/22 checks passed in the development environment.

Stage 34.12 static test also passes after repairing the existing JSX syntax defect in `BoomcardJournalView.tsx`.

The uploaded handoff environment does not contain a complete installable TypeScript/Vite dependency tree, so `tsc`/Vite build and PostgreSQL E2E cannot be claimed from this environment. Claude should rerun those checks after restoring the normal dependency/runtime environment.

## Manual acceptance still required

1. Run the full PostgreSQL regression battery.
2. Exercise one real waiter → KDS → payment → inventory → receipt → analytics flow.
3. Exercise one split-bill order with multiple payments and verify one analytics order.
4. Exercise one credit sale and repayment and reconcile the cash shift.
5. Exercise controlled establishment closure after production and verify waste/production-loss treatment.
6. Exercise BOOMCARD breakfast/BOOMBACK/BOOMCOIN operations and inspect the unified journal.
7. Verify branch-isolation denial with a real multi-branch dataset.
8. Verify browser production build and the manager journal screen on a real device.

## 35.x boundary

Do not start 35.x from this checkpoint. The next roadmap begins with the BOOM OS Design System and then the premium visual/catalog/media experience, including the manager-controlled Visual Catalog, banners, promotion presentation, seasonal themes, online/QR/offline visual layers, and POS media.
