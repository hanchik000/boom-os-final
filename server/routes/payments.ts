import { Router, Request } from 'express';
import crypto from 'node:crypto';
import { query, queryOne, transaction, TxClient } from '../db';
import { authenticateToken, requirePermission, insertAuditLog } from '../auth';
import { requireOperatorPosSession } from './operator-pos';
import { applyCreditSale } from './credit';
import { refundPaymentFinancials } from '../order-closure';
import { recordServiceChargeLedger } from '../service-charge';
import { accrueBoomcoinForSettlement, accrueBoombackForSettlement, redeemBoomback, boombackBalance } from '../loyalty';
const router=Router();
// Stage 34.7: BOOMBACK joins the existing methods. It is the ONE method that may settle an order
// only partially, because it is money the guest already holds rather than a price change -- the
// remainder is then settled by cash or card as usual.
const METHODS=new Set(['CASH','CARD','ONLINE','BONUS','OTHER','CREDIT','BOOMBACK']);
const PARTIAL_METHODS=new Set(['BOOMBACK']);
function cents(v:unknown){const s=String(v??'').trim();if(!/^\d+(?:\.\d{1,2})?$/.test(s))throw new Error('INVALID_MONEY');const [a,b='']=s.split('.');return BigInt(a)*100n+BigInt((b+'00').slice(0,2));}
function text(c:bigint){return `${c/100n}.${(c%100n).toString().padStart(2,'0')}`;}
function allowed(req:Request,b:string){return Boolean(req.user?.isSuperUser||req.user?.allowedBranchIds.includes(b));}
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

// -----------------------------------------------------------------------------------------------
// Stage 38 -- recipe consumption for a paid order, base dish AND chosen components.
//
// This is the SAME single consumption pipeline that has always run here. What changed:
//
// 1. A chosen modifier is resolved through Stage 37's `source_menu_item_id` into the EXISTING
//    Recipe Engine. There is no modifier inventory table, no modifier consumption ledger and no
//    hardcoded deduction anywhere: a component consumes whatever its own dish's recipe says.
//
// 2. Requirements are now AGGREGATED per inventory item before anything is written. The
//    stock_movements ledger is keyed `(branch_id, reference_type, reference_id, inventory_item_id,
//    type)`, so one order can only ever hold ONE SALE movement per ingredient. The previous
//    per-line loop decremented `current_stock` once per line but let the second INSERT fall into
//    `ON CONFLICT DO NOTHING`, so two lines sharing an ingredient moved stock twice while the
//    ledger recorded it once. That was latent before Stage 38 and would have become the normal
//    case the moment a cheese modifier shared cheddar with its burger. Aggregating first makes
//    the decrement and the single ledger row agree by construction, and keeps the ON CONFLICT
//    clause doing only what it was meant to do: absorb a retry.
//
// 3. Each ingredient is locked once, in a deterministic (sorted) order, which also removes the
//    lock-ordering deadlock two interleaved orders could hit when they shared ingredients.
//
// MISSING RECIPE -- the explicit rule, unchanged from what BOOM OS has always done for a dish:
// a menu item with no active recipe consumes nothing and leaves its cost snapshot NULL. It is not
// silent -- Stage 34's food-cost and analytics reports already count those units separately
// (`units_without_recipe_cost` / `units_without_cost`). A component follows exactly the same rule,
// and `recipe_cost_snapshot` on its order_item_modifiers row stays NULL so the gap is visible in
// the same place. No new fallback was invented.
// -----------------------------------------------------------------------------------------------

interface ConsumptionNeed { inventoryItemId: string; qtyScaled4: bigint }

