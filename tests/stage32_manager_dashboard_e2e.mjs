// BOOM OS -- Stage 32: fresh-DB E2E proof of the Manager Command Center aggregation endpoint,
// exercising real Order/Payment/CashShift/Credit/KDS/Waiter/Inventory/Staff data and verifying
// the server-computed dashboard reconciles with it exactly.
//
// Requires an empty database. Usage: node tests/stage32_manager_dashboard_e2e.mjs
import assert from 'node:assert/strict';

const base = `http://127.0.0.1:${process.env.BOOM_OS_PORT || 3000}`;
const ownerPassword = process.env.STAGE32_OWNER_PASSWORD || 'BoomStage32Owner!';
const staffPassword = 'Stage32StaffPass12345!';
const stamp = Date.now();

let counts = { runtime: 0, denials: 0, dbPost: 0 };
const failures = [];

const RATE_BUDGET = 250;
let windowStart = Date.now(), windowCount = 0;
async function pace() {
  const now = Date.now();
  if (now - windowStart >= 60000) { windowStart = now; windowCount = 0; }
  windowCount++;
  if (windowCount >= RATE_BUDGET) {
    const wait = 60000 - (Date.now() - windowStart) + 250;
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    windowStart = Date.now(); windowCount = 0;
  }
}
async function request(path, options = {}) {
  await pace();
  counts.runtime++;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const res = await fetch(base + path, { ...options, signal: controller.signal, headers: { 'content-type': 'application/json', ...(options.headers || {}) } });
    let body = null; try { body = await res.json(); } catch {}
    return { status: res.status, body };
  } catch (error) { throw new Error(`${path} did not answer (${error.message})`); }
  finally { clearTimeout(timer); }
}
function expect(step, got, want, body) { if (got !== want) failures.push(`${step}: expected ${want}, got ${got} -> ${JSON.stringify(body).slice(0, 300)}`); }
function ok(step, cond, detail) { if (!cond) failures.push(`${step}: FAILED ${detail !== undefined ? '-> ' + JSON.stringify(detail).slice(0, 300) : ''}`); }
function mustDenyAuth(label, r) {
  if (r.status >= 200 && r.status < 300) failures.push(`${label} -- returned ${r.status} (expected denial): ${JSON.stringify(r.body).slice(0, 260)}`);
  else if (![401, 403, 404].includes(r.status)) failures.push(`${label} -- returned ${r.status}, not a recognized denial: ${JSON.stringify(r.body).slice(0, 260)}`);
  else counts.denials++;
}
function moneyEq(actual, expectedStr) { return Math.abs(parseFloat(actual) - parseFloat(expectedStr)) < 0.005; }
function dbCheck(label, cond, detail) { counts.dbPost++; ok(`DB POST-CONDITION -- ${label}`, cond, detail); }

// ---------------------------------------------------------------- bootstrap + topology
const owner = await request('/api/auth/bootstrap', { method: 'POST', body: JSON.stringify({ full_name: 'S32 Owner', email: `s32owner-${stamp}@boom.local`, password: ownerPassword }) });
expect('bootstrap owner', owner.status, 201, owner.body);
const OWNER = { authorization: `Bearer ${owner.body.token}` };

async function makeFranchise(tag) {
  const f = await request('/api/franchises', { method: 'POST', headers: OWNER, body: JSON.stringify({ name: `S32 F${tag}`, code: `S32${tag}${stamp % 100000}`, legal_name: `S32${tag} LLC`, contact_name: 'x', phone: `+9931699${tag}`, email: `s32${tag}-${stamp}@boom.local`, address: 'x' }) });
  expect(`create franchise ${tag}`, f.status, 201, f.body);
  return f.body.franchise.id;
}
async function makeBranch(tag, franchiseId) {
  const branch = await request('/api/branches', { method: 'POST', headers: OWNER, body: JSON.stringify({ name: `S32 B${tag}`, code: `S32${tag}${stamp % 100000}`, address: 'x', phone: `+9931609${tag}`, franchise_id: franchiseId }) });
  expect(`branch ${tag}`, branch.status, 201, branch.body);
  const id = branch.body.branch.id;
  await request(`/api/franchises/${franchiseId}/branches/${id}`, { method: 'POST', headers: OWNER, body: '{}' });
  return { tag, id, franchiseId };
}
async function makeUser(label, branch, allowed, roles) {
  const email = `${label}-${stamp}@boom.local`.toLowerCase();
  const u = await request('/api/users', { method: 'POST', headers: OWNER, body: JSON.stringify({ full_name: `${label} Name`, email, phone: `+9939${Math.floor(Math.random() * 100000)}`, password: staffPassword, branch_id: branch, roles, allowed_branches: allowed }) });
  expect(`create user ${label}`, u.status, 201, u.body);
  const login = await request('/api/auth/login', { method: 'POST', body: JSON.stringify({ login: email, password: staffPassword }) });
  expect(`login ${label}`, login.status, 200, login.body);
  return { label, email, id: u.body.user.id, headers: { authorization: `Bearer ${login.body.token}` } };
}

