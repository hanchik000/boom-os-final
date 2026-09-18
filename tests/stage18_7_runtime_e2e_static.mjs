import assert from 'node:assert/strict';
import fs from 'node:fs';

const root = new URL('..', import.meta.url).pathname;
const kpi = fs.readFileSync(`${root}/server/routes/kpi.ts`, 'utf8');
const payments = fs.readFileSync(`${root}/server/routes/payments.ts`, 'utf8');
const pos = fs.readFileSync(`${root}/server/routes/operator-pos.ts`, 'utf8');
const db = fs.readFileSync(`${root}/server/db.ts`, 'utf8');

assert.match(kpi, /metric_value:valueText/);
assert.match(kpi, /ORDER_WAITER/);
assert.match(kpi, /PAYMENT_CASHIER/);
assert.match(kpi, /valueCents>=thresholdCents/);
assert.match(kpi, /valueCents>thresholdCents/);
assert.match(kpi, /percentBps/);
assert.match(kpi, /kpi_ledger/);

const idemPos = payments.indexOf("SELECT * FROM payments WHERE branch_id=? AND idempotency_key=?");
const statePos = payments.indexOf("ORDER_NOT_READY_FOR_PAYMENT");
assert.ok(idemPos >= 0 && statePos >= 0 && idemPos < statePos, 'payment replay must be resolved before mutable order-state rejection');
assert.match(payments, /ON CONFLICT|idempotency_key/);
assert.match(payments, /requireOperatorPosSession/);
assert.match(pos, /status='ACTIVE'/);
assert.match(pos, /expires_at>\?/);
assert.match(db, /function transaction|export.*transaction/);

console.log('STAGE 18.7 STATIC ACCEPTANCE: 12/12 checks passed');
