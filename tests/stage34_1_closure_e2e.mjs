// BOOM OS -- Stage 34.1: fresh-DB E2E proof that REFUNDING MONEY IS NOT RETURNING INGREDIENTS.
//
// Proves the controlled REQUEST -> MANAGER APPROVAL -> (independent) INVENTORY DECISION +
// FINANCIAL REFUND flow: a waiter may raise a cancellation but never finalise it, the product
// decision is always explicitly chosen and never guessed, produced food is written off as a
// production loss instead of being restored, an arbitrary historical refund is impossible, and
// an order is never physically deleted.
//
// Requires an empty database. Usage: node tests/stage34_1_closure_e2e.mjs
const base = `http://127.0.0.1:${process.env.BOOM_OS_PORT || 3000}`;
const ownerPassword = process.env.STAGE341_OWNER_PASSWORD || 'BoomStage341Owner!';
const staffPassword = 'Stage341StaffPass12345!';
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
function ok(step, cond, detail) { if (!cond) failures.push(`${step}: FAILED ${detail !== undefined ? '-> ' + JSON.stringify(detail).slice(0, 300) : ''}`); }
function mustDeny(label, r) {
  if (r.status >= 200 && r.status < 300) failures.push(`${label} -- returned ${r.status} (expected denial): ${JSON.stringify(r.body).slice(0, 260)}`);
  else if (![400, 401, 403, 404, 409].includes(r.status)) failures.push(`${label} -- returned ${r.status}, not a recognized denial: ${JSON.stringify(r.body).slice(0, 260)}`);
  else counts.denials++;
}
function moneyEq(a, b) { return Math.abs(parseFloat(a) - parseFloat(b)) < 0.01; }
function dbCheck(label, cond, detail) { counts.dbPost++; ok(`DB POST-CONDITION -- ${label}`, cond, detail); }

// ---------------------------------------------------------------- bootstrap + topology
const owner = await request('/api/auth/bootstrap', { method: 'POST', body: JSON.stringify({ full_name: 'S341 Owner', email: `s341owner-${stamp}@boom.local`, password: ownerPassword }) });
expect('bootstrap owner', owner.status, 201, owner.body);
const OWNER = { authorization: `Bearer ${owner.body.token}` };

async function makeFranchise(tag) {
  const f = await request('/api/franchises', { method: 'POST', headers: OWNER, body: JSON.stringify({ name: `S341 F${tag}`, code: `S341${tag}${stamp % 100000}`, legal_name: `S341${tag} LLC`, contact_name: 'x', phone: `+9931711${tag}`, email: `s341${tag}-${stamp}@boom.local`, address: 'x' }) });
  expect(`create franchise ${tag}`, f.status, 201, f.body);
  return f.body.franchise.id;
}
async function makeBranch(tag, franchiseId) {
  const branch = await request('/api/branches', { method: 'POST', headers: OWNER, body: JSON.stringify({ name: `S341 B${tag}`, code: `S341${tag}${stamp % 100000}`, address: 'x', phone: `+9931712${tag}`, franchise_id: franchiseId }) });
  expect(`branch ${tag}`, branch.status, 201, branch.body);
  const id = branch.body.branch.id;
  await request(`/api/franchises/${franchiseId}/branches/${id}`, { method: 'POST', headers: OWNER, body: '{}' });
  return { tag, id, franchiseId };
}
async function makeUser(label, branch, allowed, roles) {
  const email = `${label}-${stamp}@boom.local`.toLowerCase();
  const u = await request('/api/users', { method: 'POST', headers: OWNER, body: JSON.stringify({ full_name: `${label} Name`, email, phone: `+9933${Math.floor(Math.random() * 100000)}`, password: staffPassword, branch_id: branch, roles, allowed_branches: allowed }) });
  expect(`create user ${label}`, u.status, 201, u.body);
  const login = await request('/api/auth/login', { method: 'POST', body: JSON.stringify({ login: email, password: staffPassword }) });
  expect(`login ${label}`, login.status, 200, login.body);
  return { label, email, id: u.body.user.id, headers: { authorization: `Bearer ${login.body.token}` } };
}

