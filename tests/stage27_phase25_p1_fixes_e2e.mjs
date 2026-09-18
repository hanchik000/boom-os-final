// BOOM OS -- Stage 27 Phase 2.5: runtime regression proof for the two P1 fixes.
//
// P1 #1: item-removal approval crashed with HTTP 500 (Prisma P2010, Postgres 42804) on every
// attempt, because orders.ts wrote a DECIMAL(12,4)-shaped text value directly into
// order_items.quantity (INTEGER) with no cast. Verifies partial removal, full removal, the
// PENDING->APPROVED transition, correct subtotal/service-charge/final-amount recompute, a
// single correctly-populated audit row (with real ip/user-agent, not the previous default),
// no duplicate/partial rows, idempotent-per-contract repeat-approval rejection, and that
// cross-branch approval remains denied.
//
// P1 #2: the entire /api/waiters management router required 'waiter_codes.manage', a
// permission nobody was ever granted, locking GET /api/waiters, waiter status management, and
// waiter POS code issuance to superusers only. Verifies BRANCH_MANAGER can now reach these
// routes within their own branch, cannot reach another branch's waiter, an unrelated role
// remains denied, and OWNER is unaffected.
//
// Requires an empty database. Usage: node tests/stage27_phase25_p1_fixes_e2e.mjs
import assert from 'node:assert/strict';

const base = `http://127.0.0.1:${process.env.BOOM_OS_PORT || 3000}`;
const ownerPassword = process.env.STAGE27_5_OWNER_PASSWORD || 'BoomP25FixOwner27!';
const staffPassword = 'P25FixStaffPass12345!';
const stamp = Date.now();

let counts = { runtime: 0, denials: 0, controls: 0, dbPost: 0 };
const failures = [];

const RATE_BUDGET = 250;
let windowStart = Date.now(), windowCount = 0;
async function pace() {
  const now = Date.now();
  if (now - windowStart >= 60000) { windowStart = now; windowCount = 0; }
  windowCount++;
  if (windowCount >= RATE_BUDGET) {
    const wait = 60000 - (Date.now() - windowStart) + 250;
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    windowStart = Date.now(); windowCount = 0;
  }
}
async function request(path, options = {}) {
  await pace();
  counts.runtime++;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const res = await fetch(base + path, {
      ...options, signal: controller.signal,
      headers: { 'content-type': 'application/json', ...(options.headers || {}) },
    });
    let body = null;
    try { body = await res.json(); } catch {}
    return { status: res.status, body };
  } catch (error) {
    throw new Error(`${path} did not answer (${error.message})`);
  } finally { clearTimeout(timer); }
}
function expect(step, got, want, body) {
  if (got !== want) failures.push(`${step}: expected ${want}, got ${got} -> ${JSON.stringify(body).slice(0, 300)}`);
}
function ok(step, cond, detail) {
  if (!cond) failures.push(`${step}: FAILED ${detail !== undefined ? '-> ' + JSON.stringify(detail).slice(0,300) : ''}`);
}
function mustDenyAuth(label, r) {
  if (r.status >= 200 && r.status < 300) failures.push(`${label} -- returned ${r.status} (expected denial): ${JSON.stringify(r.body).slice(0,260)}`);
  else if (![401, 403, 404].includes(r.status)) failures.push(`${label} -- returned ${r.status}, not a recognized denial: ${JSON.stringify(r.body).slice(0,260)}`);
  else counts.denials++;
}
function moneyEq(actual, expectedStr) { return Math.abs(parseFloat(actual) - parseFloat(expectedStr)) < 0.005; }
function dbCheck(label, cond, detail) { counts.dbPost++; ok(`DB POST-CONDITION -- ${label}`, cond, detail); }

// ---------------------------------------------------------------- bootstrap + topology
const owner = await request('/api/auth/bootstrap', { method: 'POST', body: JSON.stringify({ full_name: 'P25 Owner', email: `p25owner-${stamp}@boom.local`, password: ownerPassword }) });
expect('bootstrap owner', owner.status, 201, owner.body);
const OWNER = { authorization: `Bearer ${owner.body.token}` };

