// BOOM OS -- Stage 34.4 static source guards: split bill / separate checks.
// Guards against the one thing that must never happen -- revenue counted twice -- and against a
// second Order Core, a second payment path, stock consumed once per bill, or a bill being settled
// for an amount the server did not compute.
import fs from 'node:fs';

const failures = []; let checks = 0;
const read = p => fs.readFileSync(p, 'utf8');
function ok(label, cond, detail) { checks++; if (!cond) failures.push(`${label}${detail ? ' -> ' + String(detail).slice(0, 220) : ''}`); }

const bills = read('server/routes/order-bills.ts');
const orders = read('server/routes/orders.ts');
const payments = read('server/routes/payments.ts');
const totals = read('server/order-totals.ts');
const closure = read('server/order-closure.ts');
const schema = read('prisma/schema.prisma');
const serverTs = read('server.ts');
const api = read('src/api.ts');
const cashier = read('src/components/CashierPOSView.tsx');
const waiter = read('src/components/WaiterPOSView.tsx');
const migration = read('prisma/migrations/20260919160000_stage34_4_split_bills/migration.sql');

// ---------------------------------------------------------------- 1. no double counting, by construction
ok('1. an order is in exactly ONE split mode at a time', /split_mode\s+String\s+@default\("NONE"\)/.test(schema) && /SPLIT_MODES = \['NONE', 'ITEMS', 'EQUAL'\]/.test(bills));
ok('2. bills hold no copy of the order total -- they are recomputed from the order\'s own items', /FROM order_items WHERE order_id=\? AND bill_id=\?/.test(totals));
ok('3. an item belongs to at most one bill', (() => {
  const model = /model OrderItem \{[\s\S]*?\n\}/.exec(schema)[0];
  return /bill_id\s+String\?/.test(model) && /bill\s+OrderBill\? @relation\(fields: \[bill_id\]/.test(model);
})());
ok('4. the ITEMS split apportions the service charge so the bills sum back to the order exactly', /splitProportionally\(service, weights\)/.test(totals));
ok('5. the EQUAL split divides to the cent with no remainder lost', /function splitEvenly/.test(totals) && /let leftover = total - base \* n;/.test(totals));
ok('6. the order keeps every discount exactly once, whatever scope it was granted on', /FROM order_discounts WHERE order_id=\? AND status='ACTIVE'/.test(totals) && /d\.bill_id \? \(billSubtotals\.get\(d\.bill_id\) \?\? 0n\) : subtotal/.test(totals));

// ---------------------------------------------------------------- 2. one payment path, stock once
ok('7. there is still exactly one payment creation route', (payments.match(/router\.post\('\/',requirePermission\('payments\.create'\)/g) || []).length === 1);
ok('8. a split order must be paid per bill, never as a whole', /BILL_REQUIRED_FOR_SPLIT_ORDER/.test(payments) && /if\(!billIdRaw\)throw Object\.assign\(new Error\('BILL_REQUIRED_FOR_SPLIT_ORDER'\)/.test(payments));
ok('9. an unsplit order still refuses a bill id', /} else if\(billIdRaw\) throw Object\.assign\(new Error\('ORDER_NOT_SPLIT'\)/.test(payments));
// Stage 34.7 made BOOMBACK the one method that may settle part of a check (it is money the guest
// holds, not a price change). Every other method must still match the remaining amount exactly,
// and the remaining amount is still the SERVER's figure for that bill.
ok('10. the amount must equal what the SERVER computed for that bill', /const total=cents\(isSplit\?bill\.final_amount:order\.final_amount\);const remaining=total-paid;/.test(payments) && /allowPartial \? \(requested>remaining\|\|requested<=0n\) : \(requested!==remaining\)/.test(payments) && /const allowPartial=PARTIAL_METHODS\.has\(method\);/.test(payments));
// Same gate, now also closed against a partially settled order: a check with BOOMBACK paid and
// cash still owed has not been settled, so nothing is consumed or completed yet.
ok('11. consumption and the service charge ledger run ONCE per order, when the last bill closes', /const stillOpen=!fullySettled\?\{id:'partial'\}:\(isSplit\?await tx\.queryOne<any>\(`SELECT id FROM order_bills WHERE order_id=\? AND status='OPEN' LIMIT 1`/.test(payments) && /if\(!stillOpen\)\{[\s\S]{0,200}consumeInventoryForOrder/.test(payments));
ok('12. a paid bill can never be paid again', /if\(bill\.status==='PAID'\)throw Object\.assign\(new Error\('BILL_ALREADY_PAID'\)/.test(payments));

// ---------------------------------------------------------------- 3. split operations are safe
ok('13. only an open order can be split', /SPLITTABLE_ORDER_STATUSES = \['PENDING_CONFIRMATION', 'CONFIRMED', 'PREPARING', 'READY'\]/.test(bills) && /ORDER_NOT_SPLITTABLE/.test(bills));
ok('14. an order cannot be split twice', /ORDER_ALREADY_SPLIT/.test(bills));
ok('15. items can only be moved in ITEMS mode', /ITEM_MOVE_NOT_ALLOWED_IN_MODE/.test(bills) && /String\(order\.split_mode\) !== 'ITEMS'/.test(bills));
ok('16. a partial line move splits the line at the SAME snapshotted unit price and copies its modifiers', /const unit = String\(item\.price_snapshot\)/.test(bills) && /INSERT INTO order_item_modifiers/.test(bills));
ok('17. items cannot be moved off or onto a paid bill', (bills.match(/BILL_ALREADY_PAID/g) || []).length >= 4);
ok('18. merging is refused once any bill has been paid', /MERGE_BLOCKED_BY_PAID_BILL/.test(bills));
ok('19. a bill holding items cannot be voided, and voiding is soft', /BILL_NOT_EMPTY/.test(bills) && /UPDATE order_bills SET status='VOID'/.test(bills) && !/DELETE FROM order_bills/.test(bills));
ok('20. closing an order voids its open bills', /UPDATE order_bills SET status='VOID',updated_at=\? WHERE order_id=\? AND status='OPEN'/.test(closure));

// ---------------------------------------------------------------- 4. discounts cannot be double-applied
ok('21. a split order is discounted per bill, never at order level', /BILL_REQUIRED_FOR_SPLIT_ORDER/.test(orders) && /if \(!requestedBillId\) throw Object\.assign\(new Error\('BILL_REQUIRED_FOR_SPLIT_ORDER'\)/.test(orders));
ok('22. an unsplit order refuses a bill-scoped discount', /if \(requestedBillId\) throw Object\.assign\(new Error\('ORDER_NOT_SPLIT'\)/.test(orders));
ok('23. splitting releases any order-level discount first, so there is only ever one answer', /UPDATE order_discounts SET status='REMOVED'[\s\S]{0,120}bill_id IS NULL AND status='ACTIVE'/.test(bills));
ok('24. an EQUAL split has no per-bill item base, so it refuses a per-bill discount rather than guessing', /DISCOUNT_NOT_SUPPORTED_IN_EQUAL_SPLIT/.test(orders));

// ---------------------------------------------------------------- 5. one core, RBAC, audit, money
ok('25. the bills router is mounted once, before the orders router, and wired into async forwarding', (serverTs.match(/app\.use\('\/api\/orders', orderBillsRouter\)/g) || []).length === 1 && serverTs.indexOf("app.use('/api/orders', orderBillsRouter)") < serverTs.indexOf("app.use('/api/orders', ordersRouter)") && /orderBillsRouter, ordersRouter/.test(serverTs));
ok('26. no second order or payment table was introduced', (schema.match(/^model Order \{/m) || []).length === 1 && (schema.match(/^model Payment \{/m) || []).length === 1);
ok('27. every bill route is branch- or waiter-scoped with the existing helpers', /order\.branch_id !== actor\.waiterBranchId \|\| order\.waiter_user_id !== actor\.waiterUserId/.test(bills) && /} else if \(!allowed\(req, order\.branch_id\)\)/.test(bills));
ok('28. split, move, void and merge are all audited', ['ORDER_SPLIT', 'ORDER_BILL_ITEM_MOVED', 'ORDER_BILL_VOIDED', 'ORDER_BILLS_MERGED'].every(a => bills.includes(a)));
ok('29. all bill money is BigInt cents -- no Float', !/parseFloat/.test(totals) && !/parseFloat/.test(bills));
ok('30. the migration is additive: one new table plus nullable columns', /CREATE TABLE "order_bills"/.test(migration) && /ADD COLUMN\s+"bill_id" TEXT/.test(migration) && !/DROP TABLE/.test(migration));

// ---------------------------------------------------------------- 6. frontend
ok('31. the API client exposes the split flow for both POS surfaces', /splitOrderBills/.test(api) && /splitWaiterOrderBills/.test(api) && /mergeWaiterOrderBills/.test(api));
ok('32. the cashier pays a bill with the amount the server put on that bill', /bill_id: payingBill\.id/.test(cashier) && /String\(payingBill \? payingBill\.final_amount : detail\.final_amount\)/.test(cashier));
ok('33. and its idempotency key is per bill, so two bills are never confused', /payingBill \? `cashier-pay-bill-\$\{payingBill\.id\}`/.test(cashier));
ok('34. a split order hides the whole-order pay button entirely', /splitMode !== 'NONE' \? \(/.test(cashier));
ok('35. neither POS computes a bill total itself', !/splitEvenly|splitProportionally/.test(cashier) && !/splitEvenly|splitProportionally/.test(waiter));
ok('36. the waiter POS can split by items, split equally and merge back', /doSplit\('ITEMS'\)/.test(waiter) && /doSplit\('EQUAL'\)/.test(waiter) && /doMerge\(\)/.test(waiter));
ok('37. RU + TK copy on the cashier bill panel', /Отдельные счета/.test(cashier) && /Aýratyn hasaplar/.test(cashier));

console.log(`Stage 34.4 static checks: ${checks}`);
if (failures.length) { console.error(`\nFAILURES (${failures.length}):`); for (const f of failures) console.error(' - ' + f); process.exit(1); }
console.log('ALL STAGE 34.4 STATIC CHECKS PASSED');
