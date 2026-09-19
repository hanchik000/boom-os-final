// BOOM OS -- Stage 34.4: fresh-DB E2E proof of SPLIT BILL / separate checks.
//
// Proves the architecture TABLE -> ORDER -> BILL/SPLIT -> ORDER ITEMS -> PAYMENTS: one order can
// carry several bills, each with its own guest, discount, payment method and settlement, while the
// ORDER stays the single sale -- so revenue is counted once (Sales 500, Orders 1, Bills 3), stock is
// consumed once, and the bills always sum back to the order exactly.
//
// Requires an empty database. Usage: node tests/stage34_4_split_bill_e2e.mjs
const base = `http://127.0.0.1:${process.env.BOOM_OS_PORT || 3000}`;
const ownerPassword = process.env.STAGE344_OWNER_PASSWORD || 'BoomStage344Owner!';
const staffPassword = 'Stage344StaffPass12345!';
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

const owner = await request('/api/auth/bootstrap', { method: 'POST', body: JSON.stringify({ full_name: 'S344 Owner', email: `s344owner-${stamp}@boom.local`, password: ownerPassword }) });
expect('bootstrap owner', owner.status, 201, owner.body);
const OWNER = { authorization: `Bearer ${owner.body.token}` };

async function makeFranchise(tag) {
  const f = await request('/api/franchises', { method: 'POST', headers: OWNER, body: JSON.stringify({ name: `S344 F${tag}`, code: `S344${tag}${stamp % 100000}`, legal_name: `S344${tag} LLC`, contact_name: 'x', phone: `+9932011${tag}`, email: `s344${tag}-${stamp}@boom.local`, address: 'x' }) });
  expect(`create franchise ${tag}`, f.status, 201, f.body); return f.body.franchise.id;
}
async function makeBranch(tag, franchiseId) {
  const branch = await request('/api/branches', { method: 'POST', headers: OWNER, body: JSON.stringify({ name: `S344 B${tag}`, code: `S344${tag}${stamp % 100000}`, address: 'x', phone: `+9932012${tag}`, franchise_id: franchiseId }) });
  expect(`branch ${tag}`, branch.status, 201, branch.body);
  const id = branch.body.branch.id;
  await request(`/api/franchises/${franchiseId}/branches/${id}`, { method: 'POST', headers: OWNER, body: '{}' });
  return { tag, id, franchiseId };
}
async function makeUser(label, branch, allowed, roles) {
  const email = `${label}-${stamp}@boom.local`.toLowerCase();
  const u = await request('/api/users', { method: 'POST', headers: OWNER, body: JSON.stringify({ full_name: `${label} Name`, email, phone: `+9936${Math.floor(Math.random() * 1000000)}`, password: staffPassword, branch_id: branch, roles, allowed_branches: allowed }) });
  expect(`create user ${label}`, u.status, 201, u.body);
  const login = await request('/api/auth/login', { method: 'POST', body: JSON.stringify({ login: email, password: staffPassword }) });
  expect(`login ${label}`, login.status, 200, login.body);
  return { label, email, id: u.body.user.id, headers: { authorization: `Bearer ${login.body.token}` } };
}

const FA = await makeFranchise('A');
const A1 = await makeBranch('A1', FA);
const A2 = await makeBranch('A2', FA);
const MGR = await makeUser('m344a1', A1.id, [A1.id], ['BRANCH_MANAGER']);
const MGR_A2 = await makeUser('m344a2', A2.id, [A2.id], ['BRANCH_MANAGER']);
const CASHIER = await makeUser('c344a1', A1.id, [A1.id], ['CASHIER']);
const WAITER = await makeUser('w344a1', A1.id, [A1.id], ['WAITER']);

// Service charge OFF, so the bill arithmetic in this test is purely about the split itself.
expect('service charge to 0%', (await request(`/api/service-charge/${A1.id}`, { method: 'PUT', headers: MGR.headers, body: JSON.stringify({ percent: '0.00', categories: [] }) })).status, 201);

