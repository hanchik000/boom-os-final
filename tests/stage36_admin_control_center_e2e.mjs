// BOOM OS -- Stage 36 Admin Control Center E2E.
//
// Runtime proof, against a real fresh database, that the ADMIN surfaces added in Stage 36
// actually CONTROL the existing engines rather than merely displaying them:
//   1. Menu Builder writes reach the real Menu Engine (categories, dishes, prices, modifier
//      groups, modifier options) and archive SOFT, never hard-delete.
//   2. Dish media is a single FK into the EXISTING media_assets table and surfaces identically
//      on the admin menu, the waiter POS menu, the public guest menu and the visual catalog.
//   3. Branding lives in the existing system_settings table, is readable publicly and is
//      writable only with settings.update, leaving a SETTINGS_UPDATED audit record.
//   4. RBAC and branch isolation hold on every new route (negative controls, not just happy path).
//   5. The mandatory negative control: a genuinely forbidden operation genuinely fails.
//
// Requires an empty database. Usage: node tests/stage36_admin_control_center_e2e.mjs
const base = `http://127.0.0.1:${process.env.BOOM_OS_PORT || 3000}`;
const ownerPassword = process.env.STAGE36_OWNER_PASSWORD || 'BoomStage36Owner!';
const staffPassword = 'Stage36StaffPass12345!';
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
// Postgres returns numerics without trailing zeros ("105.5", "30"), so every money assertion
// compares CENTS rather than the string form.
const cents = v => Math.round(parseFloat(v) * 100);
function dbCheck(label, cond, detail) { counts.dbPost++; if (!cond) failures.push(`DB POST-CONDITION -- ${label}: FAILED -> ${String(JSON.stringify(detail ?? null)).slice(0, 340)}`); }

// ============================================================ tenancy fixture
const owner = await request('/api/auth/bootstrap', { method: 'POST', body: JSON.stringify({ full_name: 'S36 Owner', email: `s36owner-${stamp}@boom.local`, password: ownerPassword }) });
expect('bootstrap owner', owner.status, 201, owner.body);
const OWNER = { authorization: `Bearer ${owner.body.token}` };

const fr = await request('/api/franchises', { method: 'POST', headers: OWNER, body: JSON.stringify({ name: 'S36 F', code: `S36F${stamp % 100000}`, legal_name: 'S36 LLC', contact_name: 'x', phone: '+99336140', email: `s36f-${stamp}@boom.local`, address: 'x' }) });
expect('franchise', fr.status, 201, fr.body);
const FR = fr.body.franchise.id;
async function makeBranch(label, n) {
  const r = await request('/api/branches', { method: 'POST', headers: OWNER, body: JSON.stringify({ name: label, code: `S36B${n}${stamp % 100000}`, address: 'x', phone: `+9933614${n}`, franchise_id: FR }) });
  expect(`branch ${label}`, r.status, 201, r.body);
  await request(`/api/franchises/${FR}/branches/${r.body.branch.id}`, { method: 'POST', headers: OWNER, body: '{}' });
  return r.body.branch.id;
}
const B1 = await makeBranch('S36 B1', 1);
const B2 = await makeBranch('S36 B2', 2);

async function makeUser(label, branch, roles) {
  const email = `${label}-${stamp}@boom.local`.toLowerCase();
  const u = await request('/api/users', { method: 'POST', headers: OWNER, body: JSON.stringify({ full_name: `${label} Name`, email, phone: `+9943${Math.floor(Math.random() * 1000000)}`, password: staffPassword, branch_id: branch, roles, allowed_branches: [branch] }) });
  expect(`create user ${label}`, u.status, 201, u.body);
  const login = await request('/api/auth/login', { method: 'POST', body: JSON.stringify({ login: email, password: staffPassword }) });
  expect(`login ${label}`, login.status, 200, login.body);
  return { label, id: u.body.user.id, headers: { authorization: `Bearer ${login.body.token}` } };
}
const MGR1 = await makeUser('s36mgr1', B1, ['BRANCH_MANAGER']);
const MGR2 = await makeUser('s36mgr2', B2, ['BRANCH_MANAGER']);
const WAITER1 = await makeUser('s36wait', B1, ['WAITER']);

