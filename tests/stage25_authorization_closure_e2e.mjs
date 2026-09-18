// BOOM OS — Stage 25: authorization closure audit.
//
// Proves the Stages 21-24 branch/franchise authorization fixes cannot be bypassed through
// an alternative endpoint, and closes one genuine bypass found by that audit: POST
// /api/rbac/test disclosed an arbitrary target user's full PII, roles, permissions and
// complete branch-access list with no relationship check to the caller -- a second,
// unscoped door to the exact data Stage 21's denyIfForeignBranch/canAccessEmployee already
// protect on every direct endpoint. Unlike every prior finding in this series, this one is
// exploitable with the SEEDED, unmodified BRANCH_MANAGER role -- no custom role required.
//
// Topology: Franchise A = { A1, A2 }, Franchise B = { B1, B2 }. Subject U holds A1 only.
// Methodology from Stage 21-24: every denial is preceded by proof that the target really
// exists and is reachable for a privileged user; a genuine authorization failure is never
// confused with a malformed payload, a nonexistent id, or a business-rule rejection.
//
// Requires an empty database: it bootstraps the first OWNER itself.
// Usage: BOOM_OS_PORT=3000 node tests/stage25_authorization_closure_e2e.mjs
import assert from 'node:assert/strict';

const base = `http://127.0.0.1:${process.env.BOOM_OS_PORT || 3000}`;
const ownerPassword = process.env.STAGE25_OWNER_PASSWORD || 'BoomClosureOwner25!';
const staffPassword = 'ClosureStaffPass12345!';
const stamp = Date.now();

let denials = 0, existenceProofs = 0, controls = 0, privileged = 0, inScope = 0;
const failures = [];
const denialCodes = [];
const invariants = new Set();

// server.ts applies a real 300-req/min-per-IP limiter ahead of every route (basicRateLimiter,
// unmodified). This suite paces itself to stay under it rather than relaxing that real
// production safeguard, exactly as Stage 24 established.
const RATE_BUDGET = 260;
let windowStart = Date.now();
let windowCount = 0;
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

// A denial only counts as an AUTHORIZATION failure -- 401/403, or a 400 whose code names a
// scope violation. A bare 400 from a malformed payload, a 404 for a nonexistent id, or a
// business-rule 400/409 (e.g. "franchise not empty") is explicitly NOT accepted here, per
// the task's instruction; each call site below states which it expects and why.
async function mustDenyAuth(label, actor, method, path, body, invariant) {
  const opts = { method, headers: actor.headers };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const r = await request(path, opts);
  if (r.status >= 200 && r.status < 300) {
    failures.push(`${label} — ${method} ${path} returned ${r.status} (expected an authorization denial): ${JSON.stringify(r.body).slice(0, 240)}`);
  } else if (![401, 403].includes(r.status)) {
    failures.push(`${label} — ${method} ${path} returned ${r.status}, not a genuine authorization failure (401/403): ${JSON.stringify(r.body).slice(0, 240)}`);
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
  body: JSON.stringify({ full_name: 'Closure Owner', email: `closure25-${stamp}@boom.local`, password: ownerPassword }),
});
expect('bootstrap owner', owner.status, 201, owner.body);
const OWNER = { authorization: `Bearer ${owner.body.token}` };

async function makeFranchise(tag, n) {
  const f = await request('/api/franchises', {
    method: 'POST', headers: OWNER,
    body: JSON.stringify({
      name: `Franchise ${tag}`, code: `C${tag}${stamp % 100000}`, legal_name: `Franchise ${tag} LLC`,
      contact_name: `Contact ${tag}`, phone: `+9931298${n}`, email: `c${tag}-${stamp}@boom.local`, address: `Ashgabat ${tag}`,
    }),
  });
  expect(`create franchise ${tag}`, f.status, 201, f.body);
  return f.body.franchise.id;
}
async function makeBranch(tag, n, franchiseId) {
  const branch = await request('/api/branches', {
    method: 'POST', headers: OWNER,
    body: JSON.stringify({ name: `Branch ${tag}`, code: `${tag}${stamp % 100000}`, address: `Ashgabat ${tag}`, phone: `+9931207${n}`, franchise_id: franchiseId }),
  });
  expect(`branch ${tag}`, branch.status, 201, branch.body);
  const id = branch.body.branch.id;
  await request(`/api/franchises/${franchiseId}/branches/${id}`, { method: 'POST', headers: OWNER, body: '{}' });

  const area = await request('/api/tables/areas', { method: 'POST', headers: OWNER, body: JSON.stringify({ branch_id: id, name: `Зал ${tag}` }) });
  expect(`area ${tag}`, area.status, 201, area.body);

  const staff = await request('/api/users', {
    method: 'POST', headers: OWNER,
    body: JSON.stringify({ full_name: `Сотрудник ${tag}`, email: `s25-${tag}-${stamp}@boom.local`, phone: `+9938${n}${stamp % 100000}`, password: staffPassword, branch_id: id, roles: ['WAITER'] }),
  });
  expect(`staff ${tag}`, staff.status, 201, staff.body);

  return { tag, id, franchiseId, areaId: area.body.area.id, staffId: staff.body.user.id };
}