const cat = await request('/api/menu/categories', { method: 'POST', headers: MGR.headers, body: JSON.stringify({ branch_id: A1.id, name_ru: 'Cat', name_tk: 'Cat', sort_order: 0 }) });
const mk = async (sku, price) => (await request('/api/menu/items', { method: 'POST', headers: MGR.headers, body: JSON.stringify({ branch_id: A1.id, category_id: cat.body.category.id, sku, name_ru: sku, name_tk: sku, price, sort_order: 0 }) })).body.item;
const ITEM_A = await mk(`S344A-${stamp}`, '180.00');
const ITEM_B = await mk(`S344B-${stamp}`, '200.00');
const ITEM_C = await mk(`S344C-${stamp}`, '120.00');

// Stock + recipe on ITEM_A, so we can prove consumption happens ONCE for a split order.
const beef = (await request('/api/inventory/items', { method: 'POST', headers: MGR.headers, body: JSON.stringify({ branch_id: A1.id, sku: `BEEF344-${stamp}`, name: 'Beef', unit: 'g', reorder_point: '10' }) })).body.item;
const supplier = (await request('/api/inventory/suppliers', { method: 'POST', headers: MGR.headers, body: JSON.stringify({ branch_id: A1.id, name: 'S344 Supplier' }) })).body.supplier;
const purchase = await request('/api/inventory/purchases', { method: 'POST', headers: MGR.headers, body: JSON.stringify({ branch_id: A1.id, supplier_id: supplier.id, items: [{ inventory_item_id: beef.id, quantity: '10000', unit_cost: '0.02' }] }) });
await request(`/api/inventory/purchases/${purchase.body.purchase.id}/receive`, { method: 'POST', headers: MGR.headers });
await request('/api/inventory/recipes', { method: 'POST', headers: MGR.headers, body: JSON.stringify({ branch_id: A1.id, menu_item_id: ITEM_A.id, name: 'A Recipe', yield_qty: '1', ingredients: [{ inventory_item_id: beef.id, quantity: '100' }] }) });

const area = await request('/api/tables/areas', { method: 'POST', headers: MGR.headers, body: JSON.stringify({ branch_id: A1.id, name: 'Hall', sort_order: 0 }) });
async function makeTable(code) { return (await request('/api/tables', { method: 'POST', headers: MGR.headers, body: JSON.stringify({ branch_id: A1.id, area_id: area.body.area.id, code, seats: 6 }) })).body.table; }
const T1 = await makeTable(`T344A-${stamp % 10000}`), T2 = await makeTable(`T344B-${stamp % 10000}`), T3 = await makeTable(`T344C-${stamp % 10000}`);

expect('issue waiter code', (await request(`/api/waiters/${WAITER.id}/code`, { method: 'POST', headers: MGR.headers, body: JSON.stringify({ code: '9471' }) })).status, 201);
const wAuth = await request('/api/waiters/authenticate-code', { method: 'POST', body: JSON.stringify({ code: '9471', deviceId: 's344-dev' }) });
const W = { 'x-waiter-session': wAuth.body.session.token };
const unlockR = await request('/api/operator-pos/unlock', { method: 'POST', headers: CASHIER.headers, body: JSON.stringify({ password: staffPassword, branch_id: A1.id, device_id: 's344-cash' }) });
expect('CASHIER POS unlock', unlockR.status, 200, unlockR.body);
const posToken = unlockR.body.session_token;
expect('open shift', (await request('/api/cash-shifts', { method: 'POST', headers: CASHIER.headers, body: JSON.stringify({ branch_id: A1.id, opening_cash: '50.00' }) })).status, 201);

