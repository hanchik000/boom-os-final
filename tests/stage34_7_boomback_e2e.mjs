// BOOM OS -- Stage 34.7: fresh-DB E2E proof of BOOMBACK and breakfast redemption.
//
// BOOMBACK IS NOT A DISCOUNT. It is money the guest holds: paying 500 BOOMBACK against a 1000 order
// leaves 500 to settle in cash, and the order's subtotal / discount / final amount never move. When
// the balance exceeds the bill the guest may only spend what the bill is worth.
// A breakfast redemption is a REAL menu line at price 0 whose REAL recipe is consumed through the
// existing payment path -- no second inventory path, and the card's allowance decreases.
//
// Requires an empty database. Usage: node tests/stage34_7_boomback_e2e.mjs
const base = `http://127.0.0.1:${process.env.BOOM_OS_PORT || 3000}`;
const ownerPassword = process.env.STAGE347_OWNER_PASSWORD || 'BoomStage347Owner!';
const staffPassword = 'Stage347StaffPass12345!';
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

const owner = await request('/api/auth/bootstrap', { method: 'POST', body: JSON.stringify({ full_name: 'S347 Owner', email: `s347owner-${stamp}@boom.local`, password: ownerPassword }) });
expect('bootstrap owner', owner.status, 201, owner.body);
const OWNER = { authorization: `Bearer ${owner.body.token}` };

async function makeFranchise(tag) {
  const f = await request('/api/franchises', { method: 'POST', headers: OWNER, body: JSON.stringify({ name: `S347 F${tag}`, code: `S347${tag}${stamp % 100000}`, legal_name: `S347${tag} LLC`, contact_name: 'x', phone: `+9932311${tag}`, email: `s347${tag}-${stamp}@boom.local`, address: 'x' }) });
  expect(`create franchise ${tag}`, f.status, 201, f.body); return f.body.franchise.id;
}
async function makeBranch(tag, franchiseId) {
  const branch = await request('/api/branches', { method: 'POST', headers: OWNER, body: JSON.stringify({ name: `S347 B${tag}`, code: `S347${tag}${stamp % 100000}`, address: 'x', phone: `+9932312${tag}`, franchise_id: franchiseId }) });
  expect(`branch ${tag}`, branch.status, 201, branch.body);
  const id = branch.body.branch.id;
  await request(`/api/franchises/${franchiseId}/branches/${id}`, { method: 'POST', headers: OWNER, body: '{}' });
  return { tag, id, franchiseId };
}
async function makeUser(label, branch, allowed, roles) {
  const email = `${label}-${stamp}@boom.local`.toLowerCase();
  const u = await request('/api/users', { method: 'POST', headers: OWNER, body: JSON.stringify({ full_name: `${label} Name`, email, phone: `+9939${Math.floor(Math.random() * 1000000)}`, password: staffPassword, branch_id: branch, roles, allowed_branches: allowed }) });
  expect(`create user ${label}`, u.status, 201, u.body);
  const login = await request('/api/auth/login', { method: 'POST', body: JSON.stringify({ login: email, password: staffPassword }) });
  expect(`login ${label}`, login.status, 200, login.body);
  return { label, email, id: u.body.user.id, headers: { authorization: `Bearer ${login.body.token}` } };
}

const FA = await makeFranchise('A');
const A1 = await makeBranch('A1', FA);
const A2 = await makeBranch('A2', FA);
const MGR = await makeUser('m347a1', A1.id, [A1.id], ['BRANCH_MANAGER']);
const MGR_A2 = await makeUser('m347a2', A2.id, [A2.id], ['BRANCH_MANAGER']);
const CASHIER = await makeUser('c347a1', A1.id, [A1.id], ['CASHIER']);
const WAITER = await makeUser('w347a1', A1.id, [A1.id], ['WAITER']);

expect('service charge to 0%', (await request(`/api/service-charge/${A1.id}`, { method: 'PUT', headers: MGR.headers, body: JSON.stringify({ percent: '0.00', categories: [] }) })).status, 201);
const cat = await request('/api/menu/categories', { method: 'POST', headers: MGR.headers, body: JSON.stringify({ branch_id: A1.id, name_ru: 'Cat', name_tk: 'Cat', sort_order: 0 }) });
const mk = async (sku, price) => (await request('/api/menu/items', { method: 'POST', headers: MGR.headers, body: JSON.stringify({ branch_id: A1.id, category_id: cat.body.category.id, sku, name_ru: sku, name_tk: sku, price, sort_order: 0 }) })).body.item;
const DISH = await mk(`S347DISH-${stamp}`, '1000.00');
const OMELETTE = await mk(`S347OMELETTE-${stamp}`, '60.00');

