// BOOM OS -- Stage 39: ADMIN site design / Customer Menu visual editor.
//
// Runtime proof that CONTENT and DESIGN are genuinely separate:
//   Menu Builder owns WHAT WE SELL. Visual Catalog owns HOW WE SHOW IT. Branding owns the brand.
//   The Customer Menu reads the live Menu Engine, and a visual section can never hold a second
//   copy of a dish's name, price or photo.
//
// Sections map to the Stage 39 matrix: A menu content, B visual catalog, C design, D source of
// truth, E branch security, F RBAC, G audit, H public safety.
//
// Requires an empty database. Usage: node tests/stage39_site_design_e2e.mjs
const base = `http://127.0.0.1:${process.env.BOOM_OS_PORT || 3000}`;
const ownerPassword = process.env.STAGE39_OWNER_PASSWORD || 'BoomStage39Owner!';
const staffPassword = 'Stage39StaffPass12345!';
const stamp = Date.now();

const counts = { runtime: 0, denials: 0, dbPost: 0 };
const failures = [];
async function request(path, options = {}) {
  counts.runtime++;
  const c = new AbortController(); const timer = setTimeout(() => c.abort(), 25000);
  try {
    const res = await fetch(base + path, { ...options, signal: c.signal, headers: { 'content-type': 'application/json', ...(options.headers || {}) } });
    let body = null; try { body = await res.json(); } catch {}
    return { status: res.status, body };
  } catch (e) { throw new Error(`${path} did not answer (${e.message})`); }
  finally { clearTimeout(timer); }
}
function expect(step, got, want, body) { if (got !== want) failures.push(`${step}: expected ${want}, got ${got} -> ${String(JSON.stringify(body ?? null)).slice(0, 300)}`); }
function deny(step, got, want, body) { counts.denials++; expect(step, got, want, body); }
function dbCheck(label, cond, detail) { counts.dbPost++; if (!cond) failures.push(`DB POST-CONDITION -- ${label}: FAILED -> ${String(JSON.stringify(detail ?? null)).slice(0, 320)}`); }
const cents = v => Math.round(parseFloat(v ?? 0) * 100);

// ============================================================ fixture
const owner = await request('/api/auth/bootstrap', { method: 'POST', body: JSON.stringify({ full_name: 'S39 Owner', email: `s39owner-${stamp}@boom.local`, password: ownerPassword }) });
expect('bootstrap owner', owner.status, 201, owner.body);
const OWNER = { authorization: `Bearer ${owner.body.token}` };
const fr = await request('/api/franchises', { method: 'POST', headers: OWNER, body: JSON.stringify({ name: 'S39 F', code: `S39F${stamp % 100000}`, legal_name: 'S39 LLC', contact_name: 'x', phone: '+99339140', email: `s39f-${stamp}@boom.local`, address: 'x' }) });
const FR = fr.body.franchise.id;
async function makeBranch(label, n) {
  const r = await request('/api/branches', { method: 'POST', headers: OWNER, body: JSON.stringify({ name: label, code: `S39B${n}${stamp % 100000}`, address: 'x', phone: `+9933914${n}`, franchise_id: FR }) });
  expect(`branch ${label}`, r.status, 201, r.body);
  await request(`/api/franchises/${FR}/branches/${r.body.branch.id}`, { method: 'POST', headers: OWNER, body: '{}' });
  return r.body.branch.id;
}
const B1 = await makeBranch('S39 B1', 1);
const B2 = await makeBranch('S39 B2', 2);
async function makeUser(label, branch, roles) {
  const email = `${label}-${stamp}@boom.local`.toLowerCase();
  const u = await request('/api/users', { method: 'POST', headers: OWNER, body: JSON.stringify({ full_name: `${label} Name`, email, phone: `+9946${Math.floor(Math.random() * 1000000)}`, password: staffPassword, branch_id: branch, roles, allowed_branches: [branch] }) });
  expect(`create user ${label}`, u.status, 201, u.body);
  const login = await request('/api/auth/login', { method: 'POST', body: JSON.stringify({ login: email, password: staffPassword }) });
  return { id: u.body.user.id, headers: { authorization: `Bearer ${login.body.token}` } };
}
const MGR = await makeUser('s39mgr', B1, ['BRANCH_MANAGER']);
const MGR2 = await makeUser('s39mgr2', B2, ['BRANCH_MANAGER']);
const WAITER = await makeUser('s39wait', B1, ['WAITER']);

