// BOOM OS -- Stage 34.11: fresh-DB E2E proof of Food & Sales Analytics.
//
// Proves on REAL orders that: only COMPLETED orders count as sold; a cancelled order and an
// order still in progress are absent; a split order is counted ONCE, not once per bill; the two
// revenue figures are each correct and reconcile (items - discounts + service charge = net);
// average check is net revenue over orders; cost comes from the HISTORICAL recipe snapshot so a
// later recipe change cannot rewrite last week's margin; a compliment is a real zero-price line
// that consumes real food and is reported as a give-away instead of silently depressing a dish;
// the category roll-up equals its dishes; hour/weekday analytics use the BRANCH's timezone; the
// matrix publishes its medians and labels no dish; the drill-down traces a figure back to its
// order lines; and branch isolation and RBAC hold.
//
// Requires an empty database. Usage: node tests/stage34_11_analytics_e2e.mjs
const base = `http://127.0.0.1:${process.env.BOOM_OS_PORT || 3000}`;
const ownerPassword = process.env.STAGE3411_OWNER_PASSWORD || 'BoomStage3411Owner!';
const staffPassword = 'Stage3411StaffPass12345!';
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
function expect(step, got, want, body) { if (got !== want) failures.push(`${step}: expected ${want}, got ${got} -> ${String(JSON.stringify(body ?? null)).slice(0, 300)}`); }
function ok(step, cond, detail) { if (!cond) failures.push(`${step}: FAILED ${detail !== undefined ? '-> ' + JSON.stringify(detail).slice(0, 340) : ''}`); }
function mustDeny(label, r) {
  if (r.status >= 200 && r.status < 300) failures.push(`${label} -- returned ${r.status} (expected denial): ${JSON.stringify(r.body).slice(0, 260)}`);
  else if (![400, 401, 403, 404, 409, 501].includes(r.status)) failures.push(`${label} -- returned ${r.status}, not a recognized denial: ${JSON.stringify(r.body).slice(0, 260)}`);
  else counts.denials++;
}
function dbCheck(label, cond, detail) { counts.dbPost++; ok(`DB POST-CONDITION -- ${label}`, cond, detail); }
const money = v => Math.round(parseFloat(v) * 100);

const owner = await request('/api/auth/bootstrap', { method: 'POST', body: JSON.stringify({ full_name: 'S3411 Owner', email: `s3411owner-${stamp}@boom.local`, password: ownerPassword }) });
expect('bootstrap owner', owner.status, 201, owner.body);
const OWNER = { authorization: `Bearer ${owner.body.token}` };

const f = await request('/api/franchises', { method: 'POST', headers: OWNER, body: JSON.stringify({ name: 'S3411 F', code: `SB${stamp % 100000}`, legal_name: 'SB LLC', contact_name: 'x', phone: '+99326110', email: `sb-${stamp}@boom.local`, address: 'x' }) });
expect('create franchise', f.status, 201, f.body);
const FR = f.body.franchise.id;
async function makeBranch(tag) {
  const branch = await request('/api/branches', { method: 'POST', headers: OWNER, body: JSON.stringify({ name: `S3411 ${tag}`, code: `SB${tag}${stamp % 100000}`, address: 'x', phone: `+9932612${tag}`, franchise_id: FR }) });
  expect(`branch ${tag}`, branch.status, 201, branch.body);
  const id = branch.body.branch.id;
  await request(`/api/franchises/${FR}/branches/${id}`, { method: 'POST', headers: OWNER, body: '{}' });
  return id;
}
const B1 = await makeBranch('B1');
const B2 = await makeBranch('B2');
async function makeUser(label, branch, allowed, roles) {
  const email = `${label}-${stamp}@boom.local`.toLowerCase();
  const u = await request('/api/users', { method: 'POST', headers: OWNER, body: JSON.stringify({ full_name: `${label} Name`, email, phone: `+9942${Math.floor(Math.random() * 1000000)}`, password: staffPassword, branch_id: branch, roles, allowed_branches: allowed }) });
  expect(`create user ${label}`, u.status, 201, u.body);
  const login = await request('/api/auth/login', { method: 'POST', body: JSON.stringify({ login: email, password: staffPassword }) });
  expect(`login ${label}`, login.status, 200, login.body);
  return { label, id: u.body.user.id, headers: { authorization: `Bearer ${login.body.token}` } };
}
const MGR = await makeUser('m3411', B1, [B1], ['BRANCH_MANAGER']);
const MGR2 = await makeUser('m3411b2', B2, [B2], ['BRANCH_MANAGER']);
const CASHIER = await makeUser('c3411', B1, [B1], ['CASHIER']);
const WAITER = await makeUser('w3411', B1, [B1], ['WAITER']);

