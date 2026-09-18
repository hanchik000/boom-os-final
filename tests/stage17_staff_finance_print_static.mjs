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
 ['branch service charge calculation',read('server/routes/orders.ts').includes('service_charge_configs')],
 ['trial excluded from waiter allocation',read('server/routes/payments.ts').includes("waiter.status!=='PROFESSIONAL'")],
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
assert17(orders17.includes("SELECT percent FROM service_charge_configs WHERE branch_id=? AND status='ACTIVE'"), 'Order item removal must use branch Service Charge configuration');
console.log('STAGE 17.1 HARDENING: PASS');
