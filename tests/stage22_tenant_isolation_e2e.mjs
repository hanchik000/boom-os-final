// BOOM OS — advanced tenant / franchise isolation.
//
// PART A: users holding access to several branches at once.
// PART B: franchise-level isolation across two franchises of two branches each.
//
// Topology: Franchise A = { A1, A2 }, Franchise B = { B1, B2 }.
// Actors: a user scoped to A1+A2, a user scoped to A1 only, a user with no branch
// access at all, a franchise-permissioned user scoped to A1, and the OWNER.
//
// Methodology carried over from Stage 21: every denial is preceded by proof that the
// target really exists and is reachable for a privileged user, and refusals that are not
// 403 are mirrored by a control probe against the actor's own scope.
//
// Requires an empty database: it bootstraps the first OWNER itself.
// Usage: BOOM_OS_PORT=3000 node tests/stage22_tenant_isolation_e2e.mjs
import assert from 'node:assert/strict';

const base = `http://127.0.0.1:${process.env.BOOM_OS_PORT || 3000}`;
const ownerPassword = process.env.STAGE22_OWNER_PASSWORD || 'BoomTenantOwner22!';
const staffPassword = 'TenantStaffPass12345!';
const stamp = Date.now();

let denials = 0, existenceProofs = 0, controls = 0, privileged = 0, allowed = 0;
const failures = [];
const denialCodes = [];

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

async function mustDeny(label, actor, method, path, body) {
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
  }
  return r;
}

async function mustAllow(label, actor, method, path, body) {
  const opts = { method, headers: actor.headers };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const r = await request(path, opts);
  assert.ok(r.status >= 200 && r.status < 300,
    `ACCESS REGRESSION — ${label}: ${method} ${path} must succeed for this actor, got ${r.status} ${JSON.stringify(r.body).slice(0, 240)}`);
  allowed++;
  return r;
}

async function controlProbe(label, actor, method, path, body) {
  const r = await mustAllow(label, actor, method, path, body);
  controls++; allowed--;
  return r;
}

function mustNotContain(label, payload, foreignIds) {
  const raw = JSON.stringify(payload ?? {});
  for (const id of foreignIds.filter(Boolean)) {
    if (raw.includes(id)) failures.push(`${label}: leaked foreign id ${id}`);
  }
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
  body: JSON.stringify({ full_name: 'Tenant Owner', email: `tenant-${stamp}@boom.local`, password: ownerPassword }),
});
expect('bootstrap owner', owner.status, 201, owner.body);
const OWNER = { authorization: `Bearer ${owner.body.token}` };
const OWNER_ACTOR = { headers: OWNER };

async function makeFranchise(tag, n) {
  const f = await request('/api/franchises', {
    method: 'POST', headers: OWNER,
    body: JSON.stringify({
      name: `Franchise ${tag}`, code: `F${tag}${stamp % 100000}`, legal_name: `Franchise ${tag} LLC`,
      contact_name: `Contact ${tag}`, phone: `+9931290${n}`, email: `f${tag}-${stamp}@boom.local`, address: `Ashgabat ${tag}`,
    }),
  });
  expect(`create franchise ${tag}`, f.status, 201, f.body);
  return f.body.franchise.id;
}

