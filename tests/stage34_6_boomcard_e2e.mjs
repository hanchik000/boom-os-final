// BOOM OS -- Stage 34.6: fresh-DB E2E proof of the BOOMCARD lifecycle and the guest's cabinet.
//
// Proves that the lifecycle is driven by a MANAGER (automation only ever proposes candidates),
// that manual management keeps working with automation switched off, that the threshold / validity /
// breakfast allowance are configuration rather than code, that history is never destroyed, and that
// the guest's cabinet shows a GENERIC birthday benefit -- never which product it is.
//
// Requires an empty database. Usage: node tests/stage34_6_boomcard_e2e.mjs
const base = `http://127.0.0.1:${process.env.BOOM_OS_PORT || 3000}`;
const ownerPassword = process.env.STAGE346_OWNER_PASSWORD || 'BoomStage346Owner!';
const staffPassword = 'Stage346StaffPass12345!';
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
function expect(step, got, want, body) { if (got !== want) failures.push(`${step}: expected ${want}, got ${got} -> ${JSON.stringify(body).slice(0, 300)}`); }
function ok(step, cond, detail) { if (!cond) failures.push(`${step}: FAILED ${detail !== undefined ? '-> ' + JSON.stringify(detail).slice(0, 320) : ''}`); }
function mustDeny(label, r) {
  if (r.status >= 200 && r.status < 300) failures.push(`${label} -- returned ${r.status} (expected denial): ${JSON.stringify(r.body).slice(0, 260)}`);
  else if (![400, 401, 403, 404, 409].includes(r.status)) failures.push(`${label} -- returned ${r.status}, not a recognized denial: ${JSON.stringify(r.body).slice(0, 260)}`);
  else counts.denials++;
}
function dbCheck(label, cond, detail) { counts.dbPost++; ok(`DB POST-CONDITION -- ${label}`, cond, detail); }
const money = v => Math.round(parseFloat(v) * 100);

const owner = await request('/api/auth/bootstrap', { method: 'POST', body: JSON.stringify({ full_name: 'S346 Owner', email: `s346owner-${stamp}@boom.local`, password: ownerPassword }) });
expect('bootstrap owner', owner.status, 201, owner.body);
const OWNER = { authorization: `Bearer ${owner.body.token}` };

async function makeFranchise(tag) {
  const f = await request('/api/franchises', { method: 'POST', headers: OWNER, body: JSON.stringify({ name: `S346 F${tag}`, code: `S346${tag}${stamp % 100000}`, legal_name: `S346${tag} LLC`, contact_name: 'x', phone: `+9932211${tag}`, email: `s346${tag}-${stamp}@boom.local`, address: 'x' }) });
  expect(`create franchise ${tag}`, f.status, 201, f.body); return f.body.franchise.id;
}
async function makeBranch(tag, franchiseId) {
  const branch = await request('/api/branches', { method: 'POST', headers: OWNER, body: JSON.stringify({ name: `S346 B${tag}`, code: `S346${tag}${stamp % 100000}`, address: 'x', phone: `+9932212${tag}`, franchise_id: franchiseId }) });
  expect(`branch ${tag}`, branch.status, 201, branch.body);
  const id = branch.body.branch.id;
  await request(`/api/franchises/${franchiseId}/branches/${id}`, { method: 'POST', headers: OWNER, body: '{}' });
  return { tag, id, franchiseId };
}
async function makeUser(label, branch, allowed, roles) {
  const email = `${label}-${stamp}@boom.local`.toLowerCase();
  const u = await request('/api/users', { method: 'POST', headers: OWNER, body: JSON.stringify({ full_name: `${label} Name`, email, phone: `+9938${Math.floor(Math.random() * 1000000)}`, password: staffPassword, branch_id: branch, roles, allowed_branches: allowed }) });
  expect(`create user ${label}`, u.status, 201, u.body);
  const login = await request('/api/auth/login', { method: 'POST', body: JSON.stringify({ login: email, password: staffPassword }) });
  expect(`login ${label}`, login.status, 200, login.body);
  return { label, email, id: u.body.user.id, headers: { authorization: `Bearer ${login.body.token}` } };
}

