// BOOM OS -- Stage 34.8: fresh-DB E2E proof of complimentary items ("ОТ ЗАВЕДЕНИЯ").
//
// Proves: a waiter or cashier may only REQUEST; exactly ONE authorised manager approves; only then
// does a REAL order line appear at a customer price of 0 (the bill does not grow); the real
// establishment cost is still recorded through the EXISTING recipe-consumption path; double
// approval is impossible; and the give-away report carries reason, employee, approver, customer,
// order, item, normal value, cost, branch and date.
//
// Requires an empty database. Usage: node tests/stage34_8_compliments_e2e.mjs
const base = `http://127.0.0.1:${process.env.BOOM_OS_PORT || 3000}`;
const ownerPassword = process.env.STAGE348_OWNER_PASSWORD || 'BoomStage348Owner!';
const staffPassword = 'Stage348StaffPass12345!';
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

const owner = await request('/api/auth/bootstrap', { method: 'POST', body: JSON.stringify({ full_name: 'S348 Owner', email: `s348owner-${stamp}@boom.local`, password: ownerPassword }) });
expect('bootstrap owner', owner.status, 201, owner.body);
const OWNER = { authorization: `Bearer ${owner.body.token}` };

async function makeFranchise(tag) {
  const f = await request('/api/franchises', { method: 'POST', headers: OWNER, body: JSON.stringify({ name: `S348 F${tag}`, code: `S348${tag}${stamp % 100000}`, legal_name: `S348${tag} LLC`, contact_name: 'x', phone: `+9932411${tag}`, email: `s348${tag}-${stamp}@boom.local`, address: 'x' }) });
  expect(`create franchise ${tag}`, f.status, 201, f.body); return f.body.franchise.id;
}
async function makeBranch(tag, franchiseId) {
  const branch = await request('/api/branches', { method: 'POST', headers: OWNER, body: JSON.stringify({ name: `S348 B${tag}`, code: `S348${tag}${stamp % 100000}`, address: 'x', phone: `+9932412${tag}`, franchise_id: franchiseId }) });
  expect(`branch ${tag}`, branch.status, 201, branch.body);
  const id = branch.body.branch.id;
  await request(`/api/franchises/${franchiseId}/branches/${id}`, { method: 'POST', headers: OWNER, body: '{}' });
  return { tag, id, franchiseId };
}
async function makeUser(label, branch, allowed, roles) {
  const email = `${label}-${stamp}@boom.local`.toLowerCase();
  const u = await request('/api/users', { method: 'POST', headers: OWNER, body: JSON.stringify({ full_name: `${label} Name`, email, phone: `+9940${Math.floor(Math.random() * 1000000)}`, password: staffPassword, branch_id: branch, roles, allowed_branches: allowed }) });
  expect(`create user ${label}`, u.status, 201, u.body);
  const login = await request('/api/auth/login', { method: 'POST', body: JSON.stringify({ login: email, password: staffPassword }) });
  expect(`login ${label}`, login.status, 200, login.body);
  return { label, email, id: u.body.user.id, headers: { authorization: `Bearer ${login.body.token}` } };
}

const FA = await makeFranchise('A');
const A1 = await makeBranch('A1', FA);
const A2 = await makeBranch('A2', FA);
const MGR = await makeUser('m348a1', A1.id, [A1.id], ['BRANCH_MANAGER']);
const MGR2 = await makeUser('m348a1b', A1.id, [A1.id], ['BRANCH_MANAGER']);
const MGR_A2 = await makeUser('m348a2', A2.id, [A2.id], ['BRANCH_MANAGER']);
const CASHIER = await makeUser('c348a1', A1.id, [A1.id], ['CASHIER']);
const WAITER = await makeUser('w348a1', A1.id, [A1.id], ['WAITER']);

expect('service charge to 0%', (await request(`/api/service-charge/${A1.id}`, { method: 'PUT', headers: MGR.headers, body: JSON.stringify({ percent: '0.00', categories: [] }) })).status, 201);
const cat = await request('/api/menu/categories', { method: 'POST', headers: MGR.headers, body: JSON.stringify({ branch_id: A1.id, name_ru: 'Cat', name_tk: 'Cat', sort_order: 0 }) });
const mk = async (sku, price) => (await request('/api/menu/items', { method: 'POST', headers: MGR.headers, body: JSON.stringify({ branch_id: A1.id, category_id: cat.body.category.id, sku, name_ru: sku, name_tk: sku, price, sort_order: 0 }) })).body.item;
const MAIN = await mk(`S348MAIN-${stamp}`, '300.00');
const DESSERT = await mk(`S348DESSERT-${stamp}`, '90.00');

