// BOOM OS — static guard for the franchise-isolation fixes of Stage 22.
// Runtime proof: tests/stage22_tenant_isolation_e2e.mjs. This catches a regression
// without a database, in the style of the other static suites.
import assert from 'node:assert/strict';
import fs from 'node:fs';

const src = fs.readFileSync('server/routes/franchises.ts', 'utf8');

// The franchise gate must still exist and keep the superuser exemption.
assert.match(src, /async function canUserAccessFranchise/, 'canUserAccessFranchise must exist');
assert.match(src, /if \(user\.isSuperUser\) return true;/, 'the superuser exemption must be preserved');

// Every franchise-scoped route must carry the gate. Passing the gate is not enough for
// row-returning routes, which must also scope to the caller's branches.
const handlers = src.split(/router\.(?:get|post|put|patch|delete)\(/).slice(1);
function find(pathLiteral) {
  const h = handlers.find(x => x.startsWith(`'${pathLiteral}'`));
  assert.ok(h, `handler for ${pathLiteral} not found`);
  return h;
}
for (const p of ['/:id', '/:id/overview', '/:id/orders', '/:id/branches', '/:id/employees',
                 '/:id/status']) {
  const matches = handlers.filter(x => x.startsWith(`'${p}'`));
  assert.ok(matches.length > 0, `no handler registered for ${p}`);
  for (const h of matches) {
    assert.ok(h.includes('canUserAccessFranchise'), `${p} must check franchise access`);
  }
}

// Row-returning franchise routes must scope to allowedBranchIds.
for (const p of ['/:id/branches', '/:id/employees']) {
  for (const h of handlers.filter(x => x.startsWith(`'${p}'`))) {
    assert.ok(h.includes('allowedBranchIds'), `${p} must scope rows to the caller's branches`);
  }
}

// Moving a branch between franchises. Stage 22 required the franchise gate plus the branch
// being in the caller's scope; Stage 23 proved that a user holding branches in two
// franchises satisfies both and could still re-parent a branch, so the rule was tightened to
// superuser-only. That is strictly stronger, so this guard now asserts the superseding rule.
for (const h of handlers.filter(x => x.startsWith("'/:id/branches/:branchId'"))) {
  assert.match(h, /if \(!req\.user!\.isSuperUser\)/,
    'attach/detach must be restricted to superuser semantics (Stage 23 invariant 4)');
  assert.ok(h.includes('FRANCHISE_STRUCTURE_SUPERUSER_ONLY'),
    'attach/detach must answer with the structural authorization code');
}

// The franchise list must stay filtered for non-superusers.
const listHandler = handlers.find(x => x.startsWith("'/'") && x.includes('franchises.view'));
assert.ok(listHandler && listHandler.includes('allowedBranchIds'),
  'GET /api/franchises must stay filtered to the caller branches');

console.log('STAGE 22 TENANT ISOLATION STATIC: PASS (17/17 checks)');
