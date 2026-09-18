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
                 '/:id/status', '/:id/branches/:branchId']) {
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

// Moving a branch between franchises must require access to the branch itself.
for (const h of handlers.filter(x => x.startsWith("'/:id/branches/:branchId'"))) {
  assert.ok(h.includes('allowedBranchIds.includes(branchId)'),
    'attach/detach must require the branch to be within the caller scope');
  assert.ok(h.includes('BRANCH_ACCESS_DENIED'), 'attach/detach must answer BRANCH_ACCESS_DENIED');
}

// The franchise list must stay filtered for non-superusers.
const listHandler = handlers.find(x => x.startsWith("'/'") && x.includes('franchises.view'));
assert.ok(listHandler && listHandler.includes('allowedBranchIds'),
  'GET /api/franchises must stay filtered to the caller branches');

console.log('STAGE 22 TENANT ISOLATION STATIC: PASS (18/18 checks)');
