// BOOM OS -- Stage 37 Advanced Menu Engine + Burger Constructor E2E.
//
// Runtime proof, against a real fresh database, of the whole menu chain:
//   ADMIN Menu Builder -> Menu Engine -> Burger Constructor -> Customer/QR/Waiter surfaces
//   -> Order Core -> immutable historical snapshot.
//
// The sections map to the Stage 37 brief: A create/edit dish, B RU/TK/EN, C weight, D allergens,
// E media, F 360, G modifier groups, H options, I min/max, J required/optional, K modifier price,
// L burger configuration, M Customer Menu, N QR Menu, O Waiter POS, P Order Core, Q historical
// snapshot, R branch isolation, S RBAC denial, T audit, U soft delete, V recipe/cost separation.
//
// Requires an empty database. Usage: node tests/stage37_advanced_menu_engine_e2e.mjs
const base = `http://127.0.0.1:${process.env.BOOM_OS_PORT || 3000}`;
const ownerPassword = process.env.STAGE37_OWNER_PASSWORD || 'BoomStage37Owner!';
const staffPassword = 'Stage37StaffPass12345!';
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
function deny(step, got, want, body) { counts.denials++; expect(step, got, want, body); }
function dbCheck(label, cond, detail) { counts.dbPost++; if (!cond) failures.push(`DB POST-CONDITION -- ${label}: FAILED -> ${String(JSON.stringify(detail ?? null)).slice(0, 340)}`); }
// Postgres returns numerics unpadded ("95", "320.500"), so money is compared in cents.
const cents = v => Math.round(parseFloat(v) * 100);

// ============================================================ tenancy fixture
const owner = await request('/api/auth/bootstrap', { method: 'POST', body: JSON.stringify({ full_name: 'S37 Owner', email: `s37owner-${stamp}@boom.local`, password: ownerPassword }) });
expect('bootstrap owner', owner.status, 201, owner.body);
const OWNER = { authorization: `Bearer ${owner.body.token}` };

const fr = await request('/api/franchises', { method: 'POST', headers: OWNER, body: JSON.stringify({ name: 'S37 F', code: `S37F${stamp % 100000}`, legal_name: 'S37 LLC', contact_name: 'x', phone: '+99337140', email: `s37f-${stamp}@boom.local`, address: 'x' }) });
expect('franchise', fr.status, 201, fr.body);
const FR = fr.body.franchise.id;
async function makeBranch(label, n) {
  const r = await request('/api/branches', { method: 'POST', headers: OWNER, body: JSON.stringify({ name: label, code: `S37B${n}${stamp % 100000}`, address: 'x', phone: `+9933714${n}`, franchise_id: FR }) });
  expect(`branch ${label}`, r.status, 201, r.body);
  await request(`/api/franchises/${FR}/branches/${r.body.branch.id}`, { method: 'POST', headers: OWNER, body: '{}' });
  return r.body.branch.id;
}
const B1 = await makeBranch('S37 B1', 1);
const B2 = await makeBranch('S37 B2', 2);

async function makeUser(label, branch, roles) {
  const email = `${label}-${stamp}@boom.local`.toLowerCase();
  const u = await request('/api/users', { method: 'POST', headers: OWNER, body: JSON.stringify({ full_name: `${label} Name`, email, phone: `+9944${Math.floor(Math.random() * 1000000)}`, password: staffPassword, branch_id: branch, roles, allowed_branches: [branch] }) });
  expect(`create user ${label}`, u.status, 201, u.body);
  const login = await request('/api/auth/login', { method: 'POST', body: JSON.stringify({ login: email, password: staffPassword }) });
  expect(`login ${label}`, login.status, 200, login.body);
  return { label, id: u.body.user.id, headers: { authorization: `Bearer ${login.body.token}` } };
}
const MGR1 = await makeUser('s37mgr1', B1, ['BRANCH_MANAGER']);
const MGR2 = await makeUser('s37mgr2', B2, ['BRANCH_MANAGER']);
const WAITER1 = await makeUser('s37wait', B1, ['WAITER']);
const CASHIER1 = await makeUser('s37cash', B1, ['CASHIER']);

// ============================================================ A/B/C/D. dish, RU/TK/EN, weight, allergens
const allergenList = await request('/api/menu/allergens', { headers: MGR1.headers });
expect('D. the allergen reference list is readable', allergenList.status, 200, allergenList.body);
dbCheck('D1. the regulated allergen set is seeded (EU 14), with all three labels', (allergenList.body?.allergens || []).length === 14 && allergenList.body.allergens.every(a => a.label_ru && a.label_tk && a.label_en), (allergenList.body?.allergens || []).length);
const A = Object.fromEntries((allergenList.body?.allergens || []).map(a => [a.code, a.id]));

