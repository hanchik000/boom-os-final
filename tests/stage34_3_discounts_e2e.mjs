// BOOM OS -- Stage 34.3: fresh-DB E2E proof of MANUAL customer discounts.
//
// Proves: attaching a customer never changes a price, no automatic or profile-level discount
// exists, the server -- not the caller -- computes the discount amount, the full snapshot
// (customer / percent / amount / employee / role / reason / timestamp) is recorded and audited,
// the configured ceiling is enforced, a settled order can never be re-discounted, and removing a
// discount is a soft, audited reversal that recomputes the order.
//
// Requires an empty database. Usage: node tests/stage34_3_discounts_e2e.mjs
const base = `http://127.0.0.1:${process.env.BOOM_OS_PORT || 3000}`;
const ownerPassword = process.env.STAGE343_OWNER_PASSWORD || 'BoomStage343Owner!';
const staffPassword = 'Stage343StaffPass12345!';
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

const owner = await request('/api/auth/bootstrap', { method: 'POST', body: JSON.stringify({ full_name: 'S343 Owner', email: `s343owner-${stamp}@boom.local`, password: ownerPassword }) });
expect('bootstrap owner', owner.status, 201, owner.body);
const OWNER = { authorization: `Bearer ${owner.body.token}` };

async function makeFranchise(tag) {
  const f = await request('/api/franchises', { method: 'POST', headers: OWNER, body: JSON.stringify({ name: `S343 F${tag}`, code: `S343${tag}${stamp % 100000}`, legal_name: `S343${tag} LLC`, contact_name: 'x', phone: `+9931911${tag}`, email: `s343${tag}-${stamp}@boom.local`, address: 'x' }) });
  expect(`create franchise ${tag}`, f.status, 201, f.body); return f.body.franchise.id;
}
async function makeBranch(tag, franchiseId) {
  const branch = await request('/api/branches', { method: 'POST', headers: OWNER, body: JSON.stringify({ name: `S343 B${tag}`, code: `S343${tag}${stamp % 100000}`, address: 'x', phone: `+9931912${tag}`, franchise_id: franchiseId }) });
  expect(`branch ${tag}`, branch.status, 201, branch.body);
  const id = branch.body.branch.id;
  await request(`/api/franchises/${franchiseId}/branches/${id}`, { method: 'POST', headers: OWNER, body: '{}' });
  return { tag, id, franchiseId };
}
async function makeUser(label, branch, allowed, roles) {
  const email = `${label}-${stamp}@boom.local`.toLowerCase();
  const u = await request('/api/users', { method: 'POST', headers: OWNER, body: JSON.stringify({ full_name: `${label} Name`, email, phone: `+9935${Math.floor(Math.random() * 1000000)}`, password: staffPassword, branch_id: branch, roles, allowed_branches: allowed }) });
  expect(`create user ${label}`, u.status, 201, u.body);
  const login = await request('/api/auth/login', { method: 'POST', body: JSON.stringify({ login: email, password: staffPassword }) });
  expect(`login ${label}`, login.status, 200, login.body);
  return { label, email, id: u.body.user.id, headers: { authorization: `Bearer ${login.body.token}` } };
}

const FA = await makeFranchise('A');
const A1 = await makeBranch('A1', FA);
const A2 = await makeBranch('A2', FA);
const MGR = await makeUser('m343a1', A1.id, [A1.id], ['BRANCH_MANAGER']);
const MGR_A2 = await makeUser('m343a2', A2.id, [A2.id], ['BRANCH_MANAGER']);
const CASHIER = await makeUser('c343a1', A1.id, [A1.id], ['CASHIER']);
const WAITER = await makeUser('w343a1', A1.id, [A1.id], ['WAITER']);

