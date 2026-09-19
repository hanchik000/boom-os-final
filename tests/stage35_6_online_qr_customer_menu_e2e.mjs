// BOOM OS -- Stage 35.6: fresh-DB E2E proof of ONE customer menu shared by ONLINE, QR, LOCAL and
// OFFLINE, the Promotion Engine, and QR branch resolution.
//
// Proves on REAL data that: channel is presentation targeting only (same items, same prices, only
// which blocks show changes); a QR token resolves to its branch server-side and can never be
// overridden or guessed into another branch's data; a promotion attaches a real, lower price to a
// real menu item and is live only inside its own window, computed on every read; the SAME
// promotional price appears through both the plain public menu and the visual catalog; public
// routes leak no internal data; branch and franchise isolation hold on every manager endpoint;
// and the existing Order Core is completely untouched by any of this.
//
// Requires an empty database. Usage: node tests/stage35_6_online_qr_customer_menu_e2e.mjs
const base = `http://127.0.0.1:${process.env.BOOM_OS_PORT || 3000}`;
const ownerPassword = process.env.STAGE356_OWNER_PASSWORD || 'BoomStage356Owner!';
const staffPassword = 'Stage356StaffPass12345!';
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
function ok(step, cond, detail) { if (!cond) failures.push(`${step}: FAILED ${detail !== undefined ? '-> ' + JSON.stringify(detail).slice(0, 340) : ''}`); }
function mustDeny(label, r) {
  if (r.status >= 200 && r.status < 300) failures.push(`${label} -- returned ${r.status} (expected denial): ${JSON.stringify(r.body).slice(0, 260)}`);
  else if (![400, 401, 403, 404, 409].includes(r.status)) failures.push(`${label} -- returned ${r.status}, not a recognized denial: ${JSON.stringify(r.body).slice(0, 260)}`);
  else counts.denials++;
}
function dbCheck(label, cond, detail) { counts.dbPost++; ok(`DB POST-CONDITION -- ${label}`, cond, detail); }
const money = v => Math.round(parseFloat(v) * 100);

const owner = await request('/api/auth/bootstrap', { method: 'POST', body: JSON.stringify({ full_name: 'S356 Owner', email: `s356owner-${stamp}@boom.local`, password: ownerPassword }) });
expect('bootstrap owner', owner.status, 201, owner.body);
const OWNER = { authorization: `Bearer ${owner.body.token}` };

// Two franchises, one branch each -- for franchise isolation, not just branch isolation.
async function makeFranchise(tag) {
  const f = await request('/api/franchises', { method: 'POST', headers: OWNER, body: JSON.stringify({ name: `S356 F${tag}`, code: `SD${tag}${stamp % 100000}`, legal_name: `SD${tag} LLC`, contact_name: 'x', phone: `+9932613${tag}`, email: `sd${tag}-${stamp}@boom.local`, address: 'x' }) });
  expect(`franchise ${tag}`, f.status, 201, f.body); return f.body.franchise.id;
}
async function makeBranch(tag, franchiseId) {
  const branch = await request('/api/branches', { method: 'POST', headers: OWNER, body: JSON.stringify({ name: `S356 ${tag}`, code: `SD${tag}${stamp % 100000}`, address: 'x', phone: `+9932614${tag}`, franchise_id: franchiseId }) });
  expect(`branch ${tag}`, branch.status, 201, branch.body);
  const id = branch.body.branch.id;
  await request(`/api/franchises/${franchiseId}/branches/${id}`, { method: 'POST', headers: OWNER, body: '{}' });
  return id;
}
const FA = await makeFranchise('A');
const FB = await makeFranchise('B');
const B1 = await makeBranch('B1', FA);
const B2 = await makeBranch('B2', FB); // different franchise entirely

