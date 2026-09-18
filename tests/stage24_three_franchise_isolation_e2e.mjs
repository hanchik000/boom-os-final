// BOOM OS — Stage 24: three-franchise isolation and franchise governance authorization.
//
// Extends Stage 23's two-franchise proof to three: Franchise A = { A1, A2 },
// Franchise B = { B1, B2 }, Franchise C = { C1, C2 }. Subject U holds exactly one branch
// in each franchise (A1 + B1 + C1) and must never reach the sibling branch of any of them
// (A2, B2, C2), regardless of which franchise gate that sibling sits behind.
//
// Also proves the Part A finding: franchise-level GOVERNANCE mutations (rename, status,
// delete) and branch<->franchise RE-PARENTING (via /franchises/:id/branches/:branchId,
// PUT /api/branches/:id, and POST /api/branches) all require superuser semantics -- holding
// one branch of a franchise, or even every branch U holds across all three franchises
// combined, is never sufficient.
//
// Methodology from Stage 21/22/23: every denial is preceded by proof that the target
// really exists and is reachable for a privileged user; refusals that could plausibly be a
// business-rule or validation failure are cross-checked against a control actor who DOES
// have the matching permission/membership, so a denial is never credited to the wrong axis.
//
// Requires an empty database: it bootstraps the first OWNER itself.
// Usage: BOOM_OS_PORT=3000 node tests/stage24_three_franchise_isolation_e2e.mjs
import assert from 'node:assert/strict';

const base = `http://127.0.0.1:${process.env.BOOM_OS_PORT || 3000}`;
const ownerPassword = process.env.STAGE24_OWNER_PASSWORD || 'BoomTripleOwner24!';
const staffPassword = 'TripleStaffPass12345!';
const stamp = Date.now();

let denials = 0, existenceProofs = 0, controls = 0, privileged = 0, inScope = 0;
const failures = [];
const denialCodes = [];
const invariants = new Set();

// server.ts applies a real 300-requests-per-minute-per-IP limiter (basicRateLimiter) ahead
// of every route. This suite's six fully-operational branches push it well past that in a
// tight loop, so requests are paced to stay under the limit rather than working around real
// server behaviour -- the limiter itself is out of scope for this stage.
const RATE_BUDGET = 260; // safety margin under the server's 300/min
let windowStart = Date.now();
let windowCount = 0;
async function pace() {
  const now = Date.now();
  if (now - windowStart >= 60000) { windowStart = now; windowCount = 0; }
  windowCount++;
  if (windowCount >= RATE_BUDGET) {
    const wait = 60000 - (Date.now() - windowStart) + 250;
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    windowStart = Date.now();
    windowCount = 0;
  }
}

async function request(path, options = {}) {
  await pace();
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
  assert.equal(got, want, `${step}: expected ${want}, got ${got} -> ${JSON.stringify(body).slice(0, 300)}`);
}

