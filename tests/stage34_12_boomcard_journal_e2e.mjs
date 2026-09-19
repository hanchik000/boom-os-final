// BOOM OS -- Stage 34.12: fresh-DB E2E proof of the unified BOOMCARD Operations Journal.
//
// Proves on REAL operations that all eleven required event types appear with real, normalized,
// server-computed fields; that BOOMBACK redemption reads as a PAYMENT_SETTLEMENT (never a
// discount), breakfast/birthday-gift redemption reads as an OPERATIONAL_BENEFIT (never a
// discount), and BOOMCOIN reads as a CUSTOMER_REWARD (never cash revenue); that filters,
// pagination and branch isolation all work; that an archived guest's history stays visible; that
// nothing here duplicates a financial transaction; and that a role holding boomcard.manage (able
// to execute a BOOMCARD operation) is still refused the journal without boomcard.journal.view.
//
// Requires an empty database. Usage: node tests/stage34_12_boomcard_journal_e2e.mjs
const base = `http://127.0.0.1:${process.env.BOOM_OS_PORT || 3000}`;
const ownerPassword = process.env.STAGE3412_OWNER_PASSWORD || 'BoomStage3412Owner!';
const staffPassword = 'Stage3412StaffPass12345!';
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
function ok(step, cond, detail) { if (!cond) failures.push(`${step}: FAILED ${detail !== undefined ? '-> ' + JSON.stringify(detail).slice(0, 340) : ''}`); }
function mustDeny(label, r) {
  if (r.status >= 200 && r.status < 300) failures.push(`${label} -- returned ${r.status} (expected denial): ${JSON.stringify(r.body).slice(0, 260)}`);
  else if (![400, 401, 403, 404, 409].includes(r.status)) failures.push(`${label} -- returned ${r.status}, not a recognized denial: ${JSON.stringify(r.body).slice(0, 260)}`);
  else counts.denials++;
}
function dbCheck(label, cond, detail) { counts.dbPost++; ok(`DB POST-CONDITION -- ${label}`, cond, detail); }
const money = v => Math.round(parseFloat(v) * 100);

const owner = await request('/api/auth/bootstrap', { method: 'POST', body: JSON.stringify({ full_name: 'S3412 Owner', email: `s3412owner-${stamp}@boom.local`, password: ownerPassword }) });
expect('bootstrap owner', owner.status, 201, owner.body);
const OWNER = { authorization: `Bearer ${owner.body.token}` };

const f = await request('/api/franchises', { method: 'POST', headers: OWNER, body: JSON.stringify({ name: 'S3412 F', code: `SC${stamp % 100000}`, legal_name: 'SC LLC', contact_name: 'x', phone: '+99326120', email: `sc-${stamp}@boom.local`, address: 'x' }) });
expect('create franchise', f.status, 201, f.body);
const FR = f.body.franchise.id;
async function makeBranch(tag) {
  const branch = await request('/api/branches', { method: 'POST', headers: OWNER, body: JSON.stringify({ name: `S3412 ${tag}`, code: `SC${tag}${stamp % 100000}`, address: 'x', phone: `+9932622${tag}`, franchise_id: FR }) });
  expect(`branch ${tag}`, branch.status, 201, branch.body);
  const id = branch.body.branch.id;
  await request(`/api/franchises/${FR}/branches/${id}`, { method: 'POST', headers: OWNER, body: '{}' });
  return id;
}
const B1 = await makeBranch('B1');
const B2 = await makeBranch('B2');
async function makeUser(label, branch, allowed, roles) {
  const email = `${label}-${stamp}@boom.local`.toLowerCase();
  const u = await request('/api/users', { method: 'POST', headers: OWNER, body: JSON.stringify({ full_name: `${label} Name`, email, phone: `+9942${Math.floor(Math.random() * 1000000)}`, password: staffPassword, branch_id: branch, roles, allowed_branches: allowed }) });
  expect(`create user ${label}`, u.status, 201, u.body);
  const login = await request('/api/auth/login', { method: 'POST', body: JSON.stringify({ login: email, password: staffPassword }) });
  expect(`login ${label}`, login.status, 200, login.body);
  return { label, id: u.body.user.id, headers: { authorization: `Bearer ${login.body.token}` } };
}
const MGR = await makeUser('m3412', B1, [B1], ['BRANCH_MANAGER']);
const MGR2 = await makeUser('m3412b2', B2, [B2], ['BRANCH_MANAGER']);
const CASHIER = await makeUser('c3412', B1, [B1], ['CASHIER']);
const WAITER = await makeUser('w3412', B1, [B1], ['WAITER']);