// A real recipe on the complimentary dessert, so we can prove its ingredients are really consumed.
const choc = (await request('/api/inventory/items', { method: 'POST', headers: MGR.headers, body: JSON.stringify({ branch_id: A1.id, sku: `CHOC348-${stamp}`, name: 'Chocolate', unit: 'g', reorder_point: '10' }) })).body.item;
const supplier = (await request('/api/inventory/suppliers', { method: 'POST', headers: MGR.headers, body: JSON.stringify({ branch_id: A1.id, name: 'S348 Supplier' }) })).body.supplier;
const purchase = await request('/api/inventory/purchases', { method: 'POST', headers: MGR.headers, body: JSON.stringify({ branch_id: A1.id, supplier_id: supplier.id, items: [{ inventory_item_id: choc.id, quantity: '5000', unit_cost: '0.40' }] }) });
await request(`/api/inventory/purchases/${purchase.body.purchase.id}/receive`, { method: 'POST', headers: MGR.headers });
await request('/api/inventory/recipes', { method: 'POST', headers: MGR.headers, body: JSON.stringify({ branch_id: A1.id, menu_item_id: DESSERT.id, name: 'Dessert', yield_qty: '1', ingredients: [{ inventory_item_id: choc.id, quantity: '50' }] }) });

const area = await request('/api/tables/areas', { method: 'POST', headers: MGR.headers, body: JSON.stringify({ branch_id: A1.id, name: 'Hall', sort_order: 0 }) });
const tables = [];
for (let i = 0; i < 5; i++) tables.push((await request('/api/tables', { method: 'POST', headers: MGR.headers, body: JSON.stringify({ branch_id: A1.id, area_id: area.body.area.id, code: `T348${i}-${stamp % 10000}`, seats: 4 }) })).body.table);

expect('issue waiter code', (await request(`/api/waiters/${WAITER.id}/code`, { method: 'POST', headers: MGR.headers, body: JSON.stringify({ code: '9511' }) })).status, 201);
const wAuth = await request('/api/waiters/authenticate-code', { method: 'POST', body: JSON.stringify({ code: '9511', deviceId: 's348-dev' }) });
const W = { 'x-waiter-session': wAuth.body.session.token };
const posToken = (await request('/api/operator-pos/unlock', { method: 'POST', headers: CASHIER.headers, body: JSON.stringify({ password: staffPassword, branch_id: A1.id, device_id: 's348-cash' }) })).body.session_token;
expect('open shift', (await request('/api/cash-shifts', { method: 'POST', headers: CASHIER.headers, body: JSON.stringify({ branch_id: A1.id, opening_cash: '50.00' }) })).status, 201);
const guest = (await request('/api/customers', { method: 'POST', headers: MGR.headers, body: JSON.stringify({ branch_id: A1.id, name: 'Compliment Guest', phone: `+99368${stamp % 1000000}` }) })).body.customer;

let tableIdx = 0;
async function openOrder(customerId) {
  const table = tables[tableIdx++ % tables.length];
  const o = await request('/api/orders', { method: 'POST', headers: { ...W, 'idempotency-key': `s348-${Date.now()}-${Math.random()}` }, body: JSON.stringify({ order_type: 'DINE_IN', source: 'POS', table_id: table.id, items: [{ menu_item_id: MAIN.id, quantity: 1 }] }) });
  expect('create order', o.status, 201, o.body);
  if (customerId) await request(`/api/orders/${o.body.order.id}/customer`, { method: 'POST', headers: W, body: JSON.stringify({ customer_id: customerId }) });
  return o.body.order;
}
async function orderOf(id) { return (await request(`/api/orders/${id}`, { headers: MGR.headers })).body.order; }
async function stock() { return Number((await request(`/api/inventory/items?branch_id=${A1.id}`, { headers: MGR.headers })).body.items.find(i => i.id === choc.id).current_stock); }
async function makeReady(order) {
  await request(`/api/orders/${order.id}/confirm`, { method: 'POST', headers: MGR.headers });
  const t = (await request(`/api/kds?branch_id=${A1.id}`, { headers: MGR.headers })).body.tickets.find(x => x.order_id === order.id);
  await request(`/api/kds/${t.id}/status`, { method: 'POST', headers: MGR.headers, body: JSON.stringify({ status: 'PREPARING' }) });
  await request(`/api/kds/${t.id}/status`, { method: 'POST', headers: MGR.headers, body: JSON.stringify({ status: 'READY' }) });
}

