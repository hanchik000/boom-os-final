import fs from 'node:fs';
import path from 'node:path';
const root=path.resolve(new URL('..',import.meta.url).pathname);
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const schema=read('prisma/schema.prisma');
const auth=read('server/auth.ts');
const waiters=read('server/routes/waiters.ts');
const payments=read('server/routes/payments.ts');
const serviceChargeCore=read('server/service-charge.ts');
const orders=read('server/routes/orders.ts');
const operator=read('server/routes/operator-pos.ts');
const checks=[
 ['Branch model has MenuModifierGroup inverse relation',schema.includes('menu_modifier_groups   MenuModifierGroup[]')],
 ['Waiter default status is PROBATION',schema.includes('status       String   @default("PROBATION")')],
 ['Waiter status API accepts PROBATION/PROFESSIONAL',waiters.includes("['PROBATION','PROFESSIONAL']")],
 // Stage 34.2 moved both invariants into the one service-charge core; they are asserted there, plus
 // the delegation from the payment and order paths that used to hold their own copies.
 ['Service charge excludes non-professional waiters',serviceChargeCore.includes("waiter.status === 'PROFESSIONAL'") && payments.includes('recordServiceChargeLedger')],
 ['DINE_IN service charge is configurable',serviceChargeCore.includes('service_charge_configs') && orders.includes('serviceChargePercentFor')],
 ['TAKEAWAY has no table',orders.includes("orderType==='TAKEAWAY'&&tableId")],
 ['Branch middleware fails closed when branch missing',auth.includes("code: 'BRANCH_REQUIRED'")],
 ['Operator lock endpoint exists',operator.includes("router.post('/lock'")],
 ['Operator unlock verifies password',operator.includes('verifyPassword')],
 ['Historical user archive uses deleted_at',read('server/routes/users.ts').includes('SET deleted_at')],
 ['Historical franchise archive uses deleted_at',read('server/routes/franchises.ts').includes('SET deleted_at')],
 ['Historical menu item archive uses deleted_at',read('server/routes/menu.ts').includes("UPDATE menu_items SET deleted_at")],
 ['Order snapshots preserve historical price/title',schema.includes('title_snapshot')&&schema.includes('price_snapshot')],
 ['Service charge ledger exists',schema.includes('model ServiceChargeLedger')],
 ['KPI ledger exists',schema.includes('model KpiLedger')],
];
const failed=checks.filter(([,ok])=>!ok);
if(failed.length){console.error('STAGE 18.2 HARDENING: FAIL'); for(const [n] of failed) console.error(' - '+n); process.exit(1);}
console.log(`STAGE 18.2 HARDENING: PASS (${checks.length}/${checks.length})`);
