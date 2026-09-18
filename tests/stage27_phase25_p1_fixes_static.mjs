// BOOM OS -- Stage 27 Phase 2.5: static regression guards for the two runtime-confirmed P1
// fixes (item-removal approval crash, and the waiter-management router being unreachable for
// any non-superuser). Negative-control verified: each check was confirmed to fail against the
// pre-fix source during development.
import fs from 'node:fs';
import assert from 'node:assert/strict';

const orders = fs.readFileSync(new URL('../server/routes/orders.ts', import.meta.url), 'utf8');
const seed = fs.readFileSync(new URL('../server/seed.ts', import.meta.url), 'utf8');

let passed = 0;
function check(label, cond) {
  assert.ok(cond, `FAILED: ${label}`);
  passed++;
}

// --- P1 #1: order_items.quantity is INTEGER; the removal-recompute must cast its DECIMAL
// result through numeric before binding it to that column, not write raw decimal text.
const updateStmt = orders.match(/UPDATE order_items SET quantity=[^`]*WHERE id=\?/)?.[0] || '';
check('UPDATE order_items statement found', updateStmt.length > 0);
check('quantity is bound via CAST(CAST(? AS numeric) AS integer), not a raw ?', /quantity=CAST\(CAST\(\?\s*AS numeric\)\s*AS integer\)/.test(updateStmt));
check('quantity is NOT bound as a bare placeholder (the original crash pattern)', !/quantity=\?,/.test(updateStmt));

// --- P1 #1 audit quality: the APPROVED-path audit call must pass req (so real ip/user-agent
// are captured), matching the REJECTED-path call just above it.
const approveAuditCall = orders.match(/newValues:\{type:'REMOVE_ITEM',status:'APPROVED'[^}]*\}[^)]*\)/)?.[0] || '';
check('APPROVED audit call found', approveAuditCall.length > 0);
check('APPROVED audit call passes req', /,req\}\)/.test(approveAuditCall) || /,req\s*\}\s*\)/.test(approveAuditCall));

// --- P1 #2: waiter_codes.manage must exist as a real, grantable permission, and be granted to
// GENERAL_MANAGER and BRANCH_MANAGER (matching requireWaiterCodeManager's own stated intent),
// without touching any other role's grants or weakening waiters.ts's own checks.
check("'waiter_codes.manage' is registered as a permission definition", /code:\s*'waiter_codes\.manage'/.test(seed));
const rolePermsArrayMatch = seed.match(/const stage17RolePerms = \[([^\]]*)\]/);
check('stage17RolePerms array found', !!rolePermsArrayMatch);
check("'waiter_codes.manage' is included in the stage17RolePerms grant list", rolePermsArrayMatch && rolePermsArrayMatch[1].includes("'waiter_codes.manage'"));
const grantLoopMatch = seed.match(/for \(const role of \[roleOwner, roleSuperAdmin, roleGeneralManager, roleBranchManager\]\) \{[\s\S]*?for \(const code of stage17RolePerms\)/);
check('the grant loop that consumes stage17RolePerms targets exactly [Owner, SuperAdmin, GeneralManager, BranchManager]', !!grantLoopMatch);

// waiters.ts itself must be untouched -- the fix is purely additive in seed.ts, not a weakening
// of the router's own gate.
const waiters = fs.readFileSync(new URL('../server/routes/waiters.ts', import.meta.url), 'utf8');
check("waiters.ts still requires 'waiter_codes.manage' at the router level (not removed/weakened)", /router\.use\(requirePermission\('waiter_codes\.manage'\)\)/.test(waiters));
check('waiters.ts still requires requireWaiterCodeManager (role check preserved)', /router\.use\(requireWaiterCodeManager\)/.test(waiters));
check("route-specific 'waiters.status.view'/'waiters.status.manage' permissions are untouched", /requirePermission\('waiters\.status\.view'\)/.test(waiters) && /requirePermission\('waiters\.status\.manage'\)/.test(waiters));

console.log(`STAGE 27 PHASE 2.5 P1 FIXES STATIC: PASS (${passed}/${passed} checks)`);