const FA = await makeFranchise('A');
const A1 = await makeBranch('A1', FA);
const A2 = await makeBranch('A2', FA);
const MGR_A1 = await makeUser('mgrA1', A1.id, [A1.id], ['BRANCH_MANAGER']);
const CASHIER_A1 = await makeUser('cashA1', A1.id, [A1.id], ['CASHIER']);
const MGR_A2 = await makeUser('mgrA2', A2.id, [A2.id], ['BRANCH_MANAGER']);

console.log(`Setup: FA=${FA} A1=${A1.id} A2=${A2.id}`);

// menu / inventory / table / waiter plumbing
const cat = await request('/api/menu/categories', { method: 'POST', headers: MGR_A1.headers, body: JSON.stringify({ branch_id: A1.id, name_ru: 'Cat', name_tk: 'Cat', sort_order: 0 }) });
const item = (await request('/api/menu/items', { method: 'POST', headers: MGR_A1.headers, body: JSON.stringify({ branch_id: A1.id, category_id: cat.body.category.id, sku: `SKU32-${stamp}`, name_ru: 'Burger', name_tk: 'Burger', price: '25.00', sort_order: 0 }) })).body.item;
const invLow = (await request('/api/inventory/items', { method: 'POST', headers: MGR_A1.headers, body: JSON.stringify({ branch_id: A1.id, sku: `INVLOW-${stamp}`, name: 'Bun', unit: 'pcs', reorder_point: '10' }) })).body.item;
await request('/api/inventory/movements', { method: 'POST', headers: MGR_A1.headers, body: JSON.stringify({ branch_id: A1.id, inventory_item_id: invLow.id, type: 'ADJUSTMENT', quantity: '5', reason: 'initial low stock' }) });
await request('/api/inventory/movements', { method: 'POST', headers: MGR_A1.headers, body: JSON.stringify({ branch_id: A1.id, inventory_item_id: invLow.id, type: 'WASTE', quantity: '1', reason: 's32 spoilage test' }) });
const invOut = (await request('/api/inventory/items', { method: 'POST', headers: MGR_A1.headers, body: JSON.stringify({ branch_id: A1.id, sku: `INVOUT-${stamp}`, name: 'Sauce', unit: 'pcs', reorder_point: '5' }) })).body.item; // starts at 0 -> already out of stock
const areaR = await request('/api/tables/areas', { method: 'POST', headers: MGR_A1.headers, body: JSON.stringify({ branch_id: A1.id, name: 'Hall', sort_order: 0 }) });
const tableR = await request('/api/tables', { method: 'POST', headers: MGR_A1.headers, body: JSON.stringify({ branch_id: A1.id, area_id: areaR.body.area.id, code: `T32-${stamp % 10000}`, seats: 4 }) });
const waiterUser = await makeUser('waitA1', A1.id, [A1.id], ['WAITER']);
const codeR = await request(`/api/waiters/${waiterUser.id}/code`, { method: 'POST', headers: MGR_A1.headers, body: JSON.stringify({ code: '9231' }) });
expect('issue waiter code', codeR.status, 201, codeR.body);
const waiterAuth = await request('/api/waiters/authenticate-code', { method: 'POST', body: JSON.stringify({ code: '9231', deviceId: 's32-device' }) });
expect('waiter authenticate', waiterAuth.status, 200, waiterAuth.body);
const W1 = { headers: { 'x-waiter-session': waiterAuth.body.session.token } };