const cat = (await request('/api/menu/categories', { method: 'POST', headers: MGR.headers, body: JSON.stringify({ branch_id: B1, name_ru: 'Бургеры', name_tk: 'Burgerler', name_en: 'Burgers' }) })).body.category;
const cat2 = (await request('/api/menu/categories', { method: 'POST', headers: MGR.headers, body: JSON.stringify({ branch_id: B1, name_ru: 'Напитки', name_tk: 'Içgiler' }) })).body.category;
const mkDish = async (sku, ru, price, category) => (await request('/api/menu/items', { method: 'POST', headers: MGR.headers, body: JSON.stringify({ branch_id: B1, category_id: category, sku: `${sku}-${stamp}`, name_ru: ru, name_tk: ru, price }) })).body.item;
const burger = await mkDish('S39-BURGER', 'BOOM Бургер', '95.00', cat.id);
const cola = await mkDish('S39-COLA', 'Кола', '15.00', cat2.id);

const asset = (await request('/api/media-assets', { method: 'POST', headers: OWNER, body: JSON.stringify({ branch_id: B1, name: 'Hero', kind: 'IMAGE', mime_type: 'image/webp', url: '/uploads/menu-media/s39-hero.webp', alt_ru: 'Герой', alt_tk: 'Gahryman' }) })).body.asset;
const dishPhoto = (await request('/api/media-assets', { method: 'POST', headers: OWNER, body: JSON.stringify({ branch_id: B1, name: 'Burger photo', kind: 'IMAGE', mime_type: 'image/webp', url: '/uploads/menu-media/s39-burger.webp' }) })).body.asset;

const guest = (lang = 'ru') => request(`/api/visual-catalog/public?branch_id=${B1}&lang=${lang}`);
const guestItem = async (id, lang = 'ru') => ((await guest(lang)).body.items || []).find(i => i.id === id);

// ============================================================ A. MENU CONTENT drives the Customer Menu
{
  expect('A1. the dish name is changed in the Menu Builder', (await request(`/api/menu/items/${burger.id}`, { method: 'PATCH', headers: MGR.headers, body: JSON.stringify({ name_ru: 'BOOM Бургер XL', name_en: 'BOOM Burger XL' }) })).status, 200);
  dbCheck('A2. the Customer Menu shows the NEW name, with no visual block touched', (await guestItem(burger.id))?.name === 'BOOM Бургер XL', (await guestItem(burger.id))?.name);
  expect('A3. the description is changed', (await request(`/api/menu/items/${burger.id}`, { method: 'PATCH', headers: MGR.headers, body: JSON.stringify({ description_ru: 'Новое описание' }) })).status, 200);
  dbCheck('A4. the Customer Menu shows the NEW description', (await guestItem(burger.id))?.description === 'Новое описание', 'desc');
  expect('A5. the price is changed', (await request(`/api/menu/items/${burger.id}`, { method: 'PATCH', headers: MGR.headers, body: JSON.stringify({ price: '119.00' }) })).status, 200);
  dbCheck('A6. the Customer Menu shows the NEW price', cents((await guestItem(burger.id))?.price) === 11900, (await guestItem(burger.id))?.price);
  expect('A7. the photo is changed', (await request(`/api/menu/items/${burger.id}`, { method: 'PATCH', headers: MGR.headers, body: JSON.stringify({ media_asset_id: dishPhoto.id }) })).status, 200);
  dbCheck('A8. the Customer Menu shows the NEW photo', (await guestItem(burger.id))?.media_url === '/uploads/menu-media/s39-burger.webp', 'photo');
  expect('A9. the dish is moved to another category', (await request(`/api/menu/items/${burger.id}`, { method: 'PATCH', headers: MGR.headers, body: JSON.stringify({ category_id: cat2.id }) })).status, 200);
  dbCheck('A10. the Customer Menu reflects the new category', (await guestItem(burger.id))?.category_id === cat2.id, 'category');
  await request(`/api/menu/items/${burger.id}`, { method: 'PATCH', headers: MGR.headers, body: JSON.stringify({ category_id: cat.id }) });

  const grpRes = await request(`/api/menu/items/${burger.id}/modifier-groups`, { method: 'POST', headers: MGR.headers, body: JSON.stringify({ branch_id: B1, name_ru: 'Булка', name_tk: 'Çörek', min_select: 1, max_select: 1, required: true }) });
  expect('A11. a constructor group is added', grpRes.status, 201, grpRes.body);
  await request(`/api/menu/modifier-groups/${grpRes.body.group.id}/modifiers`, { method: 'POST', headers: MGR.headers, body: JSON.stringify({ name_ru: 'Бриошь', name_tk: 'Brioş', price_delta: '8.00' }) });
  dbCheck('A12. a constructor change reaches the Customer Menu without touching any visual block', ((await guestItem(burger.id))?.modifier_groups || []).length === 1, 'modifiers');

  expect('A13. the dish is archived', (await request(`/api/menu/items/${burger.id}`, { method: 'DELETE', headers: MGR.headers })).status, 200);
  dbCheck('A14. an archived dish leaves the Customer Menu', !(await guestItem(burger.id)), 'archived');
  expect('A15. the dish is restored', (await request(`/api/menu/items/${burger.id}`, { method: 'PATCH', headers: MGR.headers, body: JSON.stringify({ status: 'ACTIVE' }) })).status, 200);
  dbCheck('A16. a restored dish returns to the Customer Menu', Boolean(await guestItem(burger.id)), 'restored');

}

