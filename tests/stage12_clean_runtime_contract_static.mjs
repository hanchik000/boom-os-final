import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (p) => fs.readFileSync(p, 'utf8');
const auth = read('server/routes/auth.ts');
const users = read('server/routes/users.ts');
const dashboard = read('src/components/DashboardView.tsx');
const login = read('src/components/LoginModal.tsx');
const system = read('server/routes/system.ts');

assert.match(auth, /router\.get\('\/bootstrap-status'/);
assert.match(auth, /router\.post\('\/bootstrap'/);
assert.match(auth, /BOOTSTRAP_ALREADY_COMPLETED/);
assert.match(auth, /OWNER_PASSWORD_TOO_WEAK/);
assert.match(auth, /hashPassword\(String\(password\)\)/);
assert.match(auth, /transaction\(async/);
assert.match(auth, /OWNER_BOOTSTRAPPED/);

// Role IDs and role codes must both be resolved server-side before assignment.
assert.match(users, /Role references may be ids or codes/);
assert.match(users, /PRIVILEGE_ESCALATION_FORBIDDEN/);
assert.match(users, /SELECT id, code FROM roles WHERE \(id = \? OR code = \?\)/);
assert.match(users, /requestedUpdateBranchIds/);

// Production login screen must not expose fictional persona identities.
for (const forbidden of ['owner@boomburger.ru','admin@boomburger.ru','manager.arbat@boomburger.ru','cashier.arbat@boomburger.ru','Alexander Volkov','Elena (Arbat only)','Daria (Restricted)']) {
  assert.equal(login.includes(forbidden), false, `fictional login preset remains: ${forbidden}`);
}

// Empty dashboard uses database values and does not claim health when DB status is unknown.
assert.match(dashboard, /telemetry\?\.stats\.users\.total \?\? 0/);
assert.match(dashboard, /DATABASE STATUS UNKNOWN/);
assert.match(dashboard, /Нет данных/);
assert.match(system, /franchises:/);

console.log('Stage 12 runtime-contract static acceptance: PASSED');
