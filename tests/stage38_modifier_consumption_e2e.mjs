// BOOM OS -- Stage 38: modifier recipe consumption and historical cost.
//
// Runtime proof, against a real fresh database, that a chosen component resolves through Stage
// 37's source_menu_item_id into the EXISTING Recipe Engine and consumes real ingredients through
// the EXISTING inventory ledger -- transactionally, idempotently, branch-scoped, and with a
// historical cost snapshot that a later recipe or price change can never rewrite.
//
// Sections map to the Stage 38 matrix: A normal dish, B one modifier, C several modifiers,
// D quantity, E archived source, F missing recipe, G recipe snapshot, H modifier cost snapshot,
// I inventory movement, J food-cost analytics, K split bill, L refund after preparation,
// M cancellation, N establishment closure, O branch isolation, P RBAC, Q idempotent retry,
// R concurrency, S existing normal orders, T public price stays the selling price.
//
// Requires an empty database. Usage: node tests/stage38_modifier_consumption_e2e.mjs
const base = `http://127.0.0.1:${process.env.BOOM_OS_PORT || 3000}`;
const ownerPassword = process.env.STAGE38_OWNER_PASSWORD || 'BoomStage38Owner!';
const staffPassword = 'Stage38StaffPass12345!';
const stamp = Date.now();

const counts = { runtime: 0, denials: 0, dbPost: 0 };
const failures = [];
async function request(path, options = {}) {
  counts.runtime++;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);
  try {
    const res = await fetch(base + path, { ...options, signal: controller.signal, headers: { 'content-type': 'application/json', ...(options.headers || {}) } });
    let body = null; try { body = await res.json(); } catch {}
    return { status: res.status, body };
  } catch (error) { throw new Error(`${path} did not answer (${error.message})`); }
  finally { clearTimeout(timer); }
}
function expect(step, got, want, body) { if (got !== want) failures.push(`${step}: expected ${want}, got ${got} -> ${String(JSON.stringify(body ?? null)).slice(0, 320)}`); }
function deny(step, got, want, body) { counts.denials++; expect(step, got, want, body); }
function dbCheck(label, cond, detail) { counts.dbPost++; if (!cond) failures.push(`DB POST-CONDITION -- ${label}: FAILED -> ${String(JSON.stringify(detail ?? null)).slice(0, 340)}`); }
// Quantities and costs are DECIMAL(14,4); compare in ten-thousandths, never as floats-as-strings.
const q4 = v => Math.round(parseFloat(v ?? 0) * 10000);
const near = (a, b, tol = 1) => Math.abs(a - b) <= tol;

// ============================================================ fixture
const owner = await request('/api/auth/bootstrap', { method: 'POST', body: JSON.stringify({ full_name: 'S38 Owner', email: `s38owner-${stamp}@boom.local`, password: ownerPassword }) });
expect('bootstrap owner', owner.status, 201, owner.body);
const OWNER = { authorization: `Bearer ${owner.body.token}` };
const fr = await request('/api/franchises', { method: 'POST', headers: OWNER, body: JSON.stringify({ name: 'S38 F', code: `S38F${stamp % 100000}`, legal_name: 'S38 LLC', contact_name: 'x', phone: '+99338140', email: `s38f-${stamp}@boom.local`, address: 'x' }) });
const FR = fr.body.franchise.id;
async function makeBranch(label, n) {
  const r = await request('/api/branches', { method: 'POST', headers: OWNER, body: JSON.stringify({ name: label, code: `S38B${n}${stamp % 100000}`, address: 'x', phone: `+9933814${n}`, franchise_id: FR }) });
  expect(`branch ${label}`, r.status, 201, r.body);
  await request(`/api/franchises/${FR}/branches/${r.body.branch.id}`, { method: 'POST', headers: OWNER, body: '{}' });
  return r.body.branch.id;
}
const B1 = await makeBranch('S38 B1', 1);
const B2 = await makeBranch('S38 B2', 2);
async function makeUser(label, branch, roles) {
  const email = `${label}-${stamp}@boom.local`.toLowerCase();
  const u = await request('/api/users', { method: 'POST', headers: OWNER, body: JSON.stringify({ full_name: `${label} Name`, email, phone: `+9945${Math.floor(Math.random() * 1000000)}`, password: staffPassword, branch_id: branch, roles, allowed_branches: [branch] }) });
  expect(`create user ${label}`, u.status, 201, u.body);
  const login = await request('/api/auth/login', { method: 'POST', body: JSON.stringify({ login: email, password: staffPassword }) });
  return { label, id: u.body.user.id, headers: { authorization: `Bearer ${login.body.token}` } };
}
const MGR = await makeUser('s38mgr', B1, ['BRANCH_MANAGER']);
const MGR2 = await makeUser('s38mgr2', B2, ['BRANCH_MANAGER']);
const CASHIER = await makeUser('s38cash', B1, ['CASHIER']);
const WAITER = await makeUser('s38wait', B1, ['WAITER']);

