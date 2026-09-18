// BOOM OS — static guard for the authorization invariants of Stage 23.
// Runtime proof: tests/stage23_cross_franchise_e2e.mjs. This catches a regression without
// a database, in the style of the other static suites.
import assert from 'node:assert/strict';
import fs from 'node:fs';

const auth = fs.readFileSync('server/auth.ts', 'utf8');
const franchises = fs.readFileSync('server/routes/franchises.ts', 'utf8');
const users = fs.readFileSync('server/routes/users.ts', 'utf8');

// I7 — superuser semantics unchanged: exactly OWNER and SUPER_ADMIN, nothing added.
assert.match(auth, /const isSuperUser = roleCodes\.includes\('OWNER'\) \|\| roleCodes\.includes\('SUPER_ADMIN'\);/,
  'isSuperUser must remain exactly OWNER or SUPER_ADMIN');
assert.ok(!/isSuperUser[^\n]*GENERAL_MANAGER/.test(auth),
  'GENERAL_MANAGER must not have been folded into superuser semantics');

// I1/I6 — effective scope is resolved per request from the database, never from the token,
// which is what makes revocation immediate (I5).
assert.match(auth, /const userProfile = await getFullUserProfile\(decoded\.userId\);/,
  'the profile (and therefore branch scope) must be resolved on every request');
assert.match(auth, /SELECT DISTINCT branch_id FROM user_branch_access WHERE user_id = \?/,
  'branch scope must come from user_branch_access');

// I4 — re-parenting a branch is superuser-only. Holding the branch plus a branch of the
// target franchise is not sufficient: a cross-franchise user satisfies both.
const handlers = franchises.split(/router\.(?:get|post|put|patch|delete)\(/).slice(1);
const reparent = handlers.filter(h => h.startsWith("'/:id/branches/:branchId'"));
assert.equal(reparent.length, 2, 'expected both attach and detach handlers');
for (const h of reparent) {
  assert.match(h, /if \(!req\.user!\.isSuperUser\)/, 'branch re-parenting must require superuser');
  assert.match(h, /FRANCHISE_STRUCTURE_SUPERUSER_ONLY/, 'branch re-parenting must answer with the structural code');
}

// I2 — franchise membership must not become row-level access to every branch of it.
for (const p of ['/:id/branches', '/:id/employees']) {
  for (const h of handlers.filter(x => x.startsWith(`'${p}'`))) {
    assert.ok(h.includes('canUserAccessFranchise'), `${p} must gate on franchise membership`);
    assert.ok(h.includes('allowedBranchIds'), `${p} must scope rows to the caller's branches`);
  }
}

// I3 — a user can never widen its own scope.
assert.match(users, /Only a superuser may grant access to all branches/,
  'has_all_access must stay superuser-only');
assert.match(users, /Cannot assign a user to a branch outside your access scope/,
  'branch ids outside the caller scope must be rejected');
assert.match(users, /function denyIfForeignBranch/, 'the employee branch guard must remain');

// Part 3 — the franchise orders endpoint is a declared stub, not a data path. If this ever
// changes, its scoping must be proven before the assertion below is relaxed.
const ordersHandler = handlers.find(h => h.startsWith("'/:id/orders'"));
assert.ok(ordersHandler, 'franchise orders handler must exist');
assert.ok(ordersHandler.includes('canUserAccessFranchise'), 'the orders stub must still be gated');
assert.match(ordersHandler, /connected: false/,
  'the orders stub is unimplemented; implementing it requires proving branch/franchise scoping');
assert.ok(!/FROM orders/i.test(ordersHandler), 'the orders stub must not read order rows without scoping');

console.log('STAGE 23 AUTHORIZATION INVARIANTS STATIC: PASS (16/16 checks)');