async function makeUser(label, branch, allowed, roles) {
  const email = `${label}-${stamp}@boom.local`.toLowerCase();
  const u = await request('/api/users', { method: 'POST', headers: OWNER, body: JSON.stringify({ full_name: `${label} Name`, email, phone: `+9942${Math.floor(Math.random() * 1000000)}`, password: staffPassword, branch_id: branch, roles, allowed_branches: allowed }) });
  expect(`create user ${label}`, u.status, 201, u.body);
  const login = await request('/api/auth/login', { method: 'POST', body: JSON.stringify({ login: email, password: staffPassword }) });
  expect(`login ${label}`, login.status, 200, login.body);
  return { label, id: u.body.user.id, headers: { authorization: `Bearer ${login.body.token}` } };
}
const MGR1 = await makeUser('m356b1', B1, [B1], ['BRANCH_MANAGER']);
const MGR2 = await makeUser('m356b2', B2, [B2], ['BRANCH_MANAGER']);
const CASHIER1 = await makeUser('c356b1', B1, [B1], ['CASHIER']);
const WAITER1 = await makeUser('w356b1', B1, [B1], ['WAITER']);

const cat = await request('/api/menu/categories', { method: 'POST', headers: MGR1.headers, body: JSON.stringify({ branch_id: B1, name_ru: 'Cat', name_tk: 'Cat', sort_order: 0 }) });
async function makeDish(sku, price, ru, tk) {
  const r = await request('/api/menu/items', { method: 'POST', headers: MGR1.headers, body: JSON.stringify({ branch_id: B1, category_id: cat.body.category.id, sku: `${sku}-${stamp}`, name_ru: ru, name_tk: tk, price, sort_order: 0 }) });
  expect(`menu item ${sku}`, r.status, 201, r.body);
  return r.body.item;
}
const DISH = await makeDish('SD-DISH', '100.00', 'Плов', 'Palow');
const TEA = await makeDish('SD-TEA', '10.00', 'Чай', 'Çaý');

// ============================================================ 1. real public menu: real items, real prices, no invented data
const menu1 = await request(`/api/public/menu?branch_id=${B1}&lang=ru`);
expect('1. the public menu answers with no staff auth', menu1.status, 200, menu1.body);
const dishRow = menu1.body.items.find(i => i.id === DISH.id);
dbCheck('1b. the real item, the real price, no promo yet', dishRow && money(dishRow.price) === 10000 && dishRow.promo_price === null, dishRow);
dbCheck('1c. no recipe/cost/stock/employee fields leak through the public menu', !JSON.stringify(menu1.body).match(/recipe_cost|average_cost|current_stock|password_hash/), null);

// ============================================================ 2. Visual Catalog channel targeting -- SAME data, presentation only
const onlineBlock = await request('/api/visual-catalog', { method: 'POST', headers: MGR1.headers, body: JSON.stringify({ branch_id: B1, type: 'BANNER', title_ru: 'Online only', link_type: 'NONE', channels: ['ONLINE'] }) });
expect('2. create an ONLINE-only block', onlineBlock.status, 201, onlineBlock.body);
const qrBlock = await request('/api/visual-catalog', { method: 'POST', headers: MGR1.headers, body: JSON.stringify({ branch_id: B1, type: 'BANNER', title_ru: 'QR only', link_type: 'NONE', channels: ['QR'] }) });
expect('2b. create a QR-only block', qrBlock.status, 201, qrBlock.body);
const everywhereBlock = await request('/api/visual-catalog', { method: 'POST', headers: MGR1.headers, body: JSON.stringify({ branch_id: B1, type: 'BANNER', title_ru: 'Everywhere', link_type: 'NONE' }) });
expect('2c. create a block targeting no specific channel (visible everywhere)', everywhereBlock.status, 201, everywhereBlock.body);