// ============================================================ 1. Menu Builder -> the real Menu Engine
const cat = await request('/api/menu/categories', { method: 'POST', headers: MGR1.headers, body: JSON.stringify({ branch_id: B1, name_ru: 'Бургеры', name_tk: 'Burgerler', sort_order: 1 }) });
expect('1. Menu Builder creates a real category', cat.status, 201, cat.body);
const CAT = cat.body.category.id;

const dish = await request('/api/menu/items', { method: 'POST', headers: MGR1.headers, body: JSON.stringify({ branch_id: B1, category_id: CAT, sku: `S36-BURGER-${stamp}`, name_ru: 'BOOM Бургер', name_tk: 'BOOM Burger', price: '95.00', sort_order: 1 }) });
expect('1b. Menu Builder creates a real dish at a real price', dish.status, 201, dish.body);
const DISH = dish.body.item.id;

const repriced = await request(`/api/menu/items/${DISH}`, { method: 'PATCH', headers: MGR1.headers, body: JSON.stringify({ price: '105.50' }) });
expect('1c. Menu Builder changes the real price', repriced.status, 200, repriced.body);
dbCheck('1d. the price change is what the server returns, not a frontend value', cents(repriced.body.item.price) === 10550, repriced.body.item);

// ============================================================ 2. Burger Constructor == modifier groups on the existing engine
const grp = await request(`/api/menu/items/${DISH}/modifier-groups`, { method: 'POST', headers: MGR1.headers, body: JSON.stringify({ branch_id: B1, name_ru: 'Котлета', name_tk: 'Kotlet', min_select: 1, max_select: 1, required: true, sort_order: 0 }) });
expect('2. Burger Constructor component = a real modifier group', grp.status, 201, grp.body);
const GRP = grp.body.group.id;

const optA = await request(`/api/menu/modifier-groups/${GRP}/modifiers`, { method: 'POST', headers: MGR1.headers, body: JSON.stringify({ name_ru: 'Говядина', name_tk: 'Sygyr eti', price_delta: '0.00', sort_order: 0 }) });
const optB = await request(`/api/menu/modifier-groups/${GRP}/modifiers`, { method: 'POST', headers: MGR1.headers, body: JSON.stringify({ name_ru: 'Двойная', name_tk: 'Goşa', price_delta: '25.00', sort_order: 1 }) });
expect('2b. component option A', optA.status, 201, optA.body);
expect('2c. component option B carries a real price delta', optB.status, 201, optB.body);
const OPT_B = optB.body.modifier.id;

// Stage 36 additions: the group and the option can now be EDITED and ARCHIVED from ADMIN.
const grpPatch = await request(`/api/menu/modifier-groups/${GRP}`, { method: 'PATCH', headers: MGR1.headers, body: JSON.stringify({ name_ru: 'Котлета (основа)', max_select: 2 }) });
expect('2d. Stage 36: a modifier group can be edited', grpPatch.status, 200, grpPatch.body);
dbCheck('2e. the group edit persisted server-side', grpPatch.body.group.name_ru === 'Котлета (основа)' && Number(grpPatch.body.group.max_select) === 2, grpPatch.body.group);

const modPatch = await request(`/api/menu/modifiers/${OPT_B}`, { method: 'PATCH', headers: MGR1.headers, body: JSON.stringify({ price_delta: '30.00' }) });
expect('2f. Stage 36: a modifier option price delta can be edited', modPatch.status, 200, modPatch.body);
dbCheck('2g. the option price delta persisted server-side', cents(modPatch.body.modifier.price_delta) === 3000, modPatch.body.modifier);

// An order built through the Burger Constructor prices from the SERVER, delta included.
const tables = await request(`/api/tables?branch_id=${B1}`, { headers: MGR1.headers });
const table = (tables.body?.tables || [])[0];
if (table) {
  const order = await request('/api/orders', { method: 'POST', headers: { ...WAITER1.headers, 'idempotency-key': `s36-burger-${stamp}` }, body: JSON.stringify({ order_type: 'DINE_IN', source: 'POS', table_id: table.id, items: [{ menu_item_id: DISH, quantity: 1, modifier_ids: [OPT_B] }] }) });
  expect('2h. an order using a constructor option is accepted by Order Core', order.status, 201, order.body);
  dbCheck('2i. NO SECOND ENGINE: the total is the server price + the server delta (105.50 + 30.00)', Math.round(parseFloat(order.body?.order?.subtotal) * 100) === 13550, order.body?.order);
}

