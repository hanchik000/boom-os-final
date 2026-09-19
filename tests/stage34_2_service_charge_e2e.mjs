// BOOM OS -- Stage 34.2: fresh-DB E2E proof of the configurable service charge.
//
// Proves: a configuration is a VERSION (publishing archives the old one and never re-prices an
// existing order), categories with mixed COMMON/INDIVIDUAL modes, a 0% member earning nothing,
// allocations that can never exceed the collected service charge, the remainder staying with the
// establishment, per-order-type percentages (dine-in / takeaway / delivery) that are configurable
// rather than hardcoded, and real pool distribution by EQUAL / BY_SALES / BY_ORDERS / BY_HOURS.
//
// Requires an empty database. Usage: node tests/stage34_2_service_charge_e2e.mjs
const base = `http://127.0.0.1:${process.env.BOOM_OS_PORT || 3000}`;
const ownerPassword = process.env.STAGE342_OWNER_PASSWORD || 'BoomStage342Owner!';
const staffPassword = 'Stage342StaffPass12345!';
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

// ---------------------------------------------------------------- bootstrap + topology
const owner = await request('/api/auth/bootstrap', { method: 'POST', body: JSON.stringify({ full_name: 'S342 Owner', email: `s342owner-${stamp}@boom.local`, password: ownerPassword }) });
expect('bootstrap owner', owner.status, 201, owner.body);
const OWNER = { authorization: `Bearer ${owner.body.token}` };

async function makeFranchise(tag) {
  const f = await request('/api/franchises', { method: 'POST', headers: OWNER, body: JSON.stringify({ name: `S342 F${tag}`, code: `S342${tag}${stamp % 100000}`, legal_name: `S342${tag} LLC`, contact_name: 'x', phone: `+9931811${tag}`, email: `s342${tag}-${stamp}@boom.local`, address: 'x' }) });
  expect(`create franchise ${tag}`, f.status, 201, f.body); return f.body.franchise.id;
}
async function makeBranch(tag, franchiseId) {
  const branch = await request('/api/branches', { method: 'POST', headers: OWNER, body: JSON.stringify({ name: `S342 B${tag}`, code: `S342${tag}${stamp % 100000}`, address: 'x', phone: `+9931812${tag}`, franchise_id: franchiseId }) });
  expect(`branch ${tag}`, branch.status, 201, branch.body);
  const id = branch.body.branch.id;
  await request(`/api/franchises/${franchiseId}/branches/${id}`, { method: 'POST', headers: OWNER, body: '{}' });
  return { tag, id, franchiseId };
}
async function makeUser(label, branch, allowed, roles) {
  const email = `${label}-${stamp}@boom.local`.toLowerCase();
  const u = await request('/api/users', { method: 'POST', headers: OWNER, body: JSON.stringify({ full_name: `${label} Name`, email, phone: `+9934${Math.floor(Math.random() * 1000000)}`, password: staffPassword, branch_id: branch, roles, allowed_branches: allowed }) });
  expect(`create user ${label}`, u.status, 201, u.body);
  const login = await request('/api/auth/login', { method: 'POST', body: JSON.stringify({ login: email, password: staffPassword }) });
  expect(`login ${label}`, login.status, 200, login.body);
  return { label, email, id: u.body.user.id, headers: { authorization: `Bearer ${login.body.token}` } };
}

const FA = await makeFranchise('A');
const A1 = await makeBranch('A1', FA);
const A2 = await makeBranch('A2', FA);
const MGR = await makeUser('m342a1', A1.id, [A1.id], ['BRANCH_MANAGER']);
const MGR_A2 = await makeUser('m342a2', A2.id, [A2.id], ['BRANCH_MANAGER']);
const CASHIER = await makeUser('c342a1', A1.id, [A1.id], ['CASHIER']);
const ALI = await makeUser('ali342', A1.id, [A1.id], ['WAITER']);
const SERGEY = await makeUser('sergey342', A1.id, [A1.id], ['WAITER']);
const EMIR = await makeUser('emir342', A1.id, [A1.id], ['WAITER']);
const BAR1 = await makeUser('bar342a', A1.id, [A1.id], ['WAITER']);
const BAR2 = await makeUser('bar342b', A1.id, [A1.id], ['WAITER']);
const COOK = await makeUser('cook342', A1.id, [A1.id], ['WAITER']);