// Real stock + a real recipe on the breakfast dish, so we can prove its ingredients are consumed.
const eggs = (await request('/api/inventory/items', { method: 'POST', headers: MGR.headers, body: JSON.stringify({ branch_id: A1.id, sku: `EGGS347-${stamp}`, name: 'Eggs', unit: 'pcs', reorder_point: '5' }) })).body.item;
const supplier = (await request('/api/inventory/suppliers', { method: 'POST', headers: MGR.headers, body: JSON.stringify({ branch_id: A1.id, name: 'S347 Supplier' }) })).body.supplier;
const purchase = await request('/api/inventory/purchases', { method: 'POST', headers: MGR.headers, body: JSON.stringify({ branch_id: A1.id, supplier_id: supplier.id, items: [{ inventory_item_id: eggs.id, quantity: '500', unit_cost: '1.50' }] }) });
await request(`/api/inventory/purchases/${purchase.body.purchase.id}/receive`, { method: 'POST', headers: MGR.headers });
await request('/api/inventory/recipes', { method: 'POST', headers: MGR.headers, body: JSON.stringify({ branch_id: A1.id, menu_item_id: OMELETTE.id, name: 'Omelette', yield_qty: '1', ingredients: [{ inventory_item_id: eggs.id, quantity: '3' }] }) });

const area = await request('/api/tables/areas', { method: 'POST', headers: MGR.headers, body: JSON.stringify({ branch_id: A1.id, name: 'Hall', sort_order: 0 }) });
const tables = [];
for (let i = 0; i < 5; i++) tables.push((await request('/api/tables', { method: 'POST', headers: MGR.headers, body: JSON.stringify({ branch_id: A1.id, area_id: area.body.area.id, code: `T347${i}-${stamp % 10000}`, seats: 4 }) })).body.table);

expect('issue waiter code', (await request(`/api/waiters/${WAITER.id}/code`, { method: 'POST', headers: MGR.headers, body: JSON.stringify({ code: '9501' }) })).status, 201);
const wAuth = await request('/api/waiters/authenticate-code', { method: 'POST', body: JSON.stringify({ code: '9501', deviceId: 's347-dev' }) });
const W = { 'x-waiter-session': wAuth.body.session.token };
const posToken = (await request('/api/operator-pos/unlock', { method: 'POST', headers: CASHIER.headers, body: JSON.stringify({ password: staffPassword, branch_id: A1.id, device_id: 's347-cash' }) })).body.session_token;
expect('open shift', (await request('/api/cash-shifts', { method: 'POST', headers: CASHIER.headers, body: JSON.stringify({ branch_id: A1.id, opening_cash: '50.00' }) })).status, 201);

const guest = (await request('/api/customers', { method: 'POST', headers: MGR.headers, body: JSON.stringify({ branch_id: A1.id, name: 'Boomback Guest', phone: `+99367${stamp % 1000000}` }) })).body.customer;

let tableIdx = 0;
async function openOrder(items, customerId) {
  const table = tables[tableIdx++ % tables.length];
  const o = await request('/api/orders', { method: 'POST', headers: { ...W, 'idempotency-key': `s347-${Date.now()}-${Math.random()}` }, body: JSON.stringify({ order_type: 'DINE_IN', source: 'POS', table_id: table.id, items }) });
  expect('create order', o.status, 201, o.body);
  if (customerId) await request(`/api/orders/${o.body.order.id}/customer`, { method: 'POST', headers: W, body: JSON.stringify({ customer_id: customerId }) });
  return o.body.order;
}
async function makeReady(order) {
  await request(`/api/orders/${order.id}/confirm`, { method: 'POST', headers: MGR.headers });
  const t = (await request(`/api/kds?branch_id=${A1.id}`, { headers: MGR.headers })).body.tickets.find(x => x.order_id === order.id);
  await request(`/api/kds/${t.id}/status`, { method: 'POST', headers: MGR.headers, body: JSON.stringify({ status: 'PREPARING' }) });
  await request(`/api/kds/${t.id}/status`, { method: 'POST', headers: MGR.headers, body: JSON.stringify({ status: 'READY' }) });
}
async function orderOf(id) { return (await request(`/api/orders/${id}`, { headers: MGR.headers })).body.order; }
async function boomback(customerId) { return (await request(`/api/loyalty/boomback/customers/${customerId}`, { headers: MGR.headers })).body; }
async function stock() { return Number((await request(`/api/inventory/items?branch_id=${A1.id}`, { headers: MGR.headers })).body.items.find(i => i.id === eggs.id).current_stock); }