async function newOrder(table, items) {
  const o = await request('/api/orders', { method: 'POST', headers: { ...W, 'idempotency-key': `s344-${Date.now()}-${Math.random()}` }, body: JSON.stringify({ order_type: 'DINE_IN', source: 'POS', table_id: table.id, items }) });
  expect('create order', o.status, 201, o.body);
  return o.body.order;
}
async function orderOf(id) { return (await request(`/api/orders/${id}`, { headers: MGR.headers })).body.order; }
async function billsOf(id) { return (await request(`/api/orders/${id}/bills`, { headers: MGR.headers })).body; }
async function makeReady(order) {
  await request(`/api/orders/${order.id}/confirm`, { method: 'POST', headers: MGR.headers });
  const t = (await request(`/api/kds?branch_id=${A1.id}`, { headers: MGR.headers })).body.tickets.find(x => x.order_id === order.id);
  await request(`/api/kds/${t.id}/status`, { method: 'POST', headers: MGR.headers, body: JSON.stringify({ status: 'PREPARING' }) });
  await request(`/api/kds/${t.id}/status`, { method: 'POST', headers: MGR.headers, body: JSON.stringify({ status: 'READY' }) });
}
async function stock() { return Number((await request(`/api/inventory/items?branch_id=${A1.id}`, { headers: MGR.headers })).body.items.find(i => i.id === beef.id).current_stock); }

// ================================================================== 1-4. THE WORKED EXAMPLE: 500 = 180 + 200 + 120
const order1 = await newOrder(T1, [{ menu_item_id: ITEM_A.id, quantity: 1 }, { menu_item_id: ITEM_B.id, quantity: 1 }, { menu_item_id: ITEM_C.id, quantity: 1 }]);
dbCheck('1. the order totals 500.00', money(order1.final_amount) === 50000, order1);
const before = await billsOf(order1.id);
dbCheck('1b. an unsplit order has no bills at all -- the original behaviour is untouched', before.split_mode === 'NONE' && before.bills.length === 0, before);

mustDeny('2. an item cannot be moved before the order is split', await request(`/api/orders/${order1.id}/bills/move-item`, { method: 'POST', headers: W, body: JSON.stringify({ order_item_id: (await orderOf(order1.id)).items[0].id, bill_id: null }) }));
mustDeny('2b. a split of fewer than two bills is refused', await request(`/api/orders/${order1.id}/bills/split`, { method: 'POST', headers: W, body: JSON.stringify({ mode: 'ITEMS', count: 1 }) }));
mustDeny('2c. an unknown split mode is refused', await request(`/api/orders/${order1.id}/bills/split`, { method: 'POST', headers: W, body: JSON.stringify({ mode: 'BY_VIBES', count: 3 }) }));

const split = await request(`/api/orders/${order1.id}/bills/split`, { method: 'POST', headers: W, body: JSON.stringify({ mode: 'ITEMS', count: 3 }) });
expect('3. split the order into three separate checks', split.status, 201, split.body);
dbCheck('3b. three OPEN bills, numbered 1..3, all empty', split.body.bills.length === 3 && split.body.bills.every(b => b.status === 'OPEN' && money(b.final_amount) === 0) && split.body.bills.map(b => b.bill_number).join() === '1,2,3', split.body.bills);
mustDeny('3c. an already-split order cannot be split again', await request(`/api/orders/${order1.id}/bills/split`, { method: 'POST', headers: W, body: JSON.stringify({ mode: 'EQUAL', count: 2 }) }));

const items1 = (await orderOf(order1.id)).items;
const billIds = split.body.bills.map(b => b.id);
const pick = sku => items1.find(i => i.title_snapshot === sku).id;
for (const [sku, billIdx] of [[ITEM_A.id && `S344A-${stamp}`, 0], [`S344B-${stamp}`, 1], [`S344C-${stamp}`, 2]]) {
  const r = await request(`/api/orders/${order1.id}/bills/move-item`, { method: 'POST', headers: W, body: JSON.stringify({ order_item_id: pick(sku), bill_id: billIds[billIdx] }) });
  expect(`4. move ${sku} to bill ${billIdx + 1}`, r.status, 200, r.body);
}
const afterMove = await billsOf(order1.id);
dbCheck('4b. THE WORKED EXAMPLE: Bill A = 180.00, Bill B = 200.00, Bill C = 120.00', afterMove.bills.map(b => money(b.final_amount)).join() === '18000,20000,12000', afterMove.bills.map(b => b.final_amount));
dbCheck('4c. and the ORDER is still one sale of 500.00 -- the bills partition it, they do not copy it', money(afterMove.order_final_amount) === 50000 && afterMove.bills.reduce((s, b) => s + money(b.final_amount), 0) === 50000, { order: afterMove.order_final_amount, bills: afterMove.bills.map(b => b.final_amount) });
dbCheck('4d. nothing is left unassigned', afterMove.unassigned_items.length === 0, afterMove.unassigned_items);