const FA = await makeFranchise('A');
const A1 = await makeBranch('A1', FA);
const A2 = await makeBranch('A2', FA);
const MGR_A1 = await makeUser('m341a1', A1.id, [A1.id], ['BRANCH_MANAGER']);
const MGR2_A1 = await makeUser('m341a1b', A1.id, [A1.id], ['BRANCH_MANAGER']);
const CASHIER_A1 = await makeUser('c341a1', A1.id, [A1.id], ['CASHIER']);
const MGR_A2 = await makeUser('m341a2', A2.id, [A2.id], ['BRANCH_MANAGER']);

// ---------------------------------------------------------------- menu / recipe / stock
const cat = await request('/api/menu/categories', { method: 'POST', headers: MGR_A1.headers, body: JSON.stringify({ branch_id: A1.id, name_ru: 'Cat', name_tk: 'Cat', sort_order: 0 }) });
const item = (await request('/api/menu/items', { method: 'POST', headers: MGR_A1.headers, body: JSON.stringify({ branch_id: A1.id, category_id: cat.body.category.id, sku: `SKU341-${stamp}`, name_ru: 'Burger', name_tk: 'Burger', price: '100.00', sort_order: 0 }) })).body.item;
const beef = (await request('/api/inventory/items', { method: 'POST', headers: MGR_A1.headers, body: JSON.stringify({ branch_id: A1.id, sku: `BEEF341-${stamp}`, name: 'Beef', unit: 'g', reorder_point: '100' }) })).body.item;
const supplier = (await request('/api/inventory/suppliers', { method: 'POST', headers: MGR_A1.headers, body: JSON.stringify({ branch_id: A1.id, name: 'S341 Supplier' }) })).body.supplier;
const purchase = await request('/api/inventory/purchases', { method: 'POST', headers: MGR_A1.headers, body: JSON.stringify({ branch_id: A1.id, supplier_id: supplier.id, items: [{ inventory_item_id: beef.id, quantity: '100000', unit_cost: '0.02' }] }) });
expect('create purchase', purchase.status, 201, purchase.body);
expect('receive purchase', (await request(`/api/inventory/purchases/${purchase.body.purchase.id}/receive`, { method: 'POST', headers: MGR_A1.headers })).status, 200);
const recipe = await request('/api/inventory/recipes', { method: 'POST', headers: MGR_A1.headers, body: JSON.stringify({ branch_id: A1.id, menu_item_id: item.id, name: 'Burger Recipe', yield_qty: '1', ingredients: [{ inventory_item_id: beef.id, quantity: '150' }] }) });
expect('create recipe (150g @ 0.02)', recipe.status, 201, recipe.body);

const area = await request('/api/tables/areas', { method: 'POST', headers: MGR_A1.headers, body: JSON.stringify({ branch_id: A1.id, name: 'Hall', sort_order: 0 }) });
async function makeTable(code) { return (await request('/api/tables', { method: 'POST', headers: MGR_A1.headers, body: JSON.stringify({ branch_id: A1.id, area_id: area.body.area.id, code, seats: 4 }) })).body.table; }
const T1 = await makeTable(`T341A-${stamp % 10000}`), T2 = await makeTable(`T341B-${stamp % 10000}`), T3 = await makeTable(`T341C-${stamp % 10000}`), T4 = await makeTable(`T341D-${stamp % 10000}`), T5 = await makeTable(`T341E-${stamp % 10000}`), T6 = await makeTable(`T341F-${stamp % 10000}`);

