// BOOM OS -- Stage 31: fresh-DB E2E proof of Credit Mode (receivables), exercising the real
// backend endpoints: customer credit, staff credit, credit sale settling through the EXISTING
// payment path, partial/full repayment, payroll deduction, over-limit RBAC gate, idempotency,
// branch isolation, and the receivables reports.
//
// Requires an empty database. Usage: node tests/stage31_credit_mode_e2e.mjs
import assert from 'node:assert/strict';

const base = `http://127.0.0.1:${process.env.BOOM_OS_PORT || 3000}`;
const ownerPassword = process.env.STAGE31_OWNER_PASSWORD || 'BoomStage31Owner!';
const staffPassword = 'Stage31StaffPass12345!';
const stamp = Date.now();

let counts = { runtime: 0, denials: 0, controls: 0, dbPost: 0 };
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
const owner = await request('/api/auth/bootstrap', { method: 'POST', body: JSON.stringify({ full_name: 'S31 Owner', email: `s31owner-${stamp}@boom.local`, password: ownerPassword }) });
expect('bootstrap owner', owner.status, 201, owner.body);
const OWNER = { authorization: `Bearer ${owner.body.token}` };

async function makeFranchise(tag) {
  const f = await request('/api/franchises', { method: 'POST', headers: OWNER, body: JSON.stringify({ name: `S31 F${tag}`, code: `S31${tag}${stamp % 100000}`, legal_name: `S31${tag} LLC`, contact_name: 'x', phone: `+9931699${tag}`, email: `s31${tag}-${stamp}@boom.local`, address: 'x' }) });
  expect(`create franchise ${tag}`, f.status, 201, f.body);
  return f.body.franchise.id;
}
async function makeBranch(tag, franchiseId) {
  const branch = await request('/api/branches', { method: 'POST', headers: OWNER, body: JSON.stringify({ name: `S31 B${tag}`, code: `S31${tag}${stamp % 100000}`, address: 'x', phone: `+9931609${tag}`, franchise_id: franchiseId }) });
  expect(`branch ${tag}`, branch.status, 201, branch.body);
  const id = branch.body.branch.id;
  await request(`/api/franchises/${franchiseId}/branches/${id}`, { method: 'POST', headers: OWNER, body: '{}' });
  return { tag, id, franchiseId };
}
async function makeUser(label, branch, allowed, roles) {
  const email = `${label}-${stamp}@boom.local`.toLowerCase();
  const u = await request('/api/users', { method: 'POST', headers: OWNER, body: JSON.stringify({ full_name: `${label} Name`, email, phone: `+9938${Math.floor(Math.random() * 100000)}`, password: staffPassword, branch_id: branch, roles, allowed_branches: allowed }) });
  expect(`create user ${label}`, u.status, 201, u.body);
  const login = await request('/api/auth/login', { method: 'POST', body: JSON.stringify({ login: email, password: staffPassword }) });
  expect(`login ${label}`, login.status, 200, login.body);
  return { label, email, id: u.body.user.id, headers: { authorization: `Bearer ${login.body.token}` } };
}

const FA = await makeFranchise('A');
const A1 = await makeBranch('A1', FA);
const A2 = await makeBranch('A2', FA);
const CASHIER_A1 = await makeUser('cashA1', A1.id, [A1.id], ['CASHIER']);
const MGR_A1 = await makeUser('mgrA1', A1.id, [A1.id], ['BRANCH_MANAGER']);
const MGR_A2 = await makeUser('mgrA2', A2.id, [A2.id], ['BRANCH_MANAGER']);
const STAFF_EMP = await makeUser('empA1', A1.id, [A1.id], ['WAITER']);

console.log(`Setup: FA=${FA} A1=${A1.id} A2=${A2.id}`);

