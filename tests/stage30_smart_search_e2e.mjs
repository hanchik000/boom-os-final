// BOOM OS -- Stage 30: fresh-DB E2E proof of Smart Search (RU/TK intent parsing + real-menu
// combination recommendation engine, extending the existing /api/public/smart-search).
// Requires an empty database. Usage: node tests/stage30_smart_search_e2e.mjs
import assert from 'node:assert/strict';

const base = `http://127.0.0.1:${process.env.BOOM_OS_PORT || 3000}`;
const stamp = Date.now();
let counts = { runtime: 0, dbPost: 0 };
const failures = [];

async function request(path, options = {}) {
  counts.runtime++;
  const res = await fetch(base + path, { ...options, headers: { 'content-type': 'application/json', ...(options.headers || {}) } });
  let body = null; try { body = await res.json(); } catch {}
  return { status: res.status, body };
}
function expect(step, got, want, body) { if (got !== want) failures.push(`${step}: expected ${JSON.stringify(want)}, got ${JSON.stringify(got)} -> ${JSON.stringify(body).slice(0, 300)}`); }
function ok(step, cond, detail) { if (!cond) failures.push(`${step}: FAILED ${detail !== undefined ? '-> ' + JSON.stringify(detail).slice(0,400) : ''}`); }
function dbCheck(label, cond, detail) { counts.dbPost++; ok(`DB POST-CONDITION -- ${label}`, cond, detail); }
function moneyEq(a, b) { return Math.abs(parseFloat(a) - parseFloat(b)) < 0.005; }

async function search(branchId, q, lang = 'ru') {
  return request(`/api/public/smart-search?branch_id=${encodeURIComponent(branchId)}&q=${encodeURIComponent(q)}&lang=${lang}`);
}

// ---------------------------------------------------------------- bootstrap + topology
const owner = await request('/api/auth/bootstrap', { method: 'POST', body: JSON.stringify({ full_name: 'S30 Owner', email: `s30owner-${stamp}@boom.local`, password: 'S30OwnerPass!123' }) });
expect('bootstrap owner', owner.status, 201, owner.body);
const OWNER = { authorization: `Bearer ${owner.body.token}` };

async function makeFranchise(tag) {
  const f = await request('/api/franchises', { method: 'POST', headers: OWNER, body: JSON.stringify({ name: `S30 F${tag}`, code: `S30${tag}${stamp % 100000}`, legal_name: `S30${tag} LLC`, contact_name: 'x', phone: `+9931799${tag}`, email: `s30${tag}-${stamp}@boom.local`, address: 'x' }) });
  expect(`create franchise ${tag}`, f.status, 201, f.body);
  return f.body.franchise.id;
}
async function makeBranch(tag, franchiseId) {
  const branch = await request('/api/branches', { method: 'POST', headers: OWNER, body: JSON.stringify({ name: `S30 B${tag}`, code: `S30${tag}${stamp % 100000}`, address: 'x', phone: `+9931809${tag}`, franchise_id: franchiseId }) });
  expect(`branch ${tag}`, branch.status, 201, branch.body);
  return branch.body.branch.id;
}

const FA = await makeFranchise('A');
const A1 = await makeBranch('A1', FA);
const A2 = await makeBranch('A2', FA);

const catBurger = (await request('/api/menu/categories', { method: 'POST', headers: OWNER, body: JSON.stringify({ branch_id: A1, name_ru: 'Бургеры', name_tk: 'Burgerler', sort_order: 0 }) })).body.category;
const catDrink = (await request('/api/menu/categories', { method: 'POST', headers: OWNER, body: JSON.stringify({ branch_id: A1, name_ru: 'Напитки', name_tk: 'Içgiler', sort_order: 1 }) })).body.category;
const catSide = (await request('/api/menu/categories', { method: 'POST', headers: OWNER, body: JSON.stringify({ branch_id: A1, name_ru: 'Гарниры', name_tk: 'Garnirler', sort_order: 2 }) })).body.category;

const classicBurger = (await request('/api/menu/items', { method: 'POST', headers: OWNER, body: JSON.stringify({ branch_id: A1, category_id: catBurger.id, sku: `CB-${stamp}`, name_ru: 'Классический бургер', name_tk: 'Klassiki burger', price: '25.00', sort_order: 0 }) })).body.item;
const spicyOnionBurger = (await request('/api/menu/items', { method: 'POST', headers: OWNER, body: JSON.stringify({ branch_id: A1, category_id: catBurger.id, sku: `SB-${stamp}`, name_ru: 'Острый бургер с луком', name_tk: 'Ajy burger sogan bilen', description_ru: 'острый соус и жареный лук', price: '30.00', sort_order: 1 }) })).body.item;
const cola = (await request('/api/menu/items', { method: 'POST', headers: OWNER, body: JSON.stringify({ branch_id: A1, category_id: catDrink.id, sku: `CO-${stamp}`, name_ru: 'Кока-кола', name_tk: 'Koka-kola', price: '8.00', sort_order: 0 }) })).body.item;
const fries = (await request('/api/menu/items', { method: 'POST', headers: OWNER, body: JSON.stringify({ branch_id: A1, category_id: catSide.id, sku: `FR-${stamp}`, name_ru: 'Картофель фри', name_tk: 'Fri kartoşka', price: '10.00', sort_order: 0 }) })).body.item;

