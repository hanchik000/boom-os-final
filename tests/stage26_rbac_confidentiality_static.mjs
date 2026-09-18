// BOOM OS — static guard for the Stage 26 RBAC confidentiality fixes.
// Runtime proof: tests/stage26_rbac_confidentiality_e2e.mjs. Catches a regression without a
// database, in the style of the other static suites.
import assert from 'node:assert/strict';
import fs from 'node:fs';

const rbac = fs.readFileSync('server/routes/rbac.ts', 'utf8');

// --- POST /test: caller-supplied branch_id/franchise_id must be scope-checked before any
// entity metadata is resolved, and refused identically for a foreign-but-real id and a
// nonexistent one (no enumeration oracle).
const testHandler = rbac.slice(rbac.indexOf("router.post('/test'"));
const gateIdx = testHandler.indexOf("if (branch_id && !req.user!.allowedBranchIds.includes(String(branch_id)))");
const targetBranchResolveIdx = testHandler.indexOf('let targetBranch');
assert.ok(gateIdx > 0, 'POST /test must gate branch_id against the caller\'s own allowedBranchIds');
assert.ok(gateIdx < targetBranchResolveIdx,
  'the branch_id scope gate must run BEFORE targetBranch is resolved, so a denial never computes the entity metadata it is meant to protect');
assert.match(testHandler, /franchise_id\s*\)\s*\{[\s\S]{0,400}?SELECT id FROM branches WHERE franchise_id = \? AND id IN/,
  'franchise_id must be checked via branch membership in that franchise (the same model as canUserAccessFranchise), not a separate concept');
assert.match(testHandler, /BRANCH_ACCESS_DENIED[\s\S]{0,50}branch_id is outside your access scope/,
  'an out-of-scope branch_id must answer with the branch-access denial code');
assert.match(testHandler, /FRANCHISE_ACCESS_DENIED[\s\S]{0,50}franchise_id is outside your access scope/,
  'an out-of-scope franchise_id must answer with the franchise-access denial code');

// --- The superuser exemption must still cover the new gate (isSuperUser guards the whole
// block, so a superuser is never scope-checked against branch_id/franchise_id).
const gateBlockStart = testHandler.indexOf('if (!req.user!.isSuperUser) {', gateIdx - 60);
assert.ok(gateBlockStart >= 0 && gateBlockStart < gateIdx, 'the new gate must be wrapped in the superuser exemption');

// --- The audit-log crash fix: branchId must come from the validated targetBranch lookup,
// never the raw request field (which can be any string, including a nonexistent id that
// violates audit_logs' foreign key to branches).
assert.match(testHandler, /branchId:\s*targetBranch\?\.id \|\| req\.user!\.branch_id/,
  'the audit log write must use the validated branch id, not the raw request field');
assert.ok(!/branchId:\s*branch_id\s*\|\|/.test(testHandler),
  'the audit log write must not fall back to the unvalidated raw branch_id');

// --- GET /options: the franchises list must be scoped for non-superusers, matching the
// already-scoped users/branches lists in the same response and the established
// GET /api/franchises contract (Stage 22).
const optionsHandler = rbac.slice(rbac.indexOf("router.get('/options'"), rbac.indexOf("router.post('/test'"));
assert.match(optionsHandler, /const franchises = req\.user!\.isSuperUser/,
  'GET /options franchises must branch on isSuperUser, matching the pattern already used for the branches list in the same handler');
assert.match(optionsHandler, /SELECT DISTINCT franchise_id FROM branches WHERE id IN/,
  'the non-superuser franchise scoping must filter through the caller\'s own branches, the same join used by GET /api/franchises');

console.log('STAGE 26 RBAC CONFIDENTIALITY STATIC: PASS (9/9 checks)');