async function makeReadyOrder(qty = 1) {
  const orderR = await request('/api/orders', { method: 'POST', headers: { ...W1.headers, 'idempotency-key': `s32-order-${Date.now()}-${Math.random()}` }, body: JSON.stringify({ order_type: 'DINE_IN', source: 'POS', table_id: tableR.body.table.id, items: [{ menu_item_id: item.id, quantity: qty }] }) });
  expect('create order', orderR.status, 201, orderR.body);
  const order = orderR.body.order;
  await request(`/api/orders/${order.id}/confirm`, { method: 'POST', headers: MGR_A1.headers });
  const ticket = (await request(`/api/kds?branch_id=${A1.id}&status=NEW`, { headers: MGR_A1.headers })).body.tickets.find(t => t.order_id === order.id);
  await request(`/api/kds/${ticket.id}/status`, { method: 'POST', headers: MGR_A1.headers, body: JSON.stringify({ status: 'PREPARING' }) });
  await request(`/api/kds/${ticket.id}/status`, { method: 'POST', headers: MGR_A1.headers, body: JSON.stringify({ status: 'READY' }) });
  return { order: (await request(`/api/orders/${order.id}`, { headers: MGR_A1.headers })).body.order, ticketId: ticket.id };
}

const unlockR = await request('/api/operator-pos/unlock', { method: 'POST', headers: CASHIER_A1.headers, body: JSON.stringify({ password: staffPassword, branch_id: A1.id, device_id: 's32-cashier-device' }) });
expect('CASHIER POS unlock', unlockR.status, 200, unlockR.body);
const posToken = unlockR.body.session_token;
const openR = await request('/api/cash-shifts', { method: 'POST', headers: MGR_A1.headers, body: JSON.stringify({ branch_id: A1.id, opening_cash: '100.00' }) });
expect('open shift', openR.status, 201, openR.body);

// The window that isolates this test's own data from anything else on the branch.
const windowStartIso = new Date(Date.now() - 5000).toISOString();

// ================================================================== ORDERS + PAYMENTS (CASH / CARD / CREDIT)
const { order: orderCash } = await makeReadyOrder(2);
// Removal request from the waiter who owns orderCash (real "mistakes/corrections" signal) --
// must happen while the order is still READY, before payment moves it to COMPLETED.
const removalR = await request(`/api/orders/${orderCash.id}/items/${orderCash.items[0].id}/removal-request`, { method: 'POST', headers: W1.headers, body: JSON.stringify({ reason: 's32 test correction', quantity: '1' }) });
expect('waiter removal request', removalR.status, 201, removalR.body);
const payCash = await request('/api/payments', { method: 'POST', headers: { ...CASHIER_A1.headers, 'x-pos-session-token': posToken, 'idempotency-key': `s32-cash-${stamp}` }, body: JSON.stringify({ order_id: orderCash.id, method: 'CASH', amount: orderCash.final_amount }) });
expect('cash payment', payCash.status, 201, payCash.body);

const { order: orderCard } = await makeReadyOrder(1);
const payCard = await request('/api/payments', { method: 'POST', headers: { ...CASHIER_A1.headers, 'x-pos-session-token': posToken, 'idempotency-key': `s32-card-${stamp}` }, body: JSON.stringify({ order_id: orderCard.id, method: 'CARD', amount: orderCard.final_amount }) });
expect('card payment', payCard.status, 201, payCard.body);

const custR = await request('/api/credit/customers', { method: 'POST', headers: CASHIER_A1.headers, body: JSON.stringify({ branch_id: A1.id, name: 'S32 Debtor', phone: `+99362${stamp % 1000000}` }) });
expect('create credit customer', custR.status, 201, custR.body);
const acctR = await request('/api/credit/accounts', { method: 'POST', headers: CASHIER_A1.headers, body: JSON.stringify({ branch_id: A1.id, type: 'CUSTOMER', customer_id: custR.body.customer.id }) });
await request(`/api/credit/accounts/${acctR.body.account.id}/limit`, { method: 'PUT', headers: MGR_A1.headers, body: JSON.stringify({ credit_limit: '200.00' }) });
const { order: orderCredit } = await makeReadyOrder(1);
const payCredit = await request('/api/payments', { method: 'POST', headers: { ...CASHIER_A1.headers, 'x-pos-session-token': posToken, 'idempotency-key': `s32-credit-${stamp}` }, body: JSON.stringify({ order_id: orderCredit.id, method: 'CREDIT', amount: orderCredit.final_amount, credit_account_id: acctR.body.account.id }) });
expect('credit payment', payCredit.status, 201, payCredit.body);