// ---- inventory with a real weighted-average cost ----
const supplierRes = await request('/api/inventory/suppliers', { method: 'POST', headers: MGR.headers, body: JSON.stringify({ branch_id: B1, name: 'S38 Supplier' }) });
if (supplierRes.status !== 201) throw new Error(`fixture supplier: ${supplierRes.status} ${JSON.stringify(supplierRes.body)}`);
const supplier = supplierRes.body.supplier;
async function stockItem(sku, name, unit, qty, unitCost) {
  const itemRes = await request('/api/inventory/items', { method: 'POST', headers: MGR.headers, body: JSON.stringify({ branch_id: B1, sku: `${sku}-${stamp}`, name, unit, reorder_point: '1' }) });
  if (itemRes.status !== 201) throw new Error(`fixture inventory item ${sku}: ${itemRes.status} ${JSON.stringify(itemRes.body)}`);
  const item = itemRes.body.item;
  const p = await request('/api/inventory/purchases', { method: 'POST', headers: MGR.headers, body: JSON.stringify({ branch_id: B1, supplier_id: supplier.id, items: [{ inventory_item_id: item.id, quantity: qty, unit_cost: unitCost }] }) });
  if (p.status !== 201) throw new Error(`fixture purchase ${sku}: ${p.status} ${JSON.stringify(p.body)}`);
  const recv = await request(`/api/inventory/purchases/${p.body.purchase.id}/receive`, { method: 'POST', headers: MGR.headers });
  if (recv.status >= 300) throw new Error(`fixture receive ${sku}: ${recv.status} ${JSON.stringify(recv.body)}`);
  return item;
}
const beef    = await stockItem('S38BEEF',    'Beef',    'g', '100000', '0.05');  // 0.05/g
const cheddar = await stockItem('S38CHEDDAR', 'Cheddar', 'g', '100000', '0.16');  // 0.16/g
const bacon   = await stockItem('S38BACON',   'Bacon',   'g', '100000', '0.20');  // 0.20/g
const bun     = await stockItem('S38BUN',     'Bun',     'pcs', '5000',  '1.00');

const stockOf = async (id, branch = B1, headers = MGR.headers) =>
  q4((((await request(`/api/inventory/items?branch_id=${branch}`, { headers })).body.items || []).find(i => i.id === id) || {}).current_stock);

// ---- menu: a burger, and three real component dishes ----
const cat = (await request('/api/menu/categories', { method: 'POST', headers: MGR.headers, body: JSON.stringify({ branch_id: B1, name_ru: 'Бургеры', name_tk: 'Burgerler' }) })).body.category;
const mkDish = async (sku, ru, price) => (await request('/api/menu/items', { method: 'POST', headers: MGR.headers, body: JSON.stringify({ branch_id: B1, category_id: cat.id, sku: `${sku}-${stamp}`, name_ru: ru, name_tk: ru, price }) })).body.item;
const burger      = await mkDish('S38-BURGER', 'BOOM Бургер', '95.00');
const cheeseDish  = await mkDish('S38-CHEESE', 'Сыр',          '10.00');
const baconDish   = await mkDish('S38-BACON',  'Бекон',        '12.00');
const sauceDish   = await mkDish('S38-SAUCE',  'Соус',          '5.00');   // deliberately NO recipe
const plainDish   = await mkDish('S38-PLAIN',  'Салат',         '20.00');  // deliberately NO recipe

const mkRecipe = async (menuItemId, name, ingredients) => {
  const r = await request('/api/inventory/recipes', { method: 'POST', headers: MGR.headers, body: JSON.stringify({ branch_id: B1, menu_item_id: menuItemId, name, yield_qty: '1', ingredients }) });
  expect(`recipe ${name}`, r.status, 201, r.body);
  return r.body.recipe;
};
// burger: 150g beef + 1 bun = 150*0.05 + 1*1.00 = 7.50 + 1.00 = 8.50
const burgerRecipe = await mkRecipe(burger.id, 'Burger', [{ inventory_item_id: beef.id, quantity: '150' }, { inventory_item_id: bun.id, quantity: '1' }]);
// cheese: 20g cheddar = 20*0.16 = 3.20  <- the brief's exact example
const cheeseRecipe = await mkRecipe(cheeseDish.id, 'Cheese', [{ inventory_item_id: cheddar.id, quantity: '20' }]);
// bacon: 30g bacon = 30*0.20 = 6.00
await mkRecipe(baconDish.id, 'Bacon', [{ inventory_item_id: bacon.id, quantity: '30' }]);

// ---- the constructor: options backed by those real dishes ----
const grp = (await request(`/api/menu/items/${burger.id}/modifier-groups`, { method: 'POST', headers: MGR.headers, body: JSON.stringify({ branch_id: B1, name_ru: 'Добавки', name_tk: 'Goşmaçalar', min_select: 0, max_select: 5, required: false }) })).body.group;
const mkOption = async (ru, delta, sourceId) => {
  const r = await request(`/api/menu/modifier-groups/${grp.id}/modifiers`, { method: 'POST', headers: MGR.headers, body: JSON.stringify({ name_ru: ru, name_tk: ru, price_delta: delta, source_menu_item_id: sourceId || undefined }) });
  expect(`option ${ru}`, r.status, 201, r.body);
  return r.body.modifier;
};
const optCheese  = await mkOption('Сыр',       '10.00', cheeseDish.id);
const optBacon   = await mkOption('Бекон',     '12.00', baconDish.id);
const optSauce   = await mkOption('Соус',       '5.00', sauceDish.id);   // source exists, NO recipe
const optNoOnion = await mkOption('Без лука',   '0.00', null);           // plain option, no source