// menu / table / waiter / order plumbing (reused exactly as Stage 29 built it)
const cat = await request('/api/menu/categories', { method: 'POST', headers: MGR_A1.headers, body: JSON.stringify({ branch_id: A1.id, name_ru: 'Cat', name_tk: 'Cat', sort_order: 0 }) });
const item = (await request('/api/menu/items', { method: 'POST', headers: MGR_A1.headers, body: JSON.stringify({ branch_id: A1.id, category_id: cat.body.category.id, sku: `SKU31-${stamp}`, name_ru: 'Burger', name_tk: 'Burger', price: '30.00', sort_order: 0 }) })).body.item;
const areaR = await request('/api/tables/areas', { method: 'POST', headers: MGR_A1.headers, body: JSON.stringify({ branch_id: A1.id, name: 'Hall', sort_order: 0 }) });
const tableR = await request('/api/tables', { method: 'POST', headers: MGR_A1.headers, body: JSON.stringify({ branch_id: A1.id, area_id: areaR.body.area.id, code: `T31-${stamp % 10000}`, seats: 4 }) });
const waiterUser = await makeUser('waitA1', A1.id, [A1.id], ['WAITER']);
const codeR = await request(`/api/waiters/${waiterUser.id}/code`, { method: 'POST', headers: MGR_A1.headers, body: JSON.stringify({ code: '9131' }) });
expect('issue waiter code', codeR.status, 201, codeR.body);
const waiterAuth = await request('/api/waiters/authenticate-code', { method: 'POST', body: JSON.stringify({ code: '9131', deviceId: 's31-device' }) });
expect('waiter authenticate', waiterAuth.status, 200, waiterAuth.body);
const W1 = { headers: { 'x-waiter-session': waiterAuth.body.session.token } };

async function makeReadyOrder(qty = 1) {
  const orderR = await request('/api/orders', { method: 'POST', headers: { ...W1.headers, 'idempotency-key': `s31-order-${Date.now()}-${Math.random()}` }, body: JSON.stringify({ order_type: 'DINE_IN', source: 'POS', table_id: tableR.body.table.id, items: [{ menu_item_id: item.id, quantity: qty }] }) });
  expect('create order', orderR.status, 201, orderR.body);
  const order = orderR.body.order;
  await request(`/api/orders/${order.id}/confirm`, { method: 'POST', headers: MGR_A1.headers });
  const ticket = (await request(`/api/kds?branch_id=${A1.id}&status=NEW`, { headers: MGR_A1.headers })).body.tickets.find(t => t.order_id === order.id);
  await request(`/api/kds/${ticket.id}/status`, { method: 'POST', headers: MGR_A1.headers, body: JSON.stringify({ status: 'PREPARING' }) });
  await request(`/api/kds/${ticket.id}/status`, { method: 'POST', headers: MGR_A1.headers, body: JSON.stringify({ status: 'READY' }) });
  return (await request(`/api/orders/${order.id}`, { headers: MGR_A1.headers })).body.order;
}

const unlockR = await request('/api/operator-pos/unlock', { method: 'POST', headers: CASHIER_A1.headers, body: JSON.stringify({ password: staffPassword, branch_id: A1.id, device_id: 's31-cashier-device' }) });
expect('CASHIER POS unlock', unlockR.status, 200, unlockR.body);
const posToken = unlockR.body.session_token;
const shiftBefore = (await request(`/api/cash-shifts/current?branch_id=${A1.id}`, { headers: MGR_A1.headers })).body.shift;
let shiftR;
if (shiftBefore) shiftR = { status: 201, body: { shift: shiftBefore } };
else shiftR = await request('/api/cash-shifts', { method: 'POST', headers: MGR_A1.headers, body: JSON.stringify({ branch_id: A1.id, opening_cash: '50.00' }) });
expect('open shift', shiftR.status, 201, shiftR.body);
const shiftId = shiftR.body.shift.id;

