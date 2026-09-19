// BOOM OS -- Stage 34.10: fresh-DB E2E proof of the credit refinements.
//
// Proves: individual limits per account; a cashier issues within the limit and needs a manager to
// exceed it; repayment by CASH / CARD and by PAYROLL_DEDUCTION which needs explicit manager
// approval; a credit sale IS a sale but is NOT cash received, while a repayment is a cash inflow
// and NOT a new sale; staff credit reuses the existing employee identity with no duplicate profile;
// an ARCHIVED employee keeps their debt and their whole history; and the reports filter by branch,
// customer, employee, cashier, period and debtor status with a per-account drill-down.
//
// Requires an empty database. Usage: node tests/stage34_10_credit_refinements_e2e.mjs
const base = `http://127.0.0.1:${process.env.BOOM_OS_PORT || 3000}`;
const ownerPassword = process.env.STAGE3410_OWNER_PASSWORD || 'BoomStage3410Owner!';
const staffPassword = 'Stage3410StaffPass12345!';
const stamp = Date.now();

let counts = { runtime: 0, denials: 0, dbPost: 0 };
const failures = [];
async function request(path, options = {}) {
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
function ok(step, cond, detail) { if (!cond) failures.push(`${step}: FAILED ${detail !== undefined ? '-> ' + JSON.stringify(detail).slice(0, 320) : ''}`); }
function mustDeny(label, r) {
  if (r.status >= 200 && r.status < 300) failures.push(`${label} -- returned ${r.status} (expected denial): ${JSON.stringify(r.body).slice(0, 260)}`);
  else if (![400, 401, 403, 404, 409].includes(r.status)) failures.push(`${label} -- returned ${r.status}, not a recognized denial: ${JSON.stringify(r.body).slice(0, 260)}`);
  else counts.denials++;
}
function dbCheck(label, cond, detail) { counts.dbPost++; ok(`DB POST-CONDITION -- ${label}`, cond, detail); }
const money = v => Math.round(parseFloat(v) * 100);

const owner = await request('/api/auth/bootstrap', { method: 'POST', body: JSON.stringify({ full_name: 'S3410 Owner', email: `s3410owner-${stamp}@boom.local`, password: ownerPassword }) });
expect('bootstrap owner', owner.status, 201, owner.body);
const OWNER = { authorization: `Bearer ${owner.body.token}` };

async function makeFranchise(tag) {
  const f = await request('/api/franchises', { method: 'POST', headers: OWNER, body: JSON.stringify({ name: `S3410 F${tag}`, code: `SA${tag}${stamp % 100000}`, legal_name: `SA${tag} LLC`, contact_name: 'x', phone: `+9932611${tag}`, email: `sa${tag}-${stamp}@boom.local`, address: 'x' }) });
  expect(`create franchise ${tag}`, f.status, 201, f.body); return f.body.franchise.id;
}
async function makeBranch(tag, franchiseId) {
  const branch = await request('/api/branches', { method: 'POST', headers: OWNER, body: JSON.stringify({ name: `S3410 B${tag}`, code: `SA${tag}${stamp % 100000}`, address: 'x', phone: `+9932612${tag}`, franchise_id: franchiseId }) });
  expect(`branch ${tag}`, branch.status, 201, branch.body);
  const id = branch.body.branch.id;
  await request(`/api/franchises/${franchiseId}/branches/${id}`, { method: 'POST', headers: OWNER, body: '{}' });
  return { tag, id, franchiseId };
}
async function makeUser(label, branch, allowed, roles) {
  const email = `${label}-${stamp}@boom.local`.toLowerCase();
  const u = await request('/api/users', { method: 'POST', headers: OWNER, body: JSON.stringify({ full_name: `${label} Name`, email, phone: `+9942${Math.floor(Math.random() * 1000000)}`, password: staffPassword, branch_id: branch, roles, allowed_branches: allowed }) });
  expect(`create user ${label}`, u.status, 201, u.body);
  const login = await request('/api/auth/login', { method: 'POST', body: JSON.stringify({ login: email, password: staffPassword }) });
  expect(`login ${label}`, login.status, 200, login.body);
  return { label, email, id: u.body.user.id, headers: { authorization: `Bearer ${login.body.token}` } };
}

const FA = await makeFranchise('A');
const A1 = await makeBranch('A1', FA);
const A2 = await makeBranch('A2', FA);
const MGR = await makeUser('m3410a1', A1.id, [A1.id], ['BRANCH_MANAGER']);
const MGR_A2 = await makeUser('m3410a2', A2.id, [A2.id], ['BRANCH_MANAGER']);
const CASHIER = await makeUser('c3410a1', A1.id, [A1.id], ['CASHIER']);
const WAITER = await makeUser('w3410a1', A1.id, [A1.id], ['WAITER']);
const STAFF = await makeUser('s3410a1', A1.id, [A1.id], ['WAITER']);

expect('service charge to 0%', (await request(`/api/service-charge/${A1.id}`, { method: 'PUT', headers: MGR.headers, body: JSON.stringify({ percent: '0.00', categories: [] }) })).status, 201);
const cat = await request('/api/menu/categories', { method: 'POST', headers: MGR.headers, body: JSON.stringify({ branch_id: A1.id, name_ru: 'Cat', name_tk: 'Cat', sort_order: 0 }) });
const DISH = (await request('/api/menu/items', { method: 'POST', headers: MGR.headers, body: JSON.stringify({ branch_id: A1.id, category_id: cat.body.category.id, sku: `SA-${stamp}`, name_ru: 'Dish', name_tk: 'Dish', price: '100.00', sort_order: 0 }) })).body.item;
const area = await request('/api/tables/areas', { method: 'POST', headers: MGR.headers, body: JSON.stringify({ branch_id: A1.id, name: 'Hall', sort_order: 0 }) });
const tables = [];
for (let i = 0; i < 6; i++) tables.push((await request('/api/tables', { method: 'POST', headers: MGR.headers, body: JSON.stringify({ branch_id: A1.id, area_id: area.body.area.id, code: `TA${i}-${stamp % 10000}`, seats: 4 }) })).body.table);

expect('issue waiter code', (await request(`/api/waiters/${WAITER.id}/code`, { method: 'POST', headers: MGR.headers, body: JSON.stringify({ code: '9531' }) })).status, 201);
const wAuth = await request('/api/waiters/authenticate-code', { method: 'POST', body: JSON.stringify({ code: '9531', deviceId: 'sa-dev' }) });
const W = { 'x-waiter-session': wAuth.body.session.token };
const posToken = (await request('/api/operator-pos/unlock', { method: 'POST', headers: CASHIER.headers, body: JSON.stringify({ password: staffPassword, branch_id: A1.id, device_id: 'sa-cash' }) })).body.session_token;
expect('open shift', (await request('/api/cash-shifts', { method: 'POST', headers: CASHIER.headers, body: JSON.stringify({ branch_id: A1.id, opening_cash: '100.00' }) })).status, 201);

let tableIdx = 0;
async function readyOrder(qty) {
  const table = tables[tableIdx++ % tables.length];
  const o = await request('/api/orders', { method: 'POST', headers: { ...W, 'idempotency-key': `sa-${Date.now()}-${Math.random()}` }, body: JSON.stringify({ order_type: 'DINE_IN', source: 'POS', table_id: table.id, items: [{ menu_item_id: DISH.id, quantity: qty }] }) });
  const order = o.body.order;
  await request(`/api/orders/${order.id}/confirm`, { method: 'POST', headers: MGR.headers });
  const t = (await request(`/api/kds?branch_id=${A1.id}`, { headers: MGR.headers })).body.tickets.find(x => x.order_id === order.id);
  await request(`/api/kds/${t.id}/status`, { method: 'POST', headers: MGR.headers, body: JSON.stringify({ status: 'PREPARING' }) });
  await request(`/api/kds/${t.id}/status`, { method: 'POST', headers: MGR.headers, body: JSON.stringify({ status: 'READY' }) });
  return (await request(`/api/orders/${order.id}`, { headers: MGR.headers })).body.order;
}

// ================================================================== 1-3. ACCOUNTS + INDIVIDUAL LIMITS
const cust = (await request('/api/customers', { method: 'POST', headers: CASHIER.headers, body: JSON.stringify({ branch_id: A1.id, name: 'Credit Guest', phone: `+99370${stamp % 1000000}` }) })).body.customer;
const custAcct = await request('/api/credit/accounts', { method: 'POST', headers: CASHIER.headers, body: JSON.stringify({ branch_id: A1.id, type: 'CUSTOMER', customer_id: cust.id }) });
expect('1. open a customer credit account', custAcct.status, 201, custAcct.body);
const staffAcct = await request('/api/credit/accounts', { method: 'POST', headers: CASHIER.headers, body: JSON.stringify({ branch_id: A1.id, type: 'EMPLOYEE', employee_id: STAFF.id }) });
expect('1b. open a STAFF credit account against the existing employee', staffAcct.status, 201, staffAcct.body);
dbCheck('2. staff credit reuses the employee identity -- no duplicate customer profile was created', staffAcct.body.account.employee_id === STAFF.id && !staffAcct.body.account.customer_id && !(await request(`/api/customers?branch_id=${A1.id}&search=${encodeURIComponent('s3410a1')}`, { headers: MGR.headers })).body.customers.length, staffAcct.body.account);
const dupStaff = await request('/api/credit/accounts', { method: 'POST', headers: CASHIER.headers, body: JSON.stringify({ branch_id: A1.id, type: 'EMPLOYEE', employee_id: STAFF.id }) });
dbCheck('2b. a second account for the same employee returns the existing one', dupStaff.status === 200 && dupStaff.body.existed === true && dupStaff.body.account.id === staffAcct.body.account.id, dupStaff.body);

mustDeny('3. a cashier cannot set a limit', await request(`/api/credit/accounts/${custAcct.body.account.id}/limit`, { method: 'PUT', headers: CASHIER.headers, body: JSON.stringify({ credit_limit: '500.00' }) }));
expect('3b. the manager sets an INDIVIDUAL limit of 250.00 for the guest', (await request(`/api/credit/accounts/${custAcct.body.account.id}/limit`, { method: 'PUT', headers: MGR.headers, body: JSON.stringify({ credit_limit: '250.00' }) })).status, 200);
expect('3c. and a different individual limit of 150.00 for the employee', (await request(`/api/credit/accounts/${staffAcct.body.account.id}/limit`, { method: 'PUT', headers: MGR.headers, body: JSON.stringify({ credit_limit: '150.00' }) })).status, 200);
const custDetail = await request(`/api/credit/accounts/${custAcct.body.account.id}`, { headers: MGR.headers });
dbCheck('3d. available = limit - debt is reported explicitly', money(custDetail.body.available_credit) === 25000 && custDetail.body.over_limit === false, custDetail.body);

// ================================================================== 4-6. ISSUING WITHIN AND BEYOND THE LIMIT
const o1 = await readyOrder(2); // 200.00, inside the 250 limit
const sale1 = await request('/api/payments', { method: 'POST', headers: { ...CASHIER.headers, 'x-pos-session-token': posToken, 'idempotency-key': `sa-c1-${stamp}` }, body: JSON.stringify({ order_id: o1.id, method: 'CREDIT', amount: o1.final_amount, credit_account_id: custAcct.body.account.id }) });
expect('4. the cashier issues 200.00 of credit within the limit', sale1.status, 201, sale1.body);
const afterSale1 = await request(`/api/credit/accounts/${custAcct.body.account.id}`, { headers: MGR.headers });
dbCheck('4b. the debt is 200.00 and 50.00 remains available', money(afterSale1.body.account.current_balance) === 20000 && money(afterSale1.body.available_credit) === 5000, afterSale1.body);

const o2 = await readyOrder(1); // another 100.00 would breach the limit
const overLimit = await request('/api/payments', { method: 'POST', headers: { ...CASHIER.headers, 'x-pos-session-token': posToken, 'idempotency-key': `sa-c2-${stamp}` }, body: JSON.stringify({ order_id: o2.id, method: 'CREDIT', amount: o2.final_amount, credit_account_id: custAcct.body.account.id }) });
mustDeny('5. the CASHIER cannot exceed the individual limit', overLimit);
ok('5b. and the denial says so', overLimit.body?.code === 'CREDIT_LIMIT_EXCEEDED', overLimit.body);
const mgrPosToken = (await request('/api/operator-pos/unlock', { method: 'POST', headers: MGR.headers, body: JSON.stringify({ password: staffPassword, branch_id: A1.id, device_id: 'sa-mgr' }) })).body.session_token;
const approvedOver = await request('/api/payments', { method: 'POST', headers: { ...MGR.headers, ...(mgrPosToken ? { 'x-pos-session-token': mgrPosToken } : {}), 'idempotency-key': `sa-c3-${stamp}` }, body: JSON.stringify({ order_id: o2.id, method: 'CREDIT', amount: o2.final_amount, credit_account_id: custAcct.body.account.id }) });
expect('6. a MANAGER holding credit.manage_limit may approve it', approvedOver.status, 201, approvedOver.body);
const afterOver = await request(`/api/credit/accounts/${custAcct.body.account.id}`, { headers: MGR.headers });
dbCheck('6b. the debt is now 300.00, past the 250.00 limit, and is flagged as over limit', money(afterOver.body.account.current_balance) === 30000 && afterOver.body.over_limit === true && money(afterOver.body.available_credit) === -5000, afterOver.body);

// ================================================================== 7-9. A CREDIT SALE IS A SALE, NOT CASH
const shiftBefore = (await request(`/api/cash-shifts?branch_id=${A1.id}`, { headers: MGR.headers })).body.shifts.find(s => s.status === 'OPEN');
dbCheck('7. THE CORE RULE: a credit sale adds NOTHING to cash received', money(shiftBefore.cash_sales) === 0, shiftBefore);
const dash = await request(`/api/dashboard/manager?branch_id=${A1.id}`, { headers: MGR.headers });
dbCheck('7b. but it IS a sale: the order completed and counts as revenue', (await request(`/api/orders/${o1.id}`, { headers: MGR.headers })).body.order.status === 'COMPLETED', null);

const repayCash = await request('/api/credit/repay', { method: 'POST', headers: { ...CASHIER.headers, 'x-pos-session-token': posToken, 'idempotency-key': `sa-r1-${stamp}` }, body: JSON.stringify({ account_id: custAcct.body.account.id, method: 'CASH', amount: '120.00' }) });
expect('8. a partial CASH repayment of 120.00', repayCash.status, 201, repayCash.body);
const shiftAfterRepay = (await request(`/api/cash-shifts?branch_id=${A1.id}`, { headers: MGR.headers })).body.shifts.find(s => s.status === 'OPEN');
dbCheck('8b. THE OTHER HALF: a repayment IS a cash inflow, recorded separately from sales', money(shiftAfterRepay.credit_repayments) === 12000 && money(shiftAfterRepay.cash_sales) === 0, shiftAfterRepay);
const afterRepay = await request(`/api/credit/accounts/${custAcct.body.account.id}`, { headers: MGR.headers });
dbCheck('8c. and it is NOT a new sale -- it only reduces the debt to 180.00', money(afterRepay.body.account.current_balance) === 18000, afterRepay.body.account);
const repayCard = await request('/api/credit/repay', { method: 'POST', headers: { ...CASHIER.headers, 'x-pos-session-token': posToken, 'idempotency-key': `sa-r2-${stamp}` }, body: JSON.stringify({ account_id: custAcct.body.account.id, method: 'CARD', amount: '30.00' }) });
expect('9. a CARD repayment of 30.00', repayCard.status, 201, repayCard.body);
dbCheck('9b. the debt falls to 150.00', money((await request(`/api/credit/accounts/${custAcct.body.account.id}`, { headers: MGR.headers })).body.account.current_balance) === 15000, null);

// ================================================================== 10-11. PAYROLL DEDUCTION NEEDS A MANAGER
const o3 = await readyOrder(1);
expect('10. the employee takes 100.00 on staff credit', (await request('/api/payments', { method: 'POST', headers: { ...CASHIER.headers, 'x-pos-session-token': posToken, 'idempotency-key': `sa-s1-${stamp}` }, body: JSON.stringify({ order_id: o3.id, method: 'CREDIT', amount: o3.final_amount, credit_account_id: staffAcct.body.account.id }) })).status, 201);
const payrollByCashier = await request('/api/credit/repay', { method: 'POST', headers: { ...CASHIER.headers, 'x-pos-session-token': posToken, 'idempotency-key': `sa-p1-${stamp}` }, body: JSON.stringify({ account_id: staffAcct.body.account.id, method: 'PAYROLL_DEDUCTION', amount: '40.00' }) });
mustDeny('10b. a cashier cannot deduct it from payroll', payrollByCashier);
ok('10c. the denial names the required approval', payrollByCashier.body?.code === 'PAYROLL_DEDUCTION_REQUIRES_APPROVAL', payrollByCashier.body);
const payrollByMgr = await request('/api/credit/repay', { method: 'POST', headers: { ...MGR.headers, ...(mgrPosToken ? { 'x-pos-session-token': mgrPosToken } : {}), 'idempotency-key': `sa-p2-${stamp}` }, body: JSON.stringify({ account_id: staffAcct.body.account.id, method: 'PAYROLL_DEDUCTION', amount: '40.00' }) });
expect('11. a manager approves the payroll deduction', payrollByMgr.status, 201, payrollByMgr.body);
const staffAfter = await request(`/api/credit/accounts/${staffAcct.body.account.id}`, { headers: MGR.headers });
dbCheck('11b. the staff debt falls to 60.00 and the deduction is recorded with its approver', money(staffAfter.body.account.current_balance) === 6000 && staffAfter.body.transactions.some(t => t.type === 'PAYROLL_DEDUCTION' && t.approver_name), staffAfter.body.transactions.map(t => [t.type, t.amount, t.approver_name]));
const shiftAfterPayroll = (await request(`/api/cash-shifts?branch_id=${A1.id}`, { headers: MGR.headers })).body.shifts.find(s => s.status === 'OPEN');
dbCheck('11c. a payroll deduction is NOT a cash inflow -- the till is untouched by it', money(shiftAfterPayroll.credit_repayments) === 12000, shiftAfterPayroll);

// ================================================================== 12-13. ARCHIVED EMPLOYEE KEEPS THE DEBT
const archived = await request(`/api/users/${STAFF.id}`, { method: 'DELETE', headers: OWNER });
ok('12. the employee is archived', [200, 204].includes(archived.status), archived.body);
const staffReport = await request(`/api/credit/reports/staff?branch_id=${A1.id}`, { headers: MGR.headers });
const archivedRow = staffReport.body.staff.find(s => s.employee_id === STAFF.id);
dbCheck('12b. AN ARCHIVED EMPLOYEE KEEPS THEIR DEBT and is visibly archived, never silently dropped', archivedRow && money(archivedRow.current_balance) === 6000 && archivedRow.archived === true, archivedRow);
const archivedDetail = await request(`/api/credit/accounts/${staffAcct.body.account.id}`, { headers: MGR.headers });
dbCheck('13. and their whole history survives', archivedDetail.body.owner?.archived === true && archivedDetail.body.transactions.length >= 2, { owner: archivedDetail.body.owner, txs: archivedDetail.body.transactions.length });

// ================================================================== 14-17. REPORTS
const withDebt = await request(`/api/credit/reports/customers?branch_id=${A1.id}&status=WITH_DEBT`, { headers: MGR.headers });
dbCheck('14. the customer report filters by debtor status', withDebt.body.status === 'WITH_DEBT' && withDebt.body.customers.every(c => money(c.current_balance) > 0) && withDebt.body.customers.some(c => c.customer_id === cust.id), withDebt.body.customers.map(c => [c.name, c.current_balance]));
const settled = await request(`/api/credit/reports/customers?branch_id=${A1.id}&status=SETTLED`, { headers: MGR.headers });
dbCheck('14b. and SETTLED excludes the guest who still owes', !settled.body.customers.some(c => c.customer_id === cust.id), settled.body.customers.map(c => c.name));
const overLimitReport = await request(`/api/credit/reports/staff?branch_id=${A1.id}&status=OVER_LIMIT`, { headers: MGR.headers });
dbCheck('14c. OVER_LIMIT selects only accounts past their own individual limit', overLimitReport.body.staff.every(s => money(s.current_balance) > money(s.credit_limit)), overLimitReport.body.staff.map(s => [s.full_name, s.current_balance, s.credit_limit]));

const cashierReport = await request(`/api/credit/reports/cashier?branch_id=${A1.id}`, { headers: MGR.headers });
dbCheck('15. the cashier report attributes every movement to who took it and for whom', cashierReport.body.transactions.some(t => t.cashier_name && t.recipient_name), cashierReport.body.transactions.slice(0, 3).map(t => [t.type, t.cashier_name, t.recipient_name]));
const periodReport = await request(`/api/credit/reports/cashier?branch_id=${A1.id}&start=2100-01-01T00:00:00.000Z`, { headers: MGR.headers });
dbCheck('15b. and a period filter really narrows it', periodReport.body.transactions.length === 0, periodReport.body.transactions.length);

const branchReport = await request('/api/credit/reports/branch', { headers: OWNER });
const branchRow = branchReport.body.branches.find(x => x.branch_id === A1.id);
dbCheck('16. the branch report separates customer and staff receivables', branchRow && money(branchRow.customer_outstanding) === 15000 && money(branchRow.staff_outstanding) === 6000 && money(branchRow.outstanding) === 21000, branchRow);

const drill = await request(`/api/credit/accounts/${custAcct.body.account.id}?start=2000-01-01T00:00:00.000Z&end=2100-01-01T00:00:00.000Z`, { headers: MGR.headers });
dbCheck('17. the per-account drill-down is period-scoped and names the cashier of every movement', drill.body.transactions.length >= 4 && drill.body.transactions.every(t => t.cashier_name) && drill.body.period.start === '2000-01-01T00:00:00.000Z', drill.body.transactions.map(t => [t.type, t.amount, t.cashier_name]));

// ================================================================== 18. ISOLATION + AUDIT
mustDeny('18. branch isolation: a branch A2 manager cannot read branch A1 receivables', await request(`/api/credit/reports/customers?branch_id=${A1.id}`, { headers: MGR_A2.headers }));
mustDeny('18b. nor a branch A1 account', await request(`/api/credit/accounts/${custAcct.body.account.id}`, { headers: MGR_A2.headers }));
mustDeny('18c. nor change its limit', await request(`/api/credit/accounts/${custAcct.body.account.id}/limit`, { method: 'PUT', headers: MGR_A2.headers, body: JSON.stringify({ credit_limit: '9999.00' }) }));
const audit = (await request(`/api/audit?branch_id=${A1.id}&limit=400`, { headers: OWNER })).body.logs || [];
const actions = new Set(audit.map(a => a.action));
dbCheck('19. account creation, limit changes and repayments are all audited', ['CREDIT_ACCOUNT_CREATED', 'CREDIT_LIMIT_CHANGED'].every(a => actions.has(a)), [...actions].filter(a => a.startsWith('CREDIT')));

console.log(`\nStage 34.10 credit refinements E2E: ${counts.runtime} HTTP calls, ${counts.denials} denials, ${counts.dbPost} DB post-conditions`);
if (failures.length) { console.error(`\nFAILURES (${failures.length}):`); for (const f of failures) console.error(' - ' + f); process.exit(1); }
console.log('ALL STAGE 34.10 CREDIT CHECKS PASSED');