// An item that will be archived (soft-deleted) and one that will be set INACTIVE, to prove
// both are excluded from search the same way order creation already excludes them.
const toArchive = (await request('/api/menu/items', { method: 'POST', headers: OWNER, body: JSON.stringify({ branch_id: A1, category_id: catBurger.id, sku: `AR-${stamp}`, name_ru: 'Устаревший бургер', name_tk: 'Köne burger', price: '15.00', sort_order: 2 }) })).body.item;
await request(`/api/menu/items/${toArchive.id}`, { method: 'DELETE', headers: OWNER });
const toDeactivate = (await request('/api/menu/items', { method: 'POST', headers: OWNER, body: JSON.stringify({ branch_id: A1, category_id: catBurger.id, sku: `IN-${stamp}`, name_ru: 'Скрытый бургер', name_tk: 'Gizlin burger', price: '15.00', sort_order: 3 }) })).body.item;
await request(`/api/menu/items/${toDeactivate.id}`, { method: 'PATCH', headers: OWNER, body: JSON.stringify({ status: 'INACTIVE' }) });

// Foreign-branch item, to prove branch isolation.
const catBurgerA2 = (await request('/api/menu/categories', { method: 'POST', headers: OWNER, body: JSON.stringify({ branch_id: A2, name_ru: 'Бургеры B', name_tk: 'Burgerler B', sort_order: 0 }) })).body.category;
const foreignBurger = (await request('/api/menu/items', { method: 'POST', headers: OWNER, body: JSON.stringify({ branch_id: A2, category_id: catBurgerA2.id, sku: `FB-${stamp}`, name_ru: 'Бургер филиала B', name_tk: 'B şahamçasynyň burgeri', price: '20.00', sort_order: 0 }) })).body.item;

console.log(`Setup: A1=${A1} A2=${A2}`);

// =============================================================== 1. "Нас 6 человек, бюджет 2000 манат"
const r1 = await search(A1, 'Нас 6 человек, бюджет 2000 манат');
expect('1. status 200', r1.status, 200, r1.body);
dbCheck('1. people parsed as 6', r1.body.parsed.people === 6, r1.body.parsed);
dbCheck('1. budget parsed as 2000', r1.body.parsed.max_budget === 2000, r1.body.parsed);
dbCheck('1. at least one recommendation produced', r1.body.recommendations.length >= 1, r1.body.recommendations);
dbCheck('1. recommendation total <= 2000 (budget never exceeded)', r1.body.recommendations.every(o => parseFloat(o.total) <= 2000), r1.body.recommendations);
dbCheck('1. recommendation total = subtotal of its own lines (server-computed, consistent)', r1.body.recommendations.every(o => moneyEq(o.total, o.items.reduce((s, l) => s + parseFloat(l.line_total), 0).toFixed(2))), r1.body.recommendations);

// =============================================================== 2/3. people/budget parsing variants
for (const [q, expectedPeople] of [['Нас 4 человека', 4], ['на 3 человек', 3], ['4 adam üçin nahar gerek', 4]]) {
  const r = await search(A1, q);
  dbCheck(`2. people parsed from "${q}"`, r.body.parsed.people === expectedPeople, r.body.parsed);
}
for (const [q, expectedBudget] of [['бюджет 1500 манат', 1500], ['до 800 манат', 800], ['1500 manat', 1500]]) {
  const r = await search(A1, q);
  dbCheck(`3. budget parsed from "${q}"`, r.body.parsed.max_budget === expectedBudget, r.body.parsed);
}

// =============================================================== 4/5/6. RU / TK / mixed
const r4 = await search(A1, 'Нужен ужин на 5 человек до 1500 манат', 'ru');
dbCheck('4. RU query parsed (people=5, budget=1500)', r4.body.parsed.people === 5 && r4.body.parsed.max_budget === 1500, r4.body.parsed);
const r5 = await search(A1, '6 adam, 2000 manat', 'tk');
dbCheck('5. TK query parsed (people=6, budget=2000)', r5.body.parsed.people === 6 && r5.body.parsed.max_budget === 2000, r5.body.parsed);
const r6 = await search(A1, 'Нас 4 adam, budget 1500 манат', 'ru');
dbCheck('6. mixed RU/TK query parsed (people=4, budget=1500)', r6.body.parsed.people === 4 && r6.body.parsed.max_budget === 1500, r6.body.parsed);

