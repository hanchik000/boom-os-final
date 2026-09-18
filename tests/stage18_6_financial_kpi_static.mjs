import fs from 'node:fs';
import assert from 'node:assert/strict';
const kpi=fs.readFileSync('server/routes/kpi.ts','utf8');
const payments=fs.readFileSync('server/routes/payments.ts','utf8');
const schema=fs.readFileSync('prisma/schema.prisma','utf8');
assert.match(kpi,/function moneyCents/);
assert.match(kpi,/BigInt\(a\)\*100n/);
assert.match(kpi,/valueCents/);
assert.match(kpi,/thresholdCents/);
assert.match(kpi,/percentBps/);
assert.match(kpi,/valueCents\*percentBps\(r\.reward_value\)/);
assert.doesNotMatch(kpi,/Number\(sales\?\.value/);
assert.doesNotMatch(kpi,/value\*Number\(r\.reward_value\)/);
assert.match(payments,/function cents\(v:unknown\)/);
assert.match(payments,/requested!==remaining/);
assert.match(payments,/Idempotency-Key/);
// Stage 34.1 moved the payment reversal itself into the shared closure core so the approval route
// and the refund route cannot diverge; the invariant (a refund sets the payment to REFUNDED) is
// unchanged, so it is asserted where it now lives.
assert.match(fs.readFileSync('server/order-closure.ts','utf8'),/UPDATE payments SET status='REFUNDED'/);
assert.match(schema,/uq_kpi_ledger_rule_user_period|kpi_ledger/);
console.log('STAGE 18.6 FINANCIAL/KPI STATIC ACCEPTANCE: 12/12 checks passed');