/** Resolve one recipe into scaled-4 ingredient requirements for `multiplier` portions. */
async function recipeRequirements(tx: TxClient, recipeId: string, yieldQty: unknown, multiplier: number): Promise<ConsumptionNeed[]> {
  const ingredients = await tx.query<any>('SELECT inventory_item_id,quantity FROM recipe_ingredients WHERE recipe_id=?', [recipeId]);
  const out: ConsumptionNeed[] = [];
  for (const ingredient of ingredients) {
    // The scaling stays in the database's DECIMAL(14,4) arithmetic, exactly as before -- no Float.
    const row = await tx.queryOne<any>(
      'SELECT (CAST(? AS DECIMAL(14,4))*CAST(? AS DECIMAL(14,4))/NULLIF(CAST(? AS DECIMAL(14,4)),0)) AS required_qty',
      [ingredient.quantity, String(multiplier), yieldQty],
    );
    out.push({ inventoryItemId: ingredient.inventory_item_id, qtyScaled4: scaled4(row.required_qty) });
  }
  return out;
}

const activeRecipe = (tx: TxClient, branchId: string, menuItemId: string) =>
  tx.queryOne<any>('SELECT id,version,yield_qty FROM recipes WHERE branch_id=? AND menu_item_id=? AND active=true', [branchId, menuItemId]);

