// BOOM OS -- Stage 34.5: fresh-DB E2E proof of BOOMCOIN.
//
// Proves the specification's worked examples (160 -> 0 coins and 40 to go; 350 -> 1 coin and 50 to
// go; 400 -> 2 coins), that the LEDGER is authoritative and the counter is only guidance, that the
// rate and both switches are configuration rather than code, that a retried payment cannot mint a
// second coin, and that a refunded order gives its coins back as its own ledger rows.
//
// Requires an empty database. Usage: node tests/stage34_5_boomcoin_e2e.mjs
const base = `http://127.0.0.1:${process.env.BOOM_OS_PORT || 3000}`;
const ownerPassword = process.env.STAGE345_OWNER_PASSWORD || 'BoomStage345Owner!';
const staffPassword = 'Stage345StaffPass12345!';
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

const owner = await request('/api/auth/bootstrap', { method: 'POST', body: JSON.stringify({ full_name: 'S345 Owner', email: `s345owner-${stamp}@boom.local`, password: ownerPassword }) });
expect('bootstrap owner', owner.status, 201, owner.body);
const OWNER = { authorization: `Bearer ${owner.body.token}` };

async function makeFranchise(tag) {
  const f = await request('/api/franchises', { method: 'POST', headers: OWNER, body: JSON.stringify({ name: `S345 F${tag}`, code: `S345${tag}${stamp % 100000}`, legal_name: `S345${tag} LLC`, contact_name: 'x', phone: `+9932111${tag}`, email: `s345${tag}-${stamp}@boom.local`, address: 'x' }) });
  expect(`create franchise ${tag}`, f.status, 201, f.body); return f.body.franchise.id;
}
async function makeBranch(tag, franchiseId) {
  const branch = await request('/api/branches', { method: 'POST', headers: OWNER, body: JSON.stringify({ name: `S345 B${tag}`, code: `S345${tag}${stamp % 100000}`, address: 'x', phone: `+9932112${tag}`, franchise_id: franchiseId }) });
  expect(`branch ${tag}`, branch.status, 201, branch.body);
  const id = branch.body.branch.id;
  await request(`/api/franchises/${franchiseId}/branches/${id}`, { method: 'POST', headers: OWNER, body: '{}' });
  return { tag, id, franchiseId };
}
async function makeUser(label, branch, allowed, roles) {
  const email = `${label}-${stamp}@boom.local`.toLowerCase();
  const u = await request('/api/users', { method: 'POST', headers: OWNER, body: JSON.stringify({ full_name: `${label} Name`, email, phone: `+9937${Math.floor(Math.random() * 1000000)}`, password: staffPassword, branch_id: branch, roles, allowed_branches: allowed }) });
  expect(`create user ${label}`, u.status, 201, u.body);
  const login = await request('/api/auth/login', { method: 'POST', body: JSON.stringify({ login: email, password: staffPassword }) });
  expect(`login ${label}`, login.status, 200, login.body);
  return { label, email, id: u.body.user.id, headers: { authorization: `Bearer ${login.body.token}` } };
}

const FA = await makeFranchise('A');
const A1 = await makeBranch('A1', FA);
const A2 = await makeBranch('A2', FA);
const MGR = await makeUser('m345a1', A1.id, [A1.id], ['BRANCH_MANAGER']);
const MGR_A2 = await makeUser('m345a2', A2.id, [A2.id], ['BRANCH_MANAGER']);
const CASHIER = await makeUser('c345a1', A1.id, [A1.id], ['CASHIER']);
const WAITER = await makeUser('w345a1', A1.id, [A1.id], ['WAITER']);

// Service charge OFF so the qualifying spend in this test is exactly the menu money.
expect('service charge to 0%', (await request(`/api/service-charge/${A1.id}`, { method: 'PUT', headers: MGR.headers, body: JSON.stringify({ percent: '0.00', categories: [] }) })).status, 201);

