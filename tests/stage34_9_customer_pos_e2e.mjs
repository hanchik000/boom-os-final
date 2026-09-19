// BOOM OS -- Stage 34.9: fresh-DB E2E proof of the customer / CRM flow across every POS surface.
//
// Proves: a guest can be created from the POS with a NAME ALONE (phone optional); a phone still
// identifies the same guest across visits and across surfaces so they are never duplicated;
// attaching a guest NEVER changes the price (no automatic discount anywhere); and ONE customer
// record backs the waiter POS, the cashier, BOOMCARD, BOOMCOIN, BOOMBACK, credit and CRM.
//
// Requires an empty database. Usage: node tests/stage34_9_customer_pos_e2e.mjs
const base = `http://127.0.0.1:${process.env.BOOM_OS_PORT || 3000}`;
const ownerPassword = process.env.STAGE349_OWNER_PASSWORD || 'BoomStage349Owner!';
const staffPassword = 'Stage349StaffPass12345!';
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

const owner = await request('/api/auth/bootstrap', { method: 'POST', body: JSON.stringify({ full_name: 'S349 Owner', email: `s349owner-${stamp}@boom.local`, password: ownerPassword }) });
expect('bootstrap owner', owner.status, 201, owner.body);
const OWNER = { authorization: `Bearer ${owner.body.token}` };

async function makeFranchise(tag) {
  const f = await request('/api/franchises', { method: 'POST', headers: OWNER, body: JSON.stringify({ name: `S349 F${tag}`, code: `S349${tag}${stamp % 100000}`, legal_name: `S349${tag} LLC`, contact_name: 'x', phone: `+9932511${tag}`, email: `s349${tag}-${stamp}@boom.local`, address: 'x' }) });
  expect(`create franchise ${tag}`, f.status, 201, f.body); return f.body.franchise.id;
}
async function makeBranch(tag, franchiseId) {
  const branch = await request('/api/branches', { method: 'POST', headers: OWNER, body: JSON.stringify({ name: `S349 B${tag}`, code: `S349${tag}${stamp % 100000}`, address: 'x', phone: `+9932512${tag}`, franchise_id: franchiseId }) });
  expect(`branch ${tag}`, branch.status, 201, branch.body);
  const id = branch.body.branch.id;
  await request(`/api/franchises/${franchiseId}/branches/${id}`, { method: 'POST', headers: OWNER, body: '{}' });
  return { tag, id, franchiseId };
}
async function makeUser(label, branch, allowed, roles) {
  const email = `${label}-${stamp}@boom.local`.toLowerCase();
  const u = await request('/api/users', { method: 'POST', headers: OWNER, body: JSON.stringify({ full_name: `${label} Name`, email, phone: `+9941${Math.floor(Math.random() * 1000000)}`, password: staffPassword, branch_id: branch, roles, allowed_branches: allowed }) });
  expect(`create user ${label}`, u.status, 201, u.body);
  const login = await request('/api/auth/login', { method: 'POST', body: JSON.stringify({ login: email, password: staffPassword }) });
  expect(`login ${label}`, login.status, 200, login.body);
  return { label, email, id: u.body.user.id, headers: { authorization: `Bearer ${login.body.token}` } };
}

const FA = await makeFranchise('A');
const A1 = await makeBranch('A1', FA);
const A2 = await makeBranch('A2', FA);
const MGR = await makeUser('m349a1', A1.id, [A1.id], ['BRANCH_MANAGER']);
const MGR_A2 = await makeUser('m349a2', A2.id, [A2.id], ['BRANCH_MANAGER']);
const CASHIER = await makeUser('c349a1', A1.id, [A1.id], ['CASHIER']);
const WAITER = await makeUser('w349a1', A1.id, [A1.id], ['WAITER']);

expect('service charge to 0%', (await request(`/api/service-charge/${A1.id}`, { method: 'PUT', headers: MGR.headers, body: JSON.stringify({ percent: '0.00', categories: [] }) })).status, 201);
const cat = await request('/api/menu/categories', { method: 'POST', headers: MGR.headers, body: JSON.stringify({ branch_id: A1.id, name_ru: 'Cat', name_tk: 'Cat', sort_order: 0 }) });
const DISH = (await request('/api/menu/items', { method: 'POST', headers: MGR.headers, body: JSON.stringify({ branch_id: A1.id, category_id: cat.body.category.id, sku: `S349-${stamp}`, name_ru: 'Dish', name_tk: 'Dish', price: '400.00', sort_order: 0 }) })).body.item;
const area = await request('/api/tables/areas', { method: 'POST', headers: MGR.headers, body: JSON.stringify({ branch_id: A1.id, name: 'Hall', sort_order: 0 }) });
const tables = [];
for (let i = 0; i < 4; i++) tables.push((await request('/api/tables', { method: 'POST', headers: MGR.headers, body: JSON.stringify({ branch_id: A1.id, area_id: area.body.area.id, code: `T349${i}-${stamp % 10000}`, seats: 4 }) })).body.table);

