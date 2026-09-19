// BOOM OS -- Stage 34.3 static source guards: MANUAL customer discounts.
// Guards against any automatic or profile-level discount ever appearing, against the frontend
// computing an authoritative amount, against a second customer core, and against an already-settled
// order being re-priced.
import fs from 'node:fs';

const failures = []; let checks = 0;
const read = p => fs.readFileSync(p, 'utf8');
function ok(label, cond, detail) { checks++; if (!cond) failures.push(`${label}${detail ? ' -> ' + String(detail).slice(0, 220) : ''}`); }

const orders = read('server/routes/orders.ts');
const customers = read('server/routes/customers.ts');
const credit = read('server/routes/credit.ts');
const totals = read('server/order-totals.ts');
const seed = read('server/seed.ts');
const schema = read('prisma/schema.prisma');
const serverTs = read('server.ts');
const api = read('src/api.ts');
const cashier = read('src/components/CashierPOSView.tsx');
const migration = read('prisma/migrations/20260919140000_stage34_3_manual_discounts/migration.sql');

// ---------------------------------------------------------------- 1. NO automatic discount
// A relation listing the discounts a guest was GRANTED is fine; a scalar discount FIELD on the
// profile is exactly the automatic-discount design this stage forbids.
ok('1. a customer profile carries no scalar discount field (only a relation to discounts granted on orders)', (() => {
  const model = /model Customer \{[\s\S]*?\n\}/.exec(schema)[0];
  return !model.split('\n').some(l => /^\s*\w*discount\w*\s+(Decimal|Int|Float|String|Boolean)/i.test(l));
})());
ok('2. attaching a customer does not touch any money column', (() => {
  const i = orders.indexOf("router.post('/:id/customer'");
  const body = i < 0 ? '' : orders.slice(i, orders.indexOf("router.get('/discount-options'"));
  return i >= 0 && !/recomputeOrderTotals|final_amount|discount=CAST/.test(body);
})());
ok('3. a discount only ever exists as an explicit, per-order row', /model OrderDiscount/.test(schema) && /INSERT INTO order_discounts/.test(orders));
ok('4. nothing creates a discount row outside the explicit discount endpoint', (orders.match(/INSERT INTO order_discounts/g) || []).length === 1 && !/INSERT INTO order_discounts/.test(customers) && !/INSERT INTO order_discounts/.test(credit));

// ---------------------------------------------------------------- 2. the server is authoritative
ok('5. the amount is computed server-side from the order\'s real subtotal, never taken from the caller', /amount = applyPercent\(subtotal, percentH\);/.test(orders) && !/req\.body\?\.(client_)?amount\b[^;]*applyPercent/.test(orders));
ok('6. percent and amount are mutually exclusive and validated', /DISCOUNT_PERCENT_OR_AMOUNT_REQUIRED/.test(orders) && /INVALID_DISCOUNT_PERCENT/.test(orders) && /INVALID_DISCOUNT_AMOUNT/.test(orders));
ok('7. a discount can never exceed the subtotal', /DISCOUNT_EXCEEDS_SUBTOTAL/.test(orders) && /if \(amount > subtotal\)/.test(orders));
ok('8. the ceiling is a configurable setting, not a number in code', /MAX_MANUAL_DISCOUNT_PERCENT/.test(seed) && /MANUAL_DISCOUNT_PRESETS/.test(seed) && /const DISCOUNT_SETTING_MAX = 'MAX_MANUAL_DISCOUNT_PERCENT'/.test(orders));
ok('9. exceeding it requires a distinct permission', /DISCOUNT_EXCEEDS_LIMIT/.test(orders) && /permissions\.includes\('orders\.discount\.override'\)/.test(orders));
ok('10. all discount maths is BigInt hundredths -- no Float', /function percentHundredths/.test(totals) && /function applyPercent/.test(totals) && !/parseFloat/.test(totals));