const waiter = await makeUser('w341a1', A1.id, [A1.id], ['WAITER']);
expect('issue waiter code', (await request(`/api/waiters/${waiter.id}/code`, { method: 'POST', headers: MGR_A1.headers, body: JSON.stringify({ code: '9441' }) })).status, 201);
const waiterAuth = await request('/api/waiters/authenticate-code', { method: 'POST', body: JSON.stringify({ code: '9441', deviceId: 's341-device' }) });
const W = { 'x-waiter-session': waiterAuth.body.session.token };
const waiter2 = await makeUser('w341a1b', A1.id, [A1.id], ['WAITER']);
expect('issue waiter2 code', (await request(`/api/waiters/${waiter2.id}/code`, { method: 'POST', headers: MGR_A1.headers, body: JSON.stringify({ code: '9442' }) })).status, 201);
const waiter2Auth = await request('/api/waiters/authenticate-code', { method: 'POST', body: JSON.stringify({ code: '9442', deviceId: 's341-device2' }) });
const W2 = { 'x-waiter-session': waiter2Auth.body.session.token };

const unlockR = await request('/api/operator-pos/unlock', { method: 'POST', headers: CASHIER_A1.headers, body: JSON.stringify({ password: staffPassword, branch_id: A1.id, device_id: 's341-cash' }) });
expect('CASHIER POS unlock', unlockR.status, 200, unlockR.body);
const posToken = unlockR.body.session_token;
expect('open shift', (await request('/api/cash-shifts', { method: 'POST', headers: CASHIER_A1.headers, body: JSON.stringify({ branch_id: A1.id, opening_cash: '50.00' }) })).status, 201);

async function stock() { return Number((await request(`/api/inventory/items?branch_id=${A1.id}`, { headers: MGR_A1.headers })).body.items.find(i => i.id === beef.id).current_stock); }
async function newOrder(table, qty = 1, w = W) {
  const o = await request('/api/orders', { method: 'POST', headers: { ...w, 'idempotency-key': `s341-${Date.now()}-${Math.random()}` }, body: JSON.stringify({ order_type: 'DINE_IN', source: 'POS', table_id: table.id, items: [{ menu_item_id: item.id, quantity: qty }] }) });
  expect('create order', o.status, 201, o.body);
  return o.body.order;
}
async function ticketOf(orderId) { return (await request(`/api/kds?branch_id=${A1.id}`, { headers: MGR_A1.headers })).body.tickets.find(t => t.order_id === orderId); }
async function advance(order, to) {
  await request(`/api/orders/${order.id}/confirm`, { method: 'POST', headers: MGR_A1.headers });
  if (to === 'CONFIRMED') return;
  const t = await ticketOf(order.id);
  await request(`/api/kds/${t.id}/status`, { method: 'POST', headers: MGR_A1.headers, body: JSON.stringify({ status: 'PREPARING' }) });
  if (to === 'PREPARING') return;
  await request(`/api/kds/${t.id}/status`, { method: 'POST', headers: MGR_A1.headers, body: JSON.stringify({ status: 'READY' }) });
}
async function orderOf(id) { return (await request(`/api/orders/${id}`, { headers: MGR_A1.headers })).body.order; }
async function closuresOf(status) { return (await request(`/api/orders/closure-requests?branch_id=${A1.id}&status=${status}`, { headers: MGR_A1.headers })).body.closures; }