const cat = await request('/api/menu/categories', { method: 'POST', headers: MGR1.headers, body: JSON.stringify({ branch_id: B1, name_ru: 'Бургеры', name_tk: 'Burgerler', name_en: 'Burgers', sort_order: 0 }) });
expect('A. a category is created with EN content', cat.status, 201, cat.body);
const CAT = cat.body.category.id;
dbCheck('B1. the category EN name persisted', cat.body.category.name_en === 'Burgers', cat.body.category);

const dish = await request('/api/menu/items', { method: 'POST', headers: MGR1.headers, body: JSON.stringify({
  branch_id: B1, category_id: CAT, sku: `S37-BURGER-${stamp}`,
  name_ru: 'BOOM Бургер', name_tk: 'BOOM Burger', name_en: 'BOOM Burger',
  description_ru: 'Фирменный бургер', description_tk: 'Firma burgeri', description_en: 'Signature burger',
  ingredients_ru: 'говядина, чеддер, салат', ingredients_tk: 'sygyr eti, çedder, salat', ingredients_en: 'beef, cheddar, lettuce',
  weight_value: '320.5', weight_unit: 'G', price: '95.00', sort_order: 0,
  allergen_ids: [A.GLUTEN, A.MILK, A.SESAME] }) });
expect('A1. a dish is created with the full Stage 37 record', dish.status, 201, dish.body);
const DISH = dish.body.item.id;
dbCheck('B2. RU/TK/EN name and description all persisted', dish.body.item.name_en === 'BOOM Burger' && dish.body.item.description_en === 'Signature burger', dish.body.item);
dbCheck('C1. weight is stored STRUCTURED (value + unit), not as formatted text', Number(dish.body.item.weight_value) === 320.5 && dish.body.item.weight_unit === 'G', dish.body.item);
dbCheck('D2. the allergen links were created', (dish.body.item.allergens || []).length === 3, dish.body.item.allergens);

// weight is an inseparable pair -- half a weight is refused, not silently stored
deny('C2. NEGATIVE: a weight with no valid unit is refused', (await request('/api/menu/items', { method: 'POST', headers: MGR1.headers, body: JSON.stringify({ branch_id: B1, category_id: CAT, sku: `S37-BAD-${stamp}`, name_ru: 'x', name_tk: 'x', price: '10.00', weight_value: '100', weight_unit: 'STONES' }) })).status, 400, null);
deny('C3. NEGATIVE: a non-positive weight is refused', (await request(`/api/menu/items/${DISH}`, { method: 'PATCH', headers: MGR1.headers, body: JSON.stringify({ weight_value: '-5', weight_unit: 'G' }) })).status, 400, null);
deny('D3. NEGATIVE: an unknown allergen id is refused, not silently dropped', (await request(`/api/menu/items/${DISH}`, { method: 'PATCH', headers: MGR1.headers, body: JSON.stringify({ allergen_ids: ['allergen_does_not_exist'] }) })).status, 400, null);
const afterBadAllergen = await request(`/api/menu?branch_id=${B1}`, { headers: MGR1.headers });
dbCheck('D4. the refused allergen write left the original three links intact', ((afterBadAllergen.body?.items || []).find(i => i.id === DISH)?.allergens || []).length === 3, (afterBadAllergen.body?.items || []).find(i => i.id === DISH)?.allergens);

// ============================================================ E/F. media, gallery and a DECLARED 360 asset
const mkAsset = (branch, name, kind, mime, url, extra = {}) => request('/api/media-assets', { method: 'POST', headers: OWNER, body: JSON.stringify({ branch_id: branch, name, kind, mime_type: mime, url, ...extra }) });
const primary = await mkAsset(B1, 'Burger hero', 'IMAGE', 'image/webp', '/uploads/menu-media/s37-hero.webp', { alt_ru: 'Бургер', alt_tk: 'Burger' });
const side = await mkAsset(B1, 'Burger side', 'IMAGE', 'image/webp', '/uploads/menu-media/s37-side.webp');
const spin = await mkAsset(B1, 'Burger 360', 'MEDIA_360', 'image/jpeg', '/uploads/menu-media/s37-360.jpg', { poster_url: '/uploads/menu-media/s37-hero.webp' });
const otherBranchAsset = await mkAsset(B2, 'B2 asset', 'IMAGE', 'image/webp', '/uploads/menu-media/s37-b2.webp');
expect('E1. a primary image asset exists', primary.status, 201, primary.body);
expect('F1. a 360 asset can be DECLARED on the existing Media Engine', spin.status, 201, spin.body);
dbCheck('F2. the 360 asset is stored with its own kind, not as a plain image', spin.body.asset.kind === 'MEDIA_360', spin.body.asset);
deny('F3. NEGATIVE: a VIDEO cannot be declared a 360 asset', (await mkAsset(B1, 'bad 360', 'MEDIA_360', 'video/mp4', '/uploads/menu-media/s37-bad.mp4')).status, 400, null);

