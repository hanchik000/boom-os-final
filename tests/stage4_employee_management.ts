import * as fs from 'node:fs';
import * as path from 'node:path';

const root = process.cwd();
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8');

const schema = read('prisma/schema.prisma');
const migration = read('prisma/migrations/20260908000300_employee_profiles/migration.sql');
const route = read('server/routes/employees.ts');
const users = read('server/routes/users.ts');
const server = read('server.ts');

const checks: Array<[string, boolean]> = [
  ['EmployeeProfile exists in Prisma schema', schema.includes('model EmployeeProfile')],
  ['EmployeeProfile has unique employee code', schema.includes('@unique') && schema.includes('employee_code')],
  ['Employee profile migration exists', migration.includes('CREATE TABLE "employee_profiles"')],
  ['Migration backfills existing users', migration.includes('INSERT INTO "employee_profiles"')],
  ['Employee API is registered', server.includes("app.use('/api/employees', employeesRouter)")],
  ['Employee list is protected by employees.view', route.includes("requirePermission('employees.view')")],
  ['Employee profile updates are protected', route.includes("requirePermission('employees.update')")],
  ['New users receive an employee profile', users.includes('INSERT INTO employee_profiles')],
  ['Employee code is deterministic and unique per user', users.includes('const employeeCode = `EMP-${userId}`')],
  ['Audit events are recorded for profile changes', route.includes('EMPLOYEE_PROFILE_UPDATED') && route.includes('recordAuditLog')],
];

for (const [name, ok] of checks) {
  console.log(`${ok ? 'PASS' : 'FAIL'} — ${name}`);
}
if (checks.some(([, ok]) => !ok)) process.exit(1);
console.log(`Stage 4 static acceptance: ${checks.length}/${checks.length} passed.`);