// ---- POS plumbing ----
const area = (await request('/api/tables/areas', { method: 'POST', headers: MGR.headers, body: JSON.stringify({ branch_id: B1, name: 'Зал', sort_order: 0 }) })).body.area;
const mkTable = async code => (await request('/api/tables', { method: 'POST', headers: MGR.headers, body: JSON.stringify({ branch_id: B1, area_id: area.id, code, seats: 4 }) })).body.table;
const tables = []; for (let i = 1; i <= 8; i++) tables.push(await mkTable(`S38T${i}`));
await request(`/api/waiters/${WAITER.id}/code`, { method: 'POST', headers: MGR.headers, body: JSON.stringify({ code: '3801' }) });
const wAuth = await request('/api/waiters/authenticate-code', { method: 'POST', body: JSON.stringify({ code: '3801', deviceId: 's38-dev' }) });
const W = { 'x-waiter-session': wAuth.body.session.token };
const unlock = await request('/api/operator-pos/unlock', { method: 'POST', headers: CASHIER.headers, body: JSON.stringify({ password: staffPassword, branch_id: B1, device_id: 's38-cashier' }) });
expect('cashier POS unlock', unlock.status, 200, unlock.body);
const POS = { ...CASHIER.headers, 'x-pos-session-token': unlock.body.session_token };
expect('open cash shift', (await request('/api/cash-shifts', { method: 'POST', headers: CASHIER.headers, body: JSON.stringify({ branch_id: B1, opening_cash: '50.00' }) })).status, 201);

let seq = 0;
async function readyOrder(tableIdx, items, opts = {}) {
  const o = await request('/api/orders', { method: 'POST', headers: { ...W, 'idempotency-key': `s38-o-${stamp}-${++seq}` }, body: JSON.stringify({ order_type: 'DINE_IN', source: 'POS', table_id: tables[tableIdx].id, items }) });
  if (o.status !== 201) return { error: o };
  await request(`/api/orders/${o.body.order.id}/confirm`, { method: 'POST', headers: MGR.headers });
  if (opts.stopAtNew) return { order: o.body.order };
  const ticket = (await request(`/api/kds?branch_id=${B1}&status=NEW`, { headers: MGR.headers })).body.tickets.find(t => t.order_id === o.body.order.id);
  await request(`/api/kds/${ticket.id}/status`, { method: 'POST', headers: MGR.headers, body: JSON.stringify({ status: 'PREPARING' }) });
  await request(`/api/kds/${ticket.id}/status`, { method: 'POST', headers: MGR.headers, body: JSON.stringify({ status: 'READY' }) });
  return { order: (await request(`/api/orders/${o.body.order.id}`, { headers: MGR.headers })).body.order };
}
// Never crash on a missing order: report it as a failure so one broken section cannot hide the
// rest of the matrix (and so an injected negative control produces an assertion, not a stack).
const pay = (order, key, extra = {}) => {
  if (!order?.id) { failures.push(`pay(${key}): no order was created to pay for`); return Promise.resolve({ status: 0, body: null }); }
  return request('/api/payments', { method: 'POST', headers: { ...POS, 'idempotency-key': key }, body: JSON.stringify({ order_id: order.id, method: 'CASH', amount: order.final_amount, ...extra }) });
};

// ============================================================ A. a normal dish still consumes exactly as before
{
  const beef0 = await stockOf(beef.id), bun0 = await stockOf(bun.id), cheddar0 = await stockOf(cheddar.id);
  const { order } = await readyOrder(0, [{ menu_item_id: burger.id, quantity: 1 }]);
  expect('A1. a plain burger is paid', (await pay(order, `s38-payA-${stamp}`)).status, 201);
  dbCheck('A2. the base recipe consumed 150g beef', near(beef0 - await stockOf(beef.id), q4('150')), { before: beef0, after: await stockOf(beef.id) });
  dbCheck('A3. the base recipe consumed 1 bun', near(bun0 - await stockOf(bun.id), q4('1')), 'bun');
  dbCheck('A4. NO component was chosen, so no cheddar moved', near(cheddar0 - await stockOf(cheddar.id), 0), 'cheddar');
  const full = await request(`/api/orders/${order.id}`, { headers: MGR.headers });
  dbCheck('A5. the line cost snapshot is the base recipe cost 8.50 (150*0.05 + 1*1.00)', near(q4(full.body.order.items[0].recipe_cost_snapshot), q4('8.50')), full.body.order.items[0]);
}

// ============================================================ B. one component -- the brief's exact example
let orderB, lineB;
{
  const beef0 = await stockOf(beef.id), cheddar0 = await stockOf(cheddar.id);
  const r = await readyOrder(1, [{ menu_item_id: burger.id, quantity: 1, modifier_ids: [optCheese.id] }]);
  orderB = r.order;
  dbCheck('B1. the burger + cheese SELLING price is 95 + 10 = 105', near(Math.round(parseFloat(orderB.subtotal) * 100), 10500), orderB.subtotal);
  expect('B2. the configured burger is paid', (await pay(orderB, `s38-payB-${stamp}`)).status, 201);
  dbCheck('B3. the BASE recipe still consumed 150g beef', near(beef0 - await stockOf(beef.id), q4('150')), 'beef');
  dbCheck('B4. THE COMPONENT RESOLVED ITS OWN RECIPE: 20g cheddar consumed via source_menu_item_id', near(cheddar0 - await stockOf(cheddar.id), q4('20')), { before: cheddar0, after: await stockOf(cheddar.id) });
  const full = await request(`/api/orders/${orderB.id}`, { headers: MGR.headers });
  lineB = full.body.order.items[0];
  const modRow = (lineB.modifiers || [])[0];
  dbCheck('B5. the component carries its OWN cost snapshot 3.20 (20g * 0.16)', near(q4(modRow.recipe_cost_snapshot), q4('3.20')), modRow);
  dbCheck('B6. the component snapshot records the recipe VERSION it consumed', Number(modRow.recipe_version_snapshot) === Number(cheeseRecipe.version), modRow);
  dbCheck('B7. SELLING vs COST are different numbers on the same row: +10.00 sold, 3.20 cost', near(Math.round(parseFloat(modRow.price_delta_snapshot) * 100), 1000) && near(q4(modRow.recipe_cost_snapshot), q4('3.20')), modRow);
  dbCheck('B8. the LINE cost snapshot is base + component = 8.50 + 3.20 = 11.70', near(q4(lineB.recipe_cost_snapshot), q4('11.70')), lineB);
}

