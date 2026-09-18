import fs from 'node:fs';
import assert from 'node:assert/strict';

const schema = fs.readFileSync('prisma/schema.prisma','utf8');
const orders = fs.readFileSync('server/routes/orders.ts','utf8');
const seed = fs.readFileSync('server/seed.ts','utf8');
const migration = fs.readFileSync('prisma/migrations/20260908001100_order_item_removal_approvals/migration.sql','utf8');
const kds = fs.readFileSync('server/routes/kds.ts','utf8');
const openapi = fs.readFileSync('server/openapi.ts','utf8');

assert.match(schema, /model OrderItemRemovalApproval/);
assert.match(schema, /removed_quantity Decimal/);
assert.match(schema, /status\s+String\s+@default\("ACTIVE"\)/);
assert.match(migration, /CREATE TABLE "order_item_removal_approvals"/);
assert.match(migration, /ADD COLUMN "removed_quantity"/);
assert.match(orders, /removal-request/);
assert.match(orders, /orders\.item_remove\.approve/);
assert.match(orders, /SELF_APPROVAL_FORBIDDEN/);
assert.match(orders, /fullRemoval\?'REMOVED':'ACTIVE'/);
assert.match(orders, /MANAGER_APPROVAL/);
assert.match(orders, /FOR UPDATE/);
assert.match(seed, /orders\.item_remove\.request/);
assert.match(seed, /orders\.item_remove\.approve/);
assert.match(kds, /oi\.status='ACTIVE'/);
assert.doesNotMatch(orders, /DELETE FROM order_items/);
assert.match(openapi, /removal-requests/);
console.log('Stage 15 item-removal approval static acceptance: PASS');