// ============================================================ D. THE SOURCE-OF-TRUTH RULE
let refBlock;
{
  const duplicated = await request('/api/visual-catalog', { method: 'POST', headers: MGR.headers, body: JSON.stringify({ branch_id: B1, type: 'MENU_ITEM', menu_item_id: burger.id, title_ru: 'Classic Burger 90' }) });
  deny('D1. NEGATIVE: a MENU_ITEM section carrying its own title is REFUSED', duplicated.status, 400, duplicated.body);
  dbCheck('D2. the refusal names the rule it enforces', duplicated.body?.code === 'BLOCK_DUPLICATES_MENU_DATA', duplicated.body);
  deny('D3. NEGATIVE: nor may it carry its own photo', (await request('/api/visual-catalog', { method: 'POST', headers: MGR.headers, body: JSON.stringify({ branch_id: B1, type: 'MENU_ITEM', menu_item_id: burger.id, media_asset_id: asset.id }) })).status, 400, null);
  deny('D4. NEGATIVE: a CATEGORY section may not carry its own title either', (await request('/api/visual-catalog', { method: 'POST', headers: MGR.headers, body: JSON.stringify({ branch_id: B1, type: 'CATEGORY', category_id: cat.id, title_ru: 'Наши бургеры' }) })).status, 400, null);
  deny('D5. NEGATIVE: a MENU_ITEM section must actually reference a dish', (await request('/api/visual-catalog', { method: 'POST', headers: MGR.headers, body: JSON.stringify({ branch_id: B1, type: 'MENU_ITEM' }) })).status, 400, null);

  const clean = await request('/api/visual-catalog', { method: 'POST', headers: MGR.headers, body: JSON.stringify({ branch_id: B1, type: 'MENU_ITEM', menu_item_id: burger.id, card_style: 'PREMIUM', image_ratio: 'SQUARE', sort_order: 5 }) });
  expect('D6. a reference section with ONLY a reference and presets is accepted', clean.status, 201, clean.body);
  refBlock = clean.body.block;
  dbCheck('D7. it stores no title and no media of its own', !refBlock.title_ru && !refBlock.title_en && !refBlock.media_url && !refBlock.media_asset_id, refBlock);
  dbCheck('D8. the visual_catalog table has NO price column at all', !Object.keys(refBlock).some(k => /price|amount|cost/i.test(k)), Object.keys(refBlock).filter(k => /price|cost/i.test(k)));

  const g = await guest();
  const gb = (g.body.blocks || []).find(b => b.id === refBlock.id);
  dbCheck('D9. the public payload serves the reference section with NO content of its own', gb && gb.title === null && gb.media_url === null && gb.menu_item_id === burger.id, gb);
  dbCheck('D10. the guest gets the price from the Menu Engine item row, which is the only place it exists', cents((g.body.items || []).find(i => i.id === burger.id)?.price) === 11900, 'price');

  expect('D11. the price is changed again in the Menu Builder', (await request(`/api/menu/items/${burger.id}`, { method: 'PATCH', headers: MGR.headers, body: JSON.stringify({ price: '125.00' }) })).status, 200);
  const after = await guest();
  dbCheck('D12. the Customer Menu follows immediately -- no visual block was edited', cents((after.body.items || []).find(i => i.id === burger.id)?.price) === 12500, 'price2');
  const blockAfter = await request(`/api/visual-catalog?branch_id=${B1}`, { headers: MGR.headers });
  dbCheck('D13. and the visual section still holds no copy of it', !JSON.stringify((blockAfter.body.blocks || []).find(b => b.id === refBlock.id)).includes('125'), 'no duplicate');

  deny('D14. NEGATIVE: a section cannot be CONVERTED to MENU_ITEM while keeping a duplicated title', (await request(`/api/visual-catalog/${refBlock.id}`, { method: 'PATCH', headers: MGR.headers, body: JSON.stringify({ type: 'MENU_ITEM', title_ru: 'sneaky' }) })).status, 400, null);
}