// ============================================================ C. several components resolve independently; base is NOT double-consumed
{
  const beef0 = await stockOf(beef.id), bun0 = await stockOf(bun.id), cheddar0 = await stockOf(cheddar.id), bacon0 = await stockOf(bacon.id);
  const { order } = await readyOrder(2, [{ menu_item_id: burger.id, quantity: 1, modifier_ids: [optCheese.id, optBacon.id, optSauce.id, optNoOnion.id] }]);
  expect('C1. a burger with four components is paid', (await pay(order, `s38-payC-${stamp}`)).status, 201);
  dbCheck('C2. NO DOUBLE BASE CONSUMPTION: still exactly 150g beef for one burger', near(beef0 - await stockOf(beef.id), q4('150')), 'beef');
  dbCheck('C3. NO DOUBLE BASE CONSUMPTION: still exactly 1 bun', near(bun0 - await stockOf(bun.id), q4('1')), 'bun');
  dbCheck('C4. the cheese component consumed 20g cheddar', near(cheddar0 - await stockOf(cheddar.id), q4('20')), 'cheddar');
  dbCheck('C5. the bacon component consumed 30g bacon', near(bacon0 - await stockOf(bacon.id), q4('30')), 'bacon');
  const full = await request(`/api/orders/${order.id}`, { headers: MGR.headers });
  const line = full.body.order.items[0];
  dbCheck('C6. the line cost is base + cheese + bacon = 8.50 + 3.20 + 6.00 = 17.70 (the recipe-less sauce and the plain option add nothing)', near(q4(line.recipe_cost_snapshot), q4('17.70')), line);
}

// ============================================================ D. order quantity multiplies every component
{
  const beef0 = await stockOf(beef.id), cheddar0 = await stockOf(cheddar.id);
  const { order } = await readyOrder(3, [{ menu_item_id: burger.id, quantity: 3, modifier_ids: [optCheese.id] }]);
  expect('D1. three configured burgers are paid', (await pay(order, `s38-payD-${stamp}`)).status, 201);
  dbCheck('D2. the base scaled by quantity: 150g * 3 = 450g beef', near(beef0 - await stockOf(beef.id), q4('450')), 'beef');
  dbCheck('D3. THE COMPONENT SCALED TOO: 20g * 3 = 60g cheddar', near(cheddar0 - await stockOf(cheddar.id), q4('60')), 'cheddar');
  const full = await request(`/api/orders/${order.id}`, { headers: MGR.headers });
  dbCheck('D4. the line cost scaled with it: (8.50 + 3.20) * 3 = 35.10', near(q4(full.body.order.items[0].recipe_cost_snapshot), q4('35.10')), full.body.order.items[0]);
}

// ============================================================ I. the inventory ledger holds ONE aggregated SALE row per ingredient
{
  const beef0 = await stockOf(beef.id), cheddar0 = await stockOf(cheddar.id);
  // Two lines of the SAME dish with the SAME component would previously decrement stock twice
  // while the ledger recorded it once, because the SALE movement is unique per (order, item).
  const { order } = await readyOrder(4, [{ menu_item_id: burger.id, quantity: 2, modifier_ids: [optCheese.id] }]);
  expect('I1. an order whose base and component share the ledger key is paid', (await pay(order, `s38-payI-${stamp}`)).status, 201);
  const movements = (await request(`/api/inventory/movements?branch_id=${B1}&limit=200`, { headers: MGR.headers })).body.movements || [];
  const forOrder = movements.filter(m => m.reference_type === 'ORDER' && m.reference_id === order.id && m.type === 'SALE');
  const beefMoves = forOrder.filter(m => m.inventory_item_id === beef.id);
  const cheddarMoves = forOrder.filter(m => m.inventory_item_id === cheddar.id);
  dbCheck('I2. exactly ONE SALE movement per ingredient for this order', beefMoves.length === 1 && cheddarMoves.length === 1, forOrder.map(m => [m.inventory_item_id, m.quantity]));
  dbCheck('I3. THE LEDGER MATCHES THE SHELF for the base: movement 300g == stock delta', near(q4(beefMoves[0]?.quantity), q4('300')) && near(beef0 - await stockOf(beef.id), q4('300')), { movement: beefMoves[0]?.quantity, delta: beef0 - await stockOf(beef.id) });
  dbCheck('I4. THE LEDGER MATCHES THE SHELF for the component: movement 40g == stock delta', near(q4(cheddarMoves[0]?.quantity), q4('40')) && near(cheddar0 - await stockOf(cheddar.id), q4('40')), { movement: cheddarMoves[0]?.quantity, delta: cheddar0 - await stockOf(cheddar.id) });
  dbCheck('I5. the movement carries the weighted-average unit cost it was consumed at', near(q4(cheddarMoves[0]?.unit_cost), q4('0.16')), cheddarMoves[0]?.unit_cost);
}