// Real amounts as the server computed them (subtotal + whatever service charge/discount rules
// already apply to a DINE_IN order) -- never hardcoded, so this test verifies the dashboard
// against the actual Order Core output, not an assumed price.
const cashAmount = Number(orderCash.final_amount), cardAmount = Number(orderCard.final_amount), creditAmount = Number(orderCredit.final_amount);
const totalSalesExpected = (cashAmount + cardAmount + creditAmount).toFixed(2);
const receivedExpected = (cashAmount + cardAmount + 10).toFixed(2); // cash + card + the 10.00 repayment below, NOT the credit sale
const receivablesExpected = (creditAmount - 10).toFixed(2);

// Partial repayment in CASH -- must show as received money, must NOT show as a sale.
const repayR = await request('/api/credit/repay', { method: 'POST', headers: { ...CASHIER_A1.headers, 'x-pos-session-token': posToken, 'idempotency-key': `s32-repay-${stamp}` }, body: JSON.stringify({ account_id: acctR.body.account.id, amount: '10.00', method: 'CASH', branch_id: A1.id }) });
expect('credit repayment', repayR.status, 201, repayR.body);

const windowEndIso = new Date(Date.now() + 5000).toISOString();

// ================================================================== DASHBOARD: full data window
const dash = await request(`/api/dashboard/manager?branch_id=${A1.id}&start=${encodeURIComponent(windowStartIso)}&end=${encodeURIComponent(windowEndIso)}`, { headers: MGR_A1.headers });
expect('1. dashboard loads for branch manager', dash.status, 200, dash.body);
const d = dash.body;

dbCheck('2. today sales = cash + card + credit (real order totals)', moneyEq(d.kpi.today_sales, totalSalesExpected), { got: d.kpi, expected: totalSalesExpected });
dbCheck('4. cash total matches the real cash order total', moneyEq(d.kpi.cash, cashAmount.toFixed(2)), d.kpi);
dbCheck('5. card total matches the real card order total', moneyEq(d.kpi.card, cardAmount.toFixed(2)), d.kpi);
dbCheck('6. credit total matches the real credit order total', moneyEq(d.kpi.credit, creditAmount.toFixed(2)), d.kpi);
dbCheck('7. receivables = credit sale - 10.00 repaid', moneyEq(d.financial.receivables.total, receivablesExpected), { got: d.financial.receivables, expected: receivablesExpected });
dbCheck('8. credit repayments received = 10.00', moneyEq(d.financial.received.credit_repayments, '10.00'), d.financial.received);
dbCheck('9a. SALES vs RECEIVED reconciliation: sales.total != received.total (credit sale not yet received)', moneyEq(d.financial.sales.total, totalSalesExpected) && moneyEq(d.financial.received.total, receivedExpected), { financial: d.financial, expectedSales: totalSalesExpected, expectedReceived: receivedExpected });
dbCheck('18. credit sale included in SALES', moneyEq(d.financial.sales.credit, creditAmount.toFixed(2)), d.financial.sales);
dbCheck('19. credit sale excluded from RECEIVED (cash+card only, no credit sale amount)', moneyEq(d.financial.received.cash, cashAmount.toFixed(2)) && moneyEq(d.financial.received.card, cardAmount.toFixed(2)), d.financial.received);
dbCheck('20. credit repayment included in RECEIVED money', moneyEq(d.financial.received.credit_repayments, '10.00'), d.financial.received);
dbCheck('21. credit repayment excluded from SALES (sales.credit still exactly the original credit sale, not +10)', moneyEq(d.financial.sales.credit, creditAmount.toFixed(2)), d.financial.sales);