// ============================================================ 3. Archiving is SOFT, and archived rows are reachable again
const modArchive = await request(`/api/menu/modifiers/${OPT_B}`, { method: 'DELETE', headers: MGR1.headers });
expect('3. Stage 36: archiving a modifier option', modArchive.status, 200, modArchive.body);
const modsActive = await request(`/api/menu/items/${DISH}/modifiers?branch_id=${B1}`, { headers: MGR1.headers });
const modsAll = await request(`/api/menu/items/${DISH}/modifiers?branch_id=${B1}&include_archived=true`, { headers: MGR1.headers });
const flat = r => (r.body?.groups || []).flatMap(g => g.modifiers || []);
dbCheck('3b. the archived option is gone from the ACTIVE list', !flat(modsActive).some(m => m.id === OPT_B), flat(modsActive));
dbCheck('3c. SOFT DELETE: the archived option is still in the database and visible with include_archived', flat(modsAll).some(m => m.id === OPT_B && m.status === 'INACTIVE'), flat(modsAll));

const grpArchive = await request(`/api/menu/modifier-groups/${GRP}`, { method: 'DELETE', headers: MGR1.headers });
expect('3d. Stage 36: archiving a modifier group', grpArchive.status, 200, grpArchive.body);
const groupsAll = await request(`/api/menu/items/${DISH}/modifiers?branch_id=${B1}&include_archived=true`, { headers: MGR1.headers });
dbCheck('3e. the group is archived, not deleted', (groupsAll.body?.groups || []).some(g => g.id === GRP && g.status === 'INACTIVE'), groupsAll.body?.groups);

// ============================================================ 4. Dish media -> the EXISTING media_assets table
const asset1 = await request('/api/media-assets', { method: 'POST', headers: OWNER, body: JSON.stringify({ branch_id: B1, name: 'Burger hero', kind: 'IMAGE', mime_type: 'image/webp', url: '/uploads/menu-media/s36-burger.webp', alt_ru: 'Бургер', alt_tk: 'Burger', focal_x: 40, focal_y: 60 }) });
expect('4. a media asset exists in the existing Media Engine', asset1.status, 201, asset1.body);
const ASSET1 = asset1.body.asset.id;
const asset2 = await request('/api/media-assets', { method: 'POST', headers: OWNER, body: JSON.stringify({ branch_id: B2, name: 'Other branch asset', kind: 'IMAGE', mime_type: 'image/webp', url: '/uploads/menu-media/s36-other.webp' }) });
expect('4b. a media asset in a DIFFERENT branch exists', asset2.status, 201, asset2.body);
const ASSET2 = asset2.body.asset.id;

const attach = await request(`/api/menu/items/${DISH}`, { method: 'PATCH', headers: MGR1.headers, body: JSON.stringify({ media_asset_id: ASSET1 }) });
expect('4c. Stage 36: a dish photo can be attached from the Media Library', attach.status, 200, attach.body);
dbCheck('4d. the dish now carries the media FK', attach.body.item.media_asset_id === ASSET1, attach.body.item);

const adminMenu = await request(`/api/menu?branch_id=${B1}`, { headers: MGR1.headers });
const adminDish = (adminMenu.body?.items || []).find(i => i.id === DISH);
dbCheck('4e. ONE SOURCE: the admin menu resolves the photo URL from media_assets', adminDish?.media_url === '/uploads/menu-media/s36-burger.webp', adminDish);

// The waiter POS menu is served to a DEVICE session (4-digit code), not a JWT -- exactly the
// path a real waiter tablet takes.
expect('4f-pre. a waiter code is issued', (await request(`/api/waiters/${WAITER1.id}/code`, { method: 'POST', headers: MGR1.headers, body: JSON.stringify({ code: '3641' }) })).status, 201);
const wAuth = await request('/api/waiters/authenticate-code', { method: 'POST', body: JSON.stringify({ code: '3641', deviceId: 's36-dev' }) });
expect('4f-pre2. the waiter device authenticates', wAuth.status, 200, wAuth.body);
const POS_SESSION = { 'x-waiter-session': wAuth.body?.session?.token };
const posMenu = await request(`/api/menu/pos?branch_id=${B1}`, { headers: POS_SESSION });
const posDish = (posMenu.body?.items || []).find(i => i.id === DISH);
dbCheck('4f. ONE SOURCE: the waiter POS menu shows the SAME photo', posDish?.media_url === '/uploads/menu-media/s36-burger.webp', posDish);