// ================================================================== 1-7. WAITER "OTKAZ": request only, never finalise
const order1 = await newOrder(T1);
const stock0 = await stock();
const missingTreatment = await request(`/api/orders/${order1.id}/closure-requests`, { method: 'POST', headers: W, body: JSON.stringify({ type: 'CANCELLATION', reason: 'Guest left' }) });
mustDeny('2. the product decision is never guessed: inventory_treatment is mandatory', missingTreatment);
ok('2b. mandatory-treatment error names the missing decision', missingTreatment.body?.code === 'INVENTORY_TREATMENT_REQUIRED', missingTreatment.body);
mustDeny('3. reason is mandatory', await request(`/api/orders/${order1.id}/closure-requests`, { method: 'POST', headers: W, body: JSON.stringify({ type: 'CANCELLATION', inventory_treatment: 'NO_WRITE_OFF' }) }));
mustDeny('4. a waiter may not request an establishment closure', await request(`/api/orders/${order1.id}/closure-requests`, { method: 'POST', headers: W, body: JSON.stringify({ type: 'CLOSED_BY_ESTABLISHMENT', reason: 'x', inventory_treatment: 'NO_WRITE_OFF' }) }));
mustDeny('5. a waiter may not request a refund', await request(`/api/orders/${order1.id}/closure-requests`, { method: 'POST', headers: W, body: JSON.stringify({ type: 'CANCELLATION', reason: 'x', inventory_treatment: 'NO_WRITE_OFF', refund_requested: true }) }));
mustDeny('6. a waiter may not raise a closure on another waiter\'s order', await request(`/api/orders/${order1.id}/closure-requests`, { method: 'POST', headers: W2, body: JSON.stringify({ type: 'CANCELLATION', reason: 'x', inventory_treatment: 'NO_WRITE_OFF' }) }));

const req1 = await request(`/api/orders/${order1.id}/closure-requests`, { method: 'POST', headers: W, body: JSON.stringify({ type: 'CANCELLATION', reason: 'Guest left', comment: 'Waited too long', inventory_treatment: 'NO_WRITE_OFF' }) });
expect('1. waiter OTKAZ creates a cancellation request', req1.status, 201, req1.body);
dbCheck('1b. the request is PENDING, carries the chosen treatment, the reason and the production state', req1.body.closure.status === 'PENDING' && req1.body.closure.inventory_treatment === 'NO_WRITE_OFF' && req1.body.closure.reason === 'Guest left' && req1.body.closure.production_state === 'NOT_STARTED' && req1.body.closure.requester_role === 'WAITER', req1.body.closure);
dbCheck('7. the waiter cannot finalise alone: the order is still open after the request', (await orderOf(order1.id)).status === 'PENDING_CONFIRMATION', await orderOf(order1.id));
mustDeny('8. a second pending closure on the same order is refused', await request(`/api/orders/${order1.id}/closure-requests`, { method: 'POST', headers: W, body: JSON.stringify({ type: 'CANCELLATION', reason: 'again', inventory_treatment: 'NO_WRITE_OFF' }) }));

// ================================================================== 9-11. MANAGER APPROVAL of a not-started cancellation
mustDeny('9. a cashier has no approval permission', await request(`/api/orders/closure-requests/${req1.body.closure.id}/approve`, { method: 'POST', headers: CASHIER_A1.headers, body: '{}' }));
mustDeny('10. branch isolation: a branch A2 manager cannot approve a branch A1 closure', await request(`/api/orders/closure-requests/${req1.body.closure.id}/approve`, { method: 'POST', headers: MGR_A2.headers, body: '{}' }));
mustDeny('10b. branch isolation: a branch A2 manager cannot list branch A1 closures', await request(`/api/orders/closure-requests?branch_id=${A1.id}`, { headers: MGR_A2.headers }));
const pendingList = await closuresOf('PENDING');
dbCheck('11. the manager approval queue shows the pending request with its order number', pendingList.some(c => c.id === req1.body.closure.id && c.order_number), pendingList);
const approve1 = await request(`/api/orders/closure-requests/${req1.body.closure.id}/approve`, { method: 'POST', headers: MGR_A1.headers, body: JSON.stringify({ reason: 'Confirmed by manager' }) });
expect('12. manager approves the cancellation', approve1.status, 200, approve1.body);
dbCheck('12b. order reaches CANCELLED, closure APPROVED with the approver recorded', approve1.body.order.status === 'CANCELLED' && approve1.body.closure.status === 'APPROVED' && approve1.body.closure.approver_user_id === MGR_A1.id && approve1.body.closure.decided_at, approve1.body);
dbCheck('13. NO_WRITE_OFF on an order that never entered production moves no stock at all', (await stock()) === stock0, { before: stock0, after: await stock() });
const movesAfter1 = (await request(`/api/inventory/movements?branch_id=${A1.id}`, { headers: MGR_A1.headers })).body.movements;
dbCheck('13b. and records no inventory movement for that order', !movesAfter1.some(m => m.reference_id === order1.id), movesAfter1.filter(m => m.reference_id === order1.id));
dbCheck('14. the order is never physically deleted -- it is still readable with its items', (await orderOf(order1.id)).items.length === 1, null);
mustDeny('15. a closure on an already-closed order is refused', await request(`/api/orders/${order1.id}/closure-requests`, { method: 'POST', headers: W, body: JSON.stringify({ type: 'CANCELLATION', reason: 'again', inventory_treatment: 'NO_WRITE_OFF' }) }));
mustDeny('16. an already-decided closure cannot be decided twice', await request(`/api/orders/closure-requests/${req1.body.closure.id}/approve`, { method: 'POST', headers: MGR2_A1.headers, body: '{}' }));