const cat = await request('/api/menu/categories', { method: 'POST', headers: MGR.headers, body: JSON.stringify({ branch_id: A1.id, name_ru: 'Cat', name_tk: 'Cat', sort_order: 0 }) });
const mk = async (sku, price) => (await request('/api/menu/items', { method: 'POST', headers: MGR.headers, body: JSON.stringify({ branch_id: A1.id, category_id: cat.body.category.id, sku, name_ru: sku, name_tk: sku, price, sort_order: 0 }) })).body.item;
const I160 = await mk(`S345-160-${stamp}`, '160.00');
const I190 = await mk(`S345-190-${stamp}`, '190.00');
const I50 = await mk(`S345-50-${stamp}`, '50.00');

const area = await request('/api/tables/areas', { method: 'POST', headers: MGR.headers, body: JSON.stringify({ branch_id: A1.id, name: 'Hall', sort_order: 0 }) });
const tables = [];
for (let i = 0; i < 6; i++) tables.push((await request('/api/tables', { method: 'POST', headers: MGR.headers, body: JSON.stringify({ branch_id: A1.id, area_id: area.body.area.id, code: `T345${i}-${stamp % 10000}`, seats: 4 }) })).body.table);

expect('issue waiter code', (await request(`/api/waiters/${WAITER.id}/code`, { method: 'POST', headers: MGR.headers, body: JSON.stringify({ code: '9481' }) })).status, 201);
const wAuth = await request('/api/waiters/authenticate-code', { method: 'POST', body: JSON.stringify({ code: '9481', deviceId: 's345-dev' }) });
const W = { 'x-waiter-session': wAuth.body.session.token };
const unlockR = await request('/api/operator-pos/unlock', { method: 'POST', headers: CASHIER.headers, body: JSON.stringify({ password: staffPassword, branch_id: A1.id, device_id: 's345-cash' }) });
expect('CASHIER POS unlock', unlockR.status, 200, unlockR.body);
const posToken = unlockR.body.session_token;
expect('open shift', (await request('/api/cash-shifts', { method: 'POST', headers: CASHIER.headers, body: JSON.stringify({ branch_id: A1.id, opening_cash: '50.00' }) })).status, 201);

const cust = (await request('/api/customers', { method: 'POST', headers: MGR.headers, body: JSON.stringify({ branch_id: A1.id, name: 'Coin Guest', phone: `+99363${stamp % 1000000}` }) })).body.customer;

let tableIdx = 0;
async function settle(item, qty, customerId, idemSuffix) {
  const table = tables[tableIdx++ % tables.length];
  const o = await request('/api/orders', { method: 'POST', headers: { ...W, 'idempotency-key': `s345-${Date.now()}-${Math.random()}` }, body: JSON.stringify({ order_type: 'DINE_IN', source: 'POS', table_id: table.id, items: [{ menu_item_id: item.id, quantity: qty }] }) });
  expect('create order', o.status, 201, o.body);
  const order = o.body.order;
  if (customerId) await request(`/api/orders/${order.id}/customer`, { method: 'POST', headers: W, body: JSON.stringify({ customer_id: customerId }) });
  await request(`/api/orders/${order.id}/confirm`, { method: 'POST', headers: MGR.headers });
  const t = (await request(`/api/kds?branch_id=${A1.id}`, { headers: MGR.headers })).body.tickets.find(x => x.order_id === order.id);
  await request(`/api/kds/${t.id}/status`, { method: 'POST', headers: MGR.headers, body: JSON.stringify({ status: 'PREPARING' }) });
  await request(`/api/kds/${t.id}/status`, { method: 'POST', headers: MGR.headers, body: JSON.stringify({ status: 'READY' }) });
  const full = (await request(`/api/orders/${order.id}`, { headers: MGR.headers })).body.order;
  const idem = `s345-pay-${idemSuffix}`;
  const p = await request('/api/payments', { method: 'POST', headers: { ...CASHIER.headers, 'x-pos-session-token': posToken, 'idempotency-key': idem }, body: JSON.stringify({ order_id: order.id, method: 'CASH', amount: full.final_amount }) });
  expect(`pay order ${idemSuffix}`, p.status, 201, p.body);
  return { order: full, payment: p.body.payment, idem };
}
async function counter(customerId, headers) { return (await request(`/api/loyalty/boomcoin/customers/${customerId}`, { headers })).body; }