const publicMenu = await request(`/api/public/menu?branch_id=${B1}&lang=ru`);
const publicDish = (publicMenu.body?.items || []).find(i => i.id === DISH);
dbCheck('4g. ONE SOURCE: the guest menu shows the SAME photo', publicDish?.media_url === '/uploads/menu-media/s36-burger.webp', publicDish);
dbCheck('4h. the guest menu carries the asset alt text, not an invented one', publicDish?.media_alt === 'Бургер', publicDish);

const publicCatalog = await request(`/api/visual-catalog/public?branch_id=${B1}&lang=ru`);
const catalogDish = (publicCatalog.body?.items || []).find(i => i.id === DISH);
dbCheck('4i. ONE SOURCE: the visual catalog shows the SAME photo', catalogDish?.media_url === '/uploads/menu-media/s36-burger.webp', catalogDish);

// ---- media RBAC / branch isolation negative controls ----
const crossBranchMedia = await request(`/api/menu/items/${DISH}`, { method: 'PATCH', headers: MGR1.headers, body: JSON.stringify({ media_asset_id: ASSET2 }) });
deny('4j. NEGATIVE: a branch-1 dish cannot borrow a branch-2 media asset', crossBranchMedia.status, 403, crossBranchMedia.body);
const missingMedia = await request(`/api/menu/items/${DISH}`, { method: 'PATCH', headers: MGR1.headers, body: JSON.stringify({ media_asset_id: 'masset_does_not_exist' }) });
deny('4k. NEGATIVE: an unknown media id is rejected, never stored', missingMedia.status, 404, missingMedia.body);
const stillAttached = await request(`/api/menu?branch_id=${B1}`, { headers: MGR1.headers });
dbCheck('4l. after both rejections the dish still holds its ORIGINAL photo', (stillAttached.body?.items || []).find(i => i.id === DISH)?.media_asset_id === ASSET1, stillAttached.body?.items?.find?.(i => i.id === DISH));

const detach = await request(`/api/menu/items/${DISH}`, { method: 'PATCH', headers: MGR1.headers, body: JSON.stringify({ media_asset_id: null }) });
expect('4m. a dish photo can be detached', detach.status, 200, detach.body);
dbCheck('4n. detaching clears the FK without deleting the asset', detach.body.item.media_asset_id === null, detach.body.item);
const assetSurvives = await request(`/api/media-assets?branch_id=${B1}`, { headers: OWNER });
dbCheck('4o. NO CASCADE DELETE: the media asset itself still exists after detach', (assetSurvives.body?.assets || []).some(a => a.id === ASSET1), assetSurvives.body?.assets?.length);
await request(`/api/menu/items/${DISH}`, { method: 'PATCH', headers: MGR1.headers, body: JSON.stringify({ media_asset_id: ASSET1 }) });

// ============================================================ 5. Branding == the existing system_settings table
const brandingPublic = await request('/api/public/branding');
expect('5. branding is readable without a session (guest menu / waiter device need it)', brandingPublic.status, 200, brandingPublic.body);
dbCheck('5b. branding is seeded, not invented by the frontend', typeof brandingPublic.body?.branding?.product_name === 'string' && brandingPublic.body.branding.product_name.length > 0, brandingPublic.body);

const brandWrite = await request('/api/settings/BRANDING_NETWORK_NAME', { method: 'PUT', headers: OWNER, body: JSON.stringify({ value: `S36 Network ${stamp}` }) });
expect('5c. branding is written through the EXISTING settings route', brandWrite.status, 200, brandWrite.body);
const brandingAfter = await request('/api/public/branding');
dbCheck('5d. the public branding reflects the change immediately', brandingAfter.body?.branding?.network_name === `S36 Network ${stamp}`, brandingAfter.body);

const audit = await request(`/api/audit?action=SETTINGS_UPDATED&limit=50`, { headers: OWNER });
dbCheck('5e. AUDIT: the branding change landed in the EXISTING audit log as SETTINGS_UPDATED', (audit.body?.logs || audit.body?.entries || []).some(l => String(l.entity_id || '') === 'BRANDING_NETWORK_NAME'), (audit.body?.logs || audit.body?.entries || []).slice(0, 3));