// A 10% service charge, so the reconciliation below has something real to reconcile.
expect('service charge 10%', (await request(`/api/service-charge/${B1}`, { method: 'PUT', headers: MGR.headers, body: JSON.stringify({ percent: '10.00', categories: [] }) })).status, 201);

const catA = (await request('/api/menu/categories', { method: 'POST', headers: MGR.headers, body: JSON.stringify({ branch_id: B1, name_ru: 'Горячее', name_tk: 'Yssy', sort_order: 0 }) })).body.category;
const catB = (await request('/api/menu/categories', { method: 'POST', headers: MGR.headers, body: JSON.stringify({ branch_id: B1, name_ru: 'Напитки', name_tk: 'Içgiler', sort_order: 1 }) })).body.category;
async function makeDish(cat, sku, price, ru, tk) {
  const r = await request('/api/menu/items', { method: 'POST', headers: MGR.headers, body: JSON.stringify({ branch_id: B1, category_id: cat.id, sku: `${sku}-${stamp}`, name_ru: ru, name_tk: tk, price, sort_order: 0 }) });
  expect(`menu item ${sku}`, r.status, 201, r.body);
  return r.body.item;
}
const PLOV = await makeDish(catA, 'SB-PLOV', '100.00', 'Плов', 'Palow');
const SOUP = await makeDish(catA, 'SB-SOUP', '50.00', 'Суп', 'Çorba');
const TEA = await makeDish(catB, 'SB-TEA', '10.00', 'Чай', 'Çaý');

// A real recipe for the plov, so its cost comes from a real ingredient at a real average cost.
const riceRes = await request('/api/inventory/items', { method: 'POST', headers: MGR.headers, body: JSON.stringify({ branch_id: B1, sku: `SB-RICE-${stamp}`, name: 'Рис', unit: 'kg', reorder_point: '1.0000' }) });
expect('create the rice ingredient', riceRes.status, 201, riceRes.body);
const RICE = riceRes.body.item;
const supRes = await request('/api/inventory/suppliers', { method: 'POST', headers: MGR.headers, body: JSON.stringify({ branch_id: B1, name: 'S3411 Supplier' }) });
expect('create the supplier', supRes.status, 201, supRes.body);
const SUPPLIER = supRes.body.supplier;
const rice1 = await request('/api/inventory/purchases', { method: 'POST', headers: MGR.headers, body: JSON.stringify({ branch_id: B1, supplier_id: SUPPLIER.id, items: [{ inventory_item_id: RICE.id, quantity: '100.0000', unit_cost: '20.00' }] }) });
expect('purchase rice at 20.00/kg', rice1.status, 201, rice1.body);
const recvRice = await request(`/api/inventory/purchases/${rice1.body.purchase.id}/receive`, { method: "POST", headers: MGR.headers });
expect("receive it", recvRice.status, 200, recvRice.body);
const recipeRes = await request('/api/inventory/recipes', { method: 'POST', headers: MGR.headers, body: JSON.stringify({ branch_id: B1, menu_item_id: PLOV.id, name: 'Plov recipe', yield_qty: '1.0000', ingredients: [{ inventory_item_id: RICE.id, quantity: '0.2000' }] }) });
expect('plov recipe: 0.2 kg rice at 20.00 = 4.0000 cost per portion', recipeRes.status, 201, recipeRes.body);

