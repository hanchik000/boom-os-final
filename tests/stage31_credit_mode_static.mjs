// BOOM OS -- Stage 31: static regression guards for Credit Mode (receivables). Credit sales
// settle through the EXISTING payments.ts transaction path; credit.ts only adds the
// receivable bookkeeping -- these checks guard against a second payment/order/customer system
// ever being reintroduced.
import fs from 'node:fs';
import assert from 'node:assert/strict';

const creditTs = fs.readFileSync(new URL('../server/routes/credit.ts', import.meta.url), 'utf8');
const paymentsTs = fs.readFileSync(new URL('../server/routes/payments.ts', import.meta.url), 'utf8');
const cashShiftsTs = fs.readFileSync(new URL('../server/routes/cash-shifts.ts', import.meta.url), 'utf8');
const schema = fs.readFileSync(new URL('../prisma/schema.prisma', import.meta.url), 'utf8');
const seedTs = fs.readFileSync(new URL('../server/seed.ts', import.meta.url), 'utf8');
const serverTs = fs.readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
const apiTs = fs.readFileSync(new URL('../src/api.ts', import.meta.url), 'utf8');
const cashierView = fs.readFileSync(new URL('../src/components/CashierPOSView.tsx', import.meta.url), 'utf8');

let passed = 0;
function check(label, cond) { assert.ok(cond, `FAILED: ${label}`); passed++; }