const catalogOnline = await request(`/api/visual-catalog/public?branch_id=${B1}&lang=ru&channel=ONLINE`);
dbCheck('3. the ONLINE channel sees the ONLINE block and the untargeted block, not the QR-only one', catalogOnline.body.blocks.some(b => b.id === onlineBlock.body.block.id) && catalogOnline.body.blocks.some(b => b.id === everywhereBlock.body.block.id) && !catalogOnline.body.blocks.some(b => b.id === qrBlock.body.block.id), catalogOnline.body.blocks.map(b => b.title));
const catalogQr = await request(`/api/visual-catalog/public?branch_id=${B1}&lang=ru&channel=QR`);
dbCheck('3b. the QR channel sees the QR block and the untargeted block, not the ONLINE-only one', catalogQr.body.blocks.some(b => b.id === qrBlock.body.block.id) && catalogQr.body.blocks.some(b => b.id === everywhereBlock.body.block.id) && !catalogQr.body.blocks.some(b => b.id === onlineBlock.body.block.id), catalogQr.body.blocks.map(b => b.title));
const catalogAll = await request(`/api/visual-catalog/public?branch_id=${B1}&lang=ru`);
dbCheck('3c. no channel filter sees everything', [onlineBlock, qrBlock, everywhereBlock].every(b => catalogAll.body.blocks.some(x => x.id === b.body.block.id)), catalogAll.body.blocks.length);
dbCheck('3d. THE RULE: the item list and prices are IDENTICAL across every channel -- channel never touches price', JSON.stringify(catalogOnline.body.items) === JSON.stringify(catalogQr.body.items) && JSON.stringify(catalogOnline.body.items) === JSON.stringify(catalogAll.body.items), null);

// ============================================================ 4-8. QR entry: server-side resolution, no IDOR
// QR generation is branches.update, an OWNER/SUPER_ADMIN-level structural permission in this
// codebase (a branch manager cannot edit their own branch's address/phone either) -- so both of
// these checks are genuine RBAC denials, not a branch-scope loophole.
mustDeny('4. a branch manager (holds no branches.update at all) cannot generate a QR code', await request(`/api/branches/${B1}/qr/regenerate`, { method: 'POST', headers: MGR1.headers }));
mustDeny('4b. neither can another branch\'s manager', await request(`/api/branches/${B1}/qr/regenerate`, { method: 'POST', headers: MGR2.headers }));
const qrGen = await request(`/api/branches/${B1}/qr/regenerate`, { method: 'POST', headers: OWNER });
expect('5. the owner regenerates the QR token for branch B1', qrGen.status, 201, qrGen.body);
const token1 = qrGen.body.qr_token;
dbCheck('5b. a real random token, not a predictable value', typeof token1 === 'string' && token1.length >= 20, token1);
const resolved = await request(`/api/public/qr/${token1}`);
expect('6. the public QR resolution answers with no staff auth', resolved.status, 200, resolved.body);
dbCheck('6b. it resolves to the REAL branch B1, and only public-safe fields', resolved.body.branch.id === B1 && !('qr_token' in resolved.body.branch) && !('phone' in resolved.body.branch === false), resolved.body.branch);
mustDeny('7. a garbage token resolves to nothing', await request(`/api/public/qr/not-a-real-token-${stamp}`));

const qrGen2 = await request(`/api/branches/${B2}/qr/regenerate`, { method: 'POST', headers: OWNER });
expect('8. branch B2 (a different franchise) gets its own QR token', qrGen2.status, 201, qrGen2.body);
const token2 = qrGen2.body.qr_token;
dbCheck('8b. the two tokens are different', token1 !== token2, { token1, token2 });
const resolved2 = await request(`/api/public/qr/${token2}`);
dbCheck('8c. THE IDOR CHECK: token2 resolves ONLY to B2, never to B1 -- there is no branch_id parameter to manipulate', resolved2.body.branch.id === B2 && resolved2.body.branch.id !== B1, resolved2.body.branch);
// Attempting to pass a branch_id alongside a valid token changes nothing -- the token alone decides.
const qrSpoof = await request(`/api/public/qr/${token1}?branch_id=${B2}`);
dbCheck('8d. supplying a branch_id alongside the token cannot redirect resolution to another branch', qrSpoof.body.branch.id === B1, qrSpoof.body.branch);

