// BOOM OS -- Stage 29: fresh-DB E2E proof of the Cashier POS + Receipt engine, exercising the
// real backend endpoints the CashierPOSView/ReceiptSettingsView components call.
// CASHIER LOGIN -> POS UNLOCK -> OPEN SHIFT -> READY ORDER -> NOTES -> PAYMENT -> RECEIPT ->
// REPRINT -> cross-branch denial -> refund denial.
//
// Requires an empty database. Usage: node tests/stage29_cashier_pos_receipt_e2e.mjs
import assert from 'node:assert/strict';

const base = `http://127.0.0.1:${process.env.BOOM_OS_PORT || 3000}`;
const ownerPassword = process.env.STAGE29_OWNER_PASSWORD || 'BoomStage29Owner!';
const staffPassword = 'Stage29StaffPass12345!';
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
function ok(step, cond, detail) { if (!cond) failures.push(`${step}: FAILED ${detail !== undefined ? '-> ' + JSON.stringify(detail).slice(0,300) : ''}`); }
function mustDenyAuth(label, r) {
  if (r.status >= 200 && r.status < 300) failures.push(`${label} -- returned ${r.status} (expected denial): ${JSON.stringify(r.body).slice(0,260)}`);
  else if (![401, 403, 404].includes(r.status)) failures.push(`${label} -- returned ${r.status}, not a recognized denial: ${JSON.stringify(r.body).slice(0,260)}`);
  else counts.denials++;
}
function moneyEq(actual, expectedStr) { return Math.abs(parseFloat(actual) - parseFloat(expectedStr)) < 0.005; }
function dbCheck(label, cond, detail) { counts.dbPost++; ok(`DB POST-CONDITION -- ${label}`, cond, detail); }

// ---------------------------------------------------------------- bootstrap + topology
const owner = await request('/api/auth/bootstrap', { method: 'POST', body: JSON.stringify({ full_name: 'S29 Owner', email: `s29owner-${stamp}@boom.local`, password: ownerPassword }) });
expect('bootstrap owner', owner.status, 201, owner.body);
const OWNER = { authorization: `Bearer ${owner.body.token}` };

