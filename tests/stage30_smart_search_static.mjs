// BOOM OS -- Stage 30: static regression guards for the Smart Search recommendation engine
// (extends the existing public-menu.ts smart-search, does not create a second search system).
import fs from 'node:fs';
import assert from 'node:assert/strict';

const publicMenu = fs.readFileSync(new URL('../server/routes/public-menu.ts', import.meta.url), 'utf8');
const apiTs = fs.readFileSync(new URL('../src/api.ts', import.meta.url), 'utf8');
const customerView = fs.readFileSync(new URL('../src/components/CustomerMenuView.tsx', import.meta.url), 'utf8');
const waiterView = fs.readFileSync(new URL('../src/components/WaiterPOSView.tsx', import.meta.url), 'utf8');

let passed = 0;
function check(label, cond) { assert.ok(cond, `FAILED: ${label}`); passed++; }

// --- one engine, extended in place -- not a second search system
check('only one smart-search route exists', (publicMenu.match(/router\.get\('\/smart-search'/g) || []).length === 1);
check('recommendation engine reuses the existing scoreItem ranking (not a separate scorer)', /byBucket\[k\]\.sort\(\(a, b\) => b\.ranking\.score - a\.ranking\.score\)/.test(publicMenu));
check('recommendations are built from the same scored/candidate pool as the ranked item list', /buildRecommendations\(parsed\.people, parsed\.maxBudget, allScored, lang\)/.test(publicMenu));

// --- no float money, no second pricing system
check('recommendation totals use BigInt cents, not floating point', /function moneyCents\(v: unknown\): bigint/.test(publicMenu) && /mainUnit \* BigInt\(people\)/.test(publicMenu));
check('no parseFloat/Number() arithmetic building recommendation totals', !/const total = Number\(/.test(publicMenu));

// --- availability reuses the existing definition (ACTIVE, not deleted, branch-scoped) -- no
// second availability system, no invented stock model
check('candidate query reuses the existing ACTIVE/not-deleted/branch availability WHERE clause', /status='ACTIVE' AND mi\.deleted_at IS NULL AND mc\.status='ACTIVE' AND mc\.deleted_at IS NULL/.test(publicMenu));
check('no separate inventory/stock-based availability check was invented for search', !/current_stock/.test(publicMenu));

// --- budget is a hard constraint, enforced server-side, never invented
check('every combination variant is rejected before being returned if it exceeds budget', /if \(budgetCents !== null && total > budgetCents\) continue;/.test(publicMenu));
check('empty state is a real empty array, not a fabricated combination', /if \(!byBucket\.main\.length\) return \[\];/.test(publicMenu));

// --- exclusions are resolved against real item text only, never invented ingredients
check('RU "без X" exclusion parsing exists', /без\\s\+/.test(publicMenu.replace(/\\\\/g, '\\')) || /без\s\+/.test(publicMenu));
check('TK "-syz/-siz" negation suffix exclusion parsing exists', /syz\|siz/.test(publicMenu) || /(?:syz|siz)/.test(publicMenu));
check('exclusion filter checks only real name/description/smart_tags text', /function excludedText\(item: any\): string \{/.test(publicMenu));
check('excluded items are filtered out of candidates before scoring (never merely down-ranked)', /const candidates = rows\.filter\(\(item: any\) => !isExcluded\(item, parsed\.exclusions\)\);/.test(publicMenu));

// --- API surface: extended, not duplicated
check('api.ts smartSearch method returns recommendations (extended response shape)', /smartSearch:[\s\S]{0,400}recommendations:/.test(apiTs));
check('no second smart-search endpoint added to api.ts', (apiTs.match(/\/smart-search/g) || []).length === 1);

// --- reused in Customer Menu and Waiter POS, not duplicated into Cashier POS
check('CustomerMenuView renders recommendations from the real API response', /recommendations\.map/.test(customerView));
check('WaiterPOSView reuses the same api.smartSearch call (one backend, multiple consumers)', /api\.smartSearch\(waiter\.branch_id,\s*smartQuery/.test(waiterView));
check('WaiterPOSView adds a combination via the real loaded menu item (addLine), not by trusting search response prices for cart construction', /const real=items\.find\(i=>i\.id===line\.id\); if\(!real\)continue; for\(let i=0;i<line\.quantity;i\+\+\) addLine\(real\)/.test(waiterView));
const cashierView = fs.readFileSync(new URL('../src/components/CashierPOSView.tsx', import.meta.url), 'utf8');
check('Cashier POS does not get its own search engine (no smartSearch call there)', !/smartSearch/.test(cashierView));

console.log(`STAGE 30 SMART SEARCH STATIC: PASS (${passed}/${passed} checks)`);