const cat = await request('/api/menu/categories', { method: 'POST', headers: MGR.headers, body: JSON.stringify({ branch_id: A1.id, name_ru: 'Cat', name_tk: 'Cat', sort_order: 0 }) });
const item = (await request('/api/menu/items', { method: 'POST', headers: MGR.headers, body: JSON.stringify({ branch_id: A1.id, category_id: cat.body.category.id, sku: `SKU343-${stamp}`, name_ru: 'Burger', name_tk: 'Burger', price: '100.00', sort_order: 0 }) })).body.item;
const area = await request('/api/tables/areas', { method: 'POST', headers: MGR.headers, body: JSON.stringify({ branch_id: A1.id, name: 'Hall', sort_order: 0 }) });
async function makeTable(code) { return (await request('/api/tables', { method: 'POST', headers: MGR.headers, body: JSON.stringify({ branch_id: A1.id, area_id: area.body.area.id, code, seats: 4 }) })).body.table; }
const T1 = await makeTable(`T343A-${stamp % 10000}`), T2 = await makeTable(`T343B-${stamp % 10000}`), T3 = await makeTable(`T343C-${stamp % 10000}`), T4 = await makeTable(`T343D-${stamp % 10000}`);

expect('issue waiter code', (await request(`/api/waiters/${WAITER.id}/code`, { method: 'POST', headers: MGR.headers, body: JSON.stringify({ code: '9461' }) })).status, 201);
const wAuth = await request('/api/waiters/authenticate-code', { method: 'POST', body: JSON.stringify({ code: '9461', deviceId: 's343-dev' }) });
const W = { 'x-waiter-session': wAuth.body.session.token };
const unlockR = await request('/api/operator-pos/unlock', { method: 'POST', headers: CASHIER.headers, body: JSON.stringify({ password: staffPassword, branch_id: A1.id, device_id: 's343-cash' }) });
expect('CASHIER POS unlock', unlockR.status, 200, unlockR.body);
const posToken = unlockR.body.session_token;
expect('open shift', (await request('/api/cash-shifts', { method: 'POST', headers: CASHIER.headers, body: JSON.stringify({ branch_id: A1.id, opening_cash: '50.00' }) })).status, 201);

async function newOrder(table, qty = 1) {
  const o = await request('/api/orders', { method: 'POST', headers: { ...W, 'idempotency-key': `s343-${Date.now()}-${Math.random()}` }, body: JSON.stringify({ order_type: 'DINE_IN', source: 'POS', table_id: table.id, items: [{ menu_item_id: item.id, quantity: qty }] }) });
  expect('create order', o.status, 201, o.body);
  return o.body.order;
}
async function orderOf(id) { return (await request(`/api/orders/${id}`, { headers: MGR.headers })).body.order; }

// ================================================================== 1-4. CUSTOMER IDENTITY, NO AUTOMATIC DISCOUNT
const custR = await request('/api/customers', { method: 'POST', headers: MGR.headers, body: JSON.stringify({ branch_id: A1.id, name: 'Guest One', phone: `+99361${stamp % 1000000}` }) });
expect('1. create a customer', custR.status, 201, custR.body);
const CUST = custR.body.customer;
dbCheck('1b. a customer profile carries no discount field of any kind', !Object.keys(CUST).some(k => /discount/i.test(k)), Object.keys(CUST));
const dupR = await request('/api/customers', { method: 'POST', headers: MGR.headers, body: JSON.stringify({ branch_id: A1.id, name: 'Guest One Again', phone: CUST.phone }) });
dbCheck('2. the same phone returns the existing guest instead of duplicating them', dupR.status === 200 && dupR.body.existed === true && dupR.body.customer.id === CUST.id, dupR.body);
const creditDup = await request('/api/credit/customers', { method: 'POST', headers: CASHIER.headers, body: JSON.stringify({ branch_id: A1.id, name: 'Guest One via credit', phone: CUST.phone }) });
dbCheck('2b. reaching the guest through the credit surface returns the SAME record, not a second one', creditDup.body?.customer?.id === CUST.id && creditDup.body?.existed === true, creditDup.body);