// ================================================================== 5-7. PER-BILL GUEST AND DISCOUNT
const cust = (await request('/api/customers', { method: 'POST', headers: MGR.headers, body: JSON.stringify({ branch_id: A1.id, name: 'Split Guest', phone: `+99362${stamp % 1000000}` }) })).body.customer;
const attach = await request(`/api/orders/${order1.id}/bills/${billIds[1]}/customer`, { method: 'POST', headers: W, body: JSON.stringify({ customer_id: cust.id }) });
expect('5. attach a guest to bill B only', attach.status, 200, attach.body);
dbCheck('5b. only that bill carries the guest, and its price is unchanged', attach.body.bills[1].customer_id === cust.id && !attach.body.bills[0].customer_id && money(attach.body.bills[1].final_amount) === 20000, attach.body.bills.map(b => [b.bill_number, b.customer_id, b.final_amount]));

mustDeny('6. a split order cannot be discounted at order level', await request(`/api/orders/${order1.id}/discount`, { method: 'POST', headers: CASHIER.headers, body: JSON.stringify({ percent: '10' }) }));
const billDisc = await request(`/api/orders/${order1.id}/discount`, { method: 'POST', headers: CASHIER.headers, body: JSON.stringify({ bill_id: billIds[1], percent: '10', reason: 'Bill B guest' }) });
expect('6b. but a single separate check can be', billDisc.status, 201, billDisc.body);
const afterDisc = await billsOf(order1.id);
dbCheck('7. the discount lands on that bill only: B = 200.00 - 20.00 = 180.00, A and C untouched', afterDisc.bills.map(b => money(b.final_amount)).join() === '18000,18000,12000', afterDisc.bills.map(b => b.final_amount));
dbCheck('7b. and the ORDER reflects it exactly once: 500.00 - 20.00 = 480.00', money(afterDisc.order_final_amount) === 48000 && afterDisc.bills.reduce((s, b) => s + money(b.final_amount), 0) === 48000, { order: afterDisc.order_final_amount, bills: afterDisc.bills.map(b => b.final_amount) });

// ================================================================== 8-12. PAYING THE BILLS
await makeReady(order1);
const stockBefore = await stock();
mustDeny('8. a split order cannot be paid as a whole', await request('/api/payments', { method: 'POST', headers: { ...CASHIER.headers, 'x-pos-session-token': posToken, 'idempotency-key': `s344-whole-${stamp}` }, body: JSON.stringify({ order_id: order1.id, method: 'CASH', amount: '480.00' }) }));
mustDeny('8b. nor can a bill be paid with the wrong amount', await request('/api/payments', { method: 'POST', headers: { ...CASHIER.headers, 'x-pos-session-token': posToken, 'idempotency-key': `s344-wrong-${stamp}` }, body: JSON.stringify({ order_id: order1.id, bill_id: billIds[0], method: 'CASH', amount: '100.00' }) }));

const payA = await request('/api/payments', { method: 'POST', headers: { ...CASHIER.headers, 'x-pos-session-token': posToken, 'idempotency-key': `s344-A-${stamp}` }, body: JSON.stringify({ order_id: order1.id, bill_id: billIds[0], method: 'CASH', amount: '180.00' }) });
expect('9. bill A pays cash', payA.status, 201, payA.body);
dbCheck('9b. the payment is linked to its bill', payA.body.payment.bill_id === billIds[0], payA.body.payment);
const midOrder = await orderOf(order1.id);
dbCheck('10. the ORDER is NOT completed while other bills are open, and no stock was consumed yet', midOrder.status === 'READY' && (await stock()) === stockBefore, { status: midOrder.status, stock: await stock() });
mustDeny('10b. a paid bill cannot be paid twice', await request('/api/payments', { method: 'POST', headers: { ...CASHIER.headers, 'x-pos-session-token': posToken, 'idempotency-key': `s344-A2-${stamp}` }, body: JSON.stringify({ order_id: order1.id, bill_id: billIds[0], method: 'CASH', amount: '180.00' }) }));
mustDeny('10c. nor can its items be moved afterwards', await request(`/api/orders/${order1.id}/bills/move-item`, { method: 'POST', headers: W, body: JSON.stringify({ order_item_id: pick(`S344A-${stamp}`), bill_id: billIds[2] }) }));
mustDeny('10d. nor can the order be merged back once a bill is paid', await request(`/api/orders/${order1.id}/bills/merge`, { method: 'POST', headers: W, body: '{}' }));