const area = (await request('/api/tables/areas', { method: 'POST', headers: MGR.headers, body: JSON.stringify({ branch_id: B1, name: 'Hall', sort_order: 0 }) })).body.area;
const tables = [];
for (let i = 0; i < 8; i++) tables.push((await request('/api/tables', { method: 'POST', headers: MGR.headers, body: JSON.stringify({ branch_id: B1, area_id: area.id, code: `TB${i}-${stamp % 10000}`, seats: 4 }) })).body.table);

expect('waiter code', (await request(`/api/waiters/${WAITER.id}/code`, { method: 'POST', headers: MGR.headers, body: JSON.stringify({ code: '7412' }) })).status, 201);
const W = { 'x-waiter-session': (await request('/api/waiters/authenticate-code', { method: 'POST', body: JSON.stringify({ code: '7412', deviceId: 'sb-dev' }) })).body.session.token };
const posToken = (await request('/api/operator-pos/unlock', { method: 'POST', headers: CASHIER.headers, body: JSON.stringify({ password: staffPassword, branch_id: B1, device_id: 'sb-cash' }) })).body.session_token;
expect('open shift', (await request('/api/cash-shifts', { method: 'POST', headers: CASHIER.headers, body: JSON.stringify({ branch_id: B1, opening_cash: '100.00' }) })).status, 201);

let tableIdx = 0;
async function placeOrder(items, orderType = 'DINE_IN') {
  const table = tables[tableIdx++ % tables.length];
  const r = await request('/api/orders', { method: 'POST', headers: { ...W, 'idempotency-key': `sb-${Date.now()}-${Math.random()}` }, body: JSON.stringify({ order_type: orderType, source: 'POS', ...(orderType === 'DINE_IN' ? { table_id: table.id } : {}), items }) });
  expect('place order', r.status, 201, r.body);
  return r.body.order;
}
async function driveToReady(order) {
  await request(`/api/orders/${order.id}/confirm`, { method: 'POST', headers: MGR.headers });
  const t = (await request(`/api/kds?branch_id=${B1}`, { headers: MGR.headers })).body.tickets.find(x => x.order_id === order.id);
  await request(`/api/kds/${t.id}/status`, { method: 'POST', headers: MGR.headers, body: JSON.stringify({ status: 'PREPARING' }) });
  await request(`/api/kds/${t.id}/status`, { method: 'POST', headers: MGR.headers, body: JSON.stringify({ status: 'READY' }) });
  return (await request(`/api/orders/${order.id}`, { headers: MGR.headers })).body.order;
}
async function payInFull(order, method = 'CASH') {
  const r = await request('/api/payments', { method: 'POST', headers: { ...CASHIER.headers, 'x-pos-session-token': posToken, 'idempotency-key': `sb-pay-${order.id}` }, body: JSON.stringify({ order_id: order.id, method, amount: order.final_amount }) });
  expect(`pay order ${order.order_number}`, r.status, 201, r.body);
  return order;
}

// ============================================================ 1. sold orders, and only sold orders
// A: 2 plov + 1 tea = 210.00 + 21.00 service = 231.00
const oA = await payInFull(await driveToReady(await placeOrder([{ menu_item_id: PLOV.id, quantity: 2 }, { menu_item_id: TEA.id, quantity: 1 }])));
// B: 1 plov + 2 soup = 200.00 + 20.00 service = 220.00
const oB = await payInFull(await driveToReady(await placeOrder([{ menu_item_id: PLOV.id, quantity: 1 }, { menu_item_id: SOUP.id, quantity: 2 }])));
// C: takeaway, 3 tea = 30.00 + service
const oC = await payInFull(await driveToReady(await placeOrder([{ menu_item_id: TEA.id, quantity: 3 }], 'TAKEAWAY')));