// ================================================================== 1-3. GRANTING BOOMBACK
mustDeny('1. a cashier cannot grant BOOMBACK', await request('/api/loyalty/boomback/adjust', { method: 'POST', headers: CASHIER.headers, body: JSON.stringify({ customer_id: guest.id, amount: '500.00', reason: 'x' }) }));
mustDeny('1b. a grant without a reason is refused', await request('/api/loyalty/boomback/adjust', { method: 'POST', headers: MGR.headers, body: JSON.stringify({ customer_id: guest.id, amount: '500.00' }) }));
mustDeny('1c. branch isolation: a branch A2 manager cannot grant to a branch A1 guest', await request('/api/loyalty/boomback/adjust', { method: 'POST', headers: MGR_A2.headers, body: JSON.stringify({ customer_id: guest.id, amount: '500.00', reason: 'x' }) }));
const grant = await request('/api/loyalty/boomback/adjust', { method: 'POST', headers: MGR.headers, body: JSON.stringify({ customer_id: guest.id, amount: '500.00', reason: 'Campaign' }) });
expect('2. the manager grants 500.00 BOOMBACK', grant.status, 201, grant.body);
const bb0 = await boomback(guest.id);
dbCheck('2b. the balance is the SUM of the ledger, and the cache agrees', money(bb0.balance) === 50000 && money(bb0.cached_balance) === 50000, bb0);

// ================================================================== 3-7. THE WORKED EXAMPLE: 1000 = 500 BOOMBACK + 500 CASH
const order1 = await openOrder([{ menu_item_id: DISH.id, quantity: 1 }], guest.id);
dbCheck('3. the order is 1000.00', money(order1.final_amount) === 100000, order1);
await makeReady(order1);
const payBB = await request('/api/payments', { method: 'POST', headers: { ...CASHIER.headers, 'x-pos-session-token': posToken, 'idempotency-key': `s347-bb-${stamp}` }, body: JSON.stringify({ order_id: order1.id, method: 'BOOMBACK', amount: '500.00' }) });
expect('4. 500.00 is settled with BOOMBACK', payBB.status, 201, payBB.body);
const afterBB = await orderOf(order1.id);
dbCheck('4b. BOOMBACK IS NOT A DISCOUNT: subtotal, discount and final amount are all untouched', money(afterBB.subtotal) === 100000 && money(afterBB.discount) === 0 && money(afterBB.final_amount) === 100000, afterBB);
dbCheck('5. the order is NOT settled yet -- 500.00 is still owed', afterBB.status === 'READY', afterBB.status);
const bb1 = await boomback(guest.id);
dbCheck('5b. the guest\'s BOOMBACK balance dropped to zero', money(bb1.balance) === 0 && money(bb1.cached_balance) === 0, bb1);

mustDeny('6. paying the remaining 500.00 with the wrong cash amount is refused', await request('/api/payments', { method: 'POST', headers: { ...CASHIER.headers, 'x-pos-session-token': posToken, 'idempotency-key': `s347-wrong-${stamp}` }, body: JSON.stringify({ order_id: order1.id, method: 'CASH', amount: '1000.00' }) }));
const payCash = await request('/api/payments', { method: 'POST', headers: { ...CASHIER.headers, 'x-pos-session-token': posToken, 'idempotency-key': `s347-cash-${stamp}` }, body: JSON.stringify({ order_id: order1.id, method: 'CASH', amount: '500.00' }) });
expect('6b. the remaining 500.00 is settled in cash', payCash.status, 201, payCash.body);
dbCheck('7. only now does the order complete', (await orderOf(order1.id)).status === 'COMPLETED', await orderOf(order1.id));
const paymentsFor1 = (await request(`/api/payments?branch_id=${A1.id}`, { headers: MGR.headers })).body.payments.filter(p => p.order_id === order1.id);
dbCheck('7b. two payments, BOOMBACK and CASH, summing to the order total -- a payment line, not a price cut', paymentsFor1.length === 2 && paymentsFor1.reduce((s, p) => s + money(p.amount), 0) === 100000 && paymentsFor1.some(p => p.method === 'BOOMBACK'), paymentsFor1.map(p => [p.method, p.amount]));