// ================================================================== 17-18. REJECTION leaves the order untouched
const order2 = await newOrder(T2);
const req2 = await request(`/api/orders/${order2.id}/closure-requests`, { method: 'POST', headers: W, body: JSON.stringify({ type: 'CANCELLATION', reason: 'Mistake', inventory_treatment: 'NO_WRITE_OFF' }) });
expect('17. second cancellation request', req2.status, 201, req2.body);
const reject2 = await request(`/api/orders/closure-requests/${req2.body.closure.id}/reject`, { method: 'POST', headers: MGR_A1.headers, body: JSON.stringify({ reason: 'Order is fine' }) });
expect('18. manager rejects', reject2.status, 200, reject2.body);
dbCheck('18b. a rejected closure leaves the order open and unchanged', reject2.body.closure.status === 'REJECTED' && reject2.body.order.status === 'PENDING_CONFIRMATION', reject2.body);

// ================================================================== 19-21. PRODUCTION STARTED -> restoring stock is forbidden
const order3 = await newOrder(T3);
await advance(order3, 'PREPARING');
mustDeny('19. RESTORE_STOCK is refused once production has started', await request(`/api/orders/${order3.id}/closure-requests`, { method: 'POST', headers: W, body: JSON.stringify({ type: 'CANCELLATION', reason: 'Burnt', inventory_treatment: 'RESTORE_STOCK' }) }));
const restoreDenial = await request(`/api/orders/${order3.id}/closure-requests`, { method: 'POST', headers: W, body: JSON.stringify({ type: 'CANCELLATION', reason: 'Burnt', inventory_treatment: 'RESTORE_STOCK' }) });
ok('19b. the denial names the production rule', restoreDenial.body?.code === 'INVENTORY_RESTORE_FORBIDDEN_AFTER_PRODUCTION', restoreDenial.body);
const stockBefore3 = await stock();
const req3 = await request(`/api/orders/${order3.id}/closure-requests`, { method: 'POST', headers: W, body: JSON.stringify({ type: 'CANCELLATION', reason: 'Burnt in the kitchen', inventory_treatment: 'WRITE_OFF' }) });
expect('20. WRITE_OFF request on an in-production order', req3.status, 201, req3.body);
dbCheck('20b. the production state at request time is recorded as PREPARING', req3.body.closure.production_state === 'PREPARING', req3.body.closure);
const approve3 = await request(`/api/orders/closure-requests/${req3.body.closure.id}/approve`, { method: 'POST', headers: MGR_A1.headers, body: '{}' });
expect('21. manager approves the write-off', approve3.status, 200, approve3.body);
const stockAfter3 = await stock();
dbCheck('21b. an unpaid, already-produced order writes the ingredients OFF the shelf (150g), it never returns them', stockBefore3 - stockAfter3 === 150, { before: stockBefore3, after: stockAfter3 });
dbCheck('21c. the production loss is valued at the real cost 150 * 0.02 = 3.00', moneyEq(approve3.body.closure.write_off_cost, '3.00'), approve3.body.closure);
const moves3 = (await request(`/api/inventory/movements?branch_id=${A1.id}`, { headers: MGR_A1.headers })).body.movements.filter(m => m.reference_id === req3.body.closure.id);
dbCheck('21d. it is recorded in the one inventory ledger as WASTE / PRODUCTION_LOSS, never as a RETURN', moves3.length === 1 && moves3[0].type === 'WASTE' && moves3[0].reason === 'PRODUCTION_LOSS' && moneyEq(moves3[0].quantity, '150'), moves3);
dbCheck('21e. the kitchen ticket is cancelled with the order', (await ticketOf(order3.id)).status === 'CANCELLED', await ticketOf(order3.id));