// D is never paid -- it is in progress, not a sale.
const openOrder = await driveToReady(await placeOrder([{ menu_item_id: PLOV.id, quantity: 5 }]));
// E is cancelled -- also not a sale.
const doomed = await placeOrder([{ menu_item_id: PLOV.id, quantity: 4 }]);
const closureReq = await request(`/api/orders/${doomed.id}/closure-requests`, { method: 'POST', headers: { ...CASHIER.headers, 'x-pos-session-token': posToken, 'idempotency-key': `sb-cl-${stamp}` }, body: JSON.stringify({ type: 'CANCELLATION', reason: 'guest left', inventory_treatment: 'NO_WRITE_OFF' }) });
expect('request a cancellation', closureReq.status, 201, closureReq.body);
const closureDecision = await request(`/api/orders/closure-requests/${closureReq.body.closure.id}/approve`, { method: 'POST', headers: { ...MGR.headers, 'idempotency-key': `sb-cld-${stamp}` }, body: '{}' });
expect('manager approves it', closureDecision.status, 200, closureDecision.body);
dbCheck('1e. the cancelled order really is closed, so its absence below means something', ['CANCELLED', 'CLOSED_BY_ESTABLISHMENT'].includes((await request(`/api/orders/${doomed.id}`, { headers: MGR.headers })).body.order.status), null);

const sales = await request(`/api/analytics/sales?branch_id=${B1}`, { headers: MGR.headers });
expect('1. the manager reads the period sales', sales.status, 200, sales.body);
const soldTotal = [oA, oB, oC].reduce((sum, o) => sum + money(o.final_amount), 0);
dbCheck('1a. exactly the three COMPLETED orders count as sold', sales.body.orders === 3, { orders: sales.body.orders });
dbCheck('1b. the revenue is exactly those three orders -- the unpaid and the cancelled order are absent', money(sales.body.net_revenue) === soldTotal, { net_revenue: sales.body.net_revenue, expected: soldTotal, unpaid: openOrder.final_amount, cancelled: doomed.final_amount });
dbCheck('1c. and neither excluded order leaks into any breakdown', money(sales.body.net_revenue) < soldTotal + money(openOrder.final_amount), { net_revenue: sales.body.net_revenue });
dbCheck('1d. the 10% service charge really applied, so the reconciliation below is not trivial', money(sales.body.service_charge) > 0, { service_charge: sales.body.service_charge });

// ============================================================ 2. the two revenue figures reconcile
const itemRev = money(sales.body.item_revenue), disc = money(sales.body.discounts), svc = money(sales.body.service_charge), net = money(sales.body.net_revenue);
dbCheck('2. THE IDENTITY: item revenue - discounts + service charge = net revenue', itemRev - disc + svc === net, { item_revenue: sales.body.item_revenue, discounts: sales.body.discounts, service_charge: sales.body.service_charge, net_revenue: sales.body.net_revenue });
dbCheck('2b. the average check is net revenue over the orders counted', money(sales.body.average_check) === Math.trunc(net / sales.body.orders), { average_check: sales.body.average_check, net, orders: sales.body.orders });
dbCheck('2c. takeaway is broken out separately from dine-in', sales.body.by_order_type.some(t => t.order_type === 'TAKEAWAY') && sales.body.by_order_type.some(t => t.order_type === 'DINE_IN'), sales.body.by_order_type);
dbCheck('2d. and the settlement methods are reported from real payments', sales.body.by_payment_method.some(m => m.method === 'CASH' && money(m.amount) === net), sales.body.by_payment_method);