// ================================================================== 1-4. THE REQUEST
const reasons = await request('/api/orders/compliment-reasons', { headers: MGR.headers });
dbCheck('1. all six business reasons are offered by the backend, not invented in the UI', reasons.body.reasons.join() === 'COMPLIMENT,APOLOGY,GIFT,ESTABLISHMENT_ERROR,BIRTHDAY,OTHER', reasons.body.reasons);

const order1 = await openOrder(guest.id);
dbCheck('1b. the order starts at 300.00', money(order1.final_amount) === 30000, order1);
mustDeny('2. an unrecognised reason is refused', await request(`/api/orders/${order1.id}/compliments`, { method: 'POST', headers: W, body: JSON.stringify({ menu_item_id: DESSERT.id, quantity: 1, reason: 'BECAUSE' }) }));
mustDeny('2b. a nonsense quantity is refused', await request(`/api/orders/${order1.id}/compliments`, { method: 'POST', headers: W, body: JSON.stringify({ menu_item_id: DESSERT.id, quantity: 0, reason: 'GIFT' }) }));
mustDeny('2c. an unknown menu item is refused', await request(`/api/orders/${order1.id}/compliments`, { method: 'POST', headers: W, body: JSON.stringify({ menu_item_id: 'menu_nope', quantity: 1, reason: 'GIFT' }) }));

const req1 = await request(`/api/orders/${order1.id}/compliments`, { method: 'POST', headers: W, body: JSON.stringify({ menu_item_id: DESSERT.id, quantity: 1, reason: 'APOLOGY', comment: 'Long wait' }) });
expect('3. the waiter requests a complimentary dessert', req1.status, 201, req1.body);
dbCheck('3b. it is PENDING, records the requesting role and snapshots the normal menu value', req1.body.compliment.status === 'PENDING' && req1.body.compliment.requester_role === 'WAITER' && req1.body.compliment.source === 'WAITER_POS' && money(req1.body.compliment.normal_value) === 9000, req1.body.compliment);
dbCheck('4. NOTHING is added to the order yet -- it is still 300.00 with one line', money((await orderOf(order1.id)).final_amount) === 30000 && (await orderOf(order1.id)).items.length === 1, await orderOf(order1.id));

// ================================================================== 5-7. ONE AUTHORISED APPROVAL
mustDeny('5. a cashier cannot approve', await request(`/api/orders/compliment-requests/${req1.body.compliment.id}/approve`, { method: 'POST', headers: CASHIER.headers, body: '{}' }));
mustDeny('5b. branch isolation: a branch A2 manager cannot approve a branch A1 request', await request(`/api/orders/compliment-requests/${req1.body.compliment.id}/approve`, { method: 'POST', headers: MGR_A2.headers, body: '{}' }));
mustDeny('5c. nor read the branch A1 queue', await request(`/api/orders/compliment-requests?branch_id=${A1.id}`, { headers: MGR_A2.headers }));
const queue = (await request(`/api/orders/compliment-requests?branch_id=${A1.id}`, { headers: MGR.headers })).body;
dbCheck('6. the manager queue shows the pending request with its dish and reason', queue.compliments.some(c => c.id === req1.body.compliment.id && c.menu_item_name && c.reason === 'APOLOGY'), queue.compliments.map(c => [c.reason, c.menu_item_name, c.status]));

