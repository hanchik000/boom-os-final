import assert from 'node:assert/strict';
import fs from 'node:fs';

const root = new URL('..', import.meta.url).pathname;
const pos = fs.readFileSync(`${root}/server/routes/operator-pos.ts`, 'utf8');
const kpi = fs.readFileSync(`${root}/server/routes/kpi.ts`, 'utf8');
const migration = fs.readFileSync(`${root}/prisma/migrations/20260911100000_stage18_4_runtime_hardening/migration.sql`, 'utf8');

assert.match(pos, /x-pos-session-token/);
assert.match(pos, /status='ACTIVE'/);
assert.match(pos, /expires_at>\?/);
assert.match(pos, /req\.body\?\.order_id/);
assert.match(pos, /SELECT branch_id FROM orders WHERE id=\?/);
assert.match(pos, /SELECT branch_id FROM payments WHERE id=\?/);
assert.match(pos, /BRANCH_ACCESS_DENIED/);
assert.match(pos, /UPDATE operator_pos_sessions SET last_seen_at/);
assert.match(pos, /UPDATE operator_pos_sessions SET status='LOCKED'/);
assert.match(migration, /uq_operator_pos_one_active_per_user_branch/);
assert.match(migration, /WHERE "status" = 'ACTIVE'/);
assert.match(kpi, /o\.waiter_user_id=\?/);
assert.match(kpi, /p\.cashier_user_id=\?/);

console.log('STAGE 18.4 STATIC ACCEPTANCE: 12/12 checks passed');