// ================================================================== 1. CUSTOMER CREDIT: create + get-or-create idempotent
const custPhone = `+99361${stamp % 1000000}`;
const custR1 = await request('/api/credit/customers', { method: 'POST', headers: CASHIER_A1.headers, body: JSON.stringify({ branch_id: A1.id, name: 'Aynur Customer', phone: custPhone }) });
expect('1. cashier creates customer', custR1.status, 201, custR1.body);
const customer = custR1.body.customer;
const custR2 = await request('/api/credit/customers', { method: 'POST', headers: CASHIER_A1.headers, body: JSON.stringify({ branch_id: A1.id, name: 'Aynur Customer', phone: custPhone }) });
expect('customer create is get-or-create (same phone -> existed)', custR2.status, 200, custR2.body);
dbCheck('no duplicate customer row for same phone', custR2.body.customer.id === customer.id, custR2.body);

// 2. Create the credit account -- defaults to a ZERO limit until a manager sets it
const acctR = await request('/api/credit/accounts', { method: 'POST', headers: CASHIER_A1.headers, body: JSON.stringify({ branch_id: A1.id, type: 'CUSTOMER', customer_id: customer.id }) });
expect('2. cashier creates the credit account (default limit 0)', acctR.status, 201, acctR.body);
const custAccountId = acctR.body.account.id;
dbCheck('new credit account starts at limit=0, balance=0', moneyEq(acctR.body.account.credit_limit, '0.00') && moneyEq(acctR.body.account.current_balance, '0.00'), acctR.body.account);

// 3. RBAC: cashier CANNOT set a credit limit; manager CAN.
mustDenyAuth('3a. cashier cannot change credit limit', await request(`/api/credit/accounts/${custAccountId}/limit`, { method: 'PUT', headers: CASHIER_A1.headers, body: JSON.stringify({ credit_limit: '500.00' }) }));
const limitR = await request(`/api/credit/accounts/${custAccountId}/limit`, { method: 'PUT', headers: MGR_A1.headers, body: JSON.stringify({ credit_limit: '100.00' }) });
expect('3b. manager sets credit limit', limitR.status, 200, limitR.body);
dbCheck('credit limit persisted', moneyEq(limitR.body.account.credit_limit, '100.00'), limitR.body.account);

// ================================================================== 4. CREDIT SALE settles through the EXISTING payment path
const orderCredit = await makeReadyOrder(2); // 2 x 30.00 = 60.00
const payIdem = `s31-credit-pay-${stamp}`;
const creditPayR = await request('/api/payments', { method: 'POST', headers: { ...CASHIER_A1.headers, 'x-pos-session-token': posToken, 'idempotency-key': payIdem }, body: JSON.stringify({ order_id: orderCredit.id, method: 'CREDIT', amount: orderCredit.final_amount, credit_account_id: custAccountId }) });
expect('4. credit sale succeeds within limit', creditPayR.status, 201, creditPayR.body);
const creditPayment = creditPayR.body.payment;
dbCheck('payment.method = CREDIT', creditPayment.method === 'CREDIT', creditPayment);
dbCheck('order settles COMPLETED exactly like a cash sale (same order-core path)', (await request(`/api/orders/${orderCredit.id}`, { headers: MGR_A1.headers })).body.order.status === 'COMPLETED', null);
let acctAfterSale = (await request(`/api/credit/accounts/${custAccountId}`, { headers: MGR_A1.headers })).body;
dbCheck('receivable increased by the sale amount', moneyEq(acctAfterSale.account.current_balance, orderCredit.final_amount), acctAfterSale.account);
const shiftAfterCredit = (await request(`/api/cash-shifts/current?branch_id=${A1.id}`, { headers: MGR_A1.headers })).body.shift;
dbCheck('a credit sale is NOT cash received (cash_sales unchanged)', moneyEq(shiftAfterCredit.cash_sales, shiftBefore?.cash_sales || '0.00'), { before: shiftBefore?.cash_sales, after: shiftAfterCredit.cash_sales });
const reportAfterSale1 = (await request(`/api/credit/reports/overview?branch_id=${A1.id}`, { headers: MGR_A1.headers })).body;
dbCheck('credit sale counts as an issued credit in reports (real sale, tracked)', reportAfterSale1.credits_issued >= 1 && moneyEq(reportAfterSale1.amount_issued, orderCredit.final_amount), reportAfterSale1);