const order1 = await newOrder(T1);
dbCheck('3. a fresh order starts with no discount', money(order1.discount) === 0 && money(order1.final_amount) === 11000, order1);
const attach = await request(`/api/orders/${order1.id}/customer`, { method: 'POST', headers: W, body: JSON.stringify({ customer_id: CUST.id }) });
expect('4. attach the customer from the waiter POS', attach.status, 200, attach.body);
dbCheck('4b. ATTACHING A CUSTOMER NEVER CHANGES THE PRICE -- no automatic discount exists', attach.body.order.customer_id === CUST.id && money(attach.body.order.discount) === 0 && money(attach.body.order.final_amount) === 11000, attach.body.order);

// ================================================================== 5-9. APPLYING A MANUAL DISCOUNT
const options = await request('/api/orders/discount-options', { headers: CASHIER.headers });
expect('5. the POS reads its discount presets from configuration', options.status, 200, options.body);
dbCheck('5b. presets and the ceiling come from system settings, not from UI code', options.body.presets.join(',') === '10,15,20,30' && options.body.max_percent === '30', options.body);

mustDeny('6. exactly one of percent or amount is required', await request(`/api/orders/${order1.id}/discount`, { method: 'POST', headers: CASHIER.headers, body: JSON.stringify({ percent: '10', amount: '5.00' }) }));
mustDeny('6b. a nonsense percentage is refused', await request(`/api/orders/${order1.id}/discount`, { method: 'POST', headers: CASHIER.headers, body: JSON.stringify({ percent: 'lots' }) }));
const overLimit = await request(`/api/orders/${order1.id}/discount`, { method: 'POST', headers: CASHIER.headers, body: JSON.stringify({ percent: '50' }) });
mustDeny('7. a discount above the configured ceiling is refused for a cashier', overLimit);
ok('7b. the denial names the configured ceiling', overLimit.body?.code === 'DISCOUNT_EXCEEDS_LIMIT' && overLimit.body?.details?.max_percent === '30', overLimit.body);
const overAllowed = await request(`/api/orders/${order1.id}/discount`, { method: 'POST', headers: MGR.headers, body: JSON.stringify({ percent: '50', reason: 'VIP' }) });
expect('7c. a manager holding the override permission may exceed it', overAllowed.status, 201, overAllowed.body);
expect('7d. remove it again', (await request(`/api/orders/${order1.id}/discount`, { method: 'DELETE', headers: MGR.headers })).status, 200);

const disc = await request(`/api/orders/${order1.id}/discount`, { method: 'POST', headers: CASHIER.headers, body: JSON.stringify({ percent: '15', reason: 'Regular guest' }) });
expect('8. the cashier grants a 15% discount', disc.status, 201, disc.body);
dbCheck('8b. THE SERVER computes the amount from the real subtotal: 15% of 100.00 = 15.00', money(disc.body.discount.amount) === 1500 && money(disc.body.discount.base_amount) === 10000, disc.body.discount);
dbCheck('8c. the order is recomputed: 100.00 - 15.00 + 10.00 service = 95.00', money(disc.body.order.discount) === 1500 && money(disc.body.order.final_amount) === 9500, disc.body.order);
dbCheck('9. the full snapshot is recorded: customer, percent, amount, employee, role, reason, timestamp',
  disc.body.discount.customer_id === CUST.id && String(disc.body.discount.percent) === '15' && disc.body.discount.applied_by_user_id === CASHIER.id && disc.body.discount.applied_by_role === 'CASHIER' && disc.body.discount.source === 'CASHIER_POS' && disc.body.discount.reason === 'Regular guest' && Boolean(disc.body.discount.created_at), disc.body.discount);
mustDeny('9b. a second discount on the same order is refused while one is active', await request(`/api/orders/${order1.id}/discount`, { method: 'POST', headers: CASHIER.headers, body: JSON.stringify({ percent: '10' }) }));

// ================================================================== 10-12. REMOVAL IS SOFT AND AUDITED
const removed = await request(`/api/orders/${order1.id}/discount`, { method: 'DELETE', headers: CASHIER.headers });
expect('10. remove the discount', removed.status, 200, removed.body);
dbCheck('10b. the order returns to its undiscounted total', money(removed.body.order.discount) === 0 && money(removed.body.order.final_amount) === 11000, removed.body.order);
const history = await request(`/api/orders/${order1.id}/discounts`, { headers: MGR.headers });
dbCheck('11. nothing is deleted -- the granted discounts stay on the record, marked REMOVED', history.body.discounts.length === 2 && history.body.discounts.every(d => d.status === 'REMOVED'), history.body.discounts.map(d => [d.percent, d.status]));
mustDeny('12. removing when there is nothing active is refused', await request(`/api/orders/${order1.id}/discount`, { method: 'DELETE', headers: CASHIER.headers }));