expect('issue waiter code', (await request(`/api/waiters/${WAITER.id}/code`, { method: 'POST', headers: MGR.headers, body: JSON.stringify({ code: '9521' }) })).status, 201);
const wAuth = await request('/api/waiters/authenticate-code', { method: 'POST', body: JSON.stringify({ code: '9521', deviceId: 's349-dev' }) });
const W = { 'x-waiter-session': wAuth.body.session.token };
const posToken = (await request('/api/operator-pos/unlock', { method: 'POST', headers: CASHIER.headers, body: JSON.stringify({ password: staffPassword, branch_id: A1.id, device_id: 's349-cash' }) })).body.session_token;
expect('open shift', (await request('/api/cash-shifts', { method: 'POST', headers: CASHIER.headers, body: JSON.stringify({ branch_id: A1.id, opening_cash: '50.00' }) })).status, 201);

let tableIdx = 0;
async function openOrder() {
  const table = tables[tableIdx++ % tables.length];
  const o = await request('/api/orders', { method: 'POST', headers: { ...W, 'idempotency-key': `s349-${Date.now()}-${Math.random()}` }, body: JSON.stringify({ order_type: 'DINE_IN', source: 'POS', table_id: table.id, items: [{ menu_item_id: DISH.id, quantity: 1 }] }) });
  expect('create order', o.status, 201, o.body);
  return o.body.order;
}
async function orderOf(id) { return (await request(`/api/orders/${id}`, { headers: MGR.headers })).body.order; }

// ================================================================== 1-4. CREATE FROM THE WAITER POS
mustDeny('1. a guest still needs a name', await request('/api/customers/pos', { method: 'POST', headers: W, body: JSON.stringify({ phone: '+99312345678' }) }));
const noPhone = await request('/api/customers/pos', { method: 'POST', headers: W, body: JSON.stringify({ name: 'Walk-in Guest' }) });
expect('2. a guest can be created from the POS with a NAME ALONE', noPhone.status, 201, noPhone.body);
dbCheck('2b. the phone is genuinely optional, not an empty string', noPhone.body.customer.name === 'Walk-in Guest' && (noPhone.body.customer.phone === null || noPhone.body.customer.phone === undefined), noPhone.body.customer);
const noPhone2 = await request('/api/customers/pos', { method: 'POST', headers: W, body: JSON.stringify({ name: 'Another Walk-in' }) });
dbCheck('2c. two guests without a phone do not collide on the unique index', noPhone2.status === 201 && noPhone2.body.customer.id !== noPhone.body.customer.id, { a: noPhone.body.customer.id, b: noPhone2.body.customer?.id });

const phone = `+99369${stamp % 1000000}`;
const withPhone = await request('/api/customers/pos', { method: 'POST', headers: W, body: JSON.stringify({ name: 'Regular Guest', phone }) });
expect('3. a guest with a phone', withPhone.status, 201, withPhone.body);
const again = await request('/api/customers/pos', { method: 'POST', headers: W, body: JSON.stringify({ name: 'Regular Guest Again', phone }) });
dbCheck('3b. the SAME phone returns the SAME guest on the next visit -- never a duplicate', again.status === 200 && again.body.existed === true && again.body.customer.id === withPhone.body.customer.id, again.body);
const viaCashier = await request('/api/customers', { method: 'POST', headers: CASHIER.headers, body: JSON.stringify({ branch_id: A1.id, name: 'Regular via cashier', phone }) });
dbCheck('4. and reaching them from the CASHIER surface returns the same record, not a second one', viaCashier.body?.customer?.id === withPhone.body.customer.id && viaCashier.body?.existed === true, viaCashier.body);
const viaCredit = await request('/api/credit/customers', { method: 'POST', headers: CASHIER.headers, body: JSON.stringify({ branch_id: A1.id, name: 'Regular via credit', phone }) });
dbCheck('4b. and from the CREDIT surface too -- one customer core', viaCredit.body?.customer?.id === withPhone.body.customer.id, viaCredit.body);