const FA = await makeFranchise('A');
const A1 = await makeBranch('A1', FA);
const A2 = await makeBranch('A2', FA);
const MGR = await makeUser('m346a1', A1.id, [A1.id], ['BRANCH_MANAGER']);
const MGR_A2 = await makeUser('m346a2', A2.id, [A2.id], ['BRANCH_MANAGER']);
const CASHIER = await makeUser('c346a1', A1.id, [A1.id], ['CASHIER']);
const WAITER = await makeUser('w346a1', A1.id, [A1.id], ['WAITER']);

expect('service charge to 0%', (await request(`/api/service-charge/${A1.id}`, { method: 'PUT', headers: MGR.headers, body: JSON.stringify({ percent: '0.00', categories: [] }) })).status, 201);
const cat = await request('/api/menu/categories', { method: 'POST', headers: MGR.headers, body: JSON.stringify({ branch_id: A1.id, name_ru: 'Cat', name_tk: 'Cat', sort_order: 0 }) });
const BIG = (await request('/api/menu/items', { method: 'POST', headers: MGR.headers, body: JSON.stringify({ branch_id: A1.id, category_id: cat.body.category.id, sku: `S346BIG-${stamp}`, name_ru: 'Feast', name_tk: 'Feast', price: '3000.00', sort_order: 0 }) })).body.item;
const CAKE = (await request('/api/menu/items', { method: 'POST', headers: MGR.headers, body: JSON.stringify({ branch_id: A1.id, category_id: cat.body.category.id, sku: `S346CAKE-${stamp}`, name_ru: 'Secret Birthday Cake', name_tk: 'Secret Birthday Cake', price: '90.00', sort_order: 1 }) })).body.item;
const area = await request('/api/tables/areas', { method: 'POST', headers: MGR.headers, body: JSON.stringify({ branch_id: A1.id, name: 'Hall', sort_order: 0 }) });
const tables = [];
for (let i = 0; i < 4; i++) tables.push((await request('/api/tables', { method: 'POST', headers: MGR.headers, body: JSON.stringify({ branch_id: A1.id, area_id: area.body.area.id, code: `T346${i}-${stamp % 10000}`, seats: 4 }) })).body.table);

expect('issue waiter code', (await request(`/api/waiters/${WAITER.id}/code`, { method: 'POST', headers: MGR.headers, body: JSON.stringify({ code: '9491' }) })).status, 201);
const wAuth = await request('/api/waiters/authenticate-code', { method: 'POST', body: JSON.stringify({ code: '9491', deviceId: 's346-dev' }) });
const W = { 'x-waiter-session': wAuth.body.session.token };
const unlockR = await request('/api/operator-pos/unlock', { method: 'POST', headers: CASHIER.headers, body: JSON.stringify({ password: staffPassword, branch_id: A1.id, device_id: 's346-cash' }) });
const posToken = unlockR.body.session_token;
expect('open shift', (await request('/api/cash-shifts', { method: 'POST', headers: CASHIER.headers, body: JSON.stringify({ branch_id: A1.id, opening_cash: '50.00' }) })).status, 201);

const bigSpender = (await request('/api/customers', { method: 'POST', headers: MGR.headers, body: JSON.stringify({ branch_id: A1.id, name: 'Big Spender', phone: `+99364${stamp % 1000000}` }) })).body.customer;
const smallSpender = (await request('/api/customers', { method: 'POST', headers: MGR.headers, body: JSON.stringify({ branch_id: A1.id, name: 'Small Spender', phone: `+99365${stamp % 1000000}` }) })).body.customer;