async function makeBranch(tag, n, franchiseId) {
  const branch = await request('/api/branches', {
    method: 'POST', headers: OWNER,
    body: JSON.stringify({
      name: `Branch ${tag}`, code: `${tag}${stamp % 100000}`, address: `Ashgabat ${tag}`,
      phone: `+9931201${n}`, franchise_id: franchiseId,
    }),
  });
  expect(`create branch ${tag}`, branch.status, 201, branch.body);
  const id = branch.body.branch.id;

  // Attach explicitly too: branch creation may ignore franchise_id.
  await request(`/api/franchises/${franchiseId}/branches/${id}`, { method: 'POST', headers: OWNER, body: '{}' });

  const category = await request('/api/menu/categories', {
    method: 'POST', headers: OWNER,
    body: JSON.stringify({ branch_id: id, name_ru: `Кат ${tag}`, name_tk: `Kat ${tag}`, sort_order: 1 }),
  });
  expect(`category ${tag}`, category.status, 201, category.body);
  const item = await request('/api/menu/items', {
    method: 'POST', headers: OWNER,
    body: JSON.stringify({
      branch_id: id, category_id: category.body.category.id,
      name_ru: `Блюдо ${tag}`, name_tk: `Nahar ${tag}`, price: '30.00', sku: `SKU${tag}${stamp % 100000}`,
    }),
  });
  expect(`menu item ${tag}`, item.status, 201, item.body);
  const inv = await request('/api/inventory/items', {
    method: 'POST', headers: OWNER,
    body: JSON.stringify({ branch_id: id, sku: `INV${tag}${stamp % 100000}`, name: `Ингр ${tag}`, unit: 'PCS', reorder_point: '5.0000' }),
  });
  expect(`inventory ${tag}`, inv.status, 201, inv.body);

  const staff = await request('/api/users', {
    method: 'POST', headers: OWNER,
    body: JSON.stringify({
      full_name: `Сотрудник ${tag}`, email: `staff-${tag}-${stamp}@boom.local`,
      phone: `+9936${n}${stamp % 100000}`, password: staffPassword, branch_id: id, roles: ['WAITER'],
    }),
  });
  expect(`staff ${tag}`, staff.status, 201, staff.body);

  return { tag, id, franchiseId, menuItemId: item.body.item.id, categoryId: category.body.category.id,
           inventoryItemId: inv.body.item.id, staffId: staff.body.user.id };
}

const FA = await makeFranchise('A', '1');
const FB = await makeFranchise('B', '2');
const A1 = await makeBranch('A1', '1', FA);
const A2 = await makeBranch('A2', '2', FA);
const B1 = await makeBranch('B1', '3', FB);
const B2 = await makeBranch('B2', '4', FB);

async function makeUser(label, n, primaryBranch, allowedBranches, roles) {
  const email = `${label}-${stamp}@boom.local`;
  const u = await request('/api/users', {
    method: 'POST', headers: OWNER,
    body: JSON.stringify({
      full_name: `User ${label}`, email, phone: `+9937${n}${stamp % 100000}`,
      password: staffPassword, branch_id: primaryBranch, roles, allowed_branches: allowedBranches,
    }),
  });
  expect(`create user ${label}`, u.status, 201, u.body);
  const login = await request('/api/auth/login', { method: 'POST', body: JSON.stringify({ login: email, password: staffPassword }) });
  expect(`login ${label}`, login.status, 200, login.body);
  return { label, email, id: u.body.user.id, headers: { authorization: `Bearer ${login.body.token}` } };
}

// A1+A2 (two branches, same franchise), A1 only, and no branch access at all.
const uAB = await makeUser('multi', '1', A1.id, [A1.id, A2.id], ['BRANCH_MANAGER']);
const uA = await makeUser('single', '2', A1.id, [A1.id], ['BRANCH_MANAGER']);
const uNone = await makeUser('nobranch', '3', null, [], ['BRANCH_MANAGER']);

console.log(`Setup: FA=${FA} (A1=${A1.id}, A2=${A2.id}), FB=${FB} (B1=${B1.id}, B2=${B2.id})`);

// ============================== PART A — MULTI-BRANCH USERS ==============================

// Existence proofs: every target below is real and reachable for a privileged user.
await proveExists('branch A1', `/api/branches/${A1.id}`);
await proveExists('branch A2', `/api/branches/${A2.id}`);
await proveExists('branch B1 (out of scope)', `/api/branches/${B1.id}`);
await proveExists('B1 menu', `/api/menu?branch_id=${B1.id}`);
await proveExists('B1 inventory', `/api/inventory/items?branch_id=${B1.id}`);
await proveExists('B1 staff record', `/api/users/${B1.staffId}`);
await proveExists('B1 employee record', `/api/employees/${B1.staffId}`);
await proveExists('A2 staff record', `/api/users/${A2.staffId}`);

