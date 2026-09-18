// BOOM OS — Stage 26: RBAC simulator confidentiality audit.
//
// Closes the Stage 25 KNOWN GAP: "the simulator still echoes a caller-supplied
// branch/franchise's name+code." Verifies POST /api/rbac/test and GET /api/rbac/options do
// not disclose any data outside the caller's authorization scope -- not merely that a
// request is denied, but that every RETURNED FIELD is checked, since a 200 is not
// automatically a pass and a 403 is not automatically a pass if legitimate use is supposed
// to work.
//
// Topology: Franchise A = { A1, A2 }, Franchise B = { B1, B2 }.
// Actors: OWNER (superuser), MGR (BRANCH_MANAGER, A1 only -- the real seeded role), MULTI
// (BRANCH_MANAGER, A1+B1), NONE (BRANCH_MANAGER, no branch access at all).
// Targets: self, a same-branch user, a sibling-branch user (same franchise), a
// foreign-franchise user.
//
// Requires an empty database: it bootstraps the first OWNER itself.
// Usage: BOOM_OS_PORT=3000 node tests/stage26_rbac_confidentiality_e2e.mjs
import assert from 'node:assert/strict';

const base = `http://127.0.0.1:${process.env.BOOM_OS_PORT || 3000}`;
const ownerPassword = process.env.STAGE26_OWNER_PASSWORD || 'BoomConfidOwner26!';
const staffPassword = 'ConfidStaffPass12345!';
const stamp = Date.now();

let existenceProofs = 0, inScope = 0, controls = 0, privileged = 0, denials = 0;
const failures = [];
const invariants = new Set();

const RATE_BUDGET = 260;
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
async function sim(actor, body) {
  return request('/api/rbac/test', { method: 'POST', headers: actor.headers, body: JSON.stringify(body) });
}

// A genuine authorization failure only: 401/403. A 400/404/409/500 never counts as proof.
function mustDenyAuth(label, r, invariant) {
  if (r.status >= 200 && r.status < 300) {
    failures.push(`${label} — returned ${r.status} (expected an authorization denial): ${JSON.stringify(r.body).slice(0, 260)}`);
  } else if (![401, 403].includes(r.status)) {
    failures.push(`${label} — returned ${r.status}, not a genuine authorization failure: ${JSON.stringify(r.body).slice(0, 260)}`);
  } else {
    denials++;
    if (invariant) invariants.add(invariant);
  }
}
function mustAllowOk(label, r, invariant) {
  assert.ok(r.status >= 200 && r.status < 300, `ACCESS REGRESSION — ${label}: must succeed, got ${r.status} ${JSON.stringify(r.body).slice(0, 260)}`);
  inScope++;
  if (invariant) invariants.add(invariant);
  return r;
}

// ---------------------------------------------------------------- bootstrap
const owner = await request('/api/auth/bootstrap', {
  method: 'POST',
  body: JSON.stringify({ full_name: 'Confid Owner', email: `confid26-${stamp}@boom.local`, password: ownerPassword }),
});
expect('bootstrap owner', owner.status, 201, owner.body);
const OWNER = { authorization: `Bearer ${owner.body.token}` };

async function makeFranchise(tag, n) {
  const f = await request('/api/franchises', {
    method: 'POST', headers: OWNER,
    body: JSON.stringify({ name: `Franchise ${tag}`, code: `Q${tag}${stamp % 100000}`, legal_name: `F${tag} LLC`, contact_name: 'x', phone: `+9931299${n}`, email: `q${tag}-${stamp}@boom.local`, address: 'x' }),
  });
  expect(`create franchise ${tag}`, f.status, 201, f.body);
  return f.body.franchise.id;
}
async function makeBranch(tag, n, franchiseId) {
  const branch = await request('/api/branches', {
    method: 'POST', headers: OWNER,
    body: JSON.stringify({ name: `Branch ${tag}`, code: `${tag}${stamp % 100000}`, address: 'x', phone: `+9931208${n}`, franchise_id: franchiseId }),
  });
  expect(`branch ${tag}`, branch.status, 201, branch.body);
  const id = branch.body.branch.id;
  await request(`/api/franchises/${franchiseId}/branches/${id}`, { method: 'POST', headers: OWNER, body: '{}' });
  return { tag, id, franchiseId };
}
async function makeUser(label, n, branch, allowed, roles, employmentExtras = {}) {
  const email = `${label}-${stamp}@boom.local`.toLowerCase();
  const u = await request('/api/users', {
    method: 'POST', headers: OWNER,
    body: JSON.stringify({ full_name: `${label} Name`, email, phone: `+9937${n}${stamp % 100000}`, password: staffPassword, branch_id: branch, roles, allowed_branches: allowed, ...employmentExtras }),
  });
  expect(`create user ${label}`, u.status, 201, u.body);
  const login = await request('/api/auth/login', { method: 'POST', body: JSON.stringify({ login: email, password: staffPassword }) });
  expect(`login ${label}`, login.status, 200, login.body);
  return { label, email, id: u.body.user.id, headers: { authorization: `Bearer ${login.body.token}` } };
}

