import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (p) => fs.readFileSync(p, 'utf8');
const db = read('server/db.ts');
const auth = read('server/auth.ts');
const users = read('server/routes/users.ts');
const employees = read('server/routes/employees.ts');
const rbac = read('server/routes/rbac.ts');
const schema = read('prisma/schema.prisma');
const migration = read('prisma/migrations/20260908000400_hardening_indexes/migration.sql');
const server = read('server.ts');

assert.match(db, /prisma\.\$transaction\(async \(client\)/, 'DB transaction helper must use Prisma transaction');
assert.match(db, /getPrismaMigrationStatus/, 'Prisma migration status helper must exist');
assert.match(auth, /SESSION_IDLE_TIMEOUT_MINUTES|config\.sessionIdleTimeoutMinutes/, 'Idle session timeout must be enforced');
assert.match(auth, /export async function recordAuditLog[\s\S]*?await insertAuditLog\(execute, options\);/, 'Audit write failures must propagate');
assert.match(users, /EXISTS \(SELECT 1 FROM user_branch_access/, 'Users list must include multi-branch access');
assert.match(users, /Cannot assign a user to a branch outside your access scope/, 'User provisioning must enforce branch assignment scope');
assert.match(users, /await transaction\(async/, 'User provisioning must be transactional');
assert.match(users, /insertAuditLog\(txExecute/, 'User provisioning audit must be inside the transaction');
assert.match(employees, /canAccessEmployee/, 'Employee detail/profile access must use branch-aware access');
assert.match(rbac, /uba_scope/, 'RBAC simulation user options must be branch-scoped');
assert.match(schema, /idx_user_branch_user_branch/, 'Composite user-branch index must be declared');
assert.match(schema, /idx_audit_branch_created/, 'Composite audit branch/time index must be declared');
assert.match(migration, /CREATE INDEX IF NOT EXISTS/, 'Hardening migration must create indexes');
assert.match(server, /_prisma_migrations/, 'Health must use Prisma migration metadata');
console.log('STAGE 1 HARDENING STATIC ACCEPTANCE: PASSED');