// ---------------------------------------------------------------- menu / table / POS plumbing
const cat = await request('/api/menu/categories', { method: 'POST', headers: MGR.headers, body: JSON.stringify({ branch_id: A1.id, name_ru: 'Cat', name_tk: 'Cat', sort_order: 0 }) });
const item = (await request('/api/menu/items', { method: 'POST', headers: MGR.headers, body: JSON.stringify({ branch_id: A1.id, category_id: cat.body.category.id, sku: `SKU342-${stamp}`, name_ru: 'Burger', name_tk: 'Burger', price: '100.00', sort_order: 0 }) })).body.item;
const area = await request('/api/tables/areas', { method: 'POST', headers: MGR.headers, body: JSON.stringify({ branch_id: A1.id, name: 'Hall', sort_order: 0 }) });
async function makeTable(code) { return (await request('/api/tables', { method: 'POST', headers: MGR.headers, body: JSON.stringify({ branch_id: A1.id, area_id: area.body.area.id, code, seats: 4 }) })).body.table; }
const T1 = await makeTable(`T342A-${stamp % 10000}`), T2 = await makeTable(`T342B-${stamp % 10000}`), T3 = await makeTable(`T342C-${stamp % 10000}`);

// Ali and Sergey become PROFESSIONAL waiters (the pre-existing rule: only a PROFESSIONAL waiter
// shares in the service charge). Emir deliberately stays PROBATION.
async function waiterSession(user, code) {
  expect(`issue code ${user.label}`, (await request(`/api/waiters/${user.id}/code`, { method: 'POST', headers: MGR.headers, body: JSON.stringify({ code }) })).status, 201);
  const a = await request('/api/waiters/authenticate-code', { method: 'POST', body: JSON.stringify({ code, deviceId: `s342-${user.label}` }) });
  expect(`waiter session ${user.label}`, a.status, 200, a.body);
  return { 'x-waiter-session': a.body.session.token };
}
const W_ALI = await waiterSession(ALI, '9451');
const W_SERGEY = await waiterSession(SERGEY, '9452');
await waiterSession(EMIR, '9453'); // Emir gets a POS code too, which makes him a real PROBATION waiter
expect('ali -> PROFESSIONAL', (await request(`/api/waiters/${ALI.id}/status`, { method: 'PUT', headers: MGR.headers, body: JSON.stringify({ status: 'PROFESSIONAL' }) })).status, 200);
expect('sergey -> PROFESSIONAL', (await request(`/api/waiters/${SERGEY.id}/status`, { method: 'PUT', headers: MGR.headers, body: JSON.stringify({ status: 'PROFESSIONAL' }) })).status, 200);

const unlockR = await request('/api/operator-pos/unlock', { method: 'POST', headers: CASHIER.headers, body: JSON.stringify({ password: staffPassword, branch_id: A1.id, device_id: 's342-cash' }) });
expect('CASHIER POS unlock', unlockR.status, 200, unlockR.body);
const posToken = unlockR.body.session_token;
expect('open shift', (await request('/api/cash-shifts', { method: 'POST', headers: CASHIER.headers, body: JSON.stringify({ branch_id: A1.id, opening_cash: '50.00' }) })).status, 201);