deny('5f. NEGATIVE: a branch manager without settings.update cannot change branding', (await request('/api/settings/BRANDING_PRODUCT_NAME', { method: 'PUT', headers: MGR1.headers, body: JSON.stringify({ value: 'HIJACKED' }) })).status, 403, null);
const brandingUnchanged = await request('/api/public/branding');
dbCheck('5g. the denied branding write changed nothing', brandingUnchanged.body?.branding?.product_name !== 'HIJACKED', brandingUnchanged.body);

// ============================================================ 6. Menu Builder RBAC + branch isolation
deny('6. NEGATIVE: a waiter cannot create a menu category', (await request('/api/menu/categories', { method: 'POST', headers: WAITER1.headers, body: JSON.stringify({ branch_id: B1, name_ru: 'x', name_tk: 'x' }) })).status, 403, null);
deny('6b. NEGATIVE: a waiter cannot change a dish price', (await request(`/api/menu/items/${DISH}`, { method: 'PATCH', headers: WAITER1.headers, body: JSON.stringify({ price: '1.00' }) })).status, 403, null);
deny('6c. NEGATIVE: a waiter cannot archive a dish', (await request(`/api/menu/items/${DISH}`, { method: 'DELETE', headers: WAITER1.headers })).status, 403, null);

// A second manager, scoped to branch 2, must not reach branch 1's menu objects at all.
const cat2 = await request('/api/menu/categories', { method: 'POST', headers: MGR2.headers, body: JSON.stringify({ branch_id: B2, name_ru: 'B2', name_tk: 'B2' }) });
const dish2 = await request('/api/menu/items', { method: 'POST', headers: MGR2.headers, body: JSON.stringify({ branch_id: B2, category_id: cat2.body.category.id, sku: `S36-B2-${stamp}`, name_ru: 'B2 блюдо', name_tk: 'B2 nahar', price: '10.00' }) });
expect('6d. branch 2 has its own menu', dish2.status, 201, dish2.body);
const grp2 = await request(`/api/menu/items/${dish2.body.item.id}/modifier-groups`, { method: 'POST', headers: MGR2.headers, body: JSON.stringify({ branch_id: B2, name_ru: 'G2', name_tk: 'G2', min_select: 0, max_select: 1 }) });
expect('6e. branch 2 has its own modifier group', grp2.status, 201, grp2.body);

deny('6f. BRANCH ISOLATION: branch-1 manager cannot edit a branch-2 modifier group', (await request(`/api/menu/modifier-groups/${grp2.body.group.id}`, { method: 'PATCH', headers: MGR1.headers, body: JSON.stringify({ name_ru: 'stolen' }) })).status, 404, null);
deny('6g. BRANCH ISOLATION: branch-1 manager cannot archive a branch-2 modifier group', (await request(`/api/menu/modifier-groups/${grp2.body.group.id}`, { method: 'DELETE', headers: MGR1.headers })).status, 404, null);
deny('6h. BRANCH ISOLATION: branch-1 manager cannot edit a branch-2 dish', (await request(`/api/menu/items/${dish2.body.item.id}`, { method: 'PATCH', headers: MGR1.headers, body: JSON.stringify({ price: '1.00' }) })).status, 404, null);

const b2Intact = await request(`/api/menu?branch_id=${B2}`, { headers: MGR2.headers });
dbCheck('6i. after every cross-branch attempt, branch 2 is untouched', (b2Intact.body?.items || []).some(i => i.id === dish2.body.item.id && cents(i.price) === 1000), b2Intact.body?.items);

// ============================================================ 7. Menu Builder audit records
const menuAudit = await request('/api/audit?limit=200', { headers: OWNER });
const actions = new Set((menuAudit.body?.logs || menuAudit.body?.entries || []).map(l => l.action));
for (const a of ['MENU_MODIFIER_GROUP_UPDATED', 'MENU_MODIFIER_GROUP_ARCHIVED', 'MENU_MODIFIER_UPDATED', 'MENU_MODIFIER_ARCHIVED']) {
  dbCheck(`7. AUDIT: ${a} recorded in the EXISTING audit log`, actions.has(a), [...actions].slice(0, 25));
}