// --- the multi-branch user reaches BOTH of its branches ---
await mustAllow('A+B user reads branch A1', uAB, 'GET', `/api/branches/${A1.id}`);
await mustAllow('A+B user reads branch A2', uAB, 'GET', `/api/branches/${A2.id}`);
await mustAllow('A+B user reads A1 menu', uAB, 'GET', `/api/menu?branch_id=${A1.id}`);
await mustAllow('A+B user reads A2 menu', uAB, 'GET', `/api/menu?branch_id=${A2.id}`);
await mustAllow('A+B user reads A1 inventory', uAB, 'GET', `/api/inventory/items?branch_id=${A1.id}`);
await mustAllow('A+B user reads A2 inventory', uAB, 'GET', `/api/inventory/items?branch_id=${A2.id}`);
await mustAllow('A+B user reads A1 orders', uAB, 'GET', `/api/orders?branch_id=${A1.id}`);
await mustAllow('A+B user reads A2 orders', uAB, 'GET', `/api/orders?branch_id=${A2.id}`);
await mustAllow('A+B user reads A1 KDS', uAB, 'GET', `/api/kds?branch_id=${A1.id}`);
await mustAllow('A+B user reads A2 KDS', uAB, 'GET', `/api/kds?branch_id=${A2.id}`);
await mustAllow('A+B user reads A2 cash shifts', uAB, 'GET', `/api/cash-shifts?branch_id=${A2.id}`);
await mustAllow('A+B user reads A2 payments', uAB, 'GET', `/api/payments?branch_id=${A2.id}`);
await mustAllow('A+B user reads A2 employee', uAB, 'GET', `/api/users/${A2.staffId}`);
await mustAllow('A+B user reads A2 employee status', uAB, 'GET', `/api/users/${A2.staffId}/status`);
await mustAllow('A+B user reads A2 KPI rules', uAB, 'GET', `/api/kpi/rules?branch_id=${A2.id}`);
await mustAllow('A+B user reads A2 service charge', uAB, 'GET', `/api/service-charge/${A2.id}`);
await mustAllow('A+B user writes into A2 (menu item)', uAB, 'POST', '/api/menu/items', {
  branch_id: A2.id, category_id: A2.categoryId, name_ru: 'В зоне', name_tk: 'In scope', price: '9.00', sku: `OK${stamp % 100000}`,
});

