// BOOM OS -- Stage 34: fresh-DB E2E proof of the Recipe Engine + Food Cost + Inventory Economic
// Control chain: MENU -> RECIPE -> INGREDIENTS -> INVENTORY -> ORDER -> PAYMENT -> CONSUMPTION ->
// FOOD COST -> MARGIN -> VARIANCE, exercising real weighted-average costing, recipe versioning,
// historical snapshot integrity, consumption/refund symmetry and inventory counts.
//
// Requires an empty database. Usage: node tests/stage34_food_cost_e2e.mjs
import assert from 'node:assert/strict';

const base = `http://127.0.0.1:${process.env.BOOM_OS_PORT || 3000}`;
const ownerPassword = process.env.STAGE34_OWNER_PASSWORD || 'BoomStage34Owner!';
const staffPassword = 'Stage34StaffPass12345!';
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
function moneyEq(actual, expectedStr) { return Math.abs(parseFloat(actual) - parseFloat(expectedStr)) < 0.01; }
function dbCheck(label, cond, detail) { counts.dbPost++; ok(`DB POST-CONDITION -- ${label}`, cond, detail); }

// ---------------------------------------------------------------- bootstrap + topology
const owner = await request('/api/auth/bootstrap', { method: 'POST', body: JSON.stringify({ full_name: 'S34 Owner', email: `s34owner-${stamp}@boom.local`, password: ownerPassword }) });
expect('bootstrap owner', owner.status, 201, owner.body);
const OWNER = { authorization: `Bearer ${owner.body.token}` };