// ============================================================ B. VISUAL CATALOG sections
let hero, banner, textBlock, mediaBlock, catBlock;
{
  const mk = (body) => request('/api/visual-catalog', { method: 'POST', headers: MGR.headers, body: JSON.stringify({ branch_id: B1, ...body }) });
  hero = (await mk({ type: 'HERO', title_ru: 'BOOM неделя', title_tk: 'BOOM hepde', title_en: 'BOOM week', subtitle_ru: 'Подзаголовок', media_asset_id: asset.id, overlay: 'STRONG', alignment: 'CENTER', cta_label_ru: 'Смотреть', sort_order: 0 })).body.block;
  banner = (await mk({ type: 'BANNER', title_ru: 'Баннер', title_tk: 'Baner', sort_order: 1 })).body.block;
  textBlock = (await mk({ type: 'TEXT', title_ru: 'О нас', title_tk: 'Biz barada', subtitle_ru: 'Текстовая секция', alignment: 'CENTER', sort_order: 2 })).body.block;
  mediaBlock = (await mk({ type: 'MEDIA', media_asset_id: asset.id, image_ratio: 'WIDE', sort_order: 3 })).body.block;
  catBlock = (await mk({ type: 'CATEGORY', category_id: cat.id, card_style: 'COMPACT', sort_order: 4 })).body.block;
  dbCheck('B1. every supported section type can be created', [hero, banner, textBlock, mediaBlock, catBlock].every(Boolean), 'created');
  dbCheck('B2. a HERO keeps its own words and media -- it is website design, not menu data', hero.title_ru === 'BOOM неделя' && hero.media_asset_id === asset.id && hero.overlay === 'STRONG', hero);
  dbCheck('B3. a TEXT section carries RU/TK/EN content', textBlock.title_ru === 'О нас' && textBlock.title_tk === 'Biz barada', textBlock);

  const order = [catBlock.id, hero.id, refBlock.id, textBlock.id, mediaBlock.id, banner.id];
  const re = await request('/api/visual-catalog/reorder', { method: 'POST', headers: MGR.headers, body: JSON.stringify({ branch_id: B1, block_ids: order }) });
  expect('B4. sections are reordered through the server', re.status, 200, re.body);
  const g = await guest();
  const served = (g.body.blocks || []).map(b => b.id);
  dbCheck('B5. THE CUSTOMER MENU RENDERS THE PERSISTED ORDER, not a browser-side one', JSON.stringify(served) === JSON.stringify(order), { served, order });

  const reversed = [...order].reverse();
  await request('/api/visual-catalog/reorder', { method: 'POST', headers: MGR.headers, body: JSON.stringify({ branch_id: B1, block_ids: reversed }) });
  dbCheck('B6. reordering again changes the guest layout again', JSON.stringify(((await guest()).body.blocks || []).map(b => b.id)) === JSON.stringify(reversed), 'reorder2');
  await request('/api/visual-catalog/reorder', { method: 'POST', headers: MGR.headers, body: JSON.stringify({ branch_id: B1, block_ids: order }) });

  expect('B7. a section is deactivated', (await request(`/api/visual-catalog/${banner.id}`, { method: 'DELETE', headers: MGR.headers })).status, 200);
  dbCheck('B8. a deactivated section leaves the Customer Menu', !((await guest()).body.blocks || []).some(b => b.id === banner.id), 'off');
  const adminList = await request(`/api/visual-catalog?branch_id=${B1}`, { headers: MGR.headers });
  dbCheck('B9. but remains recoverable in ADMIN, never hard-deleted', (adminList.body.blocks || []).some(b => b.id === banner.id && !b.active), 'recoverable');
  expect('B10. it is reactivated', (await request(`/api/visual-catalog/${banner.id}`, { method: 'PATCH', headers: MGR.headers, body: JSON.stringify({ active: true }) })).status, 200);
  dbCheck('B11. and returns to the Customer Menu', ((await guest()).body.blocks || []).some(b => b.id === banner.id), 'on');

  expect('B12. the hero content is edited', (await request(`/api/visual-catalog/${hero.id}`, { method: 'PATCH', headers: MGR.headers, body: JSON.stringify({ title_ru: 'BOOM неделя 2', overlay: 'SOFT' }) })).status, 200);
  dbCheck('B13. the Customer Menu shows the edited hero', ((await guest()).body.blocks || []).find(b => b.id === hero.id)?.title === 'BOOM неделя 2', 'hero');
  dbCheck('B14. EN content is served when the guest asks for EN', ((await guest('en')).body.blocks || []).find(b => b.id === hero.id)?.title === 'BOOM week', 'hero en');

  expect('B15. archiving a referenced dish is allowed', (await request(`/api/menu/items/${burger.id}`, { method: 'DELETE', headers: MGR.headers })).status, 200);
  const g2 = await guest();
  dbCheck('B16. a section referencing an archived dish DROPS OUT rather than rendering broken', !(g2.body.blocks || []).some(b => b.id === refBlock.id), 'dropped');
  await request(`/api/menu/items/${burger.id}`, { method: 'PATCH', headers: MGR.headers, body: JSON.stringify({ status: 'ACTIVE' }) });
  dbCheck('B17. restoring the dish brings the section back', ((await guest()).body.blocks || []).some(b => b.id === refBlock.id), 'back');
}