// ================================================================== 22-24. NO_WRITE_OFF on a produced order leaves stock alone
const order4 = await newOrder(T4);
await advance(order4, 'PREPARING');
const stockBefore4 = await stock();
const req4 = await request(`/api/orders/${order4.id}/closure-requests`, { method: 'POST', headers: MGR_A1.headers, body: JSON.stringify({ type: 'CANCELLATION', reason: 'Re-made for the guest', inventory_treatment: 'NO_WRITE_OFF' }) });
expect('22. NO_WRITE_OFF request on an in-production order', req4.status, 201, req4.body);
const selfApprove = await request(`/api/orders/closure-requests/${req4.body.closure.id}/approve`, { method: 'POST', headers: MGR_A1.headers, body: '{}' });
mustDeny('23. the requester can never approve their own closure', selfApprove);
ok('23b. the denial names the four-eyes rule', selfApprove.body?.code === 'SELF_APPROVAL_FORBIDDEN', selfApprove.body);
const approve4 = await request(`/api/orders/closure-requests/${req4.body.closure.id}/approve`, { method: 'POST', headers: MGR2_A1.headers, body: '{}' });
expect('24. approved by a second manager', approve4.status, 200, approve4.body);
dbCheck('24b. the explicitly chosen NO_WRITE_OFF moves no stock, even though production had started', (await stock()) === stockBefore4, { before: stockBefore4, after: await stock() });
dbCheck('24c. no write-off cost is recorded for a NO_WRITE_OFF decision', approve4.body.closure.write_off_cost === null, approve4.body.closure);

// ================================================================== 25-31. PAID ORDER: money back, ingredients NOT back
const order5 = await newOrder(T5, 2); // 2 x 150g = 300g
await advance(order5, 'READY');
const order5Full = await orderOf(order5.id);
const stockBeforePay = await stock();
const pay5 = await request('/api/payments', { method: 'POST', headers: { ...CASHIER_A1.headers, 'x-pos-session-token': posToken, 'idempotency-key': `s341-pay5-${stamp}` }, body: JSON.stringify({ order_id: order5.id, method: 'CASH', amount: order5Full.final_amount }) });
expect('25. pay the order in cash', pay5.status, 201, pay5.body);
const stockAfterPay = await stock();
dbCheck('25b. payment consumed 2 x 150g = 300g', stockBeforePay - stockAfterPay === 300, { before: stockBeforePay, after: stockAfterPay });

const rogueRefund = await request(`/api/payments/${pay5.body.payment.id}/refund`, { method: 'POST', headers: { ...MGR_A1.headers, 'x-pos-session-token': posToken }, body: '{}' });
mustDeny('26. an arbitrary historical refund is impossible without an approved closure', rogueRefund);
ok('26b. the denial names the required authorisation', rogueRefund.body?.code === 'REFUND_REQUIRES_APPROVED_CLOSURE', rogueRefund.body);
dbCheck('26c. the refused refund changed nothing: the payment is still PAID', (await request(`/api/payments?branch_id=${A1.id}`, { headers: MGR_A1.headers })).body.payments.find(p => p.id === pay5.body.payment.id).status === 'PAID', null);