// ================================================================== 1-5. VALIDATION
const V1_BODY = {
  percent: '15.00', takeaway_percent: '0.00', delivery_percent: '0.00',
  categories: [
    { category: 'BAR', percent: '1.00', mode: 'COMMON', strategy: 'EQUAL', members: [{ user_id: BAR1.id }, { user_id: BAR2.id }] },
    { category: 'KITCHEN', percent: '2.00', mode: 'COMMON', strategy: 'EQUAL', members: [{ user_id: COOK.id }] },
    { category: 'WAITERS', percent: '5.00', mode: 'INDIVIDUAL', members: [{ user_id: ALI.id, percent: '2.00' }, { user_id: SERGEY.id, percent: '1.00' }, { user_id: EMIR.id, percent: '0.00' }] },
    { category: 'MANAGERS', percent: '4.00', mode: 'INDIVIDUAL', members: [{ user_id: MGR.id, percent: '4.00' }] },
    { category: 'OTHER', percent: '3.00', mode: 'COMMON', strategy: 'BY_SALES', members: [{ user_id: ALI.id }, { user_id: SERGEY.id }] },
  ],
};
mustDeny('1. categories may not exceed the total service charge', await request(`/api/service-charge/${A1.id}`, { method: 'PUT', headers: MGR.headers, body: JSON.stringify({ ...V1_BODY, percent: '10.00' }) }));
mustDeny('2. individual member allocations may not exceed their category', await request(`/api/service-charge/${A1.id}`, { method: 'PUT', headers: MGR.headers, body: JSON.stringify({ ...V1_BODY, categories: [{ category: 'WAITERS', percent: '2.00', mode: 'INDIVIDUAL', members: [{ user_id: ALI.id, percent: '3.00' }] }] }) }));
mustDeny('3. an unknown category is refused', await request(`/api/service-charge/${A1.id}`, { method: 'PUT', headers: MGR.headers, body: JSON.stringify({ percent: '10.00', categories: [{ category: 'SECURITY', percent: '1.00' }] }) }));
mustDeny('4. an unknown distribution strategy is refused', await request(`/api/service-charge/${A1.id}`, { method: 'PUT', headers: MGR.headers, body: JSON.stringify({ percent: '10.00', categories: [{ category: 'BAR', percent: '1.00', mode: 'COMMON', strategy: 'BY_VIBES', members: [] }] }) }));
mustDeny('5. a cashier cannot publish a service charge configuration', await request(`/api/service-charge/${A1.id}`, { method: 'PUT', headers: CASHIER.headers, body: JSON.stringify(V1_BODY) }));
mustDeny('6. branch isolation: a branch A2 manager cannot publish or read branch A1 configuration', await request(`/api/service-charge/${A1.id}`, { headers: MGR_A2.headers }));
mustDeny('6b. nor its ledger', await request(`/api/service-charge/${A1.id}/ledger`, { headers: MGR_A2.headers }));
mustDeny('6c. nor distribute its pools', await request(`/api/service-charge/${A1.id}/distribute`, { method: 'POST', headers: MGR_A2.headers, body: JSON.stringify({ from: '2020-01-01T00:00:00.000Z', to: '2030-01-01T00:00:00.000Z' }) }));

// ================================================================== 7-9. PUBLISH VERSION 1
const v1 = await request(`/api/service-charge/${A1.id}`, { method: 'PUT', headers: MGR.headers, body: JSON.stringify(V1_BODY) });
expect('7. publish configuration version 1', v1.status, 201, v1.body);
const V1_ID = v1.body.config.id;
dbCheck('7b. it is an ACTIVE, open-ended version with all five categories', v1.body.config.status === 'ACTIVE' && v1.body.config.effective_to === null && v1.body.config.categories.length === 5, v1.body.config);
dbCheck('8. mixed modes are preserved exactly as configured (BAR/KITCHEN/OTHER common, WAITERS/MANAGERS individual)', (() => { const m = Object.fromEntries(v1.body.config.categories.map(c => [c.category, c.mode])); return m.BAR === 'COMMON' && m.KITCHEN === 'COMMON' && m.OTHER === 'COMMON' && m.WAITERS === 'INDIVIDUAL' && m.MANAGERS === 'INDIVIDUAL'; })(), v1.body.config.categories.map(c => [c.category, c.mode, c.strategy]));
dbCheck('9. a member configured at 0% is stored as a real member, not dropped', v1.body.config.categories.find(c => c.category === 'WAITERS').members.some(m => m.user_id === EMIR.id && Number(m.percent) === 0), v1.body.config.categories.find(c => c.category === 'WAITERS').members);