const stockBefore = await stock();
const approve1 = await request(`/api/orders/compliment-requests/${req1.body.compliment.id}/approve`, { method: 'POST', headers: MGR.headers, body: JSON.stringify({ reason: 'Approved' }) });
expect('7. the manager approves', approve1.status, 200, approve1.body);
dbCheck('7b. only now does a REAL order line appear, at a customer price of 0', approve1.body.compliment.status === 'APPROVED' && approve1.body.compliment.order_item_id && approve1.body.compliment.approver_user_id === MGR.id, approve1.body.compliment);
const after1 = await orderOf(order1.id);
const line = after1.items.find(i => i.id === approve1.body.compliment.order_item_id);
dbCheck('7c. the guest pays nothing for it: the bill is still 300.00 although the order now has two lines', money(after1.final_amount) === 30000 && after1.items.length === 2 && money(line.price_snapshot) === 0 && money(line.subtotal) === 0, { final: after1.final_amount, lines: after1.items.length, line });
dbCheck('7d. no stock moved at approval time -- consumption belongs to the payment path', (await stock()) === stockBefore, { before: stockBefore, after: await stock() });

// ================================================================== 8-9. DOUBLE APPROVAL IS IMPOSSIBLE
mustDeny('8. the same request cannot be approved twice', await request(`/api/orders/compliment-requests/${req1.body.compliment.id}/approve`, { method: 'POST', headers: MGR2.headers, body: '{}' }));
mustDeny('8b. nor rejected after approval', await request(`/api/orders/compliment-requests/${req1.body.compliment.id}/reject`, { method: 'POST', headers: MGR2.headers, body: '{}' }));
const doubleAttempts = await Promise.all([
  request(`/api/orders/compliment-requests/${req1.body.compliment.id}/approve`, { method: 'POST', headers: MGR.headers, body: '{}' }),
  request(`/api/orders/compliment-requests/${req1.body.compliment.id}/approve`, { method: 'POST', headers: MGR2.headers, body: '{}' }),
]);
dbCheck('8c. even concurrent approvals produce no second line', doubleAttempts.every(r => r.status !== 200) && (await orderOf(order1.id)).items.length === 2, doubleAttempts.map(r => r.status));

const req2 = await request(`/api/orders/${order1.id}/compliments`, { method: 'POST', headers: MGR.headers, body: JSON.stringify({ menu_item_id: DESSERT.id, quantity: 1, reason: 'GIFT' }) });
expect('9. a manager may also raise a request', req2.status, 201, req2.body);
mustDeny('9b. but may not approve their own', await request(`/api/orders/compliment-requests/${req2.body.compliment.id}/approve`, { method: 'POST', headers: MGR.headers, body: '{}' }));
const reject2 = await request(`/api/orders/compliment-requests/${req2.body.compliment.id}/reject`, { method: 'POST', headers: MGR2.headers, body: JSON.stringify({ reason: 'Not warranted' }) });
expect('9c. a second manager rejects it', reject2.status, 200, reject2.body);
dbCheck('9d. a rejected request adds nothing to the order', reject2.body.compliment.status === 'REJECTED' && (await orderOf(order1.id)).items.length === 2, reject2.body.compliment);

// ================================================================== 10-12. REAL COST THROUGH THE EXISTING PATH
await makeReady(order1);
const readyOrder = await orderOf(order1.id);
const pay1 = await request('/api/payments', { method: 'POST', headers: { ...CASHIER.headers, 'x-pos-session-token': posToken, 'idempotency-key': `s348-pay1-${stamp}` }, body: JSON.stringify({ order_id: order1.id, method: 'CASH', amount: readyOrder.final_amount }) });
expect('10. the guest pays 300.00', pay1.status, 201, pay1.body);
dbCheck('10b. they paid only for what they ordered, not for the compliment', money(pay1.body.payment.amount) === 30000, pay1.body.payment);
dbCheck('11. the compliment consumed its REAL ingredients through the existing payment path: 50g', stockBefore - (await stock()) === 50, { before: stockBefore, after: await stock() });
const paidItems = (await orderOf(order1.id)).items;
const paidLine = paidItems.find(i => i.id === approve1.body.compliment.order_item_id);
dbCheck('12. THE CORE RULE: customer price 0, but the establishment cost IS recorded (50g x 0.40 = 20.00)', money(paidLine.price_snapshot) === 0 && Math.abs(Number(paidLine.recipe_cost_snapshot) - 20) < 0.01, paidLine);