let tableIdx = 0;
async function settle(item, qty, customerId, suffix) {
  const table = tables[tableIdx++ % tables.length];
  const o = await request('/api/orders', { method: 'POST', headers: { ...W, 'idempotency-key': `s346-${Date.now()}-${Math.random()}` }, body: JSON.stringify({ order_type: 'DINE_IN', source: 'POS', table_id: table.id, items: [{ menu_item_id: item.id, quantity: qty }] }) });
  const order = o.body.order;
  await request(`/api/orders/${order.id}/customer`, { method: 'POST', headers: W, body: JSON.stringify({ customer_id: customerId }) });
  await request(`/api/orders/${order.id}/confirm`, { method: 'POST', headers: MGR.headers });
  const t = (await request(`/api/kds?branch_id=${A1.id}`, { headers: MGR.headers })).body.tickets.find(x => x.order_id === order.id);
  await request(`/api/kds/${t.id}/status`, { method: 'POST', headers: MGR.headers, body: JSON.stringify({ status: 'PREPARING' }) });
  await request(`/api/kds/${t.id}/status`, { method: 'POST', headers: MGR.headers, body: JSON.stringify({ status: 'READY' }) });
  const full = (await request(`/api/orders/${order.id}`, { headers: MGR.headers })).body.order;
  const p = await request('/api/payments', { method: 'POST', headers: { ...CASHIER.headers, 'x-pos-session-token': posToken, 'idempotency-key': `s346-pay-${suffix}` }, body: JSON.stringify({ order_id: order.id, method: 'CASH', amount: full.final_amount }) });
  expect(`pay ${suffix}`, p.status, 201, p.body);
  return full;
}

// ================================================================== 1-3. CONFIGURATION + RBAC
const settingsList = (await request('/api/settings', { headers: OWNER })).body.settings.map(s => s.key);
dbCheck('1. the threshold, validity, breakfast allowance and the automation switch are all settings', ['BOOMCARD_AUTO_LIFECYCLE_ENABLED', 'BOOMCARD_MONTHLY_SPEND_THRESHOLD', 'BOOMCARD_VALIDITY_DAYS', 'BOOMCARD_BREAKFAST_PER_PERIOD'].every(k => settingsList.includes(k)), settingsList.filter(k => k.startsWith('BOOMCARD')));
const cfg = await request('/api/boomcard/settings', { headers: MGR.headers });
dbCheck('1b. defaults: 5000.00 threshold, 30 days, 4 breakfasts, automation on', money(cfg.body.monthly_spend_threshold) === 500000 && cfg.body.validity_days === 30 && cfg.body.breakfasts_per_period === 4 && cfg.body.automatic_lifecycle_enabled === true, cfg.body);
mustDeny('2. a cashier cannot create a card', await request('/api/boomcard', { method: 'POST', headers: CASHIER.headers, body: JSON.stringify({ customer_id: bigSpender.id }) }));
mustDeny('2b. branch isolation: a branch A2 manager cannot list branch A1 cards', await request(`/api/boomcard?branch_id=${A1.id}`, { headers: MGR_A2.headers }));
mustDeny('2c. nor create a card for a branch A1 guest', await request('/api/boomcard', { method: 'POST', headers: MGR_A2.headers, body: JSON.stringify({ customer_id: bigSpender.id }) }));
mustDeny('3. an invalid evaluation period is refused', await request('/api/boomcard/lifecycle/evaluate', { method: 'POST', headers: MGR.headers, body: JSON.stringify({ branch_id: A1.id, from: '2030-01-01T00:00:00.000Z', to: '2020-01-01T00:00:00.000Z' }) }));