// ============================================================ C. DESIGN presets
{
  const d0 = await request(`/api/visual-catalog/design?branch_id=${B1}`, { headers: MGR.headers });
  expect('C1. the design is readable and offers its allowed presets', d0.status, 200, d0.body);
  dbCheck('C2. a branch with no saved design gets safe defaults', d0.body?.design?.theme === 'MIDNIGHT' && Array.isArray(d0.body?.presets?.theme), d0.body?.design);

  const saved = await request('/api/visual-catalog/design', { method: 'PUT', headers: MGR.headers, body: JSON.stringify({ branch_id: B1, theme: 'GRAPHITE', accent: 'COPPER', typography: 'DISPLAY', card_style: 'IMAGE_FIRST', density: 'SPACIOUS', radius: 'SHARP', image_ratio: 'WIDE' }) });
  expect('C3. a valid design is saved', saved.status, 200, saved.body);
  dbCheck('C4. every preset persisted', saved.body?.design?.theme === 'GRAPHITE' && saved.body?.design?.accent === 'COPPER' && saved.body?.design?.radius === 'SHARP', saved.body?.design);
  dbCheck('C5. THE CUSTOMER MENU IS SERVED THE DESIGN, so its appearance follows', (await guest()).body?.design?.theme === 'GRAPHITE', (await guest()).body?.design);

  deny('C6. NEGATIVE: an unknown theme is refused', (await request('/api/visual-catalog/design', { method: 'PUT', headers: MGR.headers, body: JSON.stringify({ branch_id: B1, theme: 'NEON' }) })).status, 400, null);
  const injection = await request('/api/visual-catalog/design', { method: 'PUT', headers: MGR.headers, body: JSON.stringify({ branch_id: B1, theme: '<script>alert(1)</script>' }) });
  deny('C7. NEGATIVE: NO CSS/HTML INJECTION -- a markup payload is refused, not stored', injection.status, 400, injection.body);
  dbCheck('C8. and the stored design is untouched by the attempt', (await request(`/api/visual-catalog/design?branch_id=${B1}`, { headers: MGR.headers })).body?.design?.theme === 'GRAPHITE', 'intact');
  deny('C9. NEGATIVE: an unknown section preset is refused too', (await request(`/api/visual-catalog/${hero.id}`, { method: 'PATCH', headers: MGR.headers, body: JSON.stringify({ card_style: 'background:url(x)' }) })).status, 400, null);
  dbCheck('C10. no design field can hold free text: every stored value is one of the allowed identifiers', Object.entries((await request(`/api/visual-catalog/design?branch_id=${B1}`, { headers: MGR.headers })).body.presets).every(([k, opts]) => opts.includes((saved.body.design)[k])), 'enums');

  // Branding stays the separate, existing system.
  expect('C11. branding is still its own source of truth', (await request('/api/settings/BRANDING_NETWORK_NAME', { method: 'PUT', headers: OWNER, body: JSON.stringify({ value: `S39 Network ${stamp}` }) })).status, 200);
  dbCheck('C12. and reaches the guest through the branding route, not the design one', (await request('/api/public/branding')).body?.branding?.network_name === `S39 Network ${stamp}`, 'branding');
}