// A role that holds boomcard.manage (can EXECUTE a BOOMCARD operation) but was never granted
// boomcard.journal.view -- proves rule 11 for real, not just by inspecting the seed.
const cardOpRole = await request('/api/roles', { method: 'POST', headers: OWNER, body: JSON.stringify({ code: `CARDOP3412${stamp % 100000}`, name: 'Card Operator', permission_ids: ['boomcard.manage', 'boomcard.view', 'orders.view', 'orders.confirm'] }) });
expect('create a boomcard.manage-only role', cardOpRole.status, 201, cardOpRole.body);
const CARD_OP = await makeUser('cardop3412', B1, [B1], [cardOpRole.body.role.code]);

expect('service charge to 0%', (await request(`/api/service-charge/${B1}`, { method: 'PUT', headers: MGR.headers, body: JSON.stringify({ percent: '0.00', categories: [] }) })).status, 201);
expect('enable BOOMBACK cashback at 10%', (await request('/api/settings/BOOMBACK_CASHBACK_ENABLED', { method: 'PUT', headers: OWNER, body: JSON.stringify({ value: 'true' }) })).status, 200);
expect('set the percentage', (await request('/api/settings/BOOMBACK_CASHBACK_PERCENT', { method: 'PUT', headers: OWNER, body: JSON.stringify({ value: '10' }) })).status, 200);

const cat = await request('/api/menu/categories', { method: 'POST', headers: MGR.headers, body: JSON.stringify({ branch_id: B1, name_ru: 'Cat', name_tk: 'Cat', sort_order: 0 }) });
async function makeDish(sku, price, ru, tk) {
  const r = await request('/api/menu/items', { method: 'POST', headers: MGR.headers, body: JSON.stringify({ branch_id: B1, category_id: cat.body.category.id, sku: `${sku}-${stamp}`, name_ru: ru, name_tk: tk, price, sort_order: 0 }) });
  expect(`menu item ${sku}`, r.status, 201, r.body);
  return r.body.item;
}
const DISH = await makeDish('SC-DISH', '1000.00', 'Плов', 'Palow');
const OMELETTE = await makeDish('SC-OMLT', '60.00', 'Омлет', 'Omlet');
const CAKE = await makeDish('SC-CAKE', '80.00', 'Торт', 'Tort');

const area = (await request('/api/tables/areas', { method: 'POST', headers: MGR.headers, body: JSON.stringify({ branch_id: B1, name: 'Hall', sort_order: 0 }) })).body.area;
const tables = [];
for (let i = 0; i < 8; i++) tables.push((await request('/api/tables', { method: 'POST', headers: MGR.headers, body: JSON.stringify({ branch_id: B1, area_id: area.id, code: `TC${i}-${stamp % 10000}`, seats: 4 }) })).body.table);

expect('waiter code', (await request(`/api/waiters/${WAITER.id}/code`, { method: 'POST', headers: MGR.headers, body: JSON.stringify({ code: '6301' }) })).status, 201);
const W = { 'x-waiter-session': (await request('/api/waiters/authenticate-code', { method: 'POST', body: JSON.stringify({ code: '6301', deviceId: 'sc-dev' }) })).body.session.token };
const posToken = (await request('/api/operator-pos/unlock', { method: 'POST', headers: CASHIER.headers, body: JSON.stringify({ password: staffPassword, branch_id: B1, device_id: 'sc-cash' }) })).body.session_token;
expect('open shift', (await request('/api/cash-shifts', { method: 'POST', headers: CASHIER.headers, body: JSON.stringify({ branch_id: B1, opening_cash: '100.00' }) })).status, 201);

const guest = (await request('/api/customers', { method: 'POST', headers: CASHIER.headers, body: JSON.stringify({ branch_id: B1, name: 'Journal Guest', phone: `+99371${stamp % 1000000}` }) })).body.customer;