// idempotent credit sale: replay must not double the receivable
const creditPayReplay = await request('/api/payments', { method: 'POST', headers: { ...CASHIER_A1.headers, 'x-pos-session-token': posToken, 'idempotency-key': payIdem }, body: JSON.stringify({ order_id: orderCredit.id, method: 'CREDIT', amount: orderCredit.final_amount, credit_account_id: custAccountId }) });
expect('idempotent credit sale replay', creditPayReplay.status, 200, creditPayReplay.body);
const acctAfterReplay = (await request(`/api/credit/accounts/${custAccountId}`, { headers: MGR_A1.headers })).body.account;
dbCheck('replayed credit sale did not double the receivable', moneyEq(acctAfterReplay.current_balance, orderCredit.final_amount), acctAfterReplay);

// ================================================================== 5. OVER-LIMIT: cashier blocked, manager can push it through
const orderOverLimit = await makeReadyOrder(2); // another 60.00, remaining available = 40.00 (limit 100 - balance 60)
const overIdem = `s31-over-${stamp}`;
const overLimitR = await request('/api/payments', { method: 'POST', headers: { ...CASHIER_A1.headers, 'x-pos-session-token': posToken, 'idempotency-key': overIdem }, body: JSON.stringify({ order_id: orderOverLimit.id, method: 'CREDIT', amount: orderOverLimit.final_amount, credit_account_id: custAccountId }) });
expect('5a. cashier blocked from exceeding the credit limit', overLimitR.status, 409, overLimitR.body);
dbCheck('CREDIT_LIMIT_EXCEEDED error code', overLimitR.body?.code === 'CREDIT_LIMIT_EXCEEDED', overLimitR.body);
dbCheck('order NOT completed after the blocked over-limit attempt', (await request(`/api/orders/${orderOverLimit.id}`, { headers: MGR_A1.headers })).body.order.status !== 'COMPLETED', null);
// Manager is not CASHIER role, so requireOperatorPosSession bypasses regardless of POS token.
const overLimitByMgr = await request('/api/payments', { method: 'POST', headers: { ...MGR_A1.headers, 'idempotency-key': overIdem }, body: JSON.stringify({ order_id: orderOverLimit.id, method: 'CREDIT', amount: orderOverLimit.final_amount, credit_account_id: custAccountId }) });
expect('5b. manager (credit.manage_limit) can push the over-limit sale through', overLimitByMgr.status, 201, overLimitByMgr.body);
const acctAfterOverLimit = (await request(`/api/credit/accounts/${custAccountId}`, { headers: MGR_A1.headers })).body.account;
dbCheck('over-limit sale still recorded the full receivable (real debt, not capped)', moneyEq(acctAfterOverLimit.current_balance, String(Number(orderCredit.final_amount) + Number(orderOverLimit.final_amount))), acctAfterOverLimit);