// ================================================================== 8-9. BALANCE LARGER THAN THE BILL
expect('8. grant 520.00 BOOMBACK', (await request('/api/loyalty/boomback/adjust', { method: 'POST', headers: MGR.headers, body: JSON.stringify({ customer_id: guest.id, amount: '520.00', reason: 'Campaign 2' }) })).status, 201);
const order2 = await openOrder([{ menu_item_id: OMELETTE.id, quantity: 8 }], guest.id); // 480.00
await makeReady(order2);
mustDeny('8b. the guest cannot spend more BOOMBACK than the bill is worth', await request('/api/payments', { method: 'POST', headers: { ...CASHIER.headers, 'x-pos-session-token': posToken, 'idempotency-key': `s347-over-${stamp}` }, body: JSON.stringify({ order_id: order2.id, method: 'BOOMBACK', amount: '520.00' }) }));
const pay480 = await request('/api/payments', { method: 'POST', headers: { ...CASHIER.headers, 'x-pos-session-token': posToken, 'idempotency-key': `s347-480-${stamp}` }, body: JSON.stringify({ order_id: order2.id, method: 'BOOMBACK', amount: '480.00' }) });
expect('9. they settle the whole 480.00 bill with BOOMBACK', pay480.status, 201, pay480.body);
dbCheck('9b. the order completes and 40.00 BOOMBACK stays with the guest', (await orderOf(order2.id)).status === 'COMPLETED' && money((await boomback(guest.id)).balance) === 4000, await boomback(guest.id));

// ================================================================== 10-12. BOOMBACK NEEDS A GUEST, AND NEEDS BALANCE
const anonymous = await openOrder([{ menu_item_id: OMELETTE.id, quantity: 1 }], null);
await makeReady(anonymous);
mustDeny('10. an order with no guest cannot be paid with BOOMBACK', await request('/api/payments', { method: 'POST', headers: { ...CASHIER.headers, 'x-pos-session-token': posToken, 'idempotency-key': `s347-anon-${stamp}` }, body: JSON.stringify({ order_id: anonymous.id, method: 'BOOMBACK', amount: '60.00' }) }));
const order3 = await openOrder([{ menu_item_id: DISH.id, quantity: 1 }], guest.id);
await makeReady(order3);
mustDeny('11. a guest cannot spend BOOMBACK they do not have', await request('/api/payments', { method: 'POST', headers: { ...CASHIER.headers, 'x-pos-session-token': posToken, 'idempotency-key': `s347-nobal-${stamp}` }, body: JSON.stringify({ order_id: order3.id, method: 'BOOMBACK', amount: '100.00' }) }));
const ledger = (await request(`/api/loyalty/boomback/ledger?branch_id=${A1.id}&customer_id=${guest.id}`, { headers: MGR.headers })).body;
dbCheck('12. every entry records the balance before and after, and they reconcile to the balance', ledger.entries.every(e => money(e.balance_after) - money(e.balance_before) === money(e.amount)) && ledger.entries.reduce((s, e) => s + money(e.amount), 0) === 4000, ledger.entries.map(e => [e.type, e.amount, e.balance_before, e.balance_after]));

// ================================================================== 13-16. BREAKFAST REDEMPTION CONSUMES REAL INVENTORY
const cardR = await request('/api/boomcard', { method: 'POST', headers: MGR.headers, body: JSON.stringify({ customer_id: guest.id }) });
expect('13. create the guest a card', cardR.status, 201, cardR.body);
const cardId = cardR.body.card.id;
mustDeny('13b. a CANDIDATE card cannot redeem a breakfast', await request(`/api/boomcard/${cardId}/breakfast/redeem`, { method: 'POST', headers: MGR.headers, body: JSON.stringify({ order_id: order3.id, menu_item_id: OMELETTE.id, quantity: 1 }) }));
const activated = await request(`/api/boomcard/${cardId}/activate`, { method: 'POST', headers: MGR.headers, body: JSON.stringify({ breakfasts: 2 }) });
dbCheck('13c. activation grants 2 breakfasts', activated.body.card.breakfast_granted === 2 && activated.body.card.breakfast_used === 0, activated.body.card);