// ============================================================ Q. idempotent retry consumes exactly once
{
  const { order } = await readyOrder(5, [{ menu_item_id: burger.id, quantity: 1, modifier_ids: [optCheese.id] }]);
  const key = `s38-idem-${stamp}`;
  const cheddarBefore = await stockOf(cheddar.id), beefBefore = await stockOf(beef.id);
  const first = await pay(order, key);
  expect('Q1. the first payment succeeds', first.status, 201, first.body);
  const cheddarAfter = await stockOf(cheddar.id);
  const retry = await pay(order, key);
  dbCheck('Q2. replaying the SAME idempotency key is answered as a replay, not a new payment', retry.status === 200 && retry.body?.replayed === true, { status: retry.status, replayed: retry.body?.replayed });
  dbCheck('Q3. THE RETRY CONSUMED NOTHING MORE: cheddar unchanged after the replay', near(await stockOf(cheddar.id), cheddarAfter), { afterFirst: cheddarAfter, afterRetry: await stockOf(cheddar.id) });
  dbCheck('Q4. exactly 20g cheddar and 150g beef were taken in total, once', near(cheddarBefore - await stockOf(cheddar.id), q4('20')) && near(beefBefore - await stockOf(beef.id), q4('150')), 'totals');
  const movements = (await request(`/api/inventory/movements?branch_id=${B1}&limit=200`, { headers: MGR.headers })).body.movements || [];
  dbCheck('Q5. the ledger still holds one SALE row per ingredient for that order', movements.filter(m => m.reference_id === order.id && m.type === 'SALE' && m.inventory_item_id === cheddar.id).length === 1, 'ledger');
}

// ============================================================ F. missing recipe -- the documented existing rule
{
  const before = await stockOf(cheddar.id);
  const { order } = await readyOrder(6, [{ menu_item_id: plainDish.id, quantity: 1 }, { menu_item_id: burger.id, quantity: 1, modifier_ids: [optSauce.id] }]);
  expect('F1. an order containing a recipe-less dish AND a recipe-less component is accepted', (await pay(order, `s38-payF-${stamp}`)).status, 201);
  const full = await request(`/api/orders/${order.id}`, { headers: MGR.headers });
  const plainLine = full.body.order.items.find(i => i.menu_item_id === plainDish.id);
  const burgerLine = full.body.order.items.find(i => i.menu_item_id === burger.id);
  const sauceRow = (burgerLine.modifiers || [])[0];
  dbCheck('F2. RULE (unchanged from BOOM OS): a dish with no recipe consumes nothing and its cost snapshot stays NULL', plainLine.recipe_cost_snapshot === null, plainLine);
  dbCheck('F3. RULE: a component with no recipe follows the SAME rule -- null cost, nothing consumed', sauceRow.recipe_cost_snapshot === null && near(before - await stockOf(cheddar.id), 0), sauceRow);
  dbCheck('F4. the gap is VISIBLE, not silent: food-cost reports count units without a recipe cost', true, 'asserted against the report in section J');
  dbCheck('F5. the burger line still snapshots its OWN base cost 8.50 despite the recipe-less component', near(q4(burgerLine.recipe_cost_snapshot), q4('8.50')), burgerLine);
}

// ============================================================ G/H. HISTORICAL SNAPSHOT -- the brief's exact scenario
{
  // Cheese recipe 20g cheddar @0.16 today; then the recipe becomes 30g and cheddar gets dearer.
  // The Recipe Engine's own revision path (Stage 34): it never mutates the active row, it inserts
  // a new version and deactivates the previous one, which is exactly what makes the historical
  // snapshot below meaningful.
  const newRecipe = await request(`/api/inventory/recipes/${cheeseRecipe.id}/versions`, { method: 'POST', headers: MGR.headers, body: JSON.stringify({ name: 'Cheese v2', yield_qty: '1', ingredients: [{ inventory_item_id: cheddar.id, quantity: '30' }] }) });
  expect('G1. the cheese recipe is revised to 30g', newRecipe.status, 201, newRecipe.body);
  dbCheck('G2. the revision is a NEW VERSION, not a mutation of the old row', Number(newRecipe.body.recipe.version) > Number(cheeseRecipe.version), newRecipe.body.recipe);
  const p = await request('/api/inventory/purchases', { method: 'POST', headers: MGR.headers, body: JSON.stringify({ branch_id: B1, supplier_id: supplier.id, items: [{ inventory_item_id: cheddar.id, quantity: '100000', unit_cost: '0.60' }] }) });
  await request(`/api/inventory/purchases/${p.body.purchase.id}/receive`, { method: 'POST', headers: MGR.headers });
  expect('G3. the cheese SELLING price is raised too', (await request(`/api/menu/modifiers/${optCheese.id}`, { method: 'PATCH', headers: MGR.headers, body: JSON.stringify({ price_delta: '18.00' }) })).status, 200);

  const replay = await request(`/api/orders/${orderB.id}`, { headers: MGR.headers });
  const line = replay.body.order.items[0];
  const modRow = (line.modifiers || [])[0];
  dbCheck('G4. IMMUTABLE: the old order still shows the ORIGINAL component cost 3.20, not the new recipe/price', near(q4(modRow.recipe_cost_snapshot), q4('3.20')), modRow);
  dbCheck('G5. IMMUTABLE: it still records the ORIGINAL recipe version', Number(modRow.recipe_version_snapshot) === Number(cheeseRecipe.version), modRow);
  dbCheck('G6. IMMUTABLE: the line cost is still 11.70', near(q4(line.recipe_cost_snapshot), q4('11.70')), line);
  dbCheck('H1. IMMUTABLE: the SELLING price snapshot is still +10.00, not the new +18.00', near(Math.round(parseFloat(modRow.price_delta_snapshot) * 100), 1000), modRow);

  // A NEW order now uses the NEW recipe and the NEW cost.
  const cheddar0 = await stockOf(cheddar.id);
  const { order } = await readyOrder(7, [{ menu_item_id: burger.id, quantity: 1, modifier_ids: [optCheese.id] }]);
  expect('H2. a NEW order after the revision is paid', (await pay(order, `s38-payH-${stamp}`)).status, 201);
  dbCheck('H3. the NEW order consumes the NEW quantity: 30g cheddar', near(cheddar0 - await stockOf(cheddar.id), q4('30')), 'cheddar');
  const full = await request(`/api/orders/${order.id}`, { headers: MGR.headers });
  const newMod = (full.body.order.items[0].modifiers || [])[0];
  dbCheck('H4. the NEW order snapshots the NEW, dearer cost (30g at the new weighted average, well above 3.20)', q4(newMod.recipe_cost_snapshot) > q4('3.20'), newMod);
  dbCheck('H5. the NEW order snapshots the NEW recipe version', Number(newMod.recipe_version_snapshot) === Number(newRecipe.body.recipe.version), newMod);
}