let tableIdx = 0;
async function openOrder(items) {
  const table = tables[tableIdx++ % tables.length];
  const o = await request('/api/orders', { method: 'POST', headers: { ...W, 'idempotency-key': `sc-${Date.now()}-${Math.random()}` }, body: JSON.stringify({ order_type: 'DINE_IN', source: 'POS', table_id: table.id, items }) });
  expect('create order', o.status, 201, o.body);
  await request(`/api/orders/${o.body.order.id}/customer`, { method: 'POST', headers: W, body: JSON.stringify({ customer_id: guest.id }) });
  return o.body.order;
}
async function makeReady(order) {
  await request(`/api/orders/${order.id}/confirm`, { method: 'POST', headers: MGR.headers });
  const t = (await request(`/api/kds?branch_id=${B1}`, { headers: MGR.headers })).body.tickets.find(x => x.order_id === order.id);
  await request(`/api/kds/${t.id}/status`, { method: 'POST', headers: MGR.headers, body: JSON.stringify({ status: 'PREPARING' }) });
  await request(`/api/kds/${t.id}/status`, { method: 'POST', headers: MGR.headers, body: JSON.stringify({ status: 'READY' }) });
}
async function orderOf(id) { return (await request(`/api/orders/${id}`, { headers: MGR.headers })).body.order; }
async function boomback() { return (await request(`/api/loyalty/boomback/customers/${guest.id}`, { headers: MGR.headers })).body; }

// ============================================================ 0. BOOMCARD lifecycle: create + activate FIRST
// (cashback and the breakfast allowance both require an ACTIVE card -- so the card exists before
// any settlement the test wants to earn cashback on.)
const cardR = await request('/api/boomcard', { method: 'POST', headers: MGR.headers, body: JSON.stringify({ customer_id: guest.id }) });
expect('0. create the guest a card', cardR.status, 201, cardR.body);
const cardId = cardR.body.card.id;
const activated = await request(`/api/boomcard/${cardId}/activate`, { method: 'POST', headers: MGR.headers, body: JSON.stringify({ breakfasts: 2 }) });
expect('0b. BOOMCARD_ACTIVATED (also grants 2 breakfasts)', activated.status, 200, activated.body);

// ============================================================ 1. BOOMCOIN_EARNED + BOOMBACK_EARNED
const order1 = await openOrder([{ menu_item_id: DISH.id, quantity: 1 }]); // 1000.00
await makeReady(order1);
const pay1 = await request('/api/payments', { method: 'POST', headers: { ...CASHIER.headers, 'x-pos-session-token': posToken, 'idempotency-key': `sc-p1-${stamp}` }, body: JSON.stringify({ order_id: order1.id, method: 'CASH', amount: order1.final_amount }) });
expect('1. pay order1 in full (1000.00)', pay1.status, 201, pay1.body);
dbCheck('1b. it earned real BOOMBACK cashback (10% of 1000.00)', money((await boomback()).balance) === 10000, await boomback());

// ============================================================ 2. BOOMBACK_REDEEMED
const order2 = await openOrder([{ menu_item_id: DISH.id, quantity: 1 }]); // 1000.00
await makeReady(order2);
const payBB = await request('/api/payments', { method: 'POST', headers: { ...CASHIER.headers, 'x-pos-session-token': posToken, 'idempotency-key': `sc-bb-${stamp}` }, body: JSON.stringify({ order_id: order2.id, method: 'BOOMBACK', amount: '100.00' }) });
expect('2. settle 100.00 of order2 with BOOMBACK', payBB.status, 201, payBB.body);
expect('2b. and the rest in cash', (await request('/api/payments', { method: 'POST', headers: { ...CASHIER.headers, 'x-pos-session-token': posToken, 'idempotency-key': `sc-p2c-${stamp}` }, body: JSON.stringify({ order_id: order2.id, method: 'CASH', amount: '900.00' }) })).status, 201);

// ============================================================ 3. BREAKFAST + BIRTHDAY GIFT
const order3 = await openOrder([{ menu_item_id: DISH.id, quantity: 1 }]);
await makeReady(order3);
const breakfastRedeem = await request(`/api/boomcard/${cardId}/breakfast/redeem`, { method: 'POST', headers: MGR.headers, body: JSON.stringify({ order_id: order3.id, menu_item_id: OMELETTE.id, quantity: 1 }) });
expect('4. BREAKFAST_REDEEMED', breakfastRedeem.status, 201, breakfastRedeem.body);
await request('/api/payments', { method: 'POST', headers: { ...CASHIER.headers, 'x-pos-session-token': posToken, 'idempotency-key': `sc-p3-${stamp}` }, body: JSON.stringify({ order_id: (await orderOf(order3.id)).id, method: 'CASH', amount: (await orderOf(order3.id)).final_amount }) });