// ================================================================== 4-6. AUTOMATION PROPOSES, IT NEVER ACTIVATES
const periodFrom = '2000-01-01T00:00:00.000Z', periodTo = '2100-01-01T00:00:00.000Z';
await settle(BIG, 2, bigSpender.id, `big-${stamp}`);   // 6000.00 -- over the threshold
await settle(CAKE, 1, smallSpender.id, `small-${stamp}`); // 90.00 -- under it
const evalR = await request('/api/boomcard/lifecycle/evaluate', { method: 'POST', headers: MGR.headers, body: JSON.stringify({ branch_id: A1.id, from: periodFrom, to: periodTo }) });
expect('4. run the monthly evaluation', evalR.status, 200, evalR.body);
dbCheck('4b. only the guest over the threshold becomes a candidate, from REAL completed-order spend', evalR.body.candidates.length === 1 && evalR.body.candidates[0].customer_id === bigSpender.id && money(evalR.body.candidates[0].qualifying_spend) === 600000, evalR.body.candidates);
const cardId = evalR.body.candidates[0].boomcard_id;
const card1 = (await request(`/api/boomcard/${cardId}`, { headers: MGR.headers })).body;
dbCheck('5. AUTOMATION ONLY PROPOSES: the card is CANDIDATE, not ACTIVE, with no validity yet', card1.card.status === 'CANDIDATE' && !card1.card.activated_at && !card1.card.valid_until, card1.card);
dbCheck('5b. and the proposal is recorded as an automatic event with the spend and the period', card1.events.some(e => e.type === 'CANDIDATE_IDENTIFIED' && e.automatic === true && money(e.qualifying_spend) === 600000 && e.period_start === periodFrom), card1.events);
const rerun = await request('/api/boomcard/lifecycle/evaluate', { method: 'POST', headers: MGR.headers, body: JSON.stringify({ branch_id: A1.id, from: periodFrom, to: periodTo }) });
dbCheck('6. re-running the evaluation does not create a second card for the same guest', rerun.body.candidates.length === 1 && rerun.body.candidates[0].created === false && (await request(`/api/boomcard?branch_id=${A1.id}`, { headers: MGR.headers })).body.cards.length === 1, rerun.body.candidates);

// ================================================================== 7-9. MANAGER APPROVAL, RENEWAL, DEACTIVATION
const activate = await request(`/api/boomcard/${cardId}/activate`, { method: 'POST', headers: MGR.headers, body: JSON.stringify({ reason: 'Approved by manager' }) });
expect('7. the manager approves the card', activate.status, 200, activate.body);
dbCheck('7b. it becomes ACTIVE with a validity window and its breakfast allowance', activate.body.card?.status === 'ACTIVE' && activate.body.card?.valid_until && activate.body.card?.breakfast_granted === 4 && activate.body.card?.breakfast_used === 0, activate.body.card);
mustDeny('7c. activating an already-active card is refused', await request(`/api/boomcard/${cardId}/activate`, { method: 'POST', headers: MGR.headers, body: '{}' }));
const firstValidUntil = activate.body.card?.valid_until;

const renew = await request(`/api/boomcard/${cardId}/renew`, { method: 'POST', headers: MGR.headers, body: JSON.stringify({ reason: 'Next month' }) });
expect('8. renewal extends it', renew.status, 200, renew.body);
dbCheck('8b. the validity window moves forward and another allowance is granted', Date.parse(renew.body.card.valid_until) > Date.parse(firstValidUntil) && renew.body.card.breakfast_granted === 8, renew.body.card);

const deact = await request(`/api/boomcard/${cardId}/deactivate`, { method: 'POST', headers: MGR.headers, body: JSON.stringify({ reason: 'Guest asked' }) });
expect('9. deactivation', deact.status, 200, deact.body);
dbCheck('9b. the card goes INACTIVE but is NEVER deleted and keeps its whole history', deact.body.card.status === 'INACTIVE' && deact.body.card.deactivated_at && (await request(`/api/boomcard/${cardId}`, { headers: MGR.headers })).body.events.length >= 5, (await request(`/api/boomcard/${cardId}`, { headers: MGR.headers })).body.events.map(e => e.type));
expect('9c. and it can be activated again', (await request(`/api/boomcard/${cardId}/activate`, { method: 'POST', headers: MGR.headers, body: '{}' })).status, 200);