// ============================================================ 3. a split order is counted ONCE
const splitOrder = await placeOrder([{ menu_item_id: PLOV.id, quantity: 1 }, { menu_item_id: SOUP.id, quantity: 1 }]);
const ready = await driveToReady(splitOrder);
const split = await request(`/api/orders/${ready.id}/bills/split`, { method: 'POST', headers: { ...MGR.headers, 'idempotency-key': `sb-sp-${stamp}` }, body: JSON.stringify({ mode: 'EQUAL', count: 2 }) });
expect('3. split the order into two checks', split.status, 201, split.body);
for (const bill of split.body.bills) {
  const r = await request('/api/payments', { method: 'POST', headers: { ...CASHIER.headers, 'x-pos-session-token': posToken, 'idempotency-key': `sb-bill-${bill.id}` }, body: JSON.stringify({ order_id: ready.id, bill_id: bill.id, method: 'CARD', amount: bill.final_amount }) });
  expect(`pay bill ${bill.id}`, r.status, 201, r.body);
}
const afterSplit = (await request(`/api/analytics/sales?branch_id=${B1}`, { headers: MGR.headers })).body;
dbCheck('3a. THE SPLIT ORDER IS ONE ORDER, not two', afterSplit.orders === 4, { orders: afterSplit.orders });
const splitFinal = money((await request(`/api/orders/${ready.id}`, { headers: MGR.headers })).body.order.final_amount);
dbCheck('3b. and its revenue is counted once, not once per bill', money(afterSplit.net_revenue) === net + splitFinal, { before: sales.body.net_revenue, after: afterSplit.net_revenue, order_final: splitFinal });
dbCheck('3c. the identity still holds after a split', money(afterSplit.item_revenue) - money(afterSplit.discounts) + money(afterSplit.service_charge) === money(afterSplit.net_revenue), afterSplit);

// ============================================================ 4. cost is HISTORICAL, never today's
const dishes = await request(`/api/analytics/dishes?branch_id=${B1}&sort=UNITS`, { headers: MGR.headers });
expect('4. the dish ranking', dishes.status, 200, dishes.body);
const plovRow = dishes.body.dishes.find(d => d.menu_item_id === PLOV.id);
dbCheck('4a. the plov sold 4 units across the paid orders', plovRow && plovRow.units_sold === 4, dishes.body.dishes.map(d => [d.name_ru, d.units_sold]));
dbCheck('4b. its cost is the REAL recipe cost at sale time (0.2 kg x 20.0000 = 4.00 each)', plovRow && money(plovRow.cost) === 1600, { cost: plovRow?.cost });
dbCheck('4c. and its margin is revenue minus that cost', plovRow && money(plovRow.margin) === money(plovRow.revenue) - money(plovRow.cost), { revenue: plovRow?.revenue, cost: plovRow?.cost, margin: plovRow?.margin });
dbCheck('4d. the ranking is sorted by what the manager asked for', dishes.body.sort === 'UNITS' && dishes.body.dishes.every((d, i, a) => i === 0 || a[i - 1].units_sold >= d.units_sold), dishes.body.dishes.map(d => d.units_sold));

// Now make the rice four times more expensive. History must not move.
const rice2 = await request('/api/inventory/purchases', { method: 'POST', headers: MGR.headers, body: JSON.stringify({ branch_id: B1, supplier_id: SUPPLIER.id, items: [{ inventory_item_id: RICE.id, quantity: '1000.0000', unit_cost: '100.00' }] }) });
expect('4e. rice is repurchased far more expensively', (await request(`/api/inventory/purchases/${rice2.body.purchase.id}/receive`, { method: 'POST', headers: MGR.headers })).status, 200);
const riceNow = (await request(`/api/inventory/items?branch_id=${B1}`, { headers: MGR.headers })).body.items.find(i => i.id === RICE.id);
dbCheck('4e2. the ingredient really is dearer now, so the next check is not vacuous', parseFloat(riceNow.average_cost) > 20, { average_cost: riceNow.average_cost });
const afterRepricing = (await request(`/api/analytics/dishes?branch_id=${B1}&sort=UNITS`, { headers: MGR.headers })).body.dishes.find(d => d.menu_item_id === PLOV.id);
dbCheck('4f. THE HISTORICAL RULE: last week\'s margin did not change when this week\'s ingredient did', money(afterRepricing.cost) === 1600 && afterRepricing.margin === plovRow.margin, { before: plovRow.cost, after: afterRepricing.cost });