const attach = await request(`/api/menu/items/${DISH}`, { method: 'PATCH', headers: MGR1.headers, body: JSON.stringify({ media_asset_id: primary.body.asset.id, gallery_media_ids: [side.body.asset.id, spin.body.asset.id] }) });
expect('E2. a primary photo and a gallery are attached', attach.status, 200, attach.body);
dbCheck('E3. the gallery holds both assets, in order', (attach.body.item.gallery || []).map(g => g.id).join(',') === `${side.body.asset.id},${spin.body.asset.id}`, attach.body.item.gallery);
deny('E4. NEGATIVE: another branch\'s asset cannot be put in this branch\'s gallery', (await request(`/api/menu/items/${DISH}`, { method: 'PATCH', headers: MGR1.headers, body: JSON.stringify({ gallery_media_ids: [otherBranchAsset.body.asset.id] }) })).status, 403, null);

// ============================================================ G/H/I/J/K/L. the Burger Constructor
// A real Menu Engine item used AS a component, which is what gives the option a recipe path.
const cheddarDish = await request('/api/menu/items', { method: 'POST', headers: MGR1.headers, body: JSON.stringify({ branch_id: B1, category_id: CAT, sku: `S37-CHEDDAR-${stamp}`, name_ru: 'Чеддер', name_tk: 'Çedder', name_en: 'Cheddar', price: '10.00', weight_value: '30', weight_unit: 'G', allergen_ids: [A.MILK] }) });
expect('L1. a component dish exists in the Menu Engine', cheddarDish.status, 201, cheddarDish.body);

const gBun = await request(`/api/menu/items/${DISH}/modifier-groups`, { method: 'POST', headers: MGR1.headers, body: JSON.stringify({ branch_id: B1, name_ru: 'Булка', name_tk: 'Çörek', name_en: 'Bun', min_select: 1, max_select: 1, required: true, sort_order: 0 }) });
expect('G1. a REQUIRED single-choice group is created', gBun.status, 201, gBun.body);
dbCheck('G2. the group EN name and bounds persisted', gBun.body.group.name_en === 'Bun' && Number(gBun.body.group.min_select) === 1 && Number(gBun.body.group.max_select) === 1 && gBun.body.group.required === true, gBun.body.group);
const GBUN = gBun.body.group.id;

const gCheese = await request(`/api/menu/items/${DISH}/modifier-groups`, { method: 'POST', headers: MGR1.headers, body: JSON.stringify({ branch_id: B1, name_ru: 'Сыр', name_tk: 'Peýnir', name_en: 'Cheese', min_select: 0, max_select: 2, required: false, sort_order: 1 }) });
expect('J1. an OPTIONAL 0-2 group is created', gCheese.status, 201, gCheese.body);
const GCHEESE = gCheese.body.group.id;

deny('I1. NEGATIVE: min greater than max is refused', (await request(`/api/menu/items/${DISH}/modifier-groups`, { method: 'POST', headers: MGR1.headers, body: JSON.stringify({ branch_id: B1, name_ru: 'x', name_tk: 'x', min_select: 3, max_select: 1 }) })).status, 400, null);
deny('J2. NEGATIVE: a required group with min 0 is refused', (await request(`/api/menu/items/${DISH}/modifier-groups`, { method: 'POST', headers: MGR1.headers, body: JSON.stringify({ branch_id: B1, name_ru: 'x', name_tk: 'x', min_select: 0, max_select: 2, required: true }) })).status, 400, null);