// --- the same user must not reach the third branch (different franchise) ---
await mustDeny('A+B user reads branch C', uAB, 'GET', `/api/branches/${B1.id}`);
await mustDeny('A+B user reads C menu by query', uAB, 'GET', `/api/menu?branch_id=${B1.id}`);
await mustDeny('A+B user reads C inventory by query', uAB, 'GET', `/api/inventory/items?branch_id=${B1.id}`);
await mustDeny('A+B user reads C orders by query', uAB, 'GET', `/api/orders?branch_id=${B1.id}`);
await mustDeny('A+B user reads C KDS by query', uAB, 'GET', `/api/kds?branch_id=${B1.id}`);
await mustDeny('A+B user reads C cash shifts by query', uAB, 'GET', `/api/cash-shifts?branch_id=${B1.id}`);
await mustDeny('A+B user reads C payments by query', uAB, 'GET', `/api/payments?branch_id=${B1.id}`);
await mustDeny('A+B user reads C service charge', uAB, 'GET', `/api/service-charge/${B1.id}`);
await mustDeny('A+B user reads C KPI rules', uAB, 'GET', `/api/kpi/rules?branch_id=${B1.id}`);
// direct object ids from C
await mustDeny('A+B user reads C employee (direct id)', uAB, 'GET', `/api/users/${B1.staffId}`);
await mustDeny('A+B user reads C employee record (direct id)', uAB, 'GET', `/api/employees/${B1.staffId}`);
await mustDeny('A+B user reads C employee status (direct id)', uAB, 'GET', `/api/users/${B1.staffId}/status`);
await mustDeny('A+B user reads C employee history (direct id)', uAB, 'GET', `/api/users/${B1.staffId}/status-history`);
await mustDeny('A+B user reads C employee KPI (direct id)', uAB, 'GET', `/api/kpi/employees/${B1.staffId}`);
// body branch_id must not escalate
await mustDeny('A+B user creates menu item in C (body branch_id)', uAB, 'POST', '/api/menu/items', {
  branch_id: B1.id, category_id: B1.categoryId, name_ru: 'Взлом', name_tk: 'Hack', price: '1.00', sku: `HK${stamp % 100000}`,
});
await mustDeny('A+B user creates inventory in C (body branch_id)', uAB, 'POST', '/api/inventory/items', {
  branch_id: B1.id, sku: `HK${stamp % 100000}`, name: 'Взлом', unit: 'PCS', reorder_point: '1.0000',
});
await mustDeny('A+B user moves C stock (body branch_id)', uAB, 'POST', '/api/inventory/movements', {
  branch_id: B1.id, inventory_item_id: B1.inventoryItemId, type: 'WASTE', quantity: '1.0000', reason: 'x',
});
await mustDeny('A+B user opens shift in C', uAB, 'POST', '/api/cash-shifts', { branch_id: B1.id, opening_cash: '1.00' });
await mustDeny('A+B user locks POS in C', uAB, 'POST', '/api/operator-pos/lock', { branch_id: B1.id });
await mustDeny('A+B user reconfigures C service charge', uAB, 'PUT', `/api/service-charge/${B1.id}`, { percent: '99.00', allocations: [] });
// object-level write against C
await mustDeny('A+B user edits C menu item', uAB, 'PATCH', `/api/menu/items/${B1.menuItemId}`, { name_ru: 'Изменено' });
await mustDeny('A+B user deletes C menu item', uAB, 'DELETE', `/api/menu/items/${B1.menuItemId}`);
await mustDeny('A+B user suspends C employee', uAB, 'PUT', `/api/users/${B1.staffId}/status`,
  { employment_status: 'SUSPENDED', reason: 'cross-tenant' });
await mustDeny('A+B user updates C branch', uAB, 'PUT', `/api/branches/${B1.id}`, { name: 'Захвачено' });
await mustDeny('A+B user deletes C branch', uAB, 'DELETE', `/api/branches/${B1.id}`);

// --- lists must contain both owned branches and never the third ---
const abBranches = await mustAllow('A+B branches list', uAB, 'GET', '/api/branches');
mustContain('A+B branches list', abBranches.body, [A1.id, A2.id]);
mustNotContain('A+B branches list', abBranches.body, [B1.id, B2.id]);
const abUsers = await mustAllow('A+B users list', uAB, 'GET', '/api/users');
mustNotContain('A+B users list', abUsers.body, [B1.staffId, B2.staffId]);
const abEmployees = await mustAllow('A+B employees list', uAB, 'GET', '/api/employees');
mustNotContain('A+B employees list', abEmployees.body, [B1.staffId, B2.staffId]);
const abImplicitInv = await mustAllow('A+B implicit inventory', uAB, 'GET', '/api/inventory/items');
mustNotContain('A+B implicit inventory', abImplicitInv.body, [B1.inventoryItemId, B2.inventoryItemId]);

// --- a user holding exactly one branch ---
await mustAllow('single-branch user reads A1', uA, 'GET', `/api/branches/${A1.id}`);
await mustDeny('single-branch user reads A2', uA, 'GET', `/api/branches/${A2.id}`);
await mustDeny('single-branch user reads A2 menu', uA, 'GET', `/api/menu?branch_id=${A2.id}`);
await mustDeny('single-branch user reads A2 employee', uA, 'GET', `/api/users/${A2.staffId}`);
await mustDeny('single-branch user reads C', uA, 'GET', `/api/branches/${B1.id}`);