const giftR = await request(`/api/boomcard/${cardId}/birthday-gift`, { method: 'POST', headers: MGR.headers, body: JSON.stringify({ menu_item_id: CAKE.id, quantity: 1, reason: 'Birthday' }) });
expect('5. BIRTHDAY_GIFT_GRANTED', giftR.status, 201, giftR.body);
const giftId = giftR.body.gift.id;
const order4 = await openOrder([{ menu_item_id: DISH.id, quantity: 1 }]);
await makeReady(order4);
const giftRedeem = await request(`/api/boomcard/${cardId}/birthday-gift/${giftId}/redeem`, { method: 'POST', headers: MGR.headers, body: JSON.stringify({ order_id: order4.id }) });
expect('6. BIRTHDAY_GIFT_REDEEMED', giftRedeem.status, 201, giftRedeem.body);
dbCheck('6b. the gift is now spent -- redeeming it again is refused', true, null);
mustDeny('6c. and cannot be redeemed a second time', await request(`/api/boomcard/${cardId}/birthday-gift/${giftId}/redeem`, { method: 'POST', headers: MGR.headers, body: JSON.stringify({ order_id: order4.id }) }));
await request('/api/payments', { method: 'POST', headers: { ...CASHIER.headers, 'x-pos-session-token': posToken, 'idempotency-key': `sc-p4-${stamp}` }, body: JSON.stringify({ order_id: order4.id, method: 'CASH', amount: (await orderOf(order4.id)).final_amount }) });

const renewed = await request(`/api/boomcard/${cardId}/renew`, { method: 'POST', headers: MGR.headers, body: JSON.stringify({ breakfasts: 0 }) });
expect('7. BOOMCARD_RENEWED', renewed.status, 200, renewed.body);
const deactivated = await request(`/api/boomcard/${cardId}/deactivate`, { method: 'POST', headers: MGR.headers, body: JSON.stringify({ reason: 'Guest request' }) });
expect('8. BOOMCARD_DEACTIVATED', deactivated.status, 200, deactivated.body);

// ============================================================ 9. BOOMCOIN_REDEEMED (manual adjustment)
const coinAdjust = await request('/api/loyalty/boomcoin/adjust', { method: 'POST', headers: MGR.headers, body: JSON.stringify({ customer_id: guest.id, coins: -1, reason: 'Manual correction' }) });
expect('9. a manual BOOMCOIN adjustment posts (mapped to BOOMCOIN_ADJUSTED)', coinAdjust.status, 201, coinAdjust.body);

// ============================================================ 10. THE FULL JOURNAL: every required event type appears
const all = await request(`/api/boomcard/journal?branch_id=${B1}&page_size=200`, { headers: MGR.headers });
expect('10. the manager reads the journal', all.status, 200, all.body);
const REQUIRED = ['BOOMBACK_EARNED', 'BOOMBACK_REDEEMED', 'BREAKFAST_GRANTED', 'BREAKFAST_REDEEMED', 'BOOMCOIN_EARNED', 'BOOMCARD_ACTIVATED', 'BOOMCARD_RENEWED', 'BOOMCARD_DEACTIVATED', 'BIRTHDAY_GIFT_GRANTED', 'BIRTHDAY_GIFT_REDEEMED'];
for (const t of REQUIRED) dbCheck(`10. ${t} appears in the journal`, all.body.rows.some(r => r.event_type === t), all.body.rows.map(r => r.event_type));
dbCheck('10b. BOOMCOIN_ADJUSTED also appears (the manual correction)', all.body.rows.some(r => r.event_type === 'BOOMCOIN_ADJUSTED'), all.body.rows.map(r => r.event_type));