// =============================================================== 7. category / 8. preference
const r7 = await search(A1, 'Бургеры');
dbCheck('7. category (burger) preference detected', r7.body.parsed.preferences.burger === true, r7.body.parsed);
dbCheck('7. burger items present in results', r7.body.items.some(i => i.id === classicBurger.id), r7.body.items);
const r8 = await search(A1, 'хотим что-нибудь острое');
dbCheck('8. preference (spicy) detected', r8.body.parsed.preferences.spicy === true, r8.body.parsed);

// =============================================================== 9. exclusion
const r9 = await search(A1, 'Бургеры без лука до 1000 манат');
dbCheck('9. exclusion "onion" parsed', r9.body.parsed.exclusions.includes('onion'), r9.body.parsed);
dbCheck('9. item containing "лук" is excluded from results', !r9.body.items.some(i => i.id === spicyOnionBurger.id), r9.body.items);
dbCheck('9. non-excluded burger still present', r9.body.items.some(i => i.id === classicBurger.id), r9.body.items);

// =============================================================== 10/11. unavailable / archived excluded
const r10 = await search(A1, 'бургер');
dbCheck('10. INACTIVE item never appears', !r10.body.items.some(i => i.id === toDeactivate.id), r10.body.items);
dbCheck('11. archived (soft-deleted) item never appears', !r10.body.items.some(i => i.id === toArchive.id), r10.body.items);

// =============================================================== 12. real DB price
const liveMenu = await request(`/api/public/menu?branch_id=${A1}&lang=ru`);
const liveBurger = liveMenu.body.items.find(i => i.id === classicBurger.id);
const r12 = await search(A1, 'бургер');
const foundBurger = r12.body.items.find(i => i.id === classicBurger.id);
dbCheck('12. search result price matches the real DB price exactly', foundBurger && moneyEq(foundBurger.price, liveBurger.price), { search: foundBurger?.price, live: liveBurger.price });

// =============================================================== 13. budget never exceeded (stress a range)
const budgetProbe = await search(A1, 'Нас 8 человек, бюджет 300 манат');
dbCheck('13. tight budget: every recommendation still <= budget', budgetProbe.body.recommendations.every(o => parseFloat(o.total) <= 300), budgetProbe.body.recommendations);

// =============================================================== 14. empty result
const r14 = await search(A1, 'Нас 20 человек, бюджет 1 манат');
expect('14. empty-budget request still returns 200', r14.status, 200, r14.body);
dbCheck('14. no fabricated recommendation when nothing fits', r14.body.recommendations.length === 0, r14.body.recommendations);

// =============================================================== 15. branch isolation
const r15 = await search(A1, 'бургер');
dbCheck('15. foreign-branch (A2) item never appears in A1 results', !r15.body.items.some(i => i.id === foreignBurger.id), r15.body.items);
const r15b = await search('br_does_not_exist_xyz', 'бургер');
expect('15. nonexistent/foreign branch_id -> 404, not data leak', r15b.status, 404, r15b.body);

// =============================================================== 16. malformed/empty query
const r16a = await request(`/api/public/smart-search?branch_id=${A1}&q=&lang=ru`);
expect('16. empty q rejected deterministically', r16a.status, 400, r16a.body);
const r16b = await request(`/api/public/smart-search?q=бургер&lang=ru`);
expect('16. missing branch_id rejected deterministically', r16b.status, 400, r16b.body);
const r16c = await search(A1, '                     ');
expect('16. whitespace-only query rejected deterministically', r16c.status, 400, r16c.body);

// =============================================================== 17. recommendations use only real Menu Engine items
const r17 = await search(A1, 'Нас 6 человек, бюджет 2000 манат');
const allRecIds = r17.body.recommendations.flatMap(o => o.items.map(l => l.id));
const realIds = new Set([classicBurger.id, spicyOnionBurger.id, cola.id, fries.id]);
dbCheck('17. every recommended item id is a real, currently active menu item from this branch', allRecIds.every(id => realIds.has(id)), allRecIds);
for (const opt of r17.body.recommendations) {
  for (const line of opt.items) {
    const live = liveMenu.body.items.find(i => i.id === line.id);
    dbCheck(`17. recommendation line price for ${line.id} matches live DB price`, live && moneyEq(line.unit_price, live.price), { line: line.unit_price, live: live?.price });
  }
}

console.log('--- FINAL FAILURES CHECK ---');
console.log(`failures: ${failures.length}`);
for (const f of failures) console.log('FAIL: ' + f);
console.log('--- COUNTS ---');
console.log(JSON.stringify(counts));
console.log(failures.length === 0 ? 'STAGE 30 SMART SEARCH E2E: PASS' : 'STAGE 30 SMART SEARCH E2E: FAIL');
if (failures.length > 0) process.exit(1);
