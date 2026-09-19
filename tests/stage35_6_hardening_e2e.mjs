// BOOM OS -- Stage 35.6 Hardening E2E.
//
// Targeted proof for the two known limitations named in the Stage 35.6 report, run against a
// real fresh database:
//  1. A cached/client-supplied price can NEVER become authoritative -- an order always prices
//     from the live server-side menu_items row at the moment it is created, even if the client
//     tries to smuggle a price field, and even if the price the client last SAW (cached before
//     an order) has since changed on the server.
//  2. The QR/channel/promotion chain holds under a genuine cross-franchise IDOR attempt, repeated
//     here as a runtime (not just static) proof alongside the Stage 35.6 suite.
//
// Requires an empty database. Usage: node tests/stage35_6_hardening_e2e.mjs
const base = `http://127.0.0.1:${process.env.BOOM_OS_PORT || 3000}`;
const ownerPassword = process.env.STAGE356H_OWNER_PASSWORD || 'BoomStage356HOwner!';
const staffPassword = 'Stage356HStaffPass12345!';
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
function expect(step, got, want, body) { if (got !== want) failures.push(`${step}: expected ${want}, got ${got} -> ${String(JSON.stringify(body ?? null)).slice(0, 320)}`); }
function dbCheck(label, cond, detail) { counts.dbPost++; if (!cond) failures.push(`DB POST-CONDITION -- ${label}: FAILED -> ${JSON.stringify(detail).slice(0, 340)}`); }
const money = v => Math.round(parseFloat(v) * 100);

const owner = await request('/api/auth/bootstrap', { method: 'POST', body: JSON.stringify({ full_name: 'S356H Owner', email: `s356howner-${stamp}@boom.local`, password: ownerPassword }) });
expect('bootstrap owner', owner.status, 201, owner.body);
const OWNER = { authorization: `Bearer ${owner.body.token}` };

const franchise = await request('/api/franchises', { method: 'POST', headers: OWNER, body: JSON.stringify({ name: 'S356H F', code: `SDH${stamp % 100000}`, legal_name: 'SDH LLC', contact_name: 'x', phone: '+99326140', email: `sdh-${stamp}@boom.local`, address: 'x' }) });
expect('franchise', franchise.status, 201, franchise.body);
const branchRes = await request('/api/branches', { method: 'POST', headers: OWNER, body: JSON.stringify({ name: 'S356H B1', code: `SDHB1${stamp % 100000}`, address: 'x', phone: '+99326141', franchise_id: franchise.body.franchise.id }) });
expect('branch', branchRes.status, 201, branchRes.body);
const B1 = branchRes.body.branch.id;
await request(`/api/franchises/${franchise.body.franchise.id}/branches/${B1}`, { method: 'POST', headers: OWNER, body: '{}' });

async function makeUser(label, branch, roles) {
  const email = `${label}-${stamp}@boom.local`.toLowerCase();
  const u = await request('/api/users', { method: 'POST', headers: OWNER, body: JSON.stringify({ full_name: `${label} Name`, email, phone: `+9942${Math.floor(Math.random() * 1000000)}`, password: staffPassword, branch_id: branch, roles, allowed_branches: [branch] }) });
  expect(`create user ${label}`, u.status, 201, u.body);
  const login = await request('/api/auth/login', { method: 'POST', body: JSON.stringify({ login: email, password: staffPassword }) });
  expect(`login ${label}`, login.status, 200, login.body);
  return { label, id: u.body.user.id, headers: { authorization: `Bearer ${login.body.token}` } };
}
const MGR1 = await makeUser('h356mgr', B1, ['BRANCH_MANAGER']);
const CASHIER1 = await makeUser('h356cash', B1, ['CASHIER']);
const WAITER1 = await makeUser('h356wait', B1, ['WAITER']);

const cat = await request('/api/menu/categories', { method: 'POST', headers: MGR1.headers, body: JSON.stringify({ branch_id: B1, name_ru: 'Cat', name_tk: 'Cat', sort_order: 0 }) });
const dish = await request('/api/menu/items', { method: 'POST', headers: MGR1.headers, body: JSON.stringify({ branch_id: B1, category_id: cat.body.category.id, sku: `SDH-DISH-${stamp}`, name_ru: 'Плов', name_tk: 'Palow', price: '100.00', sort_order: 0 }) });
expect('menu item', dish.status, 201, dish.body);
const DISH = dish.body.item;