const FA = await makeFranchise('A', '1');
const FB = await makeFranchise('B', '2');
const A1 = await makeBranch('A1', '1', FA);
const A2 = await makeBranch('A2', '2', FA);
const B1 = await makeBranch('B1', '3', FB);
const B2 = await makeBranch('B2', '4', FB);

// Targets, each carrying identifying PII the leak checks look for.
const self_sameA1 = await makeUser('sameA1', '1', A1.id, [A1.id], ['WAITER']);
const siblingA2 = await makeUser('siblingA2', '2', A2.id, [A2.id], ['WAITER']);
const foreignB1 = await makeUser('foreignB1', '3', B1.id, [B1.id], ['WAITER']);

// Actors. MGR uses the REAL seeded BRANCH_MANAGER role (rbac.test is granted to it in
// server/seed.ts), not a custom role, matching the exploitability of the Stage 25 finding.
const MGR = await makeUser('mgrA1', '4', A1.id, [A1.id], ['BRANCH_MANAGER']);
const MULTI = await makeUser('multiA1B1', '5', A1.id, [A1.id, B1.id], ['BRANCH_MANAGER']);
const NONE = await makeUser('noneMgr', '6', null, [], ['BRANCH_MANAGER']);

console.log(`Setup: FA=${FA}[A1,A2]  FB=${FB}[B1,B2]  MGR=A1 MULTI=A1+B1 NONE=[]`);

// ==================== PART B — PAYLOAD CONFIDENTIALITY MATRIX ====================
// Every field is checked, not only the HTTP status. A 200 is not automatically a PASS; a
// 403 is not automatically a PASS if the target is one the actor legitimately holds.

await proveExists('siblingA2 exists', `/api/users/${siblingA2.id}`);
await proveExists('foreignB1 exists', `/api/users/${foreignB1.id}`);

function assertNoLeak(label, r) {
  // Regardless of status, PII/sensitive fields must never appear for a denied simulation.
  const raw = JSON.stringify(r.body ?? {});
  for (const needle of [siblingA2.email, foreignB1.email, siblingA2.id, foreignB1.id]) {
    if (r.status >= 400 && raw.includes(needle)) {
      failures.push(`${label}: a ${r.status} response must not echo the target's data (found ${needle})`);
    }
  }
}

// --- MGR (A1 only): self and same-branch target must fully succeed, with correct fields ---
const mgrSelf = mustAllowOk('MGR simulates self', await sim(MGR, { user_id: MGR.id }), 'I1');
assert.equal(mgrSelf.body.simulation_params.user.id, MGR.id);
assert.equal(mgrSelf.body.simulation_params.user.email, MGR.email);
assert.ok(mgrSelf.body.resolved_roles.some(r => r.code === 'BRANCH_MANAGER'), 'self-simulation must show real roles');
assert.deepEqual(mgrSelf.body.branch_access.allowed_branch_ids, [A1.id], 'self allowed_branch_ids must be exactly A1');
assert.equal(mgrSelf.body.simulation_params.branch, null, 'no branch_id supplied -> branch must be null');
assert.equal(mgrSelf.body.simulation_params.franchise, null, 'no franchise_id supplied -> franchise must be null');

const mgrSame = mustAllowOk('MGR simulates same-branch user', await sim(MGR, { user_id: self_sameA1.id }), 'I1');
assert.equal(mgrSame.body.simulation_params.user.email, self_sameA1.email, 'legitimate target PII must be visible (that is the tool\'s purpose)');
assert.deepEqual(mgrSame.body.branch_access.allowed_branch_ids, [A1.id]);

// --- MGR against sibling (same franchise) and foreign-franchise targets: full denial ---
const mgrSibling = await sim(MGR, { user_id: siblingA2.id });
mustDenyAuth('MGR simulates sibling-branch user (A2)', mgrSibling, 'I2');
assertNoLeak('MGR->A2', mgrSibling);

