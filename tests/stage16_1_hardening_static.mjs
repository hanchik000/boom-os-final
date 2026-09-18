import fs from 'node:fs';
import path from 'node:path';
const root=process.cwd();
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const orders=read('server/routes/orders.ts');
const payments=read('server/routes/payments.ts');
const menu=read('server/routes/menu.ts');
const kds=read('server/routes/kds.ts');
const waiter=read('src/components/WaiterPOSView.tsx');
const api=read('src/api.ts');
const app=read('src/App.tsx');
const sidebar=read('src/components/Sidebar.tsx');
const mig=read('prisma/migrations/20260908000900_cashier_kds_payments/migration.sql');
const config=read('server/config.ts');
const server=read('server.ts');
const checks=[
  [orders.includes('SELECT id,menu_item_id,min_select,max_select,required FROM menu_modifier_groups') || orders.includes('SELECT id,menu_item_id,min_select,max_select,required'), 'Order validation must load all modifier groups, including unselected required groups'],
  [orders.includes('Boolean(g.required)&&count<1'), 'Required modifier groups must require a selection'],
  [menu.includes('(required && min<1)'), 'Required modifier groups cannot be created with min_select=0'],
  [menu.includes('/^\\d+(?:\\.\\d{1,2})?$/'), 'Menu prices/modifier deltas must be non-negative precise decimals'],
  [orders.includes("status='AVAILABLE'") && orders.includes('releaseTableIfNoActiveOrders'), 'Tables must be released after terminal order lifecycle'],
  [payments.includes("!['READY'].includes(order.status)") && payments.includes('KDS_NOT_READY_FOR_PAYMENT'), 'Payment must wait for cashier confirmation and kitchen readiness'],
  [payments.includes("'RETURN'") && payments.includes('restoreInventoryForOrder'), 'Refund must restore inventory with RETURN movements'],
  [payments.includes("p.method==='CASH'"), 'Only cash refunds affect expected cash'],
  [mig.includes(`WHERE "status" = 'OPEN'`), 'One open cash shift per branch must be enforced at database level'],
  [kds.includes("next === 'COMPLETED' ? 'READY'"), 'KDS completion must not mark an unpaid order completed'],
  [read('server/routes/orders.ts').includes("'PREPARING','READY'"), 'Manager-approved item removal must remain available through kitchen-ready state before payment'],
  [waiter.includes('modifierPicker') && waiter.includes('modifier_ids:x.modifierIds'), 'Waiter POS must expose modifier selection and send modifier IDs'],
  [api.includes('createPayment') && api.includes('getKds') && api.includes('openCashShift'), 'Frontend API client must expose cashier/KDS/shift operations'],
  [app.includes('OperationsView') && sidebar.includes("id: 'operations'"), 'Cashier/KDS operations UI must be reachable'],
  [read('src/components/OperationsView.tsx').includes('confirmOrder') && read('src/components/OperationsView.tsx').includes("status==='PENDING_CONFIRMATION'"), 'Cashier UI must expose order confirmation before payment'],
  [read('server/openapi.ts').includes("'/api/payments'") && read('server/openapi.ts').includes("'/api/kds'") && read('server/openapi.ts').includes("'/api/menu/items/{itemId}/modifiers'"), 'OpenAPI must document operational and modifier endpoints'],
  [config.includes("redisUrl: optional('REDIS_URL'") && server.includes("const isHealthy = dbStatus === 'CONNECTED';"), 'Server startup/health must not require an unused Redis dependency'],
];
for(const [ok,msg] of checks) if(!ok) throw new Error(msg);
console.log(`STAGE 16.1 HARDENING STATIC ACCEPTANCE: PASSED (${checks.length}/${checks.length})`);
