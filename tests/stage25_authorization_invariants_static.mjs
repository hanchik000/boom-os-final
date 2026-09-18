// BOOM OS — static guard for the Stage 25 authorization closure fix.
// Runtime proof: tests/stage25_authorization_closure_e2e.mjs. This catches a regression
// without a database, in the style of the other static suites.
import assert from 'node:assert/strict';
import fs from 'node:fs';

const rbac = fs.readFileSync('server/routes/rbac.ts', 'utf8');

// The simulator must scope its target user by the caller's branch access, using the same
// model (isSuperUser / self / allowedBranchIds / user_branch_access) every other route in
// this codebase already uses -- not a second authorization system.
assert.match(rbac, /async function canSimulateUser/, 'canSimulateUser must exist');
assert.match(rbac, /if \(caller\.isSuperUser \|\| targetUserId === caller\.id\) return true;/,
  'canSimulateUser must keep the superuser and self exemptions (legitimate self-service use)');
assert.match(rbac, /if \(targetBranchId && caller\.allowedBranchIds\.includes\(targetBranchId\)\) return true;/,
  'canSimulateUser must allow a target whose primary branch the caller holds');
assert.match(rbac, /SELECT user_id FROM user_branch_access WHERE user_id = \? AND branch_id IN/,
  'canSimulateUser must also check the target\'s secondary branch grants, not just their primary branch');

// The gate must actually be called on the /test route, immediately after loading the target
// user and before any role/permission/branch data is resolved for them.
const testHandler = rbac.slice(rbac.indexOf("router.post('/test'"));
const gateIdx = testHandler.indexOf('canSimulateUser(req.user!');
const notFoundIdx = testHandler.indexOf("'Target user not found.'");
const roleResolutionIdx = testHandler.indexOf('// 2. Resolve Roles');
assert.ok(gateIdx > 0, 'POST /test must call canSimulateUser');
assert.ok(gateIdx > notFoundIdx && gateIdx < roleResolutionIdx,
  'the branch-scope gate must run after the not-found check and before any role/permission/branch data is resolved for the target');

// The refusal must be a genuine 403, not silently degrade to an empty/filtered response that
// could be mistaken for "user has no access" (a defect the audit explicitly warned against).
const gateBlock = testHandler.slice(gateIdx - 200, gateIdx + 300);
assert.match(gateBlock, /res\.status\(403\)/, 'an unauthorized simulation target must answer 403');

console.log('STAGE 25 AUTHORIZATION INVARIANTS STATIC: PASS (6/6 checks)');
