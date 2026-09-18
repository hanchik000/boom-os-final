import { Router, Request } from 'express';
import crypto from 'node:crypto';
import { query, queryOne, transaction, TxClient } from '../db';
import { authenticateToken, requirePermission, insertAuditLog } from '../auth';
import { requireOperatorPosSession } from './operator-pos';
import { applyCreditSale } from './credit';
import { refundPaymentFinancials } from '../order-closure';
const router=Router();
const METHODS=new Set(['CASH','CARD','ONLINE','BONUS','OTHER','CREDIT']);
function cents(v:unknown){const s=String(v??'').trim();if(!/^\d+(?:\.\d{1,2})?$/.test(s))throw new Error('INVALID_MONEY');const [a,b='']=s.split('.');return BigInt(a)*100n+BigInt((b+'00').slice(0,2));}
function text(c:bigint){return `${c/100n}.${(c%100n).toString().padStart(2,'0')}`;}
function allowed(req:Request,b:string){return Boolean(req.user?.isSuperUser||req.user?.allowedBranchIds.includes(b));}
async function recordServiceChargeLedger(tx:TxClient, order:any, actorId:string, now:string){
  if(order.order_type!=='DINE_IN' || String(order.service_charge||'0')==='0.00') return;
  const cfg=await tx.queryOne<any>('SELECT id,percent FROM service_charge_configs WHERE branch_id=? AND status=\'ACTIVE\'',[order.branch_id]);
  if(!cfg) return;
  const allocations=await tx.query<any>('SELECT * FROM service_charge_allocations WHERE config_id=? AND active=true',[cfg.id]);
  for(const a of allocations){
    let userId=a.user_id||null;
    if(String(a.target_type).toUpperCase()==='INDIVIDUAL' && userId!==order.waiter_user_id) continue;
    if(String(a.department||'').toUpperCase() === 'WAITERS'){
      if(!order.waiter_user_id) continue;
      userId=order.waiter_user_id;
      const waiter=await tx.queryOne<any>('SELECT wp.status FROM waiter_profiles wp WHERE wp.user_id=?',[userId]);
      if(waiter && waiter.status!=='PROFESSIONAL') continue;
    }
    const base=String(order.subtotal||'0');
    const baseCents=cents(base); const pctHundredths=cents(String(a.percent)); const amountCents=(baseCents*pctHundredths)/10000n; const amount=text(amountCents);
    await tx.execute('INSERT INTO service_charge_ledger (id,branch_id,order_id,user_id,target_type,department,base_amount,percent,amount,status,created_at) VALUES (?,?,?,?,?,?,CAST(? AS numeric),CAST(? AS numeric),CAST(? AS numeric),\'EARNED\',?) ON CONFLICT (order_id,user_id,target_type,department) DO NOTHING',[`scl_${crypto.randomUUID()}`,order.branch_id,order.id,userId,a.target_type,a.department,base,a.percent,amount,now]);
  }
}

async function releaseTableIfNoActiveOrders(tx:TxClient, tableId:string, branchId:string, now:string) {
  const active=await tx.queryOne<any>(`SELECT id FROM orders WHERE table_id=? AND branch_id=? AND status NOT IN ('COMPLETED','REFUNDED','CANCELLED','CLOSED_BY_ESTABLISHMENT') LIMIT 1`,[tableId,branchId]);
  if(!active) await tx.execute(`UPDATE dining_tables SET status='AVAILABLE',updated_at=? WHERE id=? AND branch_id=? AND status='OCCUPIED'`,[now,tableId,branchId]);
}
// Stage 34.1: the former restoreInventoryForOrder helper -- which unconditionally put every consumed
// ingredient back on the shelf whenever a payment was refunded -- was deleted. Refunding money is
// not returning ingredients: by construction a payment only exists once the kitchen ticket reached
// READY, so every refundable order is an order whose food was already produced and can never be
// restored. What happens to the products is now an explicit, manager-approved decision carried on
// the order_closures row and applied by applyInventoryTreatment in ../order-closure.