// ============================================================ 5. a compliment is a give-away, not a discount
const compOrder = await driveToReady(await placeOrder([{ menu_item_id: SOUP.id, quantity: 1 }]));
const compReq = await request(`/api/orders/${compOrder.id}/compliments`, { method: 'POST', headers: { ...CASHIER.headers, 'x-pos-session-token': posToken, 'idempotency-key': `sb-comp-${stamp}` }, body: JSON.stringify({ menu_item_id: TEA.id, quantity: 1, reason: 'APOLOGY', comment: 'long wait' }) });
expect('5. a compliment is requested', compReq.status, 201, compReq.body);
const compDecision = await request(`/api/orders/compliment-requests/${compReq.body.compliment.id}/approve`, { method: 'POST', headers: { ...MGR.headers, 'idempotency-key': `sb-compd-${stamp}` }, body: '{}' });
expect('5b. and approved by a manager', compDecision.status, 200, compDecision.body);
const compReady = (await request(`/api/orders/${compOrder.id}`, { headers: MGR.headers })).body.order;
await payInFull(compReady);
const teaRow = (await request(`/api/analytics/dishes?branch_id=${B1}`, { headers: MGR.headers })).body.dishes.find(d => d.menu_item_id === TEA.id);
dbCheck('5c. THE GIVE-AWAY IS COUNTED AS A UNIT SOLD, because real food left the kitchen', teaRow.units_sold === 5, { units: teaRow.units_sold, give_away: teaRow.give_away_units });
dbCheck('5d. and reported AS a give-away rather than silently depressing the dish', teaRow.give_away_units === 1, teaRow);
dbCheck('5e. it added no revenue -- 4 paid teas at 10.00', money(teaRow.revenue) === 4000, { revenue: teaRow.revenue });
const salesWithComp = (await request(`/api/analytics/sales?branch_id=${B1}`, { headers: MGR.headers })).body;
dbCheck('5f. and it is NOT a discount -- the discount total is still zero', money(salesWithComp.discounts) === 0 && salesWithComp.give_away_units === 1, { discounts: salesWithComp.discounts, give_away_units: salesWithComp.give_away_units });

// ============================================================ 6. categories roll up from the same dishes
const cats = await request(`/api/analytics/categories?branch_id=${B1}`, { headers: MGR.headers });
expect('6. the category roll-up', cats.status, 200, cats.body);
const allDishes = (await request(`/api/analytics/dishes?branch_id=${B1}&limit=500`, { headers: MGR.headers })).body.dishes;
const hotDishes = allDishes.filter(d => d.category_id === catA.id);
const hotCat = cats.body.categories.find(c => c.category_id === catA.id);
dbCheck('6a. a category total is EXACTLY its dishes, never an independent query', hotCat && money(hotCat.revenue) === hotDishes.reduce((s, d) => s + money(d.revenue), 0) && hotCat.units_sold === hotDishes.reduce((s, d) => s + d.units_sold, 0), { category: hotCat, dishes: hotDishes.map(d => [d.name_ru, d.revenue]) });
dbCheck('6b. the category shares add up to the whole', cats.body.categories.reduce((s, c) => s + money(c.revenue), 0) === money(cats.body.total_revenue), cats.body.categories.map(c => c.revenue));

// ============================================================ 7. time analytics in the branch timezone
const time = await request(`/api/analytics/time?branch_id=${B1}`, { headers: MGR.headers });
expect('7. the time breakdown', time.status, 200, time.body);
dbCheck('7a. it is computed in the BRANCH\'s own timezone, not UTC', time.body.period.timezone === 'Asia/Ashgabat', time.body.period);
dbCheck('7b. every sold order appears in the hour breakdown exactly once', time.body.by_hour.reduce((s, h) => s + h.orders, 0) === salesWithComp.orders, { hours: time.body.by_hour, orders: salesWithComp.orders });
dbCheck('7c. and the weekday breakdown totals the same revenue', time.body.by_weekday.reduce((s, d) => s + money(d.net_revenue), 0) === money(salesWithComp.net_revenue), time.body.by_weekday);