// ============================================================ 9-14. the Promotion Engine
mustDeny('9. a cashier cannot create a promotion', await request('/api/promotions', { method: 'POST', headers: CASHIER1.headers, body: JSON.stringify({ branch_id: B1, menu_item_id: DISH.id, promo_price: '80.00', ends_at: new Date(Date.now() + 3600000).toISOString() }) }));
mustDeny('9b. a promotion at or above the real price is refused -- it would not be a promotion', await request('/api/promotions', { method: 'POST', headers: MGR1.headers, body: JSON.stringify({ branch_id: B1, menu_item_id: DISH.id, promo_price: '100.00', ends_at: new Date(Date.now() + 3600000).toISOString() }) }));
mustDeny('9c. a manager cannot promote another branch/franchise\'s item', await request('/api/promotions', { method: 'POST', headers: MGR2.headers, body: JSON.stringify({ branch_id: B1, menu_item_id: DISH.id, promo_price: '80.00', ends_at: new Date(Date.now() + 3600000).toISOString() }) }));

const promo = await request('/api/promotions', { method: 'POST', headers: MGR1.headers, body: JSON.stringify({ branch_id: B1, menu_item_id: DISH.id, promo_price: '80.00', ends_at: new Date(Date.now() + 3600000).toISOString(), placements: ['PRODUCT_CARD', 'CATALOG'], badge_ru: 'Спец. цена' }) });
expect('10. the manager creates a real, live promotion (100.00 -> 80.00)', promo.status, 201, promo.body);

// An expired promotion and a not-yet-started one, on the OTHER item -- neither should ever appear live.
const expired = await request('/api/promotions', { method: 'POST', headers: MGR1.headers, body: JSON.stringify({ branch_id: B1, menu_item_id: TEA.id, promo_price: '5.00', starts_at: new Date(Date.now() - 7200000).toISOString(), ends_at: new Date(Date.now() - 3600000).toISOString() }) });
expect('11. an already-ended promotion can still be recorded (history)', expired.status, 201, expired.body);
const future = await request('/api/promotions', { method: 'POST', headers: MGR1.headers, body: JSON.stringify({ branch_id: B1, menu_item_id: TEA.id, promo_price: '6.00', starts_at: new Date(Date.now() + 3600000).toISOString(), ends_at: new Date(Date.now() + 7200000).toISOString() }) });
expect('11b. a not-yet-started promotion can be scheduled ahead', future.status, 201, future.body);

const menu2 = await request(`/api/public/menu?branch_id=${B1}&lang=ru`);
const dishAfterPromo = menu2.body.items.find(i => i.id === DISH.id);
dbCheck('12. THE RULE: the live promotion appears with the real promo price and badge', dishAfterPromo && money(dishAfterPromo.promo_price) === 8000 && dishAfterPromo.promo_badge === 'Спец. цена', dishAfterPromo);
const teaAfterPromo = menu2.body.items.find(i => i.id === TEA.id);
dbCheck('12b. THE EXPIRY RULE: the expired and the not-yet-started promotion are BOTH invisible -- expiry is automatic, not a flag someone forgot to flip', teaAfterPromo && teaAfterPromo.promo_price === null, teaAfterPromo);

const catalog2 = await request(`/api/visual-catalog/public?branch_id=${B1}&lang=ru`);
const dishInCatalog = catalog2.body.items.find(i => i.id === DISH.id);
dbCheck('13. the SAME promo price appears through the Visual Catalog -- one shared rule, not two computations that could disagree', dishInCatalog && dishInCatalog.promo_price === dishAfterPromo.promo_price, { menu: dishAfterPromo.promo_price, catalog: dishInCatalog?.promo_price });

const promoList = await request(`/api/promotions?branch_id=${B1}`, { headers: MGR1.headers });
dbCheck('14. the manager sees is_live computed correctly for all three: live, expired, scheduled', promoList.body.promotions.find(p => p.id === promo.body.promotion.id)?.is_live === true && promoList.body.promotions.find(p => p.id === expired.body.promotion.id)?.is_live === false && promoList.body.promotions.find(p => p.id === future.body.promotion.id)?.is_live === false, promoList.body.promotions.map(p => [p.id === promo.body.promotion.id ? 'live' : p.id === expired.body.promotion.id ? 'expired' : 'future', p.is_live]));
mustDeny('14b. branch isolation: MGR2 cannot list B1\'s promotions', await request(`/api/promotions?branch_id=${B1}`, { headers: MGR2.headers }));