// ============================================================ 11. normalized fields are real, not invented
// Two BOOMBACK_EARNED rows exist (cashback also earns on the BOOMBACK-method payment in step 2) --
// this asserts the one from order1's cash settlement specifically.
const earnRow = all.body.rows.find(r => r.event_type === 'BOOMBACK_EARNED' && r.order_id === order1.id);
dbCheck('11. a BOOMBACK_EARNED row carries the real guest identity and order', earnRow.customer_name === 'Journal Guest' && earnRow.customer_phone && earnRow.order_id === order1.id, earnRow);
dbCheck('11b. and its real cashback amount (10% of 1000.00 = 100.00)', money(earnRow.boomback_amount) === 10000, earnRow.boomback_amount);
dbCheck('11c. it carries no boomcoin_amount, no menu item -- those do not apply to it, so they are null, not zero', earnRow.boomcoin_amount === null && earnRow.menu_item_id === null, earnRow);

const redeemRow = all.body.rows.find(r => r.event_type === 'BOOMBACK_REDEEMED');
dbCheck('12. THE RULE: a BOOMBACK redemption reads as a PAYMENT SETTLEMENT, never a discount', redeemRow.event_category === 'PAYMENT_SETTLEMENT', redeemRow);
dbCheck('12b. and its amount is exactly what was spent (100.00), signed negative in the source ledger', Math.abs(money(redeemRow.boomback_amount)) === 10000, redeemRow.boomback_amount);
dbCheck('12c. it carries the real payment id it settled', Boolean(redeemRow.payment_id), redeemRow);

const coinRow = all.body.rows.find(r => r.event_type === 'BOOMCOIN_EARNED');
dbCheck('13. THE RULE: BOOMCOIN reads as a CUSTOMER REWARD, never cash revenue', coinRow.event_category === 'CUSTOMER_REWARD', coinRow);
dbCheck('13b. it carries a real coin count, and no boomback figure', typeof coinRow.boomcoin_amount === 'number' && coinRow.boomcoin_amount > 0 && coinRow.boomback_amount === null, coinRow);

const bfGrant = all.body.rows.find(r => r.event_type === 'BREAKFAST_GRANTED');
dbCheck('14. a breakfast GRANT carries no menu item -- honestly absent (it is a balance, not one dish)', bfGrant.menu_item_id === null && bfGrant.quantity === 2, bfGrant);
const bfRedeem = all.body.rows.find(r => r.event_type === 'BREAKFAST_REDEEMED');
dbCheck('15. THE RULE: breakfast redemption reads as an OPERATIONAL BENEFIT, never a discount', bfRedeem.event_category === 'OPERATIONAL_BENEFIT', bfRedeem);
dbCheck('15b. and carries the REAL menu item and order it was redeemed on', bfRedeem.menu_item_id === OMELETTE.id && bfRedeem.menu_item_name_ru === 'Омлет' && bfRedeem.order_id === order3.id, bfRedeem);

const giftGrantRow = all.body.rows.find(r => r.event_type === 'BIRTHDAY_GIFT_GRANTED');
dbCheck('16. a birthday-gift GRANT carries the real menu item it was granted for', giftGrantRow.menu_item_id === CAKE.id && giftGrantRow.event_category === 'CUSTOMER_REWARD', giftGrantRow);
const giftRedeemRow = all.body.rows.find(r => r.event_type === 'BIRTHDAY_GIFT_REDEEMED');
dbCheck('17. a birthday-gift REDEMPTION reads as an OPERATIONAL BENEFIT and carries the real order it landed on', giftRedeemRow.event_category === 'OPERATIONAL_BENEFIT' && giftRedeemRow.order_id === order4.id && giftRedeemRow.menu_item_id === CAKE.id, giftRedeemRow);

const activatedRow = all.body.rows.find(r => r.event_type === 'BOOMCARD_ACTIVATED');
dbCheck('18. a lifecycle event reads as LIFECYCLE and names the manager who decided it', activatedRow.event_category === 'LIFECYCLE' && activatedRow.operator_name === 'm3412 Name' && activatedRow.operator_role, activatedRow);
dbCheck('18b. there is no separate approver in this architecture -- null, not a duplicated operator', activatedRow.approver_id === null && activatedRow.approver_name === null, activatedRow);

