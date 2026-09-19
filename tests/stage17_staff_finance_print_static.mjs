import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(new URL('..', import.meta.url).pathname);
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const schema=read('prisma/schema.prisma');
const migration=read('prisma/migrations/20260909100000_stage17_staff_finance_kpi_print/migration.sql');
const checks=[
 ['waiter profile',schema.includes('model WaiterProfile')&&schema.includes('PROBATION')],
 ['waiter history',schema.includes('model WaiterStatusHistory')],
 ['service charge config',schema.includes('model ServiceChargeConfig')],
 ['service charge ledger',schema.includes('model ServiceChargeLedger')],
 ['kpi rule and ledger',schema.includes('model KpiRule')&&schema.includes('model KpiLedger')],
 ['operator session',schema.includes('model OperatorPosSession')],
 ['print profile and jobs',schema.includes('model PrintProfile')&&schema.includes('model PrintJob')],
 ['menu archive fields',migration.includes('ALTER TABLE "menu_items" ADD COLUMN "deleted_at"')&&migration.includes('ALTER TABLE "menu_categories" ADD COLUMN "deleted_at"')],
 ['service charge route mounted',read('server.ts').includes("app.use('/api/service-charge', serviceChargeRouter)")],
 ['kpi route mounted',read('server.ts').includes("app.use('/api/kpi', kpiRouter)")],
 ['operator route mounted',read('server.ts').includes("app.use('/api/operator-pos', operatorPosRouter)")],
 ['print route mounted',read('server.ts').includes("app.use('/api/print', printRouter)")],
 // Stage 34.2 moved both of these into the one service-charge core (server/service-charge.ts) so
 // the order-pricing path and the ledger path cannot diverge. The invariants are unchanged -- the
 // branch's own configuration still drives the percentage, and a non-PROFESSIONAL waiter still does
 // not share in the service charge -- so they are asserted where they now live, plus the fact that
 // the routes really delegate to that core.
 ['branch service charge calculation',read('server/service-charge.ts').includes('service_charge_configs') && read('server/routes/orders.ts').includes('serviceChargePercentFor')],
 ['trial excluded from waiter allocation',read('server/service-charge.ts').includes("waiter.status === 'PROFESSIONAL'") && read('server/routes/payments.ts').includes('recordServiceChargeLedger')],
 ['kpi strict threshold',read('server/routes/kpi.ts').includes("valueCents>thresholdCents")],
 ['print reprint audit',read('server/routes/print.ts').includes('PRINT_REPRINT_REQUESTED')],
 ['operator password verification',read('server/routes/operator-pos.ts').includes('verifyPassword')],
];
const failed=checks.filter(([,ok])=>!ok);
if(failed.length){console.error('STAGE 17 STATIC ACCEPTANCE: FAIL'); for(const [n] of failed) console.error(' -',n); process.exit(1);}
console.log(`STAGE 17 STATIC ACCEPTANCE: PASS (${checks.length}/${checks.length})`);


const schema17 = read('prisma/schema.prisma');
const assert17 = (ok,msg) => { if(!ok){ console.error(' -',msg); process.exit(1); } };
assert17(schema17.includes('model MenuItem') && schema17.includes('deleted_at'), 'MenuItem historical archive field missing from Prisma schema');
assert17(schema17.includes('model MenuCategory') && schema17.slice(schema17.indexOf('model MenuCategory'), schema17.indexOf('model MenuItem')).includes('deleted_at'), 'MenuCategory historical archive field missing from Prisma schema');
const menu17 = read('server/routes/menu.ts');
assert17(menu17.includes("router.delete('/items/:id'"), 'Menu item soft-delete endpoint missing');
assert17(menu17.includes('deleted_at IS NULL'), 'Menu reads must exclude archived menu records');
const orders17 = read('server/routes/orders.ts');
// Same invariant, resolved through the Stage 34.2 service-charge core -- and strengthened: the
// recalculation must use the configuration version in force when the ORDER was created, never the
// one configured today, so removing an item can never silently re-price an old order.
assert17(orders17.includes('serviceChargePercentFor(tx, order.branch_id, order.order_type, order.created_at)'), 'Order item removal must use branch Service Charge configuration');
console.log('STAGE 17.1 HARDENING: PASS');