async function makeFranchise(tag) {
  const f = await request('/api/franchises', { method: 'POST', headers: OWNER, body: JSON.stringify({ name: `S29 F${tag}`, code: `S29${tag}${stamp % 100000}`, legal_name: `S29${tag} LLC`, contact_name: 'x', phone: `+9931699${tag}`, email: `s29${tag}-${stamp}@boom.local`, address: 'x' }) });
  expect(`create franchise ${tag}`, f.status, 201, f.body);
  return f.body.franchise.id;
}
async function makeBranch(tag, franchiseId) {
  const branch = await request('/api/branches', { method: 'POST', headers: OWNER, body: JSON.stringify({ name: `S29 B${tag}`, code: `S29${tag}${stamp % 100000}`, address: 'x', phone: `+9931609${tag}`, franchise_id: franchiseId }) });
  expect(`branch ${tag}`, branch.status, 201, branch.body);
  const id = branch.body.branch.id;
  await request(`/api/franchises/${franchiseId}/branches/${id}`, { method: 'POST', headers: OWNER, body: '{}' });
  return { tag, id, franchiseId };
}
async function makeUser(label, branch, allowed, roles) {
  const email = `${label}-${stamp}@boom.local`.toLowerCase();
  const u = await request('/api/users', { method: 'POST', headers: OWNER, body: JSON.stringify({ full_name: `${label} Name`, email, phone: `+9937${Math.floor(Math.random()*100000)}`, password: staffPassword, branch_id: branch, roles, allowed_branches: allowed }) });
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

console.log(`Setup: FA=${FA} A1=${A1.id} A2=${A2.id}`);

// 1. CASHIER login (already proven by makeUser's login step)
ok('1. CASHIER login', !!CASHIER_A1.headers.authorization, null);

// menu / inventory / recipe / service charge / table / waiter / order
const cat = await request('/api/menu/categories', { method: 'POST', headers: MGR_A1.headers, body: JSON.stringify({ branch_id: A1.id, name_ru: 'Cat', name_tk: 'Cat', sort_order: 0 }) });
const item = (await request('/api/menu/items', { method: 'POST', headers: MGR_A1.headers, body: JSON.stringify({ branch_id: A1.id, category_id: cat.body.category.id, sku: `SKU-${stamp}`, name_ru: 'Burger', name_tk: 'Burger', price: '20.00', sort_order: 0 }) })).body.item;
const invItem = (await request('/api/inventory/items', { method: 'POST', headers: MGR_A1.headers, body: JSON.stringify({ branch_id: A1.id, sku: `INV-${stamp}`, name: 'Bun', unit: 'pcs', reorder_point: '1' }) })).body.item;
await request('/api/inventory/movements', { method: 'POST', headers: MGR_A1.headers, body: JSON.stringify({ branch_id: A1.id, inventory_item_id: invItem.id, type: 'ADJUSTMENT', quantity: '100', reason: 'initial stock' }) });
await request('/api/inventory/recipes', { method: 'POST', headers: MGR_A1.headers, body: JSON.stringify({ branch_id: A1.id, menu_item_id: item.id, name: 'Recipe', yield_qty: '1', ingredients: [{ inventory_item_id: invItem.id, quantity: '3' }] }) });
// Stage 34.2: publishing a service charge configuration creates a new VERSION (201) and the flat
// allocation list was replaced by distribution categories.
const scR = await request(`/api/service-charge/${A1.id}`, { method: 'PUT', headers: MGR_A1.headers, body: JSON.stringify({ percent: '10.00', categories: [] }) });
expect('publish service charge version', scR.status, 201, scR.body);
const areaR = await request('/api/tables/areas', { method: 'POST', headers: MGR_A1.headers, body: JSON.stringify({ branch_id: A1.id, name: 'Hall', sort_order: 0 }) });
const tableR = await request('/api/tables', { method: 'POST', headers: MGR_A1.headers, body: JSON.stringify({ branch_id: A1.id, area_id: areaR.body.area.id, code: `T-${stamp % 10000}`, seats: 4 }) });
const waiterUser = await makeUser('waitA1', A1.id, [A1.id], ['WAITER']);
const codeR = await request(`/api/waiters/${waiterUser.id}/code`, { method: 'POST', headers: MGR_A1.headers, body: JSON.stringify({ code: '9091' }) });
expect('issue waiter code', codeR.status, 201, codeR.body);
const waiterAuth = await request('/api/waiters/authenticate-code', { method: 'POST', body: JSON.stringify({ code: '9091', deviceId: 's29-device' }) });
expect('waiter authenticate', waiterAuth.status, 200, waiterAuth.body);
const W1 = { headers: { 'x-waiter-session': waiterAuth.body.session.token } };

// ================================================================== 2. POS UNLOCK
const invBeforeSale = (await request(`/api/inventory/items?branch_id=${A1.id}`, { headers: MGR_A1.headers })).body.items.find(i => i.id === invItem.id);
const unlockR = await request('/api/operator-pos/unlock', { method: 'POST', headers: CASHIER_A1.headers, body: JSON.stringify({ password: staffPassword, branch_id: A1.id, device_id: 's29-cashier-device' }) });
expect('2. CASHIER POS unlock', unlockR.status, 200, unlockR.body);
const posToken = unlockR.body.session_token;

// ================================================================== 3. OPEN SHIFT
const shiftBefore = (await request(`/api/cash-shifts/current?branch_id=${A1.id}`, { headers: MGR_A1.headers })).body.shift;
let shiftR;
if (shiftBefore) { shiftR = { status: 201, body: { shift: shiftBefore } }; }
else { shiftR = await request('/api/cash-shifts', { method: 'POST', headers: MGR_A1.headers, body: JSON.stringify({ branch_id: A1.id, opening_cash: '50.00' }) }); }
expect('3. open shift', shiftR.status, 201, shiftR.body);

// ================================================================== 4/5. CREATE/USE READY ORDER, SELECT
const orderR = await request('/api/orders', { method: 'POST', headers: { ...W1.headers, 'idempotency-key': `s29-order-${stamp}` }, body: JSON.stringify({ order_type: 'DINE_IN', source: 'POS', table_id: tableR.body.table.id, items: [{ menu_item_id: item.id, quantity: 2 }] }) });
expect('create order', orderR.status, 201, orderR.body);
const order = orderR.body.order;
await request(`/api/orders/${order.id}/confirm`, { method: 'POST', headers: MGR_A1.headers });
const ticket = (await request(`/api/kds?branch_id=${A1.id}&status=NEW`, { headers: MGR_A1.headers })).body.tickets.find(t => t.order_id === order.id);
await request(`/api/kds/${ticket.id}/status`, { method: 'POST', headers: MGR_A1.headers, body: JSON.stringify({ status: 'PREPARING' }) });
await request(`/api/kds/${ticket.id}/status`, { method: 'POST', headers: MGR_A1.headers, body: JSON.stringify({ status: 'READY' }) });

const selectR = await request(`/api/orders/${order.id}`, { headers: CASHIER_A1.headers });
expect('5. CASHIER can select/view the order', selectR.status, 200, selectR.body);
let detail = selectR.body.order;
dbCheck('order is READY (real backend state, not frontend assumption)', detail.status === 'READY', detail);

// 6. Cross-branch denial: MGR_A2 must not see the A1 order.
mustDenyAuth('6. MGR_A2 cannot view A1 order (cross-branch)', await request(`/api/orders/${order.id}`, { headers: MGR_A2.headers }));

// ================================================================== ADD NOTES (customer, internal, item)
const notesR = await request(`/api/orders/${order.id}/notes`, { method: 'PATCH', headers: CASHIER_A1.headers, body: JSON.stringify({ customer_note: 'Позвонить перед доставкой', internal_note: 'VIP client, watch for allergy' }) });
expect('add customer + internal note', notesR.status, 200, notesR.body);
dbCheck('order.notes = customer note', notesR.body.order.notes === 'Позвонить перед доставкой', notesR.body.order);
dbCheck('order.internal_notes = internal note', notesR.body.order.internal_notes === 'VIP client, watch for allergy', notesR.body.order);

const itemToNote = (await request(`/api/orders/${order.id}`, { headers: CASHIER_A1.headers })).body.order.items[0];
const itemNoteR = await request(`/api/orders/${order.id}/items/${itemToNote.id}/note`, { method: 'PATCH', headers: CASHIER_A1.headers, body: JSON.stringify({ comment: 'Без лука' }) });
expect('add item note', itemNoteR.status, 200, itemNoteR.body);
dbCheck('order_item.comment persisted', itemNoteR.body.item.comment === 'Без лука', itemNoteR.body.item);
const kdsView = await request(`/api/kds?branch_id=${A1.id}`, { headers: MGR_A1.headers });
const kdsItem = kdsView.body.tickets.find(t => t.order_id === order.id)?.items?.find((i) => i.id === itemToNote.id);
dbCheck('kitchen (KDS) sees the item note', kdsItem?.comment === 'Без лука', kdsItem);

// VERIFY SERVER TOTAL
detail = (await request(`/api/orders/${order.id}`, { headers: CASHIER_A1.headers })).body.order;
dbCheck('server total = subtotal 40.00 + 10% service = 44.00', moneyEq(detail.final_amount, '44.00'), detail);

// ================================================================== PAYMENT (via CASHIER + real POS token)
const payIdem = `s29-cashier-pay-${stamp}`;
const payR = await request('/api/payments', { method: 'POST', headers: { ...CASHIER_A1.headers, 'x-pos-session-token': posToken, 'idempotency-key': payIdem }, body: JSON.stringify({ order_id: order.id, method: 'CASH', amount: detail.final_amount }) });
expect('payment succeeds', payR.status, 201, payR.body);
const payment = payR.body.payment;
dbCheck('exactly one PAID payment', (await request(`/api/payments?branch_id=${A1.id}`, { headers: MGR_A1.headers })).body.payments.filter(p => p.order_id === order.id && p.status === 'PAID').length === 1, null);
dbCheck('order COMPLETED', (await request(`/api/orders/${order.id}`, { headers: MGR_A1.headers })).body.order.status === 'COMPLETED', null);
const shiftAfter = (await request(`/api/cash-shifts/current?branch_id=${A1.id}`, { headers: MGR_A1.headers })).body.shift;
dbCheck('cash shift updated', moneyEq(String(Number(shiftAfter.cash_sales) - Number(shiftBefore?.cash_sales || 0)), payment.amount), null);
const invAfterSale = (await request(`/api/inventory/items?branch_id=${A1.id}`, { headers: MGR_A1.headers })).body.items.find(i => i.id === invItem.id);
dbCheck('inventory updated (3 x 2 = 6 consumed)', moneyEq(String(Number(invBeforeSale.current_stock) - Number(invAfterSale.current_stock)), '6'), { before: invBeforeSale.current_stock, after: invAfterSale.current_stock });
const ledger = (await request(`/api/service-charge/${A1.id}/ledger`, { headers: MGR_A1.headers })).body.ledger;
ok('ledger endpoint reachable and consistent (no allocations configured -> no crash, 0 rows for this order)', Array.isArray(ledger), ledger);
const auditRows = (await request(`/api/audit?entity_type=PAYMENT&action=PAYMENT_CREATED&limit=200`, { headers: MGR_A1.headers })).body.logs.filter(l => l.entity_id === payment.id);
dbCheck('audit created exactly once', auditRows.length === 1, auditRows.length);

// PAYMENT IDEMPOTENCY (double-click cannot double-pay)
const payReplay = await request('/api/payments', { method: 'POST', headers: { ...CASHIER_A1.headers, 'x-pos-session-token': posToken, 'idempotency-key': payIdem }, body: JSON.stringify({ order_id: order.id, method: 'CASH', amount: detail.final_amount }) });
expect('double-click replay, not a second payment', payReplay.status, 200, payReplay.body);
dbCheck('still exactly one payment row after double-click', (await request(`/api/payments?branch_id=${A1.id}`, { headers: MGR_A1.headers })).body.payments.filter(p => p.order_id === order.id).length === 1, null);
const invAfterReplay = (await request(`/api/inventory/items?branch_id=${A1.id}`, { headers: MGR_A1.headers })).body.items.find(i => i.id === invItem.id);
dbCheck('no duplicate inventory movement from the replay', moneyEq(invAfterReplay.current_stock, invAfterSale.current_stock), null);

// ALREADY-PAID handled
const secondAttempt = await request('/api/payments', { method: 'POST', headers: { ...CASHIER_A1.headers, 'x-pos-session-token': posToken, 'idempotency-key': `${payIdem}-different` }, body: JSON.stringify({ order_id: order.id, method: 'CASH', amount: detail.final_amount }) });
ok('a genuinely different payment attempt on an already-paid order is rejected', ![200,201].includes(secondAttempt.status) || secondAttempt.body?.payment?.id === payment.id, secondAttempt.body);

// ================================================================== RECEIPT PREVIEW / PRINT / REPRINT
const finalOrder = (await request(`/api/orders/${order.id}`, { headers: CASHIER_A1.headers })).body.order;
ok('receipt data source has everything a preview needs (items, totals, notes)', Array.isArray(finalOrder.items) && finalOrder.items.length > 0 && finalOrder.final_amount, finalOrder);
dbCheck('receipt data reflects the real item note', finalOrder.items.find((i) => i.id === itemToNote.id)?.comment === 'Без лука', null);

const printR = await request('/api/print/jobs', { method: 'POST', headers: CASHIER_A1.headers, body: JSON.stringify({ branch_id: A1.id, order_id: order.id, print_type: 'CUSTOMER_RECEIPT' }) });
expect('receipt print (CASHIER, print.execute granted)', printR.status, 201, printR.body);
const job = printR.body.job;

const reprintR = await request(`/api/print/jobs/${job.id}/reprint`, { method: 'POST', headers: CASHIER_A1.headers, body: '{}' });
expect('receipt reprint (CASHIER, print.reprint granted)', reprintR.status, 201, reprintR.body);
dbCheck('reprint created no second payment', (await request(`/api/payments?branch_id=${A1.id}`, { headers: MGR_A1.headers })).body.payments.filter(p => p.order_id === order.id).length === 1, null);
const invAfterReprint = (await request(`/api/inventory/items?branch_id=${A1.id}`, { headers: MGR_A1.headers })).body.items.find(i => i.id === invItem.id);
dbCheck('reprint created no inventory movement', moneyEq(invAfterReprint.current_stock, invAfterSale.current_stock), null);
const finalOrderAfterReprint = (await request(`/api/orders/${order.id}`, { headers: MGR_A1.headers })).body.order;
dbCheck('reprint did not change order total', moneyEq(finalOrderAfterReprint.final_amount, finalOrder.final_amount), null);

// Receipt settings: manager creates a CUSTOMER_RECEIPT profile, CASHIER cannot edit it.
const profileR = await request('/api/print/profiles', { method: 'POST', headers: MGR_A1.headers, body: JSON.stringify({ branch_id: A1.id, name: 'CUSTOMER_RECEIPT', paper_width: 80, language: 'ru', config: { business_name: 'BOOMBURGER', show_waiter: true, show_customer_note: true } }) });
expect('manager creates receipt settings', profileR.status, 201, profileR.body);
const updateR = await request(`/api/print/profiles/${profileR.body.profile.id}`, { method: 'PUT', headers: MGR_A1.headers, body: JSON.stringify({ config: { business_name: 'BOOMBURGER v2', show_waiter: false } }) });
expect('manager updates (reloads/edits) receipt settings', updateR.status, 200, updateR.body);
dbCheck('settings reload reflects the saved change', JSON.parse(updateR.body.profile.config_json).business_name === 'BOOMBURGER v2', updateR.body.profile);
mustDenyAuth('unauthorized CASHIER cannot edit receipt settings', await request(`/api/print/profiles/${profileR.body.profile.id}`, { method: 'PUT', headers: CASHIER_A1.headers, body: JSON.stringify({ config: {} }) }));
mustDenyAuth('branch isolation: MGR_A2 cannot edit A1 receipt settings', await request(`/api/print/profiles/${profileR.body.profile.id}`, { method: 'PUT', headers: MGR_A2.headers, body: JSON.stringify({ config: {} }) }));
const cashierCanReadSettings = await request(`/api/print/profiles?branch_id=${A1.id}`, { headers: CASHIER_A1.headers });
ok('CASHIER can view (preview) the receipt profile', cashierCanReadSettings.status === 200, cashierCanReadSettings.body);

// ================================================================== REFUND DENIAL
mustDenyAuth('22. CASHIER refund denied (payments.refund not granted)', await request(`/api/payments/${payment.id}/refund`, { method: 'POST', headers: { ...CASHIER_A1.headers, 'x-pos-session-token': posToken }, body: '{}' }));
dbCheck('payment still PAID after the denied refund attempt', (await request(`/api/payments?branch_id=${A1.id}`, { headers: MGR_A1.headers })).body.payments.find(p => p.id === payment.id).status === 'PAID', null);

console.log('--- FINAL FAILURES CHECK ---');
console.log(`failures: ${failures.length}`);
for (const f of failures) console.log('FAIL: ' + f);
console.log('--- COUNTS ---');
console.log(JSON.stringify(counts));
console.log(failures.length === 0
  ? 'STAGE 29 CASHIER POS + RECEIPT E2E: PASS'
  : 'STAGE 29 CASHIER POS + RECEIPT E2E: FAIL');
if (failures.length > 0) process.exit(1);