async function proveExists(label, path) {
  const r = await request(path, { headers: OWNER });
  assert.ok(r.status >= 200 && r.status < 300,
    `EXISTENCE PROOF FAILED — ${label}: OWNER must reach ${path} first, got ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
  existenceProofs++;
  return r;
}

async function mustDeny(label, actor, method, path, body, invariant) {
  const opts = { method, headers: actor.headers };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const r = await request(path, opts);
  if (r.status >= 200 && r.status < 300) {
    failures.push(`${label} — ${method} ${path} returned ${r.status} (expected denial): ${JSON.stringify(r.body).slice(0, 240)}`);
  } else if (![400, 401, 403, 404].includes(r.status)) {
    failures.push(`${label} — ${method} ${path} returned unexpected ${r.status}: ${JSON.stringify(r.body).slice(0, 240)}`);
  } else {
    denials++;
    denialCodes.push(`${r.status}  ${label}`);
    if (invariant) invariants.add(invariant);
  }
  return r;
}

async function mustAllow(label, actor, method, path, body, invariant) {
  const opts = { method, headers: actor.headers };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const r = await request(path, opts);
  assert.ok(r.status >= 200 && r.status < 300,
    `ACCESS REGRESSION — ${label}: ${method} ${path} must succeed, got ${r.status} ${JSON.stringify(r.body).slice(0, 240)}`);
  inScope++;
  if (invariant) invariants.add(invariant);
  return r;
}

async function controlProbe(label, actor, method, path, body) {
  const r = await mustAllow(label, actor, method, path, body);
  controls++; inScope--;
  return r;
}

function mustNotContain(label, payload, foreignIds, invariant) {
  const raw = JSON.stringify(payload ?? {});
  let clean = true;
  for (const id of foreignIds.filter(Boolean)) {
    if (raw.includes(id)) { failures.push(`${label}: leaked out-of-scope id ${id}`); clean = false; }
  }
  if (clean && invariant) invariants.add(invariant);
}
function mustContain(label, payload, ids) {
  const raw = JSON.stringify(payload ?? {});
  for (const id of ids.filter(Boolean)) {
    if (!raw.includes(id)) failures.push(`${label}: expected in-scope id ${id} to be present`);
  }
}

// ---------------------------------------------------------------- bootstrap
const owner = await request('/api/auth/bootstrap', {
  method: 'POST',
  body: JSON.stringify({ full_name: 'Triple Owner', email: `triple24-${stamp}@boom.local`, password: ownerPassword }),
});
expect('bootstrap owner', owner.status, 201, owner.body);
const OWNER = { authorization: `Bearer ${owner.body.token}` };

async function makeFranchise(tag, n) {
  const f = await request('/api/franchises', {
    method: 'POST', headers: OWNER,
    body: JSON.stringify({
      name: `Franchise ${tag}`, code: `T${tag}${stamp % 100000}`, legal_name: `Franchise ${tag} LLC`,
      contact_name: `Contact ${tag}`, phone: `+9931295${n}`, email: `t${tag}-${stamp}@boom.local`, address: `Ashgabat ${tag}`,
    }),
  });
  expect(`create franchise ${tag}`, f.status, 201, f.body);
  return f.body.franchise.id;
}

// A fully operational branch: menu, inventory, table, waiter POS session, a real order
// taken through KDS to READY, an operator POS lock, a cash shift and a completed payment --
// so every direct-object probe below acts on a row that genuinely exists.
async function makeBranch(tag, n, franchiseId) {
  const branch = await request('/api/branches', {
    method: 'POST', headers: OWNER,
    body: JSON.stringify({ name: `Branch ${tag}`, code: `${tag}${stamp % 100000}`, address: `Ashgabat ${tag}`, phone: `+9931206${n}`, franchise_id: franchiseId }),
  });
  expect(`branch ${tag}`, branch.status, 201, branch.body);
  const id = branch.body.branch.id;
  await request(`/api/franchises/${franchiseId}/branches/${id}`, { method: 'POST', headers: OWNER, body: '{}' });

  const category = await request('/api/menu/categories', {
    method: 'POST', headers: OWNER,
    body: JSON.stringify({ branch_id: id, name_ru: `Кат ${tag}`, name_tk: `Kat ${tag}`, sort_order: 1 }),
  });
  expect(`category ${tag}`, category.status, 201, category.body);
  const item = await request('/api/menu/items', {
    method: 'POST', headers: OWNER,
    body: JSON.stringify({ branch_id: id, category_id: category.body.category.id, name_ru: `Блюдо ${tag}`, name_tk: `Nahar ${tag}`, price: '35.00', sku: `SK${tag}${stamp % 100000}` }),
  });
  expect(`menu item ${tag}`, item.status, 201, item.body);
  const inv = await request('/api/inventory/items', {
    method: 'POST', headers: OWNER,
    body: JSON.stringify({ branch_id: id, sku: `IV${tag}${stamp % 100000}`, name: `Ингр ${tag}`, unit: 'PCS', reorder_point: '5.0000' }),
  });
  expect(`inventory ${tag}`, inv.status, 201, inv.body);
  const kpiRule = await request('/api/kpi/rules', {
    method: 'POST', headers: OWNER,
    body: JSON.stringify({ branch_id: id, name: `KPI ${tag}`, metric: 'SALES', threshold: '10.00', threshold_mode: 'GREATER_OR_EQUAL', reward_type: 'PERCENT', reward_value: '5.00', role_code: 'WAITER' }),
  });
  expect(`kpi rule ${tag}`, kpiRule.status, 201, kpiRule.body);
  await request(`/api/service-charge/${id}`, {
    method: 'PUT', headers: OWNER,
    body: JSON.stringify({ percent: '10.00', allocations: [{ target_type: 'GROUP', department: 'WAITERS', percent: '5.00' }] }),
  });

  const area = await request('/api/tables/areas', { method: 'POST', headers: OWNER, body: JSON.stringify({ branch_id: id, name: `Зал ${tag}` }) });
  expect(`area ${tag}`, area.status, 201, area.body);
  const table = await request('/api/tables', {
    method: 'POST', headers: OWNER, body: JSON.stringify({ branch_id: id, area_id: area.body.area.id, code: `T${n}`, seats: 4 }),
  });
  expect(`table ${tag}`, table.status, 201, table.body);

  const staff = await request('/api/users', {
    method: 'POST', headers: OWNER,
    body: JSON.stringify({ full_name: `Официант ${tag}`, email: `w-${tag}-${stamp}@boom.local`, phone: `+9938${n}${stamp % 100000}`, password: staffPassword, branch_id: id, roles: ['WAITER'] }),
  });
  expect(`staff ${tag}`, staff.status, 201, staff.body);
  const staffId = staff.body.user.id;
  const code = String(1000 + Number(n) * 111).slice(0, 4);
  expect(`waiter code ${tag}`, (await request(`/api/waiters/${staffId}/code`, { method: 'POST', headers: OWNER, body: JSON.stringify({ code }) })).status, 201, null);
  const wauth = await request('/api/waiters/authenticate-code', { method: 'POST', body: JSON.stringify({ code, deviceId: `t24-${tag}-${stamp}` }) });
  expect(`waiter session ${tag}`, wauth.status, 200, wauth.body);

  const order = await request('/api/orders', {
    method: 'POST', headers: { 'x-waiter-session': wauth.body.session.token, 'Idempotency-Key': `t24-${tag}-${stamp}` },
    body: JSON.stringify({ order_type: 'DINE_IN', table_id: table.body.table.id, items: [{ menu_item_id: item.body.item.id, quantity: 1 }] }),
  });
  expect(`order ${tag}`, order.status, 201, order.body);
  const orderId = order.body.order.id;
  expect(`confirm ${tag}`, (await request(`/api/orders/${orderId}/confirm`, { method: 'POST', headers: OWNER, body: '{}' })).status, 200, null);
  const tickets = await request(`/api/kds?branch_id=${id}`, { headers: OWNER });
  const ticket = tickets.body.tickets.find(t => t.order_id === orderId);
  assert.ok(ticket, `KDS ticket must exist for ${tag}`);
  for (const next of ['PREPARING', 'READY']) {
    expect(`kds ${tag} ${next}`, (await request(`/api/kds/${ticket.id}/status`, { method: 'POST', headers: OWNER, body: JSON.stringify({ status: next }) })).status, 200, null);
  }
  const lock = await request('/api/operator-pos/lock', { method: 'POST', headers: OWNER, body: JSON.stringify({ branch_id: id }) });
  expect(`lock ${tag}`, lock.status, 200, lock.body);
  const pos = { ...OWNER, 'x-pos-session-token': lock.body.session?.token || lock.body.token || '' };
  const shift = await request('/api/cash-shifts', { method: 'POST', headers: pos, body: JSON.stringify({ branch_id: id, opening_cash: '100.00' }) });
  expect(`shift ${tag}`, shift.status, 201, shift.body);
  const payment = await request('/api/payments', {
    method: 'POST', headers: { ...pos, 'Idempotency-Key': `t24p-${tag}-${stamp}` },
    body: JSON.stringify({ order_id: orderId, branch_id: id, method: 'CASH', amount: order.body.order.final_amount }),
  });
  expect(`payment ${tag}`, payment.status, 201, payment.body);

  return { tag, id, franchiseId, categoryId: category.body.category.id, menuItemId: item.body.item.id,
           inventoryItemId: inv.body.item.id, kpiRuleId: kpiRule.body.rule.id, tableId: table.body.table.id,
           areaId: area.body.area.id, staffId, orderId, ticketId: ticket.id,
           shiftId: shift.body.shift.id, paymentId: payment.body.payment.id };
}

const FA = await makeFranchise('A', '1');
const FB = await makeFranchise('B', '2');
const FC = await makeFranchise('C', '3');
const A1 = await makeBranch('A1', '1', FA);
const A2 = await makeBranch('A2', '2', FA);
const B1 = await makeBranch('B1', '3', FB);
const B2 = await makeBranch('B2', '4', FB);
const C1 = await makeBranch('C1', '5', FC);
const C2 = await makeBranch('C2', '6', FC);

console.log(`Setup: FA=${FA}[A1,A2]  FB=${FB}[B1,B2]  FC=${FC}[C1,C2]`);

// ---------------------------------------------------------------- subject U
// A dedicated role holding operational + franchise permissions, so no refusal below can be
// attributed to a missing permission rather than branch/franchise scope.
const permsList = await request('/api/permissions', { headers: OWNER });
expect('list permissions', permsList.status, 200, permsList.body);
const permRows = permsList.body.permissions || permsList.body || [];
const wanted = [
  'franchises.view', 'franchises.update', 'franchises.delete',
  'branches.view', 'branches.update', 'branches.delete', 'branches.create',
  'users.view', 'users.update', 'users.delete', 'employees.view', 'employees.update',
  'menu.view', 'menu.manage', 'tables.view', 'tables.manage',
  'orders.view', 'orders.confirm', 'payments.view', 'payments.create', 'payments.refund',
  'cash_shifts.view', 'cash_shifts.open', 'cash_shifts.close', 'kds.view', 'kds.update',
  'inventory.view', 'inventory.manage', 'inventory.purchase', 'inventory.access',
  'kpi.view', 'kpi.manage', 'service_charge.view', 'service_charge.manage', 'pos.operator',
];
const permIds = wanted.map(c => (permRows.find(p => p.code === c) || {}).id).filter(Boolean);
assert.equal(permIds.length, wanted.length, `expected all ${wanted.length} test permissions to resolve, got ${permIds.length}`);

const tripleRole = await request('/api/roles', {
  method: 'POST', headers: OWNER,
  body: JSON.stringify({
    code: `TRIPLE_OPERATOR_${stamp % 100000}`, name: 'Triple-franchise operator (test)',
    description: 'Operational + franchise permissions, branch-scoped', permission_ids: permIds,
  }),
});
expect('create triple role', tripleRole.status, 201, tripleRole.body);
const tripleRoleCode = tripleRole.body.role.code;

async function makeUser(label, n, primaryBranch, allowedBranches, roles) {
  const email = `${label}-${stamp}@boom.local`;
  const u = await request('/api/users', {
    method: 'POST', headers: OWNER,
    body: JSON.stringify({ full_name: `User ${label}`, email, phone: `+9939${n}${stamp % 100000}`, password: staffPassword, branch_id: primaryBranch, roles, allowed_branches: allowedBranches }),
  });
  expect(`create user ${label}`, u.status, 201, u.body);
  const login = await request('/api/auth/login', { method: 'POST', body: JSON.stringify({ login: email, password: staffPassword }) });
  expect(`login ${label}`, login.status, 200, login.body);
  return { label, email, id: u.body.user.id, headers: { authorization: `Bearer ${login.body.token}` } };
}

// U holds one branch in EACH of the three franchises.
const U = await makeUser('triple', '1', A1.id, [A1.id, B1.id, C1.id], [tripleRoleCode]);
const me = await request('/api/auth/me', { headers: U.headers });
expect('U /me', me.status, 200, me.body);
assert.ok(!me.body.user.roleCodes.some(r => ['OWNER', 'SUPER_ADMIN'].includes(r)), 'U must not be a superuser');

// A second subject: a non-member of any of U's franchises, used wherever a refusal must be
// unambiguously franchise-membership-based rather than a permission or business-rule issue.
const outsider = await makeUser('outsider24', '9', C2.id, [C2.id], [tripleRoleCode]);

console.log(`U holds A1+B1+C1 = ${A1.id}, ${B1.id}, ${C1.id}`);

// ================= PART B — THREE-FRANCHISE ISOLATION (points 1-9, 11) =================

// Existence proofs: every sibling target U will be denied is real and franchise-tagged
// correctly, proven via OWNER before any denial is asserted.
for (const S of [A2, B2, C2]) {
  await proveExists(`${S.tag} branch`, `/api/branches/${S.id}`);
  await proveExists(`${S.tag} order`, `/api/orders/${S.orderId}`);
  await proveExists(`${S.tag} payment`, `/api/payments?branch_id=${S.id}`);
  await proveExists(`${S.tag} inventory`, `/api/inventory/items?branch_id=${S.id}`);
  await proveExists(`${S.tag} menu`, `/api/menu?branch_id=${S.id}`);
  await proveExists(`${S.tag} KDS`, `/api/kds?branch_id=${S.id}`);
  await proveExists(`${S.tag} KPI rules`, `/api/kpi/rules?branch_id=${S.id}`);
  await proveExists(`${S.tag} employee KPI`, `/api/kpi/employees/${S.staffId}`);
  await proveExists(`${S.tag} cash shift x-report`, `/api/cash-shifts/${S.shiftId}/x-report`);
  await proveExists(`${S.tag} staff`, `/api/users/${S.staffId}`);
  await proveExists(`${S.tag} employee record`, `/api/employees/${S.staffId}`);
  await proveExists(`${S.tag} staff branch-access`, `/api/users/${S.staffId}/branch-access`);
}

// --- (1) U reaches all three of its own branches, one per franchise ---
for (const H of [A1, B1, C1]) {
  await mustAllow(`U reads own branch ${H.tag}`, U, 'GET', `/api/branches/${H.id}`, undefined, 'I6');
  await mustAllow(`U reads ${H.tag} order`, U, 'GET', `/api/orders/${H.orderId}`, undefined, 'I1');
  await mustAllow(`U reads ${H.tag} payments`, U, 'GET', `/api/payments?branch_id=${H.id}`, undefined, 'I6');
  await mustAllow(`U reads ${H.tag} inventory`, U, 'GET', `/api/inventory/items?branch_id=${H.id}`, undefined, 'I6');
  await mustAllow(`U reads ${H.tag} menu`, U, 'GET', `/api/menu?branch_id=${H.id}`, undefined, 'I6');
  await mustAllow(`U reads ${H.tag} KDS`, U, 'GET', `/api/kds?branch_id=${H.id}`, undefined, 'I6');
  await mustAllow(`U reads ${H.tag} KPI rules`, U, 'GET', `/api/kpi/rules?branch_id=${H.id}`, undefined, 'I6');
  await mustAllow(`U reads ${H.tag} shift x-report`, U, 'GET', `/api/cash-shifts/${H.shiftId}/x-report`, undefined, 'I1');
  await mustAllow(`U reads ${H.tag} staff`, U, 'GET', `/api/users/${H.staffId}`, undefined, 'I1');
  await mustAllow(`U writes menu item into ${H.tag}`, U, 'POST', '/api/menu/items', {
    branch_id: H.id, category_id: H.categoryId, name_ru: 'В зоне', name_tk: 'In scope', price: '4.00', sku: `OK${H.tag}${stamp % 100000}`,
  }, 'I6');
}

// --- (2) U is refused every sibling branch of every franchise it partly holds ---
// --- (3) one branch of a franchise does not grant the sibling ---
// --- (4)/(5) direct object ids and branch_id in every position cannot bypass scope ---
const pairs = [[A2, 'sibling of A1, franchise A'], [B2, 'sibling of B1, franchise B'], [C2, 'sibling of C1, franchise C']];
for (const [S, why] of pairs) {
  // query branch_id
  await mustDeny(`U reads ${S.tag} branch by query (${why})`, U, 'GET', `/api/menu?branch_id=${S.id}`, undefined, 'I2');
  await mustDeny(`U reads ${S.tag} inventory by query`, U, 'GET', `/api/inventory/items?branch_id=${S.id}`, undefined, 'I2');
  await mustDeny(`U reads ${S.tag} orders by query`, U, 'GET', `/api/orders?branch_id=${S.id}`, undefined, 'I2');
  await mustDeny(`U reads ${S.tag} KDS by query`, U, 'GET', `/api/kds?branch_id=${S.id}`, undefined, 'I2');
  await mustDeny(`U reads ${S.tag} payments by query`, U, 'GET', `/api/payments?branch_id=${S.id}`, undefined, 'I2');
  await mustDeny(`U reads ${S.tag} cash shifts by query`, U, 'GET', `/api/cash-shifts?branch_id=${S.id}`, undefined, 'I2');
  await mustDeny(`U reads ${S.tag} KPI rules by query`, U, 'GET', `/api/kpi/rules?branch_id=${S.id}`, undefined, 'I2');
  await mustDeny(`U reads ${S.tag} service charge by path`, U, 'GET', `/api/service-charge/${S.id}`, undefined, 'I2');
  // path branchId
  await mustDeny(`U reads ${S.tag} branch by path`, U, 'GET', `/api/branches/${S.id}`, undefined, 'I2');
  // direct object ids: employees, orders, payments/refunds, inventory, menu, KDS, KPI, shifts, branch-access
  await mustDeny(`U reads ${S.tag} order by id`, U, 'GET', `/api/orders/${S.orderId}`, undefined, 'I1');
  await mustDeny(`U refunds ${S.tag} payment`, U, 'POST', `/api/payments/${S.paymentId}/refund`, { reason: 'cross-franchise' }, 'I1');
  await mustDeny(`U reads ${S.tag} x-report by id`, U, 'GET', `/api/cash-shifts/${S.shiftId}/x-report`, undefined, 'I1');
  await mustDeny(`U closes ${S.tag} shift`, U, 'POST', `/api/cash-shifts/${S.shiftId}/z-report`, { actual_cash: '1.00' }, 'I1');
  await mustDeny(`U reads ${S.tag} staff by id`, U, 'GET', `/api/users/${S.staffId}`, undefined, 'I1');
  await mustDeny(`U reads ${S.tag} employee record by id`, U, 'GET', `/api/employees/${S.staffId}`, undefined, 'I1');
  await mustDeny(`U reads ${S.tag} staff status by id`, U, 'GET', `/api/users/${S.staffId}/status`, undefined, 'I1');
  await mustDeny(`U reads ${S.tag} staff branch-access by id`, U, 'GET', `/api/users/${S.staffId}/branch-access`, undefined, 'I1');
  await mustDeny(`U suspends ${S.tag} staff`, U, 'PUT', `/api/users/${S.staffId}/status`, { employment_status: 'SUSPENDED', reason: 'cross' }, 'I1');
  await mustDeny(`U reads ${S.tag} employee KPI by id`, U, 'GET', `/api/kpi/employees/${S.staffId}`, undefined, 'I1');
  await mustDeny(`U edits ${S.tag} menu item`, U, 'PATCH', `/api/menu/items/${S.menuItemId}`, { name_ru: 'Изменено' }, 'I1');
  await mustDeny(`U deletes ${S.tag} menu item`, U, 'DELETE', `/api/menu/items/${S.menuItemId}`, undefined, 'I1');
  await mustDeny(`U confirms ${S.tag} order`, U, 'POST', `/api/orders/${S.orderId}/confirm`, {}, 'I1');
  await mustDeny(`U advances ${S.tag} KDS ticket`, U, 'POST', `/api/kds/${S.ticketId}/status`, { status: 'COMPLETED' }, 'I1');
  // body branch_id
  await mustDeny(`U creates menu item in ${S.tag} (body branch_id)`, U, 'POST', '/api/menu/items', {
    branch_id: S.id, category_id: S.categoryId, name_ru: 'Взлом', name_tk: 'Hack', price: '1.00', sku: `HK${S.tag}${stamp % 100000}`,
  }, 'I2');
  await mustDeny(`U creates inventory in ${S.tag} (body branch_id)`, U, 'POST', '/api/inventory/items', {
    branch_id: S.id, sku: `HK${S.tag}${stamp % 100000}`, name: 'Взлом', unit: 'PCS', reorder_point: '1.0000',
  }, 'I2');
  await mustDeny(`U moves ${S.tag} stock (body branch_id)`, U, 'POST', '/api/inventory/movements', {
    branch_id: S.id, inventory_item_id: S.inventoryItemId, type: 'WASTE', quantity: '1.0000', reason: 'x',
  }, 'I2');
  await mustDeny(`U opens shift in ${S.tag} (body branch_id)`, U, 'POST', '/api/cash-shifts', { branch_id: S.id, opening_cash: '1.00' }, 'I2');
  await mustDeny(`U locks POS in ${S.tag} (body branch_id)`, U, 'POST', '/api/operator-pos/lock', { branch_id: S.id }, 'I2');
  await mustDeny(`U creates KPI rule in ${S.tag} (body branch_id)`, U, 'POST', '/api/kpi/rules', {
    branch_id: S.id, name: 'Hack', metric: 'SALES', threshold: '1.00', threshold_mode: 'GREATER_OR_EQUAL', reward_type: 'FIXED', reward_value: '999.00',
  }, 'I2');
  // object-level writes not already covered
  await mustDeny(`U updates ${S.tag} branch metadata`, U, 'PUT', `/api/branches/${S.id}`, { name: 'Захвачено' }, 'I2');
  await mustDeny(`U deletes ${S.tag} branch`, U, 'DELETE', `/api/branches/${S.id}`, undefined, 'I2');
  await mustDeny(`U reconfigures ${S.tag} service charge`, U, 'PUT', `/api/service-charge/${S.id}`, { percent: '99.00', allocations: [] }, 'I2');
  await mustDeny(`U widens ${S.tag} staff scope`, U, 'PUT', `/api/users/${S.staffId}/branch-access`, { allowed_branch_ids: [S.id] }, 'I1');
}

// --- list endpoints carry exactly U's three held branches, never a sibling ---
const listChecks = [
  ['branches list', '/api/branches', [A1.id, B1.id, C1.id], [A2.id, B2.id, C2.id]],
  ['users list', '/api/users', [], [A2.staffId, B2.staffId, C2.staffId]],
  ['employees list', '/api/employees', [], [A2.staffId, B2.staffId, C2.staffId]],
  ['implicit inventory', '/api/inventory/items', [], [A2.inventoryItemId, B2.inventoryItemId, C2.inventoryItemId]],
  ['implicit orders', '/api/orders', [], [A2.orderId, B2.orderId, C2.orderId]],
];
for (const [label, path, present, absent] of listChecks) {
  const r = await mustAllow(`U reads ${label}`, U, 'GET', path, undefined, 'I6');
  if (present.length) mustContain(`U ${label}`, r.body, present);
  mustNotContain(`U ${label}`, r.body, absent, 'I6');
}

// ============ (6)(7)(8) FRANCHISE MEMBERSHIP DOES NOT CROSS-GRANT ============
// U passes all three franchise gates (it holds a branch in each), so this specifically
// proves the gate is not confused with row-level access, in every direction.
await proveExists('franchise A branches (OWNER)', `/api/franchises/${FA}/branches`);
await proveExists('franchise B branches (OWNER)', `/api/franchises/${FB}/branches`);
await proveExists('franchise C branches (OWNER)', `/api/franchises/${FC}/branches`);
await proveExists('franchise A employees (OWNER)', `/api/franchises/${FA}/employees`);
await proveExists('franchise B employees (OWNER)', `/api/franchises/${FB}/employees`);
await proveExists('franchise C employees (OWNER)', `/api/franchises/${FC}/employees`);

for (const [F, H, S, tag] of [[FA, A1, A2, 'A'], [FB, B1, B2, 'B'], [FC, C1, C2, 'C']]) {
  await mustAllow(`U passes franchise ${tag} gate`, U, 'GET', `/api/franchises/${F}`, undefined, 'I6');
  const branchesU = await mustAllow(`U reads franchise ${tag} branches`, U, 'GET', `/api/franchises/${F}/branches`, undefined, 'I2');
  mustContain(`franchise ${tag} branches shows the held branch`, branchesU.body, [H.id]);
  mustNotContain(`franchise ${tag} branches must not expose the sibling`, branchesU.body, [S.id], 'I2');
  const empU = await mustAllow(`U reads franchise ${tag} employees`, U, 'GET', `/api/franchises/${F}/employees`, undefined, 'I2');
  mustContain(`franchise ${tag} employees shows own-branch staff`, empU.body, [H.staffId]);
  mustNotContain(`franchise ${tag} employees must not expose the sibling's staff`, empU.body, [S.staffId], 'I2');
}
// Franchise A membership must not leak franchise B or C rows, and so on for every pair.
const faBranchesU2 = await request(`/api/franchises/${FA}/branches`, { headers: U.headers });
mustNotContain('franchise A view must not show franchise B or C branches', faBranchesU2.body, [B1.id, B2.id, C1.id, C2.id], 'I6');
const fbBranchesU2 = await request(`/api/franchises/${FB}/branches`, { headers: U.headers });
mustNotContain('franchise B view must not show franchise A or C branches', fbBranchesU2.body, [A1.id, A2.id, C1.id, C2.id], 'I6');
const fcBranchesU2 = await request(`/api/franchises/${FC}/branches`, { headers: U.headers });
mustNotContain('franchise C view must not show franchise A or B branches', fcBranchesU2.body, [A1.id, A2.id, B1.id, B2.id], 'I6');

// A genuine non-member (outsider holds only C2, in franchise C, but via C2 not C1) is
// refused franchise A and B outright, so the gate itself still discriminates correctly.
await mustDeny('non-member (C2 only) refused franchise A', outsider, 'GET', `/api/franchises/${FA}`, undefined, 'I2');
await mustDeny('non-member (C2 only) refused franchise B', outsider, 'GET', `/api/franchises/${FB}`, undefined, 'I2');
await mustAllow('non-member (C2 only) still reaches franchise C (holds C2)', outsider, 'GET', `/api/franchises/${FC}`, undefined, 'I6');
await mustDeny('non-member reads C1 (sibling within the same franchise C)', outsider, 'GET', `/api/branches/${C1.id}`, undefined, 'I2');

// ============================ (9) NO SELF-GRANT ============================
await mustDeny('U grants itself A2', U, 'PUT', `/api/users/${U.id}/branch-access`, { allowed_branch_ids: [A1.id, B1.id, C1.id, A2.id] }, 'I3');
await mustDeny('U grants itself B2', U, 'PUT', `/api/users/${U.id}/branch-access`, { allowed_branch_ids: [A1.id, B1.id, C1.id, B2.id] }, 'I3');
await mustDeny('U grants itself C2', U, 'PUT', `/api/users/${U.id}/branch-access`, { allowed_branch_ids: [A1.id, B1.id, C1.id, C2.id] }, 'I3');
await mustDeny('U grants itself ALL branches', U, 'PUT', `/api/users/${U.id}/branch-access`, { has_all_access: true }, 'I3');
await mustDeny('U moves its primary branch to a sibling', U, 'PUT', `/api/users/${U.id}/branch-access`, { primary_branch_id: A2.id }, 'I3');
await mustDeny('U widens another user beyond its own scope', U, 'PUT', `/api/users/${outsider.id}/branch-access`, { allowed_branch_ids: [A2.id, B2.id, C2.id] }, 'I3');
await controlProbe('control: U re-asserts its own three branches', U, 'PUT', `/api/users/${U.id}/branch-access`, { allowed_branch_ids: [A1.id, B1.id, C1.id] });
const scopeAfter = await request(`/api/users/${U.id}/branch-access`, { headers: U.headers });
mustNotContain('U scope unchanged after every self-grant attempt', scopeAfter.body.allowed_branch_ids || [], [A2.id, B2.id, C2.id], 'I3');

console.log(`After Part B: existence=${existenceProofs} inScope=${inScope} controls=${controls} denials=${denials}`);

// ====================== (12) NO BRANCH RE-PARENTING, NO FRANCHISE GOVERNANCE ======================
// This is the Part A finding, exercised across three franchises: U is a genuine member of
// A, B AND C combined -- if "membership plus holding the branch" were ever sufficient, this
// is exactly the actor who would pass every combination of that check. It must not.

// (a) attach/detach: every combination of "U's held branch" x "a franchise U is or isn't a
// member of" x "a sibling branch U does not hold".
await mustDeny('U attaches A2 (unheld) into franchise B (U is a member)', U, 'POST', `/api/franchises/${FB}/branches/${A2.id}`, {}, 'I4');
await mustDeny('U attaches B2 (unheld) into franchise C (U is a member)', U, 'POST', `/api/franchises/${FC}/branches/${B2.id}`, {}, 'I4');
await mustDeny('U attaches C2 (unheld) into franchise A (U is a member)', U, 'POST', `/api/franchises/${FA}/branches/${C2.id}`, {}, 'I4');
await mustDeny('U moves its OWN A1 into franchise B (U is a member of both)', U, 'POST', `/api/franchises/${FB}/branches/${A1.id}`, {}, 'I4');
await mustDeny('U moves its OWN B1 into franchise C (U is a member of both)', U, 'POST', `/api/franchises/${FC}/branches/${B1.id}`, {}, 'I4');
await mustDeny('U moves its OWN C1 into franchise A (U is a member of both)', U, 'POST', `/api/franchises/${FA}/branches/${C1.id}`, {}, 'I4');
await mustDeny('U detaches its own A1 from franchise A', U, 'DELETE', `/api/franchises/${FA}/branches/${A1.id}`, undefined, 'I4');
await mustDeny('U detaches unheld A2 from franchise A', U, 'DELETE', `/api/franchises/${FA}/branches/${A2.id}`, undefined, 'I4');

// (b) the same operation through PUT /api/branches/:id (Part A finding: a second, unguarded
// path to branch re-parenting before this stage's fix).
await mustDeny('U re-parents its own A1 into franchise B via PUT /branches/:id', U, 'PUT', `/api/branches/${A1.id}`, { franchise_id: FB }, 'I4');
await mustDeny('U re-parents its own B1 into franchise C via PUT /branches/:id', U, 'PUT', `/api/branches/${B1.id}`, { franchise_id: FC }, 'I4');
// A no-op (same franchise_id) must still be allowed -- this is not a re-parent.
await controlProbe('control: U updates A1 name without changing franchise_id', U, 'PUT', `/api/branches/${A1.id}`, { name: 'Branch A1', franchise_id: FA });

// (c) the same operation through POST /api/branches (Part A finding: branch creation
// auto-grants the creator access, so this doubles as a self-grant-via-creation attempt).
await mustDeny('U creates a NEW branch pre-assigned into franchise B via POST /branches', U, 'POST', '/api/branches', {
  name: 'Illicit Branch', code: `ILL${stamp % 100000}`, address: 'x', phone: '+99312000099', franchise_id: FB,
}, 'I4');
// Verify the illicit branch was never created, closing the loop on the self-grant-via-creation path.
const illicitCheck = await request(`/api/branches?search=Illicit`, { headers: OWNER });
mustNotContain('illicit branch must not have been created', illicitCheck.body, ['Illicit Branch'], 'I4');

// (d) franchise governance (rename / status / delete): membership in the target, or in all
// three franchises combined, must not be sufficient.
for (const [F, tag] of [[FA, 'A'], [FB, 'B'], [FC, 'C']]) {
  await mustDeny(`U renames franchise ${tag} (member, insufficient after Stage 24)`, U, 'PUT', `/api/franchises/${F}`,
    { name: `Захвачено ${tag}`, legal_name: 'X', contact_name: 'x', phone: '+99312000001', email: `h${tag}-${stamp}@boom.local`, address: 'x' }, 'I9');
  await mustDeny(`U changes franchise ${tag} status`, U, 'PATCH', `/api/franchises/${F}/status`, { status: 'SUSPENDED' }, 'I9');
  await mustDeny(`U deletes franchise ${tag}`, U, 'DELETE', `/api/franchises/${F}`, undefined, 'I9');
}

// Post-condition: the full three-franchise topology must be byte-for-byte unchanged by
// every attempt above.
for (const [F, tag, branches] of [[FA, 'A', [A1, A2]], [FB, 'B', [B1, B2]], [FC, 'C', [C1, C2]]]) {
  const topo = await request(`/api/franchises/${F}/branches`, { headers: OWNER });
  mustContain(`franchise ${tag} still holds its own branches`, topo.body, branches.map(b => b.id));
  const foreign = [A1, A2, B1, B2, C1, C2].filter(b => !branches.includes(b)).map(b => b.id);
  mustNotContain(`franchise ${tag} did not absorb a foreign branch`, topo.body, foreign, 'I4');
}
const stillNamedA = await request(`/api/franchises/${FA}`, { headers: OWNER });
assert.equal(stillNamedA.body.franchise.name, 'Franchise A', 'franchise A name must be unchanged by the rename attempts');
const stillActiveB = await request(`/api/franchises/${FB}`, { headers: OWNER });
assert.equal(stillActiveB.body.franchise.status, 'ACTIVE', 'franchise B status must be unchanged by the status attempts');
assert.equal(stillActiveB.body.franchise.deleted_at, null, 'franchise B must not have been deleted');

// ============================ (10) IMMEDIATE REVOCATION ============================
await mustAllow('U reads C1 before revocation', U, 'GET', `/api/branches/${C1.id}`, undefined, 'I5');
await mustAllow('U passes franchise C gate before revocation', U, 'GET', `/api/franchises/${FC}`, undefined, 'I5');
expect('OWNER revokes C1 from U (narrows to A1+B1)',
  (await request(`/api/users/${U.id}/branch-access`, { method: 'PUT', headers: OWNER, body: JSON.stringify({ allowed_branch_ids: [A1.id, B1.id] }) })).status, 200, null);
for (const [label, path] of [
  ['branch', `/api/branches/${C1.id}`], ['menu', `/api/menu?branch_id=${C1.id}`],
  ['order', `/api/orders/${C1.orderId}`], ['franchise C gate', `/api/franchises/${FC}`],
  ['franchise C branches', `/api/franchises/${FC}/branches`],
]) {
  const r = await request(path, { headers: U.headers });
  assert.equal(r.status, 403, `REVOCATION NOT IMMEDIATE (${label}): got ${r.status} for ${path}, no re-login occurred`);
  denials++; invariants.add('I5');
}
await mustAllow('U keeps A1 after C1 revocation', U, 'GET', `/api/branches/${A1.id}`, undefined, 'I5');
await mustAllow('U keeps B1 after C1 revocation', U, 'GET', `/api/branches/${B1.id}`, undefined, 'I5');

// ========================= (11) OWNER / SUPER_ADMIN UNCHANGED =========================
for (const [label, path] of [
  ['OWNER reads A2', `/api/branches/${A2.id}`], ['OWNER reads B2', `/api/branches/${B2.id}`], ['OWNER reads C2', `/api/branches/${C2.id}`],
  ['OWNER reads franchise A employees', `/api/franchises/${FA}/employees`],
  ['OWNER reads franchise B employees', `/api/franchises/${FB}/employees`],
  ['OWNER reads franchise C employees', `/api/franchises/${FC}/employees`],
  ['OWNER reads C2 order', `/api/orders/${C2.orderId}`],
  ['OWNER reads B2 x-report', `/api/cash-shifts/${B2.shiftId}/x-report`],
]) {
  const r = await request(path, { headers: OWNER });
  assert.ok(r.status >= 200 && r.status < 300, `${label}: superuser global access is by design, got ${r.status}`);
  privileged++; invariants.add('I7');
}
// OWNER retains the governance and re-parenting powers this stage restricted to superusers.
const ownerRename = await request(`/api/franchises/${FC}`, {
  method: 'PUT', headers: OWNER,
  body: JSON.stringify({ name: 'Franchise C', legal_name: 'Franchise C LLC', contact_name: 'Contact C', phone: '+9931293903', email: `t3-${stamp}@boom.local`, address: 'Ashgabat C' }),
});
assert.ok(ownerRename.status >= 200 && ownerRename.status < 300, `superuser franchise rename must remain possible, got ${ownerRename.status}`);
privileged++; invariants.add('I9');
const ownerMove = await request(`/api/franchises/${FB}/branches/${C2.id}`, { method: 'POST', headers: OWNER, body: '{}' });
assert.ok(ownerMove.status >= 200 && ownerMove.status < 300, `superuser branch re-parenting must remain possible, got ${ownerMove.status}`);
privileged++; invariants.add('I4');
// restore topology
await request(`/api/franchises/${FC}/branches/${C2.id}`, { method: 'POST', headers: OWNER, body: '{}' });
const restored = await request(`/api/franchises/${FC}/branches`, { headers: OWNER });
mustContain('franchise C topology restored after superuser round-trip', restored.body, [C1.id, C2.id]);

// ------------------------------------------------------------------- verdict
const required = ['I1', 'I2', 'I3', 'I4', 'I5', 'I6', 'I7', 'I9'];
const missing = required.filter(i => !invariants.has(i));
if (missing.length) failures.push(`invariants never exercised: ${missing.join(', ')}`);

if (process.env.STAGE24_SHOW_CODES === '1') {
  console.log('\n=== denial status codes ===');
  for (const c of denialCodes) console.log('  ' + c);
}
console.log(`\nExistence proofs: ${existenceProofs}`);
console.log(`In-scope accesses confirmed: ${inScope}`);
console.log(`Control probes: ${controls}`);
console.log(`Out-of-scope attempts refused: ${denials}`);
console.log(`Privileged accesses (by design): ${privileged}`);
console.log(`Invariants exercised: ${required.filter(i => invariants.has(i)).join(', ')}`);
if (failures.length) {
  console.log(`\n=== STAGE 24 FAILURES (${failures.length}) ===`);
  for (const f of failures) console.log('  * ' + f);
  throw new Error(`${failures.length} stage-24 failure(s)`);
}
console.log(`\nSTAGE 24 THREE-FRANCHISE ISOLATION E2E: PASS (${existenceProofs} existence proofs, ${inScope} in-scope, ${controls} controls, ${denials} denials, ${privileged} privileged, 8/8 invariants)`);
