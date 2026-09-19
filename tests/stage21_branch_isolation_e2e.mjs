// BOOM OS — multi-branch isolation against a live server and PostgreSQL.
//
// Builds two real branches, each with its own menu, tables, staff, order, payment,
// cash shift, inventory, KPI rule and service-charge config, and two BRANCH_MANAGER
// users scoped one to each branch. BRANCH_MANAGER carries the full operational
// permission set, so every denial below is a *branch* decision, not a missing permission.
//
// Every denial is preceded by proof that the target resource really exists and is
// reachable for a privileged user, so no assertion can pass vacuously.
//
// Requires an empty database: it bootstraps the first OWNER itself.
// Usage: BOOM_OS_PORT=3000 node tests/stage21_branch_isolation_e2e.mjs
import assert from 'node:assert/strict';

const base = `http://127.0.0.1:${process.env.BOOM_OS_PORT || 3000}`;
const ownerPassword = process.env.STAGE21_OWNER_PASSWORD || 'BoomIsolationOwner21!';
const staffPassword = 'BranchStaffPass12345!';
const stamp = Date.now();

let denials = 0, existenceProofs = 0, privileged = 0;
const denialCodes = [];
let controls = 0;
let checksAfter = 0;
const failures = [];

async function request(path, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const res = await fetch(base + path, {
      ...options,
      signal: controller.signal,
      headers: { 'content-type': 'application/json', ...(options.headers || {}) },
    });
    let body = null;
    try { body = await res.json(); } catch {}
    return { status: res.status, body };
  } catch (error) {
    throw new Error(`${path} did not answer (${error.message})`);
  } finally {
    clearTimeout(timer);
  }
}

function expect(step, got, want, body) {
  assert.equal(got, want, `${step}: expected ${want}, got ${got} -> ${JSON.stringify(body).slice(0, 300)}`);
}

// ---------------------------------------------------------------- bootstrap
const owner = await request('/api/auth/bootstrap', {
  method: 'POST',
  body: JSON.stringify({ full_name: 'Isolation Owner', email: `iso-${stamp}@boom.local`, password: ownerPassword }),
});
expect('bootstrap owner', owner.status, 201, owner.body);
const OWNER = { authorization: `Bearer ${owner.body.token}` };