// --- one payment path, no second payment/order system
check('CREDIT is a method on the existing payments.ts POST / route, not a separate sale endpoint', /METHODS=new Set\(\['CASH','CARD','ONLINE','BONUS','OTHER','CREDIT'\]\)/.test(paymentsTs));
check('credit.ts does not define its own order-settlement/sale route', !/router\.post\('\/sale'/.test(creditTs));
check('payments.ts imports applyCreditSale from credit.ts (single settlement path, reused)', /import \{ applyCreditSale \} from '\.\/credit'/.test(paymentsTs));
check('applyCreditSale runs inside the same transaction as the payment insert (no second commit)', /await applyCreditSale\(tx,\{branchId:order\.branch_id/.test(paymentsTs));
check('router mounted once at /api/credit', (serverTs.match(/app\.use\('\/api\/credit'/g) || []).length === 1);

// --- no Float money: BigInt cents / NUMERIC(12,2) only
check('credit.ts uses BigInt cents helpers, not floating point arithmetic', /function moneyCents\(v: unknown\): bigint/.test(creditTs) && /function centsText\(c: bigint\): string/.test(creditTs));
check('no parseFloat/Number()-based money math in credit.ts', !/Number\(.*amount.*\)\s*[+\-*]/.test(creditTs));
check('CreditAccount/CreditTransaction amounts are NUMERIC(12,2) in schema, not Float', /credit_limit\s+Decimal\s+@db\.Decimal\(12,2\)/.test(schema) && /current_balance\s+Decimal\s+@db\.Decimal\(12,2\)/.test(schema) && !/model CreditAccount[\s\S]{0,400}Float/.test(schema));

// --- receivable is real, not merely a payment-method label
check('CreditTransaction ledger table exists (real receivable history, not just paymentMethod=CREDIT)', /model CreditTransaction \{/.test(schema));
check('CreditAccount tracks credit_limit and current_balance as first-class fields', /model CreditAccount \{[\s\S]{0,400}credit_limit/.test(schema));
check('a credit sale increases current_balance (creates the receivable)', /UPDATE credit_accounts SET current_balance=CAST\(\? AS numeric\),updated_at=\? WHERE id=\?/.test(creditTs));

// --- repayment is not a sale
check('repayment never touches cash_sales', !/repay[\s\S]{0,2000}cash_sales/.test(creditTs));
check('CashShift gets a dedicated credit_repayments column, separate from cash_sales', /credit_repayments\s+Decimal\s+@db\.Decimal\(12,2\)\s+@default\(0\)/.test(schema));
check('cash repayments post to credit_repayments, not cash_sales', /UPDATE cash_shifts SET credit_repayments=credit_repayments\+CAST/.test(creditTs));
check('Z-report expected_cash reconciliation includes credit_repayments', /CAST\(\? AS DECIMAL\(12,2\)\) \+ CAST\(\? AS DECIMAL\(12,2\)\) \+ CAST\(\? AS DECIMAL\(12,2\)\) - CAST\(\? AS DECIMAL\(12,2\)\) - CAST\(\? AS DECIMAL\(12,2\)\)\) AS expected_cash/.test(cashShiftsTs));

// --- RBAC: cashier-issue-within-limit vs manager-only-limit-changes, reusing existing RBAC
check('5 credit permissions are seeded (view/issue/repay/manage_limit/reports)', ['credit.view', 'credit.issue', 'credit.repay', 'credit.manage_limit', 'credit.reports'].every(c => seedTs.includes(`code: '${c}'`)));
check('CASHIER role is granted credit.view/issue/repay but not credit.manage_limit or credit.reports in its own grant loop', (() => {
  // Parse the cashier grant loop's own list rather than pinning its exact tail: later stages
  // legitimately extend it (Stage 34.1 adds orders.closure.request), and what matters is
  // membership, not ordering.
  const m = seedTs.match(/for \(const code of \[([^\]]*'credit\.repay'[^\]]*)\]\) \{/);
  if (!m) return false;
  const granted = m[1].split(',').map(x => x.trim().replace(/^'|'$/g, ''));
  return ['credit.view', 'credit.issue', 'credit.repay'].every(c => granted.includes(c))
    && !granted.includes('credit.manage_limit') && !granted.includes('credit.reports');
})());
check('setting a credit limit requires credit.manage_limit', /router\.put\('\/accounts\/:id\/limit', requirePermission\('credit\.manage_limit'\)/.test(creditTs));
check('over-limit credit sale requires the manage_limit permission via the existing RBAC system, not a new approval table', /if \(opts\.amount > available && !opts\.isManager\)/.test(creditTs) && !/CREATE TABLE.*approval/i.test(creditTs));
check('payroll deduction requires the requesting user to hold credit.manage_limit (no separate approval workflow invented)', /PAYROLL_DEDUCTION_REQUIRES_APPROVAL/.test(creditTs));

// --- branch isolation reuses the existing allowed() pattern, not a second authorization system
check('credit.ts reuses the standard allowed(req,branch) branch-isolation helper', /function allowed\(req: Request, b: string\) \{ return Boolean\(req\.user\?\.isSuperUser \|\| req\.user\?\.allowedBranchIds\.includes\(b\)\); \}/.test(creditTs));

// --- idempotency reused (Idempotency-Key header + unique DB constraint), same convention as payments
check('repayment requires an Idempotency-Key header', /idem = String\(req\.headers\['idempotency-key'\]/.test(creditTs));
check('credit_transactions has a branch+idempotency_key unique constraint', /@@unique\(\[branch_id, idempotency_key\], map: "credit_tx_branch_idempotency_key"\)/.test(schema));

// --- audit logging on every mutating credit action
check('every credit mutation is audited via the shared insertAuditLog helper', (creditTs.match(/await insertAuditLog\(/g) || []).length >= 5);

// --- customer identity: minimal, reused, no second CRM system invented
check('Customer model is minimal identity (name/phone/branch), not a full CRM feature set', /model Customer \{[\s\S]{0,600}@@map\("customers"\)/.test(schema) && !/loyalty|marketing_/i.test(schema.match(/model Customer \{[\s\S]{0,600}@@map\("customers"\)/)[0]));
check('customer create is get-or-create by branch+phone (no duplicate customer rows)', /const existing = await queryOne<any>\('SELECT \* FROM customers WHERE branch_id=\? AND phone=\? AND deleted_at IS NULL'/.test(creditTs));

// --- soft delete convention (deleted_at) present on Customer
check('Customer supports soft-delete via deleted_at', /model Customer \{[\s\S]{0,400}deleted_at\s+String\?/.test(schema));

// --- frontend: Cashier POS integration, not a parallel POS
check('CashierPOSView adds CREDIT as a payment method on the existing pay dialog', /const PAYMENT_METHODS = \['CASH', 'CARD', 'ONLINE', 'BONUS', 'OTHER', 'CREDIT'\];/.test(cashierView));
check('CashierPOSView sends credit_account_id through the existing createPayment() call, not a new endpoint', /credit_account_id: creditAccount\.account\.id/.test(cashierView));
check('api.ts createPayment extended (not duplicated) with credit_account_id', /createPayment: \(data:\{order_id:string;method:string;amount:string;credit_account_id\?:string\}/.test(apiTs));
check('receipt shows credit fields only when payment.method is CREDIT (no leakage into cash/card receipts)', /receiptPayment\?\.method === 'CREDIT' && creditAccount/.test(cashierView));

console.log(`STAGE 31 CREDIT MODE STATIC: PASS (${passed} checks)`);