mustDeny('27. RESTORE_STOCK is refused for a paid (therefore produced) order', await request(`/api/orders/${order5.id}/closure-requests`, { method: 'POST', headers: CASHIER_A1.headers, body: JSON.stringify({ type: 'CLOSED_BY_ESTABLISHMENT', reason: 'x', inventory_treatment: 'RESTORE_STOCK', refund_requested: true }) }));
const shiftBefore = (await request(`/api/cash-shifts?branch_id=${A1.id}`, { headers: MGR_A1.headers })).body.shifts.find(s => s.status === 'OPEN');
const req5 = await request(`/api/orders/${order5.id}/closure-requests`, { method: 'POST', headers: CASHIER_A1.headers, body: JSON.stringify({ type: 'CLOSED_BY_ESTABLISHMENT', reason: 'Quality complaint', comment: 'Guest refused the dish', inventory_treatment: 'WRITE_OFF', refund_requested: true }) });
expect('28. cashier raises ZAKRYTO ZAVEDENIEM with a refund', req5.status, 201, req5.body);
dbCheck('28b. it records that the order was already paid and that production had finished', req5.body.closure.paid_at_request === true && req5.body.closure.production_state === 'SERVED', req5.body.closure);
const stockBeforeRefund = await stock();
const approve5 = await request(`/api/orders/closure-requests/${req5.body.closure.id}/approve`, { method: 'POST', headers: MGR_A1.headers, body: JSON.stringify({ reason: 'Approved' }) });
expect('29. manager approves the establishment closure', approve5.status, 200, approve5.body);
dbCheck('29b. the order reaches the new final status CLOSED_BY_ESTABLISHMENT', approve5.body.order.status === 'CLOSED_BY_ESTABLISHMENT', approve5.body.order);
dbCheck('30. THE CORE RULE: the money came back but the ingredients did NOT -- stock is unchanged by the refund', (await stock()) === stockBeforeRefund, { before: stockBeforeRefund, after: await stock() });
const movesAfter5 = (await request(`/api/inventory/movements?branch_id=${A1.id}`, { headers: MGR_A1.headers })).body.movements;
dbCheck('30b. no RETURN movement was ever written for the refunded order', !movesAfter5.some(m => m.reference_id === order5.id && m.type === 'RETURN'), movesAfter5.filter(m => m.reference_id === order5.id));
dbCheck('30c. the production loss is valued from the REAL consumed quantity and cost (300g * 0.02 = 6.00)', moneyEq(approve5.body.closure.write_off_cost, '6.00'), approve5.body.closure);
const payment5After = (await request(`/api/payments?branch_id=${A1.id}`, { headers: MGR_A1.headers })).body.payments.find(p => p.id === pay5.body.payment.id);
dbCheck('31. the financial side really happened: the payment is REFUNDED and linked to the closure', payment5After.status === 'REFUNDED' && approve5.body.closure.refund_payment_id === pay5.body.payment.id, { payment5After, closure: approve5.body.closure });
const shiftAfter = (await request(`/api/cash-shifts?branch_id=${A1.id}`, { headers: MGR_A1.headers })).body.shifts.find(s => s.status === 'OPEN');
dbCheck('31b. the cash shift refunds total grew by the refunded amount', moneyEq(Number(shiftAfter.refunds) - Number(shiftBefore.refunds), payment5After.amount), { before: shiftBefore.refunds, after: shiftAfter.refunds });
const table5 = (await request(`/api/tables?branch_id=${A1.id}`, { headers: MGR_A1.headers })).body.tables.find(t => t.id === T5.id);
dbCheck('31c. the table was released by the closure', table5.status === 'AVAILABLE', table5);

// ================================================================== 32. refund requested on an unpaid order
const order6 = await newOrder(T6);
mustDeny('32. a refund cannot be requested for an order nobody paid', await request(`/api/orders/${order6.id}/closure-requests`, { method: 'POST', headers: CASHIER_A1.headers, body: JSON.stringify({ type: 'CLOSED_BY_ESTABLISHMENT', reason: 'x', inventory_treatment: 'NO_WRITE_OFF', refund_requested: true }) }));