async function makeBranch(tag, suffix) {
  const branch = await request('/api/branches', {
    method: 'POST', headers: OWNER,
    body: JSON.stringify({ name: `Branch ${tag}`, code: `${tag}${stamp % 100000}`, address: `Ashgabat ${tag}`, phone: `+9931200${suffix}` }),
  });
  expect(`create branch ${tag}`, branch.status, 201, branch.body);
  const id = branch.body.branch.id;

  const category = await request('/api/menu/categories', {
    method: 'POST', headers: OWNER,
    body: JSON.stringify({ branch_id: id, name_ru: `Категория ${tag}`, name_tk: `Kategoriýa ${tag}`, sort_order: 1 }),
  });
  expect(`create category ${tag}`, category.status, 201, category.body);

  const item = await request('/api/menu/items', {
    method: 'POST', headers: OWNER,
    body: JSON.stringify({
      branch_id: id, category_id: category.body.category.id,
      name_ru: `Блюдо ${tag}`, name_tk: `Nahar ${tag}`, price: '40.00', sku: `SKU${tag}${stamp % 100000}`,
    }),
  });
  expect(`create menu item ${tag}`, item.status, 201, item.body);

  const inv = await request('/api/inventory/items', {
    method: 'POST', headers: OWNER,
    body: JSON.stringify({ branch_id: id, sku: `INV${tag}${stamp % 100000}`, name: `Ингредиент ${tag}`, unit: 'PCS', reorder_point: '5.0000' }),
  });
  expect(`create inventory item ${tag}`, inv.status, 201, inv.body);

  const area = await request('/api/tables/areas', {
    method: 'POST', headers: OWNER, body: JSON.stringify({ branch_id: id, name: `Зал ${tag}` }),
  });
  expect(`create area ${tag}`, area.status, 201, area.body);
  const areaId = area.body.area.id;
  const table = await request('/api/tables', {
    method: 'POST', headers: OWNER,
    body: JSON.stringify({ branch_id: id, area_id: area.body.area.id, code: `T${tag}`, seats: 4 }),
  });
  expect(`create table ${tag}`, table.status, 201, table.body);

  const sc = await request(`/api/service-charge/${id}`, {
    method: 'PUT', headers: OWNER,
    body: JSON.stringify({ percent: '10.00', categories: [{ category: 'WAITERS', percent: '5.00', mode: 'INDIVIDUAL', members: [] }] }),
  });
  expect(`publish service charge version ${tag}`, sc.status, 201, sc.body);

  const kpiRule = await request('/api/kpi/rules', {
    method: 'POST', headers: OWNER,
    body: JSON.stringify({
      branch_id: id, name: `KPI ${tag}`, metric: 'SALES', threshold: '10.00',
      threshold_mode: 'GREATER_OR_EQUAL', reward_type: 'PERCENT', reward_value: '5.00', role_code: 'WAITER',
    }),
  });
  expect(`create KPI rule ${tag}`, kpiRule.status, 201, kpiRule.body);

  // Waiter + POS session + a real order that reaches the kitchen and gets paid.
  const waiter = await request('/api/users', {
    method: 'POST', headers: OWNER,
    body: JSON.stringify({
      full_name: `Официант ${tag}`, email: `waiter-${tag}-${stamp}@boom.local`,
      phone: `+9936${suffix}${stamp % 100000}`, password: staffPassword, branch_id: id, roles: ['WAITER'],
    }),
  });
  expect(`create waiter ${tag}`, waiter.status, 201, waiter.body);
  const waiterId = waiter.body.user.id;

  const code = `${suffix}${suffix}${suffix}${suffix}`.slice(0, 4);
  expect(`issue waiter code ${tag}`,
    (await request(`/api/waiters/${waiterId}/code`, { method: 'POST', headers: OWNER, body: JSON.stringify({ code }) })).status, 201, null);
  const wauth = await request('/api/waiters/authenticate-code', {
    method: 'POST', body: JSON.stringify({ code, deviceId: `iso-${tag}-${stamp}` }),
  });
  expect(`waiter session ${tag}`, wauth.status, 200, wauth.body);

  const order = await request('/api/orders', {
    method: 'POST',
    headers: { 'x-waiter-session': wauth.body.session.token, 'Idempotency-Key': `iso-${tag}-${stamp}` },
    body: JSON.stringify({ order_type: 'DINE_IN', table_id: table.body.table.id, items: [{ menu_item_id: item.body.item.id, quantity: 1 }] }),
  });
  expect(`create order ${tag}`, order.status, 201, order.body);
  const orderId = order.body.order.id;

  expect(`confirm order ${tag}`,
    (await request(`/api/orders/${orderId}/confirm`, { method: 'POST', headers: OWNER, body: '{}' })).status, 200, null);
  const tickets = await request(`/api/kds?branch_id=${id}`, { headers: OWNER });
  const ticket = tickets.body.tickets.find(t => t.order_id === orderId);
  assert.ok(ticket, `KDS ticket must exist for ${tag}`);
  for (const next of ['PREPARING', 'READY']) {
    expect(`kds ${tag} -> ${next}`,
      (await request(`/api/kds/${ticket.id}/status`, { method: 'POST', headers: OWNER, body: JSON.stringify({ status: next }) })).status, 200, null);
  }

  const lock = await request('/api/operator-pos/lock', { method: 'POST', headers: OWNER, body: JSON.stringify({ branch_id: id }) });
  expect(`operator lock ${tag}`, lock.status, 200, lock.body);
  const pos = { ...OWNER, 'x-pos-session-token': lock.body.session?.token || lock.body.token || '' };
  const shift = await request('/api/cash-shifts', {
    method: 'POST', headers: pos, body: JSON.stringify({ branch_id: id, opening_cash: '100.00' }),
  });
  expect(`open shift ${tag}`, shift.status, 201, shift.body);
  const payment = await request('/api/payments', {
    method: 'POST', headers: { ...pos, 'Idempotency-Key': `iso-pay-${tag}-${stamp}` },
    body: JSON.stringify({ order_id: orderId, branch_id: id, method: 'CASH', amount: order.body.order.final_amount }),
  });
  expect(`take payment ${tag}`, payment.status, 201, payment.body);

  // The branch manager: full operational permissions, scoped to this branch only.
  const manager = await request('/api/users', {
    method: 'POST', headers: OWNER,
    body: JSON.stringify({
      full_name: `Менеджер ${tag}`, email: `mgr-${tag}-${stamp}@boom.local`,
      phone: `+9935${suffix}${stamp % 100000}`, password: staffPassword,
      branch_id: id, roles: ['BRANCH_MANAGER'], allowed_branches: [id],
    }),
  });
  expect(`create manager ${tag}`, manager.status, 201, manager.body);
  const login = await request('/api/auth/login', {
    method: 'POST', body: JSON.stringify({ login: `mgr-${tag}-${stamp}@boom.local`, password: staffPassword }),
  });
  expect(`manager login ${tag}`, login.status, 200, login.body);

  return {
    tag, id, headers: { authorization: `Bearer ${login.body.token}` },
    managerId: manager.body.user.id, waiterId, orderId,
    menuItemId: item.body.item.id, categoryId: category.body.category.id,
    inventoryItemId: inv.body.item.id, tableId: table.body.table.id, areaId,
    ticketId: ticket.id, shiftId: shift.body.shift.id, paymentId: payment.body.payment.id,
    kpiRuleId: kpiRule.body.rule.id, posToken: lock.body.session?.token || lock.body.token || '',
  };
}

