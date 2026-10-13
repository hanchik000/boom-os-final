// One command from a fresh clone to a running BOOM OS, WITHOUT Docker for the application:
// install -> prisma generate -> migrate deploy -> build -> start.
//
// Use this when Docker is unavailable or Docker Hub is rate-limiting image pulls. It still needs
// a reachable PostgreSQL; if there is none, it stops and prints the one command that starts one.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const step = (n, text) => console.log(`\n[${n}] ${text}`);
const run = (cmd, args, opts = {}) => {
  const r = spawnSync(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32', ...opts });
  if (r.status !== 0) process.exit(r.status ?? 1);
  return r;
};
const quiet = (cmd, args) =>
  spawnSync(cmd, args, { encoding: 'utf8', shell: process.platform === 'win32' });

// dotenv never overwrites a variable that is already in the environment. So a leftover
// BOOTSTRAP_OWNER_PASSWORD, DATABASE_URL or JWT_SECRET in the terminal silently wins over .env,
// the owner gets seeded with a password nobody printed, and the sign-in fails with "Invalid login
// or password". This was observed while testing the script, not imagined. Everything below starts
// from the file: it is read once and passed to each child explicitly.
const readEnvFile = () => Object.fromEntries(
  fs.readFileSync(path.join(root, '.env'), 'utf8').split(/\r?\n/)
    .map(l => /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(l))
    .filter(Boolean)
    .map(m => [m[1], m[2].trim()]));

step('1/5', 'Configuration');
run(process.execPath, ['scripts/setup-env.mjs']);

step('2/5', 'Dependencies');
if (!fs.existsSync(path.join(root, 'node_modules'))) run('npm', ['install']);
else console.log('node_modules is already present -- skipping npm install.');

const fileEnv = readEnvFile();
const shadowed = Object.keys(fileEnv).filter(k => process.env[k] && process.env[k] !== fileEnv[k]);
if (shadowed.length) {
  console.log(`\n  Note: ${shadowed.join(', ')} ${shadowed.length > 1 ? 'are' : 'is'} also set in this terminal.`);
  console.log('  The values from .env are used, so what is printed below is what actually applies.');
}
const childEnv = { ...process.env, ...fileEnv };

step('3/5', 'Database schema');
run('npx', ['prisma', 'generate'], { env: childEnv });
const migrate = spawnSync('npx', ['prisma', 'migrate', 'deploy'],
  { encoding: 'utf8', shell: process.platform === 'win32', env: childEnv });
process.stdout.write(migrate.stdout || '');
if (migrate.status !== 0) {
  process.stderr.write(migrate.stderr || '');
  const out = `${migrate.stdout || ''}${migrate.stderr || ''}`;
  if (/P1001|Can't reach database server|ECONNREFUSED/i.test(out)) {
    const env = fileEnv;
    console.error('\nPostgreSQL is not reachable at the address in DATABASE_URL.');
    console.error('Start one with Docker:\n');
    console.error(`  docker run -d --name boom-pg -p 5432:5432 \\
    -e POSTGRES_USER=${env.POSTGRES_USER} -e POSTGRES_PASSWORD=${env.POSTGRES_PASSWORD} \\
    -e POSTGRES_DB=${env.POSTGRES_DB} postgres:15-alpine\n`);
    console.error('or point DATABASE_URL in .env at a PostgreSQL you already run, then try again.');
  }
  process.exit(migrate.status ?? 1);
}

step('4/5', 'Compile');
run('npm', ['run', 'build'], { env: childEnv });

const port = fileEnv.PORT || '3000';
step('5/5', `Start -- open http://localhost:${port}`);
console.log(`    sign in as ${fileEnv.BOOTSTRAP_OWNER_EMAIL} / ${fileEnv.BOOTSTRAP_OWNER_PASSWORD}\n`);
run(process.execPath, ['dist/server.cjs'], { env: { ...childEnv, NODE_ENV: 'production' } });