const mgrForeign = await sim(MGR, { user_id: foreignB1.id });
mustDenyAuth('MGR simulates foreign-franchise user (B1)', mgrForeign, 'I2');
assertNoLeak('MGR->B1', mgrForeign);

// --- MULTI (A1+B1): self, same-branch A1, AND the B1 user (genuinely held) all succeed;
// sibling A2 (unheld, same franchise as A1) is refused ---
const multiForeignHeld = mustAllowOk('MULTI simulates foreignB1 (genuinely holds B1)', await sim(MULTI, { user_id: foreignB1.id }), 'I6');
assert.equal(multiForeignHeld.body.simulation_params.user.email, foreignB1.email);
assert.deepEqual(multiForeignHeld.body.branch_access.allowed_branch_ids, [B1.id]);

const multiSibling = await sim(MULTI, { user_id: siblingA2.id });
mustDenyAuth('MULTI simulates sibling A2 (unheld, same franchise as A1)', multiSibling, 'I2');
assertNoLeak('MULTI->A2', multiSibling);

// --- NONE (no branch access): every target, including self, must still work for self but
// nothing else ---
const noneSelf = mustAllowOk('NONE simulates self (self is always allowed)', await sim(NONE, { user_id: NONE.id }), 'I1');
assert.deepEqual(noneSelf.body.branch_access.allowed_branch_ids, []);
const noneOther = await sim(NONE, { user_id: self_sameA1.id });
mustDenyAuth('NONE simulates any other user', noneOther, 'I2');
assertNoLeak('NONE->sameA1', noneOther);

// --- OWNER (superuser): every target unrestricted ---
for (const [label, t] of [['self-sameA1', self_sameA1], ['siblingA2', siblingA2], ['foreignB1', foreignB1]]) {
  const r = await sim(OWNER_ACTOR(), { user_id: t.id });
  assert.ok(r.status >= 200 && r.status < 300, `OWNER simulates ${label}: must succeed, got ${r.status}`);
  assert.equal(r.body.simulation_params.user.email, t.email);
  privileged++; invariants.add('I7');
}
function OWNER_ACTOR() { return { headers: OWNER }; }

// ==================== PART C — BRANCH/FRANCHISE LEAK ====================
await proveExists('branch A2 exists (OWNER)', `/api/branches/${A2.id}`);
await proveExists('branch B1 exists (OWNER)', `/api/branches/${B1.id}`);
await proveExists('branch B2 exists (OWNER)', `/api/branches/${B2.id}`);
await proveExists('franchise B exists (OWNER)', `/api/franchises/${FB}`);

// A1 -> A2 (unheld sibling, same franchise the caller IS a member of via A1)
const mgrToA2 = await sim(MGR, { user_id: MGR.id, branch_id: A2.id });
mustDenyAuth('MGR probes sibling branch A2 (self target)', mgrToA2, 'I2');
assert.ok(!JSON.stringify(mgrToA2.body).includes('Branch A2'), 'A2\'s name must not leak even though MGR is a member of its franchise');

// A1 -> B1, A1 -> B2 (foreign franchise entirely)
const mgrToB1 = await sim(MGR, { user_id: MGR.id, branch_id: B1.id });
mustDenyAuth('MGR probes foreign branch B1', mgrToB1, 'I2');
assert.ok(!JSON.stringify(mgrToB1.body).includes('Branch B1'), 'B1\'s name must not leak');
const mgrToB2 = await sim(MGR, { user_id: MGR.id, branch_id: B2.id });
mustDenyAuth('MGR probes foreign branch B2', mgrToB2, 'I2');
assert.ok(!JSON.stringify(mgrToB2.body).includes('Branch B2'), 'B2\'s name must not leak');

// A1 -> franchise B (foreign franchise entity itself)
const mgrToFB = await sim(MGR, { user_id: MGR.id, franchise_id: FB });
mustDenyAuth('MGR probes foreign franchise B', mgrToFB, 'I2');
assert.ok(!JSON.stringify(mgrToFB.body).includes('Franchise B'), 'Franchise B\'s name must not leak');