async function consumeInventoryForOrder(tx:TxClient, orderId:string, branchId:string, userId:string, now:string) {
  const items = await tx.query<any>('SELECT id,menu_item_id,quantity FROM order_items WHERE order_id=?', [orderId]);

  // ---- pass 1: resolve every requirement, WITHOUT touching stock ----
  const totals = new Map<string, bigint>();               // inventory_item_id -> scaled4 total
  const lineNeeds: Array<{ orderItemId: string; version: number | null; needs: ConsumptionNeed[] }> = [];
  const modifierNeeds: Array<{ modifierRowId: string; version: number | null; needs: ConsumptionNeed[] }> = [];
  const add = (needs: ConsumptionNeed[]) => { for (const n of needs) totals.set(n.inventoryItemId, (totals.get(n.inventoryItemId) ?? 0n) + n.qtyScaled4); };

  for (const orderItem of items) {
    if (orderItem.menu_item_id) {
      const recipe = await activeRecipe(tx, branchId, orderItem.menu_item_id);
      if (recipe) {
        const needs = await recipeRequirements(tx, recipe.id, recipe.yield_qty, Number(orderItem.quantity));
        lineNeeds.push({ orderItemId: orderItem.id, version: recipe.version, needs });
        add(needs);
      }
    }
    // The chosen components of this line. `modifier_id` is ON DELETE SET NULL, so a component
    // whose option was later deleted outright keeps its historical row and simply resolves to
    // nothing here -- it can never consume against a dangling reference.
    const chosen = await tx.query<any>(
      `SELECT oim.id, oim.quantity, mm.source_menu_item_id
         FROM order_item_modifiers oim
         JOIN menu_modifiers mm ON mm.id=oim.modifier_id
        WHERE oim.order_item_id=?`, [orderItem.id]);
    for (const mod of chosen) {
      if (!mod.source_menu_item_id) continue;                       // a plain option ("no onion") consumes nothing
      // Branch scope is enforced here too: a component only ever resolves a recipe belonging to
      // THIS order's branch, so a cross-branch source item can never reach this branch's stock.
      const recipe = await activeRecipe(tx, branchId, mod.source_menu_item_id);
      if (!recipe) continue;                                        // the documented missing-recipe rule
      const multiplier = Number(orderItem.quantity) * Math.max(1, Number(mod.quantity) || 1);
      const needs = await recipeRequirements(tx, recipe.id, recipe.yield_qty, multiplier);
      modifierNeeds.push({ modifierRowId: mod.id, version: recipe.version, needs });
      add(needs);
    }
  }

  // ---- pass 2: lock, verify and move stock ONCE per ingredient ----
  const unitCosts = new Map<string, bigint>();
  for (const inventoryItemId of [...totals.keys()].sort()) {        // sorted => deterministic lock order
    const requiredScaled4 = totals.get(inventoryItemId)!;
    if (requiredScaled4 <= 0n) continue;
    const required = fromScaled4(requiredScaled4);
    const stock = await tx.queryOne<any>('SELECT id,current_stock,average_cost FROM inventory_items WHERE id=? AND branch_id=? AND active=true FOR UPDATE', [inventoryItemId, branchId]);
    if (!stock) throw Object.assign(new Error('INVENTORY_ITEM_NOT_FOUND'), { httpStatus: 409 });
    const check = await tx.queryOne<any>('SELECT (CAST(current_stock AS DECIMAL(14,4))-CAST(? AS DECIMAL(14,4))) AS remaining FROM inventory_items WHERE id=? FOR UPDATE', [required, stock.id]);
    if (Number(check.remaining) < 0) throw Object.assign(new Error('INSUFFICIENT_STOCK'), { httpStatus: 409, details: { inventory_item_id: stock.id, required_quantity: required, current_stock: String(stock.current_stock) } });
    unitCosts.set(inventoryItemId, scaled4(stock.average_cost));
    await tx.execute('UPDATE inventory_items SET current_stock=current_stock-CAST(? AS numeric),updated_at=? WHERE id=? AND branch_id=?', [required, now, stock.id, branchId]);
    // IDEMPOTENCY: one SALE movement per (order, ingredient). A replayed payment hits the unique
    // constraint and changes nothing -- and because the quantity is now the aggregate, this single
    // row is the whole truth about what this order took off the shelf.
    await tx.execute(
      `INSERT INTO stock_movements (id,branch_id,inventory_item_id,type,quantity,unit_cost,reference_type,reference_id,reason,created_by,created_at) VALUES (?,?,?,?,CAST(? AS numeric),CAST(? AS numeric),?,?,?,?,?) ON CONFLICT (branch_id,reference_type,reference_id,inventory_item_id,type) DO NOTHING`,
      [`mov_${crypto.randomUUID()}`, branchId, stock.id, 'SALE', required, String(stock.average_cost || '0'), 'ORDER', orderId, 'Consumed by paid order', userId, now]);
  }

  // ---- pass 3: the historical snapshots, priced at the cost we just consumed at ----
  const costOf = (needs: ConsumptionNeed[]) => needs.reduce((sum, n) => sum + (n.qtyScaled4 * (unitCosts.get(n.inventoryItemId) ?? 0n)) / 10000n, 0n);
  const lineExtra = new Map<string, bigint>();                      // order_item_id -> modifier cost

  for (const m of modifierNeeds) {
    const cost = costOf(m.needs);
    await tx.execute('UPDATE order_item_modifiers SET recipe_version_snapshot=?,recipe_cost_snapshot=CAST(? AS numeric) WHERE id=?', [m.version, fromScaled4(cost), m.modifierRowId]);
    const owner = await tx.queryOne<any>('SELECT order_item_id FROM order_item_modifiers WHERE id=?', [m.modifierRowId]);
    if (owner) lineExtra.set(owner.order_item_id, (lineExtra.get(owner.order_item_id) ?? 0n) + cost);
  }

  // order_items.recipe_cost_snapshot remains the line's TOTAL internal cost, so every Stage 34
  // food-cost and analytics query keeps working untouched -- it simply now includes the components.
  const lineById = new Map(lineNeeds.map(l => [l.orderItemId, l]));
  for (const orderItem of items) {
    const base = lineById.get(orderItem.id);
    const extra = lineExtra.get(orderItem.id) ?? 0n;
    if (!base && extra === 0n) continue;                            // nothing consumed: snapshot stays NULL
    const total = (base ? costOf(base.needs) : 0n) + extra;
    await tx.execute('UPDATE order_items SET recipe_version_snapshot=?,recipe_cost_snapshot=CAST(? AS numeric) WHERE id=?', [base ? base.version : null, fromScaled4(total), orderItem.id]);
  }
}
router.use(authenticateToken);
router.get('/',requirePermission('payments.view'),async(req,res)=>{const b=typeof req.query.branch_id==='string'?req.query.branch_id:(req.user!.branch_id||'');if(!b||!allowed(req,b))return res.status(403).json({error:'BRANCH_ACCESS_DENIED',code:'BRANCH_ACCESS_DENIED',message:'Branch is outside your access scope.',details:{}});res.json({payments:await query<any>('SELECT * FROM payments WHERE branch_id=? ORDER BY created_at DESC LIMIT 200',[b])});});
router.post('/',requirePermission('payments.create'),requireOperatorPosSession,async(req,res)=>{const orderId=String(req.body?.order_id||''),method=String(req.body?.method||'').toUpperCase(),idem=String(req.headers['idempotency-key']||'').trim().slice(0,128),billIdRaw=req.body?.bill_id?String(req.body.bill_id):null;if(!orderId||!METHODS.has(method)||!idem)return res.status(400).json({error:'VALIDATION_ERROR',code:'PAYMENT_FIELDS_REQUIRED',message:'order_id, supported method and Idempotency-Key are required.',details:{}});let requested;try{requested=cents(req.body?.amount)}catch{return res.status(400).json({error:'VALIDATION_ERROR',code:'INVALID_PAYMENT_AMOUNT',message:'amount must be a non-negative amount with up to two decimals.',details:{}});}if(requested<=0n)return res.status(400).json({error:'VALIDATION_ERROR',code:'PAYMENT_AMOUNT_MUST_BE_POSITIVE',message:'Payment amount must be positive.',details:{}});if(method==='CREDIT'&&!(req.user!.isSuperUser||req.user!.permissions.includes('credit.issue')))return res.status(403).json({error:'FORBIDDEN',code:'CREDIT_ISSUE_PERMISSION_REQUIRED',message:'Issuing a credit sale requires the credit.issue permission.',details:{}});const now=new Date().toISOString(),paymentId=`pay_${crypto.randomUUID()}`;try{const result=await transaction(async(tx)=>{const order=await tx.queryOne<any>('SELECT * FROM orders WHERE id=? FOR UPDATE',[orderId]);if(!order)throw Object.assign(new Error('ORDER_NOT_FOUND'),{httpStatus:404});if(!allowed(req,order.branch_id))throw Object.assign(new Error('BRANCH_ACCESS_DENIED'),{httpStatus:403});const existing=await tx.queryOne<any>('SELECT * FROM payments WHERE branch_id=? AND idempotency_key=?',[order.branch_id,idem]);if(existing)return {payment:existing,replayed:true};if(!['READY'].includes(order.status))throw Object.assign(new Error('ORDER_NOT_READY_FOR_PAYMENT'),{httpStatus:409});const kds=await tx.queryOne<any>("SELECT status FROM kds_tickets WHERE order_id=? AND branch_id=?",[order.id,order.branch_id]);if(!kds||!['READY','COMPLETED'].includes(kds.status))throw Object.assign(new Error('KDS_NOT_READY_FOR_PAYMENT'),{httpStatus:409});// Stage 34.4: a split order is settled one separate check at a time. The bill -- not the order --
      // is what the amount must match, and the order only completes when every bill has been paid.
      const isSplit=String(order.split_mode||'NONE')!=='NONE';
      let bill:any=null;
      if(isSplit){
        if(!billIdRaw)throw Object.assign(new Error('BILL_REQUIRED_FOR_SPLIT_ORDER'),{httpStatus:409});
        bill=await tx.queryOne<any>(`SELECT * FROM order_bills WHERE id=? AND order_id=? AND status<>'VOID' FOR UPDATE`,[billIdRaw,orderId]);
        if(!bill)throw Object.assign(new Error('BILL_NOT_FOUND'),{httpStatus:404});
        if(bill.status==='PAID')throw Object.assign(new Error('BILL_ALREADY_PAID'),{httpStatus:409});
      } else if(billIdRaw) throw Object.assign(new Error('ORDER_NOT_SPLIT'),{httpStatus:409});
      const paidRow=await tx.queryOne<any>(isSplit
        ? `SELECT COALESCE(SUM(amount),0) AS paid FROM payments WHERE bill_id=? AND status='PAID'`
        : `SELECT COALESCE(SUM(amount),0) AS paid FROM payments WHERE order_id=? AND status='PAID'`,[isSplit?bill.id:orderId]);
      const paid=cents(paidRow?.paid||'0');const total=cents(isSplit?bill.final_amount:order.final_amount);const remaining=total-paid;
      const allowPartial=PARTIAL_METHODS.has(method);
      if(allowPartial ? (requested>remaining||requested<=0n) : (requested!==remaining))throw Object.assign(new Error('PAYMENT_AMOUNT_MUST_EQUAL_REMAINING'),{httpStatus:409,details:{expected:text(remaining),partial_allowed:allowPartial}});
      // A BOOMBACK payment spends the guest's own balance, so the order must actually have a guest
      // and the balance must cover it. The ledger re-checks under a row lock below.
      let boombackCustomerId:string|null=null;
      if(method==='BOOMBACK'){
        boombackCustomerId=(bill?bill.customer_id:order.customer_id)||null;
        if(!boombackCustomerId)throw Object.assign(new Error('BOOMBACK_REQUIRES_CUSTOMER'),{httpStatus:409});
        const balance=await boombackBalance(tx,boombackCustomerId);
        if(requested>balance)throw Object.assign(new Error('BOOMBACK_INSUFFICIENT_BALANCE'),{httpStatus:409,details:{balance:text(balance)}});
      }
      const fullySettled=paid+requested>=total;let shiftId:null|string=null;if(method==='CASH'||method==='CARD'){const shift=await tx.queryOne<any>('SELECT id,status FROM cash_shifts WHERE branch_id=? AND status=\'OPEN\' FOR UPDATE',[order.branch_id]);if(!shift)throw Object.assign(new Error('OPEN_SHIFT_REQUIRED'),{httpStatus:409});shiftId=shift.id;}await tx.execute(`INSERT INTO payments (id,order_id,bill_id,branch_id,cash_shift_id,cashier_user_id,method,status,amount,idempotency_key,created_at,updated_at) VALUES (?,?,?,?,?,?,?,'PAID',CAST(? AS numeric),?,?,?)`,[paymentId,orderId,bill?bill.id:null,order.branch_id,shiftId,req.user!.id,method,text(requested),idem,now,now]);if(shiftId){const col=method==='CASH'?'cash_sales':'card_sales';const expectedExpr=col==='cash_sales'?'opening_cash+cash_sales+CAST(? AS numeric)+credit_repayments-refunds-voids':'opening_cash+cash_sales+credit_repayments-refunds-voids';const shiftParams=col==='cash_sales'?[text(requested),text(requested),now,shiftId]:[text(requested),now,shiftId];await tx.execute(`UPDATE cash_shifts SET ${col}=${col}+CAST(? AS numeric),expected_cash=${expectedExpr},updated_at=? WHERE id=?`,shiftParams);}
      if(method==='CREDIT'){const accountId=String(req.body?.credit_account_id||'');if(!accountId)throw Object.assign(new Error('CREDIT_ACCOUNT_REQUIRED'),{httpStatus:400});const isManager=Boolean(req.user!.isSuperUser||req.user!.permissions.includes('credit.manage_limit'));await applyCreditSale(tx,{branchId:order.branch_id,accountId,amount:requested,orderId,paymentId,cashierUserId:req.user!.id,isManager,now});}
      if(method==='BOOMBACK'&&boombackCustomerId){
        await redeemBoomback(tx,{branchId:order.branch_id,customerId:boombackCustomerId,amountCents:requested,orderId,billId:bill?bill.id:null,paymentId,actorId:req.user!.id,now,req});
      }
      if(bill&&fullySettled){
        await tx.execute(`UPDATE order_bills SET status='PAID',closed_at=?,updated_at=? WHERE id=? AND status='OPEN'`,[now,now,bill.id]);
      }
      // Stage 34.5/34.7: loyalty is earned on what the guest actually settled -- per separate check
      // when the order is split (each bill has its own guest), otherwise once for the whole order.
      await accrueBoomcoinForSettlement(tx,{branchId:order.branch_id,customerId:bill?bill.customer_id:order.customer_id,orderId:orderId,billId:bill?bill.id:null,amountCents:requested,actorId:req.user!.id,now,req});
      await accrueBoombackForSettlement(tx,{branchId:order.branch_id,customerId:bill?bill.customer_id:order.customer_id,orderId:orderId,billId:bill?bill.id:null,amountCents:requested,actorId:req.user!.id,now,req});
      // Consumption, the service-charge ledger and order completion happen ONCE per order, when the
      // last separate check is settled -- never once per bill, which would consume stock N times.
      // A partially settled order (BOOMBACK paid, cash still owed) is not settled at all yet.
      const stillOpen=!fullySettled?{id:'partial'}:(isSplit?await tx.queryOne<any>(`SELECT id FROM order_bills WHERE order_id=? AND status='OPEN' LIMIT 1`,[orderId]):null);
      if(!stillOpen){
      await consumeInventoryForOrder(tx,orderId,order.branch_id,req.user!.id,now);
      await recordServiceChargeLedger(tx, order, req.user!.id, now);
      await tx.execute(`UPDATE orders SET status='COMPLETED',updated_at=? WHERE id=?`,[now,orderId]); if(order.table_id) await releaseTableIfNoActiveOrders(tx,order.table_id,order.branch_id,now); await tx.execute(`UPDATE kds_tickets SET status='COMPLETED',completed_at=COALESCE(completed_at,?),updated_at=? WHERE order_id=? AND status<>'CANCELLED'`,[now,now,orderId]);
      }
      await insertAuditLog(tx.execute,{userId:req.user!.id,branchId:order.branch_id,action:'PAYMENT_CREATED',entityType:'PAYMENT',entityId:paymentId,newValues:{order_id:orderId,bill_id:bill?bill.id:null,method,amount:text(requested)},req});return {payment:await tx.queryOne<any>('SELECT * FROM payments WHERE id=?',[paymentId]),replayed:false};});res.status(result.replayed?200:201).json(result);}catch(e:any){const map:any={ORDER_NOT_FOUND:[404,'NOT_FOUND','ORDER_NOT_FOUND'],BRANCH_ACCESS_DENIED:[403,'BRANCH_ACCESS_DENIED','BRANCH_ACCESS_DENIED'],ORDER_NOT_READY_FOR_PAYMENT:[409,'INVALID_STATE','ORDER_NOT_READY_FOR_PAYMENT'],KDS_NOT_READY_FOR_PAYMENT:[409,'INVALID_STATE','KDS_NOT_READY_FOR_PAYMENT'],PAYMENT_AMOUNT_MUST_EQUAL_REMAINING:[409,'INVALID_STATE','PAYMENT_AMOUNT_MUST_EQUAL_REMAINING'],OPEN_SHIFT_REQUIRED:[409,'INVALID_STATE','OPEN_SHIFT_REQUIRED'],BILL_REQUIRED_FOR_SPLIT_ORDER:[409,'INVALID_STATE','BILL_REQUIRED_FOR_SPLIT_ORDER'],BILL_NOT_FOUND:[404,'NOT_FOUND','BILL_NOT_FOUND'],BILL_ALREADY_PAID:[409,'INVALID_STATE','BILL_ALREADY_PAID'],ORDER_NOT_SPLIT:[409,'INVALID_STATE','ORDER_NOT_SPLIT'],BOOMBACK_REQUIRES_CUSTOMER:[409,'INVALID_STATE','BOOMBACK_REQUIRES_CUSTOMER'],BOOMBACK_INSUFFICIENT_BALANCE:[409,'INVALID_STATE','BOOMBACK_INSUFFICIENT_BALANCE'],CUSTOMER_NOT_FOUND:[404,'NOT_FOUND','CUSTOMER_NOT_FOUND'],INSUFFICIENT_STOCK:[409,'INVALID_STATE','INSUFFICIENT_STOCK'],INVENTORY_ITEM_NOT_FOUND:[409,'INVALID_STATE','INVENTORY_ITEM_NOT_FOUND'],CREDIT_ACCOUNT_REQUIRED:[400,'VALIDATION_ERROR','CREDIT_ACCOUNT_REQUIRED'],CREDIT_ACCOUNT_NOT_FOUND:[404,'NOT_FOUND','CREDIT_ACCOUNT_NOT_FOUND'],CREDIT_LIMIT_EXCEEDED:[409,'INVALID_STATE','CREDIT_LIMIT_EXCEEDED']};if(map[e.message])return res.status(map[e.message][0]).json({error:map[e.message][1],code:map[e.message][2],message:e.message,details:e.details||{}});throw e;}});
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