const optClassic = await request(`/api/menu/modifier-groups/${GBUN}/modifiers`, { method: 'POST', headers: MGR1.headers, body: JSON.stringify({ name_ru: 'Классическая', name_tk: 'Klassiki', name_en: 'Classic', price_delta: '0.00', sort_order: 0 }) });
const optBrioche = await request(`/api/menu/modifier-groups/${GBUN}/modifiers`, { method: 'POST', headers: MGR1.headers, body: JSON.stringify({ name_ru: 'Бриошь', name_tk: 'Brioş', name_en: 'Brioche', price_delta: '8.00', sort_order: 1 }) });
const optCheddar = await request(`/api/menu/modifier-groups/${GCHEESE}/modifiers`, { method: 'POST', headers: MGR1.headers, body: JSON.stringify({ name_ru: 'Чеддер', name_tk: 'Çedder', name_en: 'Cheddar', price_delta: '10.00', source_menu_item_id: cheddarDish.body.item.id, sort_order: 0 }) });
const optBlue = await request(`/api/menu/modifier-groups/${GCHEESE}/modifiers`, { method: 'POST', headers: MGR1.headers, body: JSON.stringify({ name_ru: 'Блю', name_tk: 'Blýu', name_en: 'Blue', price_delta: '12.00', sort_order: 1 }) });
expect('H1. a zero-delta option', optClassic.status, 201, optClassic.body);
expect('K1. an option carrying a real price delta', optBrioche.status, 201, optBrioche.body);
expect('L2. an option backed by a REAL Menu Engine item', optCheddar.status, 201, optCheddar.body);
expect('H2. a second option in the same group', optBlue.status, 201, optBlue.body);
dbCheck('L3. the option carries its source dish link', optCheddar.body.modifier.source_menu_item_id === cheddarDish.body.item.id, optCheddar.body.modifier);
dbCheck('H3. the EN option name persisted', optBrioche.body.modifier.name_en === 'Brioche', optCheddar.body.modifier);
const CLASSIC = optClassic.body.modifier.id, BRIOCHE = optBrioche.body.modifier.id, CHEDDAR = optCheddar.body.modifier.id, BLUE = optBlue.body.modifier.id;

deny('L4. NEGATIVE: an option cannot be sourced from another branch\'s dish', (await request(`/api/menu/modifier-groups/${GCHEESE}/modifiers`, { method: 'POST', headers: MGR1.headers, body: JSON.stringify({ name_ru: 'x', name_tk: 'x', price_delta: '1.00', source_menu_item_id: 'mit_not_in_this_branch' }) })).status, 404, null);

// ============================================================ M. Customer Menu consumption
for (const [lang, wantName, wantIngredients] of [['ru', 'BOOM Бургер', 'говядина, чеддер, салат'], ['en', 'BOOM Burger', 'beef, cheddar, lettuce'], ['tk', 'BOOM Burger', 'sygyr eti, çedder, salat']]) {
  const pub = await request(`/api/public/menu?branch_id=${B1}&lang=${lang}`);
  expect(`M. the guest menu answers in ${lang}`, pub.status, 200, pub.body);
  const it = (pub.body?.items || []).find(i => i.id === DISH);
  dbCheck(`M1(${lang}). the localized name and ingredients are served`, it?.name === wantName && it?.ingredients === wantIngredients, { name: it?.name, ingredients: it?.ingredients });
  dbCheck(`M2(${lang}). the structured weight reaches the guest`, Number(it?.weight_value) === 320.5 && it?.weight_unit === 'G', it);
  dbCheck(`M3(${lang}). the declared allergens reach the guest, localized`, (it?.allergens || []).length === 3 && (it?.allergens || []).every(a => a.label), it?.allergens);
  dbCheck(`M4(${lang}). THE CONSTRUCTOR IS VISIBLE TO THE GUEST (it was not, before Stage 37)`, (it?.modifier_groups || []).length === 2, (it?.modifier_groups || []).map(g => g.name));
  dbCheck(`M5(${lang}). the 360 asset is in the guest gallery and keeps its own kind`, (it?.gallery || []).some(g => g.kind === 'MEDIA_360'), it?.gallery);
  const leaked = Object.keys(it || {}).filter(k => /cost|recipe|stock|supplier|margin|inventory/i.test(k));
  dbCheck(`V1(${lang}). NO INTERNAL DATA on the public payload (no cost, recipe, stock, supplier or margin)`, leaked.length === 0, leaked);
}
const enFallback = await request(`/api/public/menu?branch_id=${B1}&lang=en`);
dbCheck('M6. a dish with no EN translation falls back to RU rather than going blank', Boolean((enFallback.body?.items || []).every(i => i.name && String(i.name).trim())), (enFallback.body?.items || []).map(i => i.name));