// ================================================================== 1-3. CONFIGURATION, NOT CODE
const settingsList = (await request('/api/settings', { headers: OWNER })).body.settings.map(s => s.key);
dbCheck('1. the rate and both switches exist as system settings', ['BOOMCOIN_EARNING_ENABLED', 'BOOMCOIN_COUNTER_UI_ENABLED', 'BOOMCOIN_SPEND_PER_COIN'].every(k => settingsList.includes(k)), settingsList.filter(k => k.startsWith('BOOMCOIN')));
const cfg = await request('/api/loyalty/boomcoin/settings', { headers: MGR.headers });
dbCheck('1b. and the default rate is 200.00 per coin, with both switches on', cfg.body.earning_enabled === true && cfg.body.counter_ui_enabled === true && money(cfg.body.spend_per_coin) === 20000, cfg.body);
mustDeny('2. a cashier cannot post a manual adjustment', await request('/api/loyalty/boomcoin/adjust', { method: 'POST', headers: CASHIER.headers, body: JSON.stringify({ customer_id: cust.id, coins: 5, reason: 'x' }) }));
mustDeny('2b. branch isolation: a branch A2 manager cannot read branch A1 ledger', await request(`/api/loyalty/boomcoin/ledger?branch_id=${A1.id}`, { headers: MGR_A2.headers }));
mustDeny('2c. nor a branch A1 guest\'s counter', await request(`/api/loyalty/boomcoin/customers/${cust.id}`, { headers: MGR_A2.headers }));

const start = await counter(cust.id, MGR.headers);
dbCheck('3. a new guest starts at zero, needing a full 200.00 for their first coin', start.balance === 0 && money(start.qualifying_spend) === 0 && money(start.to_next_coin) === 20000, start);

// ================================================================== 4-6. THE THREE WORKED EXAMPLES
const s160 = await settle(I160, 1, cust.id, `160-${stamp}`);
const c160 = await counter(cust.id, MGR.headers);
dbCheck('4. 160.00 spent -> 0 BOOMCOIN, and 40.00 more would earn one ("закажи ещё на 40")', c160.balance === 0 && money(c160.qualifying_spend) === 16000 && money(c160.to_next_coin) === 4000, c160);

const s190 = await settle(I190, 1, cust.id, `190-${stamp}`); // cumulative 350.00
const c350 = await counter(cust.id, MGR.headers);
dbCheck('5. 350.00 cumulative -> 1 BOOMCOIN, 50.00 to the next', c350.balance === 1 && money(c350.qualifying_spend) === 35000 && money(c350.to_next_coin) === 5000, c350);

const s50 = await settle(I50, 1, cust.id, `50-${stamp}`); // cumulative 400.00
const c400 = await counter(cust.id, MGR.headers);
dbCheck('6. 400.00 cumulative -> 2 BOOMCOIN, and a full 200.00 to the next', c400.balance === 2 && money(c400.qualifying_spend) === 40000 && money(c400.to_next_coin) === 20000, c400);