// ================================================================== 10-16. A REAL PAID ORDER
async function newOrder(table, waiterHeaders, type = 'DINE_IN') {
  const o = await request('/api/orders', { method: 'POST', headers: { ...waiterHeaders, 'idempotency-key': `s342-${Date.now()}-${Math.random()}` }, body: JSON.stringify({ order_type: type, source: 'POS', table_id: type === 'DINE_IN' ? table.id : null, items: [{ menu_item_id: item.id, quantity: 1 }] }) });
  expect('create order', o.status, 201, o.body);
  return o.body.order;
}
async function payOrder(order) {
  await request(`/api/orders/${order.id}/confirm`, { method: 'POST', headers: MGR.headers });
  const t = (await request(`/api/kds?branch_id=${A1.id}`, { headers: MGR.headers })).body.tickets.find(x => x.order_id === order.id);
  await request(`/api/kds/${t.id}/status`, { method: 'POST', headers: MGR.headers, body: JSON.stringify({ status: 'PREPARING' }) });
  await request(`/api/kds/${t.id}/status`, { method: 'POST', headers: MGR.headers, body: JSON.stringify({ status: 'READY' }) });
  const full = (await request(`/api/orders/${order.id}`, { headers: MGR.headers })).body.order;
  const p = await request('/api/payments', { method: 'POST', headers: { ...CASHIER.headers, 'x-pos-session-token': posToken, 'idempotency-key': `s342-pay-${order.id}` }, body: JSON.stringify({ order_id: order.id, method: 'CASH', amount: full.final_amount }) });
  expect('pay order', p.status, 201, p.body);
  return full;
}
const order1 = await payOrder(await newOrder(T1, W_ALI));
dbCheck('10. dine-in service charge comes from the published version: 15% of 100.00 = 15.00', money(order1.service_charge) === 1500, order1);
dbCheck('10b. the order snapshots WHICH configuration version priced it', order1.service_charge_config_id === V1_ID, { snapshot: order1.service_charge_config_id, v1: V1_ID });

const ledger1 = (await request(`/api/service-charge/${A1.id}/ledger`, { headers: MGR.headers })).body.ledger.filter(r => r.order_id === order1.id);
const byKey = Object.fromEntries(ledger1.map(r => [r.allocation_key, r]));
dbCheck('11. INDIVIDUAL categories pay named employees immediately (Ali 2% = 2.00, Sergey 1% = 1.00, manager 4% = 4.00)',
  money(byKey[`WAITERS|INDIVIDUAL|${ALI.id}`]?.amount) === 200 && money(byKey[`WAITERS|INDIVIDUAL|${SERGEY.id}`]?.amount) === 100 && money(byKey[`MANAGERS|INDIVIDUAL|${MGR.id}`]?.amount) === 400, ledger1.map(r => [r.allocation_key, r.amount]));
dbCheck('12. a 0% member earns nothing -- no ledger row at all', !ledger1.some(r => r.user_id === EMIR.id), ledger1.filter(r => r.user_id === EMIR.id));
dbCheck('13. COMMON categories record ONE pool per order, not per-person rows (BAR 1.00, KITCHEN 2.00, OTHER 3.00)',
  byKey['BAR|POOL']?.status === 'POOLED' && money(byKey['BAR|POOL']?.amount) === 100 && money(byKey['KITCHEN|POOL']?.amount) === 200 && money(byKey['OTHER|POOL']?.amount) === 300, ledger1.map(r => [r.allocation_key, r.status, r.amount]));
dbCheck('13b. each pool carries the strategy it must later be distributed by', byKey['BAR|POOL']?.strategy === 'EQUAL' && byKey['OTHER|POOL']?.strategy === 'BY_SALES', ledger1.map(r => [r.allocation_key, r.strategy]));
dbCheck('14. the unallocated remainder stays with the establishment (15% collected - 13% allocated = 2.00)', byKey['ESTABLISHMENT']?.target_type === 'ESTABLISHMENT' && money(byKey['ESTABLISHMENT']?.amount) === 200, byKey['ESTABLISHMENT']);
dbCheck('15. the ledger reconciles EXACTLY to the service charge the order actually collected', ledger1.reduce((s, r) => s + money(r.amount), 0) === money(order1.service_charge), { rows: ledger1.map(r => r.amount), service_charge: order1.service_charge });
dbCheck('16. every row records the configuration version it came from', ledger1.every(r => r.config_id === V1_ID), ledger1.map(r => r.config_id));

