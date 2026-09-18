import fs from 'node:fs';
import assert from 'node:assert/strict';

const seed = fs.readFileSync(new URL('../server/seed.ts', import.meta.url), 'utf8');
const env = fs.readFileSync(new URL('../.env.example', import.meta.url), 'utf8');

for (const demo of ['Serdar Annayev', 'Merdan Kurbanov', 'Aman Berdyev', 'Gulnar Merdova', 'Batyr Durdylyyev', 'usr_admin_02', 'usr_mgr_03', 'usr_cashier_04', 'br_arb_01', 'br_fla_02', 'br_sev_03']) {
  assert.equal(seed.includes(demo), false, `seed contains removed demo entity: ${demo}`);
}
assert.equal(seed.includes('const branchesList'), false, 'seed still contains a branch demo list');
assert.equal(seed.includes('const usersList'), false, 'seed still contains a demo user list');
assert.equal(seed.includes('const bootstrapPassword = process.env.BOOTSTRAP_OWNER_PASSWORD'), true, 'owner bootstrap must be environment-driven');
assert.equal(seed.includes("No bootstrap owner configured. BOOM OS remains empty"), true, 'empty-system path must be explicit');
assert.equal(env.includes('BOOTSTRAP_OWNER_EMAIL='), true, '.env.example must document owner bootstrap');
assert.equal(env.includes('BOOTSTRAP_OWNER_PASSWORD='), true, '.env.example must document owner bootstrap password');
console.log('Stage 11 empty-baseline static acceptance: PASSED');