const order4 = await openOrder([{ menu_item_id: DISH.id, quantity: 1 }], guest.id);
const before4 = await orderOf(order4.id);
const stockBefore = await stock();
const redeem = await request(`/api/boomcard/${cardId}/breakfast/redeem`, { method: 'POST', headers: MGR.headers, body: JSON.stringify({ order_id: order4.id, menu_item_id: OMELETTE.id, quantity: 2 }) });
expect('14. redeem 2 breakfasts onto the open order', redeem.status, 201, redeem.body);
dbCheck('14b. the card allowance drops to 2/2 used', redeem.body.card.breakfast_used === 2, redeem.body.card);
const after4 = await orderOf(order4.id);
const breakfastLine = after4.items.find(i => i.id === redeem.body.order_item_id);
dbCheck('15. it is a REAL order line at a customer price of 0, so the bill does not grow', breakfastLine && money(breakfastLine.price_snapshot) === 0 && breakfastLine.quantity === 2 && money(after4.final_amount) === money(before4.final_amount), { line: breakfastLine, before: before4.final_amount, after: after4.final_amount });
mustDeny('15b. a third breakfast is refused -- the allowance is exhausted', await request(`/api/boomcard/${cardId}/breakfast/redeem`, { method: 'POST', headers: MGR.headers, body: JSON.stringify({ order_id: order4.id, menu_item_id: OMELETTE.id, quantity: 1 }) }));

await makeReady(order4);
const pay4 = await request('/api/payments', { method: 'POST', headers: { ...CASHIER.headers, 'x-pos-session-token': posToken, 'idempotency-key': `s347-bf-${stamp}` }, body: JSON.stringify({ order_id: order4.id, method: 'CASH', amount: after4.final_amount }) });
expect('16. the order is settled', pay4.status, 201, pay4.body);
dbCheck('16b. the breakfast consumed its REAL ingredients through the existing payment path: 2 x 3 = 6 eggs', stockBefore - (await stock()) === 6, { before: stockBefore, after: await stock() });
const paidItems = (await orderOf(order4.id)).items;
const paidBreakfast = paidItems.find(i => i.id === redeem.body.order_item_id);
dbCheck('16c. and its real cost is recorded even though the guest paid nothing for it', money(paidBreakfast.price_snapshot) === 0 && Number(paidBreakfast.recipe_cost_snapshot) > 0, paidBreakfast);
const cardAfter = (await request(`/api/boomcard/${cardId}`, { headers: MGR.headers })).body;
dbCheck('16d. the redemption is recorded in the card\'s own event ledger, separate from BOOMBACK', cardAfter.events.some(e => e.type === 'BREAKFAST_REDEEMED' && e.quantity === 2), cardAfter.events.map(e => [e.type, e.quantity]));
const cabinet = (await request(`/api/boomcard/cabinet/${cardAfter.card.cabinet_token}`)).body;
dbCheck('16e. the guest\'s cabinet shows the used/remaining breakfasts and their real cashback balance', cabinet.breakfast.granted === 2 && cabinet.breakfast.used === 2 && cabinet.breakfast.remaining === 0 && money(cabinet.cashback_balance) === 4000, cabinet);

// ================================================================== 17-19. CASHBACK IS OFF BY DEFAULT, AND CONFIGURABLE
const bbBeforeCashback = await boomback(guest.id);
const order5 = await openOrder([{ menu_item_id: OMELETTE.id, quantity: 1 }], guest.id);
await makeReady(order5);
await request('/api/payments', { method: 'POST', headers: { ...CASHIER.headers, 'x-pos-session-token': posToken, 'idempotency-key': `s347-nocb-${stamp}` }, body: JSON.stringify({ order_id: order5.id, method: 'CASH', amount: '60.00' }) });
dbCheck('17. with cashback OFF by default, settling earns no BOOMBACK', money((await boomback(guest.id)).balance) === money(bbBeforeCashback.balance), await boomback(guest.id));