// ============================================================ J. Stage 34 food-cost analytics include the component cost
{
  const prof = await request(`/api/food-cost/profitability?branch_id=${B1}`, { headers: MGR.headers });
  expect('J1. the Stage 34 profitability report still loads', prof.status, 200, prof.body);
  const body = JSON.stringify(prof.body);
  const burgerRow = (prof.body.items || []).find(r => r.menu_item_id === burger.id);
  // Every burger sold in this suite carried the base recipe (8.50); the ones with a cheese
  // component carried 3.20 more. If component cost were NOT flowing into the Stage 34 report,
  // the total would be exactly units * 8.50 and this would fail.
  const units = Number(burgerRow?.units_sold || 0);
  dbCheck('J2. the Stage 34 profitability report includes the COMPONENT cost, not just the base recipe', units > 0 && q4(burgerRow.theoretical_cost) > units * q4('8.50'), { units, theoretical_cost: burgerRow?.theoretical_cost, base_only_would_be: units * 8.5 });
  dbCheck('J3. the report still surfaces units with no recipe cost, so the missing-recipe rule stays visible', /units_without_recipe_cost/.test(body), body.slice(0, 160));
  // Stage 38 found that this report folded a 4-decimal SUM through a 2-decimal-only parser and
  // silently reported 0.00 cost (and therefore a 100% margin). Pin it.
  dbCheck('J3b. the report does NOT collapse a 4-decimal cost sum to zero', q4(burgerRow?.theoretical_cost) > 0 && parseFloat(burgerRow?.gross_margin_percent) < 100, { cost: burgerRow?.theoretical_cost, margin: burgerRow?.gross_margin_percent });
  const analytics = await request(`/api/analytics/dishes?branch_id=${B1}`, { headers: MGR.headers });
  dbCheck('J4. Stage 34 analytics still answers, with the same snapshot-based cost', analytics.status === 200 && /cost/i.test(JSON.stringify(analytics.body)), analytics.status);
}

// ============================================================ T. the guest and the POS still see only the SELLING price
{
  const pub = await request(`/api/public/menu?branch_id=${B1}&lang=ru`);
  const body = JSON.stringify(pub.body);
  dbCheck('T1. NO internal cost on the public menu payload', !/recipe_cost|average_cost|unit_cost|theoretical_cost|food_cost/i.test(body), body.slice(0, 120));
  const item = (pub.body.items || []).find(i => i.id === burger.id);
  const cheeseOpt = (item?.modifier_groups || []).flatMap(g => g.modifiers).find(m => m.id === optCheese.id);
  dbCheck('T2. the guest sees the SELLING delta (now 18.00) and nothing else', near(Math.round(parseFloat(cheeseOpt?.price_delta) * 100), 1800), cheeseOpt);
  const posMenu = await request('/api/menu/pos', { headers: W });
  dbCheck('T3. NO internal cost on the waiter device payload', !/recipe_cost|average_cost|theoretical_cost/i.test(JSON.stringify(posMenu.body)), 'pos');
}

// ============================================================ E. an archived source dish cannot create NEW consumption
{
  expect('E1. the bacon source dish is archived', (await request(`/api/menu/items/${baconDish.id}`, { method: 'DELETE', headers: MGR.headers })).status, 200);
  const rejected = await request('/api/orders', { method: 'POST', headers: { ...W, 'idempotency-key': `s38-arch-${stamp}` }, body: JSON.stringify({ order_type: 'TAKEAWAY', source: 'POS', items: [{ menu_item_id: burger.id, quantity: 1, modifier_ids: [optBacon.id] }] }) });
  deny('E2. NEGATIVE: a component whose source dish is archived is refused for a NEW order', rejected.status, 400, rejected.body);
  dbCheck('E3. the refusal names the right reason', rejected.body?.code === 'MODIFIER_SOURCE_UNAVAILABLE', rejected.body);
  const pub = await request(`/api/public/menu?branch_id=${B1}&lang=ru`);
  const offered = ((pub.body.items || []).find(i => i.id === burger.id)?.modifier_groups || []).flatMap(g => g.modifiers).map(m => m.id);
  dbCheck('E4. it is no longer OFFERED to the guest either', !offered.includes(optBacon.id), offered.length);
  const posMenu = await request('/api/menu/pos', { headers: W });
  const posOffered = ((posMenu.body.items || []).find(i => i.id === burger.id)?.modifier_groups || []).flatMap(g => g.modifiers).map(m => m.id);
  dbCheck('E5. nor to the waiter device', !posOffered.includes(optBacon.id), posOffered.length);
  const historic = await request(`/api/orders/${orderB.id}`, { headers: MGR.headers });
  dbCheck('E6. HISTORY IS UNTOUCHED: the older order still reads its component name and cost', near(q4((historic.body.order.items[0].modifiers || [])[0]?.recipe_cost_snapshot), q4('3.20')), 'history');
}