// ================================================================== 17-19. VERSIONING: publishing never re-prices history
const V2_BODY = { percent: '20.00', takeaway_percent: '5.00', delivery_percent: '7.00', categories: [{ category: 'WAITERS', percent: '20.00', mode: 'INDIVIDUAL', members: [{ user_id: ALI.id, percent: '20.00' }] }] };
const v2 = await request(`/api/service-charge/${A1.id}`, { method: 'PUT', headers: MGR.headers, body: JSON.stringify(V2_BODY) });
expect('17. publish configuration version 2', v2.status, 201, v2.body);
const history = (await request(`/api/service-charge/${A1.id}/history`, { headers: MGR.headers })).body.versions;
const v1row = history.find(v => v.id === V1_ID);
dbCheck('17b. version 1 is archived with an effective_to, not edited in place or deleted', v1row && v1row.status === 'ARCHIVED' && v1row.effective_to && Number(v1row.percent) === 15, v1row);
dbCheck('17c. the whole history stays readable with its categories', history.length === 2 && v1row.categories.length === 5, history.map(v => [v.status, v.percent, v.categories.length]));
const order1After = (await request(`/api/orders/${order1.id}`, { headers: MGR.headers })).body.order;
dbCheck('18. the already-paid order is NOT re-priced by the new version: still 15.00 under version 1', money(order1After.service_charge) === 1500 && order1After.service_charge_config_id === V1_ID, order1After);
const ledger1After = (await request(`/api/service-charge/${A1.id}/ledger`, { headers: MGR.headers })).body.ledger.filter(r => r.order_id === order1.id);
dbCheck('18b. and its distribution is untouched -- still the version 1 split', ledger1After.length === ledger1.length && ledger1After.reduce((s, r) => s + money(r.amount), 0) === 1500, ledger1After.map(r => [r.allocation_key, r.amount]));

// ================================================================== 19-20. PER-ORDER-TYPE PERCENTAGES
const takeawayOrder = await newOrder(null, W_ALI, 'TAKEAWAY');
dbCheck('19. takeaway (pickup) uses its OWN configurable percentage, not dine-in and not a hardcoded zero: 5% of 100.00 = 5.00', money(takeawayOrder.service_charge) === 500, takeawayOrder);
const dineOrder2 = await newOrder(T2, W_ALI);
dbCheck('20. dine-in now uses version 2: 20% of 100.00 = 20.00', money(dineOrder2.service_charge) === 2000, dineOrder2);

// ================================================================== 21-26. POOL DISTRIBUTION
const from = '2000-01-01T00:00:00.000Z', to = '2100-01-01T00:00:00.000Z';
mustDeny('21. a cashier cannot distribute pools', await request(`/api/service-charge/${A1.id}/distribute`, { method: 'POST', headers: CASHIER.headers, body: JSON.stringify({ from, to }) }));
mustDeny('21b. an invalid period is refused', await request(`/api/service-charge/${A1.id}/distribute`, { method: 'POST', headers: MGR.headers, body: JSON.stringify({ from: to, to: from }) }));
const dist = await request(`/api/service-charge/${A1.id}/distribute`, { method: 'POST', headers: MGR.headers, body: JSON.stringify({ from, to }) });
expect('22. distribute the pools', dist.status, 200, dist.body);
const ledgerAfterDist = (await request(`/api/service-charge/${A1.id}/ledger`, { headers: MGR.headers })).body.ledger.filter(r => r.order_id === order1.id);
const distRows = ledgerAfterDist.filter(r => r.target_type === 'DISTRIBUTED');
const barDist = distRows.filter(r => r.category === 'BAR');
dbCheck('23. EQUAL splits the BAR pool of 1.00 exactly in half between its two members', barDist.length === 2 && barDist.every(r => money(r.amount) === 50) && barDist.map(r => r.user_id).sort().join() === [BAR1.id, BAR2.id].sort().join(), barDist.map(r => [r.user_id, r.amount]));
dbCheck('23b. a single-member EQUAL pool goes entirely to that member (KITCHEN 2.00 -> cook)', distRows.filter(r => r.category === 'KITCHEN').length === 1 && money(distRows.find(r => r.category === 'KITCHEN').amount) === 200, distRows.filter(r => r.category === 'KITCHEN'));
const otherDist = distRows.filter(r => r.category === 'OTHER');
dbCheck('24. BY_SALES weighs by REAL completed sales: only Ali sold, so he takes the whole 3.00 OTHER pool', otherDist.length === 1 && otherDist[0].user_id === ALI.id && money(otherDist[0].amount) === 300, otherDist.map(r => [r.user_id, r.amount]));
dbCheck('25. every distributed pool is marked DISTRIBUTED and linked back to its pool row', ledgerAfterDist.filter(r => r.target_type === 'POOL').every(r => r.status === 'DISTRIBUTED') && distRows.every(r => r.pool_id), ledgerAfterDist.filter(r => r.target_type === 'POOL').map(r => r.status));
dbCheck('25b. distribution is exact: the pools and their distributions carry the same money', distRows.reduce((s, r) => s + money(r.amount), 0) === ledgerAfterDist.filter(r => r.target_type === 'POOL').reduce((s, r) => s + money(r.amount), 0), { distributed: distRows.map(r => r.amount), pools: ledgerAfterDist.filter(r => r.target_type === 'POOL').map(r => r.amount) });
dbCheck('25c. the order still reconciles exactly after distribution (distributions replace pools, they do not add money)', ledgerAfterDist.filter(r => r.target_type !== 'DISTRIBUTED').reduce((s, r) => s + money(r.amount), 0) === 1500, ledgerAfterDist.map(r => [r.target_type, r.amount]));
const dist2 = await request(`/api/service-charge/${A1.id}/distribute`, { method: 'POST', headers: MGR.headers, body: JSON.stringify({ from, to }) });
expect('26. re-running distribution is safe', dist2.status, 200, dist2.body);
dbCheck('26b. re-running distributes nothing a second time', dist2.body.distributed.length === 0, dist2.body);