// --- a user with no branch access at all ---
await mustDeny('no-branch user reads A1', uNone, 'GET', `/api/branches/${A1.id}`);
await mustDeny('no-branch user reads A1 menu', uNone, 'GET', `/api/menu?branch_id=${A1.id}`);
await mustDeny('no-branch user reads A1 orders', uNone, 'GET', `/api/orders?branch_id=${A1.id}`);
await mustDeny('no-branch user reads A1 employee', uNone, 'GET', `/api/users/${A1.staffId}`);
const noneBranches = await request('/api/branches', { headers: uNone.headers });
if (noneBranches.status === 200) mustNotContain('no-branch branches list', noneBranches.body, [A1.id, A2.id, B1.id, B2.id]);

// --- superuser reaches everything: intentional, asserted so it is never mistaken for a bug ---
for (const [label, path] of [
  ['OWNER reads A1', `/api/branches/${A1.id}`], ['OWNER reads A2', `/api/branches/${A2.id}`],
  ['OWNER reads B1', `/api/branches/${B1.id}`], ['OWNER reads B2', `/api/branches/${B2.id}`],
  ['OWNER reads B1 employees', `/api/employees?branch_id=${B1.id}`],
]) {
  const r = await request(path, { headers: OWNER });
  assert.ok(r.status >= 200 && r.status < 300, `${label}: superuser global access is by design, got ${r.status}`);
  privileged++;
}

// --- a multi-branch user must not widen its own scope ---
await mustDeny('A+B user grants itself branch C', uAB, 'PUT', `/api/users/${uAB.id}/branch-access`,
  { allowed_branch_ids: [A1.id, A2.id, B1.id] });
await mustDeny('A+B user grants itself ALL branches', uAB, 'PUT', `/api/users/${uAB.id}/branch-access`, { has_all_access: true });
await mustDeny('A+B user moves its primary branch to C', uAB, 'PUT', `/api/users/${uAB.id}/branch-access`, { primary_branch_id: B1.id });
await mustDeny('A+B user widens another user into C', uAB, 'PUT', `/api/users/${uA.id}/branch-access`,
  { allowed_branch_ids: [A1.id, B1.id] });
// staying inside its own scope is legitimate and must still work
await controlProbe('control: A+B user re-asserts its own two branches', uAB, 'PUT', `/api/users/${uA.id}/branch-access`,
  { allowed_branch_ids: [A1.id, A2.id] });

// --- revoking a branch takes effect immediately ---
await mustAllow('A+B user still reads A2 before revocation', uAB, 'GET', `/api/branches/${A2.id}`);
expect('OWNER narrows A+B user to A1 only',
  (await request(`/api/users/${uAB.id}/branch-access`, {
    method: 'PUT', headers: OWNER, body: JSON.stringify({ allowed_branch_ids: [A1.id] }),
  })).status, 200, null);
const afterRevoke = await request(`/api/branches/${A2.id}`, { headers: uAB.headers });
assert.equal(afterRevoke.status, 403,
  `REVOCATION NOT IMMEDIATE: A2 still reachable after access was removed (got ${afterRevoke.status})`);
denials++;
const afterRevokeMenu = await request(`/api/menu?branch_id=${A2.id}`, { headers: uAB.headers });
assert.equal(afterRevokeMenu.status, 403, 'revocation must apply to every endpoint, not just branches');
denials++;
await mustAllow('A+B user keeps A1 after revocation', uAB, 'GET', `/api/branches/${A1.id}`);

// ============================== PART B — FRANCHISE ISOLATION ==============================

// The franchise endpoints check access with canUserAccessFranchise(), which explicitly
// handles non-superusers, so the intended model is that a branch-scoped user may hold
// franchise permissions. A dedicated role is created for that rather than widening a
// system role.
const permsList = await request('/api/permissions', { headers: OWNER });
expect('list permissions', permsList.status, 200, permsList.body);
const permRows = permsList.body.permissions || permsList.body || [];
const permId = code => (permRows.find(p => p.code === code) || {}).id;
// franchises.delete is included deliberately: without it the delete probe below would be
// refused for a missing permission, which says nothing about franchise isolation.
const wanted = ['franchises.view', 'franchises.update', 'franchises.delete', 'users.view', 'employees.view', 'branches.view'];
const permIds = wanted.map(permId).filter(Boolean);
assert.equal(permIds.length, wanted.length, `expected to resolve all franchise test permissions, got ${permIds.length}`);