// ============================================================ 8. the matrix measures, it does not judge
const matrix = await request(`/api/analytics/matrix?branch_id=${B1}`, { headers: MGR.headers });
expect('8. the menu matrix', matrix.status, 200, matrix.body);
dbCheck('8a. it publishes the medians it measured against', matrix.body.medians && typeof matrix.body.medians.units_sold === 'number' && /^\d+\.\d{2}$/.test(matrix.body.medians.margin_percent), matrix.body.medians);
dbCheck('8b. each dish is placed against those medians', matrix.body.dishes.every(d => typeof d.above_median_popularity === 'boolean'), matrix.body.dishes.map(d => [d.name_ru, d.units_sold, d.above_median_popularity]));
// Whole words only: the payload legitimately contains period.start, which merely CONTAINS 'star'.
const verdictWords = new RegExp('\\b(stars?|dogs?|puzzles?|workhorses?|ploughhorses?|best|worst|winners?|losers?|' + ['\u043b\u0443\u0447\u0448\u0438\u0439', '\u0445\u0443\u0434\u0448\u0438\u0439'].join('|') + ')\\b', 'i');
dbCheck('8c. THE MATRIX NAMES NO WINNERS: not one verdict word appears anywhere in the payload', !verdictWords.test(JSON.stringify(matrix.body)), JSON.stringify(matrix.body).match(verdictWords));

// ============================================================ 9. drill-down
const drill = await request(`/api/analytics/dishes/${PLOV.id}?branch_id=${B1}`, { headers: MGR.headers });
expect('9. the dish drill-down', drill.status, 200, drill.body);
dbCheck('9a. it traces the ranking figure back to the individual order lines', drill.body.lines.length >= 3 && drill.body.lines.reduce((s, l) => s + l.quantity, 0) === drill.body.summary.units_sold, { lines: drill.body.lines.length, units: drill.body.summary?.units_sold });
dbCheck('9b. each line names its order and carries its OWN historical cost', drill.body.lines.every(l => l.order_number) && drill.body.lines.every(l => l.recipe_cost_snapshot !== undefined), drill.body.lines.slice(0, 3).map(l => [l.order_number, l.quantity, l.recipe_cost_snapshot]));

// ============================================================ 10. a period really narrows
const future = (await request(`/api/analytics/sales?branch_id=${B1}&start=2100-01-01T00:00:00.000Z&end=2100-12-31T00:00:00.000Z`, { headers: MGR.headers })).body;
dbCheck('10. a period filter with no orders in it reports nothing, not everything', future.orders === 0 && money(future.net_revenue) === 0 && money(future.average_check) === 0, future);

// ============================================================ 11. RBAC and branch isolation
mustDeny('11. a cashier cannot read the analytics', await request(`/api/analytics/sales?branch_id=${B1}`, { headers: CASHIER.headers }));
mustDeny('11b. nor can a waiter', await request(`/api/analytics/dishes?branch_id=${B1}`, { headers: WAITER.headers }));
mustDeny('11c. a branch B2 manager cannot read branch B1 sales', await request(`/api/analytics/sales?branch_id=${B1}`, { headers: MGR2.headers }));
mustDeny('11d. nor its dish ranking', await request(`/api/analytics/dishes?branch_id=${B1}`, { headers: MGR2.headers }));
mustDeny('11e. nor its matrix', await request(`/api/analytics/matrix?branch_id=${B1}`, { headers: MGR2.headers }));
mustDeny('11f. nor drill into one of its dishes', await request(`/api/analytics/dishes/${PLOV.id}?branch_id=${B1}`, { headers: MGR2.headers }));
const b2Sales = await request(`/api/analytics/sales?branch_id=${B2}`, { headers: MGR2.headers });
dbCheck('11g. and their own branch, which sold nothing, reports zero rather than branch B1\'s figures', b2Sales.status === 200 && b2Sales.body.orders === 0, b2Sales.body);
dbCheck('12. the module is genuinely activated -- it never answers MODULE_NOT_ACTIVATED', sales.body.code !== 'MODULE_NOT_ACTIVATED' && matrix.body.code !== 'MODULE_NOT_ACTIVATED', null);

console.log(`\nStage 34.11 analytics E2E: ${counts.runtime} HTTP calls, ${counts.denials} denials, ${counts.dbPost} DB post-conditions`);
if (failures.length) { console.error(`\nFAILURES (${failures.length}):`); for (const f of failures) console.error(' - ' + f); process.exit(1); }
console.log('ALL STAGE 34.11 ANALYTICS CHECKS PASSED');
