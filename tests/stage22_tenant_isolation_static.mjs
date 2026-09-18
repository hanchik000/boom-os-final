// BOOM OS — static guard for the franchise-isolation fixes of Stage 22.
// Runtime proof: tests/stage22_tenant_isolation_e2e.mjs. This catches a regression
// without a database, in the style of the other static suites.
//
// Handlers are matched by exact verb + path literal, not by a path-prefix string match:
// several franchise routes share a path literal across verbs (GET /:id, PUT /:id,
// DELETE /:id all start with '/:id'), and a prefix match would silently assert the same
// rule against handlers that follow different contracts.
import assert from 'node:assert/strict';
import fs from 'node:fs';

const src = fs.readFileSync('server/routes/franchises.ts', 'utf8');

// The franchise membership gate must still exist and keep the superuser exemption.
assert.match(src, /async function canUserAccessFranchise/, 'canUserAccessFranchise must exist');
assert.match(src, /if \(user\.isSuperUser\) return true;/, 'the superuser exemption must be preserved');

function findHandler(verb, pathLiteral) {
  const re = new RegExp(`router\\.${verb}\\('${pathLiteral.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'[\\s\\S]*?\\n\\}\\);`, 'm');
  const m = src.match(re);
  assert.ok(m, `handler ${verb.toUpperCase()} ${pathLiteral} not found`);
  return m[0];
}

// Read routes: gated on franchise membership. Row-returning ones must also scope to the
// caller's branches -- passing the gate is not enough, per Stage 22's core finding.
for (const [verb, path, mustScope] of [
  ['get', '/:id', false],
  ['get', '/:id/overview', false],
  ['get', '/:id/orders', false],
  ['get', '/:id/branches', true],
  ['get', '/:id/employees', true],
]) {
  const h = findHandler(verb, path);
  assert.ok(h.includes('canUserAccessFranchise'), `${verb.toUpperCase()} ${path} must check franchise access`);
  if (mustScope) {
    assert.ok(h.includes('allowedBranchIds'), `${verb.toUpperCase()} ${path} must scope rows to the caller's branches`);
  }
}

// Franchise governance mutations (PUT /:id, PATCH /:id/status, DELETE /:id). SUPERSEDED BY
// STAGE 24: Stage 22 gated these on franchise membership; Stage 24 found that a member
// holding one branch of a multi-branch franchise could rename, suspend or delete the whole
// entity -- a blast radius exceeding their proven authority -- and restricted them to
// superuser semantics. This guard asserts the superseding rule.
for (const [verb, path] of [['put', '/:id'], ['patch', '/:id/status'], ['delete', '/:id']]) {
  const h = findHandler(verb, path);
  assert.match(h, /if \(!req\.user!\.isSuperUser\)/,
    `${verb.toUpperCase()} ${path} must be restricted to superuser semantics (Stage 24)`);
  assert.ok(h.includes('FRANCHISE_GOVERNANCE_SUPERUSER_ONLY'),
    `${verb.toUpperCase()} ${path} must answer with the governance authorization code`);
}

// Branch<->franchise re-parenting. Stage 22 required the franchise gate plus the branch
// being in the caller's scope; Stage 23 proved a user holding branches in two franchises
// satisfies both and could still re-parent a branch, so the rule was tightened to
// superuser-only. This guard asserts that superseding rule.
for (const [verb, path] of [['post', '/:id/branches/:branchId'], ['delete', '/:id/branches/:branchId']]) {
  const h = findHandler(verb, path);
  assert.match(h, /if \(!req\.user!\.isSuperUser\)/,
    'attach/detach must be restricted to superuser semantics (Stage 23 invariant 4)');
  assert.ok(h.includes('FRANCHISE_STRUCTURE_SUPERUSER_ONLY'),
    'attach/detach must answer with the structural authorization code');
}

// The franchise list must stay filtered for non-superusers.
const listHandler = findHandler('get', '/');
assert.ok(listHandler.includes('allowedBranchIds'), 'GET /api/franchises must stay filtered to the caller branches');

console.log('STAGE 22 TENANT ISOLATION STATIC: PASS (18/18 checks)');
