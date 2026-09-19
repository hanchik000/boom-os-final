// BOOM OS -- Stage 34.8 static source guards: complimentary items ("ОТ ЗАВЕДЕНИЯ").
// Guards against a compliment appearing without an approval, against a second approval, against a
// second inventory path, and against the give-away being free to the establishment as well.
import fs from 'node:fs';

const failures = []; let checks = 0;
const read = p => fs.readFileSync(p, 'utf8');
function ok(label, cond, detail) { checks++; if (!cond) failures.push(`${label}${detail ? ' -> ' + String(detail).slice(0, 220) : ''}`); }

const orders = read('server/routes/orders.ts');
const seed = read('server/seed.ts');
const schema = read('prisma/schema.prisma');
const api = read('src/api.ts');
const cashier = read('src/components/CashierPOSView.tsx');
const approvals = read('src/components/OrderApprovalsView.tsx');
const migration = read('prisma/migrations/20260920000000_stage34_8_compliments/migration.sql');

// Slice the approval routine once -- several guards are about what it does and does not do.
const decideStart = orders.indexOf('async function decideCompliment(');
const decideBody = decideStart < 0 ? '' : orders.slice(decideStart, orders.indexOf("router.post('/compliment-requests/:complimentId/approve'"));

// ---------------------------------------------------------------- 1. request, then ONE approval
ok('1. the six business reasons are defined once, server-side', /COMPLIMENT_REASONS = \['COMPLIMENT', 'APOLOGY', 'GIFT', 'ESTABLISHMENT_ERROR', 'BIRTHDAY', 'OTHER'\]/.test(orders));
ok('2. a request is always inserted as PENDING', /INSERT INTO compliment_requests[\s\S]{0,400}'PENDING'/.test(orders));
ok('3. requesting adds NO order line -- only approval does', (() => {
  const i = orders.indexOf("router.post('/:id/compliments'");
  const body = i < 0 ? '' : orders.slice(i, orders.indexOf("router.get('/compliment-requests'"));
  return i >= 0 && !/INSERT INTO order_items/.test(body);
})());
ok('4. approval is manager-permissioned', /router\.post\('\/compliment-requests\/:complimentId\/approve', authenticateToken, requirePermission\('orders\.compliment\.approve'\)/.test(orders));
ok('5. the requester can never approve their own', /c\.requester_user_id === req\.user!\.id\) throw Object\.assign\(new Error\('SELF_APPROVAL_FORBIDDEN'\)/.test(orders));

// ---------------------------------------------------------------- 2. double approval is impossible
ok('6. the decision is taken under a row lock', /SELECT \* FROM compliment_requests WHERE id=\? FOR UPDATE/.test(orders));
ok('7. and only from PENDING', /if \(c\.status !== 'PENDING'\) throw Object\.assign\(new Error\('COMPLIMENT_ALREADY_DECIDED'\)/.test(orders));
ok('8. the status update itself re-asserts PENDING, so a race cannot write twice', (orders.match(/UPDATE compliment_requests SET status='(APPROVED|REJECTED)'[\s\S]{0,200}AND status='PENDING'/g) || []).length === 2);

// ---------------------------------------------------------------- 3. price 0 to the guest, real cost to the house
ok('9. the approved line is a REAL order item at a customer price of 0', /INSERT INTO order_items[\s\S]{0,220}price_snapshot,quantity,subtotal[\s\S]{0,140},0,\?,0,/.test(orders));
ok('10. approval runs no inventory of its own -- consumption belongs to the existing payment path', decideStart >= 0 && !/stock_movements|inventory_items|recipe_ingredients/.test(decideBody));
ok('11. the normal menu value is snapshotted at request time', /normal_value      Decimal  @db\.Decimal\(12, 2\)/.test(schema) && /const normalValue = totalsText\(orderCents\(item\.price\) \* BigInt\(quantity\)\)/.test(orders));
ok('12. the report reads the line\'s own historical recipe cost, never a recomputation', /oi\.recipe_cost_snapshot AS cost/.test(orders));
ok('13. the order total is recomputed through the one pricing rule', /await recomputeOrderTotals\(tx, order, now\)/.test(decideBody));
ok('14. all money is BigInt cents -- no Float', !/parseFloat/.test(orders));

// ---------------------------------------------------------------- 4. history never changes
ok('15. only an open order can receive a compliment', /COMPLIMENTABLE_ORDER_STATUSES = \['PENDING_CONFIRMATION', 'CONFIRMED', 'PREPARING', 'READY'\]/.test(orders) && /if \(!COMPLIMENTABLE_ORDER_STATUSES\.includes\(order\.status\)\) throw Object\.assign\(new Error\('ORDER_NOT_EDITABLE'\)/.test(orders));
ok('16. a paid separate check cannot receive one either', /BILL_ALREADY_PAID/.test(orders));
ok('17. nothing is ever deleted -- a rejection is a status, not a removal', !/DELETE FROM compliment_requests/.test(orders));

// ---------------------------------------------------------------- 5. the report has everything the spec asks for
ok('18. reason, employee, approver, customer, order, item, normal value, cost, branch and date', ['c.reason', 'u.full_name AS requester_name', 'a.full_name AS approver_name', 'cu.name AS customer_name', 'o.order_number', 'm.name_ru AS menu_item_name', 'c.normal_value', 'oi.recipe_cost_snapshot AS cost', 'c.branch_id=?', 'c.created_at'].every(f => orders.includes(f)));
ok('19. and it totals by reason', /GROUP BY c\.reason/.test(orders));

// ---------------------------------------------------------------- 6. RBAC, audit, wiring
ok('20. both permissions are seeded', ['orders.compliment.request', 'orders.compliment.approve'].every(c => seed.includes(`code: '${c}'`)));
const rolePerms = seed.match(/const stage17RolePerms = \[([^\]]*)\]/);
ok('21. managers hold both', rolePerms && rolePerms[1].includes("'orders.compliment.request'") && rolePerms[1].includes("'orders.compliment.approve'"), rolePerms?.[1]);
const cashierPerms = seed.match(/for \(const code of \[([^\]]*'credit\.repay'[^\]]*)\]\) \{/);
ok('22. a cashier may request but never approve', cashierPerms && cashierPerms[1].includes("'orders.compliment.request'") && !cashierPerms[1].includes("'orders.compliment.approve'"), cashierPerms?.[1]);
ok('23. every route is branch- or waiter-scoped with the existing helpers', /allowed\(req, c\.branch_id\)/.test(orders) && /!branchId \|\| !allowed\(req, branchId\)/.test(orders));
ok('24. request, approval and rejection are all audited', ['COMPLIMENT_REQUESTED', 'COMPLIMENT_APPROVED', 'COMPLIMENT_REJECTED'].every(a => orders.includes(a)));
ok('25. the approval audit records that the customer price is zero', /customer_price: '0\.00'/.test(orders));
ok('26. the migration is additive: one new table', /CREATE TABLE "compliment_requests"/.test(migration) && !/DROP TABLE/.test(migration));

// ---------------------------------------------------------------- 7. frontend
ok('27. the POS reads the reason set from the backend, never a hardcoded list', /getComplimentReasons/.test(api) && /api\.getComplimentReasons\(\)/.test(cashier));
ok('28. the POS only requests -- it never approves', /requestCompliment/.test(cashier) && !/approveCompliment/.test(cashier));
ok('29. and it never computes the value or the cost itself', !/recipe_cost_snapshot|normal_value =/.test(cashier));
ok('30. the manager approval screen is permission-gated and shows the value and reason', /hasPermission\('orders\.compliment\.approve'\)/.test(approvals) && /normal_value/.test(approvals) && /complimentReasonLabel/.test(approvals));
ok('31. both screens state that the guest pays nothing but the house cost is recorded', /реальная себестоимость учитывается заведением/.test(cashier) && /реальная себестоимость учитывается заведением/.test(approvals));
ok('32. RU + TK copy', /Kärhanadan/.test(cashier) && /Kärhanadan/.test(approvals));

console.log(`Stage 34.8 static checks: ${checks}`);
if (failures.length) { console.error(`\nFAILURES (${failures.length}):`); for (const f of failures) console.error(' - ' + f); process.exit(1); }
console.log('ALL STAGE 34.8 STATIC CHECKS PASSED');