// ================================================================== 13-16. A REAL PAID, DISCOUNTED ORDER
const order2 = await newOrder(T2, 2); // subtotal 200.00
await request(`/api/orders/${order2.id}/customer`, { method: 'POST', headers: W, body: JSON.stringify({ customer_id: CUST.id }) });
const disc2 = await request(`/api/orders/${order2.id}/discount`, { method: 'POST', headers: W, body: JSON.stringify({ percent: '20', reason: 'Waiter granted' }) });
expect('13. a waiter may grant a discount on their own order', disc2.status, 201, disc2.body);
dbCheck('13b. and it is recorded against the WAITER role and the waiter POS source', disc2.body.discount.applied_by_role === 'WAITER' && disc2.body.discount.source === 'WAITER_POS' && disc2.body.discount.applied_by_user_id === WAITER.id, disc2.body.discount);
dbCheck('13c. 200.00 - 40.00 + 20.00 service = 180.00', money(disc2.body.order.discount) === 4000 && money(disc2.body.order.final_amount) === 18000, disc2.body.order);

await request(`/api/orders/${order2.id}/confirm`, { method: 'POST', headers: MGR.headers });
const t2 = (await request(`/api/kds?branch_id=${A1.id}`, { headers: MGR.headers })).body.tickets.find(x => x.order_id === order2.id);
await request(`/api/kds/${t2.id}/status`, { method: 'POST', headers: MGR.headers, body: JSON.stringify({ status: 'PREPARING' }) });
await request(`/api/kds/${t2.id}/status`, { method: 'POST', headers: MGR.headers, body: JSON.stringify({ status: 'READY' }) });
const order2Ready = await orderOf(order2.id);
const pay2 = await request('/api/payments', { method: 'POST', headers: { ...CASHIER.headers, 'x-pos-session-token': posToken, 'idempotency-key': `s343-pay2-${stamp}` }, body: JSON.stringify({ order_id: order2.id, method: 'CASH', amount: order2Ready.final_amount }) });
expect('14. the guest pays the DISCOUNTED total', pay2.status, 201, pay2.body);
dbCheck('14b. the payment equals the discounted amount, not the list price', money(pay2.body.payment.amount) === 18000, pay2.body.payment);

mustDeny('15. a settled order can never be discounted -- old receipts never change', await request(`/api/orders/${order2.id}/discount`, { method: 'POST', headers: CASHIER.headers, body: JSON.stringify({ percent: '10' }) }));
mustDeny('15b. nor can its discount be removed afterwards', await request(`/api/orders/${order2.id}/discount`, { method: 'DELETE', headers: CASHIER.headers }));
mustDeny('15c. nor can its customer be changed', await request(`/api/orders/${order2.id}/customer`, { method: 'POST', headers: CASHIER.headers, body: JSON.stringify({ customer_id: null }) }));
const order2After = await orderOf(order2.id);
dbCheck('16. the settled order is exactly as it was paid', money(order2After.discount) === 4000 && money(order2After.final_amount) === 18000, order2After);