// ================================================================== 6/7. PARTIAL + FULL REPAYMENT (not a sale)
const totalDebt = Number(acctAfterOverLimit.current_balance);
const partial = (totalDebt / 2).toFixed(2);
const repayIdem1 = `s31-repay1-${stamp}`;
const repay1 = await request('/api/credit/repay', { method: 'POST', headers: { ...CASHIER_A1.headers, 'x-pos-session-token': posToken, 'idempotency-key': repayIdem1 }, body: JSON.stringify({ account_id: custAccountId, amount: partial, method: 'CASH', branch_id: A1.id }) });
expect('6. partial repayment accepted', repay1.status, 201, repay1.body);
const acctAfterPartial = (await request(`/api/credit/accounts/${custAccountId}`, { headers: MGR_A1.headers })).body.account;
dbCheck('receivable decreased by exactly the partial amount', moneyEq(acctAfterPartial.current_balance, String(totalDebt - Number(partial))), acctAfterPartial);
const shiftAfterRepay1 = (await request(`/api/cash-shifts/current?branch_id=${A1.id}`, { headers: MGR_A1.headers })).body.shift;
dbCheck('CASH repayment did NOT count as cash_sales (not a sale)', moneyEq(shiftAfterRepay1.cash_sales, shiftAfterCredit.cash_sales), { before: shiftAfterCredit.cash_sales, after: shiftAfterRepay1.cash_sales });
dbCheck('CASH repayment increased credit_repayments (separate reconciliation)', moneyEq(shiftAfterRepay1.credit_repayments, partial), shiftAfterRepay1);

const remaining = (totalDebt - Number(partial)).toFixed(2);
const repayIdem2 = `s31-repay2-${stamp}`;
const repay2 = await request('/api/credit/repay', { method: 'POST', headers: { ...CASHIER_A1.headers, 'x-pos-session-token': posToken, 'idempotency-key': repayIdem2 }, body: JSON.stringify({ account_id: custAccountId, amount: remaining, method: 'CASH', branch_id: A1.id }) });
expect('7. full repayment of the remainder accepted', repay2.status, 201, repay2.body);
const acctAfterFull = (await request(`/api/credit/accounts/${custAccountId}`, { headers: MGR_A1.headers })).body.account;
dbCheck('receivable fully cleared to zero', moneyEq(acctAfterFull.current_balance, '0.00'), acctAfterFull);

// idempotent repayment: replay must not double-decrement (would go negative if it did)
const repay1Replay = await request('/api/credit/repay', { method: 'POST', headers: { ...CASHIER_A1.headers, 'x-pos-session-token': posToken, 'idempotency-key': repayIdem1 }, body: JSON.stringify({ account_id: custAccountId, amount: partial, method: 'CASH', branch_id: A1.id }) });
expect('idempotent repayment replay', repay1Replay.status, 200, repay1Replay.body);
const acctAfterReplayRepay = (await request(`/api/credit/accounts/${custAccountId}`, { headers: MGR_A1.headers })).body.account;
dbCheck('balance still exactly zero after the repayment replay (no negative balance, no double-decrement)', moneyEq(acctAfterReplayRepay.current_balance, '0.00'), acctAfterReplayRepay);

// 10. no negative balance: repaying more than the (zero) balance is rejected
const overRepay = await request('/api/credit/repay', { method: 'POST', headers: { ...CASHIER_A1.headers, 'x-pos-session-token': posToken, 'idempotency-key': `s31-overrepay-${stamp}` }, body: JSON.stringify({ account_id: custAccountId, amount: '10.00', method: 'CASH', branch_id: A1.id }) });
expect('10. repayment exceeding the balance is rejected', overRepay.status, 409, overRepay.body);
dbCheck('REPAYMENT_EXCEEDS_BALANCE error code', overRepay.body?.code === 'REPAYMENT_EXCEEDS_BALANCE', overRepay.body);

// ================================================================== 11. STAFF CREDIT (existing employee identity reused)
const empAcctR = await request('/api/credit/accounts', { method: 'POST', headers: CASHIER_A1.headers, body: JSON.stringify({ branch_id: A1.id, type: 'EMPLOYEE', employee_id: STAFF_EMP.id }) });
expect('11a. cashier creates a staff credit account against an existing employee', empAcctR.status, 201, empAcctR.body);
const empAccountId = empAcctR.body.account.id;
await request(`/api/credit/accounts/${empAccountId}/limit`, { method: 'PUT', headers: MGR_A1.headers, body: JSON.stringify({ credit_limit: '200.00' }) });
const staffOrder = await makeReadyOrder(1); // 30.00
const staffPayR = await request('/api/payments', { method: 'POST', headers: { ...CASHIER_A1.headers, 'x-pos-session-token': posToken, 'idempotency-key': `s31-staff-pay-${stamp}` }, body: JSON.stringify({ order_id: staffOrder.id, method: 'CREDIT', amount: staffOrder.final_amount, credit_account_id: empAccountId }) });
expect('11b. staff credit sale succeeds', staffPayR.status, 201, staffPayR.body);
dbCheck('staff receivable increased', moneyEq((await request(`/api/credit/accounts/${empAccountId}`, { headers: MGR_A1.headers })).body.account.current_balance, staffOrder.final_amount), null);