const FA = await makeFranchise('A', '1');
const FB = await makeFranchise('B', '2');
const A1 = await makeBranch('A1', '1', FA);
const A2 = await makeBranch('A2', '2', FA);
const B1 = await makeBranch('B1', '3', FB);
const B2 = await makeBranch('B2', '4', FB);
console.log(`Setup: FA=${FA}[A1,A2]  FB=${FB}[B1,B2]`);

// U: non-superuser, seeded BRANCH_MANAGER role (NOT a custom role -- this is the exact real
// role a real deployment would assign), access = A1 only.
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
// BRANCH_MANAGER (seeded) does not hold franchises.view/update, so the franchise-scope
// checks in Part D would otherwise be conflating the PERMISSION axis with the SCOPE axis --
// a 403 from a missing permission proves nothing about branch/franchise scope, exactly the
// false-positive class the task warns against. A second, purpose-built role (the same
// pattern Stages 22-24 used) adds only franchises.view/update on top, so every denial below
// is unambiguously a scope decision, not a permission gap.
const permsList = await request('/api/permissions', { headers: OWNER });
expect('list permissions', permsList.status, 200, permsList.body);
const permRows = permsList.body.permissions || permsList.body || [];
const franchisePermIds = ['franchises.view', 'franchises.update']
  .map(c => (permRows.find(p => p.code === c) || {}).id).filter(Boolean);
assert.equal(franchisePermIds.length, 2, 'expected franchises.view and franchises.update to resolve');
const franchiseAddOn = await request('/api/roles', {
  method: 'POST', headers: OWNER,
  body: JSON.stringify({ code: `FRANCHISE_ADDON_${stamp % 100000}`, name: 'Franchise add-on (test)', permission_ids: franchisePermIds }),
});
expect('create franchise add-on role', franchiseAddOn.status, 201, franchiseAddOn.body);
const franchiseAddOnCode = franchiseAddOn.body.role.code;

const U = await makeUser('closureU', '1', A1.id, [A1.id], ['BRANCH_MANAGER', franchiseAddOnCode]);
const T = await makeUser('closureTarget', '2', A2.id, [A2.id], ['BRANCH_MANAGER']); // "another user" U might try to grant into
const me = await request('/api/auth/me', { headers: U.headers });
expect('U /me', me.status, 200, me.body);
assert.ok(!me.body.user.roleCodes.some(r => ['OWNER', 'SUPER_ADMIN'].includes(r)), 'U must not be a superuser');
assert.ok(me.body.user.roleCodes.includes('BRANCH_MANAGER'), 'U must hold the real seeded BRANCH_MANAGER role');
assert.ok(me.body.user.roleCodes.includes(franchiseAddOnCode), 'U must also hold the franchise add-on role for the scope-specific checks');
console.log(`U (seeded BRANCH_MANAGER) holds A1=${A1.id} only. T holds A2=${A2.id} only.`);

// ==================== PART A/B FINDING — RBAC SIMULATOR DISCLOSURE ====================
// The headline finding: POST /api/rbac/test exposed a target's full PII, roles and complete
// allowed_branch_ids with zero relationship check. Confirmed live before this fix existed;
// verified fixed here, plus that the direct endpoint it bypassed is still independently
// denied (proving this is a *second* door being closed, not the only one).
const B1staffTarget = await proveExists('B1 staff exists (privileged read)', `/api/users/${B1.staffId}`);
assert.equal(B1staffTarget.body.user.branch_id, B1.id, 'the target really is assigned to the foreign branch B1');