// ---------------------------------------------------------------- 3. one pricing rule
ok('11. there is exactly one order-total recomputation routine', (totals.match(/export async function recomputeOrderTotals/g) || []).length === 1);
ok('12. the item-removal path uses it instead of its own inline maths', /await recomputeOrderTotals\(tx, order, now\)/.test(orders) && !/AS final_amount`,\[subtotal,order\.discount/.test(orders));
ok('13. a percentage discount follows the subtotal, a fixed amount is capped by it', /d\.percent != null \? applyPercent\(subtotal, percentHundredths\(d\.percent\)\) : cents\(d\.amount\)/.test(totals) && /if \(amount > remaining\)/.test(totals));
ok('14. the service charge still uses the order\'s own configuration version', /serviceChargePercentFor\(tx, order\.branch_id, order\.order_type, order\.created_at\)/.test(totals));

// ---------------------------------------------------------------- 4. history never changes
// Assert the guard itself, not just that the error code exists somewhere in the map -- the code
// would survive the guard being deleted.
ok('15. only an open order can be discounted', /DISCOUNTABLE_ORDER_STATUSES = \['PENDING_CONFIRMATION', 'CONFIRMED', 'PREPARING', 'READY'\]/.test(orders) && /if \(!DISCOUNTABLE_ORDER_STATUSES\.includes\(order\.status\)\) throw Object\.assign\(new Error\('ORDER_NOT_EDITABLE'\)/.test(orders));
ok('16. removing a discount is a soft, recorded reversal -- nothing is deleted', /UPDATE order_discounts SET status='REMOVED'/.test(orders) && !/DELETE FROM order_discounts/.test(orders));
ok('17. the same guard protects customer attachment, so a settled order is never re-tagged', (orders.match(/loadDiscountableOrder\(tx, req/g) || []).length === 3);

// ---------------------------------------------------------------- 5. one customer core
ok('18. there is one customers table and one create-or-return routine', (schema.match(/^model Customer \{/m) || []).length === 1 && (customers.match(/export async function findOrCreateCustomer/g) || []).length === 1);
ok('19. the credit surface reuses it instead of inserting its own customer', /findOrCreateCustomer/.test(credit) && !/INSERT INTO customers/.test(credit));
ok('20. the same phone in a branch returns the existing guest rather than a duplicate', /SELECT \* FROM customers WHERE branch_id=\? AND phone=\? AND deleted_at IS NULL/.test(customers) && /customers_branch_phone_key/.test(schema));
ok('21. the customers router is mounted once and wired into async error forwarding', (serverTs.match(/app\.use\('\/api\/customers'/g) || []).length === 1 && /serviceChargeRouter, customersRouter/.test(serverTs));

// ---------------------------------------------------------------- 6. snapshot, RBAC, audit
ok('22. the snapshot records customer, percent, amount, base, employee, role, source, reason and time', ['customer_id', 'percent', 'amount', 'base_amount', 'applied_by_user_id', 'applied_by_role', 'source', 'reason', 'created_at'].every(f => new RegExp(`model OrderDiscount[\\s\\S]{0,1400}${f}`).test(schema)));
ok('23. both new order permissions and both customer permissions are seeded', ['orders.discount.apply', 'orders.discount.override', 'customers.view', 'customers.manage'].every(c => seed.includes(`code: '${c}'`)));
const rolePerms = seed.match(/const stage17RolePerms = \[([^\]]*)\]/);
ok('24. they are granted through the existing manager role list', rolePerms && ['orders.discount.apply', 'orders.discount.override', 'customers.view'].every(c => rolePerms[1].includes(`'${c}'`)), rolePerms?.[1]);
const cashierPerms = seed.match(/for \(const code of \[([^\]]*'credit\.repay'[^\]]*)\]\) \{/);
ok('25. a cashier may grant a discount but never exceed the ceiling', cashierPerms && cashierPerms[1].includes("'orders.discount.apply'") && !cashierPerms[1].includes("'orders.discount.override'"), cashierPerms?.[1]);
ok('26. a waiter may only act on their own order', /order\.branch_id !== actor\.waiterBranchId \|\| order\.waiter_user_id !== actor\.waiterUserId/.test(orders));
ok('27. an operator is still branch-checked with the existing helper', /} else if \(!allowed\(req, order\.branch_id\)\)/.test(orders));
ok('28. attach, apply and remove are all audited', /ORDER_CUSTOMER_ATTACHED/.test(orders) && /ORDER_DISCOUNT_APPLIED/.test(orders) && /ORDER_DISCOUNT_REMOVED/.test(orders));
ok('29. the audit entry carries the granting employee and their role', /applied_by_user_id: actor\.userId, applied_by_role: actor\.role/.test(orders));
ok('30. the migration is additive -- a new table plus one nullable order column', /CREATE TABLE "order_discounts"/.test(migration) && /ADD COLUMN\s+"customer_id" TEXT/.test(migration) && !/DROP TABLE/.test(migration));

// ---------------------------------------------------------------- 7. frontend
ok('31. the POS reads its presets and ceiling from the backend, never from a literal', /getDiscountOptions/.test(api) && /setDiscountPresets\(r\.presets\)/.test(cashier) && !/\[10, ?15, ?20, ?30\]/.test(cashier));
ok('32. the POS never computes the discounted total itself', !/applyPercent|percentHundredths/.test(cashier));
ok('33. it always re-reads the order the server returned', /await loadDetail\(detail\.id\); await loadOrders\(true\);/.test(cashier));
ok('34. the screen states that identification alone does not change the price', /Привязка клиента не меняет цену заказа/.test(cashier));
ok('35. customer search, quick create and the discount flow are all wired', /searchCustomers/.test(cashier) && /createAndAttach/.test(cashier) && /applyOrderDiscount/.test(api) && /removeOrderDiscount/.test(api));
ok('36. RU + TK copy throughout', /Müşderi gözlemek/.test(cashier) && /Sargyda arzanladyş/.test(cashier));

console.log(`Stage 34.3 static checks: ${checks}`);
if (failures.length) { console.error(`\nFAILURES (${failures.length}):`); for (const f of failures) console.error(' - ' + f); process.exit(1); }
console.log('ALL STAGE 34.3 STATIC CHECKS PASSED');
