import fs from 'node:fs';
import assert from 'node:assert/strict';

const forbiddenPaths = [
  'data/legacy/boom_os.sqlite',
  'data/sqlite_data_backup.json',
  'data/backup_boom_os_sqlite_pre_postgres.sqlite',
  'server/migrate_data.ts'
];

for (const relativePath of forbiddenPaths) {
  assert.equal(fs.existsSync(new URL(`../${relativePath}`, import.meta.url)), false, `legacy source artifact remains: ${relativePath}`);
}

const seed = fs.readFileSync(new URL('../server/seed.ts', import.meta.url), 'utf8');
for (const demo of [
  'Serdar Annayev', 'Merdan Kurbanov', 'Aman Berdyev', 'Gulnar Merdova',
  'Batyr Durdylyyev', 'Boom Burger Group', 'Kopetdag Grill & Lounge',
  'Awaza Sea Breeze Cafe', '126 550', '28450', '34200', '489500',
  'const branchesList', 'const usersList'
]) {
  assert.equal(seed.includes(demo), false, `seed contains demo/business fixture: ${demo}`);
}

assert.equal(seed.includes('BOOTSTRAP_OWNER_PASSWORD'), true, 'owner bootstrap configuration must remain supported');
assert.equal(seed.includes('No bootstrap owner configured. BOOM OS remains empty'), true, 'seed must support a genuinely empty business baseline');

const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
assert.equal(pkg.scripts?.['db:import'], undefined, 'legacy data importer must not be part of the normal project scripts');

console.log('Stage 12 clean-source static acceptance: PASSED');