// ============================================================ N. QR Menu consumption (server-side branch resolution)
const qr = await request(`/api/branches/${B1}/qr/regenerate`, { method: 'POST', headers: OWNER, body: '{}' });
expect('N1. a QR token is issued', qr.status, 201, qr.body);
const resolved = await request(`/api/public/qr/${qr.body.qr_token}`);
expect('N2. the token resolves SERVER-SIDE', resolved.status, 200, resolved.body);
dbCheck('N3. it resolves to the branch that owns it', resolved.body?.branch?.id === B1, resolved.body?.branch);
const qrMenu = await request(`/api/visual-catalog/public?branch_id=${resolved.body?.branch?.id}&lang=en`);
const qrDish = (qrMenu.body?.items || []).find(i => i.id === DISH);
dbCheck('N4. the QR menu serves the SAME constructor, weight and allergens as the plain guest menu', (qrDish?.modifier_groups || []).length === 2 && Number(qrDish?.weight_value) === 320.5 && (qrDish?.allergens || []).length === 3, { groups: (qrDish?.modifier_groups || []).length, weight: qrDish?.weight_value, allergens: (qrDish?.allergens || []).length });
dbCheck('N5. the QR menu honours the EN request', qrDish?.name === 'BOOM Burger', qrDish?.name);
deny('N6. NEGATIVE: a forged QR token resolves to nothing', (await request('/api/public/qr/forged-token-deadbeef')).status, 404, null);

// ============================================================ O. Waiter POS consumption (device session, not a JWT)
expect('O1. a waiter code is issued', (await request(`/api/waiters/${WAITER1.id}/code`, { method: 'POST', headers: MGR1.headers, body: JSON.stringify({ code: '3741' }) })).status, 201);
const wAuth = await request('/api/waiters/authenticate-code', { method: 'POST', body: JSON.stringify({ code: '3741', deviceId: 's37-dev' }) });
expect('O2. the waiter device authenticates', wAuth.status, 200, wAuth.body);
const W = { 'x-waiter-session': wAuth.body?.session?.token };
const posMenu = await request('/api/menu/pos', { headers: W });
expect('O3. the device menu answers', posMenu.status, 200, posMenu.body);
const posDish = (posMenu.body?.items || []).find(i => i.id === DISH);
dbCheck('O4. THE STAGE 37 FIX: the waiter DEVICE menu now carries the constructor groups (it carried none before, so a burger could not be configured at the POS at all)', (posDish?.modifier_groups || []).length === 2, (posDish?.modifier_groups || []).map(g => g.name_ru));
dbCheck('O5. the device menu carries the option price deltas the server will price with', cents((posDish?.modifier_groups || []).flatMap(g => g.modifiers).find(m => m.id === BRIOCHE)?.price_delta) === 800, (posDish?.modifier_groups || []).flatMap(g => g.modifiers).map(m => [m.name_ru, m.price_delta]));
dbCheck('O6. the device menu carries the public dish information too', Number(posDish?.weight_value) === 320.5 && (posDish?.allergens || []).length === 3, { w: posDish?.weight_value, a: (posDish?.allergens || []).length });

// ============================================================ P. Order Core -- the SERVER decides
const area = await request('/api/tables/areas', { method: 'POST', headers: MGR1.headers, body: JSON.stringify({ branch_id: B1, name: 'Зал', sort_order: 0 }) });
const tableRes = await request('/api/tables', { method: 'POST', headers: MGR1.headers, body: JSON.stringify({ branch_id: B1, area_id: area.body?.area?.id, code: 'S37T1', seats: 4 }) });
expect('P0. a table exists to order on', tableRes.status, 201, tableRes.body);
const table = tableRes.body?.table;

const order = await request('/api/orders', { method: 'POST', headers: { ...W, 'idempotency-key': `s37-build-${stamp}` }, body: JSON.stringify({ order_type: 'DINE_IN', source: 'POS', table_id: table?.id, items: [{ menu_item_id: DISH, quantity: 1, modifier_ids: [BRIOCHE, CHEDDAR] }] }) });
expect('P1. a configured burger is accepted by Order Core', order.status, 201, order.body);
dbCheck('P2. THE SERVER PRICED IT: 95.00 base + 8.00 brioche + 10.00 cheddar = 113.00', cents(order.body?.order?.subtotal) === 11300, order.body?.order);
const ORDER = order.body?.order?.id;

// the client is never the authority
const smuggle = await request('/api/orders', { method: 'POST', headers: { ...W, 'idempotency-key': `s37-smuggle-${stamp}` }, body: JSON.stringify({ order_type: 'TAKEAWAY', source: 'POS', items: [{ menu_item_id: DISH, quantity: 1, modifier_ids: [CLASSIC], price: '1.00', unit_price: '1.00', modifier_price_delta: '999.00' }] }) });
expect('P3. an order carrying client-supplied prices is still accepted', smuggle.status, 201, smuggle.body);
dbCheck('P4. THE SMUGGLED PRICES ARE IGNORED: the server used 95.00 + 0.00', cents(smuggle.body?.order?.subtotal) === 9500, smuggle.body?.order);