// ================================================================== 27-28. PROBATION waiter, zero-weight pool
const V3_BODY = { percent: '10.00', categories: [
  { category: 'WAITERS', percent: '5.00', mode: 'INDIVIDUAL', members: [{ user_id: EMIR.id, percent: '5.00' }] },
  { category: 'KITCHEN', percent: '5.00', mode: 'COMMON', strategy: 'BY_SALES', members: [{ user_id: COOK.id }] },
] };
expect('27. publish version 3', (await request(`/api/service-charge/${A1.id}`, { method: 'PUT', headers: MGR.headers, body: JSON.stringify(V3_BODY) })).status, 201);
const order3 = await payOrder(await newOrder(T3, W_SERGEY));
const ledger3 = (await request(`/api/service-charge/${A1.id}/ledger`, { headers: MGR.headers })).body.ledger.filter(r => r.order_id === order3.id);
dbCheck('27b. a PROBATION waiter does not share in the service charge; that money falls to the establishment instead', !ledger3.some(r => r.user_id === EMIR.id) && money(ledger3.find(r => r.target_type === 'ESTABLISHMENT')?.amount) === 500, ledger3.map(r => [r.allocation_key, r.amount]));
const dist3 = await request(`/api/service-charge/${A1.id}/distribute`, { method: 'POST', headers: MGR.headers, body: JSON.stringify({ from, to }) });
dbCheck('28. a pool whose members all weigh zero is REPORTED, never split on a guess', dist3.body.skipped.some(s => s.category === 'KITCHEN' && s.reason === 'ZERO_WEIGHT'), dist3.body);
const kitchenPool3 = (await request(`/api/service-charge/${A1.id}/ledger`, { headers: MGR.headers })).body.ledger.find(r => r.order_id === order3.id && r.allocation_key === 'KITCHEN|POOL');
dbCheck('28b. and it stays POOLED, so the money is never lost', kitchenPool3?.status === 'POOLED', kitchenPool3);

// ================================================================== 29-30. AUDIT
const audit = (await request(`/api/audit?branch_id=${A1.id}&limit=400`, { headers: OWNER })).body.logs || [];
const actions = new Set(audit.map(a => a.action));
dbCheck('29. publishing a version and distributing pools are both audited', actions.has('SERVICE_CHARGE_VERSION_PUBLISHED') && actions.has('SERVICE_CHARGE_POOLS_DISTRIBUTED'), [...actions].filter(a => a.startsWith('SERVICE_CHARGE')));
const publishAudit = audit.find(a => a.action === 'SERVICE_CHARGE_VERSION_PUBLISHED' && a.entity_id === V1_ID);
dbCheck('30. the publish audit records the full category breakdown that was approved', publishAudit && JSON.stringify(publishAudit.new_values).includes('WAITERS') && JSON.stringify(publishAudit.new_values).includes('INDIVIDUAL'), publishAudit?.new_values);

// ---------------------------------------------------------------- summary
console.log(`\nStage 34.2 service charge E2E: ${counts.runtime} HTTP calls, ${counts.denials} denials, ${counts.dbPost} DB post-conditions`);
if (failures.length) { console.error(`\nFAILURES (${failures.length}):`); for (const f of failures) console.error(' - ' + f); process.exit(1); }
console.log('ALL STAGE 34.2 SERVICE CHARGE CHECKS PASSED');