// ================================================================== 13-15. THE REPORT
const report = (await request(`/api/orders/compliment-requests?branch_id=${A1.id}&status=APPROVED`, { headers: MGR.headers })).body;
const row = report.compliments.find(c => c.id === req1.body.compliment.id);
dbCheck('13. the give-away report carries reason, employee, approver, customer, order, item, normal value, cost and date',
  row && row.reason === 'APOLOGY' && row.requester_name && row.approver_name && row.customer_name === 'Compliment Guest' && row.order_number && row.menu_item_name && money(row.normal_value) === 9000 && Math.abs(Number(row.cost) - 20) < 0.01 && row.branch_id === A1.id && row.created_at, row);
dbCheck('13b. and it totals by reason', report.totals.some(t => t.reason === 'APOLOGY' && Number(t.count) === 1 && money(t.normal_value) === 9000), report.totals);
const rejected = (await request(`/api/orders/compliment-requests?branch_id=${A1.id}&status=REJECTED`, { headers: MGR.headers })).body;
dbCheck('14. rejected requests are kept, not deleted', rejected.compliments.some(c => c.id === req2.body.compliment.id && c.decision_reason === 'Not warranted'), rejected.compliments.map(c => [c.reason, c.status]));

const settledOrder = await orderOf(order1.id);
mustDeny('15. a settled order can no longer receive a compliment', await request(`/api/orders/${order1.id}/compliments`, { method: 'POST', headers: W, body: JSON.stringify({ menu_item_id: DESSERT.id, quantity: 1, reason: 'GIFT' }) }));
dbCheck('15b. and the settled order is exactly as it was paid', money(settledOrder.final_amount) === 30000 && settledOrder.items.length === 2, settledOrder);

// ================================================================== 16-17. STALE APPROVAL + AUDIT
const order2 = await openOrder(null);
const req3 = await request(`/api/orders/${order2.id}/compliments`, { method: 'POST', headers: CASHIER.headers, body: JSON.stringify({ menu_item_id: DESSERT.id, quantity: 2, reason: 'BIRTHDAY' }) });
expect('16. a cashier requests two complimentary desserts', req3.status, 201, req3.body);
dbCheck('16b. recorded against the cashier role and the cashier POS', req3.body.compliment.requester_role === 'CASHIER' && req3.body.compliment.source === 'CASHIER_POS' && money(req3.body.compliment.normal_value) === 18000, req3.body.compliment);
await makeReady(order2);
const o2Ready = await orderOf(order2.id);
await request('/api/payments', { method: 'POST', headers: { ...CASHIER.headers, 'x-pos-session-token': posToken, 'idempotency-key': `s348-pay2-${stamp}` }, body: JSON.stringify({ order_id: order2.id, method: 'CASH', amount: o2Ready.final_amount }) });
mustDeny('16c. approving after the order was settled is refused -- an old receipt can never change', await request(`/api/orders/compliment-requests/${req3.body.compliment.id}/approve`, { method: 'POST', headers: MGR.headers, body: '{}' }));

const audit = (await request(`/api/audit?branch_id=${A1.id}&limit=400`, { headers: OWNER })).body.logs || [];
const actions = new Set(audit.map(a => a.action));
dbCheck('17. request, approval and rejection are all audited', ['COMPLIMENT_REQUESTED', 'COMPLIMENT_APPROVED', 'COMPLIMENT_REJECTED'].every(a => actions.has(a)), [...actions].filter(a => a.startsWith('COMPLIMENT')));
const approveAudit = audit.find(a => a.action === 'COMPLIMENT_APPROVED' && a.entity_id === req1.body.compliment.id);
dbCheck('17b. the approval audit records the approver, the reason and that the customer price is zero', approveAudit && JSON.stringify(approveAudit.new_values).includes('APOLOGY') && JSON.stringify(approveAudit.new_values).includes('"customer_price":"0.00"'), approveAudit?.new_values);

console.log(`\nStage 34.8 compliments E2E: ${counts.runtime} HTTP calls, ${counts.denials} denials, ${counts.dbPost} DB post-conditions`);
if (failures.length) { console.error(`\nFAILURES (${failures.length}):`); for (const f of failures) console.error(' - ' + f); process.exit(1); }
console.log('ALL STAGE 34.8 COMPLIMENT CHECKS PASSED');