// Stage 34: quantities and unit costs are both stored with up to 4 decimal places
// (inventory_items.average_cost, recipe_ingredients.quantity are both DECIMAL(14,4)); these
// helpers keep that arithmetic in BigInt ten-thousandths throughout -- no Float anywhere in the
// recipe-cost snapshot computed alongside consumption.
function scaled4(v: unknown): bigint {
  const s = String(v ?? '0').trim();
  if (!/^-?\d+(?:\.\d{1,4})?$/.test(s)) return 0n;
  const neg = s.startsWith('-'); const clean = neg ? s.slice(1) : s;
  const [a, b = ''] = clean.split('.');
  const c = BigInt(a) * 10000n + BigInt((b + '0000').slice(0, 4));
  return neg ? -c : c;
}
function fromScaled4(c: bigint): string { const neg = c < 0n; const abs = neg ? -c : c; return `${neg ? '-' : ''}${abs / 10000n}.${(abs % 10000n).toString().padStart(4, '0')}`; }

async function consumeInventoryForOrder(tx:TxClient, orderId:string, branchId:string, userId:string, now:string) {
  const items=await tx.query<any>('SELECT id,menu_item_id,quantity FROM order_items WHERE order_id=?',[orderId]);
  for(const orderItem of items){
    if(!orderItem.menu_item_id) continue;
    const recipe=await tx.queryOne<any>('SELECT id,version,yield_qty FROM recipes WHERE branch_id=? AND menu_item_id=? AND active=true',[branchId,orderItem.menu_item_id]);
    if(!recipe) continue;
    const ingredients=await tx.query<any>('SELECT inventory_item_id,quantity FROM recipe_ingredients WHERE recipe_id=?',[recipe.id]);
    let lineCostScaled4 = 0n;
    for(const ingredient of ingredients){
      const requiredRow=await tx.queryOne<any>(`SELECT (CAST(? AS DECIMAL(14,4))*CAST(? AS DECIMAL(14,4))/NULLIF(CAST(? AS DECIMAL(14,4)),0)) AS required_qty`,[ingredient.quantity,orderItem.quantity,recipe.yield_qty]);
      const required=String(requiredRow.required_qty);
      const stock=await tx.queryOne<any>('SELECT id,current_stock,average_cost FROM inventory_items WHERE id=? AND branch_id=? AND active=true FOR UPDATE',[ingredient.inventory_item_id,branchId]);
      if(!stock) throw Object.assign(new Error('INVENTORY_ITEM_NOT_FOUND'),{httpStatus:409});
      const check=await tx.queryOne<any>('SELECT (CAST(current_stock AS DECIMAL(14,4))-CAST(? AS DECIMAL(14,4))) AS remaining FROM inventory_items WHERE id=? FOR UPDATE',[required,stock.id]);
      if(Number(check.remaining)<0) throw Object.assign(new Error('INSUFFICIENT_STOCK'),{httpStatus:409,details:{inventory_item_id:stock.id,required_quantity:required,current_stock:String(stock.current_stock)}});
      await tx.execute(`UPDATE inventory_items SET current_stock=current_stock-CAST(? AS numeric),updated_at=? WHERE id=? AND branch_id=?`,[required,now,stock.id,branchId]);
      await tx.execute(`INSERT INTO stock_movements (id,branch_id,inventory_item_id,type,quantity,unit_cost,reference_type,reference_id,reason,created_by,created_at) VALUES (?,?,?,?,CAST(? AS numeric),CAST(? AS numeric),?,?,?,?,?) ON CONFLICT (branch_id,reference_type,reference_id,inventory_item_id,type) DO NOTHING`,[`mov_${crypto.randomUUID()}`,branchId,stock.id,'SALE',required,String(stock.average_cost||'0'),'ORDER',orderId,'Consumed by paid order',userId,now]);
      lineCostScaled4 += (scaled4(required) * scaled4(stock.average_cost)) / 10000n;
    }
    // The historical snapshot: this order_item's exact recipe version and its total ingredient
    // cost at the moment of consumption. A later recipe or cost change never touches this row.
    await tx.execute('UPDATE order_items SET recipe_version_snapshot=?,recipe_cost_snapshot=CAST(? AS numeric) WHERE id=?',[recipe.version, fromScaled4(lineCostScaled4), orderItem.id]);
  }
}
router.use(authenticateToken);
router.get('/',requirePermission('payments.view'),async(req,res)=>{const b=typeof req.query.branch_id==='string'?req.query.branch_id:(req.user!.branch_id||'');if(!b||!allowed(req,b))return res.status(403).json({error:'BRANCH_ACCESS_DENIED',code:'BRANCH_ACCESS_DENIED',message:'Branch is outside your access scope.',details:{}});res.json({payments:await query<any>('SELECT * FROM payments WHERE branch_id=? ORDER BY created_at DESC LIMIT 200',[b])});});
router.post('/',requirePermission('payments.create'),requireOperatorPosSession,async(req,res)=>{const orderId=String(req.body?.order_id||''),method=String(req.body?.method||'').toUpperCase(),idem=String(req.headers['idempotency-key']||'').trim().slice(0,128);if(!orderId||!METHODS.has(method)||!idem)return res.status(400).json({error:'VALIDATION_ERROR',code:'PAYMENT_FIELDS_REQUIRED',message:'order_id, supported method and Idempotency-Key are required.',details:{}});let requested;try{requested=cents(req.body?.amount)}catch{return res.status(400).json({error:'VALIDATION_ERROR',code:'INVALID_PAYMENT_AMOUNT',message:'amount must be a non-negative amount with up to two decimals.',details:{}});}if(requested<=0n)return res.status(400).json({error:'VALIDATION_ERROR',code:'PAYMENT_AMOUNT_MUST_BE_POSITIVE',message:'Payment amount must be positive.',details:{}});if(method==='CREDIT'&&!(req.user!.isSuperUser||req.user!.permissions.includes('credit.issue')))return res.status(403).json({error:'FORBIDDEN',code:'CREDIT_ISSUE_PERMISSION_REQUIRED',message:'Issuing a credit sale requires the credit.issue permission.',details:{}});const now=new Date().toISOString(),paymentId=`pay_${crypto.randomUUID()}`;try{const result=await transaction(async(tx)=>{const order=await tx.queryOne<any>('SELECT * FROM orders WHERE id=? FOR UPDATE',[orderId]);if(!order)throw Object.assign(new Error('ORDER_NOT_FOUND'),{httpStatus:404});if(!allowed(req,order.branch_id))throw Object.assign(new Error('BRANCH_ACCESS_DENIED'),{httpStatus:403});const existing=await tx.queryOne<any>('SELECT * FROM payments WHERE branch_id=? AND idempotency_key=?',[order.branch_id,idem]);if(existing)return {payment:existing,replayed:true};if(!['READY'].includes(order.status))throw Object.assign(new Error('ORDER_NOT_READY_FOR_PAYMENT'),{httpStatus:409});const kds=await tx.queryOne<any>("SELECT status FROM kds_tickets WHERE order_id=? AND branch_id=?",[order.id,order.branch_id]);if(!kds||!['READY','COMPLETED'].includes(kds.status))throw Object.assign(new Error('KDS_NOT_READY_FOR_PAYMENT'),{httpStatus:409});const paidRow=await tx.queryOne<any>(`SELECT COALESCE(SUM(amount),0) AS paid FROM payments WHERE order_id=? AND status='PAID'`,[orderId]);const paid=cents(paidRow?.paid||'0');const remaining=cents(order.final_amount)-paid;if(requested!==remaining)throw Object.assign(new Error('PAYMENT_AMOUNT_MUST_EQUAL_REMAINING'),{httpStatus:409});let shiftId:null|string=null;if(method==='CASH'||method==='CARD'){const shift=await tx.queryOne<any>('SELECT id,status FROM cash_shifts WHERE branch_id=? AND status=\'OPEN\' FOR UPDATE',[order.branch_id]);if(!shift)throw Object.assign(new Error('OPEN_SHIFT_REQUIRED'),{httpStatus:409});shiftId=shift.id;}await tx.execute(`INSERT INTO payments (id,order_id,branch_id,cash_shift_id,cashier_user_id,method,status,amount,idempotency_key,created_at,updated_at) VALUES (?,?,?,?,?,?,'PAID',CAST(? AS numeric),?,?,?)`,[paymentId,orderId,order.branch_id,shiftId,req.user!.id,method,text(requested),idem,now,now]);if(shiftId){const col=method==='CASH'?'cash_sales':'card_sales';const expectedExpr=col==='cash_sales'?'opening_cash+cash_sales+CAST(? AS numeric)-refunds-voids':'opening_cash+cash_sales-refunds-voids';const shiftParams=col==='cash_sales'?[text(requested),text(requested),now,shiftId]:[text(requested),now,shiftId];await tx.execute(`UPDATE cash_shifts SET ${col}=${col}+CAST(? AS numeric),expected_cash=${expectedExpr},updated_at=? WHERE id=?`,shiftParams);}
      if(method==='CREDIT'){const accountId=String(req.body?.credit_account_id||'');if(!accountId)throw Object.assign(new Error('CREDIT_ACCOUNT_REQUIRED'),{httpStatus:400});const isManager=Boolean(req.user!.isSuperUser||req.user!.permissions.includes('credit.manage_limit'));await applyCreditSale(tx,{branchId:order.branch_id,accountId,amount:requested,orderId,paymentId,cashierUserId:req.user!.id,isManager,now});}
      await consumeInventoryForOrder(tx,orderId,order.branch_id,req.user!.id,now);
      await recordServiceChargeLedger(tx, order, req.user!.id, now);
      await tx.execute(`UPDATE orders SET status='COMPLETED',updated_at=? WHERE id=?`,[now,orderId]); if(order.table_id) await releaseTableIfNoActiveOrders(tx,order.table_id,order.branch_id,now); await tx.execute(`UPDATE kds_tickets SET status='COMPLETED',completed_at=COALESCE(completed_at,?),updated_at=? WHERE order_id=? AND status<>'CANCELLED'`,[now,now,orderId]);await insertAuditLog(tx.execute,{userId:req.user!.id,branchId:order.branch_id,action:'PAYMENT_CREATED',entityType:'PAYMENT',entityId:paymentId,newValues:{order_id:orderId,method,amount:text(requested)},req});return {payment:await tx.queryOne<any>('SELECT * FROM payments WHERE id=?',[paymentId]),replayed:false};});res.status(result.replayed?200:201).json(result);}catch(e:any){const map:any={ORDER_NOT_FOUND:[404,'NOT_FOUND','ORDER_NOT_FOUND'],BRANCH_ACCESS_DENIED:[403,'BRANCH_ACCESS_DENIED','BRANCH_ACCESS_DENIED'],ORDER_NOT_READY_FOR_PAYMENT:[409,'INVALID_STATE','ORDER_NOT_READY_FOR_PAYMENT'],KDS_NOT_READY_FOR_PAYMENT:[409,'INVALID_STATE','KDS_NOT_READY_FOR_PAYMENT'],PAYMENT_AMOUNT_MUST_EQUAL_REMAINING:[409,'INVALID_STATE','PAYMENT_AMOUNT_MUST_EQUAL_REMAINING'],OPEN_SHIFT_REQUIRED:[409,'INVALID_STATE','OPEN_SHIFT_REQUIRED'],INSUFFICIENT_STOCK:[409,'INVALID_STATE','INSUFFICIENT_STOCK'],INVENTORY_ITEM_NOT_FOUND:[409,'INVALID_STATE','INVENTORY_ITEM_NOT_FOUND'],CREDIT_ACCOUNT_REQUIRED:[400,'VALIDATION_ERROR','CREDIT_ACCOUNT_REQUIRED'],CREDIT_ACCOUNT_NOT_FOUND:[404,'NOT_FOUND','CREDIT_ACCOUNT_NOT_FOUND'],CREDIT_LIMIT_EXCEEDED:[409,'INVALID_STATE','CREDIT_LIMIT_EXCEEDED']};if(map[e.message])return res.status(map[e.message][0]).json({error:map[e.message][1],code:map[e.message][2],message:e.message,details:e.details||{}});throw e;}});