async function makeFranchise(tag, n) {
  const f = await request('/api/franchises', { method: 'POST', headers: OWNER, body: JSON.stringify({ name: `P25 Franchise ${tag}`, code: `P25${tag}${stamp % 100000}`, legal_name: `P25${tag} LLC`, contact_name: 'x', phone: `+9931499${n}`, email: `p25${tag}-${stamp}@boom.local`, address: 'x' }) });
  expect(`create franchise ${tag}`, f.status, 201, f.body);
  return f.body.franchise.id;
}
async function makeBranch(tag, n, franchiseId) {
  const branch = await request('/api/branches', { method: 'POST', headers: OWNER, body: JSON.stringify({ name: `P25 Branch ${tag}`, code: `P25${tag}${stamp % 100000}`, address: 'x', phone: `+9931409${n}`, franchise_id: franchiseId }) });
  expect(`branch ${tag}`, branch.status, 201, branch.body);
  const id = branch.body.branch.id;
  await request(`/api/franchises/${franchiseId}/branches/${id}`, { method: 'POST', headers: OWNER, body: '{}' });
  return { tag, id, franchiseId };
}
async function makeUser(label, n, branch, allowed, roles) {
  const email = `${label}-${stamp}@boom.local`.toLowerCase();
  const u = await request('/api/users', { method: 'POST', headers: OWNER, body: JSON.stringify({ full_name: `${label} Name`, email, phone: `+9939${n}${stamp % 100000}`, password: staffPassword, branch_id: branch, roles, allowed_branches: allowed }) });
  expect(`create user ${label}`, u.status, 201, u.body);
  const login = await request('/api/auth/login', { method: 'POST', body: JSON.stringify({ login: email, password: staffPassword }) });
  expect(`login ${label}`, login.status, 200, login.body);
  return { label, email, id: u.body.user.id, headers: { authorization: `Bearer ${login.body.token}` } };
}

const FA = await makeFranchise('A', '1');
const A1 = await makeBranch('A1', '1', FA);
const A2 = await makeBranch('A2', '2', FA);
const MGR_A1 = await makeUser('mgrA1', '1', A1.id, [A1.id], ['BRANCH_MANAGER']);
const MGR_A2 = await makeUser('mgrA2', '2', A2.id, [A2.id], ['BRANCH_MANAGER']);
const WAITER_A1 = await makeUser('waitA1', '3', A1.id, [A1.id], ['WAITER']);
const CASHIER_A1 = await makeUser('cashA1', '4', A1.id, [A1.id], ['CASHIER']);

console.log(`Setup: FA=${FA} A1=${A1.id} A2=${A2.id}`);

// ==================================================================== P1 #2 FIRST -- needed to
// issue a waiter POS code as MGR_A1 (proving the fix), which Part 1's order flow depends on.
console.log('--- P1 #2: waiter-management router reachability ---');

// Unrelated role (CASHIER) must remain denied.
mustDenyAuth('CASHIER cannot list waiters', await request('/api/waiters', { headers: CASHIER_A1.headers }));
counts.controls++;

// BRANCH_MANAGER can now reach the router within their own branch.
const listByMgr = await request('/api/waiters', { headers: MGR_A1.headers });
expect('MGR_A1 can list waiters', listByMgr.status, 200, listByMgr.body);
dbCheck('list is branch-scoped (only A1 waiters, WAITER_A1 among them)', Array.isArray(listByMgr.body.waiters) && listByMgr.body.waiters.every(w => w.branch_id === A1.id) && listByMgr.body.waiters.some(w => w.id === WAITER_A1.id), listByMgr.body.waiters);

const statusViewByMgr = await request(`/api/waiters/${WAITER_A1.id}/status`, { headers: MGR_A1.headers });
expect('MGR_A1 can view waiter status', statusViewByMgr.status, 200, statusViewByMgr.body);
dbCheck('default status is PROBATION', statusViewByMgr.body.status === 'PROBATION', statusViewByMgr.body);

const statusSetByMgr = await request(`/api/waiters/${WAITER_A1.id}/status`, { method: 'PUT', headers: MGR_A1.headers, body: JSON.stringify({ status: 'PROFESSIONAL' }) });
expect('MGR_A1 can change waiter status', statusSetByMgr.status, 200, statusSetByMgr.body);
dbCheck('status now PROFESSIONAL', statusSetByMgr.body.status === 'PROFESSIONAL', statusSetByMgr.body);