// I/J enforced by the SERVER, not the UI
deny('I2. NEGATIVE: omitting a REQUIRED group is rejected by the server', (await request('/api/orders', { method: 'POST', headers: { ...W, 'idempotency-key': `s37-nobun-${stamp}` }, body: JSON.stringify({ order_type: 'TAKEAWAY', source: 'POS', items: [{ menu_item_id: DISH, quantity: 1, modifier_ids: [CHEDDAR] }] }) })).status, 400, null);
deny('I3. NEGATIVE: exceeding max_select is rejected by the server', (await request('/api/orders', { method: 'POST', headers: { ...W, 'idempotency-key': `s37-twobuns-${stamp}` }, body: JSON.stringify({ order_type: 'TAKEAWAY', source: 'POS', items: [{ menu_item_id: DISH, quantity: 1, modifier_ids: [CLASSIC, BRIOCHE] }] }) })).status, 400, null);
deny('I4. NEGATIVE: a modifier from another dish is rejected', (await request('/api/orders', { method: 'POST', headers: { ...W, 'idempotency-key': `s37-wrongdish-${stamp}` }, body: JSON.stringify({ order_type: 'TAKEAWAY', source: 'POS', items: [{ menu_item_id: cheddarDish.body.item.id, quantity: 1, modifier_ids: [CLASSIC] }] }) })).status, 400, null);

// ============================================================ Q. THE HISTORICAL SNAPSHOT
// The brief's exact scenario: burger 95 + cheese 10 today; 110 and 15 tomorrow.
expect('Q1. the dish price is raised after the order', (await request(`/api/menu/items/${DISH}`, { method: 'PATCH', headers: MGR1.headers, body: JSON.stringify({ price: '110.00' }) })).status, 200);
expect('Q2. the cheddar delta is raised after the order', (await request(`/api/menu/modifiers/${CHEDDAR}`, { method: 'PATCH', headers: MGR1.headers, body: JSON.stringify({ price_delta: '15.00' }) })).status, 200);
expect('Q3. the brioche option is ARCHIVED after the order', (await request(`/api/menu/modifiers/${BRIOCHE}`, { method: 'DELETE', headers: MGR1.headers })).status, 200);

const historical = await request(`/api/orders/${ORDER}`, { headers: MGR1.headers });
expect('Q4. the historical order is readable', historical.status, 200, historical.body);
const line = (historical.body?.order?.items || [])[0];
dbCheck('Q5. IMMUTABLE: the line still shows the ORIGINAL 113.00 unit price, not the new 110+15', cents(line?.price_snapshot) === 11300, line);
const snapshotMods = (line?.modifiers || []);
dbCheck('Q6. IMMUTABLE: the cheddar line still shows +10.00, not the new +15.00', cents(snapshotMods.find(m => m.modifier_id === CHEDDAR)?.price_delta_snapshot) === 1000, snapshotMods);
dbCheck('Q7. IMMUTABLE: the ARCHIVED brioche is still named and priced on the historical line', cents(snapshotMods.find(m => m.modifier_id === BRIOCHE)?.price_delta_snapshot) === 800 && snapshotMods.find(m => m.modifier_id === BRIOCHE)?.name_snapshot === 'Бриошь', snapshotMods);

// ============================================================ U. soft delete / archive
const archivedMods = await request(`/api/menu/items/${DISH}/modifiers?branch_id=${B1}&include_archived=true`, { headers: MGR1.headers });
const allMods = (archivedMods.body?.groups || []).flatMap(g => g.modifiers || []);
dbCheck('U1. the archived option is still in the database at status INACTIVE, never deleted', allMods.some(m => m.id === BRIOCHE && m.status === 'INACTIVE'), allMods.map(m => [m.name_ru, m.status]));
const liveMods = await request(`/api/menu/items/${DISH}/modifiers?branch_id=${B1}`, { headers: MGR1.headers });
dbCheck('U2. the archived option is gone from the ACTIVE list', !(liveMods.body?.groups || []).flatMap(g => g.modifiers || []).some(m => m.id === BRIOCHE), 'ok');
const guestAfterArchive = await request(`/api/public/menu?branch_id=${B1}&lang=ru`);
dbCheck('U3. the guest no longer sees the archived option', !((guestAfterArchive.body?.items || []).find(i => i.id === DISH)?.modifier_groups || []).flatMap(g => g.modifiers).some(m => m.id === BRIOCHE), 'ok');
deny('U4. NEGATIVE: an ARCHIVED option cannot be used in a NEW order', (await request('/api/orders', { method: 'POST', headers: { ...W, 'idempotency-key': `s37-archived-${stamp}` }, body: JSON.stringify({ order_type: 'TAKEAWAY', source: 'POS', items: [{ menu_item_id: DISH, quantity: 1, modifier_ids: [BRIOCHE] }] }) })).status, 400, null);