// Stage 34.1: a refund is never an arbitrary historical action. It is only ever the financial
// half of an APPROVED cancellation / establishment closure, and it never touches inventory -- the
// product decision was applied independently when that closure was approved.
router.post('/:id/refund',requirePermission('payments.refund'),requireOperatorPosSession,async(req,res)=>{
  const now=new Date().toISOString();
  try{
    const result=await transaction(async(tx)=>{
      const p=await tx.queryOne<any>('SELECT * FROM payments WHERE id=? FOR UPDATE',[req.params.id]);
      if(!p)throw Object.assign(new Error('PAYMENT_NOT_FOUND'),{httpStatus:404});
      if(!allowed(req,p.branch_id))throw Object.assign(new Error('BRANCH_ACCESS_DENIED'),{httpStatus:403});
      if(p.status!=='PAID')throw Object.assign(new Error('PAYMENT_NOT_REFUNDABLE'),{httpStatus:409});
      const closure=await tx.queryOne<any>(`SELECT * FROM order_closures WHERE order_id=? AND status='APPROVED' AND refund_requested=true AND refund_payment_id IS NULL ORDER BY decided_at DESC LIMIT 1 FOR UPDATE`,[p.order_id]);
      if(!closure)throw Object.assign(new Error('REFUND_REQUIRES_APPROVED_CLOSURE'),{httpStatus:409});
      await refundPaymentFinancials(tx,p,req.user!.id,req,now);
      await tx.execute(`UPDATE service_charge_ledger SET status='REVERSED' WHERE order_id=? AND status='EARNED'`,[p.order_id]);
      const finalStatus=closure.type==='CLOSED_BY_ESTABLISHMENT'?'CLOSED_BY_ESTABLISHMENT':'REFUNDED';
      await tx.execute(`UPDATE orders SET status=?,updated_at=? WHERE id=?`,[finalStatus,now,p.order_id]);
      await tx.execute('UPDATE order_closures SET refund_payment_id=? WHERE id=?',[p.id,closure.id]);
      const refundedOrder=await tx.queryOne<any>('SELECT table_id FROM orders WHERE id=?',[p.order_id]);
      if(refundedOrder?.table_id)await releaseTableIfNoActiveOrders(tx,refundedOrder.table_id,p.branch_id,now);
      return await tx.queryOne<any>('SELECT * FROM payments WHERE id=?',[p.id]);
    });
    res.json({payment:result});
  }catch(e:any){
    const map:any={PAYMENT_NOT_FOUND:[404,'NOT_FOUND','PAYMENT_NOT_FOUND'],BRANCH_ACCESS_DENIED:[403,'BRANCH_ACCESS_DENIED','BRANCH_ACCESS_DENIED'],PAYMENT_NOT_REFUNDABLE:[409,'INVALID_STATE','PAYMENT_NOT_REFUNDABLE'],REFUND_REQUIRES_APPROVED_CLOSURE:[409,'INVALID_STATE','REFUND_REQUIRES_APPROVED_CLOSURE']};
    if(map[e.message])return res.status(map[e.message][0]).json({error:map[e.message][1],code:map[e.message][2],message:e.message,details:{}});
    throw e;
  }
});
export default router;