expect('18. enable cashback at 10%', (await request('/api/settings/BOOMBACK_CASHBACK_ENABLED', { method: 'PUT', headers: OWNER, body: JSON.stringify({ value: 'true' }) })).status, 200);
expect('18b. set the percentage', (await request('/api/settings/BOOMBACK_CASHBACK_PERCENT', { method: 'PUT', headers: OWNER, body: JSON.stringify({ value: '10' }) })).status, 200);
const bbBefore6 = await boomback(guest.id);
const order6 = await openOrder([{ menu_item_id: DISH.id, quantity: 1 }], guest.id);
await makeReady(order6);
const pay6 = await request('/api/payments', { method: 'POST', headers: { ...CASHIER.headers, 'x-pos-session-token': posToken, 'idempotency-key': `s347-cb-${stamp}` }, body: JSON.stringify({ order_id: order6.id, method: 'CASH', amount: '1000.00' }) });
expect('18c. settle 1000.00', pay6.status, 201, pay6.body);
dbCheck('19. an ACTIVE card holder earns 10% of what they settled: +100.00', money((await boomback(guest.id)).balance) - money(bbBefore6.balance) === 10000, { before: bbBefore6.balance, after: (await boomback(guest.id)).balance });

// ================================================================== 20-22. REFUND GIVES BOOMBACK BACK
const bbBeforeRefund = await boomback(guest.id);
const closure = await request(`/api/orders/${order6.id}/closure-requests`, { method: 'POST', headers: CASHIER.headers, body: JSON.stringify({ type: 'CLOSED_BY_ESTABLISHMENT', reason: 'Quality', inventory_treatment: 'WRITE_OFF', refund_requested: true }) });
expect('20. request a refund of the cashback-earning order', closure.status, 201, closure.body);
expect('20b. manager approves', (await request(`/api/orders/closure-requests/${closure.body.closure.id}/approve`, { method: 'POST', headers: MGR.headers, body: '{}' })).status, 200);
dbCheck('21. the cashback earned on it is taken back: -100.00', money((await boomback(guest.id)).balance) - money(bbBeforeRefund.balance) === -10000, { before: bbBeforeRefund.balance, after: (await boomback(guest.id)).balance });

const bbBeforeSpentRefund = await boomback(guest.id);
const closure2 = await request(`/api/orders/${order2.id}/closure-requests`, { method: 'POST', headers: CASHIER.headers, body: JSON.stringify({ type: 'CANCELLATION', reason: 'Complaint', inventory_treatment: 'WRITE_OFF', refund_requested: true }) });
expect('22. refund the order that was PAID with BOOMBACK', closure2.status, 201, closure2.body);
expect('22b. manager approves', (await request(`/api/orders/closure-requests/${closure2.body.closure.id}/approve`, { method: 'POST', headers: MGR.headers, body: '{}' })).status, 200);
dbCheck('22c. the 480.00 the guest spent comes back to them, as its own ledger row', money((await boomback(guest.id)).balance) - money(bbBeforeSpentRefund.balance) === 48000, { before: bbBeforeSpentRefund.balance, after: (await boomback(guest.id)).balance });
const ledgerFinal = (await request(`/api/loyalty/boomback/ledger?branch_id=${A1.id}&customer_id=${guest.id}`, { headers: MGR.headers })).body;
dbCheck('22d. nothing was edited or deleted -- reversals are their own REVERSED rows', ledgerFinal.entries.filter(e => e.type === 'REVERSED').length === 2 && ledgerFinal.entries.filter(e => e.type === 'REDEEMED').length === 2, ledgerFinal.entries.map(e => e.type));

const audit = (await request(`/api/audit?branch_id=${A1.id}&limit=400`, { headers: OWNER })).body.logs || [];
const actions = new Set(audit.map(a => a.action));
dbCheck('23. grant, redemption, cashback and reversal are all audited', ['BOOMBACK_ADJUSTED', 'BOOMBACK_REDEEMED', 'BOOMBACK_EARNED', 'BOOMBACK_REVERSED', 'BOOMCARD_BREAKFAST_REDEEMED'].every(a => actions.has(a)), [...actions].filter(a => a.includes('BOOMBACK') || a.includes('BREAKFAST')));

console.log(`\nStage 34.7 BOOMBACK E2E: ${counts.runtime} HTTP calls, ${counts.denials} denials, ${counts.dbPost} DB post-conditions`);
if (failures.length) { console.error(`\nFAILURES (${failures.length}):`); for (const f of failures) console.error(' - ' + f); process.exit(1); }
console.log('ALL STAGE 34.7 BOOMBACK CHECKS PASSED');