// ================================================================== 17-19. CONSISTENCY WITH ITEM REMOVAL
const order3 = await newOrder(T3, 4); // subtotal 400.00
const disc3 = await request(`/api/orders/${order3.id}/discount`, { method: 'POST', headers: CASHIER.headers, body: JSON.stringify({ percent: '10' }) });
expect('17. discount an order of 4 items', disc3.status, 201, disc3.body);
dbCheck('17b. 400.00 - 40.00 + 40.00 service = 400.00', money(disc3.body.order.final_amount) === 40000, disc3.body.order);
const order3Full = await orderOf(order3.id);
const removal = await request(`/api/orders/${order3.id}/items/${order3Full.items[0].id}/removal-request`, { method: 'POST', headers: W, body: JSON.stringify({ quantity: 2, reason: 'guest changed mind' }) });
expect('18. request removal of 2 of the 4 items', removal.status, 201, removal.body);
const approved = await request(`/api/orders/removal-requests/${removal.body.approval.id}/approve`, { method: 'POST', headers: MGR.headers, body: '{}' });
expect('18b. manager approves', approved.status, 200, approved.body);
dbCheck('19. a PERCENTAGE discount follows the new subtotal: 200.00 - 20.00 + 20.00 = 200.00', money(approved.body.order.subtotal) === 20000 && money(approved.body.order.discount) === 2000 && money(approved.body.order.final_amount) === 20000, approved.body.order);

const order4 = await newOrder(T4, 1);
const fixed = await request(`/api/orders/${order4.id}/discount`, { method: 'POST', headers: CASHIER.headers, body: JSON.stringify({ amount: '25.00', reason: 'fixed' }) });
expect('20. a fixed-amount discount is accepted', fixed.status, 201, fixed.body);
dbCheck('20b. 100.00 - 25.00 + 10.00 = 85.00, and no percentage is invented for it', money(fixed.body.order.final_amount) === 8500 && fixed.body.discount.percent === null, fixed.body);
mustDeny('20c. a discount larger than the subtotal is refused', await request(`/api/orders/${(await newOrder(T1)).id}/discount`, { method: 'POST', headers: CASHIER.headers, body: JSON.stringify({ amount: '5000.00' }) }));

// ================================================================== 21-23. RBAC / ISOLATION / AUDIT
mustDeny('21. branch isolation: a branch A2 manager cannot discount a branch A1 order', await request(`/api/orders/${order4.id}/discount`, { method: 'POST', headers: MGR_A2.headers, body: JSON.stringify({ percent: '10' }) }));
mustDeny('21b. nor read the branch A1 customer list', await request(`/api/customers?branch_id=${A1.id}`, { headers: MGR_A2.headers }));
mustDeny('21c. a customer from another branch cannot be attached', await request(`/api/orders/${order4.id}/customer`, { method: 'POST', headers: MGR.headers, body: JSON.stringify({ customer_id: 'cust_does_not_exist' }) }));

const custDetail = await request(`/api/customers/${CUST.id}`, { headers: MGR.headers });
dbCheck('22. the customer record shows their real orders and the discounts they were granted', custDetail.body.orders.length >= 2 && custDetail.body.discounts.length >= 2, { orders: custDetail.body.orders.length, discounts: custDetail.body.discounts.length });

const audit = (await request(`/api/audit?branch_id=${A1.id}&limit=400`, { headers: OWNER })).body.logs || [];
const actions = new Set(audit.map(a => a.action));
dbCheck('23. attaching a customer, granting and removing a discount are all audited', ['ORDER_CUSTOMER_ATTACHED', 'ORDER_DISCOUNT_APPLIED', 'ORDER_DISCOUNT_REMOVED'].every(a => actions.has(a)), [...actions].filter(a => a.startsWith('ORDER_DISCOUNT') || a.startsWith('ORDER_CUSTOMER')));
const applyAudit = audit.find(a => a.action === 'ORDER_DISCOUNT_APPLIED' && a.entity_id === disc.body.discount.id);
dbCheck('23b. the audit entry carries the granting employee, their role and the reason', applyAudit && JSON.stringify(applyAudit.new_values).includes('CASHIER') && JSON.stringify(applyAudit.new_values).includes('Regular guest'), applyAudit?.new_values);

console.log(`\nStage 34.3 discounts E2E: ${counts.runtime} HTTP calls, ${counts.denials} denials, ${counts.dbPost} DB post-conditions`);
if (failures.length) { console.error(`\nFAILURES (${failures.length}):`); for (const f of failures) console.error(' - ' + f); process.exit(1); }
console.log('ALL STAGE 34.3 DISCOUNT CHECKS PASSED');