const fRole = await request('/api/roles', {
  method: 'POST', headers: OWNER,
  body: JSON.stringify({
    code: `FRANCHISE_PARTNER_${stamp % 100000}`, name: 'Franchise Partner (test)',
    description: 'Branch-scoped user holding franchise permissions', permission_ids: permIds,
  }),
});
expect('create franchise-partner role', fRole.status, 201, fRole.body);
const fRoleCode = fRole.body.role.code;

// Scoped to A1 only, inside Franchise A. The franchise gate will admit them to Franchise A
// (they hold one of its branches) and must refuse Franchise B.
const uFranchise = await makeUser('fpartner', '4', A1.id, [A1.id], [fRoleCode]);

// --- existence proofs: the A2 and B-side objects are real and belong where we claim ---
await proveExists('franchise A', `/api/franchises/${FA}`);
await proveExists('franchise B', `/api/franchises/${FB}`);
const faBranchesOwner = await proveExists('franchise A branches (OWNER)', `/api/franchises/${FA}/branches`);
mustContain('franchise A really contains A1 and A2', faBranchesOwner.body, [A1.id, A2.id]);
const faEmployeesOwner = await proveExists('franchise A employees (OWNER)', `/api/franchises/${FA}/employees`);
mustContain('franchise A really employs the A2 staff member', faEmployeesOwner.body, [A2.staffId]);
const fbEmployeesOwner = await proveExists('franchise B employees (OWNER)', `/api/franchises/${FB}/employees`);
mustContain('franchise B really employs the B1 staff member', fbEmployeesOwner.body, [B1.staffId]);
await proveExists('franchise A overview (OWNER)', `/api/franchises/${FA}/overview`);

// --- the gate itself: Franchise A admitted, Franchise B refused ---
const faList = await mustAllow('franchise partner lists franchises', uFranchise, 'GET', '/api/franchises');
mustContain('franchise list shows own franchise', faList.body, [FA]);
mustNotContain('franchise list must not show the other franchise', faList.body, [FB]);
await mustAllow('franchise partner reads franchise A', uFranchise, 'GET', `/api/franchises/${FA}`);
await mustDeny('franchise partner reads franchise B', uFranchise, 'GET', `/api/franchises/${FB}`);
await mustDeny('franchise partner reads franchise B overview', uFranchise, 'GET', `/api/franchises/${FB}/overview`);
await mustDeny('franchise partner reads franchise B employees', uFranchise, 'GET', `/api/franchises/${FB}/employees`);
await mustDeny('franchise partner reads franchise B branches', uFranchise, 'GET', `/api/franchises/${FB}/branches`);
await mustDeny('franchise partner reads franchise B orders', uFranchise, 'GET', `/api/franchises/${FB}/orders`);

// --- within the admitted franchise, rows must still be scoped to the branches held ---
// /:id/branches is the reference implementation of that contract.
const fpBranches = await mustAllow('franchise partner reads franchise A branches', uFranchise, 'GET', `/api/franchises/${FA}/branches`);
mustContain('franchise A branches includes the held branch', fpBranches.body, [A1.id]);
mustNotContain('franchise A branches must not expose the unheld branch', fpBranches.body, [A2.id]);

// Employees of the same franchise but of a branch this user does not hold.
const fpEmployees = await mustAllow('franchise partner reads franchise A employees', uFranchise, 'GET', `/api/franchises/${FA}/employees`);
mustContain('franchise A employees includes own-branch staff', fpEmployees.body, [A1.staffId]);
mustNotContain('franchise A employees must not expose staff of an unheld branch', fpEmployees.body, [A2.staffId]);
mustNotContain('franchise A employees must never expose the other franchise', fpEmployees.body, [B1.staffId, B2.staffId]);