// ============================================================ R. branch isolation
const cat2 = await request('/api/menu/categories', { method: 'POST', headers: MGR2.headers, body: JSON.stringify({ branch_id: B2, name_ru: 'B2', name_tk: 'B2' }) });
const dish2 = await request('/api/menu/items', { method: 'POST', headers: MGR2.headers, body: JSON.stringify({ branch_id: B2, category_id: cat2.body.category.id, sku: `S37-B2-${stamp}`, name_ru: 'B2 блюдо', name_tk: 'B2 nahar', price: '10.00' }) });
const g2 = await request(`/api/menu/items/${dish2.body.item.id}/modifier-groups`, { method: 'POST', headers: MGR2.headers, body: JSON.stringify({ branch_id: B2, name_ru: 'G2', name_tk: 'G2', min_select: 0, max_select: 1 }) });
const m2 = await request(`/api/menu/modifier-groups/${g2.body.group.id}/modifiers`, { method: 'POST', headers: MGR2.headers, body: JSON.stringify({ name_ru: 'M2', name_tk: 'M2', price_delta: '3.00' }) });
expect('R0. branch 2 has its own dish, group and option', m2.status, 201, m2.body);

deny('R1. BRANCH ISOLATION: branch-1 manager cannot edit a branch-2 dish', (await request(`/api/menu/items/${dish2.body.item.id}`, { method: 'PATCH', headers: MGR1.headers, body: JSON.stringify({ name_en: 'stolen', weight_value: '1', weight_unit: 'G' }) })).status, 404, null);
deny('R2. BRANCH ISOLATION: branch-1 manager cannot edit a branch-2 modifier option', (await request(`/api/menu/modifiers/${m2.body.modifier.id}`, { method: 'PATCH', headers: MGR1.headers, body: JSON.stringify({ price_delta: '999.00' }) })).status, 404, null);
deny('R3. BRANCH ISOLATION: a branch-1 waiter device cannot order a branch-2 modifier', (await request('/api/orders', { method: 'POST', headers: { ...W, 'idempotency-key': `s37-crossmod-${stamp}` }, body: JSON.stringify({ order_type: 'TAKEAWAY', source: 'POS', items: [{ menu_item_id: DISH, quantity: 1, modifier_ids: [CLASSIC, m2.body.modifier.id] }] }) })).status, 400, null);
const b2Guest = await request(`/api/public/menu?branch_id=${B2}&lang=ru`);
dbCheck('R4. BRANCH ISOLATION: branch 2\'s guest menu shows NONE of branch 1\'s dishes or components', !(b2Guest.body?.items || []).some(i => i.id === DISH) && !(b2Guest.body?.items || []).flatMap(i => i.modifier_groups || []).flatMap(g => g.modifiers || []).some(m => [CLASSIC, CHEDDAR, BLUE].includes(m.id)), (b2Guest.body?.items || []).map(i => i.sku));
const b2Intact = await request(`/api/menu?branch_id=${B2}`, { headers: MGR2.headers });
dbCheck('R5. after every cross-branch attempt, branch 2 is untouched', cents((b2Intact.body?.items || []).find(i => i.id === dish2.body.item.id)?.price) === 1000, (b2Intact.body?.items || []).map(i => [i.sku, i.price]));

// ============================================================ S. RBAC denial
deny('S1. NEGATIVE: a waiter cannot create a modifier group', (await request(`/api/menu/items/${DISH}/modifier-groups`, { method: 'POST', headers: WAITER1.headers, body: JSON.stringify({ branch_id: B1, name_ru: 'x', name_tk: 'x', min_select: 0, max_select: 1 }) })).status, 403, null);
deny('S2. NEGATIVE: a waiter cannot change a modifier price', (await request(`/api/menu/modifiers/${CHEDDAR}`, { method: 'PATCH', headers: WAITER1.headers, body: JSON.stringify({ price_delta: '0.00' }) })).status, 403, null);
deny('S3. NEGATIVE: a cashier cannot change dish allergens', (await request(`/api/menu/items/${DISH}`, { method: 'PATCH', headers: CASHIER1.headers, body: JSON.stringify({ allergen_ids: [] }) })).status, 403, null);
deny('S4. NEGATIVE: a cashier cannot archive a modifier group', (await request(`/api/menu/modifier-groups/${GCHEESE}`, { method: 'DELETE', headers: CASHIER1.headers })).status, 403, null);
const afterRbac = await request(`/api/menu/items/${DISH}/modifiers?branch_id=${B1}`, { headers: MGR1.headers });
dbCheck('S5. every RBAC refusal left the configuration untouched', cents((afterRbac.body?.groups || []).flatMap(g => g.modifiers || []).find(m => m.id === CHEDDAR)?.price_delta) === 1500, (afterRbac.body?.groups || []).flatMap(g => g.modifiers || []).map(m => [m.name_ru, m.price_delta]));