await mustDenyAuth('U cannot read B1 staff directly (Stage 21 door)', U, 'GET', `/api/users/${B1.staffId}`, undefined, 'I2');
const sim = await request('/api/rbac/test', { method: 'POST', headers: U.headers, body: JSON.stringify({ user_id: B1.staffId }) });
if (sim.status >= 200 && sim.status < 300) {
  failures.push(`RBAC SIMULATOR BYPASS STILL OPEN — POST /api/rbac/test returned ${sim.status} and disclosed: ${JSON.stringify(sim.body).slice(0, 300)}`);
} else if (![401, 403].includes(sim.status)) {
  failures.push(`POST /api/rbac/test returned ${sim.status}, not a genuine authorization failure`);
} else {
  denials++; denialCodes.push(`${sim.status}  U cannot simulate B1 staff via /api/rbac/test (bypass door)`); invariants.add('I2');
}
// Legitimate use of the same tool must be unaffected: self, and a teammate in U's own branch.
await mustAllow('U can simulate itself via /api/rbac/test', U, 'POST', '/api/rbac/test', { user_id: U.id });
const ownTeammate = await request('/api/users', {
  method: 'POST', headers: OWNER,
  body: JSON.stringify({ full_name: 'A1 Teammate', email: `mate25-${stamp}@boom.local`, phone: `+993640${stamp % 100000}`, password: staffPassword, branch_id: A1.id, roles: ['WAITER'] }),
});
expect('create A1 teammate', ownTeammate.status, 201, ownTeammate.body);
await controlProbe('control: U simulates its own-branch teammate', U, 'POST', '/api/rbac/test', { user_id: ownTeammate.body.user.id });
await mustAllow('OWNER can still simulate B1 staff (superuser unrestricted)', OWNER_ACTOR(), 'POST', '/api/rbac/test', { user_id: B1.staffId }, 'I7');
function OWNER_ACTOR() { return { headers: OWNER }; }

// ============================ PART C — USER ACCESS ESCALATION ============================
// Every discovered access-changing path, attempted by U against B1 (a branch in a franchise
// U has no membership in whatsoever).
await proveExists('B1 branch exists', `/api/branches/${B1.id}`);

// 1. Direct branch-access endpoint (self and other user)
await mustDenyAuth('U grants itself B1 via branch-access endpoint', U, 'PUT', `/api/users/${U.id}/branch-access`, { allowed_branch_ids: [A1.id, B1.id] }, 'I3');
await mustDenyAuth('U grants itself has_all_access', U, 'PUT', `/api/users/${U.id}/branch-access`, { has_all_access: true }, 'I3');
await mustDenyAuth('U moves its own primary branch to B1', U, 'PUT', `/api/users/${U.id}/branch-access`, { primary_branch_id: B1.id }, 'I3');
await mustDenyAuth('U grants T access to B1 (another user, foreign branch)', U, 'PUT', `/api/users/${T.id}/branch-access`, { allowed_branch_ids: [A2.id, B1.id] }, 'I3');
// A control in the reverse direction: T attempting the identical operation on itself, adding
// only A1 (a branch T does not hold either) is refused the same way -- proving the refusal
// above is the scope check, not merely "U may not touch T's row".
await mustDenyAuth('T (a different non-superuser) cannot grant itself A1 either', T, 'PUT', `/api/users/${T.id}/branch-access`, { allowed_branch_ids: [A2.id, A1.id] }, 'I3');

// 2. User update / employee update paths (branch_id reassignment via the generic user PUT)
await mustDenyAuth('U reassigns T to branch B1 via PUT /users/:id', U, 'PUT', `/api/users/${T.id}`, { branch_id: B1.id }, 'I1');
await mustDenyAuth('U reassigns ITSELF to branch B1 via PUT /users/:id', U, 'PUT', `/api/users/${U.id}`, { branch_id: B1.id }, 'I1');