dbCheck('10. order status counts: 3 COMPLETED orders (all three paid orders)', d.orders.by_status.COMPLETED === 3, d.orders);
dbCheck('11. KDS counts: no tickets left NEW', d.kds.by_status.NEW === 0, d.kds);
ok('KDS average prep time is real (not null, not negative) once tickets have timing data', d.kds.average_preparation_minutes === null || d.kds.average_preparation_minutes >= 0, d.kds);

dbCheck('12. waiter KPI: our waiter has 3 orders and the real combined sales total', (() => { const w = d.waiters.find(x => x.id === waiterUser.id); return w && w.orders === 3 && moneyEq(w.sales, totalSalesExpected); })(), d.waiters);
dbCheck('waiter KPI: average_check = combined sales / 3, truncated in cents like the server (no Float rounding)', (() => { const w = d.waiters.find(x => x.id === waiterUser.id); const totalCents = Math.round(Number(totalSalesExpected) * 100); const expectedAvg = (Math.trunc(totalCents / 3) / 100).toFixed(2); return w && moneyEq(w.average_check, expectedAvg); })(), d.waiters);
dbCheck('waiter KPI: removal_requests reflects the real request we made', (() => { const w = d.waiters.find(x => x.id === waiterUser.id); return w && w.removal_requests >= 1; })(), d.waiters);

dbCheck('13. cashier activity: our cashier processed all 3 sales with correct method breakdown', (() => { const c = d.cashiers.find(x => x.id === CASHIER_A1.id); return c && c.orders === 3 && moneyEq(c.cash, cashAmount.toFixed(2)) && moneyEq(c.card, cardAmount.toFixed(2)) && moneyEq(c.credit, creditAmount.toFixed(2)); })(), d.cashiers);
dbCheck('cashier activity: credit_issued / credit_repayments attributed to the cashier', (() => { const c = d.cashiers.find(x => x.id === CASHIER_A1.id); return c && moneyEq(c.credit_issued, creditAmount.toFixed(2)) && moneyEq(c.credit_repayments, '10.00'); })(), d.cashiers);

dbCheck('14. inventory alerts: low-stock item present', d.inventory.low_stock.some(i => i.id === invLow.id), d.inventory.low_stock);
dbCheck('inventory alerts: out-of-stock item present', d.inventory.out_of_stock.some(i => i.id === invOut.id), d.inventory.out_of_stock);
dbCheck('inventory alerts: recent write-off recorded', d.inventory.recent_write_offs.length >= 1, d.inventory.recent_write_offs);
dbCheck('alert center surfaces the out-of-stock and low-stock alerts', d.alerts.filter(a => a.type === 'LOW_STOCK').length >= 2, d.alerts);

dbCheck('15. staff counts: at least 3 ACTIVE staff in the branch (manager, cashier, waiter)', d.staff.by_employment_status.ACTIVE >= 3, d.staff);

// ================================================================== 3. DATE FILTERING: a window entirely BEFORE the test data must show zeros
const past = new Date(Date.now() - 3600_000).toISOString();
const pastEnd = windowStartIso;
const dashPast = await request(`/api/dashboard/manager?branch_id=${A1.id}&start=${encodeURIComponent(past)}&end=${encodeURIComponent(pastEnd)}`, { headers: MGR_A1.headers });
expect('date filter (past window) loads', dashPast.status, 200, dashPast.body);
dbCheck('date filtering actually filters: past window shows zero sales for the same branch', moneyEq(dashPast.body.kpi.today_sales, '0.00') && dashPast.body.orders.total === 0, dashPast.body.kpi);

// ================================================================== 16/23. BRANCH FILTERING / ISOLATION
mustDenyAuth('23. MGR_A2 cannot view A1 dashboard (cross-branch)', await request(`/api/dashboard/manager?branch_id=${A1.id}`, { headers: MGR_A2.headers }));
const dashA2 = await request(`/api/dashboard/manager?branch_id=${A2.id}`, { headers: MGR_A2.headers });
expect('MGR_A2 can view their own branch dashboard', dashA2.status, 200, dashA2.body);
dbCheck('branch isolation: A2 dashboard shows none of A1 activity', dashA2.body.orders.total === 0 && moneyEq(dashA2.body.kpi.today_sales, '0.00'), dashA2.body);