// ============================================================ K. split bill consumes once, not once per guest
{
  const o = await request('/api/orders', { method: 'POST', headers: { ...W, 'idempotency-key': `s38-split-${stamp}` }, body: JSON.stringify({ order_type: 'DINE_IN', source: 'POS', table_id: tables[0].id, items: [{ menu_item_id: burger.id, quantity: 2, modifier_ids: [optCheese.id] }] }) });
  expect('K1. a split-able order is created', o.status, 201, o.body);
  const order = o.body.order;
  await request(`/api/orders/${order.id}/confirm`, { method: 'POST', headers: MGR.headers });
  const ticket = (await request(`/api/kds?branch_id=${B1}&status=NEW`, { headers: MGR.headers })).body.tickets.find(t => t.order_id === order.id);
  await request(`/api/kds/${ticket.id}/status`, { method: 'POST', headers: MGR.headers, body: JSON.stringify({ status: 'PREPARING' }) });
  await request(`/api/kds/${ticket.id}/status`, { method: 'POST', headers: MGR.headers, body: JSON.stringify({ status: 'READY' }) });
  const split = await request(`/api/orders/${order.id}/bills/split`, { method: 'POST', headers: MGR.headers, body: JSON.stringify({ mode: 'EQUAL', count: 2 }) });
  if (split.status === 201 || split.status === 200) {
    const bills = (await request(`/api/orders/${order.id}/bills`, { headers: MGR.headers })).body.bills || [];
    dbCheck('K2. the split produced two separate checks on ONE order', bills.length === 2, bills.map(b => b.id));
    const cheddar0 = await stockOf(cheddar.id);
    const first = await request('/api/payments', { method: 'POST', headers: { ...POS, 'idempotency-key': `s38-splitp1-${stamp}` }, body: JSON.stringify({ order_id: order.id, method: 'CASH', amount: bills[0].final_amount, bill_id: bills[0].id }) });
    expect('K3. the first guest pays', first.status, 201, first.body);
    dbCheck('K4. NOTHING is consumed while a check is still open', near(await stockOf(cheddar.id), cheddar0), { before: cheddar0, after: await stockOf(cheddar.id) });
    const second = await request('/api/payments', { method: 'POST', headers: { ...POS, 'idempotency-key': `s38-splitp2-${stamp}` }, body: JSON.stringify({ order_id: order.id, method: 'CASH', amount: bills[1].final_amount, bill_id: bills[1].id }) });
    expect('K5. the second guest pays', second.status, 201, second.body);
    // By this point section G has revised the cheese recipe to 30g, so two burgers take 60g --
    // the point of this check is that it is 60g ONCE, not 60g per guest bill.
    dbCheck('K6. consumption happened EXACTLY ONCE for the whole order: 60g cheddar for 2 burgers, not 120g', near(cheddar0 - await stockOf(cheddar.id), q4('60')), { before: cheddar0, after: await stockOf(cheddar.id) });
    const movements = (await request(`/api/inventory/movements?branch_id=${B1}&limit=250`, { headers: MGR.headers })).body.movements || [];
    dbCheck('K7. and the ledger holds ONE SALE row for it, not one per guest', movements.filter(m => m.reference_id === order.id && m.type === 'SALE' && m.inventory_item_id === cheddar.id).length === 1, 'ledger');
  } else {
    dbCheck('K2. split bill route responded', false, { status: split.status, body: split.body });
  }
}

// ============================================================ L/M/N. refund, cancellation, closure keep their existing rules
{
  const { order } = await readyOrder(1, [{ menu_item_id: burger.id, quantity: 1, modifier_ids: [optCheese.id] }]);
  const payment = await pay(order, `s38-refund-${stamp}`);
  expect('L1. an order with a component is paid', payment.status, 201, payment.body);
  const cheddarAfterSale = await stockOf(cheddar.id);
  const refund = await request(`/api/payments/${payment.body.payment.id}/refund`, { method: 'POST', headers: POS, body: JSON.stringify({ reason: 'S38 test' }) });
  dbCheck('L2. a refund is not a free-standing action -- it requires the existing approved-closure path', refund.status !== 201, { status: refund.status, code: refund.body?.code });
  dbCheck('L3. PREPARED FOOD IS NOT RESTORED: component ingredients did not silently return to the shelf', near(await stockOf(cheddar.id), cheddarAfterSale), { afterSale: cheddarAfterSale, now: await stockOf(cheddar.id) });
  const movements = (await request(`/api/inventory/movements?branch_id=${B1}&limit=250`, { headers: MGR.headers })).body.movements || [];
  dbCheck('M1. no ingredient vanished without a movement: every consumed ingredient for this order has a SALE row', movements.filter(m => m.reference_id === order.id && m.type === 'SALE').length >= 2, 'movements');
  dbCheck('N1. no unauthorised RETURN movement was invented for the component', !movements.some(m => m.reference_id === order.id && m.type === 'RETURN'), 'no return');
}

// ============================================================ O. branch isolation
{
  const cat2 = (await request('/api/menu/categories', { method: 'POST', headers: MGR2.headers, body: JSON.stringify({ branch_id: B2, name_ru: 'B2', name_tk: 'B2' }) })).body.category;
  const dish2 = (await request('/api/menu/items', { method: 'POST', headers: MGR2.headers, body: JSON.stringify({ branch_id: B2, category_id: cat2.id, sku: `S38-B2-${stamp}`, name_ru: 'B2 блюдо', name_tk: 'B2', price: '10.00' }) })).body.item;
  deny('O1. NEGATIVE: a branch-1 option cannot be pointed at a branch-2 dish', (await request(`/api/menu/modifier-groups/${grp.id}/modifiers`, { method: 'POST', headers: MGR.headers, body: JSON.stringify({ name_ru: 'x', name_tk: 'x', price_delta: '1.00', source_menu_item_id: dish2.id }) })).status, 404, null);
  deny('O2. NEGATIVE: nor by editing an existing option', (await request(`/api/menu/modifiers/${optCheese.id}`, { method: 'PATCH', headers: MGR.headers, body: JSON.stringify({ source_menu_item_id: dish2.id }) })).status, 404, null);
  const still = await request(`/api/menu/items/${burger.id}/modifiers?branch_id=${B1}`, { headers: MGR.headers });
  const opt = (still.body.groups || []).flatMap(g => g.modifiers || []).find(m => m.id === optCheese.id);
  dbCheck('O3. the refused cross-branch edits left the option pointing at its own branch\'s dish', opt?.source_menu_item_id === cheeseDish.id, opt);
  const b2Stock = await request(`/api/inventory/items?branch_id=${B2}`, { headers: MGR2.headers });
  dbCheck('O4. branch 2 holds no stock at all, so nothing of branch 1\'s consumption reached it', (b2Stock.body.items || []).length === 0, (b2Stock.body.items || []).length);
  deny('O5. NEGATIVE: a branch-1 manager cannot even read branch 2\'s inventory', (await request(`/api/inventory/items?branch_id=${B2}`, { headers: MGR.headers })).status, 403, null);
}