// ================================================================== 10-13. THE CABINET IS GENERIC ABOUT THE GIFT
const cardFull = (await request(`/api/boomcard/${cardId}`, { headers: MGR.headers })).body.card;
const gift = await request(`/api/boomcard/${cardId}/birthday-gift`, { method: 'POST', headers: MGR.headers, body: JSON.stringify({ menu_item_id: CAKE.id, quantity: 2, reason: 'Birthday' }) });
expect('10. the manager assigns a SPECIFIC product as the birthday benefit', gift.status, 201, gift.body);
dbCheck('10b. the grant records exactly which product and how many', gift.body.gift.menu_item_id === CAKE.id && gift.body.gift.quantity === 2 && gift.body.gift.status === 'GRANTED', gift.body.gift);
mustDeny('10c. a nonsense quantity is refused', await request(`/api/boomcard/${cardId}/birthday-gift`, { method: 'POST', headers: MGR.headers, body: JSON.stringify({ menu_item_id: CAKE.id, quantity: 0 }) }));

const managerView = (await request(`/api/boomcard/${cardId}`, { headers: MGR.headers })).body;
dbCheck('11. the MANAGER does see the product -- they chose it', managerView.gifts.some(g => g.menu_item_name === 'Secret Birthday Cake'), managerView.gifts.map(g => g.menu_item_name));

const cabinet = await request(`/api/boomcard/cabinet/${cardFull.cabinet_token}`);
expect('12. the guest opens their personal cabinet by its own link, without logging in', cabinet.status, 200, cabinet.body);
// Three grants so far: activation (4), renewal (4) and the re-activation after deactivation (4).
dbCheck('12b. it shows the breakfast balance as granted / used / remaining', cabinet.body.breakfast.granted === 12 && cabinet.body.breakfast.used === 0 && cabinet.body.breakfast.remaining === 12, cabinet.body.breakfast);
dbCheck('13. THE CORE PRIVACY RULE: the cabinet says a birthday benefit is waiting, never WHICH product it is', cabinet.body.birthday_benefit.available === true && cabinet.body.birthday_benefit.quantity === 2 && !JSON.stringify(cabinet.body).includes('Secret Birthday Cake') && !JSON.stringify(cabinet.body).includes(CAKE.id), cabinet.body);
mustDeny('13b. an unknown cabinet token reveals nothing', await request('/api/boomcard/cabinet/not-a-real-token'));

// ================================================================== 14-16. AUTOMATION OFF -> MANUAL STILL WORKS
expect('14. switch the automatic lifecycle OFF', (await request('/api/settings/BOOMCARD_AUTO_LIFECYCLE_ENABLED', { method: 'PUT', headers: OWNER, body: JSON.stringify({ value: 'false' }) })).status, 200);
const newGuest = (await request('/api/customers', { method: 'POST', headers: MGR.headers, body: JSON.stringify({ branch_id: A1.id, name: 'Another Spender', phone: `+99366${stamp % 1000000}` }) })).body.customer;
await settle(BIG, 2, newGuest.id, `other-${stamp}`);
const evalOff = await request('/api/boomcard/lifecycle/evaluate', { method: 'POST', headers: MGR.headers, body: JSON.stringify({ branch_id: A1.id, from: periodFrom, to: periodTo }) });
expect('14b. the evaluation still runs and still reports', evalOff.status, 200, evalOff.body);
dbCheck('14c. with automation OFF it REPORTS the qualifying guest but creates no card', evalOff.body.automatic_lifecycle_enabled === false && evalOff.body.candidates.some(c => c.customer_id === newGuest.id && c.boomcard_id === null && c.created === false), evalOff.body.candidates);
dbCheck('14d. and indeed no card exists for them', (await request(`/api/boomcard?branch_id=${A1.id}`, { headers: MGR.headers })).body.cards.every(c => c.customer_id !== newGuest.id), null);

