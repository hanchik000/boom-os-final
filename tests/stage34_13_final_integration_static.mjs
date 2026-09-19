import fs from 'node:fs';

const read = (p) => fs.readFileSync(p, 'utf8');
const files = {
  orders: read('server/routes/orders.ts'),
  payments: read('server/routes/payments.ts'),
  closure: read('server/order-closure.ts'),
  loyalty: read('server/loyalty.ts'),
  serviceCharge: read('server/service-charge.ts'),
  analytics: read('server/routes/analytics.ts'),
  credit: read('server/routes/credit.ts'),
  bills: read('server/routes/order-bills.ts'),
  kds: read('server/routes/kds.ts'),
  journal: read('server/routes/boomcard-journal.ts'),
  foodCost: read('server/routes/food-cost.ts'),
  schema: read('prisma/schema.prisma'),
  app: read('src/App.tsx'),
  api: read('src/api.ts'),
};

const checks = [
  ['single Order Core creation endpoint', files.orders.includes("router.post('/', async(req,res)=>") && files.orders.includes('getWaiterSession(req)')],
  ['server derives waiter/branch from authenticated session', /req\.user!\.branch_id/.test(files.orders) && files.orders.includes('waiter_user_id')],
  ['payment requires READY order', files.payments.includes("ORDER_NOT_READY_FOR_PAYMENT") && files.payments.includes("['READY'].includes(order.status)")],
  ['payment requires KDS readiness', files.payments.includes('KDS_NOT_READY_FOR_PAYMENT')],
  ['payment consumes inventory and snapshots recipe cost', files.payments.includes("'SALE'") && files.payments.includes('recipe_version_snapshot') && files.payments.includes('recipe_cost_snapshot')],
  ['cash expected cash includes credit repayments', files.payments.includes('+credit_repayments-refunds-voids')],
  ['refund expected cash includes credit repayments', files.closure.includes('cash_sales+credit_repayments-(refunds+CAST(? AS numeric))-voids')],
  ['refund requires approved establishment closure', files.payments.includes("status='APPROVED' AND refund_requested=true")],
  ['refund does not restore inventory directly', files.payments.includes('refundPaymentFinancials') && !/refundPaymentFinancials[\s\S]{0,1800}stock_movements/.test(files.payments)],
  ['closure has explicit inventory treatment', files.schema.includes('inventory_treatment') && files.closure.includes('RESTORE_STOCK') && files.closure.includes('WRITE_OFF')],
  ['production started blocks stock restore', files.closure.includes('INVENTORY_RESTORE_FORBIDDEN_AFTER_PRODUCTION')],
  ['closure reverses loyalty through dedicated ledger functions', files.closure.includes('reverseBoomcoinForOrder') && files.closure.includes('reverseBoombackForOrder')],
  ['closure reverses all service-charge allocation states', files.closure.includes("status IN ('EARNED','POOLED','DISTRIBUTED')")],
  ['split bill uses one Order Core', files.bills.includes('order_bills') && files.payments.includes('bill_id') && files.analytics.includes('COUNT(*)')],
  ['credit repayment is not a payment/sale', files.credit.includes('credit_repayments') && files.analytics.includes("p.status='PAID'")],
  ['analytics sold definition is COMPLETED', files.analytics.includes("const SOLD_STATUS = 'COMPLETED'")],
  ['analytics uses historical recipe cost', files.analytics.includes('recipe_cost_snapshot')],
  ['BOOMCARD journal is read-only', /unified BOOMCARD Operations Journal/i.test(files.journal) && !/INSERT INTO|UPDATE\s+|DELETE FROM/.test(files.journal)],
  // Branch-scoping is checked via the shared allowed(req, <branch var>) helper -- the parameter
  // name varies by call site, so this matches the call, not one literal variable name.
  ['BOOMCARD journal is branch scoped', /allowed\(req,\s*\w+\)/.test(files.journal)],
  ['final app exposes BOOMCARD journal', files.app.includes('BoomcardJournalView') && files.api.includes('getBoomcardJournal')],
  ['no float in critical payment path', !/parseFloat|Math\.round\([^\n]*amount/i.test(files.payments)],
  ['schema preserves order history', files.schema.includes('OrderClosure') && files.schema.includes('OrderItem')],
];

let failed = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
  if (!ok) failed++;
}
if (failed) process.exit(1);
console.log(`Stage 34.13 integration static: ${checks.length}/${checks.length} passed`);