const codeByMgr = await request(`/api/waiters/${WAITER_A1.id}/code`, { method: 'POST', headers: MGR_A1.headers, body: JSON.stringify({ code: '4321' }) });
expect('MGR_A1 can issue a waiter POS code', codeByMgr.status, 201, codeByMgr.body);

// Cross-branch: MGR_A2 must NOT reach a waiter in A1.
mustDenyAuth('MGR_A2 cannot list-scope into A1 (branch filter query)', await request(`/api/waiters?branch_id=${A1.id}`, { headers: MGR_A2.headers }));
mustDenyAuth('MGR_A2 cannot view A1 waiter status', await request(`/api/waiters/${WAITER_A1.id}/status`, { headers: MGR_A2.headers }));
mustDenyAuth('MGR_A2 cannot change A1 waiter status', await request(`/api/waiters/${WAITER_A1.id}/status`, { method: 'PUT', headers: MGR_A2.headers, body: JSON.stringify({ status: 'PROFESSIONAL' }) }));
mustDenyAuth('MGR_A2 cannot issue an A1 waiter a POS code', await request(`/api/waiters/${WAITER_A1.id}/code`, { method: 'POST', headers: MGR_A2.headers, body: JSON.stringify({ code: '9999' }) }));
const listScopedForMgr2 = await request('/api/waiters', { headers: MGR_A2.headers });
dbCheck('MGR_A2 own-scope list never includes the A1 waiter', listScopedForMgr2.status === 200 && !listScopedForMgr2.body.waiters.some(w => w.id === WAITER_A1.id), listScopedForMgr2.body.waiters);

// OWNER unaffected (superuser bypass unchanged).
const listByOwner = await request('/api/waiters', { headers: OWNER });
expect('OWNER can still list waiters (unchanged)', listByOwner.status, 200, listByOwner.body);

// ==================================================================== P1 #1 -- item-removal approval
console.log('--- P1 #1: item-removal approval crash fix ---');

async function issueWaiterCode(actor, userId, code) {
  const r = await request(`/api/waiters/${userId}/code`, { method: 'POST', headers: actor.headers, body: JSON.stringify({ code }) });
  ok(`issue waiter code ${userId}`, r.status === 200 || r.status === 201, r.body);
}
// WAITER_A1 already has a code (4321, issued above). Give it a session.
const waiterAuth = await request('/api/waiters/authenticate-code', { method: 'POST', body: JSON.stringify({ code: '4321', deviceId: 'p25-device' }) });
expect('waiter authenticate', waiterAuth.status, 200, waiterAuth.body);
const W1 = { headers: { 'x-waiter-session': waiterAuth.body.session.token } };

const cat = await request('/api/menu/categories', { method: 'POST', headers: MGR_A1.headers, body: JSON.stringify({ branch_id: A1.id, name_ru: 'Cat', name_tk: 'Cat', sort_order: 0 }) });
const itemA = (await request('/api/menu/items', { method: 'POST', headers: MGR_A1.headers, body: JSON.stringify({ branch_id: A1.id, category_id: cat.body.category.id, sku: `SKU-A-${stamp}`, name_ru: 'Item A', name_tk: 'Item A', price: '10.00', sort_order: 0 }) })).body.item;
const itemB = (await request('/api/menu/items', { method: 'POST', headers: MGR_A1.headers, body: JSON.stringify({ branch_id: A1.id, category_id: cat.body.category.id, sku: `SKU-B-${stamp}`, name_ru: 'Item B', name_tk: 'Item B', price: '7.00', sort_order: 0 }) })).body.item;