const payB = await request('/api/payments', { method: 'POST', headers: { ...CASHIER.headers, 'x-pos-session-token': posToken, 'idempotency-key': `s344-B-${stamp}` }, body: JSON.stringify({ order_id: order1.id, bill_id: billIds[1], method: 'CARD', amount: '180.00' }) });
expect('11. bill B pays by card -- each bill chooses its own method', payB.status, 201, payB.body);
const payC = await request('/api/payments', { method: 'POST', headers: { ...CASHIER.headers, 'x-pos-session-token': posToken, 'idempotency-key': `s344-C-${stamp}` }, body: JSON.stringify({ order_id: order1.id, bill_id: billIds[2], method: 'CASH', amount: '120.00' }) });
expect('11b. bill C pays cash', payC.status, 201, payC.body);

const doneOrder = await orderOf(order1.id);
dbCheck('12. only when the LAST bill is settled does the order complete', doneOrder.status === 'COMPLETED', doneOrder);
dbCheck('12b. and stock is consumed EXACTLY ONCE for the whole order (100g, not 100g per bill)', stockBefore - (await stock()) === 100, { before: stockBefore, after: await stock() });
const payments = (await request(`/api/payments?branch_id=${A1.id}`, { headers: MGR.headers })).body.payments.filter(p => p.order_id === order1.id);
dbCheck('12c. NO DOUBLE COUNTING: 1 order, 3 bills, 3 payments summing to the order total', payments.length === 3 && payments.reduce((s, p) => s + money(p.amount), 0) === 48000, payments.map(p => p.amount));
const finalBills = await billsOf(order1.id);
dbCheck('12d. every bill is PAID and closed', finalBills.bills.every(b => b.status === 'PAID' && b.closed_at), finalBills.bills.map(b => [b.bill_number, b.status]));

// ================================================================== 13-16. EQUAL SPLIT, EXACT TO THE CENT
const order2 = await newOrder(T2, [{ menu_item_id: ITEM_C.id, quantity: 1 }]); // 120.01 is not possible; use 120.00 / 7
const splitEq = await request(`/api/orders/${order2.id}/bills/split`, { method: 'POST', headers: W, body: JSON.stringify({ mode: 'EQUAL', count: 7 }) });
expect('13. split 120.00 equally between 7 guests', splitEq.status, 201, splitEq.body);
const eqBills = splitEq.body.bills;
dbCheck('13b. the shares sum back to the order EXACTLY -- not a cent invented or lost', eqBills.reduce((s, b) => s + money(b.final_amount), 0) === 12000, eqBills.map(b => b.final_amount));
dbCheck('13c. and they differ by at most one cent', Math.max(...eqBills.map(b => money(b.final_amount))) - Math.min(...eqBills.map(b => money(b.final_amount))) <= 1, eqBills.map(b => b.final_amount));
mustDeny('14. items cannot be moved in an EQUAL split', await request(`/api/orders/${order2.id}/bills/move-item`, { method: 'POST', headers: W, body: JSON.stringify({ order_item_id: (await orderOf(order2.id)).items[0].id, bill_id: eqBills[0].id }) }));
mustDeny('14b. an EQUAL split is not discounted per bill', await request(`/api/orders/${order2.id}/discount`, { method: 'POST', headers: CASHIER.headers, body: JSON.stringify({ bill_id: eqBills[0].id, percent: '10' }) }));

