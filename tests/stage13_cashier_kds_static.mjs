import fs from 'node:fs';
import assert from 'node:assert/strict';
const schema=fs.readFileSync('prisma/schema.prisma','utf8');
const migration=fs.readFileSync('prisma/migrations/20260908000900_cashier_kds_payments/migration.sql','utf8');
const server=fs.readFileSync('server.ts','utf8');
const seed=fs.readFileSync('server/seed.ts','utf8');
const payments=fs.readFileSync('server/routes/payments.ts','utf8');
const shifts=fs.readFileSync('server/routes/cash-shifts.ts','utf8');
const kds=fs.readFileSync('server/routes/kds.ts','utf8');
for (const m of ['CashShift','Payment','KdsTicket']) assert.match(schema,new RegExp(`model ${m}\\s`));
for (const t of ['cash_shifts','payments','kds_tickets']) assert.match(migration,new RegExp(`CREATE TABLE "${t}"`));
assert.match(migration,/uq_cash_shifts_one_open_per_branch/);
assert.match(payments,/Idempotency-Key/); assert.match(payments,/PAYMENT_AMOUNT_MUST_EQUAL_REMAINING/); assert.match(payments,/payments\.refund/);
// Stage 34.1 moved the reversal itself into the shared closure core (server/order-closure.ts) so
// that the approval route and the refund route cannot diverge. The invariant is unchanged -- a
// refund still writes a PAYMENT_REFUNDED audit entry -- so assert it where it now lives, and
// assert that the payments module really routes its refund through that one implementation.
const closureCore=fs.readFileSync('server/order-closure.ts','utf8');
assert.match(closureCore,/action: 'PAYMENT_REFUNDED'/);
assert.match(payments,/refundPaymentFinancials\(tx,p,req\.user!\.id,req,now\)/);
assert.match(shifts,/SHIFT_ALREADY_OPEN/); assert.match(shifts,/SHIFT_CLOSED/); assert.match(shifts,/type:'X',closes_shift:false/); assert.match(shifts,/type:'Z',closes_shift:true/);
assert.match(kds,/KDS_INVALID_TRANSITION/); assert.match(kds,/KDS_STATUS_CHANGED/); assert.match(kds,/PREPARING/); assert.match(kds,/READY/); assert.match(kds,/COMPLETED/);
assert.match(server,/app\.use\('\/api\/payments'/); assert.match(server,/app\.use\('\/api\/cash-shifts'/); assert.match(server,/app\.use\('\/api\/kds'/);
assert.doesNotMatch(server,/futureModules = \['kitchen'/);
assert.match(seed,/payments\.create/); assert.match(seed,/cash_shifts\.open/); assert.match(seed,/kds\.update/);
console.log('Stage 13 cashier/KDS/payments static acceptance: PASSED');