const orderR = await request('/api/orders', { method: 'POST', headers: { ...W1.headers, 'idempotency-key': `p25-order-${stamp}` }, body: JSON.stringify({ order_type: 'TAKEAWAY', source: 'POS', items: [{ menu_item_id: itemA.id, quantity: 3 }, { menu_item_id: itemB.id, quantity: 1 }] }) });
expect('create order', orderR.status, 201, orderR.body);
dbCheck('order subtotal = 37.00 (10x3 + 7x1)', moneyEq(orderR.body.order.subtotal, '37.00'), orderR.body.order);
const orderId = orderR.body.order.id;
const orderDetail = (await request(`/api/orders/${orderId}`, { headers: MGR_A1.headers })).body.order;
const lineA = orderDetail.items.find(i => i.menu_item_id === itemA.id);
const lineB = orderDetail.items.find(i => i.menu_item_id === itemB.id);

// --- (A) PARTIAL removal: remove 1 of 3 units of item A.
const reqA = await request(`/api/orders/${orderId}/items/${lineA.id}/removal-request`, { method: 'POST', headers: W1.headers, body: JSON.stringify({ reason: 'partial removal test', quantity: '1' }) });
expect('partial removal request', reqA.status, 201, reqA.body);
const approveA = await request(`/api/orders/removal-requests/${reqA.body.approval.id}/approve`, { method: 'POST', headers: { ...MGR_A1.headers, 'x-forwarded-for': '203.0.113.55', 'user-agent': 'P25-Fix-Test/1.0' }, body: JSON.stringify({ reason: 'approved' }) });
expect('PARTIAL removal approve succeeds (HTTP 200, no crash)', approveA.status, 200, approveA.body);
dbCheck('approval transitions PENDING -> APPROVED', approveA.body?.approval?.status === 'APPROVED', approveA.body?.approval);
const itemAAfter = (await request(`/api/orders/${orderId}`, { headers: MGR_A1.headers })).body.order.items.find(i => i.id === lineA.id);
dbCheck('item A quantity is now 2 (integer, not "2.0000")', itemAAfter.quantity === 2, itemAAfter);
dbCheck('item A status still ACTIVE (partial removal)', itemAAfter.status === 'ACTIVE', itemAAfter);
dbCheck('item A removed_quantity = 1', moneyEq(itemAAfter.removed_quantity, '1'), itemAAfter);
dbCheck('item A subtotal recomputed to 20.00 (10 x 2)', moneyEq(itemAAfter.subtotal, '20.00'), itemAAfter);
const orderAfterPartial = approveA.body.order;
dbCheck('order subtotal recomputed to 27.00 (20 + 7)', moneyEq(orderAfterPartial.subtotal, '27.00'), orderAfterPartial);
dbCheck('order service_charge recomputed (TAKEAWAY -> 0.00)', moneyEq(orderAfterPartial.service_charge, '0.00'), orderAfterPartial);
dbCheck('order final_amount recomputed to 27.00', moneyEq(orderAfterPartial.final_amount, '27.00'), orderAfterPartial);

// Audit: exactly one APPROVED-type row, with the REAL ip/user-agent (not the old default).
const auditRowsA = (await request(`/api/audit?entity_type=ORDER_ITEM_REMOVAL&action=MANAGER_APPROVAL&limit=200`, { headers: MGR_A1.headers })).body.logs.filter(l => l.entity_id === reqA.body.approval.id);
const approvedAuditA = auditRowsA.find(l => l.new_values?.status === 'APPROVED');
dbCheck('exactly one APPROVED-type audit row exists', auditRowsA.filter(l => l.new_values?.status === 'APPROVED').length === 1, auditRowsA);
dbCheck('approved audit row captures the REAL caller ip (not 127.0.0.1 default)', approvedAuditA?.ip_address === '203.0.113.55', approvedAuditA);
dbCheck('approved audit row captures the REAL user-agent (not "internal" default)', approvedAuditA?.user_agent === 'P25-Fix-Test/1.0', approvedAuditA);

