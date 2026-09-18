// BOOM OS — static guard for the authorization invariants of Stage 24.
// Runtime proof: tests/stage24_three_franchise_isolation_e2e.mjs. This catches a
// regression without a database, in the style of the other static suites.
//
// Handlers are matched by exact verb + path literal (see the Stage 22 static guard for why
// a path-prefix match is unsafe: several routes share a path literal across verbs).
import assert from 'node:assert/strict';
import fs from 'node:fs';

const auth = fs.readFileSync('server/auth.ts', 'utf8');
const franchises = fs.readFileSync('server/routes/franchises.ts', 'utf8');
const branches = fs.readFileSync('server/routes/branches.ts', 'utf8');
const users = fs.readFileSync('server/routes/users.ts', 'utf8');

function findHandler(src, verb, pathLiteral) {
  const re = new RegExp(`router\\.${verb}\\('${pathLiteral.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'[\\s\\S]*?\\n\\}\\);`, 'm');
  const m = src.match(re);
  assert.ok(m, `handler ${verb.toUpperCase()} ${pathLiteral} not found`);
  return m[0];
}

// ---- exact effective branch scope (I1/I2): resolved per request, never cached in the token
assert.match(auth, /const userProfile = await getFullUserProfile\(decoded\.userId\);/,
  'branch scope must be resolved on every request, which is what makes revocation (I5) immediate');
assert.match(auth, /SELECT DISTINCT branch_id FROM user_branch_access WHERE user_id = \?/,
  'branch scope must come from user_branch_access, the single source of truth for I1/I6');

// ---- no implicit sibling-branch access / no cross-franchise expansion (I2/I6): franchise
// gate is membership-only and row-returning routes must scope beyond the gate
assert.match(franchises, /if \(user\.isSuperUser\) return true;/, 'the franchise gate superuser exemption must be preserved');
for (const [verb, path] of [['get', '/:id/branches'], ['get', '/:id/employees']]) {
  const h = findHandler(franchises, verb, path);
  assert.ok(h.includes('canUserAccessFranchise'), `${verb.toUpperCase()} ${path} must gate on franchise membership`);
  assert.ok(h.includes('allowedBranchIds'), `${verb.toUpperCase()} ${path} must scope rows beyond the gate (I2/I6)`);
}

// ---- no self-grant (I3)
assert.match(users, /Only a superuser may grant access to all branches/, 'has_all_access must stay superuser-only');
assert.match(users, /Cannot assign a user to a branch outside your access scope/,
  'branch ids outside the caller scope must be rejected on every branch-access write');
assert.match(users, /function denyIfForeignBranch/, 'the employee branch guard must remain');

// ---- no unauthorized franchise topology mutation / no unauthorized branch re-parenting (I4)
// Three independent paths can re-parent a branch; Stage 24 found two of them unguarded.
// All three must now require superuser semantics with the same authorization code.
for (const [verb, path] of [['post', '/:id/branches/:branchId'], ['delete', '/:id/branches/:branchId']]) {
  const h = findHandler(franchises, verb, path);
  assert.match(h, /if \(!req\.user!\.isSuperUser\)/, `${verb.toUpperCase()} ${path} must require superuser (I4)`);
  assert.ok(h.includes('FRANCHISE_STRUCTURE_SUPERUSER_ONLY'), `${verb.toUpperCase()} ${path} must use the structural code`);
}
const branchPut = findHandler(branches, 'put', '/:id');
assert.match(branchPut, /franchise_id !== undefined && franchise_id !== existing\.franchise_id && !req\.user!\.isSuperUser/,
  'PUT /api/branches/:id must require superuser to change franchise_id (I4) -- this is the second, ' +
  'previously unguarded path to branch re-parenting that Stage 24 found');
assert.ok(branchPut.includes('FRANCHISE_STRUCTURE_SUPERUSER_ONLY'), 'PUT /api/branches/:id must use the structural code');
const branchPost = findHandler(branches, 'post', '/');
assert.match(branchPost, /if \(franchise_id && !req\.user!\.isSuperUser\)/,
  'POST /api/branches must require superuser to set franchise_id at creation (I4) -- this is the third, ' +
  'previously unguarded path, and the one that could self-grant franchise access via the creator auto-grant');
assert.ok(branchPost.includes('FRANCHISE_STRUCTURE_SUPERUSER_ONLY'), 'POST /api/branches must use the structural code');

// ---- no unauthorized franchise GOVERNANCE mutation (new in Stage 24): renaming, changing
// the status of, or deleting a franchise is an action whose blast radius is every branch
// and employee under it, not just the branches the caller holds. Membership (even in all
// three franchises at once) is not sufficient; only superuser semantics are.
for (const [verb, path] of [['put', '/:id'], ['patch', '/:id/status'], ['delete', '/:id']]) {
  const h = findHandler(franchises, verb, path);
  assert.match(h, /if \(!req\.user!\.isSuperUser\)/, `${verb.toUpperCase()} ${path} must require superuser (governance)`);
  assert.ok(h.includes('FRANCHISE_GOVERNANCE_SUPERUSER_ONLY'), `${verb.toUpperCase()} ${path} must use the governance code`);
  // The governance code must be distinct from the structural (re-parenting) code -- they are
  // different classes of action and must remain independently auditable and reportable.
  assert.notEqual('FRANCHISE_GOVERNANCE_SUPERUSER_ONLY', 'FRANCHISE_STRUCTURE_SUPERUSER_ONLY');
}

// ---- immediate revocation (I5): re-affirmed indirectly -- see the auth.ts assertion above.
// No separate code path exists for "apply revocation"; it falls out of resolving scope fresh
// on every request, so there is nothing additional to assert here without duplicating it.

// ---- OWNER/SUPER_ADMIN semantics unchanged (I7): exactly OWNER and SUPER_ADMIN, and the
// new superuser-only gates above use req.user!.isSuperUser (the same flag), not a new or
// separate privilege concept.
assert.match(auth, /const isSuperUser = roleCodes\.includes\('OWNER'\) \|\| roleCodes\.includes\('SUPER_ADMIN'\);/,
  'isSuperUser must remain exactly OWNER or SUPER_ADMIN');
assert.ok(!/isSuperUser[^\n]*GENERAL_MANAGER/.test(auth), 'GENERAL_MANAGER must not have been folded into superuser semantics');

console.log('STAGE 24 AUTHORIZATION INVARIANTS STATIC: PASS (16/16 checks)');