const manual = await request('/api/boomcard', { method: 'POST', headers: MGR.headers, body: JSON.stringify({ customer_id: newGuest.id, reason: 'Manual while automation is off' }) });
expect('15. MANUAL MANAGEMENT KEEPS WORKING with automation off', manual.status, 201, manual.body);
const manualActivate = await request(`/api/boomcard/${manual.body.card.id}/activate`, { method: 'POST', headers: MGR.headers, body: JSON.stringify({ validity_days: 7, breakfasts: 1 }) });
dbCheck('15b. including activation with an explicit validity and allowance', manualActivate.body.card.status === 'ACTIVE' && manualActivate.body.card.breakfast_granted === 1, manualActivate.body.card);
mustDeny('15c. a second card for the same guest is refused', await request('/api/boomcard', { method: 'POST', headers: MGR.headers, body: JSON.stringify({ customer_id: newGuest.id }) }));

expect('16. switch automation back on', (await request('/api/settings/BOOMCARD_AUTO_LIFECYCLE_ENABLED', { method: 'PUT', headers: OWNER, body: JSON.stringify({ value: 'true' }) })).status, 200);
// Make the manual card already expired, then let the automatic run lapse it.
expect('16b. set an explicit end date that has already passed', (await request(`/api/boomcard/${manual.body.card.id}/renew`, { method: 'POST', headers: MGR.headers, body: JSON.stringify({ valid_until: '2020-01-01T00:00:00.000Z' }) })).status, 200);
const evalLapse = await request('/api/boomcard/lifecycle/evaluate', { method: 'POST', headers: MGR.headers, body: JSON.stringify({ branch_id: A1.id, from: periodFrom, to: periodTo }) });
const lapsedCard = (await request(`/api/boomcard/${manual.body.card.id}`, { headers: MGR.headers })).body;
dbCheck('16c. an expired card lapses to INACTIVE, recorded as an automatic decision', lapsedCard.card.status === 'INACTIVE' && lapsedCard.events.some(e => e.type === 'DEACTIVATED' && e.automatic === true && e.reason === 'Validity expired'), { status: lapsedCard.card.status, events: lapsedCard.events.map(e => [e.type, e.automatic]) });

// ================================================================== 17-18. CUSTOMER RECORD + AUDIT
expect('17. a manager records the guest\'s date of birth', (await request(`/api/customers/${bigSpender.id}`, { method: 'PATCH', headers: MGR.headers, body: JSON.stringify({ birth_date: '1990-07-15' }) })).status, 200);
mustDeny('17b. a malformed date is refused', await request(`/api/customers/${bigSpender.id}`, { method: 'PATCH', headers: MGR.headers, body: JSON.stringify({ birth_date: 'next tuesday' }) }));
const custDetail = (await request(`/api/customers/${bigSpender.id}`, { headers: MGR.headers })).body;
dbCheck('17c. the guest record carries the date and their card, and still no discount field', custDetail.customer.birth_date === '1990-07-15' && custDetail.boomcard?.id === cardId && !Object.keys(custDetail.customer).some(k => /discount/i.test(k)), Object.keys(custDetail.customer));

const audit = (await request(`/api/audit?branch_id=${A1.id}&limit=400`, { headers: OWNER })).body.logs || [];
const actions = new Set(audit.map(a => a.action));
dbCheck('18. every lifecycle transition and grant is audited', ['BOOMCARD_CANDIDATE_IDENTIFIED', 'BOOMCARD_ACTIVATED', 'BOOMCARD_RENEWED', 'BOOMCARD_DEACTIVATED', 'BOOMCARD_BIRTHDAY_GIFT_GRANTED', 'BOOMCARD_BREAKFAST_GRANTED'].every(a => actions.has(a)), [...actions].filter(a => a.startsWith('BOOMCARD')));

console.log(`\nStage 34.6 BOOMCARD E2E: ${counts.runtime} HTTP calls, ${counts.denials} denials, ${counts.dbPost} DB post-conditions`);
if (failures.length) { console.error(`\nFAILURES (${failures.length}):`); for (const f of failures) console.error(' - ' + f); process.exit(1); }
console.log('ALL STAGE 34.6 BOOMCARD CHECKS PASSED');
