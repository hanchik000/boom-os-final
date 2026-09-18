// BOOM OS — static guard for the branch-isolation fixes of Stage 21.
// The runtime proof lives in tests/stage21_branch_isolation_e2e.mjs; this catches a
// regression without needing a database, in the style of the other static suites.
import assert from 'node:assert/strict';
import fs from 'node:fs';

const users = fs.readFileSync('server/routes/users.ts', 'utf8');
const branches = fs.readFileSync('server/routes/branches.ts', 'utf8');

// The shared branch check must exist and must not be weakened to a no-op.
assert.match(users, /function denyIfForeignBranch/, 'users.ts must define denyIfForeignBranch');
assert.match(users, /if \(u\.isSuperUser \|\| target\.id === u\.id\) return false;/,
  'denyIfForeignBranch must keep the superuser and self exemptions');
assert.match(users, /BRANCH_ACCESS_DENIED/, 'denyIfForeignBranch must answer with BRANCH_ACCESS_DENIED');

// Every employee-scoped handler that Stage 21 found unguarded must call it.
const guards = users.match(/denyIfForeignBranch\(req, res/g) || [];
assert.ok(guards.length >= 6,
  `expected at least 6 branch guards in users.ts, found ${guards.length}`);

// Widening branch access is the isolation boundary itself.
assert.match(users, /Only a superuser may grant access to all branches/,
  'PUT /:id/branch-access must refuse has_all_access for non-superusers');
assert.match(users, /Cannot assign a user to a branch outside your access scope/,
  'PUT /:id/branch-access must reject branch ids outside the actor scope');

// Branch mutations must all carry the same middleware.
for (const verb of ['get', 'put', 'delete']) {
  const re = new RegExp(`router\\.${verb}\\('/:id',[^\\n]*requireBranchAccess`);
  assert.match(branches, re, `branches.ts ${verb.toUpperCase()} /:id must use requireBranchAccess`);
}

console.log('STAGE 21 BRANCH ISOLATION STATIC: PASS (9/9 checks)');