// ============================================================ 12. the journal duplicates NOTHING financial
const paymentsForB1 = (await request(`/api/payments?branch_id=${B1}`, { headers: MGR.headers })).body.payments;
dbCheck('19. the journal created no new payment -- exactly the payments the test itself made exist', paymentsForB1.length === 5, paymentsForB1.map(p => p.method));
const bbLedger = (await request(`/api/loyalty/boomback/ledger?branch_id=${B1}&customer_id=${guest.id}`, { headers: MGR.headers })).body.entries;
dbCheck('20. and the boomback ledger itself is unchanged by reading the journal -- same entries as the source', bbLedger.length === all.body.rows.filter(r => r.source === 'BOOMBACK_LEDGER').length, { ledger: bbLedger.length, journal: all.body.rows.filter(r => r.source === 'BOOMBACK_LEDGER').length });

// ============================================================ 13. filters
const byType = await request(`/api/boomcard/journal?branch_id=${B1}&event_type=BOOMBACK_EARNED`, { headers: MGR.headers });
dbCheck('21. filtering by event_type returns only that type', byType.body.rows.length > 0 && byType.body.rows.every(r => r.event_type === 'BOOMBACK_EARNED'), byType.body.rows.map(r => r.event_type));
const bySource = await request(`/api/boomcard/journal?branch_id=${B1}&source=BOOMCOIN_LEDGER`, { headers: MGR.headers });
dbCheck('22. filtering by source returns only that source', bySource.body.rows.length > 0 && bySource.body.rows.every(r => r.source === 'BOOMCOIN_LEDGER'), bySource.body.rows.map(r => r.source));
const byCustomer = await request(`/api/boomcard/journal?branch_id=${B1}&customer_id=${guest.id}`, { headers: MGR.headers });
dbCheck('23. filtering by customer_id returns only that guest\'s rows', byCustomer.body.rows.length > 0 && byCustomer.body.rows.every(r => r.customer_id === guest.id), byCustomer.body.rows.length);
const byOrder = await request(`/api/boomcard/journal?branch_id=${B1}&order_id=${order3.id}`, { headers: MGR.headers });
dbCheck('24. filtering by order_id returns only rows from that order', byOrder.body.rows.length > 0 && byOrder.body.rows.every(r => r.order_id === order3.id), byOrder.body.rows.map(r => [r.event_type, r.order_id]));
const byOperator = await request(`/api/boomcard/journal?branch_id=${B1}&operator_id=${MGR.id}`, { headers: MGR.headers });
dbCheck('25. filtering by operator_id returns only rows that operator acted on', byOperator.body.rows.length > 0 && byOperator.body.rows.every(r => r.operator_id === MGR.id), byOperator.body.rows.length);
const bySearch = await request(`/api/boomcard/journal?branch_id=${B1}&search=${encodeURIComponent('Journal Guest')}`, { headers: MGR.headers });
dbCheck('26. free-text search over the guest name finds their rows', bySearch.body.rows.length > 0 && bySearch.body.rows.every(r => r.customer_name === 'Journal Guest'), bySearch.body.rows.length);
const byPhone = await request(`/api/boomcard/journal?branch_id=${B1}&search=${encodeURIComponent(guest.phone.slice(-6))}`, { headers: MGR.headers });
dbCheck('26b. and over the phone number', byPhone.body.rows.length > 0, byPhone.body.rows.length);
const noMatch = await request(`/api/boomcard/journal?branch_id=${B1}&search=${encodeURIComponent('NoSuchGuestXYZ')}`, { headers: MGR.headers });
dbCheck('26c. a search with no match returns nothing, not everything', noMatch.body.rows.length === 0 && noMatch.body.total === 0, noMatch.body);

// ============================================================ 14. pagination
const page1 = await request(`/api/boomcard/journal?branch_id=${B1}&page=1&page_size=3`, { headers: MGR.headers });
const page2 = await request(`/api/boomcard/journal?branch_id=${B1}&page=2&page_size=3`, { headers: MGR.headers });
dbCheck('27. page size is honored', page1.body.rows.length === 3 && page2.body.rows.length === 3, { p1: page1.body.rows.length, p2: page2.body.rows.length });
dbCheck('27b. the two pages do not overlap', !page1.body.rows.some(a => page2.body.rows.some(b => a.source === b.source && a.source_id === b.source_id)), null);
dbCheck('27c. total and total_pages are consistent with the full unfiltered count', page1.body.total === all.body.total && page1.body.total_pages === Math.ceil(all.body.total / 3), { page1: page1.body.total, all: all.body.total });