const deactivated = await request(`/api/promotions/${promo.body.promotion.id}`, { method: 'DELETE', headers: MGR1.headers });
expect('15. the manager ends the promotion', deactivated.status, 200, deactivated.body);
const menu3 = await request(`/api/public/menu?branch_id=${B1}&lang=ru`);
dbCheck('15b. once ended, the item goes straight back to its real price', menu3.body.items.find(i => i.id === DISH.id)?.promo_price === null, menu3.body.items.find(i => i.id === DISH.id));

// ============================================================ 16. the Order Core is completely untouched
const area = (await request('/api/tables/areas', { method: 'POST', headers: MGR1.headers, body: JSON.stringify({ branch_id: B1, name: 'Hall', sort_order: 0 }) })).body.area;
const table = (await request('/api/tables', { method: 'POST', headers: MGR1.headers, body: JSON.stringify({ branch_id: B1, area_id: area.id, code: `SD-${stamp % 10000}`, seats: 4 }) })).body.table;
expect('16. waiter code', (await request(`/api/waiters/${WAITER1.id}/code`, { method: 'POST', headers: MGR1.headers, body: JSON.stringify({ code: '4471' }) })).status, 201);
const W = { 'x-waiter-session': (await request('/api/waiters/authenticate-code', { method: 'POST', body: JSON.stringify({ code: '4471', deviceId: 'sd-dev' }) })).body.session.token };
const posToken = (await request('/api/operator-pos/unlock', { method: 'POST', headers: CASHIER1.headers, body: JSON.stringify({ password: staffPassword, branch_id: B1, device_id: 'sd-cash' }) })).body.session_token;
expect('16b. open shift', (await request('/api/cash-shifts', { method: 'POST', headers: CASHIER1.headers, body: JSON.stringify({ branch_id: B1, opening_cash: '100.00' }) })).status, 201);
// A NEW promotion, still live, on the item this order will contain -- proves ordering ignores it.
const promo2 = await request('/api/promotions', { method: 'POST', headers: MGR1.headers, body: JSON.stringify({ branch_id: B1, menu_item_id: DISH.id, promo_price: '80.00', ends_at: new Date(Date.now() + 3600000).toISOString() }) });
expect('16c. a fresh live promotion exists on the ordered item', promo2.status, 201, promo2.body);
const order = await request('/api/orders', { method: 'POST', headers: { ...W, 'idempotency-key': `sd-${stamp}` }, body: JSON.stringify({ order_type: 'DINE_IN', source: 'POS', table_id: table.id, items: [{ menu_item_id: DISH.id, quantity: 1 }] }) });
expect('17. an order is created through the EXISTING, untouched Order Core', order.status, 201, order.body);
// subtotal, not final_amount, isolates the price the item was actually added at from the
// branch's own (unrelated, pre-existing) dine-in service charge.
dbCheck('17b. the order uses the REAL menu price (100.00), never the promotional price -- Stage 35.6 added no order-time discount path', money(order.body.order.subtotal) === 10000, order.body.order);

// ============================================================ 18. no internal data leakage anywhere on the public surface
dbCheck('18. no recipe/cost/stock/employee data anywhere in the public catalog response', !JSON.stringify(catalog2.body).match(/recipe_cost|average_cost|current_stock|password_hash|employment_status/), null);
dbCheck('18b. no recipe/cost/stock/employee data in the QR resolution response', !JSON.stringify(resolved.body).match(/recipe_cost|average_cost|current_stock|password_hash|employment_status/), null);

console.log(`\nStage 35.6 online/QR/customer-menu E2E: ${counts.runtime} HTTP calls, ${counts.denials} denials, ${counts.dbPost} DB post-conditions`);
if (failures.length) { console.error(`\nFAILURES (${failures.length}):`); for (const f of failures) console.error(' - ' + f); process.exit(1); }
console.log('ALL STAGE 35.6 ONLINE/QR/CUSTOMER MENU CHECKS PASSED');