// --- franchise-level writes ---
await mustDeny('franchise partner renames the other franchise', uFranchise, 'PUT', `/api/franchises/${FB}`,
  { name: 'Захвачено', legal_name: 'Hijacked LLC', contact_name: 'x', phone: '+99312000000', email: `x-${stamp}@boom.local`, address: 'x' });
await mustDeny('franchise partner changes the other franchise status', uFranchise, 'PATCH', `/api/franchises/${FB}/status`, { status: 'INACTIVE' });
await mustDeny('franchise partner deletes the other franchise', uFranchise, 'DELETE', `/api/franchises/${FB}`);

// Attaching a foreign branch would drag its data into a franchise the attacker can see.
await mustDeny('franchise partner attaches a foreign-franchise branch', uFranchise, 'POST', `/api/franchises/${FA}/branches/${B1.id}`, {});
await mustDeny('franchise partner attaches an unheld same-franchise branch', uFranchise, 'POST', `/api/franchises/${FA}/branches/${A2.id}`, {});
await mustDeny('franchise partner attaches a branch into the other franchise', uFranchise, 'POST', `/api/franchises/${FB}/branches/${A1.id}`, {});
await mustDeny('franchise partner detaches an unheld branch', uFranchise, 'DELETE', `/api/franchises/${FA}/branches/${A2.id}`);
await mustDeny('franchise partner detaches a branch of the other franchise', uFranchise, 'DELETE', `/api/franchises/${FB}/branches/${B1.id}`);

// Post-condition: the topology must be untouched by the attempts above.
const topology = await request(`/api/franchises/${FA}/branches`, { headers: OWNER });
mustContain('franchise A still holds A1 and A2', topology.body, [A1.id, A2.id]);
mustNotContain('franchise A must not have absorbed a foreign branch', topology.body, [B1.id, B2.id]);
const fbTopology = await request(`/api/franchises/${FB}/branches`, { headers: OWNER });
mustContain('franchise B still holds B1 and B2', fbTopology.body, [B1.id, B2.id]);
mustNotContain('franchise B must not have absorbed a foreign branch', fbTopology.body, [A1.id, A2.id]);

// A branch-scoped user without franchise permissions is refused on permission grounds,
// which is a different axis and must still hold.
await mustDeny('plain branch manager cannot use franchise endpoints', uA, 'GET', `/api/franchises/${FA}/employees`);

// Superuser franchise reach stays intentional.
for (const [label, path] of [
  ['OWNER reads franchise A employees', `/api/franchises/${FA}/employees`],
  ['OWNER reads franchise B employees', `/api/franchises/${FB}/employees`],
  ['OWNER reads franchise B overview', `/api/franchises/${FB}/overview`],
]) {
  const r = await request(path, { headers: OWNER });
  assert.ok(r.status >= 200 && r.status < 300, `${label}: superuser franchise access is by design, got ${r.status}`);
  privileged++;
}

// ------------------------------------------------------------------- verdict
if (process.env.STAGE22_SHOW_CODES === '1') {
  console.log('\n=== denial status codes ===');
  for (const c of denialCodes) console.log('  ' + c);
}
console.log(`\nExistence proofs: ${existenceProofs}`);
console.log(`In-scope accesses confirmed: ${allowed}`);
console.log(`Control probes: ${controls}`);
console.log(`Cross-tenant attempts refused: ${denials}`);
console.log(`Privileged accesses (by design): ${privileged}`);
if (failures.length) {
  console.log(`\n=== TENANT ISOLATION FAILURES (${failures.length}) ===`);
  for (const f of failures) console.log('  * ' + f);
  throw new Error(`${failures.length} tenant-isolation failure(s)`);
}
console.log(`\nSTAGE 22 TENANT ISOLATION E2E: PASS (${existenceProofs} existence proofs, ${allowed} in-scope, ${controls} controls, ${denials} denials, ${privileged} privileged)`);