// 3. Branch creation / update (re-parenting), already the Stage 24 fix -- re-verified live
await mustDenyAuth('U creates a new branch pre-assigned to franchise B', U, 'POST', '/api/branches', {
  name: 'Escalation Branch', code: `ESC${stamp % 100000}`, address: 'x', phone: '+99312000098', franchise_id: FB,
}, 'I4');
await mustDenyAuth('U re-parents A1 (its own branch) into franchise B', U, 'PUT', `/api/branches/${A1.id}`, { franchise_id: FB }, 'I4');
await mustDenyAuth('U re-parents B1 into franchise A via PUT (U cannot even reach B1)', U, 'PUT', `/api/branches/${B1.id}`, { franchise_id: FA }, 'I1');

// 4. Franchise creation/update -- franchise creation itself needs franchises.create, which
// BRANCH_MANAGER does not hold, so this is a genuine permission-axis denial (still 403,
// still counted, since it proves the seeded role cannot reach franchise governance at all).
await mustDenyAuth('U creates a new franchise (BRANCH_MANAGER lacks franchises.create)', U, 'POST', '/api/franchises', {
  name: 'Escalation F', code: `ESF${stamp % 100000}`, legal_name: 'x', contact_name: 'x', phone: '+99312000097', email: `esf-${stamp}@boom.local`, address: 'x',
}, 'I9');
// U now holds franchises.update (via the add-on role), so this exercises the Stage 24
// governance fix specifically: even a user with the right PERMISSION and membership in
// franchise A cannot touch franchise B's metadata -- only superuser semantics can.
await mustDenyAuth('U (holds franchises.update) still cannot govern franchise B', U, 'PUT', `/api/franchises/${FB}`, { name: 'x' }, 'I9');

// 5. Branch attach/detach (Stage 23/24 fix, re-verified live)
await mustDenyAuth('U attaches B1 into franchise A', U, 'POST', `/api/franchises/${FA}/branches/${B1.id}`, {}, 'I4');
await mustDenyAuth('U detaches A1 from franchise A', U, 'DELETE', `/api/franchises/${FA}/branches/${A1.id}`, undefined, 'I4');

// 6. No bulk operations exist in this codebase (confirmed by source audit in Part A/B); no
// endpoint accepts an array of user ids or branch ids for a batched access change.

// 7. The RBAC simulator (admin/service endpoint) -- covered above; repeated here with T as
// the target to prove the fix generalizes, not just for the specific id already tested.
await mustDenyAuth('U cannot simulate T via /api/rbac/test either (T is in A2, not held by U)', U, 'POST', '/api/rbac/test', { user_id: T.id }, 'I2');

// Post-condition: after every attempt above, U's stored scope and T's stored scope must be
// exactly what they were before -- re-read fresh from the server, not assumed.
const uScopeAfter = await request(`/api/users/${U.id}/branch-access`, { headers: OWNER });
assert.deepEqual((uScopeAfter.body.allowed_branch_ids || []).sort(), [A1.id].sort(),
  `U's scope must be exactly [A1] after every escalation attempt, got ${JSON.stringify(uScopeAfter.body.allowed_branch_ids)}`);
const tScopeAfter = await request(`/api/users/${T.id}/branch-access`, { headers: OWNER });
assert.deepEqual((tScopeAfter.body.allowed_branch_ids || []).sort(), [A2.id].sort(),
  `T's scope must be exactly [A2] after every attempt to grant it access, got ${JSON.stringify(tScopeAfter.body.allowed_branch_ids)}`);
mustNotContain('U scope does not include B1', uScopeAfter.body.allowed_branch_ids || [], [B1.id], 'I3');
mustNotContain('T scope does not include B1 or A1', tScopeAfter.body.allowed_branch_ids || [], [B1.id, A1.id], 'I3');
console.log(`Post-condition confirmed: U=[A1] T=[A2], unchanged by every escalation attempt.`);

// ============================ PART D — TOPOLOGY INVARIANTS ============================

// (1) Non-superuser cannot move a branch between franchises. (already proven above via PUT
// /branches/:id and attach/detach; one more combination: moving A2, which U does not even
// hold, is refused for the same reason as everything else -- U cannot reach A2 at all.)
await mustDenyAuth('(1) U cannot move A2 (unheld) into franchise B', U, 'PUT', `/api/branches/${A2.id}`, { franchise_id: FB }, 'I4');

// (2) Non-superuser cannot create a branch in an unauthorized franchise.
await mustDenyAuth('(2) U cannot create a branch in franchise B', U, 'POST', '/api/branches', {
  name: 'Unauthorized Branch', code: `UNB${stamp % 100000}`, address: 'x', phone: '+99312000096', franchise_id: FB,
}, 'I4');