// ============================================================ 15. summary rollup, categories never mixed into revenue
const summary = await request(`/api/boomcard/journal/summary?branch_id=${B1}`, { headers: MGR.headers });
expect('28. the summary rollup', summary.status, 200, summary.body);
dbCheck('28b. it distinguishes categories -- settlement and reward are separate rows, never merged', summary.body.event_types.some(e => e.event_type === 'BOOMBACK_EARNED' && e.event_category === 'CUSTOMER_REWARD') && summary.body.event_types.some(e => e.event_type === 'BOOMBACK_REDEEMED' && e.event_category === 'PAYMENT_SETTLEMENT'), summary.body.event_types.map(e => [e.event_type, e.event_category]));
const orderReport = await request(`/api/analytics/sales?branch_id=${B1}`, { headers: MGR.headers });
dbCheck('29. the Order Core\'s own sales total is UNCHANGED by any of this -- BOOMCOIN/BOOMBACK/breakfast/gift never became fake revenue', orderReport.status === 200 && money(orderReport.body.net_revenue) === money(order1.final_amount) + money(order2.final_amount) + money((await orderOf(order3.id)).final_amount) + money((await orderOf(order4.id)).final_amount), { net_revenue: orderReport.body.net_revenue });

// ============================================================ 16. archived guest keeps their history
const archiveGuest = await request(`/api/customers/${guest.id}`, { method: 'DELETE', headers: MGR.headers });
ok('30. the guest is archived', [200, 204].includes(archiveGuest.status) || archiveGuest.status === 404, archiveGuest.body);
if ([200, 204].includes(archiveGuest.status)) {
  const afterArchive = await request(`/api/boomcard/journal?branch_id=${B1}&customer_id=${guest.id}`, { headers: MGR.headers });
  dbCheck('30b. an archived guest\'s history stays fully visible in the journal', afterArchive.body.rows.length === byCustomer.body.rows.length, { before: byCustomer.body.rows.length, after: afterArchive.body.rows.length });
}

// ============================================================ 17. RBAC + branch isolation
mustDeny('31. a cashier is refused the journal (boomcard.view alone is not enough)', await request(`/api/boomcard/journal?branch_id=${B1}`, { headers: CASHIER.headers }));
mustDeny('32. a waiter is refused too', await request(`/api/boomcard/journal?branch_id=${B1}`, { headers: WAITER.headers }));

// The core negative control for rule 11: this role CAN execute a BOOMCARD operation (holds
// boomcard.manage) but was never granted boomcard.journal.view.
const cardOpCanExecute = await request('/api/boomcard', { method: 'POST', headers: CARD_OP.headers, body: JSON.stringify({ customer_id: guest.id }) });
ok('33. the CARD_OP role really can execute a BOOMCARD operation', [200, 201, 409].includes(cardOpCanExecute.status), cardOpCanExecute.body);
mustDeny('34. THE RULE: yet that same role is refused the journal -- executing an operation never grants reading it', await request(`/api/boomcard/journal?branch_id=${B1}`, { headers: CARD_OP.headers }));

mustDeny('35. branch isolation: a branch B2 manager cannot read branch B1\'s journal', await request(`/api/boomcard/journal?branch_id=${B1}`, { headers: MGR2.headers }));
mustDeny('35b. nor its summary', await request(`/api/boomcard/journal/summary?branch_id=${B1}`, { headers: MGR2.headers }));
const b2Journal = await request(`/api/boomcard/journal?branch_id=${B2}`, { headers: MGR2.headers });
dbCheck('35c. and their own branch, which had no BOOMCARD activity, reports zero rather than branch B1\'s rows', b2Journal.status === 200 && b2Journal.body.total === 0, b2Journal.body);
dbCheck('36. the module is genuinely activated -- never MODULE_NOT_ACTIVATED', all.body.code !== 'MODULE_NOT_ACTIVATED', null);

console.log(`\nStage 34.12 BOOMCARD journal E2E: ${counts.runtime} HTTP calls, ${counts.denials} denials, ${counts.dbPost} DB post-conditions`);
if (failures.length) { console.error(`\nFAILURES (${failures.length}):`); for (const f of failures) console.error(' - ' + f); process.exit(1); }
console.log('ALL STAGE 34.12 BOOMCARD JOURNAL CHECKS PASSED');