// ================================================================== 5-7. SEARCH + ATTACH, NO AUTOMATIC DISCOUNT
const search = await request(`/api/customers/pos/search?search=Regular`, { headers: W });
expect('5. the waiter POS searches its own branch', search.status, 200, search.body);
dbCheck('5b. and finds the guest', search.body.customers.some(c => c.id === withPhone.body.customer.id), search.body.customers.map(c => c.name));
mustDeny('5c. the POS search needs a real session', await request(`/api/customers/pos/search?search=Regular`));

const order1 = await openOrder();
dbCheck('6. the order starts at 400.00 with no discount', money(order1.final_amount) === 40000 && money(order1.discount) === 0, order1);
const attach = await request(`/api/orders/${order1.id}/customer`, { method: 'POST', headers: W, body: JSON.stringify({ customer_id: withPhone.body.customer.id }) });
expect('6b. the waiter attaches the guest', attach.status, 200, attach.body);
const afterAttach = await orderOf(order1.id);
dbCheck('7. THE CORE RULE: attaching a guest NEVER changes the price -- no automatic discount exists', afterAttach.customer_id === withPhone.body.customer.id && money(afterAttach.discount) === 0 && money(afterAttach.final_amount) === 40000, afterAttach);
dbCheck('7b. and the guest profile itself has no discount field at all', !Object.keys(withPhone.body.customer).some(k => /discount/i.test(k)), Object.keys(withPhone.body.customer));

// ================================================================== 8-11. ONE IDENTITY ACROSS EVERY SURFACE
const posIdentity = await request(`/api/customers/pos/${withPhone.body.customer.id}`, { headers: W });
expect('8. the waiter POS reads the guest identity', posIdentity.status, 200, posIdentity.body);
dbCheck('8b. it carries BOOMCOIN, BOOMBACK, BOOMCARD and credit in one place', posIdentity.body.boomcoin && posIdentity.body.boomback && 'boomcard' in posIdentity.body && 'credit' in posIdentity.body, Object.keys(posIdentity.body));
mustDeny('8c. branch isolation: the waiter POS cannot read another branch\'s guest', await request(`/api/customers/pos/${withPhone.body.customer.id}`, { headers: { 'x-waiter-session': 'not-a-session' } }));

// Give the guest a real presence on every surface, then prove ONE record carries all of it.
expect('9. grant BOOMBACK', (await request('/api/loyalty/boomback/adjust', { method: 'POST', headers: MGR.headers, body: JSON.stringify({ customer_id: withPhone.body.customer.id, amount: '250.00', reason: 'Campaign' }) })).status, 201);
expect('9b. grant BOOMCOIN', (await request('/api/loyalty/boomcoin/adjust', { method: 'POST', headers: MGR.headers, body: JSON.stringify({ customer_id: withPhone.body.customer.id, coins: 4, reason: 'Goodwill' }) })).status, 201);
const card = await request('/api/boomcard', { method: 'POST', headers: MGR.headers, body: JSON.stringify({ customer_id: withPhone.body.customer.id }) });
expect('9c. create their BOOMCARD', card.status, 201, card.body);
const acct = await request('/api/credit/accounts', { method: 'POST', headers: CASHIER.headers, body: JSON.stringify({ branch_id: A1.id, type: 'CUSTOMER', customer_id: withPhone.body.customer.id }) });
expect('9d. open their credit account', acct.status, 201, acct.body);

const crm = await request(`/api/customers/${withPhone.body.customer.id}`, { headers: MGR.headers });
expect('10. the CRM profile loads', crm.status, 200, crm.body);
dbCheck('10b. ONE record carries all of it: BOOMCOIN 4, BOOMBACK 250.00, a BOOMCARD and a credit account',
  crm.body.boomcoin.balance === 4 && money(crm.body.boomback.balance) === 25000 && crm.body.boomcard?.id === card.body.card.id && crm.body.credit?.id === acct.body.account.id, { coin: crm.body.boomcoin, back: crm.body.boomback, card: crm.body.boomcard?.id, credit: crm.body.credit?.id });
