// BOOM OS -- Stage 35.7: Cashier POS Design (visual/UX only).
//
// This stage restyles CashierPOSView.tsx -- header, orders rail, order detail, totals, payment
// action area, payment dialog, success screen -- into the black/graphite/white/metallic-gold
// design language, reusing the existing design system tokens (tokens.css) and the same
// presentation-only-CSS-file pattern Stage 35.1 established for Waiter POS.
//
// The one rule this whole stage exists to prove: every business fact still comes from the same
// server calls, in the same order, with the same conditions -- only how it is painted changed.
import fs from 'node:fs';
const read = p => fs.readFileSync(p, 'utf8');
const view = read('src/components/CashierPOSView.tsx');
const css = read('src/design-system/cashier-pos.css');
const main = read('src/main.tsx');
const tokens = read('src/design-system/tokens.css');

const checks = [
  // -- 1. Cashier POS still loads
  ['CashierPOSView still exports the same component', view.includes('export const CashierPOSView: React.FC')],
  ['the new stylesheet is registered globally, same pattern as waiter-pos.css', main.includes("import './design-system/cashier-pos.css'")],
  ['cashier-pos.css declares itself presentation-only, no business rule', css.includes('Presentation only') && css.includes('no business rule')],

  // -- 2. Existing API calls unchanged (same call sites, same names, same argument shape)
  ['unlock still calls the same operator-pos endpoint with the same fields', view.includes('api.unlockOperatorPos({ password: unlockPassword, branch_id: branchId, device_id:')],
  ['orders/payments are still fetched from the same endpoints', view.includes('api.getOrders({ branch_id: branchId })') && view.includes('api.getPayments({ branch_id: branchId })')],

  // -- 3. Payment flow unchanged: same idempotency-key shape, same payload, same endpoint
  ['pay() still builds the bill/no-bill idempotency key the same way', view.includes('cashier-pay-bill-${payingBill.id}') && view.includes('cashier-pay-${detail.id}')],
  ['pay() still sends order_id/method/amount/credit_account_id to createPayment unchanged', view.includes('api.createPayment({ order_id: detail.id,') && view.includes("credit_account_id: creditAccount.account.id")],
  ['the due amount still comes from the order/bill final_amount the server computed, never a UI value', view.includes('const dueAmount = String(payingBill ? payingBill.final_amount : detail.final_amount)')],
  ['BOOMBACK partial-amount override still reads the cashier textbox, same as before', view.includes("payMethod === 'BOOMBACK' && boombackAmount.trim() ? boombackAmount.trim() : dueAmount")],

  // -- 4. Credit flow unchanged
  ['credit account creation/lookup calls are untouched', view.includes('api.createCreditAccount({ branch_id: branchId, type:') && view.includes('api.getCreditAccount(')],
  ['credit limit / balance still rendered from the account the server returned, never computed locally', view.includes('creditAccount.account.credit_limit') && view.includes('creditAccount.available_credit')],

  // -- 5. BOOMBACK unchanged
  ['BOOMBACK balance is still fetched from the server, not derived', view.includes('api.getBoombackBalance(detail.customer_id)')],

  // -- 6. No breakfast logic invented here (that flow lives in BOOMCARD, not Cashier POS)
  ['Cashier POS still does not implement a breakfast redemption path of its own', !/breakfast/i.test(view)],

  // -- 7. Customer / manual discount flow unchanged
  ['customer search/attach calls are untouched', view.includes('api.getCustomers({ branch_id: branchId, search:') && view.includes('api.setOrderCustomer(detail.id,')],
  ['discount apply/remove calls are untouched, percent still comes from the input, never computed here', view.includes('api.applyOrderDiscount(detail.id, { percent: percent.trim(), reason:') && view.includes('api.removeOrderDiscount(detail.id)')],

  // -- 8. Closure (ЗАКРЫТО ЗАВЕДЕНИЕМ) unchanged -- cashier only requests, manager decides
  ['closure request still goes through the same endpoint with the same required fields', view.includes("type: 'CLOSED_BY_ESTABLISHMENT', reason: closureReason.trim(), comment: closureComment.trim() || null, inventory_treatment: closureTreatment, refund_requested: closureRefund")],

  // -- 9. Receipt / print / reprint unchanged
  ['print job creation is unchanged', view.includes("api.createPrintJob({ branch_id: branchId, order_id: receiptOrder.id, print_type: 'CUSTOMER_RECEIPT' })")],
  ['reprint still requires print.reprint and calls the same reprint endpoint', view.includes("hasPermission('print.reprint')") && view.includes('api.reprintJob(lastPrintJob.id)')],

  // -- 10. POS lock/unlock unchanged
  ['lock still calls the same endpoint and clears the same local keys', view.includes('api.lockOperatorPos(branchId)') && view.includes("localStorage.removeItem(POS_TOKEN_KEY)")],

  // -- 11. No POS media wired into Cashier POS in this pass (documented limitation, not silently done)
  ['no POS media fetch was added to Cashier POS -- there is no cashier-accessible read endpoint for it yet', !view.includes('getCurrentWaiterPosMedia') && !view.includes('pos-media-stage')],

  // -- 12. Reduced motion supported, and financial numbers are never animated
  ['cashier-pos.css disables its own transitions under prefers-reduced-motion', css.includes('@media (prefers-reduced-motion:reduce)')],
  ['the grand total / payment amount classes carry no transition or animation rule', !/\.od-total-row\.grand[^}]*transition/.test(css) && !/\.pay-modal-grand[^}]*transition/.test(css) && !/\.pay-cta-amount[^}]*transition/.test(css)],
  ['the design system already neutralizes motion tokens under reduced-motion, reused here', tokens.includes('prefers-reduced-motion: reduce')],

  // -- 13/14. No financial logic moved into the UI, no duplicate business logic
  ['money() still only formats a server-given value -- toFixed, never a computed expression', /function money\(v: any\) \{\s*const n = Number\(v \?\? 0\);\s*return Number\.isFinite\(n\) \? n\.toFixed\(2\) : String\(v \?\? '0\.00'\);\s*\}/.test(view)],
  ['totals block still renders detail.subtotal/discount/service_charge/final_amount directly -- no local arithmetic on them', view.includes('money(detail.subtotal)') && view.includes('money(detail.final_amount)') && !/detail\.subtotal\s*[+\-*/]/.test(view) && !/detail\.final_amount\s*[+\-*/]/.test(view)],
  ['payBlockedReason is still the single, unchanged gate deciding whether payment is allowed', view.includes('function payBlockedReason(o: any): string | null')],

  ['stage doc exists', fs.existsSync('docs/STAGE-35.7-CASHIER-POS-DESIGN.md')],

  // -- Regression guard for the real app-mounting bug found while verifying this stage in a
  // browser: useLanguage() must be called INSIDE the component, never at module scope (a
  // Rules-of-Hooks violation that crashed the entire app on load, not just Cashier POS).
  ['AcceptanceTestModal no longer calls a hook at module scope', (() => {
    const atm = read('src/components/AcceptanceTestModal.tsx');
    const beforeComponent = atm.slice(0, atm.indexOf('export const AcceptanceTestModal'));
    return !/const \{ t \} = useLanguage\(\);/.test(beforeComponent) && /const \{ t \} = useLanguage\(\);/.test(atm.slice(atm.indexOf('export const AcceptanceTestModal')));
  })()],
];

let ok = 0;
for (const [name, v] of checks) { console.log(`${v ? 'PASS' : 'FAIL'} ${name}`); if (v) ok++; }
console.log(`${ok}/${checks.length} PASS`);
if (ok !== checks.length) process.exit(1);