// ================================================================== 7-9. THE LEDGER IS AUTHORITATIVE
const ledger = (await request(`/api/loyalty/boomcoin/ledger?branch_id=${A1.id}&customer_id=${cust.id}`, { headers: MGR.headers })).body;
dbCheck('7. every settlement wrote exactly one EARNED row', ledger.entries.filter(e => e.type === 'EARNED').length === 3, ledger.entries.map(e => [e.type, e.coins, e.qualifying_amount]));
dbCheck('7b. the balance is the SUM of the ledger, and the cached column agrees with it', c400.balance === ledger.entries.reduce((s, e) => s + Number(e.coins), 0) && c400.cached_balance === c400.balance, { computed: c400.balance, cached: c400.cached_balance });
dbCheck('7c. each row records the balance before and after, so the history is self-explaining', ledger.entries.every(e => Number.isInteger(e.balance_before) && Number.isInteger(e.balance_after) && e.balance_after - e.balance_before === Number(e.coins)), ledger.entries.map(e => [e.balance_before, e.balance_after, e.coins]));

const replay = await request('/api/payments', { method: 'POST', headers: { ...CASHIER.headers, 'x-pos-session-token': posToken, 'idempotency-key': s50.idem }, body: JSON.stringify({ order_id: s50.order.id, method: 'CASH', amount: s50.order.final_amount }) });
expect('8. replaying a payment is idempotent', replay.status, 200, replay.body);
const afterReplay = await counter(cust.id, MGR.headers);
// The payment replay short-circuits before accrual is reached, and the ledger's own unique entry
// key would refuse a duplicate anyway -- two independent guards, asserted here and in the static suite.
dbCheck('8b. and mints NO second coin', afterReplay.balance === 2 && money(afterReplay.qualifying_spend) === 40000, afterReplay);

const adj = await request('/api/loyalty/boomcoin/adjust', { method: 'POST', headers: MGR.headers, body: JSON.stringify({ customer_id: cust.id, coins: 3, reason: 'Goodwill' }) });
expect('9. a manager posts a manual adjustment', adj.status, 201, adj.body);
mustDeny('9b. an adjustment without a reason is refused', await request('/api/loyalty/boomcoin/adjust', { method: 'POST', headers: MGR.headers, body: JSON.stringify({ customer_id: cust.id, coins: 1 }) }));
mustDeny('9c. a zero adjustment is refused', await request('/api/loyalty/boomcoin/adjust', { method: 'POST', headers: MGR.headers, body: JSON.stringify({ customer_id: cust.id, coins: 0, reason: 'x' }) }));
const afterAdj = await counter(cust.id, MGR.headers);
dbCheck('9d. the adjustment is a ledger row like any other: 2 + 3 = 5', afterAdj.balance === 5 && afterAdj.cached_balance === 5, afterAdj);
dbCheck('9e. and it adds no qualifying spend, so the progress counter is untouched', money(afterAdj.qualifying_spend) === 40000, afterAdj);

// ================================================================== 10-11. REFUND GIVES THE COINS BACK
const closureReq = await request(`/api/orders/${s160.order.id}/closure-requests`, { method: 'POST', headers: CASHIER.headers, body: JSON.stringify({ type: 'CLOSED_BY_ESTABLISHMENT', reason: 'Quality', inventory_treatment: 'WRITE_OFF', refund_requested: true }) });
expect('10. request a refund for the 160.00 order', closureReq.status, 201, closureReq.body);
expect('10b. manager approves', (await request(`/api/orders/closure-requests/${closureReq.body.closure.id}/approve`, { method: 'POST', headers: MGR.headers, body: '{}' })).status, 200);
const afterRefund = await counter(cust.id, MGR.headers);
dbCheck('11. the refunded order gives its qualifying spend back: 400.00 - 160.00 = 240.00', money(afterRefund.qualifying_spend) === 24000, afterRefund);
const ledger2 = (await request(`/api/loyalty/boomcoin/ledger?branch_id=${A1.id}&customer_id=${cust.id}`, { headers: MGR.headers })).body;
dbCheck('11b. the reversal is its OWN row -- the original EARNED entry is never edited or deleted', ledger2.entries.filter(e => e.type === 'REVERSED').length === 1 && ledger2.entries.filter(e => e.type === 'EARNED').length === 3, ledger2.entries.map(e => [e.type, e.coins]));
dbCheck('11c. and the balance still equals the sum of the ledger', afterRefund.balance === ledger2.entries.reduce((s, e) => s + Number(e.coins), 0) && afterRefund.cached_balance === afterRefund.balance, { computed: afterRefund.balance, cached: afterRefund.cached_balance });