// ================================================================== 33-35. AUTO-CANCEL windows
const settingKeys = (await request('/api/settings', { headers: OWNER })).body.settings.map(s => s.key);
dbCheck('33. both configurable timeout thresholds exist in system_settings', settingKeys.includes('ORDER_CONFIRMATION_TIMEOUT') && settingKeys.includes('KITCHEN_ACCEPT_TIMEOUT'), settingKeys.filter(k => k.includes('TIMEOUT')));
expect('34a. set ORDER_CONFIRMATION_TIMEOUT to 0 minutes', (await request('/api/settings/ORDER_CONFIRMATION_TIMEOUT', { method: 'PUT', headers: OWNER, body: JSON.stringify({ value: '0' }) })).status, 200);
expect('34b. set KITCHEN_ACCEPT_TIMEOUT to 0 minutes', (await request('/api/settings/KITCHEN_ACCEPT_TIMEOUT', { method: 'PUT', headers: OWNER, body: JSON.stringify({ value: '0' }) })).status, 200);
const orderProducing = await newOrder(T1);
await advance(orderProducing, 'PREPARING');
const stockBeforeAuto = await stock();
const auto = await request('/api/orders/closures/auto-cancel', { method: 'POST', headers: MGR_A1.headers, body: JSON.stringify({ branch_id: A1.id }) });
expect('34. auto-cancel runs against the configured thresholds', auto.status, 200, auto.body);
dbCheck('34c. it reports the thresholds it actually read from system_settings', auto.body.order_confirmation_timeout_minutes === 0 && auto.body.kitchen_accept_timeout_minutes === 0, auto.body);
dbCheck('35. an order already in production is NEVER auto-cancelled', !auto.body.cancelled_order_ids.includes(orderProducing.id) && (await orderOf(orderProducing.id)).status !== 'CANCELLED', auto.body);
dbCheck('35b. and no stock moved for it', (await stock()) === stockBeforeAuto, { before: stockBeforeAuto, after: await stock() });
dbCheck('35c. the untouched pending order (rejected closure) WAS auto-cancelled before production', auto.body.cancelled_order_ids.includes(order2.id) && (await orderOf(order2.id)).status === 'CANCELLED', { cancelled: auto.body.cancelled_order_ids, order2: (await orderOf(order2.id)).status });

// ================================================================== 36. AUDIT
const audit = (await request(`/api/audit?branch_id=${A1.id}&limit=400`, { headers: OWNER })).body.logs || [];
const actions = new Set(audit.map(a => a.action));
dbCheck('36. every closure decision is audited (request / approval / rejection)', ['ORDER_CLOSURE_REQUESTED', 'ORDER_CLOSURE_APPROVED', 'ORDER_CLOSURE_REJECTED'].every(a => actions.has(a)), [...actions].filter(a => a.startsWith('ORDER_CLOSURE')));
const approvedAudit = audit.find(a => a.action === 'ORDER_CLOSURE_APPROVED' && a.entity_id === req5.body.closure.id);
dbCheck('36b. the approval audit entry carries the inventory decision and the production state it was judged against', approvedAudit && JSON.stringify(approvedAudit.new_values).includes('WRITE_OFF') && JSON.stringify(approvedAudit.new_values).includes('SERVED'), approvedAudit);

// ---------------------------------------------------------------- summary
console.log(`\nStage 34.1 closure E2E: ${counts.runtime} HTTP calls, ${counts.denials} denials, ${counts.dbPost} DB post-conditions`);
if (failures.length) { console.error(`\nFAILURES (${failures.length}):`); for (const f of failures) console.error(' - ' + f); process.exit(1); }
console.log('ALL STAGE 34.1 CLOSURE CHECKS PASSED');