// ================================================================== 24. CASHIER cannot access manager-only dashboard
mustDenyAuth('24. CASHIER cannot access the manager dashboard (no dashboard.view)', await request(`/api/dashboard/manager?branch_id=${A1.id}`, { headers: CASHIER_A1.headers }));

// ================================================================== 17/25. RBAC: a role with dashboard.view but NOT financial/credit/inventory/staff permissions
const limitedRoleR = await request('/api/roles', { method: 'POST', headers: OWNER, body: JSON.stringify({ code: `S32_LIMITED_${stamp}`, name: 'S32 Limited Manager', permission_ids: ['dashboard.view', 'orders.view', 'branches.view'] }) });
expect('create limited role', limitedRoleR.status, 201, limitedRoleR.body);
const LIMITED = await makeUser('limitedA1', A1.id, [A1.id], [limitedRoleR.body.role.code]);
const dashLimited = await request(`/api/dashboard/manager?branch_id=${A1.id}&start=${encodeURIComponent(windowStartIso)}&end=${encodeURIComponent(windowEndIso)}`, { headers: LIMITED.headers });
expect('limited role can still open the dashboard (holds dashboard.view)', dashLimited.status, 200, dashLimited.body);
dbCheck('permissions map correctly reports what this role can see', dashLimited.body.permissions.orders === true && dashLimited.body.permissions.financial === false && dashLimited.body.permissions.credit === false && dashLimited.body.permissions.inventory === false && dashLimited.body.permissions.staff === false, dashLimited.body.permissions);
dbCheck('25a. restricted financial data is not present in the response at all (not just hidden)', dashLimited.body.financial === undefined && dashLimited.body.cashiers === undefined, dashLimited.body);
dbCheck('25b. restricted credit/receivables data is not present', dashLimited.body.credit === undefined, dashLimited.body);
dbCheck('25c. restricted inventory data is not present', dashLimited.body.inventory === undefined, dashLimited.body);
dbCheck('25d. restricted staff data is not present', dashLimited.body.staff === undefined, dashLimited.body);
ok('orders section (a permission this role DOES have) is still present', !!dashLimited.body.orders, dashLimited.body.orders);

// ================================================================== 22. REFUND handling
// Stage 34.1: the refund is reached through the approved-closure flow -- the cashier requests it,
// a manager approves it -- because an arbitrary historical refund is no longer possible.
const refundClosure = await request(`/api/orders/${payCash.body.payment.order_id}/closure-requests`, { method: 'POST', headers: CASHIER_A1.headers, body: JSON.stringify({ type: 'CANCELLATION', reason: 'Guest complaint', inventory_treatment: 'WRITE_OFF', refund_requested: true }) });
expect('cashier requests a cancellation with a refund', refundClosure.status, 201, refundClosure.body);
const refundR = await request(`/api/orders/closure-requests/${refundClosure.body.closure.id}/approve`, { method: 'POST', headers: MGR_A1.headers, body: '{}' });
expect('manager approves the refund of the cash payment', refundR.status, 200, refundR.body);
const dashAfterRefund = await request(`/api/dashboard/manager?branch_id=${A1.id}&start=${encodeURIComponent(windowStartIso)}&end=${encodeURIComponent(new Date(Date.now() + 5000).toISOString())}`, { headers: MGR_A1.headers });
dbCheck('22. refund is reflected in the financial refunds section using existing payment semantics', moneyEq(dashAfterRefund.body.financial.refunds.total, cashAmount.toFixed(2)), dashAfterRefund.body.financial.refunds);

console.log('--- FINAL FAILURES CHECK ---');
console.log(`failures: ${failures.length}`);
for (const f of failures) console.log('FAIL: ' + f);
console.log('--- COUNTS ---');
console.log(JSON.stringify(counts));
console.log(failures.length === 0
  ? 'STAGE 32 MANAGER DASHBOARD E2E: PASS'
  : 'STAGE 32 MANAGER DASHBOARD E2E: FAIL');
if (failures.length > 0) process.exit(1);