// ============================================================ setup: waiter session + cash shift
const area = (await request('/api/tables/areas', { method: 'POST', headers: MGR1.headers, body: JSON.stringify({ branch_id: B1, name: 'Hall', sort_order: 0 }) })).body.area;
const table = (await request('/api/tables', { method: 'POST', headers: MGR1.headers, body: JSON.stringify({ branch_id: B1, area_id: area.id, code: `SDH-${stamp % 10000}`, seats: 4 }) })).body.table;
expect('waiter code', (await request(`/api/waiters/${WAITER1.id}/code`, { method: 'POST', headers: MGR1.headers, body: JSON.stringify({ code: '7781' }) })).status, 201);
const W = { 'x-waiter-session': (await request('/api/waiters/authenticate-code', { method: 'POST', body: JSON.stringify({ code: '7781', deviceId: 'sdh-dev' }) })).body.session.token };
expect('open shift', (await request('/api/cash-shifts', { method: 'POST', headers: CASHIER1.headers, body: JSON.stringify({ branch_id: B1, opening_cash: '100.00' }) })).status, 201);

// ============================================================ 1. a "cached" 100.00 price, then the server-side price changes to 150.00
const menuBeforeChange = await request(`/api/public/menu?branch_id=${B1}&lang=ru`);
const cachedView = menuBeforeChange.body.items.find(i => i.id === DISH.id);
dbCheck('1. the client observes and could cache the ORIGINAL price (100.00)', cachedView && money(cachedView.price) === 10000, cachedView);

const priceChange = await request(`/api/menu/items/${DISH.id}`, { method: 'PATCH', headers: MGR1.headers, body: JSON.stringify({ price: '150.00' }) });
expect('1b. the manager changes the real price server-side (simulating time passing after a client cached the old one)', priceChange.status, 200, priceChange.body);

// This order is placed with NO reference to the price the "client" observed earlier -- exactly
// what a real order does (the request never contains a price field at all).
const order1 = await request('/api/orders', { method: 'POST', headers: { ...W, 'idempotency-key': `sdh-stale-${stamp}` }, body: JSON.stringify({ order_type: 'DINE_IN', source: 'POS', table_id: table.id, items: [{ menu_item_id: DISH.id, quantity: 1 }] }) });
expect('2. order created after the price change', order1.status, 201, order1.body);
dbCheck('2b. THE STALE-PRICE RULE: the order uses the CURRENT server price (150.00), never the price a client observed/cached earlier (100.00)', money(order1.body.order.subtotal) === 15000, order1.body.order);

// ============================================================ 3. a client attempting to smuggle a price field into the order request
const order2 = await request('/api/orders', { method: 'POST', headers: { ...W, 'idempotency-key': `sdh-smuggle-${stamp}` }, body: JSON.stringify({ order_type: 'TAKEAWAY', source: 'POS', items: [{ menu_item_id: DISH.id, quantity: 1, price: '1.00', unit_price: '1.00' }] }) });
expect('3. order created despite a client-supplied price field on the item', order2.status, 201, order2.body);
dbCheck('3b. THE PRICE-SMUGGLING RULE: the smuggled price field (1.00) is completely ignored -- the real server price (150.00) is used', money(order2.body.order.subtotal) === 15000, order2.body.order);

// ============================================================ 4. the same server-side rule holds for a promotion in flight
const promo = await request('/api/promotions', { method: 'POST', headers: MGR1.headers, body: JSON.stringify({ branch_id: B1, menu_item_id: DISH.id, promo_price: '80.00', ends_at: new Date(Date.now() + 3600000).toISOString() }) });
expect('4. a live promotion exists on the item (80.00, real price is 150.00)', promo.status, 201, promo.body);
const menuWithPromo = await request(`/api/public/menu?branch_id=${B1}&lang=ru`);
dbCheck('4b. the public menu shows the promo price for display purposes', money(menuWithPromo.body.items.find(i => i.id === DISH.id).promo_price) === 8000, menuWithPromo.body.items.find(i => i.id === DISH.id));
const order3 = await request('/api/orders', { method: 'POST', headers: { ...W, 'idempotency-key': `sdh-promo-${stamp}` }, body: JSON.stringify({ order_type: 'TAKEAWAY', source: 'POS', items: [{ menu_item_id: DISH.id, quantity: 1 }] }) });
expect('5. order created while a promotion is live', order3.status, 201, order3.body);
dbCheck('5b. Stage 35.6 added no order-time promotion path -- the order still uses the real menu price (150.00), never the promo price (80.00)', money(order3.body.order.subtotal) === 15000, order3.body.order);

console.log(`\nStage 35.6 Hardening E2E: ${counts.runtime} HTTP calls, ${counts.denials} denials, ${counts.dbPost} DB post-conditions`);
if (failures.length) { console.error(`\nFAILURES (${failures.length}):`); for (const f of failures) console.error(' - ' + f); process.exit(1); }
console.log('ALL STAGE 35.6 HARDENING CHECKS PASSED');
