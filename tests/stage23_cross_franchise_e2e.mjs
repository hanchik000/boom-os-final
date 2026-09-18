// BOOM OS — cross-franchise user authorization and authorization invariants.
//
// Topology: Franchise A = { A1, A2 }, Franchise B = { B1, B2 }, every branch fully
// operational (menu, inventory, table, waiter, order, KDS ticket, cash shift, payment).
//
// The subject U is a non-superuser holding A1 and B1 — one branch in each franchise —
// and must never reach A2 or B2, even though it passes both franchise gates.
//
// Methodology from Stage 21/22: existence proofs before every denial, control probes so a
// refusal is never credited to payload validation, and in-scope assertions so a
// deny-everything regression would fail.
//
// Requires an empty database: it bootstraps the first OWNER itself.
// Usage: BOOM_OS_PORT=3000 node tests/stage23_cross_franchise_e2e.mjs
import assert from 'node:assert/strict';

const base = `http://127.0.0.1:${process.env.BOOM_OS_PORT || 3000}`;
const ownerPassword = process.env.STAGE23_OWNER_PASSWORD || 'BoomCrossOwner23!';
const staffPassword = 'CrossStaffPass12345!';
const stamp = Date.now();

let denials = 0, existenceProofs = 0, controls = 0, privileged = 0, inScope = 0;
const failures = [];
const denialCodes = [];
const invariants = new Set();

async function request(path, options = {}) {
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
  body: JSON.stringify({ full_name: 'Cross Owner', email: `owner23-${stamp}@boom.local`, password: ownerPassword }),
});
expect('bootstrap owner', owner.status, 201, owner.body);
const OWNER = { authorization: `Bearer ${owner.body.token}` };

async function makeFranchise(tag, n) {
  const f = await request('/api/franchises', {
    method: 'POST', headers: OWNER,
    body: JSON.stringify({
      name: `Franchise ${tag}`, code: `X${tag}${stamp % 100000}`, legal_name: `Franchise ${tag} LLC`,
      contact_name: `Contact ${tag}`, phone: `+9931293${n}`, email: `x${tag}-${stamp}@boom.local`, address: `Ashgabat ${tag}`,
    }),
  });
  expect(`create franchise ${tag}`, f.status, 201, f.body);
  return f.body.franchise.id;
}