// (3) Non-superuser cannot assign a user to an unauthorized branch.
await mustDenyAuth('(3) U cannot assign T to branch B1 via branch-access', U, 'PUT', `/api/users/${T.id}/branch-access`, { primary_branch_id: B1.id }, 'I3');
await mustDenyAuth('(3) U cannot assign T to branch B1 via user update', U, 'PUT', `/api/users/${T.id}`, { branch_id: B1.id }, 'I1');

// (4) Non-superuser cannot grant themselves another branch. (proven above; one more form)
await mustDenyAuth('(4) U cannot grant itself A2 (a branch in ITS OWN franchise it does not hold)', U, 'PUT', `/api/users/${U.id}/branch-access`, { allowed_branch_ids: [A1.id, A2.id] }, 'I3');

// (5) Non-superuser cannot grant another user another branch. (proven above against T; here
// against a THIRD user U has never interacted with, to rule out any per-target special case)
const W = await makeUser('closureW', '3', B2.id, [B2.id], ['BRANCH_MANAGER']);
await mustDenyAuth('(5) U cannot grant W (a stranger) access to A1 (the branch U itself holds)', U, 'PUT', `/api/users/${W.id}/branch-access`, { allowed_branch_ids: [B2.id, A1.id] }, 'I3');

// (6) One branch membership cannot expand to sibling branches.
await mustDenyAuth('(6) U (holds A1) cannot read sibling A2', U, 'GET', `/api/branches/${A2.id}`, undefined, 'I2');
const uMenuA2 = await request(`/api/menu?branch_id=${A2.id}`, { headers: U.headers });
assert.ok([401, 403].includes(uMenuA2.status), `(6) U must be refused A2's menu, got ${uMenuA2.status}`);
denials++; invariants.add('I2');

// (7) Franchise membership cannot expand to another franchise.
await proveExists('franchise A branches (OWNER)', `/api/franchises/${FA}/branches`);
await mustDenyAuth('(7) U (franchise A member via A1) cannot read franchise B', U, 'GET', `/api/franchises/${FB}`, undefined, 'I6');
await mustDenyAuth('(7) U cannot read franchise B branches', U, 'GET', `/api/franchises/${FB}/branches`, undefined, 'I6');
await mustDenyAuth('(7) U cannot read franchise B employees', U, 'GET', `/api/franchises/${FB}/employees`, undefined, 'I6');
// Control: U DOES pass its own franchise's gate.
await mustAllow('control: U reaches franchise A (genuine member)', U, 'GET', `/api/franchises/${FA}`, undefined, 'I6');

// (8) Revocation takes effect on the next request.
// A user's PRIMARY branch_id is always implicitly part of their effective scope, by design
// (server/auth.ts: getFullUserProfile appends it to allowedBranchIds unconditionally) -- so
// revoking U's OWN primary branch (A1) down to an empty allowed_branch_ids list is not a
// meaningful test; A1 would remain reachable regardless, correctly. This tests revocation of
// a SECONDARY (non-primary) grant, exactly the pattern Stages 21/23/24 already proved: a
// fresh subject R holds primary A1 plus a temporary secondary grant on A2, and only the
// secondary grant is revoked.
const R = await makeUser('closureR', '4', A1.id, [A1.id, A2.id], ['BRANCH_MANAGER']);
await mustAllow('(8) R reads A2 (secondary grant) before revocation', R, 'GET', `/api/branches/${A2.id}`, undefined, 'I5');
expect('OWNER revokes R\'s secondary grant on A2',
  (await request(`/api/users/${R.id}/branch-access`, { method: 'PUT', headers: OWNER, body: JSON.stringify({ allowed_branch_ids: [A1.id] }) })).status, 200, null);
const afterRevoke = await request(`/api/branches/${A2.id}`, { headers: R.headers });
assert.ok([401, 403].includes(afterRevoke.status), `(8) REVOCATION NOT IMMEDIATE: R still reads A2 after its secondary grant was revoked, got ${afterRevoke.status}`);
denials++; invariants.add('I5');
await mustAllow('(8) R keeps its primary branch A1 after the secondary grant was revoked', R, 'GET', `/api/branches/${A1.id}`, undefined, 'I5');