// 12. Payroll deduction: cashier cannot submit it; manager can, and it is recorded as approved
const payrollDeniedR = await request('/api/credit/repay', { method: 'POST', headers: { ...CASHIER_A1.headers, 'x-pos-session-token': posToken, 'idempotency-key': `s31-payroll-denied-${stamp}` }, body: JSON.stringify({ account_id: empAccountId, amount: '10.00', method: 'PAYROLL_DEDUCTION', branch_id: A1.id }) });
expect('12a. cashier cannot submit a payroll deduction', payrollDeniedR.status, 403, payrollDeniedR.body);
dbCheck('PAYROLL_DEDUCTION_REQUIRES_APPROVAL error code', payrollDeniedR.body?.code === 'PAYROLL_DEDUCTION_REQUIRES_APPROVAL', payrollDeniedR.body);
const payrollOkR = await request('/api/credit/repay', { method: 'POST', headers: { ...MGR_A1.headers, 'idempotency-key': `s31-payroll-ok-${stamp}` }, body: JSON.stringify({ account_id: empAccountId, amount: staffOrder.final_amount, method: 'PAYROLL_DEDUCTION', branch_id: A1.id }) });
expect('12b. manager can submit and self-approve a payroll deduction', payrollOkR.status, 201, payrollOkR.body);
dbCheck('payroll deduction recorded an approver', !!payrollOkR.body?.transaction?.approved_by, payrollOkR.body);
dbCheck('staff debt cleared by the payroll deduction', moneyEq((await request(`/api/credit/accounts/${empAccountId}`, { headers: MGR_A1.headers })).body.account.current_balance, '0.00'), null);

// archived employee retains credit history (soft status change, not a hard delete)
const archiveR = await request(`/api/users/${STAFF_EMP.id}/status`, { method: 'PUT', headers: MGR_A1.headers, body: JSON.stringify({ employment_status: 'TERMINATED', reason: 'test archival' }) });
expect('archive the staff employee', archiveR.status, 200, archiveR.body);
const empAccountAfterArchive = await request(`/api/credit/accounts/${empAccountId}`, { headers: MGR_A1.headers });
dbCheck('archived employee credit account and history are still readable', empAccountAfterArchive.status === 200 && empAccountAfterArchive.body.transactions.length >= 2, empAccountAfterArchive.body);

// ================================================================== 13/14. SECURITY: cross-branch + unauthorized adjustment
mustDenyAuth('13a. cross-branch: MGR_A2 cannot view the A1 credit account', await request(`/api/credit/accounts/${custAccountId}`, { headers: MGR_A2.headers }));
mustDenyAuth('13b. cross-branch: MGR_A2 cannot change the A1 credit limit', await request(`/api/credit/accounts/${custAccountId}/limit`, { method: 'PUT', headers: MGR_A2.headers, body: JSON.stringify({ credit_limit: '999.00' }) }));
mustDenyAuth('14. unauthorized (cashier) balance adjustment denied', await request(`/api/credit/accounts/${custAccountId}/adjust`, { method: 'POST', headers: CASHIER_A1.headers, body: JSON.stringify({ amount: '-5.00', note: 'test' }) }));
const adjustR = await request(`/api/credit/accounts/${custAccountId}/adjust`, { method: 'POST', headers: MGR_A1.headers, body: JSON.stringify({ amount: '5.00', note: 'manual correction' }) });
expect('manager CAN post a manual adjustment (audited)', adjustR.status, 201, adjustR.body);
dbCheck('adjustment moved the balance by exactly the signed amount', moneyEq(adjustR.body.account.current_balance, '5.00'), adjustR.body.account);