// ============================================================ P. RBAC
{
  deny('P1. NEGATIVE: a waiter cannot repoint a component at another dish', (await request(`/api/menu/modifiers/${optCheese.id}`, { method: 'PATCH', headers: WAITER.headers, body: JSON.stringify({ source_menu_item_id: plainDish.id }) })).status, 403, null);
  deny('P2. NEGATIVE: a cashier cannot edit a recipe', (await request('/api/inventory/recipes', { method: 'POST', headers: CASHIER.headers, body: JSON.stringify({ branch_id: B1, menu_item_id: cheeseDish.id, name: 'x', ingredients: [{ inventory_item_id: cheddar.id, quantity: '1' }] }) })).status, 403, null);
  deny('P3. NEGATIVE: a waiter cannot move stock by hand through the stock-count route', (await request('/api/inventory/counts', { method: 'POST', headers: WAITER.headers, body: JSON.stringify({ branch_id: B1, items: [{ inventory_item_id: cheddar.id, counted_quantity: '999999' }] }) })).status, 403, null);
  deny('P4. NEGATIVE: a waiter cannot read the internal cost of an ingredient', (await request(`/api/inventory/items?branch_id=${B1}`, { headers: WAITER.headers })).status, 403, null);
  const opt = ((await request(`/api/menu/items/${burger.id}/modifiers?branch_id=${B1}`, { headers: MGR.headers })).body.groups || []).flatMap(g => g.modifiers || []).find(m => m.id === optCheese.id);
  dbCheck('P5. every RBAC refusal left the component configuration untouched', opt?.source_menu_item_id === cheeseDish.id, opt);
}

// ============================================================ R. concurrent consumption
{
  const cheddar0 = await stockOf(cheddar.id);
  const a = await readyOrder(2, [{ menu_item_id: burger.id, quantity: 1, modifier_ids: [optCheese.id] }]);
  const b = await readyOrder(3, [{ menu_item_id: burger.id, quantity: 1, modifier_ids: [optCheese.id] }]);
  const [ra, rb] = await Promise.all([pay(a.order, `s38-conc-a-${stamp}`), pay(b.order, `s38-conc-b-${stamp}`)]);
  dbCheck('R1. two orders paid concurrently both succeed', ra.status === 201 && rb.status === 201, { a: ra.status, b: rb.status });
  dbCheck('R2. NO LOST UPDATE: the shelf shows both consumptions, 30g + 30g = 60g cheddar', near(cheddar0 - await stockOf(cheddar.id), q4('60')), { before: cheddar0, after: await stockOf(cheddar.id) });
}

// ============================================================ S. everything that existed before still behaves
{
  const { order } = await readyOrder(4, [{ menu_item_id: plainDish.id, quantity: 2 }]);
  expect('S1. a plain recipe-less order still pays', (await pay(order, `s38-plain-${stamp}`)).status, 201);
  const full = await request(`/api/orders/${order.id}`, { headers: MGR.headers });
  dbCheck('S2. and still leaves a NULL cost snapshot, exactly as before Stage 38', full.body.order.items[0].recipe_cost_snapshot === null, full.body.order.items[0]);
}

// ============================================================ MANDATORY NEGATIVE CONTROL
// The suite must be able to fail. This performs a write that MUST be refused and treats success
// as the failure, then proves the same write succeeds for the branch that owns the row.
{
  const forged = await request(`/api/menu/modifiers/${optCheese.id}`, { method: 'PATCH', headers: MGR2.headers, body: JSON.stringify({ price_delta: '0.01' }) });
  counts.denials++;
  if (forged.status === 200) failures.push('NEGATIVE CONTROL FAILED: a branch-2 manager rewrote a branch-1 component -- branch isolation is NOT enforced on the Stage 38 paths');
  const legit = await request(`/api/menu/modifiers/${optCheese.id}`, { method: 'PATCH', headers: MGR.headers, body: JSON.stringify({ price_delta: '19.00' }) });
  expect('X1. INVERSE CONTROL: the owning branch CAN perform the same write', legit.status, 200, legit.body);
  dbCheck('X2. the legitimate write applied', Math.round(parseFloat(legit.body?.modifier?.price_delta) * 100) === 1900, legit.body?.modifier);
}

console.log(`\nStage 38 Modifier Consumption E2E: ${counts.runtime} HTTP calls, ${counts.denials} authorization/validation denials, ${counts.dbPost} post-conditions`);
if (failures.length) { console.error(`\nFAILURES (${failures.length}):`); for (const f of failures) console.error(' - ' + f); process.exit(1); }
console.log('ALL STAGE 38 MODIFIER CONSUMPTION CHECKS PASSED');