const merged = await request(`/api/orders/${order2.id}/bills/merge`, { method: 'POST', headers: W, body: '{}' });
expect('15. merging back is safe while nothing is paid', merged.status, 200, merged.body);
dbCheck('15b. the order returns to a single settlement with its total intact', merged.body.split_mode === 'NONE' && merged.body.bills.length === 0 && money((await orderOf(order2.id)).final_amount) === 12000, await orderOf(order2.id));
await makeReady(order2);
const payMerged2 = await request('/api/payments', { method: 'POST', headers: { ...CASHIER.headers, 'x-pos-session-token': posToken, 'idempotency-key': `s344-M2-${stamp}` }, body: JSON.stringify({ order_id: order2.id, method: 'CASH', amount: '120.00' }) });
expect('16. a merged order pays as an ordinary unsplit order', payMerged2.status, 201, payMerged2.body);
dbCheck('16b. with no bill attached to the payment', payMerged2.body.payment.bill_id === null, payMerged2.body.payment);

// ================================================================== 17-20. PARTIAL LINE MOVE, VOID, RBAC
const order3 = await newOrder(T3, [{ menu_item_id: ITEM_B.id, quantity: 4 }]); // 800.00
const split3 = await request(`/api/orders/${order3.id}/bills/split`, { method: 'POST', headers: W, body: JSON.stringify({ mode: 'ITEMS', count: 2 }) });
const b3 = split3.body.bills.map(b => b.id);
const line = (await orderOf(order3.id)).items[0];
const partial = await request(`/api/orders/${order3.id}/bills/move-item`, { method: 'POST', headers: W, body: JSON.stringify({ order_item_id: line.id, bill_id: b3[0], quantity: 1 }) });
expect('17. move ONE of four units onto the first bill', partial.status, 200, partial.body);
const after3 = await billsOf(order3.id);
dbCheck('17b. the line is split at the same unit price: 200.00 on bill 1, 600.00 still unassigned', money(after3.bills[0].final_amount) === 20000 && after3.unassigned_items.reduce((s, i) => s + money(i.subtotal), 0) === 60000, { bill1: after3.bills[0].final_amount, unassigned: after3.unassigned_items.map(i => i.subtotal) });
dbCheck('17c. and the order total is unchanged by the move: still 800.00', money(after3.order_final_amount) === 80000, after3.order_final_amount);
mustDeny('18. a bill holding items cannot be voided', await request(`/api/orders/${order3.id}/bills/${b3[0]}`, { method: 'DELETE', headers: W }));
const voided = await request(`/api/orders/${order3.id}/bills/${b3[1]}`, { method: 'DELETE', headers: W });
expect('18b. an empty bill can be', voided.status, 200, voided.body);
dbCheck('18c. it is voided, not deleted, and disappears from the open list', voided.body.bills.length === 1, voided.body.bills.map(b => b.bill_number));

mustDeny('19. branch isolation: a branch A2 manager cannot split a branch A1 order', await request(`/api/orders/${order3.id}/bills/split`, { method: 'POST', headers: MGR_A2.headers, body: JSON.stringify({ mode: 'ITEMS', count: 2 }) }));
mustDeny('19b. nor read its bills', await request(`/api/orders/${order3.id}/bills`, { headers: MGR_A2.headers }));
mustDeny('19c. a settled order can no longer be split', await request(`/api/orders/${order1.id}/bills/split`, { method: 'POST', headers: W, body: JSON.stringify({ mode: 'ITEMS', count: 2 }) }));

const audit = (await request(`/api/audit?branch_id=${A1.id}&limit=400`, { headers: OWNER })).body.logs || [];
const actions = new Set(audit.map(a => a.action));
dbCheck('20. splitting, moving, voiding and merging are all audited', ['ORDER_SPLIT', 'ORDER_BILL_ITEM_MOVED', 'ORDER_BILL_VOIDED', 'ORDER_BILLS_MERGED'].every(a => actions.has(a)), [...actions].filter(a => a.startsWith('ORDER_BILL') || a.startsWith('ORDER_SPLIT')));

console.log(`\nStage 34.4 split bill E2E: ${counts.runtime} HTTP calls, ${counts.denials} denials, ${counts.dbPost} DB post-conditions`);
if (failures.length) { console.error(`\nFAILURES (${failures.length}):`); for (const f of failures) console.error(' - ' + f); process.exit(1); }
console.log('ALL STAGE 34.4 SPLIT BILL CHECKS PASSED');