dbCheck('10c. and the orders they were attached to', crm.body.orders.some(o => o.id === order1.id), crm.body.orders.map(o => o.order_number));
const posIdentity2 = await request(`/api/customers/pos/${withPhone.body.customer.id}`, { headers: W });
dbCheck('11. the waiter POS sees exactly the SAME numbers as CRM -- one identity, not two', posIdentity2.body.boomcoin.balance === crm.body.boomcoin.balance && money(posIdentity2.body.boomback.balance) === money(crm.body.boomback.balance) && posIdentity2.body.boomcard?.id === crm.body.boomcard?.id, { pos: posIdentity2.body.boomcoin, crm: crm.body.boomcoin });
const cabinet = await request(`/api/boomcard/cabinet/${(await request(`/api/boomcard/${card.body.card.id}`, { headers: MGR.headers })).body.card.cabinet_token}`);
dbCheck('11b. and the guest\'s own cabinet shows the same cashback balance', money(cabinet.body.cashback_balance) === 25000, cabinet.body);

// ================================================================== 12-14. RBAC / ISOLATION / AUDIT
mustDeny('12. branch isolation: a branch A2 manager cannot list branch A1 guests', await request(`/api/customers?branch_id=${A1.id}`, { headers: MGR_A2.headers }));
mustDeny('12b. nor read one of their profiles', await request(`/api/customers/${withPhone.body.customer.id}`, { headers: MGR_A2.headers }));
mustDeny('12c. nor attach them to an order', await request(`/api/orders/${order1.id}/customer`, { method: 'POST', headers: MGR_A2.headers, body: JSON.stringify({ customer_id: withPhone.body.customer.id }) }));

expect('13. a manager records the guest\'s date of birth', (await request(`/api/customers/${withPhone.body.customer.id}`, { method: 'PATCH', headers: MGR.headers, body: JSON.stringify({ birth_date: '1988-03-08' }) })).status, 200);
const afterPatch = await request(`/api/customers/${withPhone.body.customer.id}`, { headers: MGR.headers });
dbCheck('13b. it is stored and still grants nothing', afterPatch.body.customer.birth_date === '1988-03-08' && money(afterPatch.body.orders[0].discount) === 0, afterPatch.body.customer);

// The guest pays -- and the identity keeps working right through settlement.
await request(`/api/orders/${order1.id}/confirm`, { method: 'POST', headers: MGR.headers });
const ticket = (await request(`/api/kds?branch_id=${A1.id}`, { headers: MGR.headers })).body.tickets.find(x => x.order_id === order1.id);
await request(`/api/kds/${ticket.id}/status`, { method: 'POST', headers: MGR.headers, body: JSON.stringify({ status: 'PREPARING' }) });
await request(`/api/kds/${ticket.id}/status`, { method: 'POST', headers: MGR.headers, body: JSON.stringify({ status: 'READY' }) });
const ready = await orderOf(order1.id);
const pay = await request('/api/payments', { method: 'POST', headers: { ...CASHIER.headers, 'x-pos-session-token': posToken, 'idempotency-key': `s349-pay-${stamp}` }, body: JSON.stringify({ order_id: order1.id, method: 'CASH', amount: ready.final_amount }) });
expect('14. the guest pays the full list price', pay.status, 201, pay.body);
dbCheck('14b. 400.00 -- identifying them never discounted anything', money(pay.body.payment.amount) === 40000, pay.body.payment);
const crmAfter = await request(`/api/customers/${withPhone.body.customer.id}`, { headers: MGR.headers });
dbCheck('14c. and the settled order now counts toward their BOOMCOIN progress on the same record', Number(crmAfter.body.boomcoin.qualifying_spend) >= 400, crmAfter.body.boomcoin);

const audit = (await request(`/api/audit?branch_id=${A1.id}&limit=400`, { headers: OWNER })).body.logs || [];
const actions = new Set(audit.map(a => a.action));
dbCheck('15. creating, attaching and updating a guest are all audited', ['CUSTOMER_CREATED', 'ORDER_CUSTOMER_ATTACHED', 'CUSTOMER_UPDATED'].every(a => actions.has(a)), [...actions].filter(a => a.startsWith('CUSTOMER') || a.startsWith('ORDER_CUSTOMER')));

console.log(`\nStage 34.9 customer/CRM E2E: ${counts.runtime} HTTP calls, ${counts.denials} denials, ${counts.dbPost} DB post-conditions`);
if (failures.length) { console.error(`\nFAILURES (${failures.length}):`); for (const f of failures) console.error(' - ' + f); process.exit(1); }
console.log('ALL STAGE 34.9 CUSTOMER/CRM CHECKS PASSED');