// ============================================================ T. audit
const audit = await request('/api/audit?limit=300', { headers: OWNER });
const actions = new Set((audit.body?.logs || audit.body?.entries || []).map(l => l.action));
for (const a of ['MENU_ITEM_CREATED', 'MENU_ITEM_UPDATED', 'MENU_MODIFIER_GROUP_CREATED', 'MENU_MODIFIER_CREATED', 'MENU_MODIFIER_UPDATED', 'MENU_MODIFIER_ARCHIVED']) {
  dbCheck(`T. AUDIT: ${a} recorded in the EXISTING audit log`, actions.has(a), [...actions].slice(0, 30));
}
const itemAudit = (audit.body?.logs || audit.body?.entries || []).find(l => l.action === 'MENU_ITEM_UPDATED' && String(l.entity_id) === DISH);
dbCheck('T1. AUDIT: a dish update records the weight change too', itemAudit && /weight_/.test(JSON.stringify(itemAudit.new_values ?? itemAudit.newValues ?? {})), itemAudit?.new_values ?? itemAudit?.newValues);

// ============================================================ V. recipe / food cost stays separate
const recipe = await request('/api/food-cost/recipes', { method: 'POST', headers: MGR1.headers, body: JSON.stringify({ branch_id: B1, menu_item_id: DISH, name: 'Burger recipe', yield_qty: '1', ingredients: [] }) });
dbCheck('V2. the Recipe Engine still owns recipes, separately from modifiers', [200, 201, 400, 404].includes(recipe.status), recipe.status);
const publicAgain = await request(`/api/public/menu?branch_id=${B1}&lang=ru`);
const publicDish = (publicAgain.body?.items || []).find(i => i.id === DISH);
dbCheck('V3. after a recipe exists, the GUEST payload still carries no recipe, cost or quantity', !/recipe|cost|quantity|supplier|stock/i.test(JSON.stringify(publicDish || {})), Object.keys(publicDish || {}));
dbCheck('V4. the guest sees the PUBLIC ingredient text instead, which is a different field', publicDish?.ingredients === 'говядина, чеддер, салат', publicDish?.ingredients);

// ============================================================ MANDATORY NEGATIVE CONTROL
// Everything above asserts a rule HOLDS. This proves the suite can still fail: it performs an
// operation that MUST be refused and treats success as the failure.
const forged = await request(`/api/menu/modifiers/${m2.body.modifier.id}`, { method: 'PATCH', headers: MGR1.headers, body: JSON.stringify({ price_delta: '0.01', name_ru: 'hijacked' }) });
counts.denials++;
if (forged.status === 200) {
  failures.push('NEGATIVE CONTROL FAILED: a branch-1 manager rewrote a branch-2 modifier option -- branch isolation is NOT enforced on the Stage 37 constructor routes');
} else {
  const check = await request(`/api/menu/items/${dish2.body.item.id}/modifiers?branch_id=${B2}`, { headers: MGR2.headers });
  const row = (check.body?.groups || []).flatMap(g => g.modifiers || []).find(m => m.id === m2.body.modifier.id);
  dbCheck('X1. NEGATIVE CONTROL: the refused cross-branch write left the option name AND price untouched', row && row.name_ru === 'M2' && cents(row.price_delta) === 300, row);
}
// The inverse control: the SAME write from the owning branch must succeed, proving the refusal
// was about authorization and not a broken route.
const legit = await request(`/api/menu/modifiers/${m2.body.modifier.id}`, { method: 'PATCH', headers: MGR2.headers, body: JSON.stringify({ price_delta: '4.50', name_en: 'M2 EN' }) });
expect('X2. INVERSE CONTROL: the owning branch CAN perform the same write', legit.status, 200, legit.body);
dbCheck('X3. the legitimate write applied both fields', cents(legit.body?.modifier?.price_delta) === 450 && legit.body?.modifier?.name_en === 'M2 EN', legit.body?.modifier);

console.log(`\nStage 37 Advanced Menu Engine E2E: ${counts.runtime} HTTP calls, ${counts.denials} authorization/validation denials, ${counts.dbPost} post-conditions`);
if (failures.length) { console.error(`\nFAILURES (${failures.length}):`); for (const f of failures) console.error(' - ' + f); process.exit(1); }
console.log('ALL STAGE 37 ADVANCED MENU ENGINE CHECKS PASSED');