// ============================================================ 8. Visual Catalog / Banner administration
const banner = await request('/api/visual-catalog', { method: 'POST', headers: MGR1.headers, body: JSON.stringify({ branch_id: B1, type: 'BANNER', title_ru: 'Баннер', title_tk: 'Baner', media_asset_id: ASSET1, link_type: 'CATEGORY', category_id: CAT, sort_order: 1, priority: 0, active: true, channels: ['QR'] }) });
expect('8. a banner block is created on the existing visual catalog engine', banner.status, 201, banner.body);
const BANNER = banner.body.block.id;
const bannerPatch = await request(`/api/visual-catalog/${BANNER}`, { method: 'PATCH', headers: MGR1.headers, body: JSON.stringify({ type: 'BANNER', title_ru: 'Баннер 2', subtitle_ru: 'Подзаголовок', link_type: 'CATEGORY', category_id: CAT, media_asset_id: ASSET1, sort_order: 2, priority: 5, active: true, channels: ['QR', 'ONLINE'] }) });
expect('8b. Stage 36: an existing banner can be fully edited (subtitle, channels, priority)', bannerPatch.status, 200, bannerPatch.body);
dbCheck('8c. the banner edit persisted server-side', bannerPatch.body.block.title_ru === 'Баннер 2' && bannerPatch.body.block.subtitle_ru === 'Подзаголовок' && Number(bannerPatch.body.block.priority) === 5, bannerPatch.body.block);

const qrView = await request(`/api/visual-catalog/public?branch_id=${B1}&lang=ru&channel=QR`);
const localView = await request(`/api/visual-catalog/public?branch_id=${B1}&lang=ru&channel=LOCAL`);
dbCheck('8d. channel targeting is honoured server-side: the banner shows on QR', (qrView.body?.blocks || []).some(b => b.id === BANNER), (qrView.body?.blocks || []).map(b => b.id));
dbCheck('8e. channel targeting is honoured server-side: the banner is hidden on LOCAL', !(localView.body?.blocks || []).some(b => b.id === BANNER), (localView.body?.blocks || []).map(b => b.id));

const bannerOff = await request(`/api/visual-catalog/${BANNER}`, { method: 'DELETE', headers: MGR1.headers });
expect('8f. a banner is deactivated, not deleted', bannerOff.status, 200, bannerOff.body);
const adminBlocks = await request(`/api/visual-catalog?branch_id=${B1}`, { headers: MGR1.headers });
dbCheck('8g. SOFT DELETE: the deactivated banner is still listed for ADMIN so it can be restored', (adminBlocks.body?.blocks || []).some(b => b.id === BANNER && !b.active), (adminBlocks.body?.blocks || []).map(b => ({ id: b.id, active: b.active })));
const guestAfterOff = await request(`/api/visual-catalog/public?branch_id=${B1}&lang=ru&channel=QR`);
dbCheck('8h. the guest no longer sees the deactivated banner', !(guestAfterOff.body?.blocks || []).some(b => b.id === BANNER), (guestAfterOff.body?.blocks || []).map(b => b.id));
deny('8i. NEGATIVE: a waiter cannot create a banner', (await request('/api/visual-catalog', { method: 'POST', headers: WAITER1.headers, body: JSON.stringify({ branch_id: B1, type: 'BANNER' }) })).status, 403, null);

// ============================================================ 9. Promotion administration (edit path added in Stage 36)
const promo = await request('/api/promotions', { method: 'POST', headers: MGR1.headers, body: JSON.stringify({ branch_id: B1, menu_item_id: DISH, promo_price: '80.00', starts_at: new Date(Date.now() - 60000).toISOString(), ends_at: new Date(Date.now() + 3600000).toISOString(), placements: ['PRODUCT_CARD'] }) });
expect('9. a promotion exists on a real dish', promo.status, 201, promo.body);
const PROMO = promo.body.promotion.id;
const promoPatch = await request(`/api/promotions/${PROMO}`, { method: 'PATCH', headers: MGR1.headers, body: JSON.stringify({ promo_price: '85.00', starts_at: new Date(Date.now() - 60000).toISOString(), ends_at: new Date(Date.now() + 7200000).toISOString(), placements: ['PRODUCT_CARD', 'CATALOG'], badge_ru: 'Скидка' }) });
expect('9b. Stage 36: an existing promotion can be edited from ADMIN', promoPatch.status, 200, promoPatch.body);
dbCheck('9c. the promotion edit persisted server-side', cents(promoPatch.body.promotion.promo_price) === 8500, promoPatch.body.promotion);
const menuWithPromo = await request(`/api/public/menu?branch_id=${B1}&lang=ru`);
dbCheck('9d. the guest menu shows the SERVER-computed promo price, not a frontend one', cents((menuWithPromo.body?.items || []).find(i => i.id === DISH)?.promo_price) === 8500, (menuWithPromo.body?.items || []).find(i => i.id === DISH));