// ============================================================ E. branch security
{
  const b2Block = await request('/api/visual-catalog', { method: 'POST', headers: MGR2.headers, body: JSON.stringify({ branch_id: B2, type: 'BANNER', title_ru: 'B2 баннер', title_tk: 'B2' }) });
  expect('E0. branch 2 has its own section', b2Block.status, 201, b2Block.body);
  deny('E1. NEGATIVE: a branch-1 manager cannot create a section in branch 2', (await request('/api/visual-catalog', { method: 'POST', headers: MGR.headers, body: JSON.stringify({ branch_id: B2, type: 'BANNER', title_ru: 'x', title_tk: 'x' }) })).status, 400, null);
  deny('E2. NEGATIVE: nor edit a branch-2 section', (await request(`/api/visual-catalog/${b2Block.body.block.id}`, { method: 'PATCH', headers: MGR.headers, body: JSON.stringify({ title_ru: 'hijacked' }) })).status, 404, null);
  deny('E3. NEGATIVE: nor reorder branch 2', (await request('/api/visual-catalog/reorder', { method: 'POST', headers: MGR.headers, body: JSON.stringify({ branch_id: B2, block_ids: [b2Block.body.block.id] }) })).status, 403, null);
  deny('E4. NEGATIVE: nor change branch 2\'s design', (await request('/api/visual-catalog/design', { method: 'PUT', headers: MGR.headers, body: JSON.stringify({ branch_id: B2, theme: 'CHARCOAL' }) })).status, 403, null);
  deny('E5. NEGATIVE: nor even read branch 2\'s configuration', (await request(`/api/visual-catalog?branch_id=${B2}`, { headers: MGR.headers })).status, 403, null);

  const b2After = await request(`/api/visual-catalog?branch_id=${B2}`, { headers: MGR2.headers });
  dbCheck('E6. after every attempt, branch 2 is untouched', (b2After.body.blocks || []).find(b => b.id === b2Block.body.block.id)?.title_ru === 'B2 баннер', 'intact');
  dbCheck('E7. branch 2 keeps its own default design', (await request(`/api/visual-catalog/design?branch_id=${B2}`, { headers: MGR2.headers })).body?.design?.theme === 'MIDNIGHT', 'b2 design');
  const b2Guest = await request(`/api/visual-catalog/public?branch_id=${B2}&lang=ru`);
  dbCheck('E8. branch 1 media and sections never leak into branch 2\'s Customer Menu', !(b2Guest.body.blocks || []).some(b => [hero.id, refBlock.id, mediaBlock.id].includes(b.id)) && !JSON.stringify(b2Guest.body).includes('s39-hero.webp'), 'no leak');
}