// Repeat approval on the same (already-decided) approval -- must be rejected, not double-applied.
const reapproveA = await request(`/api/orders/removal-requests/${reqA.body.approval.id}/approve`, { method: 'POST', headers: MGR_A1.headers, body: '{}' });
ok('repeat approval rejected (409 APPROVAL_ALREADY_DECIDED)', reapproveA.status === 409, reapproveA.body);
const itemAAfterRepeat = (await request(`/api/orders/${orderId}`, { headers: MGR_A1.headers })).body.order.items.find(i => i.id === lineA.id);
dbCheck('item A quantity unchanged by the repeat attempt (still 2)', itemAAfterRepeat.quantity === 2, itemAAfterRepeat);
const auditRowsAAfterRepeat = (await request(`/api/audit?entity_type=ORDER_ITEM_REMOVAL&action=MANAGER_APPROVAL&limit=200`, { headers: MGR_A1.headers })).body.logs.filter(l => l.entity_id === reqA.body.approval.id && l.new_values?.status === 'APPROVED');
dbCheck('no duplicate APPROVED audit row from the repeat attempt', auditRowsAAfterRepeat.length === 1, auditRowsAAfterRepeat.length);

// --- (B) FULL removal: remove all remaining 2 units of item A.
const reqA2 = await request(`/api/orders/${orderId}/items/${lineA.id}/removal-request`, { method: 'POST', headers: W1.headers, body: JSON.stringify({ reason: 'full removal test', quantity: '2' }) });
expect('full removal request', reqA2.status, 201, reqA2.body);
const approveA2 = await request(`/api/orders/removal-requests/${reqA2.body.approval.id}/approve`, { method: 'POST', headers: MGR_A1.headers, body: '{}' });
expect('FULL removal approve succeeds (HTTP 200, no crash)', approveA2.status, 200, approveA2.body);
const itemAAfterFull = (await request(`/api/orders/${orderId}`, { headers: MGR_A1.headers })).body.order.items.find(i => i.id === lineA.id);
dbCheck('item A quantity is now 0 (integer)', itemAAfterFull.quantity === 0, itemAAfterFull);
dbCheck('item A status is now REMOVED (fully removed, soft -- row still present, not deleted)', itemAAfterFull.status === 'REMOVED', itemAAfterFull);
dbCheck('item A removed_quantity = 3 (cumulative: 1 + 2)', moneyEq(itemAAfterFull.removed_quantity, '3'), itemAAfterFull);
const orderAfterFull = approveA2.body.order;
dbCheck('order subtotal now 7.00 (only item B remains active)', moneyEq(orderAfterFull.subtotal, '7.00'), orderAfterFull);
const itemBStillThere = (await request(`/api/orders/${orderId}`, { headers: MGR_A1.headers })).body.order.items.find(i => i.id === lineB.id);
dbCheck('item B untouched (status ACTIVE, quantity 1)', itemBStillThere.status === 'ACTIVE' && itemBStillThere.quantity === 1, itemBStillThere);
const allItemRows = (await request(`/api/orders/${orderId}`, { headers: MGR_A1.headers })).body.order.items;
dbCheck('exactly 2 order_items rows total -- full removal never hard-deletes the row', allItemRows.length === 2, allItemRows.length);

// Cross-branch approval must remain denied (branch authorization preserved by the fix).
const reqA3Setup = await request(`/api/orders/${orderId}/items/${lineB.id}/removal-request`, { method: 'POST', headers: W1.headers, body: JSON.stringify({ reason: 'cross-branch test setup', quantity: '1' }) });
expect('removal request for cross-branch test', reqA3Setup.status, 201, reqA3Setup.body);
mustDenyAuth('MGR_A2 cannot approve an A1 removal request', await request(`/api/orders/removal-requests/${reqA3Setup.body.approval.id}/approve`, { method: 'POST', headers: MGR_A2.headers, body: '{}' }));
const pendingAfterCrossBranch = (await request(`/api/orders/removal-requests?branch_id=${A1.id}&status=PENDING`, { headers: MGR_A1.headers })).body.requests;
dbCheck('approval still PENDING after the denied cross-branch attempt', pendingAfterCrossBranch.some(r => r.id === reqA3Setup.body.approval.id), pendingAfterCrossBranch);

console.log('--- FINAL FAILURES CHECK ---');
console.log(`failures: ${failures.length}`);
for (const f of failures) console.log('FAIL: ' + f);
console.log('--- COUNTS ---');
console.log(JSON.stringify(counts));
console.log(failures.length === 0
  ? 'STAGE 27 PHASE 2.5 P1 FIXES E2E: PASS'
  : 'STAGE 27 PHASE 2.5 P1 FIXES E2E: FAIL');
if (failures.length > 0) process.exit(1);