// ================================================================== 12-14. THE SWITCHES REALLY SWITCH
expect('12. turn the earning engine OFF', (await request('/api/settings/BOOMCOIN_EARNING_ENABLED', { method: 'PUT', headers: OWNER, body: JSON.stringify({ value: 'false' }) })).status, 200);
const beforeOff = await counter(cust.id, MGR.headers);
await settle(I190, 1, cust.id, `off-${stamp}`);
const afterOff = await counter(cust.id, MGR.headers);
dbCheck('12b. with the engine off, a settled order earns nothing and records nothing', afterOff.balance === beforeOff.balance && money(afterOff.qualifying_spend) === money(beforeOff.qualifying_spend) && afterOff.earning_enabled === false, { before: beforeOff, after: afterOff });

expect('13. turn the counter UI off (independently of earning)', (await request('/api/settings/BOOMCOIN_COUNTER_UI_ENABLED', { method: 'PUT', headers: OWNER, body: JSON.stringify({ value: 'false' }) })).status, 200);
const uiOff = await counter(cust.id, MGR.headers);
dbCheck('13b. the counter flag flips while the balance itself is unaffected', uiOff.counter_ui_enabled === false && uiOff.balance === afterOff.balance, uiOff);

expect('14. turn earning back on and change the rate to 100.00', (await request('/api/settings/BOOMCOIN_EARNING_ENABLED', { method: 'PUT', headers: OWNER, body: JSON.stringify({ value: 'true' }) })).status, 200);
expect('14b. set the rate', (await request('/api/settings/BOOMCOIN_SPEND_PER_COIN', { method: 'PUT', headers: OWNER, body: JSON.stringify({ value: '100.00' }) })).status, 200);
const beforeRate = await counter(cust.id, MGR.headers);
await settle(I190, 1, cust.id, `rate-${stamp}`);
const afterRate = await counter(cust.id, MGR.headers);
dbCheck('14c. at 100.00 per coin, 190.00 more spend earns 1 coin (240 -> 430 crosses 300 and 400)', afterRate.balance - beforeRate.balance === 2 && money(afterRate.spend_per_coin) === 10000, { before: beforeRate, after: afterRate });

// ================================================================== 15-16. POS COUNTER + AUDIT
const posCounter = await request(`/api/loyalty/boomcoin/customers/${cust.id}`, { headers: W });
expect('15. the waiter POS can read the counter from its own session', posCounter.status, 200, posCounter.body);
dbCheck('15b. and sees the same authoritative numbers', posCounter.body.balance === afterRate.balance && money(posCounter.body.qualifying_spend) === money(afterRate.qualifying_spend), posCounter.body);

const audit = (await request(`/api/audit?branch_id=${A1.id}&limit=400`, { headers: OWNER })).body.logs || [];
const actions = new Set(audit.map(a => a.action));
dbCheck('16. earning, reversal and manual adjustment are all audited', ['BOOMCOIN_EARNED', 'BOOMCOIN_REVERSED', 'BOOMCOIN_ADJUSTED'].every(a => actions.has(a)), [...actions].filter(a => a.startsWith('BOOMCOIN')));

console.log(`\nStage 34.5 BOOMCOIN E2E: ${counts.runtime} HTTP calls, ${counts.denials} denials, ${counts.dbPost} DB post-conditions`);
if (failures.length) { console.error(`\nFAILURES (${failures.length}):`); for (const f of failures) console.error(' - ' + f); process.exit(1); }
console.log('ALL STAGE 34.5 BOOMCOIN CHECKS PASSED');