// A fully operational branch: everything the direct-object probes need.
async function makeBranch(tag, n, franchiseId) {
  const branch = await request('/api/branches', {
    method: 'POST', headers: OWNER,
    body: JSON.stringify({ name: `Branch ${tag}`, code: `${tag}${stamp % 100000}`, address: `Ashgabat ${tag}`, phone: `+9931204${n}`, franchise_id: franchiseId }),
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
    body: JSON.stringify({ branch_id: id, category_id: category.body.category.id, name_ru: `Блюдо ${tag}`, name_tk: `Nahar ${tag}`, price: '40.00', sku: `SK${tag}${stamp % 100000}` }),
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
  const wauth = await request('/api/waiters/authenticate-code', { method: 'POST', body: JSON.stringify({ code, deviceId: `x-${tag}-${stamp}` }) });
  expect(`waiter session ${tag}`, wauth.status, 200, wauth.body);

  const order = await request('/api/orders', {
    method: 'POST', headers: { 'x-waiter-session': wauth.body.session.token, 'Idempotency-Key': `x-${tag}-${stamp}` },
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
    method: 'POST', headers: { ...pos, 'Idempotency-Key': `xp-${tag}-${stamp}` },
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
const A1 = await makeBranch('A1', '1', FA);
const A2 = await makeBranch('A2', '2', FA);
const B1 = await makeBranch('B1', '3', FB);
const B2 = await makeBranch('B2', '4', FB);

console.log(`Setup: FA=${FA} [A1,A2]  FB=${FB} [B1,B2]`);

// ---------------------------------------------------------------- subject U
// A dedicated role so every refusal below is a branch/franchise decision, never a missing
// permission. franchises.delete is included for the same reason as in Stage 22.
const permsList = await request('/api/permissions', { headers: OWNER });
expect('list permissions', permsList.status, 200, permsList.body);
const permRows = permsList.body.permissions || permsList.body || [];
const wanted = [
  'franchises.view', 'franchises.update', 'franchises.delete',
  'branches.view', 'branches.update', 'branches.delete',
  'users.view', 'users.update', 'users.delete', 'employees.view', 'employees.update',
  'menu.view', 'menu.manage', 'tables.view', 'tables.manage',
  'orders.view', 'orders.confirm', 'payments.view', 'payments.create', 'payments.refund',
  'cash_shifts.view', 'cash_shifts.open', 'cash_shifts.close', 'kds.view', 'kds.update',
  'inventory.view', 'inventory.manage', 'inventory.purchase', 'inventory.access',
  'kpi.view', 'kpi.manage', 'service_charge.view', 'service_charge.manage', 'pos.operator',
];
const permIds = wanted.map(c => (permRows.find(p => p.code === c) || {}).id).filter(Boolean);
assert.equal(permIds.length, wanted.length,
  `expected all ${wanted.length} test permissions to resolve, got ${permIds.length}`);

const crossRole = await request('/api/roles', {
  method: 'POST', headers: OWNER,
  body: JSON.stringify({
    code: `CROSS_OPERATOR_${stamp % 100000}`, name: 'Cross-franchise operator (test)',
    description: 'Operational + franchise permissions, branch-scoped', permission_ids: permIds,
  }),
});
expect('create cross-franchise role', crossRole.status, 201, crossRole.body);

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

// U holds one branch in each franchise.
const U = await makeUser('cross', '1', A1.id, [A1.id, B1.id], [crossRole.body.role.code]);
const me = await request('/api/auth/me', { headers: U.headers });
expect('U /me', me.status, 200, me.body);
assert.ok(!me.body.user.roleCodes.some(r => ['OWNER', 'SUPER_ADMIN'].includes(r)), 'U must not be a superuser');

// ===================== PART 1 — CROSS-FRANCHISE BRANCH SCOPE =====================

// Existence proofs for every out-of-scope object U will be denied.
for (const [label, path] of [
  ['A2 branch', `/api/branches/${A2.id}`], ['B2 branch', `/api/branches/${B2.id}`],
  ['A2 order', `/api/orders/${A2.orderId}`], ['B2 order', `/api/orders/${B2.orderId}`],
  ['A2 menu', `/api/menu?branch_id=${A2.id}`], ['B2 menu', `/api/menu?branch_id=${B2.id}`],
  ['A2 inventory', `/api/inventory/items?branch_id=${A2.id}`], ['B2 inventory', `/api/inventory/items?branch_id=${B2.id}`],
  ['A2 KDS', `/api/kds?branch_id=${A2.id}`], ['B2 KDS', `/api/kds?branch_id=${B2.id}`],
  ['A2 shifts', `/api/cash-shifts?branch_id=${A2.id}`], ['B2 shifts', `/api/cash-shifts?branch_id=${B2.id}`],
  ['A2 x-report', `/api/cash-shifts/${A2.shiftId}/x-report`], ['B2 x-report', `/api/cash-shifts/${B2.shiftId}/x-report`],
  ['A2 payments', `/api/payments?branch_id=${A2.id}`], ['B2 payments', `/api/payments?branch_id=${B2.id}`],
  ['A2 staff', `/api/users/${A2.staffId}`], ['B2 staff', `/api/users/${B2.staffId}`],
  ['A2 employee', `/api/employees/${A2.staffId}`], ['B2 employee', `/api/employees/${B2.staffId}`],
  ['A2 employee KPI', `/api/kpi/employees/${A2.staffId}`], ['B2 employee KPI', `/api/kpi/employees/${B2.staffId}`],
  ['A2 kpi rules', `/api/kpi/rules?branch_id=${A2.id}`], ['B2 kpi rules', `/api/kpi/rules?branch_id=${B2.id}`],
  ['A2 service charge', `/api/service-charge/${A2.id}`], ['B2 service charge', `/api/service-charge/${B2.id}`],
  ['A2 branch-access target', `/api/users/${A2.staffId}/branch-access`],
]) await proveExists(label, path);

// --- U reaches both of its branches, across two different franchises ---
for (const S of [A1, B1]) {
  await mustAllow(`U reads branch ${S.tag}`, U, 'GET', `/api/branches/${S.id}`, undefined, 'I6');
  await mustAllow(`U reads ${S.tag} menu`, U, 'GET', `/api/menu?branch_id=${S.id}`, undefined, 'I6');
  await mustAllow(`U reads ${S.tag} inventory`, U, 'GET', `/api/inventory/items?branch_id=${S.id}`, undefined, 'I6');
  await mustAllow(`U reads ${S.tag} orders`, U, 'GET', `/api/orders?branch_id=${S.id}`, undefined, 'I6');
  await mustAllow(`U reads ${S.tag} order by id`, U, 'GET', `/api/orders/${S.orderId}`, undefined, 'I1');
  await mustAllow(`U reads ${S.tag} KDS`, U, 'GET', `/api/kds?branch_id=${S.id}`, undefined, 'I6');
  await mustAllow(`U reads ${S.tag} payments`, U, 'GET', `/api/payments?branch_id=${S.id}`, undefined, 'I6');
  await mustAllow(`U reads ${S.tag} shifts`, U, 'GET', `/api/cash-shifts?branch_id=${S.id}`, undefined, 'I6');
  await mustAllow(`U reads ${S.tag} x-report`, U, 'GET', `/api/cash-shifts/${S.shiftId}/x-report`, undefined, 'I1');
  await mustAllow(`U reads ${S.tag} staff`, U, 'GET', `/api/users/${S.staffId}`, undefined, 'I1');
  await mustAllow(`U reads ${S.tag} employee KPI`, U, 'GET', `/api/kpi/employees/${S.staffId}`, undefined, 'I1');
  await mustAllow(`U reads ${S.tag} service charge`, U, 'GET', `/api/service-charge/${S.id}`, undefined, 'I6');
  await mustAllow(`U writes menu item into ${S.tag}`, U, 'POST', '/api/menu/items', {
    branch_id: S.id, category_id: S.categoryId, name_ru: 'В зоне', name_tk: 'In scope', price: '5.00', sku: `OK${S.tag}${stamp % 100000}`,
  }, 'I6');
}

// --- and is refused both out-of-scope branches, one per franchise ---
for (const S of [A2, B2]) {
  const why = S === A2 ? 'same franchise as A1' : 'same franchise as B1';
  // query branch_id
  await mustDeny(`U reads ${S.tag} menu by query (${why})`, U, 'GET', `/api/menu?branch_id=${S.id}`, undefined, 'I2');
  await mustDeny(`U reads ${S.tag} inventory by query`, U, 'GET', `/api/inventory/items?branch_id=${S.id}`, undefined, 'I2');
  await mustDeny(`U reads ${S.tag} orders by query`, U, 'GET', `/api/orders?branch_id=${S.id}`, undefined, 'I2');
  await mustDeny(`U reads ${S.tag} KDS by query`, U, 'GET', `/api/kds?branch_id=${S.id}`, undefined, 'I2');
  await mustDeny(`U reads ${S.tag} payments by query`, U, 'GET', `/api/payments?branch_id=${S.id}`, undefined, 'I2');
  await mustDeny(`U reads ${S.tag} shifts by query`, U, 'GET', `/api/cash-shifts?branch_id=${S.id}`, undefined, 'I2');
  await mustDeny(`U reads ${S.tag} kpi rules by query`, U, 'GET', `/api/kpi/rules?branch_id=${S.id}`, undefined, 'I2');
  // path branchId
  await mustDeny(`U reads ${S.tag} branch by path`, U, 'GET', `/api/branches/${S.id}`, undefined, 'I2');
  await mustDeny(`U reads ${S.tag} service charge by path`, U, 'GET', `/api/service-charge/${S.id}`, undefined, 'I2');
  // direct object ids
  await mustDeny(`U reads ${S.tag} order by id`, U, 'GET', `/api/orders/${S.orderId}`, undefined, 'I1');
  await mustDeny(`U reads ${S.tag} x-report by id`, U, 'GET', `/api/cash-shifts/${S.shiftId}/x-report`, undefined, 'I1');
  await mustDeny(`U reads ${S.tag} staff by id`, U, 'GET', `/api/users/${S.staffId}`, undefined, 'I1');
  await mustDeny(`U reads ${S.tag} employee by id`, U, 'GET', `/api/employees/${S.staffId}`, undefined, 'I1');
  await mustDeny(`U reads ${S.tag} staff status by id`, U, 'GET', `/api/users/${S.staffId}/status`, undefined, 'I1');
  await mustDeny(`U reads ${S.tag} staff history by id`, U, 'GET', `/api/users/${S.staffId}/status-history`, undefined, 'I1');
  await mustDeny(`U reads ${S.tag} staff branch-access by id`, U, 'GET', `/api/users/${S.staffId}/branch-access`, undefined, 'I1');
  await mustDeny(`U reads ${S.tag} employee KPI by id`, U, 'GET', `/api/kpi/employees/${S.staffId}`, undefined, 'I1');
  // writes: body branch_id
  await mustDeny(`U creates menu item in ${S.tag} (body)`, U, 'POST', '/api/menu/items', {
    branch_id: S.id, category_id: S.categoryId, name_ru: 'Взлом', name_tk: 'Hack', price: '1.00', sku: `HK${S.tag}${stamp % 100000}`,
  }, 'I2');
  await mustDeny(`U creates inventory in ${S.tag} (body)`, U, 'POST', '/api/inventory/items', {
    branch_id: S.id, sku: `HK${S.tag}${stamp % 100000}`, name: 'Взлом', unit: 'PCS', reorder_point: '1.0000',
  }, 'I2');
  await mustDeny(`U moves ${S.tag} stock (body)`, U, 'POST', '/api/inventory/movements', {
    branch_id: S.id, inventory_item_id: S.inventoryItemId, type: 'WASTE', quantity: '1.0000', reason: 'x',
  }, 'I2');
  await mustDeny(`U opens shift in ${S.tag} (body)`, U, 'POST', '/api/cash-shifts', { branch_id: S.id, opening_cash: '1.00' }, 'I2');
  await mustDeny(`U locks POS in ${S.tag} (body)`, U, 'POST', '/api/operator-pos/lock', { branch_id: S.id }, 'I2');
  await mustDeny(`U creates KPI rule in ${S.tag} (body)`, U, 'POST', '/api/kpi/rules', {
    branch_id: S.id, name: 'Hack', metric: 'SALES', threshold: '1.00', threshold_mode: 'GREATER_OR_EQUAL', reward_type: 'FIXED', reward_value: '999.00',
  }, 'I2');
  // writes: object level
  await mustDeny(`U edits ${S.tag} menu item`, U, 'PATCH', `/api/menu/items/${S.menuItemId}`, { name_ru: 'Изменено' }, 'I1');
  await mustDeny(`U deletes ${S.tag} menu item`, U, 'DELETE', `/api/menu/items/${S.menuItemId}`, undefined, 'I1');
  await mustDeny(`U confirms ${S.tag} order`, U, 'POST', `/api/orders/${S.orderId}/confirm`, {}, 'I1');
  await mustDeny(`U advances ${S.tag} KDS ticket`, U, 'POST', `/api/kds/${S.ticketId}/status`, { status: 'COMPLETED' }, 'I1');
  await mustDeny(`U refunds ${S.tag} payment`, U, 'POST', `/api/payments/${S.paymentId}/refund`, { reason: 'cross' }, 'I1');
  await mustDeny(`U closes ${S.tag} shift`, U, 'POST', `/api/cash-shifts/${S.shiftId}/z-report`, { actual_cash: '1.00' }, 'I1');
  await mustDeny(`U suspends ${S.tag} staff`, U, 'PUT', `/api/users/${S.staffId}/status`, { employment_status: 'SUSPENDED', reason: 'cross' }, 'I1');
  await mustDeny(`U updates ${S.tag} branch`, U, 'PUT', `/api/branches/${S.id}`, { name: 'Захвачено' }, 'I2');
  await mustDeny(`U deletes ${S.tag} branch`, U, 'DELETE', `/api/branches/${S.id}`, undefined, 'I2');
  await mustDeny(`U reconfigures ${S.tag} service charge`, U, 'PUT', `/api/service-charge/${S.id}`, { percent: '99.00', allocations: [] }, 'I2');
  await mustDeny(`U widens ${S.tag} staff scope`, U, 'PUT', `/api/users/${S.staffId}/branch-access`, { allowed_branch_ids: [S.id] }, 'I1');
}

// --- list endpoints carry exactly the two held branches ---
const listChecks = [
  ['branches list', '/api/branches', [A1.id, B1.id], [A2.id, B2.id]],
  ['users list', '/api/users', [], [A2.staffId, B2.staffId]],
  ['employees list', '/api/employees', [], [A2.staffId, B2.staffId]],
  ['implicit inventory', '/api/inventory/items', [], [A2.inventoryItemId, B2.inventoryItemId]],
  ['implicit orders', '/api/orders', [], [A2.orderId, B2.orderId]],
];
for (const [label, path, present, absent] of listChecks) {
  const r = await mustAllow(`U reads ${label}`, U, 'GET', path, undefined, 'I6');
  if (present.length) mustContain(`U ${label}`, r.body, present);
  mustNotContain(`U ${label}`, r.body, absent, 'I6');
}

// A second subject holding only A2: a member of franchise A and a non-member of franchise B.
// Used wherever a refusal must come from franchise membership rather than a business rule.
const outsider = await makeUser('outsider', '2', A2.id, [A2.id], [crossRole.body.role.code]);

// ============ PART 2 — FRANCHISE ENDPOINTS FOR A CROSS-FRANCHISE USER ============

// U holds one branch in each franchise, so it passes BOTH franchise gates. That must not
// turn into row-level access to the branches it does not hold.
await proveExists('franchise A', `/api/franchises/${FA}`);
await proveExists('franchise B', `/api/franchises/${FB}`);
const faBranchesOwner = await proveExists('franchise A branches (OWNER)', `/api/franchises/${FA}/branches`);
mustContain('franchise A really holds A1 and A2', faBranchesOwner.body, [A1.id, A2.id]);
const fbBranchesOwner = await proveExists('franchise B branches (OWNER)', `/api/franchises/${FB}/branches`);
mustContain('franchise B really holds B1 and B2', fbBranchesOwner.body, [B1.id, B2.id]);
const faEmpOwner = await proveExists('franchise A employees (OWNER)', `/api/franchises/${FA}/employees`);
mustContain('franchise A really employs A2 staff', faEmpOwner.body, [A2.staffId]);
const fbEmpOwner = await proveExists('franchise B employees (OWNER)', `/api/franchises/${FB}/employees`);
mustContain('franchise B really employs B2 staff', fbEmpOwner.body, [B2.staffId]);

// Both gates open for U, because it holds a branch in each.
await mustAllow('U reads franchise A', U, 'GET', `/api/franchises/${FA}`, undefined, 'I6');
await mustAllow('U reads franchise B', U, 'GET', `/api/franchises/${FB}`, undefined, 'I6');
const uFranchises = await mustAllow('U lists franchises', U, 'GET', '/api/franchises', undefined, 'I6');
mustContain('U sees both franchises it has a branch in', uFranchises.body, [FA, FB]);

// Row-level franchise subresources must still be limited to the exact branches held.
const faBranchesU = await mustAllow('U reads franchise A branches', U, 'GET', `/api/franchises/${FA}/branches`, undefined, 'I2');
mustContain('franchise A branches shows the held branch', faBranchesU.body, [A1.id]);
mustNotContain('franchise A branches must not expose the unheld branch', faBranchesU.body, [A2.id], 'I2');
const fbBranchesU = await mustAllow('U reads franchise B branches', U, 'GET', `/api/franchises/${FB}/branches`, undefined, 'I2');
mustContain('franchise B branches shows the held branch', fbBranchesU.body, [B1.id]);
mustNotContain('franchise B branches must not expose the unheld branch', fbBranchesU.body, [B2.id], 'I2');

const faEmpU = await mustAllow('U reads franchise A employees', U, 'GET', `/api/franchises/${FA}/employees`, undefined, 'I2');
mustContain('franchise A employees shows own-branch staff', faEmpU.body, [A1.staffId]);
mustNotContain('franchise A employees must not expose unheld-branch staff', faEmpU.body, [A2.staffId], 'I2');
const fbEmpU = await mustAllow('U reads franchise B employees', U, 'GET', `/api/franchises/${FB}/employees`, undefined, 'I2');
mustContain('franchise B employees shows own-branch staff', fbEmpU.body, [B1.staffId]);
mustNotContain('franchise B employees must not expose unheld-branch staff', fbEmpU.body, [B2.staffId], 'I2');

// Cross-franchise contamination: neither franchise view may show the other's rows.
mustNotContain('franchise A branches must not show franchise B', faBranchesU.body, [B1.id, B2.id], 'I6');
mustNotContain('franchise A employees must not show franchise B staff', faEmpU.body, [B1.staffId, B2.staffId], 'I6');
mustNotContain('franchise B branches must not show franchise A', fbBranchesU.body, [A1.id, A2.id], 'I6');
mustNotContain('franchise B employees must not show franchise A staff', fbEmpU.body, [A1.staffId, A2.staffId], 'I6');

// Invariant 4: moving a branch between franchises stays superuser-only.
await mustDeny('U attaches unheld A2 to franchise B', U, 'POST', `/api/franchises/${FB}/branches/${A2.id}`, {}, 'I4');
await mustDeny('U attaches unheld B2 to franchise A', U, 'POST', `/api/franchises/${FA}/branches/${B2.id}`, {}, 'I4');
await mustDeny('U moves its own A1 into franchise B', U, 'POST', `/api/franchises/${FB}/branches/${A1.id}`, {}, 'I4');
await mustDeny('U detaches unheld A2', U, 'DELETE', `/api/franchises/${FA}/branches/${A2.id}`, undefined, 'I4');
// Franchise METADATA, unlike franchise STRUCTURE, follows the gate contract established in
// Stage 22: a member of the franchise holding franchises.update may edit it. U holds A1 in
// franchise A, so this is allowed by design and is asserted as such rather than being
// re-labelled a vulnerability. The semantics question it raises is recorded in the report.
await mustAllow('U renames franchise A (member with franchises.update — by contract)', U, 'PUT', `/api/franchises/${FA}`,
  { name: `Franchise A ${stamp % 1000}`, legal_name: 'Franchise A LLC', contact_name: 'Contact A', phone: '+99312000001', email: `ha-${stamp}@boom.local`, address: 'Ashgabat A' }, 'I6');
// The genuine franchise-isolation denials use an actor with no branch in the target
// franchise, so the refusal cannot come from a business rule such as "franchise not empty".
await mustDeny('non-member renames franchise B', outsider, 'PUT', `/api/franchises/${FB}`,
  { name: 'Захвачено B', legal_name: 'X', contact_name: 'x', phone: '+99312000002', email: `hb-${stamp}@boom.local`, address: 'x' }, 'I4');
await mustDeny('non-member changes franchise B status', outsider, 'PATCH', `/api/franchises/${FB}/status`, { status: 'INACTIVE' }, 'I4');
await mustDeny('non-member deletes franchise B', outsider, 'DELETE', `/api/franchises/${FB}`, undefined, 'I4');

// Topology must be untouched.
const topoA = await request(`/api/franchises/${FA}/branches`, { headers: OWNER });
mustContain('franchise A topology intact', topoA.body, [A1.id, A2.id]);
mustNotContain('franchise A did not absorb franchise B branches', topoA.body, [B1.id, B2.id], 'I4');
const topoB = await request(`/api/franchises/${FB}/branches`, { headers: OWNER });
mustContain('franchise B topology intact', topoB.body, [B1.id, B2.id]);
mustNotContain('franchise B did not absorb franchise A branches', topoB.body, [A1.id, A2.id], 'I4');

// ==================== PART 3 — /franchises/:id/orders CONTRACT ====================
// The endpoint is a declared, unimplemented integration stub. Its authorization is
// verified; its scoping is NOT claimed, because there is no data path to scope.
const ordersA = await mustAllow('U reads franchise A orders stub', U, 'GET', `/api/franchises/${FA}/orders`, undefined, 'I6');
assert.equal(ordersA.body.connected, false, 'franchise orders must still declare itself unconnected');
assert.deepEqual(ordersA.body.orders, [], 'the unimplemented stub must return no rows');
const ordersOwner = await request(`/api/franchises/${FA}/orders`, { headers: OWNER });
assert.equal(ordersOwner.body.connected, false, 'the stub is unimplemented for superusers too');
assert.deepEqual(ordersOwner.body.orders, [], 'the stub returns no rows for superusers either');
console.log('NOTE: /api/franchises/:id/orders is an unimplemented integration stub (connected:false).');
console.log('      Its authorization gate is verified; branch/franchise scoping of real order');
console.log('      rows is NOT proven and must not be reported as passing.');

// A user with no branch in the franchise is still refused the stub.
await mustDeny('outsider reads franchise B orders stub', outsider, 'GET', `/api/franchises/${FB}/orders`, undefined, 'I2');
await mustDeny('outsider reads franchise B employees', outsider, 'GET', `/api/franchises/${FB}/employees`, undefined, 'I2');

// ==================== PART 5 — REMAINING INVARIANTS ====================

// I3: a user can never widen its own scope, including a cross-franchise holder.
await mustDeny('U grants itself A2', U, 'PUT', `/api/users/${U.id}/branch-access`, { allowed_branch_ids: [A1.id, B1.id, A2.id] }, 'I3');
await mustDeny('U grants itself B2', U, 'PUT', `/api/users/${U.id}/branch-access`, { allowed_branch_ids: [A1.id, B1.id, B2.id] }, 'I3');
await mustDeny('U grants itself ALL branches', U, 'PUT', `/api/users/${U.id}/branch-access`, { has_all_access: true }, 'I3');
await mustDeny('U moves its primary branch out of scope', U, 'PUT', `/api/users/${U.id}/branch-access`, { primary_branch_id: A2.id }, 'I3');
await mustDeny('U widens another user out of its scope', U, 'PUT', `/api/users/${outsider.id}/branch-access`, { allowed_branch_ids: [A2.id, B2.id] }, 'I3');
// Control: staying inside its own scope still works, so the refusals are not a blanket block.
const ctl = await request(`/api/users/${U.id}/branch-access`, {
  method: 'PUT', headers: U.headers, body: JSON.stringify({ allowed_branch_ids: [A1.id, B1.id] }),
});
assert.ok(ctl.status >= 200 && ctl.status < 300,
  `CONTROL PROBE FAILED: re-asserting its own two branches must succeed, got ${ctl.status}`);
controls++;
const scopeAfter = await request(`/api/users/${U.id}/branch-access`, { headers: U.headers });
mustNotContain('U scope unchanged after escalation attempts', scopeAfter.body.allowed_branch_ids || [], [A2.id, B2.id], 'I3');
assert.equal((await request(`/api/branches/${A2.id}`, { headers: U.headers })).status, 403,
  'U must still be refused A2 after all escalation attempts');

// I5: revoking one branch takes effect on the very next request, with no re-login.
await mustAllow('U still reads B1 before revocation', U, 'GET', `/api/branches/${B1.id}`, undefined, 'I5');
expect('OWNER narrows U to A1 only',
  (await request(`/api/users/${U.id}/branch-access`, { method: 'PUT', headers: OWNER, body: JSON.stringify({ allowed_branch_ids: [A1.id] }) })).status, 200, null);
for (const [label, path] of [
  ['branch', `/api/branches/${B1.id}`], ['menu', `/api/menu?branch_id=${B1.id}`],
  ['orders', `/api/orders/${B1.orderId}`], ['franchise B branches', `/api/franchises/${FB}/branches`],
]) {
  const r = await request(path, { headers: U.headers });
  assert.equal(r.status, 403, `REVOCATION NOT IMMEDIATE (${label}): got ${r.status} for ${path}`);
  denials++; invariants.add('I5');
}
await mustAllow('U keeps A1 after revocation', U, 'GET', `/api/branches/${A1.id}`, undefined, 'I5');
// Losing the only branch in franchise B must close that franchise gate too.
await mustDeny('U loses franchise B gate after revocation', U, 'GET', `/api/franchises/${FB}`, undefined, 'I5');

// I7: superuser semantics unchanged.
for (const [label, path] of [
  ['OWNER reads A2', `/api/branches/${A2.id}`], ['OWNER reads B2', `/api/branches/${B2.id}`],
  ['OWNER reads franchise A employees', `/api/franchises/${FA}/employees`],
  ['OWNER reads franchise B employees', `/api/franchises/${FB}/employees`],
  ['OWNER reads A2 order', `/api/orders/${A2.orderId}`],
  ['OWNER reads B2 x-report', `/api/cash-shifts/${B2.shiftId}/x-report`],
]) {
  const r = await request(path, { headers: OWNER });
  assert.ok(r.status >= 200 && r.status < 300, `${label}: superuser global access is by design, got ${r.status}`);
  privileged++; invariants.add('I7');
}
// A superuser may still move a branch between franchises (I4's "unless explicitly authorized").
const ownerMove = await request(`/api/franchises/${FB}/branches/${A2.id}`, { method: 'POST', headers: OWNER, body: '{}' });
assert.ok(ownerMove.status >= 200 && ownerMove.status < 300, `superuser branch move must remain possible, got ${ownerMove.status}`);
privileged++; invariants.add('I4');
await request(`/api/franchises/${FA}/branches/${A2.id}`, { method: 'POST', headers: OWNER, body: '{}' });

// ------------------------------------------------------------------- verdict
const required = ['I1', 'I2', 'I3', 'I4', 'I5', 'I6', 'I7'];
const missing = required.filter(i => !invariants.has(i));
if (missing.length) failures.push(`invariants never exercised: ${missing.join(', ')}`);

if (process.env.STAGE23_SHOW_CODES === '1') {
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
  console.log(`\n=== CROSS-FRANCHISE FAILURES (${failures.length}) ===`);
  for (const f of failures) console.log('  * ' + f);
  throw new Error(`${failures.length} cross-franchise failure(s)`);
}
console.log(`\nSTAGE 23 CROSS-FRANCHISE E2E: PASS (${existenceProofs} existence proofs, ${inScope} in-scope, ${controls} controls, ${denials} denials, ${privileged} privileged, 7/7 invariants)`);