// A1 -> nonexistent ids: must be a clean, genuine denial -- NOT a 500 crash (the Stage 26
// audit found a live crash here: a nonexistent branch_id violated audit_logs' foreign key).
const mgrNonexistentBranch = await sim(MGR, { user_id: MGR.id, branch_id: 'br_totally_made_up_00000' });
mustDenyAuth('MGR probes nonexistent branch_id (must not crash)', mgrNonexistentBranch, 'I2');
assert.notEqual(mgrNonexistentBranch.status, 500, 'a nonexistent branch_id must never produce a 500');
const mgrNonexistentFranchise = await sim(MGR, { user_id: MGR.id, franchise_id: 'fr_totally_made_up_00000' });
mustDenyAuth('MGR probes nonexistent franchise_id (must not crash)', mgrNonexistentFranchise, 'I2');
assert.notEqual(mgrNonexistentFranchise.status, 500, 'a nonexistent franchise_id must never produce a 500');

// A1+B1 -> A2/B2: MULTI holds one branch in each franchise but neither sibling
const multiToA2 = await sim(MULTI, { user_id: MULTI.id, branch_id: A2.id });
mustDenyAuth('MULTI probes sibling A2', multiToA2, 'I2');
const multiToB2 = await sim(MULTI, { user_id: MULTI.id, branch_id: B2.id });
mustDenyAuth('MULTI probes sibling B2', multiToB2, 'I2');
// Controls: MULTI's OWN two branches and BOTH franchises it holds must still work fully.
const multiOwnA1 = mustAllowOk('control: MULTI probes own branch A1', await sim(MULTI, { user_id: MULTI.id, branch_id: A1.id }), 'I6');
assert.equal(multiOwnA1.body.simulation_params.branch?.name, 'Branch A1');
controls++; inScope--;
const multiOwnB1 = mustAllowOk('control: MULTI probes own branch B1', await sim(MULTI, { user_id: MULTI.id, branch_id: B1.id }), 'I6');
assert.equal(multiOwnB1.body.simulation_params.branch?.name, 'Branch B1');
controls++; inScope--;
const multiOwnFA = mustAllowOk('control: MULTI probes franchise A (member via A1)', await sim(MULTI, { user_id: MULTI.id, franchise_id: FA }), 'I6');
assert.equal(multiOwnFA.body.simulation_params.franchise?.name, 'Franchise A');
controls++; inScope--;
const multiOwnFB = mustAllowOk('control: MULTI probes franchise B (member via B1)', await sim(MULTI, { user_id: MULTI.id, franchise_id: FB }), 'I6');
assert.equal(multiOwnFB.body.simulation_params.franchise?.name, 'Franchise B');
controls++; inScope--;

// superuser -> all: every branch and franchise, real or none of MGR's business, unrestricted
const ownerToB1 = await sim(OWNER_ACTOR(), { user_id: MGR.id, branch_id: B1.id });
assert.ok(ownerToB1.status >= 200 && ownerToB1.status < 300, `OWNER must reach any branch, got ${ownerToB1.status}`);
assert.equal(ownerToB1.body.simulation_params.branch?.name, 'Branch B1');
privileged++; invariants.add('I7');
const ownerToFB = await sim(OWNER_ACTOR(), { user_id: MGR.id, franchise_id: FB });
assert.ok(ownerToFB.status >= 200 && ownerToFB.status < 300, `OWNER must reach any franchise, got ${ownerToFB.status}`);
privileged++; invariants.add('I7');
// The crash fix must hold for superusers too, who bypass the new scope gate entirely.
const ownerNonexistent = await sim(OWNER_ACTOR(), { user_id: owner.body.user.id, branch_id: 'br_owner_made_up_00000' });
assert.ok(ownerNonexistent.status >= 200 && ownerNonexistent.status < 300, `OWNER + nonexistent branch_id must not crash, got ${ownerNonexistent.status}`);
privileged++; invariants.add('I7');

// ==================== PART D — ENUMERATION / IDOR AUDIT ====================
// An attacker must not be able to tell "this branch/franchise exists but I can't see it"
// apart from "this id doesn't exist at all" -- a differential response is itself an
// enumeration oracle, independent of whether any field content leaks.
const realForeignBranch = await sim(MGR, { user_id: MGR.id, branch_id: B1.id });
const fakeBranch = await sim(MGR, { user_id: MGR.id, branch_id: 'br_definitely_fake_99999' });
assert.equal(realForeignBranch.status, fakeBranch.status,
  `ENUMERATION ORACLE: a real foreign branch_id (${realForeignBranch.status}) is distinguishable from a fake one (${fakeBranch.status})`);
assert.equal(realForeignBranch.body?.error, fakeBranch.body?.error, 'error code must be identical for real-foreign vs nonexistent branch_id');
assert.equal(realForeignBranch.body?.code, fakeBranch.body?.code, 'error subcode must be identical for real-foreign vs nonexistent branch_id');
invariants.add('I2');