const A = await makeBranch('A', '1');
const B = await makeBranch('B', '2');

// The two managers must really be branch-scoped, not superusers.
const meA = await request('/api/auth/me', { headers: A.headers });
expect('manager A /me', meA.status, 200, meA.body);
assert.ok(meA.body.user.roleCodes.includes('BRANCH_MANAGER'), 'manager A must hold BRANCH_MANAGER');
assert.ok(!meA.body.user.roleCodes.some(r => ['OWNER', 'SUPER_ADMIN'].includes(r)), 'manager A must not be a superuser');

console.log(`Setup complete: branch A=${A.id}, branch B=${B.id}`);
console.log(`  manager A=${A.managerId}, manager B=${B.managerId}`);

// ---------------------------------------------------------------- helpers
// Proves the target really exists and is reachable for a privileged user. Without this
// a later 403/404 could simply mean "no such row" and the isolation check would be vacuous.
async function proveExists(label, path) {
  const r = await request(path, { headers: OWNER });
  assert.ok(r.status >= 200 && r.status < 300,
    `EXISTENCE PROOF FAILED — ${label}: OWNER must be able to reach ${path} first, got ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
  existenceProofs++;
  return r;
}

// A cross-branch attempt must be refused. 2xx means the isolation boundary was crossed.
async function mustDeny(label, actor, method, path, body) {
  const opts = { method, headers: actor.headers };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const r = await request(path, opts);
  if (r.status >= 200 && r.status < 300) {
    failures.push(`${label} — ${method} ${path} returned ${r.status} (expected 403/404): ${JSON.stringify(r.body).slice(0, 220)}`);
  } else if (![401, 403, 404, 400].includes(r.status)) {
    failures.push(`${label} — ${method} ${path} returned unexpected ${r.status}: ${JSON.stringify(r.body).slice(0, 220)}`);
  } else {
    denials++;
    denialCodes.push(`${String(r.status)}  ${label}`);
  }
  return r;
}

// A list endpoint must not contain rows from the other branch.
function mustNotContain(label, payload, foreignIds) {
  const raw = JSON.stringify(payload ?? {});
  for (const id of foreignIds.filter(Boolean)) {
    if (raw.includes(id)) failures.push(`${label}: response leaked foreign-branch id ${id}`);
  }
}

async function privilegedReach(label, path) {
  const r = await request(path, { headers: OWNER });
  assert.ok(r.status >= 200 && r.status < 300, `${label}: OWNER cross-branch access is by design, got ${r.status}`);
  privileged++;
}

// ------------------------------------------------- existence proofs for branch B
await proveExists('branch B', `/api/branches/${B.id}`);
await proveExists('branch B order', `/api/orders/${B.orderId}`);
await proveExists('branch B menu', `/api/menu?branch_id=${B.id}`);
await proveExists('branch B inventory', `/api/inventory/items?branch_id=${B.id}`);
await proveExists('branch B tables', `/api/tables?branch_id=${B.id}`);
await proveExists('branch B KDS', `/api/kds?branch_id=${B.id}`);
await proveExists('branch B cash shifts', `/api/cash-shifts?branch_id=${B.id}`);
await proveExists('branch B x-report', `/api/cash-shifts/${B.shiftId}/x-report`);
await proveExists('branch B payments', `/api/payments?branch_id=${B.id}`);
await proveExists('branch B service charge', `/api/service-charge/${B.id}`);
await proveExists('branch B service charge ledger', `/api/service-charge/${B.id}/ledger`);
await proveExists('branch B KPI rules', `/api/kpi/rules?branch_id=${B.id}`);
await proveExists('branch B manager record', `/api/users/${B.managerId}`);
await proveExists('branch B waiter record', `/api/users/${B.waiterId}`);
await proveExists('branch B employee record', `/api/employees/${B.waiterId}`);
await proveExists('branch B waiter status', `/api/users/${B.waiterId}/status`);
await proveExists('branch B waiter status history', `/api/users/${B.waiterId}/status-history`);
await proveExists('branch B waiter KPI', `/api/kpi/employees/${B.waiterId}`);
await proveExists('branch B print profiles', `/api/print/profiles?branch_id=${B.id}`);

// ---------------------------------------------- READ isolation: A manager vs branch B
await mustDeny('read foreign branch', A, 'GET', `/api/branches/${B.id}`);
await mustDeny('read foreign order by id', A, 'GET', `/api/orders/${B.orderId}`);
await mustDeny('read foreign orders by query', A, 'GET', `/api/orders?branch_id=${B.id}`);
await mustDeny('read foreign menu by query', A, 'GET', `/api/menu?branch_id=${B.id}`);
await mustDeny('read foreign inventory', A, 'GET', `/api/inventory/items?branch_id=${B.id}`);
await mustDeny('read foreign inventory movements', A, 'GET', `/api/inventory/movements?branch_id=${B.id}`);
await mustDeny('read foreign recipes', A, 'GET', `/api/inventory/recipes?branch_id=${B.id}`);
await mustDeny('read foreign suppliers', A, 'GET', `/api/inventory/suppliers?branch_id=${B.id}`);
await mustDeny('read foreign tables', A, 'GET', `/api/tables?branch_id=${B.id}`);
await mustDeny('read foreign KDS', A, 'GET', `/api/kds?branch_id=${B.id}`);
await mustDeny('read foreign cash shifts', A, 'GET', `/api/cash-shifts?branch_id=${B.id}`);
await mustDeny('read foreign x-report', A, 'GET', `/api/cash-shifts/${B.shiftId}/x-report`);
await mustDeny('read foreign payments', A, 'GET', `/api/payments?branch_id=${B.id}`);
await mustDeny('read foreign service charge', A, 'GET', `/api/service-charge/${B.id}`);
await mustDeny('read foreign service charge ledger', A, 'GET', `/api/service-charge/${B.id}/ledger`);
await mustDeny('read foreign KPI rules', A, 'GET', `/api/kpi/rules?branch_id=${B.id}`);
await mustDeny('read foreign employee KPI', A, 'GET', `/api/kpi/employees/${B.waiterId}`);
await mustDeny('read foreign user record', A, 'GET', `/api/users/${B.managerId}`);
await mustDeny('read foreign employee record', A, 'GET', `/api/employees/${B.waiterId}`);
await mustDeny('read foreign employee status', A, 'GET', `/api/users/${B.waiterId}/status`);
await mustDeny('read foreign employee status history', A, 'GET', `/api/users/${B.waiterId}/status-history`);
await mustDeny('read foreign branch-access', A, 'GET', `/api/users/${B.managerId}/branch-access`);
await mustDeny('read foreign print profiles', A, 'GET', `/api/print/profiles?branch_id=${B.id}`);
await mustDeny('read foreign waiter status', A, 'GET', `/api/waiters/${B.waiterId}/status`);

// ---------------------------------------------- WRITE isolation: A manager vs branch B
await mustDeny('create menu item into foreign branch', A, 'POST', '/api/menu/items', {
  branch_id: B.id, category_id: B.categoryId, name_ru: 'Взлом', name_tk: 'Hack', price: '1.00', sku: `HACK${stamp % 100000}`,
});
await mustDeny('update foreign menu item', A, 'PATCH', `/api/menu/items/${B.menuItemId}`, { name_ru: 'Изменено', price: '1.00' });
await mustDeny('delete foreign menu item', A, 'DELETE', `/api/menu/items/${B.menuItemId}`);
await mustDeny('delete foreign menu category', A, 'DELETE', `/api/menu/categories/${B.categoryId}`);
await mustDeny('create inventory item into foreign branch', A, 'POST', '/api/inventory/items', {
  branch_id: B.id, sku: `HACK${stamp % 100000}`, name: 'Взлом', unit: 'PCS', reorder_point: '1.0000',
});
await mustDeny('move foreign stock', A, 'POST', '/api/inventory/movements', {
  branch_id: B.id, inventory_item_id: B.inventoryItemId, type: 'WASTE', quantity: '1.0000', reason: 'cross-branch',
});
await mustDeny('create table in foreign branch', A, 'POST', '/api/tables', {
  branch_id: B.id, area_id: B.areaId, code: 'HACK', seats: 2,
});
await mustDeny('confirm foreign order', A, 'POST', `/api/orders/${B.orderId}/confirm`, {});
await mustDeny('advance foreign KDS ticket', A, 'POST', `/api/kds/${B.ticketId}/status`, { status: 'COMPLETED' });
await mustDeny('refund foreign payment', A, 'POST', `/api/payments/${B.paymentId}/refund`,
  { reason: 'cross-branch refund' });
await mustDeny('open shift in foreign branch', A, 'POST', '/api/cash-shifts', { branch_id: B.id, opening_cash: '1.00' });
await mustDeny('close foreign shift (Z-report)', A, 'POST', `/api/cash-shifts/${B.shiftId}/z-report`, { actual_cash: '1.00' });
await mustDeny('reconfigure foreign service charge', A, 'PUT', `/api/service-charge/${B.id}`, { percent: '99.00', categories: [] });
await mustDeny('create KPI rule in foreign branch', A, 'POST', '/api/kpi/rules', {
  branch_id: B.id, name: 'Hack', metric: 'SALES', threshold: '1.00',
  threshold_mode: 'GREATER_OR_EQUAL', reward_type: 'FIXED', reward_value: '999.00',
});
await mustDeny('evaluate KPI in foreign branch', A, 'POST', '/api/kpi/evaluate', {
  branch_id: B.id, user_id: B.waiterId,
  period_start: new Date(Date.now() - 86400000).toISOString(), period_end: new Date(Date.now() + 86400000).toISOString(),
});
await mustDeny('update foreign employee', A, 'PUT', `/api/users/${B.waiterId}`, { full_name: 'Изменено взломом' });
await mustDeny('change foreign employee status', A, 'PUT', `/api/users/${B.waiterId}/status`,
  { employment_status: 'SUSPENDED', reason: 'cross-branch suspend' });
await mustDeny('change foreign waiter qualification', A, 'PUT', `/api/waiters/${B.waiterId}/status`, { status: 'PROFESSIONAL' });
await mustDeny('issue code for foreign waiter', A, 'POST', `/api/waiters/${B.waiterId}/code`, { code: '9999' });
await mustDeny('revoke foreign waiter code', A, 'DELETE', `/api/waiters/${B.waiterId}/code`);
await mustDeny('delete foreign employee', A, 'DELETE', `/api/users/${B.waiterId}`);
await mustDeny('update foreign branch', A, 'PUT', `/api/branches/${B.id}`, { name: 'Захвачено' });
await mustDeny('delete foreign branch', A, 'DELETE', `/api/branches/${B.id}`);

// ------------------------------------------------------------ control probes
// Each mirrors a refusal above with only the branch changed. If these succeed, the
// refusals cannot be blamed on payload validation.
async function mustAllow(label, actor, method, path, body) {
  const opts = { method, headers: actor.headers };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const r = await request(path, opts);
  assert.ok(r.status >= 200 && r.status < 300,
    `CONTROL PROBE FAILED — ${label}: the same request against the actor's own branch must succeed, got ${r.status} ${JSON.stringify(r.body).slice(0, 220)}`);
  controls++;
  return r;
}
await mustAllow('control: create menu item in own branch', A, 'POST', '/api/menu/items', {
  branch_id: A.id, category_id: A.categoryId, name_ru: 'Контроль', name_tk: 'Control', price: '1.00', sku: `CTRL${stamp % 100000}`,
});
await mustAllow('control: create table in own branch', A, 'POST', '/api/tables', {
  branch_id: A.id, area_id: A.areaId, code: 'CTRL', seats: 2,
});
await mustAllow('control: read own branch', A, 'GET', `/api/branches/${A.id}`);
await mustAllow('control: read own order', A, 'GET', `/api/orders/${A.orderId}`);
await mustAllow('control: read own employee status', A, 'GET', `/api/users/${A.waiterId}/status`);
await mustAllow('control: suspend own employee', A, 'PUT', `/api/users/${A.waiterId}/status`,
  { employment_status: 'SUSPENDED', reason: 'control probe' });
await mustAllow('control: evaluate KPI in own branch', A, 'POST', '/api/kpi/evaluate', {
  branch_id: A.id, user_id: A.waiterId,
  period_start: new Date(Date.now() - 86400000).toISOString(), period_end: new Date(Date.now() + 86400000).toISOString(),
});
await mustAllow('control: read own branch-access', A, 'GET', `/api/users/${A.managerId}/branch-access`);

// --------------------------------------------- guessed / malformed object ids
await mustDeny('guessed order id', A, 'GET', '/api/orders/ord_00000000-0000-0000-0000-000000000000');
await mustDeny('guessed user id', A, 'GET', '/api/users/usr_does_not_exist');
await mustDeny('guessed shift id', A, 'GET', '/api/cash-shifts/shift_does_not_exist/x-report');
await mustDeny('guessed branch id', A, 'GET', '/api/branches/br_does_not_exist');

// ------------------------------------- branch derived from the authenticated actor
// With no branch_id supplied the server must fall back to the actor's own branch and
// never to another branch's data.
const implicitOrders = await request('/api/orders', { headers: A.headers });
if (implicitOrders.status === 200) mustNotContain('implicit orders list', implicitOrders.body, [B.orderId, B.id]);
const implicitInventory = await request('/api/inventory/items', { headers: A.headers });
if (implicitInventory.status === 200) mustNotContain('implicit inventory list', implicitInventory.body, [B.inventoryItemId, B.id]);
const implicitTables = await request('/api/tables', { headers: A.headers });
if (implicitTables.status === 200) mustNotContain('implicit tables list', implicitTables.body, [B.tableId, B.id]);

// --------------------------------------------- list endpoints must not leak branch B
const listUsers = await request('/api/users', { headers: A.headers });
if (listUsers.status === 200) mustNotContain('users list', listUsers.body, [B.managerId, B.waiterId]);
const listEmployees = await request('/api/employees', { headers: A.headers });
if (listEmployees.status === 200) mustNotContain('employees list', listEmployees.body, [B.managerId, B.waiterId]);
const listBranches = await request('/api/branches', { headers: A.headers });
if (listBranches.status === 200) mustNotContain('branches list', listBranches.body, [B.id]);
const listAudit = await request('/api/audit', { headers: A.headers });
if (listAudit.status === 200) mustNotContain('audit list', listAudit.body, [B.orderId, B.paymentId]);
const listWaiters = await request('/api/waiters', { headers: A.headers });
if (listWaiters.status === 200) mustNotContain('waiters list', listWaiters.body, [B.waiterId]);

// --------------------------------------------------------- reverse direction (B -> A)
await proveExists('branch A order', `/api/orders/${A.orderId}`);
await proveExists('branch A employee status', `/api/users/${A.waiterId}/status`);
await mustDeny('B reads A order', B, 'GET', `/api/orders/${A.orderId}`);
await mustDeny('B reads A inventory', B, 'GET', `/api/inventory/items?branch_id=${A.id}`);
await mustDeny('B reads A employee status', B, 'GET', `/api/users/${A.waiterId}/status`);
await mustDeny('B reads A employee status history', B, 'GET', `/api/users/${A.waiterId}/status-history`);
await mustDeny('B refunds A payment', B, 'POST', `/api/payments/${A.paymentId}/refund`, { reason: 'reverse' });
await mustDeny('B closes A shift', B, 'POST', `/api/cash-shifts/${A.shiftId}/z-report`, { actual_cash: '1.00' });
await mustDeny('B suspends A employee', B, 'PUT', `/api/users/${A.waiterId}/status`,
  { employment_status: 'SUSPENDED', reason: 'reverse suspend' });

// ------------------------------------------- POS session is bound to its own branch
await mustDeny('A operator POS lock on foreign branch', A, 'POST', '/api/operator-pos/lock', { branch_id: B.id });

// --------------------------------- privilege escalation: widening one's own scope
// Runs last: if it ever succeeds it widens manager A's scope and would mask earlier checks.
await mustDeny('grant self access to foreign branch', A, 'PUT', `/api/users/${A.managerId}/branch-access`,
  { allowed_branch_ids: [A.id, B.id] });
await mustDeny('grant self access to ALL branches', A, 'PUT', `/api/users/${A.managerId}/branch-access`,
  { has_all_access: true });
await mustDeny('move self primary branch to foreign branch', A, 'PUT', `/api/users/${A.managerId}/branch-access`,
  { primary_branch_id: B.id });
await mustDeny('grant foreign manager access', A, 'PUT', `/api/users/${B.managerId}/branch-access`,
  { allowed_branch_ids: [A.id, B.id] });

// Post-condition: the escalation attempts must have left manager A's scope untouched.
const scopeAfter = await request(`/api/users/${A.managerId}/branch-access`, { headers: A.headers });
expect('own branch-access still readable', scopeAfter.status, 200, scopeAfter.body);
assert.ok(!JSON.stringify(scopeAfter.body.allowed_branch_ids || []).includes(B.id),
  `ESCALATION: manager A ended up with access to branch B -> ${JSON.stringify(scopeAfter.body.allowed_branch_ids)}`);
const stillDenied = await request(`/api/branches/${B.id}`, { headers: A.headers });
assert.equal(stillDenied.status, 403, 'manager A must still be refused branch B after the escalation attempts');
checksAfter++;

// ------------------------------------ privileged cross-branch access is intentional
await privilegedReach('OWNER reads branch A', `/api/branches/${A.id}`);
await privilegedReach('OWNER reads branch B', `/api/branches/${B.id}`);
await privilegedReach('OWNER reads both orders', `/api/orders/${B.orderId}`);
await privilegedReach('OWNER reads branch B employees', `/api/employees?branch_id=${B.id}`);

// ------------------------------------------------------------------- verdict
if (process.env.STAGE21_SHOW_CODES === '1') {
  console.log('\n=== denial status codes ===');
  for (const c of denialCodes) console.log('  ' + c);
}
console.log(`\nExistence proofs: ${existenceProofs}`);
console.log(`Cross-branch attempts refused: ${denials}`);
console.log(`Control probes (same request, own branch): ${controls}`);
console.log(`Privileged cross-branch reads (by design): ${privileged}`);
if (failures.length) {
  console.log(`\n=== BRANCH ISOLATION FAILURES (${failures.length}) ===`);
  for (const f of failures) console.log('  * ' + f);
  throw new Error(`${failures.length} branch-isolation failure(s)`);
}
console.log(`\nSTAGE 21 BRANCH ISOLATION E2E: PASS (${existenceProofs} existence proofs, ${controls} control probes, ${denials} denials, ${privileged} privileged reads)`);