// ================================================================== 16. REPORTS (overview / customers / staff / branch / cashier / drill-down)
const ov = await request(`/api/credit/reports/overview?branch_id=${A1.id}`, { headers: MGR_A1.headers });
expect('reports: overview', ov.status, 200, ov.body);
const custReport = await request(`/api/credit/reports/customers?branch_id=${A1.id}`, { headers: MGR_A1.headers });
expect('reports: customers', custReport.status, 200, custReport.body);
dbCheck('customer report includes our test customer', custReport.body.customers.some(c => c.customer_id === customer.id), null);
const staffReport = await request(`/api/credit/reports/staff?branch_id=${A1.id}`, { headers: MGR_A1.headers });
expect('reports: staff', staffReport.status, 200, staffReport.body);
dbCheck('staff report includes our test employee', staffReport.body.staff.some(s => s.employee_id === STAFF_EMP.id), null);
const branchReport = await request('/api/credit/reports/branch', { headers: MGR_A1.headers });
expect('reports: branch (scoped to allowed branches)', branchReport.status, 200, branchReport.body);
dbCheck('branch report is isolated to allowed branches only', branchReport.body.branches.every(b => b.branch_id === A1.id), branchReport.body);
const cashierReport = await request(`/api/credit/reports/cashier?branch_id=${A1.id}`, { headers: MGR_A1.headers });
expect('reports: cashier activity', cashierReport.status, 200, cashierReport.body);
dbCheck('cashier report includes our cashier', cashierReport.body.transactions.some(t => t.cashier_id === CASHIER_A1.id), null);
const drillDown = await request(`/api/credit/transactions?branch_id=${A1.id}&account_id=${custAccountId}`, { headers: MGR_A1.headers });
expect('reports: drill-down transaction list for one account', drillDown.status, 200, drillDown.body);
dbCheck('drill-down shows CREDIT, REPAYMENT and ADJUSTMENT rows for the account', ['CREDIT', 'REPAYMENT', 'ADJUSTMENT'].every(t => drillDown.body.transactions.some(x => x.type === t)), drillDown.body.transactions.map(x => x.type));
mustDenyAuth('reports are gated by credit.reports (cashier lacks it)', await request(`/api/credit/reports/overview?branch_id=${A1.id}`, { headers: CASHIER_A1.headers }));

// ================================================================== 17. RECEIPT DATA: enough for the receipt to show customer/debt
const receiptSourceOrder = (await request(`/api/orders/${orderCredit.id}`, { headers: CASHIER_A1.headers })).body.order;
const receiptSourceAccount = (await request(`/api/credit/accounts/${custAccountId}`, { headers: CASHIER_A1.headers })).body;
ok('receipt has real order total (not invented)', !!receiptSourceOrder.final_amount, receiptSourceOrder);
ok('receipt has real customer name/phone and outstanding balance for a CREDIT receipt', !!receiptSourceAccount.owner?.name && !!receiptSourceAccount.owner?.phone && receiptSourceAccount.account.current_balance !== undefined, receiptSourceAccount);

console.log('--- FINAL FAILURES CHECK ---');
console.log(`failures: ${failures.length}`);
for (const f of failures) console.log('FAIL: ' + f);
console.log('--- COUNTS ---');
console.log(JSON.stringify(counts));
console.log(failures.length === 0
  ? 'STAGE 31 CREDIT MODE E2E: PASS'
  : 'STAGE 31 CREDIT MODE E2E: FAIL');
if (failures.length > 0) process.exit(1);