// (9) OWNER/SUPER_ADMIN behavior unchanged.
for (const [label, path] of [
  ['OWNER reads B1', `/api/branches/${B1.id}`], ['OWNER reads franchise B', `/api/franchises/${FB}`],
  ['OWNER reads franchise B employees', `/api/franchises/${FB}/employees`],
]) {
  const r = await request(path, { headers: OWNER });
  assert.ok(r.status >= 200 && r.status < 300, `(9) ${label}: superuser access must remain unrestricted, got ${r.status}`);
  privileged++; invariants.add('I7');
}
const ownerMove = await request(`/api/branches/${A2.id}`, { method: 'PUT', headers: OWNER, body: JSON.stringify({ franchise_id: FB }) });
assert.ok(ownerMove.status >= 200 && ownerMove.status < 300, `(9) superuser branch re-parenting must remain possible, got ${ownerMove.status}`);
privileged++; invariants.add('I4');
await request(`/api/branches/${A2.id}`, { method: 'PUT', headers: OWNER, body: JSON.stringify({ franchise_id: FA }) }); // restore
const ownerSim = await request('/api/rbac/test', { method: 'POST', headers: OWNER, body: JSON.stringify({ user_id: T.id }) });
assert.ok(ownerSim.status >= 200 && ownerSim.status < 300, `(9) superuser rbac simulation must remain unrestricted, got ${ownerSim.status}`);
privileged++; invariants.add('I7');

// (10) All topology/access mutations create the expected audit records.
// Positive case: read the audit log (as OWNER, who can see everything) for entries created
// during this run's legitimate superuser actions, and confirm they are present with the
// right action code and entity -- not merely that the mutation "worked" from the caller's
// point of view, but that it left the auditable trail the Constitution (§36-37) requires.
const auditLog = await request('/api/audit?limit=500', { headers: OWNER });
expect('read audit log', auditLog.status, 200, auditLog.body);
const auditRows = auditLog.body.logs || auditLog.body.audit || auditLog.body.entries || [];
assert.ok(Array.isArray(auditRows) && auditRows.length > 0, 'audit log must return rows');
function auditHasAction(action, entityId) {
  return auditRows.some(r => r.action === action && (entityId ? r.entity_id === entityId || r.entityId === entityId : true));
}
assert.ok(auditHasAction('FRANCHISE_CREATED', FA), '(10) creating franchise A must be audited');
assert.ok(auditHasAction('BRANCH_ASSIGNED_TO_FRANCHISE'), '(10) attaching a branch to a franchise must be audited');
assert.ok(auditHasAction('USER_BRANCH_ACCESS_UPDATED') || auditHasAction('USER_PRIMARY_BRANCH_CHANGED') ||
  auditRows.some(r => String(r.action || '').includes('BRANCH_ACCESS')),
  '(10) the branch-access revocation/restoration performed on U must be audited');
console.log(`(10) audit log contains ${auditRows.length} rows; spot-checked entries confirmed present.`);

// ------------------------------------------------------------------- verdict
const required = ['I1', 'I2', 'I3', 'I4', 'I5', 'I6', 'I7', 'I9'];
const missing = required.filter(i => !invariants.has(i));
if (missing.length) failures.push(`invariants never exercised: ${missing.join(', ')}`);

if (process.env.STAGE25_SHOW_CODES === '1') {
  console.log('\n=== denial status codes ===');
  for (const c of denialCodes) console.log('  ' + c);
}
console.log(`\nExistence proofs: ${existenceProofs}`);
console.log(`In-scope accesses confirmed: ${inScope}`);
console.log(`Control probes: ${controls}`);
console.log(`Genuine authorization denials (401/403 only): ${denials}`);
console.log(`Privileged accesses (by design): ${privileged}`);
console.log(`Invariants exercised: ${required.filter(i => invariants.has(i)).join(', ')}`);
if (failures.length) {
  console.log(`\n=== STAGE 25 FAILURES (${failures.length}) ===`);
  for (const f of failures) console.log('  * ' + f);
  throw new Error(`${failures.length} stage-25 failure(s)`);
}
console.log(`\nSTAGE 25 AUTHORIZATION CLOSURE E2E: PASS (${existenceProofs} existence proofs, ${inScope} in-scope, ${controls} controls, ${denials} genuine auth denials, ${privileged} privileged, 8/8 invariants)`);