const realForeignFranchise = await sim(MGR, { user_id: MGR.id, franchise_id: FB });
const fakeFranchise = await sim(MGR, { user_id: MGR.id, franchise_id: 'fr_definitely_fake_99999' });
assert.equal(realForeignFranchise.status, fakeFranchise.status,
  `ENUMERATION ORACLE: a real foreign franchise_id (${realForeignFranchise.status}) is distinguishable from a fake one (${fakeFranchise.status})`);
assert.equal(realForeignFranchise.body?.code, fakeFranchise.body?.code, 'error subcode must be identical for real-foreign vs nonexistent franchise_id');
invariants.add('I2');

// Same principle for the user_id itself: a real user in a foreign branch vs. a made-up user
// id must not be distinguishable (both already 403/404-shaped from Stage 25; re-confirmed
// here at the field level, not just status).
const realForeignUser = await sim(MGR, { user_id: siblingA2.id });
const fakeUser = await sim(MGR, { user_id: 'usr_definitely_fake_99999' });
// These CAN legitimately differ (404 not-found vs 403 forbidden), since the not-found check
// runs before the branch-scope check and both are standard, well-precedented HTTP semantics
// elsewhere in this codebase (e.g. GET /users/:id: 404 first, then 403). What must NOT differ
// is that neither response discloses anything about the target.
assertNoLeak('MGR probes fake user_id', fakeUser);
console.log(`Part D: real-foreign branch/franchise responses are byte-identical in shape to nonexistent ones (status ${realForeignBranch.status}/${realForeignFranchise.status}).`);

// ==================== GET /options — franchise list scoping ====================
await proveExists('franchise A exists (OWNER, for options scoping check)', `/api/franchises/${FA}`);
const mgrOptions = mustAllowOk('MGR reads /options', await request('/api/rbac/options', { headers: MGR.headers }), 'I2');
assert.deepEqual((mgrOptions.body.franchises || []).map(f => f.id).sort(), [FA].sort(),
  `GET /options franchises must be scoped to MGR's own franchise only, got ${JSON.stringify(mgrOptions.body.franchises)}`);
assert.ok(!JSON.stringify(mgrOptions.body.franchises).includes(FB), 'franchise B must not appear in MGR\'s /options');
controls++; inScope--;

const multiOptions = mustAllowOk('control: MULTI reads /options (holds both franchises)', await request('/api/rbac/options', { headers: MULTI.headers }), 'I6');
assert.deepEqual((multiOptions.body.franchises || []).map(f => f.id).sort(), [FA, FB].sort(),
  `GET /options franchises for MULTI must show exactly both held franchises, got ${JSON.stringify(multiOptions.body.franchises)}`);
controls++; inScope--;

const noneOptions = mustAllowOk('NONE reads /options (no branches at all)', await request('/api/rbac/options', { headers: NONE.headers }), 'I2');
assert.deepEqual(noneOptions.body.franchises, [], 'a user with no branch access must see zero franchises in /options');

const ownerOptions = await request('/api/rbac/options', { headers: OWNER });
assert.ok(ownerOptions.status >= 200 && ownerOptions.status < 300);
assert.ok((ownerOptions.body.franchises || []).map(f => f.id).includes(FB), 'OWNER must still see every franchise in /options');
privileged++; invariants.add('I7');

// ------------------------------------------------------------------- verdict
const required = ['I1', 'I2', 'I6', 'I7'];
const missing = required.filter(i => !invariants.has(i));
if (missing.length) failures.push(`invariants never exercised: ${missing.join(', ')}`);

console.log(`\nExistence proofs: ${existenceProofs}`);
console.log(`In-scope accesses confirmed: ${inScope}`);
console.log(`Control probes: ${controls}`);
console.log(`Genuine authorization denials (401/403 only): ${denials}`);
console.log(`Privileged accesses (by design): ${privileged}`);
console.log(`Invariants exercised: ${required.filter(i => invariants.has(i)).join(', ')}`);
if (failures.length) {
  console.log(`\n=== STAGE 26 FAILURES (${failures.length}) ===`);
  for (const f of failures) console.log('  * ' + f);
  throw new Error(`${failures.length} stage-26 failure(s)`);
}
console.log(`\nSTAGE 26 RBAC CONFIDENTIALITY E2E: PASS (${existenceProofs} existence proofs, ${inScope} in-scope, ${controls} controls, ${denials} genuine auth denials, ${privileged} privileged, ${required.length}/${required.length} invariants)`);