const badPromo = await request(`/api/promotions/${PROMO}`, { method: 'PATCH', headers: MGR1.headers, body: JSON.stringify({ starts_at: new Date(Date.now() + 7200000).toISOString(), ends_at: new Date(Date.now() + 60000).toISOString() }) });
deny('9e. NEGATIVE: an inverted promotion window is rejected by the server', badPromo.status, 400, badPromo.body);

// ============================================================ 10. QR menu preview reads a REAL server-issued token
const qrInfo = await request(`/api/branches/${B1}/qr`, { headers: OWNER });
expect('10. the branch QR link is readable by an authorised user', qrInfo.status, 200, qrInfo.body);
deny('10b. NEGATIVE: a waiter cannot read the branch QR token', (await request(`/api/branches/${B1}/qr`, { headers: WAITER1.headers })).status, 403, null);
const regen = await request(`/api/branches/${B1}/qr/regenerate`, { method: 'POST', headers: OWNER, body: '{}' });
expect('10c. a QR token can be issued', regen.status, 201, regen.body);
const resolved = await request(`/api/public/qr/${regen.body.qr_token}`);
expect('10d. the token resolves to a branch SERVER-SIDE', resolved.status, 200, resolved.body);
dbCheck('10e. the resolved branch is the one the token belongs to', resolved.body?.branch?.id === B1, resolved.body?.branch);
deny('10f. NEGATIVE: a forged QR token resolves to nothing', (await request('/api/public/qr/forged-token-deadbeef')).status, 404, null);

// ============================================================ 11. MANDATORY NEGATIVE CONTROL
// Everything above asserts that a rule HOLDS. This block proves the test itself can still fail:
// it performs an operation that MUST be refused and treats success as the failure.
const forged = await request(`/api/menu/items/${dish2.body.item.id}`, { method: 'PATCH', headers: MGR1.headers, body: JSON.stringify({ media_asset_id: ASSET1, price: '0.01' }) });
counts.denials++;
if (forged.status === 200) {
  failures.push('NEGATIVE CONTROL FAILED: a branch-1 manager successfully rewrote a branch-2 dish -- branch isolation is NOT enforced');
} else {
  const b2Dish = await request(`/api/menu?branch_id=${B2}`, { headers: MGR2.headers });
  const row = (b2Dish.body?.items || []).find(i => i.id === dish2.body.item.id);
  dbCheck('11. NEGATIVE CONTROL: the refused cross-branch write left price AND media untouched', row && cents(row.price) === 1000 && !row.media_asset_id, row);
}

// And the inverse control: the SAME request from the branch that owns the dish must succeed,
// proving the refusal above was about authorisation and not about a broken route.
const legit = await request(`/api/menu/items/${dish2.body.item.id}`, { method: 'PATCH', headers: MGR2.headers, body: JSON.stringify({ media_asset_id: ASSET2, price: '12.00' }) });
expect('11b. INVERSE CONTROL: the owning branch CAN perform the same write', legit.status, 200, legit.body);
dbCheck('11c. the legitimate write applied both fields', legit.body?.item?.media_asset_id === ASSET2 && cents(legit.body?.item?.price) === 1200, legit.body?.item);

console.log(`\nStage 36 Admin Control Center E2E: ${counts.runtime} HTTP calls, ${counts.denials} authorization denials, ${counts.dbPost} post-conditions`);
if (failures.length) { console.error(`\nFAILURES (${failures.length}):`); for (const f of failures) console.error(' - ' + f); process.exit(1); }
console.log('ALL STAGE 36 ADMIN CONTROL CENTER CHECKS PASSED');