// ============================================================ F. RBAC
{
  deny('F1. NEGATIVE: a waiter cannot create a section', (await request('/api/visual-catalog', { method: 'POST', headers: WAITER.headers, body: JSON.stringify({ branch_id: B1, type: 'BANNER', title_ru: 'x', title_tk: 'x' }) })).status, 403, null);
  deny('F2. NEGATIVE: a waiter cannot reorder sections', (await request('/api/visual-catalog/reorder', { method: 'POST', headers: WAITER.headers, body: JSON.stringify({ branch_id: B1, block_ids: [hero.id] }) })).status, 403, null);
  deny('F3. NEGATIVE: a waiter cannot change the design', (await request('/api/visual-catalog/design', { method: 'PUT', headers: WAITER.headers, body: JSON.stringify({ branch_id: B1, theme: 'CHARCOAL' }) })).status, 403, null);
  deny('F4. NEGATIVE: a waiter cannot even read the configuration', (await request(`/api/visual-catalog?branch_id=${B1}`, { headers: WAITER.headers })).status, 403, null);
  dbCheck('F5. the design survived every unauthorized attempt', (await request(`/api/visual-catalog/design?branch_id=${B1}`, { headers: MGR.headers })).body?.design?.theme === 'GRAPHITE', 'intact');
  expect('F6. the authorized manager still succeeds', (await request('/api/visual-catalog/design', { method: 'PUT', headers: MGR.headers, body: JSON.stringify({ branch_id: B1, theme: 'CHARCOAL' }) })).status, 200);
}

// ============================================================ G. audit
{
  const audit = await request('/api/audit?limit=300', { headers: OWNER });
  const actions = new Set((audit.body?.logs || audit.body?.entries || []).map(l => l.action));
  for (const a of ['VISUAL_CATALOG_BLOCK_CREATED', 'VISUAL_CATALOG_BLOCK_UPDATED', 'VISUAL_CATALOG_BLOCK_DEACTIVATED', 'VISUAL_CATALOG_REORDERED', 'SITE_DESIGN_UPDATED']) {
    dbCheck(`G. AUDIT: ${a} recorded in the EXISTING audit log`, actions.has(a), [...actions].slice(0, 25));
  }
  const designAudit = (audit.body?.logs || audit.body?.entries || []).find(l => l.action === 'SITE_DESIGN_UPDATED');
  dbCheck('G6. the design audit carries the actor and the branch', Boolean(designAudit?.user_id || designAudit?.userId) && String(designAudit?.branch_id || designAudit?.branchId) === B1, designAudit);
}

// ============================================================ H. public safety
{
  const g = await guest();
  const body = JSON.stringify(g.body);
  dbCheck('H1. the Customer Menu payload exposes NO recipe, cost, margin, stock or supplier data', !/recipe|food_cost|theoretical_cost|average_cost|unit_cost|margin|current_stock|supplier|employee/i.test(body), body.slice(0, 160));
  dbCheck('H2. nor any section field that could carry markup', !/<script|<style|onerror=|javascript:/i.test(body), 'no markup');
  dbCheck('H3. the design served to the guest is preset identifiers only', Object.values(g.body.design || {}).every(v => typeof v === 'boolean' || /^[A-Z_]+$/.test(String(v)) || String(v).startsWith('br_')), g.body.design);
}

// ============================================================ MANDATORY NEGATIVE CONTROL
{
  const forged = await request(`/api/visual-catalog/${hero.id}`, { method: 'PATCH', headers: MGR2.headers, body: JSON.stringify({ title_ru: 'hijacked by branch 2' }) });
  counts.denials++;
  if (forged.status === 200) failures.push('NEGATIVE CONTROL FAILED: a branch-2 manager rewrote a branch-1 section -- branch isolation is NOT enforced on the Stage 39 routes');
  const legit = await request(`/api/visual-catalog/${hero.id}`, { method: 'PATCH', headers: MGR.headers, body: JSON.stringify({ title_ru: 'BOOM неделя 3' }) });
  expect('X1. INVERSE CONTROL: the owning branch CAN perform the same write', legit.status, 200, legit.body);
  dbCheck('X2. the legitimate write applied', legit.body?.block?.title_ru === 'BOOM неделя 3', legit.body?.block);
}

console.log(`\nStage 39 Site Design E2E: ${counts.runtime} HTTP calls, ${counts.denials} authorization/validation denials, ${counts.dbPost} post-conditions`);
if (failures.length) { console.error(`\nFAILURES (${failures.length}):`); for (const f of failures) console.error(' - ' + f); process.exit(1); }
console.log('ALL STAGE 39 SITE DESIGN CHECKS PASSED');