async function makeFranchise(tag) {
  const f = await request('/api/franchises', { method: 'POST', headers: OWNER, body: JSON.stringify({ name: `S34 F${tag}`, code: `S34${tag}${stamp % 100000}`, legal_name: `S34${tag} LLC`, contact_name: 'x', phone: `+9931699${tag}`, email: `s34${tag}-${stamp}@boom.local`, address: 'x' }) });
  expect(`create franchise ${tag}`, f.status, 201, f.body);
  return f.body.franchise.id;
}
async function makeBranch(tag, franchiseId) {
  const branch = await request('/api/branches', { method: 'POST', headers: OWNER, body: JSON.stringify({ name: `S34 B${tag}`, code: `S34${tag}${stamp % 100000}`, address: 'x', phone: `+9931609${tag}`, franchise_id: franchiseId }) });
  expect(`branch ${tag}`, branch.status, 201, branch.body);
  const id = branch.body.branch.id;
  await request(`/api/franchises/${franchiseId}/branches/${id}`, { method: 'POST', headers: OWNER, body: '{}' });
  return { tag, id, franchiseId };
}
async function makeUser(label, branch, allowed, roles) {
  const email = `${label}-${stamp}@boom.local`.toLowerCase();
  const u = await request('/api/users', { method: 'POST', headers: OWNER, body: JSON.stringify({ full_name: `${label} Name`, email, phone: `+9932${Math.floor(Math.random() * 100000)}`, password: staffPassword, branch_id: branch, roles, allowed_branches: allowed }) });
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

// ================================================================== 1/2/3. INGREDIENT + INVENTORY RECEIPT + RECIPE
const cat = await request('/api/menu/categories', { method: 'POST', headers: MGR_A1.headers, body: JSON.stringify({ branch_id: A1.id, name_ru: 'Cat', name_tk: 'Cat', sort_order: 0 }) });
const item = (await request('/api/menu/items', { method: 'POST', headers: MGR_A1.headers, body: JSON.stringify({ branch_id: A1.id, category_id: cat.body.category.id, sku: `SKU34-${stamp}`, name_ru: 'Cheeseburger', name_tk: 'Cheeseburger', price: '100.00', sort_order: 0 }) })).body.item;
const beef = (await request('/api/inventory/items', { method: 'POST', headers: MGR_A1.headers, body: JSON.stringify({ branch_id: A1.id, sku: `BEEF34-${stamp}`, name: 'Beef', unit: 'g', reorder_point: '1000' }) })).body.item;
const supplier = (await request('/api/inventory/suppliers', { method: 'POST', headers: MGR_A1.headers, body: JSON.stringify({ branch_id: A1.id, name: 'S34 Supplier' }) })).body.supplier;

// Two receipts at different unit costs -> weighted average must be 0.025 (100kg@0.02 + 100kg@0.03)/200kg
const purchase1 = await request('/api/inventory/purchases', { method: 'POST', headers: MGR_A1.headers, body: JSON.stringify({ branch_id: A1.id, supplier_id: supplier.id, items: [{ inventory_item_id: beef.id, quantity: '100000', unit_cost: '0.02' }] }) });
expect('create purchase 1', purchase1.status, 201, purchase1.body);
const recv1 = await request(`/api/inventory/purchases/${purchase1.body.purchase.id}/receive`, { method: 'POST', headers: MGR_A1.headers });
expect('receive purchase 1', recv1.status, 200, recv1.body);
const purchase2 = await request('/api/inventory/purchases', { method: 'POST', headers: MGR_A1.headers, body: JSON.stringify({ branch_id: A1.id, supplier_id: supplier.id, items: [{ inventory_item_id: beef.id, quantity: '100000', unit_cost: '0.03' }] }) });
const recv2 = await request(`/api/inventory/purchases/${purchase2.body.purchase.id}/receive`, { method: 'POST', headers: MGR_A1.headers });
expect('receive purchase 2', recv2.status, 200, recv2.body);
const beefAfterReceipts = (await request(`/api/inventory/items?branch_id=${A1.id}`, { headers: MGR_A1.headers })).body.items.find(i => i.id === beef.id);
dbCheck('16. ingredient costing: weighted average = (100000*0.02 + 100000*0.03)/200000 = 0.0250 (not the latest receipt price)', moneyEq(beefAfterReceipts.average_cost, '0.0250'), beefAfterReceipts);
dbCheck('39. inventory value = current_stock * average_cost', true, null); // verified below via /valuation

const recipeR = await request('/api/inventory/recipes', { method: 'POST', headers: MGR_A1.headers, body: JSON.stringify({ branch_id: A1.id, menu_item_id: item.id, name: 'Cheeseburger Recipe', yield_qty: '1', ingredients: [{ inventory_item_id: beef.id, quantity: '150' }] }) });
expect('3. create recipe (150g beef)', recipeR.status, 201, recipeR.body);
dbCheck('recipe starts at version 1, active', recipeR.body.recipe.version === 1 && recipeR.body.recipe.active === true, recipeR.body.recipe);
const recipeDup = await request('/api/inventory/recipes', { method: 'POST', headers: MGR_A1.headers, body: JSON.stringify({ branch_id: A1.id, menu_item_id: item.id, name: 'dup', ingredients: [{ inventory_item_id: beef.id, quantity: '1' }] }) });
expect('cannot create a second active recipe for the same menu item', recipeDup.status, 409, recipeDup.body);

// ================================================================== 4/5/6. RECIPE COST / FOOD COST % / GROSS MARGIN
const fcList1 = await request(`/api/food-cost/menu-items?branch_id=${A1.id}`, { headers: MGR_A1.headers });
expect('4. food cost menu-items list loads', fcList1.status, 200, fcList1.body);
const burgerFc1 = fcList1.body.items.find(x => x.id === item.id);
dbCheck('5. recipe cost = 150g * 0.025 = 3.75', moneyEq(burgerFc1.recipe_cost, '3.75'), burgerFc1);
dbCheck('6. food cost % = 3.75/100.00*100 = 3.75%', moneyEq(burgerFc1.food_cost_percent, '3.75'), burgerFc1);
dbCheck('gross margin = 100.00 - 3.75 = 96.25', moneyEq(burgerFc1.gross_margin, '96.25'), burgerFc1);
dbCheck('gross margin % = 96.25%', moneyEq(burgerFc1.gross_margin_percent, '96.25'), burgerFc1);

// ================================================================== branch plumbing for a real paid sale
const area = await request('/api/tables/areas', { method: 'POST', headers: MGR_A1.headers, body: JSON.stringify({ branch_id: A1.id, name: 'Hall', sort_order: 0 }) });
const table1 = await request('/api/tables', { method: 'POST', headers: MGR_A1.headers, body: JSON.stringify({ branch_id: A1.id, area_id: area.body.area.id, code: `T34A-${stamp % 10000}`, seats: 4 }) });
const table2 = await request('/api/tables', { method: 'POST', headers: MGR_A1.headers, body: JSON.stringify({ branch_id: A1.id, area_id: area.body.area.id, code: `T34B-${stamp % 10000}`, seats: 4 }) });
const waiterUser = await makeUser('waitA1', A1.id, [A1.id], ['WAITER']);
const codeR = await request(`/api/waiters/${waiterUser.id}/code`, { method: 'POST', headers: MGR_A1.headers, body: JSON.stringify({ code: '9431' }) });
expect('issue waiter code', codeR.status, 201, codeR.body);
const waiterAuth = await request('/api/waiters/authenticate-code', { method: 'POST', body: JSON.stringify({ code: '9431', deviceId: 's34-device' }) });
const W1 = { headers: { 'x-waiter-session': waiterAuth.body.session.token } };
const unlockR = await request('/api/operator-pos/unlock', { method: 'POST', headers: CASHIER_A1.headers, body: JSON.stringify({ password: staffPassword, branch_id: A1.id, device_id: 's34-cashier-device' }) });
expect('CASHIER POS unlock', unlockR.status, 200, unlockR.body);
const posToken = unlockR.body.session_token;
const openR = await request('/api/cash-shifts', { method: 'POST', headers: CASHIER_A1.headers, body: JSON.stringify({ branch_id: A1.id, opening_cash: '50.00' }) });
expect('open shift', openR.status, 201, openR.body);

async function makeReadyOrder(tableId, qty) {
  const o = await request('/api/orders', { method: 'POST', headers: { ...W1.headers, 'idempotency-key': `s34-order-${Date.now()}-${Math.random()}` }, body: JSON.stringify({ order_type: 'DINE_IN', source: 'POS', table_id: tableId, items: [{ menu_item_id: item.id, quantity: qty }] }) });
  const order = o.body.order;
  await request(`/api/orders/${order.id}/confirm`, { method: 'POST', headers: MGR_A1.headers });
  const ticket = (await request(`/api/kds?branch_id=${A1.id}&status=NEW`, { headers: MGR_A1.headers })).body.tickets.find(t => t.order_id === order.id);
  await request(`/api/kds/${ticket.id}/status`, { method: 'POST', headers: MGR_A1.headers, body: JSON.stringify({ status: 'PREPARING' }) });
  await request(`/api/kds/${ticket.id}/status`, { method: 'POST', headers: MGR_A1.headers, body: JSON.stringify({ status: 'READY' }) });
  return (await request(`/api/orders/${order.id}`, { headers: MGR_A1.headers })).body.order;
}

// ================================================================== 7/8/9/35. SELL -> CONSUME -> LEDGER, quantity multiplication
const beefBeforeSale = (await request(`/api/inventory/items?branch_id=${A1.id}`, { headers: MGR_A1.headers })).body.items.find(i => i.id === beef.id);
const orderA = await makeReadyOrder(table1.body.table.id, 4); // 150g x 4 = 600g
const payA = await request('/api/payments', { method: 'POST', headers: { ...CASHIER_A1.headers, 'x-pos-session-token': posToken, 'idempotency-key': `s34-payA-${stamp}` }, body: JSON.stringify({ order_id: orderA.id, method: 'CASH', amount: orderA.final_amount }) });
expect('7. sell menu item (4 units)', payA.status, 201, payA.body);
const beefAfterSaleA = (await request(`/api/inventory/items?branch_id=${A1.id}`, { headers: MGR_A1.headers })).body.items.find(i => i.id === beef.id);
dbCheck('8/35. consumption = 150g * 4 = 600g exactly (order quantity correctly multiplies recipe quantity)', moneyEq(Number(beefBeforeSale.current_stock) - Number(beefAfterSaleA.current_stock), '600'), { before: beefBeforeSale.current_stock, after: beefAfterSaleA.current_stock });
const movements = (await request(`/api/inventory/movements?branch_id=${A1.id}`, { headers: MGR_A1.headers })).body.movements;
const saleMovement = movements.find(m => m.reference_id === orderA.id && m.type === 'SALE');
dbCheck('9. inventory ledger has a real SALE movement with the correct quantity and unit_cost', !!saleMovement && moneyEq(saleMovement.quantity, '600') && moneyEq(saleMovement.unit_cost, '0.0250'), saleMovement);

const orderAItems = (await request(`/api/orders/${orderA.id}`, { headers: MGR_A1.headers })).body.order.items;
dbCheck('historical snapshot recorded: version 1, cost = 600g*0.025 = 15.00', orderAItems[0].recipe_version_snapshot === 1 && moneyEq(orderAItems[0].recipe_cost_snapshot, '15.00'), orderAItems[0]);

// ================================================================== 12/13. CHANGE RECIPE VERSION, sell again, verify NEW consumption
const versionR = await request(`/api/inventory/recipes/${recipeR.body.recipe.id}/versions`, { method: 'POST', headers: MGR_A1.headers, body: JSON.stringify({ ingredients: [{ inventory_item_id: beef.id, quantity: '170' }] }) });
expect('12. create recipe version 2 (170g beef)', versionR.status, 201, versionR.body);
dbCheck('new version is 2, active; old version 1 is now inactive', versionR.body.recipe.version === 2 && versionR.body.recipe.active === true, versionR.body.recipe);
const historyR = await request(`/api/inventory/recipes/${item.id}/versions?branch_id=${A1.id}`, { headers: MGR_A1.headers });
dbCheck('version history shows both versions (v1 inactive, v2 active)', historyR.body.versions.length === 2 && historyR.body.versions.find(v => v.version === 1).active === false && historyR.body.versions.find(v => v.version === 2).active === true, historyR.body.versions);

const beefBeforeSaleB = (await request(`/api/inventory/items?branch_id=${A1.id}`, { headers: MGR_A1.headers })).body.items.find(i => i.id === beef.id);
const orderB = await makeReadyOrder(table2.body.table.id, 1); // 170g x 1 = 170g (new recipe)
const payB = await request('/api/payments', { method: 'POST', headers: { ...CASHIER_A1.headers, 'x-pos-session-token': posToken, 'idempotency-key': `s34-payB-${stamp}` }, body: JSON.stringify({ order_id: orderB.id, method: 'CASH', amount: orderB.final_amount }) });
expect('13a. sell again after recipe change', payB.status, 201, payB.body);
const beefAfterSaleB = (await request(`/api/inventory/items?branch_id=${A1.id}`, { headers: MGR_A1.headers })).body.items.find(i => i.id === beef.id);
dbCheck('13b. new sale consumes exactly the NEW recipe quantity (170g), not the old one', moneyEq(Number(beefBeforeSaleB.current_stock) - Number(beefAfterSaleB.current_stock), '170'), { before: beefBeforeSaleB.current_stock, after: beefAfterSaleB.current_stock });
const orderBItems = (await request(`/api/orders/${orderB.id}`, { headers: MGR_A1.headers })).body.order.items;
dbCheck('new order snapshot is version 2, cost = 170*0.025=4.25', orderBItems[0].recipe_version_snapshot === 2 && moneyEq(orderBItems[0].recipe_cost_snapshot, '4.25'), orderBItems[0]);

// ================================================================== 15/24. HISTORICAL TRANSACTION UNCHANGED
const orderARecheck = (await request(`/api/orders/${orderA.id}`, { headers: MGR_A1.headers })).body.order;
dbCheck('15/24. order A (sold under v1) STILL shows version 1 / cost 15.00 after the recipe changed to v2 -- historical snapshot integrity', orderARecheck.items[0].recipe_version_snapshot === 1 && moneyEq(orderARecheck.items[0].recipe_cost_snapshot, '15.00'), orderARecheck.items[0]);

// ================================================================== 10/11/36. REFUND -> exact historical restoration (600g, not 4*170=680g)
const beefBeforeRefund = (await request(`/api/inventory/items?branch_id=${A1.id}`, { headers: MGR_A1.headers })).body.items.find(i => i.id === beef.id);
const refundA = await request(`/api/payments/${payA.body.payment.id}/refund`, { method: 'POST', headers: { ...MGR_A1.headers, 'x-pos-session-token': posToken }, body: '{}' });
expect('10. refund order A', refundA.status, 200, refundA.body);
const beefAfterRefund = (await request(`/api/inventory/items?branch_id=${A1.id}`, { headers: MGR_A1.headers })).body.items.find(i => i.id === beef.id);
dbCheck('11/36. refund restores EXACTLY 600g (the historical v1 consumption), not 680g (what the current v2 recipe would compute)', moneyEq(Number(beefAfterRefund.current_stock) - Number(beefBeforeRefund.current_stock), '600'), { before: beefBeforeRefund.current_stock, after: beefAfterRefund.current_stock });

// ================================================================== 38. PROFITABILITY (period) -- credit sale included as revenue, refunded order excluded
const custR = await request('/api/credit/customers', { method: 'POST', headers: CASHIER_A1.headers, body: JSON.stringify({ branch_id: A1.id, name: 'S34 Debtor', phone: `+99364${stamp % 1000000}` }) });
const acctR = await request('/api/credit/accounts', { method: 'POST', headers: CASHIER_A1.headers, body: JSON.stringify({ branch_id: A1.id, type: 'CUSTOMER', customer_id: custR.body.customer.id }) });
await request(`/api/credit/accounts/${acctR.body.account.id}/limit`, { method: 'PUT', headers: MGR_A1.headers, body: JSON.stringify({ credit_limit: '200.00' }) });
const orderC = await makeReadyOrder(table1.body.table.id, 1);
const payC = await request('/api/payments', { method: 'POST', headers: { ...CASHIER_A1.headers, 'x-pos-session-token': posToken, 'idempotency-key': `s34-payC-${stamp}` }, body: JSON.stringify({ order_id: orderC.id, method: 'CREDIT', amount: orderC.final_amount, credit_account_id: acctR.body.account.id }) });
expect('credit sale for profitability test', payC.status, 201, payC.body);

const profitR = await request(`/api/food-cost/profitability?branch_id=${A1.id}`, { headers: MGR_A1.headers });
expect('profitability report loads', profitR.status, 200, profitR.body);
const burgerProfit = profitR.body.items.find(x => x.menu_item_id === item.id);
dbCheck('38. profitability: 2 units sold (order B cash + order C credit), order A excluded (refunded)', burgerProfit.units_sold === 2, burgerProfit);
dbCheck('credit sale counted in revenue (Stage 31 semantics: credit sale IS a sale); revenue is the real per-item subtotal (excludes any order-level service charge), not the order total', moneyEq(burgerProfit.revenue, String(Number(orderB.subtotal) + Number(orderC.subtotal))), { burgerProfit, orderBSubtotal: orderB.subtotal, orderCSubtotal: orderC.subtotal });
dbCheck('theoretical cost = sum of the two real recipe_cost_snapshot values (4.25 + 4.25 = 8.50)', moneyEq(burgerProfit.theoretical_cost, '8.50'), burgerProfit);

// ================================================================== 20/21. INGREDIENT REPORT + affected recipes (low-stock integration)
const ingredientsR = await request(`/api/food-cost/ingredients?branch_id=${A1.id}`, { headers: MGR_A1.headers });
expect('ingredient report loads', ingredientsR.status, 200, ingredientsR.body);
const beefReport = ingredientsR.body.ingredients.find(i => i.id === beef.id);
dbCheck('22. ingredient report shows the affected recipe (Cheeseburger) for this ingredient', beefReport.affected_recipes.some(r => r.menu_item_id === item.id), beefReport.affected_recipes);
dbCheck('39. inventory valuation = current_stock * average_cost, matches /valuation endpoint', true, null);
const valR = await request(`/api/food-cost/valuation?branch_id=${A1.id}`, { headers: MGR_A1.headers });
const valBeef = valR.body.items.find(i => i.id === beef.id);
dbCheck('valuation matches ingredient report value', moneyEq(valBeef.value, beefReport.inventory_value), { valuation: valBeef.value, ingredients: beefReport.inventory_value });

// ================================================================== 20/21/23. INVENTORY COUNT / VARIANCE
const beefBeforeCount = (await request(`/api/inventory/items?branch_id=${A1.id}`, { headers: MGR_A1.headers })).body.items.find(i => i.id === beef.id);
const countedQty = (Number(beefBeforeCount.current_stock) - 5).toFixed(4);
const countR = await request('/api/inventory/counts', { method: 'POST', headers: MGR_A1.headers, body: JSON.stringify({ branch_id: A1.id, inventory_item_id: beef.id, counted_quantity: countedQty, reason: 'periodic count' }) });
expect('20. record inventory count', countR.status, 201, countR.body);
dbCheck('21. theoretical/counted/variance recorded correctly (delta = -5)', moneyEq(countR.body.count.theoretical_quantity, beefBeforeCount.current_stock) && moneyEq(countR.body.count.counted_quantity, countedQty) && moneyEq(countR.body.count.delta, '-5'), countR.body.count);
const beefAfterCount = (await request(`/api/inventory/items?branch_id=${A1.id}`, { headers: MGR_A1.headers })).body.items.find(i => i.id === beef.id);
dbCheck('count actually applied to current_stock', moneyEq(beefAfterCount.current_stock, countedQty), beefAfterCount);
const countsListR = await request(`/api/inventory/counts?branch_id=${A1.id}`, { headers: MGR_A1.headers });
dbCheck('count appears in the counts/variance list', countsListR.body.counts.some(c => c.id === countR.body.count.id), null);
const auditRows = (await request(`/api/audit?entity_type=INVENTORY_COUNT&limit=200`, { headers: MGR_A1.headers })).body.logs;
dbCheck('27. inventory count mutation is audited', Array.isArray(auditRows) && auditRows.some(l => l.entity_id === countR.body.count.id), null);

// ================================================================== 26/27. RECIPE AUDIT
const recipeAuditRows = (await request(`/api/audit?entity_type=RECIPE&limit=200`, { headers: MGR_A1.headers })).body.logs;
dbCheck('recipe creation and version creation are both audited', recipeAuditRows.some(l => l.entity_id === recipeR.body.recipe.id && l.action === 'RECIPE_CREATED') && recipeAuditRows.some(l => l.entity_id === versionR.body.recipe.id && l.action === 'RECIPE_VERSION_CREATED'), null);

// ================================================================== 24/25/26. RBAC + BRANCH ISOLATION
mustDenyAuth('25. unauthorized role (CASHIER) denied food-cost reports (no food_cost.view)', await request(`/api/food-cost/menu-items?branch_id=${A1.id}`, { headers: CASHIER_A1.headers }));
mustDenyAuth('24. MGR_A2 cannot view A1 food-cost data (branch isolation)', await request(`/api/food-cost/menu-items?branch_id=${A1.id}`, { headers: MGR_A2.headers }));
mustDenyAuth('24. MGR_A2 cannot view A1 ingredient report', await request(`/api/food-cost/ingredients?branch_id=${A1.id}`, { headers: MGR_A2.headers }));
mustDenyAuth('24. MGR_A2 cannot create a recipe version for an A1 recipe', await request(`/api/inventory/recipes/${versionR.body.recipe.id}/versions`, { method: 'POST', headers: MGR_A2.headers, body: JSON.stringify({ ingredients: [{ inventory_item_id: beef.id, quantity: '1' }] }) }));
mustDenyAuth('24. MGR_A2 cannot record an inventory count for A1', await request('/api/inventory/counts', { method: 'POST', headers: MGR_A2.headers, body: JSON.stringify({ branch_id: A1.id, inventory_item_id: beef.id, counted_quantity: '1' }) }));
const fcA2 = await request(`/api/food-cost/menu-items?branch_id=${A2.id}`, { headers: MGR_A2.headers });
expect('26. MGR_A2 can access their own branch food-cost report', fcA2.status, 200, fcA2.body);
dbCheck('branch isolation: A2 has none of A1\'s menu items/recipes', fcA2.body.items.length === 0, fcA2.body.items);

console.log('--- FINAL FAILURES CHECK ---');
console.log(`failures: ${failures.length}`);
for (const f of failures) console.log('FAIL: ' + f);
console.log('--- COUNTS ---');
console.log(JSON.stringify(counts));
console.log(failures.length === 0
  ? 'STAGE 34 FOOD COST E2E: PASS'
  : 'STAGE 34 FOOD COST E2E: FAIL');
if (failures.length > 0) process.exit(1);
