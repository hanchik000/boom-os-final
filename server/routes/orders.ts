import { Router, Request } from 'express';
import crypto from 'node:crypto';
import { query, queryOne, execute, transaction, TxClient } from '../db';
import { authenticateToken, requirePermission, insertAuditLog } from '../auth';
import { getWaiterSession } from './waiters';
import { serviceChargePercentFor } from '../service-charge';
import { recomputeOrderTotals, orderCents, centsText as totalsText, percentHundredths, applyPercent } from '../order-totals';
import { CLOSURE_TYPES, INVENTORY_TREATMENTS, CLOSABLE_ORDER_STATUSES, CLOSED_ORDER_STATUSES, productionSnapshot, applyApprovedClosure } from '../order-closure';

const router=Router();

function moneyCents(v: unknown): bigint {
  const s=String(v ?? '').trim();
  if(!/^\d+(?:\.\d{1,2})?$/.test(s)) throw new Error('INVALID_MONEY');
  const [a,b='']=s.split('.'); return BigInt(a)*100n+BigInt((b+'00').slice(0,2));
}
function centsText(c:bigint){return `${c/100n}.${(c%100n).toString().padStart(2,'0')}`;}
function percentToBps(v:unknown){const s=String(v??'0'); if(!/^\d+(?:\.\d{1,2})?$/.test(s)) return 0n; const [a,b='']=s.split('.'); return BigInt(a)*100n+BigInt((b+'00').slice(0,2));}
function allowed(req:Request,b:string){return Boolean(req.user?.isSuperUser||req.user?.allowedBranchIds.includes(b));}
function id(){return crypto.randomUUID();}

async function releaseTableIfNoActiveOrders(tx:TxClient, tableId:string, branchId:string, now:string) {
  const active=await tx.queryOne<any>(`SELECT id FROM orders WHERE table_id=? AND branch_id=? AND status NOT IN ('COMPLETED','REFUNDED','CANCELLED','CLOSED_BY_ESTABLISHMENT') LIMIT 1`,[tableId,branchId]);
  if(!active) await tx.execute(`UPDATE dining_tables SET status='AVAILABLE',updated_at=? WHERE id=? AND branch_id=? AND status='OCCUPIED'`,[now,tableId,branchId]);
}

// Waiter POS: session is the identity source. The client cannot choose waiter_user_id or branch_id.
router.post('/', async(req,res)=>{
  const session=await getWaiterSession(req); if(!session){res.status(401).json({error:'WAITER_SESSION_INVALID',code:'WAITER_SESSION_INVALID',message:'Valid Waiter POS session required.',details:{}});return;}
  const branchId=session.branch_id; const orderType=String(req.body?.order_type||'DINE_IN'); const source=String(req.body?.source||'POS');
  if(!['DINE_IN','TAKEAWAY'].includes(orderType)||source!=='POS'){res.status(400).json({error:'VALIDATION_ERROR',code:'INVALID_WAITER_ORDER_TYPE',message:'Waiter POS may create only DINE_IN or TAKEAWAY POS orders.',details:{}});return;}
  const tableId=req.body?.table_id?String(req.body.table_id):null;
  if(orderType==='DINE_IN'&&!tableId){res.status(400).json({error:'VALIDATION_ERROR',code:'TABLE_REQUIRED',message:'DINE_IN order requires a table.',details:{}});return;}
  if(orderType==='TAKEAWAY'&&tableId){res.status(400).json({error:'VALIDATION_ERROR',code:'TABLE_NOT_ALLOWED',message:'TAKEAWAY order cannot have a dining table.',details:{}});return;}
  const rawItems=Array.isArray(req.body?.items)?req.body.items:[]; if(!rawItems.length){res.status(400).json({error:'VALIDATION_ERROR',code:'ORDER_ITEMS_REQUIRED',message:'At least one order item is required.',details:{}});return;}
  const parsedItems:any[]=[];
  for(const x of rawItems){
    const menuItemId=String(x?.menu_item_id||''); const q=Number(x?.quantity);
    if(!menuItemId||!Number.isInteger(q)||q<1||q>99){res.status(400).json({error:'VALIDATION_ERROR',code:'INVALID_ORDER_ITEM',message:'Each item needs a menu_item_id and integer quantity 1-99.',details:{}});return;}
    const modifierIds=Array.isArray(x?.modifier_ids)?x.modifier_ids.map((v:any)=>String(v)).filter(Boolean):[];
    if(new Set(modifierIds).size!==modifierIds.length||modifierIds.length>50){res.status(400).json({error:'VALIDATION_ERROR',code:'INVALID_MODIFIERS',message:'Modifier selections must be unique and limited to 50.',details:{}});return;}
    parsedItems.push({menuItemId,q,modifierIds,comment:(x?.comment?String(x.comment).trim():null)||null});
  }
  const ids=[...new Set(parsedItems.map(x=>x.menuItemId))]; const placeholders=ids.map(()=>'?').join(','); const menu=await query<any>(`SELECT id,name_ru,name_tk,price FROM menu_items WHERE id IN (${placeholders}) AND (branch_id=? OR branch_id IS NULL) AND status='ACTIVE'`,[...ids,branchId]);
  if(menu.length!==ids.length){res.status(400).json({error:'VALIDATION_ERROR',code:'MENU_ITEM_UNAVAILABLE',message:'One or more menu items are unavailable in this branch.',details:{}});return;}
  const menuMap=new Map(menu.map((m:any)=>[m.id,m]));
  const modifierIds=[...new Set(parsedItems.flatMap(x=>x.modifierIds))];
  const modifiers=modifierIds.length?await query<any>(`SELECT mm.id,mm.group_id,mm.name_ru,mm.name_tk,mm.price_delta,mg.menu_item_id,mg.min_select,mg.max_select,mg.required FROM menu_modifiers mm JOIN menu_modifier_groups mg ON mg.id=mm.group_id WHERE mm.id IN (${modifierIds.map(()=>'?').join(',')}) AND mm.status='ACTIVE' AND mg.status='ACTIVE' AND mg.branch_id=?`,[...modifierIds,branchId]):[];
  if(modifiers.length!==modifierIds.length){res.status(400).json({error:'VALIDATION_ERROR',code:'MODIFIER_UNAVAILABLE',message:'One or more modifiers are unavailable in this branch.',details:{}});return;}
  const relevantItemIds=ids;
  const groups=await query<any>(`SELECT id,menu_item_id,min_select,max_select,required FROM menu_modifier_groups WHERE menu_item_id IN (${relevantItemIds.map(()=>'?').join(',')}) AND branch_id=? AND status='ACTIVE'`,[...relevantItemIds,branchId]);
  const modMap=new Map(modifiers.map((m:any)=>[m.id,m])); const groupsByItem=new Map<string,any[]>();
  for(const g of groups){if(!groupsByItem.has(g.menu_item_id))groupsByItem.set(g.menu_item_id,[]); groupsByItem.get(g.menu_item_id)!.push(g);}
  for(const x of parsedItems){
    const selected=x.modifierIds.map((mid:string)=>modMap.get(mid)); if(selected.some((m:any)=>!m||m.menu_item_id!==x.menuItemId)){res.status(400).json({error:'VALIDATION_ERROR',code:'MODIFIER_ITEM_MISMATCH',message:'Modifier does not belong to the selected menu item.',details:{}});return;}
    const counts=new Map<string,number>(); for(const m of selected) counts.set(m.group_id,(counts.get(m.group_id)||0)+1);
    for(const g of groupsByItem.get(x.menuItemId)||[]){ const count=counts.get(g.id)||0; const min=Number(g.min_select); const max=Number(g.max_select); if(count<min||count>max||(Boolean(g.required)&&count<1)){res.status(400).json({error:'VALIDATION_ERROR',code:'MODIFIER_SELECTION_INVALID',message:'Modifier selection violates group limits.',details:{group_id:g.id,min_select:min,max_select:max,required:Boolean(g.required),selected:count}});return;} }
  }
  const merged=new Map<string,any>(); for(const x of parsedItems){const key=x.menuItemId+'|'+[...x.modifierIds].sort().join(','); const old=merged.get(key); merged.set(key,{...x,quantity:(old?.quantity||0)+x.q,comment:old?.comment||x.comment});}
  let subtotal=0n; const lines:any[]=[];
  for(const line of merged.values()){const m=menuMap.get(line.menuItemId)!; const base=moneyCents(m.price); const selected=line.modifierIds.map((mid:string)=>modMap.get(mid)!); const delta=selected.reduce((sum:any,mod:any)=>sum+moneyCents(mod.price_delta),0n); const unit=base+delta; if(unit<0n){res.status(400).json({error:'VALIDATION_ERROR',code:'NEGATIVE_ITEM_PRICE',message:'Modifier combination cannot make an item price negative.',details:{}});return;} const sub=unit*BigInt(line.quantity); subtotal+=sub; lines.push({id:id(),menu_item_id:line.menuItemId,title_snapshot:m.name_ru,price_snapshot:centsText(unit),quantity:line.quantity,subtotal:centsText(sub),comment:line.comment,modifiers:selected.map((mod:any)=>({id:id(),modifier_id:mod.id,name_snapshot:mod.name_ru,price_delta_snapshot:centsText(moneyCents(mod.price_delta)),quantity:1}))});}
  // Stage 34.2: the percentage comes from the service charge configuration VERSION in force right
  // now, per order type -- dine-in, takeaway (pickup) and delivery are separate configurable values
  // and none of them is hardcoded here. The version's id is snapshotted onto the order so a later
  // configuration change can never re-price it.
  const scNow=new Date().toISOString();
  const {percent:scPercent,configId:scConfigId}=await serviceChargePercentFor({queryOne,query},branchId,orderType,scNow);
  const service=(subtotal*percentToBps(scPercent)+5000n)/10000n;
  const final=subtotal+service;
  const idem=req.headers['idempotency-key']?String(req.headers['idempotency-key']).trim().slice(0,128):null;
  if(!idem){res.status(400).json({error:'VALIDATION_ERROR',code:'IDEMPOTENCY_KEY_REQUIRED',message:'Idempotency-Key is required for waiter order creation.',details:{}});return;}
  if(idem){const existing=await queryOne<any>('SELECT id,order_number,status,final_amount FROM orders WHERE branch_id=? AND idempotency_key=?',[branchId,idem]); if(existing){res.status(200).json({order:existing,replayed:true});return;}}
  const now=new Date().toISOString(), orderId=`ord_${id()}`;
  try{
    const order=await transaction(async(tx)=>{
      // Lock the selected table inside the same transaction as order creation.
      // This prevents concurrent waiters from racing on table state or overwriting it.
      if(tableId){
        const lockedTable=await tx.queryOne<any>('SELECT id,status FROM dining_tables WHERE id=? AND branch_id=? FOR UPDATE',[tableId,branchId]);
        if(!lockedTable||lockedTable.status==='DISABLED'){
          const error:any=new Error('TABLE_NOT_FOUND'); error.httpStatus=404; throw error;
        }
      }
      const branch=await tx.queryOne<{currency:string}>(`SELECT currency FROM branches WHERE id=? AND status='ACTIVE'`,[branchId]);
      if(!branch){const error:any=new Error('BRANCH_NOT_FOUND'); error.httpStatus=404; throw error;}
      const currency=String(branch.currency||'TMT');
      const seqRow=await tx.queryOne<{next_value:number}>(`INSERT INTO branch_order_sequences (branch_id,next_value,updated_at) VALUES (?,2,?) ON CONFLICT (branch_id) DO UPDATE SET next_value=branch_order_sequences.next_value+1,updated_at=EXCLUDED.updated_at RETURNING next_value-1 AS next_value`,[branchId,now]);
      const seq=Number(seqRow?.next_value||1); const orderNumber=`${new Date().toISOString().slice(0,10).replace(/-/g,'')}-${String(seq).padStart(4,'0')}`;
      await tx.execute(`INSERT INTO orders (id,order_number,branch_id,waiter_user_id,table_id,order_type,source,status,currency,subtotal,discount,promotion_amount,service_charge,final_amount,idempotency_key,notes,service_charge_config_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,'PENDING_CONFIRMATION',?,CAST(? AS numeric),CAST(? AS numeric),CAST(? AS numeric),CAST(? AS numeric),CAST(? AS numeric),?,?,?,?,?)`,[orderId,orderNumber,branchId,session.user_id,tableId,orderType,source,currency,centsText(subtotal),'0.00','0.00',centsText(service),centsText(final),idem,req.body?.notes?String(req.body.notes).trim():null,scConfigId,now,now]);
      for(const l of lines){ await tx.execute(`INSERT INTO order_items (id,order_id,menu_item_id,title_snapshot,price_snapshot,quantity,subtotal,comment,created_at) VALUES (?,?,?,?,CAST(? AS numeric),?,CAST(? AS numeric),?,?)`,[l.id,orderId,l.menu_item_id,l.title_snapshot,l.price_snapshot,l.quantity,l.subtotal,l.comment,now]); for(const mod of l.modifiers) await tx.execute(`INSERT INTO order_item_modifiers (id,order_item_id,modifier_id,name_snapshot,price_delta_snapshot,quantity,created_at) VALUES (?,?,?,?,CAST(? AS numeric),?,?)`,[mod.id,l.id,mod.modifier_id,mod.name_snapshot,mod.price_delta_snapshot,mod.quantity,now]); }
      if(tableId) await tx.execute(`UPDATE dining_tables SET status='OCCUPIED',updated_at=? WHERE id=? AND branch_id=? AND status IN ('AVAILABLE','RESERVED','OCCUPIED')`,[now,tableId,branchId]);
      await insertAuditLog(tx.execute,{userId:session.user_id,branchId,action:'ORDER_CREATED',entityType:'ORDER',entityId:orderId,newValues:{order_type:orderType,source,waiter_user_id:session.user_id,table_id:tableId,final_amount:centsText(final)},req});
      return {id:orderId,order_number:orderNumber,status:'PENDING_CONFIRMATION',branch_id:branchId,waiter_user_id:session.user_id,table_id:tableId,order_type:orderType,source,subtotal:centsText(subtotal),discount:'0.00',promotion_amount:'0.00',service_charge:centsText(service),final_amount:centsText(final),currency};
    });
    res.status(201).json({order});
  }catch(e:any){
    if((e as any)?.httpStatus===404 && String(e.message)==='TABLE_NOT_FOUND'){
      res.status(404).json({error:'NOT_FOUND',code:'TABLE_NOT_FOUND',message:'Table not found in waiter branch.',details:{}});return;
    }
    if((e as any)?.httpStatus===404 && String(e.message)==='BRANCH_NOT_FOUND'){
      res.status(404).json({error:'NOT_FOUND',code:'BRANCH_NOT_FOUND',message:'Waiter branch is not active.',details:{}});return;
    }
    if(String(e.message).toLowerCase().includes('unique')){const existing=await queryOne<any>('SELECT id,order_number,status,final_amount FROM orders WHERE branch_id=? AND idempotency_key=?',[branchId,idem]);if(existing){res.status(200).json({order:existing,replayed:true});return;}}
    throw e;
  }
});

router.get('/', authenticateToken, requirePermission('orders.view'), async(req,res)=>{const b=String(req.query.branch_id||req.user!.branch_id||''); if(!b||!allowed(req,b)){res.status(403).json({error:'BRANCH_ACCESS_DENIED',code:'BRANCH_ACCESS_DENIED',message:'Branch is outside your access scope.',details:{}});return;} const status=typeof req.query.status==='string'?req.query.status:null; const where=status?'o.branch_id=? AND o.status=?':'o.branch_id=?'; const params=status?[b,status]:[b]; const orders=await query<any>(`SELECT o.id,o.order_number,o.branch_id,o.waiter_user_id,u.full_name AS waiter_name,o.table_id,t.code AS table_code,o.order_type,o.source,o.status,o.currency,o.subtotal,o.discount,o.promotion_amount,o.service_charge,o.final_amount,o.created_at,o.updated_at FROM orders o LEFT JOIN users u ON u.id=o.waiter_user_id LEFT JOIN dining_tables t ON t.id=o.table_id WHERE ${where} ORDER BY o.created_at DESC LIMIT 200`,params); res.json({orders});});

router.post('/:id/confirm', authenticateToken, requirePermission('orders.confirm'), async(req,res)=>{const o=await queryOne<any>('SELECT * FROM orders WHERE id=?',[req.params.id]); if(!o){res.status(404).json({error:'NOT_FOUND',code:'ORDER_NOT_FOUND',message:'Order not found.',details:{}});return;} if(!allowed(req,o.branch_id)){res.status(403).json({error:'BRANCH_ACCESS_DENIED',code:'BRANCH_ACCESS_DENIED',message:'Order belongs to an unauthorized branch.',details:{}});return;} if(o.status!=='PENDING_CONFIRMATION'){res.status(409).json({error:'INVALID_STATE',code:'ORDER_NOT_PENDING_CONFIRMATION',message:'Only pending waiter orders can be confirmed.',details:{status:o.status}});return;} const now=new Date().toISOString(); await transaction(async(tx)=>{await tx.execute(`UPDATE orders SET status='CONFIRMED',confirmed_at=?,confirmed_by=?,updated_at=? WHERE id=? AND status='PENDING_CONFIRMATION'`,[now,req.user!.id,now,o.id]); await tx.execute(`INSERT INTO kds_tickets (id,order_id,branch_id,status,created_at,updated_at) VALUES (?,?,?,?,?,?) ON CONFLICT (order_id) DO NOTHING`,[`kds_${crypto.randomUUID()}`,o.id,o.branch_id,'NEW',now,now]); await insertAuditLog(tx.execute,{userId:req.user!.id,branchId:o.branch_id,action:'ORDER_CONFIRMED',entityType:'ORDER',entityId:o.id,oldValues:{status:'PENDING_CONFIRMATION'},newValues:{status:'CONFIRMED',confirmed_by:req.user!.id},req});}); res.json({order:await queryOne<any>('SELECT * FROM orders WHERE id=?',[o.id])});});



// Waiter requests item removal; the item is never deleted. A manager must approve it.
router.post('/:id/items/:itemId/removal-request', async (req, res) => {
  const session = await getWaiterSession(req);
  if (!session) return res.status(401).json({error:'WAITER_SESSION_INVALID',code:'WAITER_SESSION_INVALID',message:'Valid Waiter POS session required.',details:{}});
  const orderId = String(req.params.id), itemId = String(req.params.itemId);
  const reason = String(req.body?.reason || '').trim().slice(0,500);
  const requestedRaw = String(req.body?.quantity ?? '').trim();
  if (!reason) return res.status(400).json({error:'VALIDATION_ERROR',code:'REMOVAL_REASON_REQUIRED',message:'A reason is required for item removal.',details:{}});
  if (!/^\d+(?:\.\d{1,4})?$/.test(requestedRaw) || Number(requestedRaw) <= 0) return res.status(400).json({error:'VALIDATION_ERROR',code:'INVALID_REMOVAL_QUANTITY',message:'Removal quantity must be positive.',details:{}});
  const requested = requestedRaw;
  const now = new Date().toISOString();
  const approvalId = `ira_${crypto.randomUUID()}`;
  try {
    const approval = await transaction(async (tx) => {
      const order = await tx.queryOne<any>('SELECT id,branch_id,waiter_user_id,status FROM orders WHERE id=? FOR UPDATE',[orderId]);
      if (!order) throw Object.assign(new Error('ORDER_NOT_FOUND'),{httpStatus:404});
      if (order.branch_id !== session.branch_id || order.waiter_user_id !== session.user_id) throw Object.assign(new Error('ORDER_ACCESS_DENIED'),{httpStatus:403});
      if (!['PENDING_CONFIRMATION','CONFIRMED','PREPARING','READY'].includes(order.status)) throw Object.assign(new Error('ORDER_ITEM_REMOVAL_NOT_ALLOWED'),{httpStatus:409});
      const item = await tx.queryOne<any>('SELECT id,order_id,quantity,status FROM order_items WHERE id=? AND order_id=? FOR UPDATE',[itemId,orderId]);
      if (!item) throw Object.assign(new Error('ORDER_ITEM_NOT_FOUND'),{httpStatus:404});
      if (item.status !== 'ACTIVE' || Number(requested) > Number(item.quantity)) throw Object.assign(new Error('INVALID_REMOVAL_QUANTITY'),{httpStatus:409});
      const pending = await tx.queryOne<any>(`SELECT id FROM order_item_removal_approvals WHERE order_item_id=? AND status='PENDING' FOR UPDATE`,[itemId]);
      if (pending) throw Object.assign(new Error('REMOVAL_ALREADY_PENDING'),{httpStatus:409});
      await tx.execute(`INSERT INTO order_item_removal_approvals (id,order_id,order_item_id,branch_id,requester_user_id,requested_quantity,reason,status,created_at) VALUES (?,?,?,?,?,CAST(? AS numeric),?,'PENDING',?)`,[approvalId,orderId,itemId,session.branch_id,session.user_id,requested,reason,now]);
      await insertAuditLog(tx.execute,{userId:session.user_id,branchId:session.branch_id,action:'MANAGER_APPROVAL',entityType:'ORDER_ITEM_REMOVAL',entityId:approvalId,newValues:{type:'REMOVE_ITEM',status:'PENDING',order_id:orderId,order_item_id:itemId,requested_quantity:requested,reason,requester_user_id:session.user_id},req});
      return await tx.queryOne<any>('SELECT * FROM order_item_removal_approvals WHERE id=?',[approvalId]);
    });
    res.status(201).json({approval});
  } catch(e:any) {
    const map:any={ORDER_NOT_FOUND:[404,'NOT_FOUND','ORDER_NOT_FOUND'],ORDER_ACCESS_DENIED:[403,'BRANCH_ACCESS_DENIED','ORDER_ACCESS_DENIED'],ORDER_ITEM_NOT_ALLOWED:[409,'INVALID_STATE','ORDER_ITEM_REMOVAL_NOT_ALLOWED'],ORDER_ITEM_REMOVAL_NOT_ALLOWED:[409,'INVALID_STATE','ORDER_ITEM_REMOVAL_NOT_ALLOWED'],ORDER_ITEM_NOT_FOUND:[404,'NOT_FOUND','ORDER_ITEM_NOT_FOUND'],INVALID_REMOVAL_QUANTITY:[409,'INVALID_STATE','INVALID_REMOVAL_QUANTITY'],REMOVAL_ALREADY_PENDING:[409,'CONFLICT','REMOVAL_ALREADY_PENDING']};
    if(map[e.message]) return res.status(map[e.message][0]).json({error:map[e.message][1],code:map[e.message][2],message:e.message,details:{}});
    throw e;
  }
});

router.get('/removal-requests', authenticateToken, requirePermission('orders.item_remove.approve'), async (req,res) => {
  const branchId = typeof req.query.branch_id === 'string' ? req.query.branch_id : (req.user!.branch_id || '');
  if (!branchId || !allowed(req,branchId)) return res.status(403).json({error:'BRANCH_ACCESS_DENIED',code:'BRANCH_ACCESS_DENIED',message:'Branch is outside your access scope.',details:{}});
  const status = typeof req.query.status === 'string' ? String(req.query.status).toUpperCase() : 'PENDING';
  if (!['PENDING','APPROVED','REJECTED'].includes(status)) return res.status(400).json({error:'VALIDATION_ERROR',code:'INVALID_APPROVAL_STATUS',message:'Invalid approval status.',details:{}});
  const requests = await query<any>(`SELECT a.*,o.order_number,o.order_type,oi.title_snapshot,oi.quantity AS current_quantity,u.full_name AS requester_name FROM order_item_removal_approvals a JOIN orders o ON o.id=a.order_id JOIN order_items oi ON oi.id=a.order_item_id LEFT JOIN users u ON u.id=a.requester_user_id WHERE a.branch_id=? AND a.status=? ORDER BY a.created_at ASC LIMIT 200`,[branchId,status]);
  res.json({branch_id:branchId,requests});
});

async function decideRemoval(req: Request, res: any, approve: boolean) {
  const approvalId = String(req.params.approvalId);
  const decisionReason = String(req.body?.reason || '').trim().slice(0,500) || null;
  const now = new Date().toISOString();
  try {
    const result = await transaction(async(tx) => {
      const a = await tx.queryOne<any>('SELECT * FROM order_item_removal_approvals WHERE id=? FOR UPDATE',[approvalId]);
      if (!a) throw Object.assign(new Error('APPROVAL_NOT_FOUND'),{httpStatus:404});
      if (!allowed(req,a.branch_id)) throw Object.assign(new Error('BRANCH_ACCESS_DENIED'),{httpStatus:403});
      if (a.status !== 'PENDING') throw Object.assign(new Error('APPROVAL_ALREADY_DECIDED'),{httpStatus:409});
      if (a.requester_user_id === req.user!.id) throw Object.assign(new Error('SELF_APPROVAL_FORBIDDEN'),{httpStatus:403});
      if (!approve) {
        await tx.execute(`UPDATE order_item_removal_approvals SET status='REJECTED',approver_user_id=?,decided_at=?,decision_reason=? WHERE id=? AND status='PENDING'`,[req.user!.id,now,decisionReason,approvalId]);
        await insertAuditLog(tx.execute,{userId:req.user!.id,branchId:a.branch_id,action:'MANAGER_APPROVAL',entityType:'ORDER_ITEM_REMOVAL',entityId:approvalId,oldValues:{status:'PENDING'},newValues:{type:'REMOVE_ITEM',status:'REJECTED',approver_user_id:req.user!.id,decision_reason:decisionReason},req});
        return await tx.queryOne<any>('SELECT * FROM order_item_removal_approvals WHERE id=?',[approvalId]);
      }
      const order = await tx.queryOne<any>('SELECT * FROM orders WHERE id=? FOR UPDATE',[a.order_id]);
      if (!order || order.branch_id !== a.branch_id) throw Object.assign(new Error('ORDER_NOT_FOUND'),{httpStatus:404});
      if (!['PENDING_CONFIRMATION','CONFIRMED','PREPARING','READY'].includes(order.status)) throw Object.assign(new Error('ORDER_ITEM_REMOVAL_NOT_ALLOWED'),{httpStatus:409});
      const item = await tx.queryOne<any>('SELECT * FROM order_items WHERE id=? AND order_id=? FOR UPDATE',[a.order_item_id,a.order_id]);
      if (!item || item.status !== 'ACTIVE') throw Object.assign(new Error('ORDER_ITEM_NOT_FOUND'),{httpStatus:404});
      const reqQty = String(a.requested_quantity);
      const qtyRow = await tx.queryOne<any>('SELECT (CAST(? AS DECIMAL(12,4)) - CAST(? AS DECIMAL(12,4))) AS remaining_qty, (CAST(? AS DECIMAL(12,2)) * (CAST(? AS DECIMAL(12,4)) - CAST(? AS DECIMAL(12,4)))) AS remaining_subtotal',[item.quantity,reqQty,item.price_snapshot,item.quantity,reqQty]);
      if (Number(qtyRow.remaining_qty) < 0) throw Object.assign(new Error('INVALID_REMOVAL_QUANTITY'),{httpStatus:409});
      const fullRemoval = Number(qtyRow.remaining_qty) === 0;
      // order_items.quantity is INTEGER, but remaining_qty above is computed as DECIMAL(12,4)
      // (to support a fractional requested_quantity) and always arrives here as text with 4
      // decimal places (e.g. "1.0000") -- Postgres rejects a direct text-to-integer bind for
      // that shape (42804), so round it through NUMERIC first, same as the DB's own rounding.
      await tx.execute(`UPDATE order_items SET quantity=CAST(CAST(? AS numeric) AS integer),subtotal=CAST(? AS numeric),status=?,removed_quantity=removed_quantity+CAST(? AS numeric),removed_at=?,removed_by=?,removal_reason=? WHERE id=?`,[String(qtyRow.remaining_qty),fullRemoval?'0.00':String(qtyRow.remaining_subtotal),fullRemoval?'REMOVED':'ACTIVE',reqQty,now,req.user!.id,a.reason,item.id]);
      // Stage 34.3: one order-pricing rule, shared with the manual-discount path. It still uses the
      // percentage of the configuration version that priced this order, never today's.
      await recomputeOrderTotals(tx, order, now);
      await tx.execute(`UPDATE order_item_removal_approvals SET status='APPROVED',approver_user_id=?,decided_at=?,decision_reason=? WHERE id=? AND status='PENDING'`,[req.user!.id,now,decisionReason,approvalId]);
      await insertAuditLog(tx.execute,{userId:req.user!.id,branchId:a.branch_id,action:'MANAGER_APPROVAL',entityType:'ORDER_ITEM_REMOVAL',entityId:approvalId,oldValues:{status:'PENDING'},newValues:{type:'REMOVE_ITEM',status:'APPROVED',approver_user_id:req.user!.id,requested_quantity:reqQty,reason:a.reason,decision_reason:decisionReason},req});
      return {approval:await tx.queryOne<any>('SELECT * FROM order_item_removal_approvals WHERE id=?',[approvalId]),order:await tx.queryOne<any>('SELECT * FROM orders WHERE id=?',[order.id])};
    });
    res.json(result);
  } catch(e:any) {
    const map:any={APPROVAL_NOT_FOUND:[404,'NOT_FOUND','APPROVAL_NOT_FOUND'],BRANCH_ACCESS_DENIED:[403,'BRANCH_ACCESS_DENIED','BRANCH_ACCESS_DENIED'],APPROVAL_ALREADY_DECIDED:[409,'INVALID_STATE','APPROVAL_ALREADY_DECIDED'],SELF_APPROVAL_FORBIDDEN:[403,'FORBIDDEN','SELF_APPROVAL_FORBIDDEN'],ORDER_NOT_FOUND:[404,'NOT_FOUND','ORDER_NOT_FOUND'],ORDER_ITEM_REMOVAL_NOT_ALLOWED:[409,'INVALID_STATE','ORDER_ITEM_REMOVAL_NOT_ALLOWED'],ORDER_ITEM_NOT_FOUND:[404,'NOT_FOUND','ORDER_ITEM_NOT_FOUND'],INVALID_REMOVAL_QUANTITY:[409,'INVALID_STATE','INVALID_REMOVAL_QUANTITY']};
    if(map[e.message]) return res.status(map[e.message][0]).json({error:map[e.message][1],code:map[e.message][2],message:e.message,details:{}});
    throw e;
  }
}
router.post('/removal-requests/:approvalId/approve', authenticateToken, requirePermission('orders.item_remove.approve'), async (req,res) => decideRemoval(req,res,true));
router.post('/removal-requests/:approvalId/reject', authenticateToken, requirePermission('orders.item_remove.approve'), async (req,res) => decideRemoval(req,res,false));

// ---------------------------------------------------------------------------
// Stage 34.1 -- controlled cancellation / "closed by establishment".
//
// A refund is never an arbitrary historical action. The only path to one is
// REQUEST -> MANAGER APPROVAL -> FINANCIAL REFUND, and the inventory outcome travels with that
// same request as an explicit, user-chosen decision: refunding money and returning ingredients
// are independent facts, and produced food is never returned to stock. A waiter raises the
// request from the POS but can never finalise it alone.
// ---------------------------------------------------------------------------

function closureAuth(handler: (req: Request, res: any) => Promise<any>) {
  return async (req: Request, res: any, next: any) => {
    try {
      const session = await getWaiterSession(req);
      if (session) { (req as any).waiterSession = session; return await handler(req, res); }
      authenticateToken(req, res, () => {
        requirePermission('orders.closure.request')(req, res, () => { handler(req, res).catch(next); });
      });
    } catch (e) { next(e); }
  };
}

// The waiter's own open orders, for the POS "OTKAZ" action. Waiter-session scoped: it can only
// ever return orders this waiter raised in this waiter's branch.
router.get('/pos/mine', async (req, res) => {
  const session = await getWaiterSession(req);
  if (!session) return res.status(401).json({error:'WAITER_SESSION_INVALID',code:'WAITER_SESSION_INVALID',message:'Valid Waiter POS session required.',details:{}});
  const orders = await query<any>(`SELECT o.id,o.order_number,o.order_type,o.status,o.final_amount,o.created_at,t.code AS table_code,k.status AS kds_status,k.started_at AS production_started_at,(SELECT c.status FROM order_closures c WHERE c.order_id=o.id AND c.status='PENDING' LIMIT 1) AS pending_closure FROM orders o LEFT JOIN dining_tables t ON t.id=o.table_id LEFT JOIN kds_tickets k ON k.order_id=o.id WHERE o.branch_id=? AND o.waiter_user_id=? AND o.status IN ('PENDING_CONFIRMATION','CONFIRMED','PREPARING','READY') ORDER BY o.created_at DESC LIMIT 50`,[session.branch_id,session.user_id]);
  res.json({branch_id: session.branch_id, orders});
});

router.post('/:id/closure-requests', closureAuth(async (req, res) => {
  const session = (req as any).waiterSession || null;
  const orderId = String(req.params.id);
  const type = String(req.body?.type || '').toUpperCase();
  const treatment = String(req.body?.inventory_treatment || '').toUpperCase();
  const reason = String(req.body?.reason || '').trim().slice(0, 500);
  const comment = String(req.body?.comment || '').trim().slice(0, 1000) || null;
  const refundRequested = req.body?.refund_requested === true;
  if (!(CLOSURE_TYPES as readonly string[]).includes(type)) return res.status(400).json({error:'VALIDATION_ERROR',code:'INVALID_CLOSURE_TYPE',message:'type must be CANCELLATION or CLOSED_BY_ESTABLISHMENT.',details:{}});
  // The product decision is never inferred from the refund decision and never defaulted: the
  // requester must state it, and the stated, approved value is the source of truth.
  if (!(INVENTORY_TREATMENTS as readonly string[]).includes(treatment)) return res.status(400).json({error:'VALIDATION_ERROR',code:'INVENTORY_TREATMENT_REQUIRED',message:'inventory_treatment must be explicitly chosen: WRITE_OFF, NO_WRITE_OFF or RESTORE_STOCK.',details:{}});
  if (!reason) return res.status(400).json({error:'VALIDATION_ERROR',code:'CLOSURE_REASON_REQUIRED',message:'A reason is required.',details:{}});
  if (session && type !== 'CANCELLATION') return res.status(403).json({error:'FORBIDDEN',code:'CLOSURE_TYPE_NOT_ALLOWED_FOR_WAITER',message:'A waiter may only request a cancellation.',details:{}});
  if (session && refundRequested) return res.status(403).json({error:'FORBIDDEN',code:'WAITER_CANNOT_REQUEST_REFUND',message:'A refund may only be requested from the cashier POS.',details:{}});
  const now = new Date().toISOString();
  const closureId = `ocl_${crypto.randomUUID()}`;
  try {
    const closure = await transaction(async (tx) => {
      const order = await tx.queryOne<any>('SELECT * FROM orders WHERE id=? FOR UPDATE', [orderId]);
      if (!order) throw Object.assign(new Error('ORDER_NOT_FOUND'), {httpStatus:404});
      if (session) {
        if (order.branch_id !== session.branch_id || order.waiter_user_id !== session.user_id) throw Object.assign(new Error('ORDER_ACCESS_DENIED'), {httpStatus:403});
      } else if (!allowed(req, order.branch_id)) throw Object.assign(new Error('BRANCH_ACCESS_DENIED'), {httpStatus:403});
      if (CLOSED_ORDER_STATUSES.includes(order.status)) throw Object.assign(new Error('ORDER_ALREADY_CLOSED'), {httpStatus:409});
      if (!CLOSABLE_ORDER_STATUSES.includes(order.status)) throw Object.assign(new Error('ORDER_NOT_CLOSABLE'), {httpStatus:409});
      const pending = await tx.queryOne<any>(`SELECT id FROM order_closures WHERE order_id=? AND status='PENDING' FOR UPDATE`, [orderId]);
      if (pending) throw Object.assign(new Error('CLOSURE_ALREADY_PENDING'), {httpStatus:409});
      const prod = await productionSnapshot(tx, orderId);
      if (treatment === 'RESTORE_STOCK' && prod.started) throw Object.assign(new Error('INVENTORY_RESTORE_FORBIDDEN_AFTER_PRODUCTION'), {httpStatus:409});
      const paidRow = await tx.queryOne<any>(`SELECT COALESCE(SUM(amount),0) AS paid FROM payments WHERE order_id=? AND status='PAID'`, [orderId]);
      const paid = Number(paidRow?.paid || 0) > 0;
      if (refundRequested && !paid) throw Object.assign(new Error('REFUND_REQUIRES_PAID_ORDER'), {httpStatus:409});
      const requesterId = session ? session.user_id : req.user!.id;
      const requesterRole = session ? 'WAITER' : (req.user!.roleCodes[0] || 'USER');
      await tx.execute(`INSERT INTO order_closures (id,branch_id,order_id,type,reason,comment,inventory_treatment,refund_requested,status,production_state,requester_user_id,requester_role,paid_at_request,inventory_applied,created_at) VALUES (?,?,?,?,?,?,?,?, 'PENDING',?,?,?,?,false,?)`, [closureId, order.branch_id, orderId, type, reason, comment, treatment, refundRequested, prod.state, requesterId, requesterRole, paid, now]);
      await insertAuditLog(tx.execute, {userId:requesterId, branchId:order.branch_id, action:'ORDER_CLOSURE_REQUESTED', entityType:'ORDER_CLOSURE', entityId:closureId, newValues:{type, status:'PENDING', order_id:orderId, order_status:order.status, reason, comment, inventory_treatment:treatment, refund_requested:refundRequested, production_state:prod.state, paid_at_request:paid, requester_user_id:requesterId, requester_role:requesterRole}, req});
      return await tx.queryOne<any>('SELECT * FROM order_closures WHERE id=?', [closureId]);
    });
    res.status(201).json({closure});
  } catch (e:any) {
    const map:any={ORDER_NOT_FOUND:[404,'NOT_FOUND','ORDER_NOT_FOUND'],ORDER_ACCESS_DENIED:[403,'BRANCH_ACCESS_DENIED','ORDER_ACCESS_DENIED'],BRANCH_ACCESS_DENIED:[403,'BRANCH_ACCESS_DENIED','BRANCH_ACCESS_DENIED'],ORDER_ALREADY_CLOSED:[409,'INVALID_STATE','ORDER_ALREADY_CLOSED'],ORDER_NOT_CLOSABLE:[409,'INVALID_STATE','ORDER_NOT_CLOSABLE'],CLOSURE_ALREADY_PENDING:[409,'CONFLICT','CLOSURE_ALREADY_PENDING'],INVENTORY_RESTORE_FORBIDDEN_AFTER_PRODUCTION:[409,'INVALID_STATE','INVENTORY_RESTORE_FORBIDDEN_AFTER_PRODUCTION'],REFUND_REQUIRES_PAID_ORDER:[409,'INVALID_STATE','REFUND_REQUIRES_PAID_ORDER']};
    if(map[e.message]) return res.status(map[e.message][0]).json({error:map[e.message][1],code:map[e.message][2],message:e.message,details:{}});
    throw e;
  }
}));

router.get('/closure-requests', authenticateToken, requirePermission('orders.closure.approve'), async (req, res) => {
  const branchId = typeof req.query.branch_id === 'string' ? req.query.branch_id : (req.user!.branch_id || '');
  if (!branchId || !allowed(req, branchId)) return res.status(403).json({error:'BRANCH_ACCESS_DENIED',code:'BRANCH_ACCESS_DENIED',message:'Branch is outside your access scope.',details:{}});
  const status = typeof req.query.status === 'string' ? String(req.query.status).toUpperCase() : 'PENDING';
  if (!['PENDING','APPROVED','REJECTED'].includes(status)) return res.status(400).json({error:'VALIDATION_ERROR',code:'INVALID_CLOSURE_STATUS',message:'Invalid closure status.',details:{}});
  const closures = await query<any>(`SELECT c.*,o.order_number,o.order_type,o.status AS order_status,o.final_amount,t.code AS table_code,u.full_name AS requester_name,a.full_name AS approver_name FROM order_closures c JOIN orders o ON o.id=c.order_id LEFT JOIN dining_tables t ON t.id=o.table_id LEFT JOIN users u ON u.id=c.requester_user_id LEFT JOIN users a ON a.id=c.approver_user_id WHERE c.branch_id=? AND c.status=? ORDER BY c.created_at ASC LIMIT 200`, [branchId, status]);
  res.json({branch_id: branchId, closures});
});

async function decideClosure(req: Request, res: any, approve: boolean) {
  const closureId = String(req.params.closureId);
  const decisionReason = String(req.body?.reason || '').trim().slice(0, 500) || null;
  const now = new Date().toISOString();
  try {
    const result = await transaction(async (tx) => {
      const c = await tx.queryOne<any>('SELECT * FROM order_closures WHERE id=? FOR UPDATE', [closureId]);
      if (!c) throw Object.assign(new Error('CLOSURE_NOT_FOUND'), {httpStatus:404});
      if (!allowed(req, c.branch_id)) throw Object.assign(new Error('BRANCH_ACCESS_DENIED'), {httpStatus:403});
      if (c.status !== 'PENDING') throw Object.assign(new Error('CLOSURE_ALREADY_DECIDED'), {httpStatus:409});
      if (c.requester_user_id === req.user!.id) throw Object.assign(new Error('SELF_APPROVAL_FORBIDDEN'), {httpStatus:403});
      if (!approve) {
        await tx.execute(`UPDATE order_closures SET status='REJECTED',approver_user_id=?,decided_at=?,decision_reason=? WHERE id=? AND status='PENDING'`, [req.user!.id, now, decisionReason, closureId]);
        await insertAuditLog(tx.execute, {userId:req.user!.id, branchId:c.branch_id, action:'ORDER_CLOSURE_REJECTED', entityType:'ORDER_CLOSURE', entityId:closureId, oldValues:{status:'PENDING'}, newValues:{status:'REJECTED', approver_user_id:req.user!.id, decision_reason:decisionReason}, req});
        return {closure: await tx.queryOne<any>('SELECT * FROM order_closures WHERE id=?', [closureId]), order: await tx.queryOne<any>('SELECT * FROM orders WHERE id=?', [c.order_id])};
      }
      if (c.refund_requested && !(req.user!.isSuperUser || req.user!.permissions.includes('payments.refund'))) throw Object.assign(new Error('REFUND_PERMISSION_REQUIRED'), {httpStatus:403});
      const applied = await applyApprovedClosure(tx, c, req.user!.id, req, now);
      if (decisionReason) await tx.execute('UPDATE order_closures SET decision_reason=? WHERE id=?', [decisionReason, closureId]);
      return {closure: await tx.queryOne<any>('SELECT * FROM order_closures WHERE id=?', [closureId]), order: applied.order};
    });
    res.json(result);
  } catch (e:any) {
    const map:any={CLOSURE_NOT_FOUND:[404,'NOT_FOUND','CLOSURE_NOT_FOUND'],BRANCH_ACCESS_DENIED:[403,'BRANCH_ACCESS_DENIED','BRANCH_ACCESS_DENIED'],CLOSURE_ALREADY_DECIDED:[409,'INVALID_STATE','CLOSURE_ALREADY_DECIDED'],SELF_APPROVAL_FORBIDDEN:[403,'FORBIDDEN','SELF_APPROVAL_FORBIDDEN'],REFUND_PERMISSION_REQUIRED:[403,'FORBIDDEN','REFUND_PERMISSION_REQUIRED'],ORDER_NOT_FOUND:[404,'NOT_FOUND','ORDER_NOT_FOUND'],INVENTORY_RESTORE_FORBIDDEN_AFTER_PRODUCTION:[409,'INVALID_STATE','INVENTORY_RESTORE_FORBIDDEN_AFTER_PRODUCTION']};
    if(map[e.message]) return res.status(map[e.message][0]).json({error:map[e.message][1],code:map[e.message][2],message:e.message,details:{}});
    throw e;
  }
}
router.post('/closure-requests/:closureId/approve', authenticateToken, requirePermission('orders.closure.approve'), async (req,res) => decideClosure(req,res,true));
router.post('/closure-requests/:closureId/reject', authenticateToken, requirePermission('orders.closure.approve'), async (req,res) => decideClosure(req,res,false));

// Automatic cancellation of abandoned orders, driven by the two configurable thresholds
// ORDER_CONFIRMATION_TIMEOUT and KITCHEN_ACCEPT_TIMEOUT. It is explicitly invoked (never a hidden
// background mutation) and is only ever permitted BEFORE production starts -- an order whose
// kitchen ticket has already been started is never auto-cancelled, because its ingredients are
// already committed and that decision belongs to a human.
router.post('/closures/auto-cancel', authenticateToken, requirePermission('orders.closure.approve'), async (req, res) => {
  const branchId = typeof req.body?.branch_id === 'string' ? req.body.branch_id : (req.user!.branch_id || '');
  if (!branchId || !allowed(req, branchId)) return res.status(403).json({error:'BRANCH_ACCESS_DENIED',code:'BRANCH_ACCESS_DENIED',message:'Branch is outside your access scope.',details:{}});
  const settings = await query<any>(`SELECT key,value FROM system_settings WHERE key IN ('ORDER_CONFIRMATION_TIMEOUT','KITCHEN_ACCEPT_TIMEOUT')`);
  const get = (k:string, d:number) => { const raw = settings.find(s=>s.key===k)?.value; const n = Number(raw); return Number.isFinite(n) && n >= 0 ? n : d; };
  const confirmTimeout = get('ORDER_CONFIRMATION_TIMEOUT', 15), kitchenTimeout = get('KITCHEN_ACCEPT_TIMEOUT', 10);
  const now = new Date(), nowIso = now.toISOString();
  const confirmCutoff = new Date(now.getTime() - confirmTimeout * 60000).toISOString();
  const kitchenCutoff = new Date(now.getTime() - kitchenTimeout * 60000).toISOString();
  const candidates = await query<any>(`SELECT o.id,o.status,o.created_at,o.confirmed_at,k.status AS kds_status,k.started_at FROM orders o LEFT JOIN kds_tickets k ON k.order_id=o.id WHERE o.branch_id=? AND o.status IN ('PENDING_CONFIRMATION','CONFIRMED') ORDER BY o.created_at ASC LIMIT 200`, [branchId]);
  const cancelled: string[] = [];
  for (const o of candidates) {
    const overdue = o.status === 'PENDING_CONFIRMATION'
      ? String(o.created_at) < confirmCutoff
      : (String(o.confirmed_at || o.created_at) < kitchenCutoff && (!o.kds_status || o.kds_status === 'NEW'));
    if (!overdue) continue;
    if (o.started_at || ['PREPARING','READY','COMPLETED'].includes(String(o.kds_status))) continue; // production started -- never automatic
    const closureId = `ocl_${crypto.randomUUID()}`;
    await transaction(async (tx) => {
      const order = await tx.queryOne<any>('SELECT * FROM orders WHERE id=? FOR UPDATE', [o.id]);
      if (!order || !['PENDING_CONFIRMATION','CONFIRMED'].includes(order.status)) return;
      const prod = await productionSnapshot(tx, order.id);
      if (prod.started) return;
      const pending = await tx.queryOne<any>(`SELECT id FROM order_closures WHERE order_id=? AND status='PENDING' FOR UPDATE`, [order.id]);
      if (pending) return;
      const reason = order.status === 'PENDING_CONFIRMATION' ? 'ORDER_CONFIRMATION_TIMEOUT' : 'KITCHEN_ACCEPT_TIMEOUT';
      await tx.execute(`INSERT INTO order_closures (id,branch_id,order_id,type,reason,comment,inventory_treatment,refund_requested,status,production_state,requester_user_id,requester_role,paid_at_request,inventory_applied,created_at) VALUES (?,?,?,'CANCELLATION',?,?,'NO_WRITE_OFF',false,'PENDING',?,?, 'SYSTEM',false,false,?)`, [closureId, order.branch_id, order.id, reason, `Automatic cancellation after ${reason === 'ORDER_CONFIRMATION_TIMEOUT' ? confirmTimeout : kitchenTimeout} minutes`, prod.state, req.user!.id, nowIso]);
      const closure = await tx.queryOne<any>('SELECT * FROM order_closures WHERE id=?', [closureId]);
      await applyApprovedClosure(tx, closure, req.user!.id, req, nowIso);
      cancelled.push(order.id);
    });
  }
  res.json({branch_id: branchId, order_confirmation_timeout_minutes: confirmTimeout, kitchen_accept_timeout_minutes: kitchenTimeout, cancelled_order_ids: cancelled, cancelled_count: cancelled.length});
});

// ---------------------------------------------------------------------------
// Stage 34.3 -- customer attachment and MANUAL discounts.
//
// There is no automatic discount anywhere in BOOM OS: a customer profile has no discount field,
// attaching a guest to an order never changes its price, and a discount exists only because an
// authorised employee granted it on one specific order. The amount is always computed by the
// server from the order's real subtotal, snapshotted with who granted it and why, and never
// applied to an order that has already been settled -- so an old receipt can never change.
// ---------------------------------------------------------------------------

const DISCOUNT_SETTING_PRESETS = 'MANUAL_DISCOUNT_PRESETS';
const DISCOUNT_SETTING_MAX = 'MAX_MANUAL_DISCOUNT_PERCENT';
const DISCOUNTABLE_ORDER_STATUSES = ['PENDING_CONFIRMATION', 'CONFIRMED', 'PREPARING', 'READY'];

/** Dual auth: a waiter POS session acting on its own order, or an authenticated operator. */
function posOrAuth(permission: string, handler: (req: Request, res: any, actor: { userId: string | null; role: string; source: string; waiterBranchId?: string; waiterUserId?: string }) => Promise<any>) {
  return async (req: Request, res: any, next: any) => {
    try {
      const session = await getWaiterSession(req);
      if (session) return await handler(req, res, { userId: session.user_id, role: 'WAITER', source: 'WAITER_POS', waiterBranchId: session.branch_id, waiterUserId: session.user_id });
      authenticateToken(req, res, () => {
        requirePermission(permission)(req, res, () => {
          handler(req, res, { userId: req.user!.id, role: req.user!.roleCodes[0] || 'USER', source: 'CASHIER_POS' }).catch(next);
        });
      });
    } catch (e) { next(e); }
  };
}

async function loadDiscountableOrder(tx: TxClient, req: Request, orderId: string, actor: { waiterBranchId?: string; waiterUserId?: string }) {
  const order = await tx.queryOne<any>('SELECT * FROM orders WHERE id=? FOR UPDATE', [orderId]);
  if (!order) throw Object.assign(new Error('ORDER_NOT_FOUND'), { httpStatus: 404 });
  if (actor.waiterBranchId) {
    if (order.branch_id !== actor.waiterBranchId || order.waiter_user_id !== actor.waiterUserId) throw Object.assign(new Error('ORDER_ACCESS_DENIED'), { httpStatus: 403 });
  } else if (!allowed(req, order.branch_id)) throw Object.assign(new Error('BRANCH_ACCESS_DENIED'), { httpStatus: 403 });
  // An order that has been settled or closed is history: its price is never touched again.
  if (!DISCOUNTABLE_ORDER_STATUSES.includes(order.status)) throw Object.assign(new Error('ORDER_NOT_EDITABLE'), { httpStatus: 409 });
  return order;
}

/**
 * Where a discount belongs. On a split order it is always one separate check (and the bill's own
 * subtotal is the base); on an unsplit order it is always the order itself.
 */
async function resolveDiscountScope(tx: TxClient, order: any, requestedBillId: string | null): Promise<{ billId: string | null; subtotal: bigint; customerId: string | null }> {
  const split = String(order.split_mode || 'NONE') !== 'NONE';
  if (!split) {
    if (requestedBillId) throw Object.assign(new Error('ORDER_NOT_SPLIT'), { httpStatus: 409 });
    return { billId: null, subtotal: orderCents(order.subtotal), customerId: order.customer_id || null };
  }
  if (!requestedBillId) throw Object.assign(new Error('BILL_REQUIRED_FOR_SPLIT_ORDER'), { httpStatus: 409 });
  const bill = await tx.queryOne<any>(`SELECT * FROM order_bills WHERE id=? AND order_id=? AND status<>'VOID' FOR UPDATE`, [requestedBillId, order.id]);
  if (!bill) throw Object.assign(new Error('BILL_NOT_FOUND'), { httpStatus: 404 });
  if (bill.status === 'PAID') throw Object.assign(new Error('BILL_ALREADY_PAID'), { httpStatus: 409 });
  // An EQUAL split has no per-bill item subtotal to discount against; discount the order before
  // splitting it that way, or split by items instead.
  if (String(order.split_mode) === 'EQUAL') throw Object.assign(new Error('DISCOUNT_NOT_SUPPORTED_IN_EQUAL_SPLIT'), { httpStatus: 409 });
  return { billId: bill.id, subtotal: orderCents(bill.subtotal), customerId: bill.customer_id || null };
}

const DISCOUNT_ERRORS: any = {
  ORDER_NOT_SPLIT: [409, 'INVALID_STATE', 'ORDER_NOT_SPLIT'],
  BILL_REQUIRED_FOR_SPLIT_ORDER: [409, 'INVALID_STATE', 'BILL_REQUIRED_FOR_SPLIT_ORDER'],
  BILL_NOT_FOUND: [404, 'NOT_FOUND', 'BILL_NOT_FOUND'],
  BILL_ALREADY_PAID: [409, 'INVALID_STATE', 'BILL_ALREADY_PAID'],
  DISCOUNT_NOT_SUPPORTED_IN_EQUAL_SPLIT: [409, 'INVALID_STATE', 'DISCOUNT_NOT_SUPPORTED_IN_EQUAL_SPLIT'],
  ORDER_NOT_FOUND: [404, 'NOT_FOUND', 'ORDER_NOT_FOUND'],
  ORDER_ACCESS_DENIED: [403, 'BRANCH_ACCESS_DENIED', 'ORDER_ACCESS_DENIED'],
  BRANCH_ACCESS_DENIED: [403, 'BRANCH_ACCESS_DENIED', 'BRANCH_ACCESS_DENIED'],
  ORDER_NOT_EDITABLE: [409, 'INVALID_STATE', 'ORDER_NOT_EDITABLE'],
  CUSTOMER_NOT_FOUND: [404, 'NOT_FOUND', 'CUSTOMER_NOT_FOUND'],
  CUSTOMER_BRANCH_MISMATCH: [403, 'BRANCH_ACCESS_DENIED', 'CUSTOMER_BRANCH_MISMATCH'],
  DISCOUNT_ALREADY_APPLIED: [409, 'CONFLICT', 'DISCOUNT_ALREADY_APPLIED'],
  DISCOUNT_EXCEEDS_LIMIT: [403, 'FORBIDDEN', 'DISCOUNT_EXCEEDS_LIMIT'],
  DISCOUNT_EXCEEDS_SUBTOTAL: [409, 'INVALID_STATE', 'DISCOUNT_EXCEEDS_SUBTOTAL'],
  NO_ACTIVE_DISCOUNT: [409, 'INVALID_STATE', 'NO_ACTIVE_DISCOUNT'],
};
function sendDiscountError(res: any, e: any) {
  const m = DISCOUNT_ERRORS[e.message];
  if (!m) throw e;
  return res.status(m[0]).json({ error: m[1], code: m[2], message: e.message, details: e.details || {} });
}

// Attach or detach the guest an order belongs to. This is identification only -- it can never
// change the price by itself.
router.post('/:id/customer', posOrAuth('orders.confirm', async (req, res, actor) => {
  const customerId = req.body?.customer_id ? String(req.body.customer_id) : null;
  const now = new Date().toISOString();
  try {
    const result = await transaction(async (tx) => {
      const order = await loadDiscountableOrder(tx, req, String(req.params.id), actor);
      if (customerId) {
        const customer = await tx.queryOne<any>('SELECT id,branch_id,name,phone FROM customers WHERE id=? AND deleted_at IS NULL', [customerId]);
        if (!customer) throw Object.assign(new Error('CUSTOMER_NOT_FOUND'), { httpStatus: 404 });
        if (customer.branch_id !== order.branch_id) throw Object.assign(new Error('CUSTOMER_BRANCH_MISMATCH'), { httpStatus: 403 });
      }
      await tx.execute('UPDATE orders SET customer_id=?,updated_at=? WHERE id=?', [customerId, now, order.id]);
      await tx.execute(`UPDATE order_discounts SET customer_id=? WHERE order_id=? AND status='ACTIVE'`, [customerId, order.id]);
      await insertAuditLog(tx.execute, { userId: actor.userId || undefined, branchId: order.branch_id, action: customerId ? 'ORDER_CUSTOMER_ATTACHED' : 'ORDER_CUSTOMER_DETACHED', entityType: 'ORDER', entityId: order.id, oldValues: { customer_id: order.customer_id }, newValues: { customer_id: customerId, by_role: actor.role }, req });
      return await tx.queryOne<any>('SELECT * FROM orders WHERE id=?', [order.id]);
    });
    res.json({ order: result });
  } catch (e: any) { return sendDiscountError(res, e); }
}));

// The presets and the ceiling are configurable operational settings, not numbers baked into the UI.
router.get('/discount-options', authenticateToken, requirePermission('orders.view'), async (_req, res) => {
  const rows = await query<any>(`SELECT key,value FROM system_settings WHERE key IN (?,?)`, [DISCOUNT_SETTING_PRESETS, DISCOUNT_SETTING_MAX]);
  const presetRaw = rows.find(r => r.key === DISCOUNT_SETTING_PRESETS)?.value ?? '10,15,20,30';
  const maxRaw = rows.find(r => r.key === DISCOUNT_SETTING_MAX)?.value ?? '30';
  res.json({ presets: String(presetRaw).split(',').map(s => s.trim()).filter(s => /^\d+(?:\.\d{1,2})?$/.test(s)), max_percent: String(maxRaw) });
});

router.post('/:id/discount', posOrAuth('orders.discount.apply', async (req, res, actor) => {
  const hasPercent = req.body?.percent !== undefined && req.body?.percent !== null && String(req.body.percent).trim() !== '';
  const hasAmount = req.body?.amount !== undefined && req.body?.amount !== null && String(req.body.amount).trim() !== '';
  if (hasPercent === hasAmount) return res.status(400).json({ error: 'VALIDATION_ERROR', code: 'DISCOUNT_PERCENT_OR_AMOUNT_REQUIRED', message: 'Provide exactly one of percent or amount.', details: {} });
  const percentRaw = hasPercent ? String(req.body.percent).trim() : null;
  const amountRaw = hasAmount ? String(req.body.amount).trim() : null;
  if (percentRaw !== null && !/^\d+(?:\.\d{1,2})?$/.test(percentRaw)) return res.status(400).json({ error: 'VALIDATION_ERROR', code: 'INVALID_DISCOUNT_PERCENT', message: 'percent must be a non-negative number with up to two decimals.', details: {} });
  if (amountRaw !== null && !/^\d+(?:\.\d{1,2})?$/.test(amountRaw)) return res.status(400).json({ error: 'VALIDATION_ERROR', code: 'INVALID_DISCOUNT_AMOUNT', message: 'amount must be a non-negative amount with up to two decimals.', details: {} });
  const reason = req.body?.reason ? String(req.body.reason).trim().slice(0, 500) : null;
  const now = new Date().toISOString();
  const discountId = `odsc_${crypto.randomUUID()}`;
  try {
    const result = await transaction(async (tx) => {
      const order = await loadDiscountableOrder(tx, req, String(req.params.id), actor);
      // Stage 34.4: a split order is discounted per separate check, never at order level -- two
      // answers to the same question would double-count the money.
      const scope = await resolveDiscountScope(tx, order, req.body?.bill_id ? String(req.body.bill_id) : null);
      const active = await tx.queryOne<any>(scope.billId
        ? `SELECT id FROM order_discounts WHERE bill_id=? AND status='ACTIVE' FOR UPDATE`
        : `SELECT id FROM order_discounts WHERE order_id=? AND bill_id IS NULL AND status='ACTIVE' FOR UPDATE`, [scope.billId || order.id]);
      if (active) throw Object.assign(new Error('DISCOUNT_ALREADY_APPLIED'), { httpStatus: 409 });

      const maxRow = await tx.queryOne<any>(`SELECT value FROM system_settings WHERE key=?`, [DISCOUNT_SETTING_MAX]);
      const maxH = percentHundredths(maxRow?.value ?? '30');
      const subtotal = scope.subtotal;

      // The server -- never the caller -- decides what the discount is worth.
      let amount: bigint;
      if (percentRaw !== null) {
        const percentH = percentHundredths(percentRaw);
        if (percentH > maxH && !(req.user?.isSuperUser || req.user?.permissions.includes('orders.discount.override'))) {
          throw Object.assign(new Error('DISCOUNT_EXCEEDS_LIMIT'), { httpStatus: 403, details: { max_percent: String(maxRow?.value ?? '30') } });
        }
        amount = applyPercent(subtotal, percentH);
      } else {
        amount = orderCents(amountRaw);
      }
      if (amount > subtotal) throw Object.assign(new Error('DISCOUNT_EXCEEDS_SUBTOTAL'), { httpStatus: 409, details: { subtotal: String(order.subtotal) } });

      await tx.execute(`INSERT INTO order_discounts (id,branch_id,order_id,bill_id,customer_id,percent,amount,base_amount,reason,applied_by_user_id,applied_by_role,source,status,created_at) VALUES (?,?,?,?,?,${percentRaw !== null ? 'CAST(? AS numeric)' : '?'},CAST(? AS numeric),CAST(? AS numeric),?,?,?,?, 'ACTIVE',?)`,
        [discountId, order.branch_id, order.id, scope.billId, scope.customerId, percentRaw !== null ? percentRaw : null, totalsText(amount), totalsText(subtotal), reason, actor.userId, actor.role, actor.source, now]);
      const totals = await recomputeOrderTotals(tx, order, now);
      await insertAuditLog(tx.execute, { userId: actor.userId || undefined, branchId: order.branch_id, action: 'ORDER_DISCOUNT_APPLIED', entityType: 'ORDER_DISCOUNT', entityId: discountId, newValues: { order_id: order.id, bill_id: scope.billId, customer_id: scope.customerId, percent: percentRaw, amount: totalsText(amount), base_amount: totalsText(subtotal), reason, applied_by_user_id: actor.userId, applied_by_role: actor.role, source: actor.source, totals }, req });
      return { discount: await tx.queryOne<any>('SELECT * FROM order_discounts WHERE id=?', [discountId]), order: await tx.queryOne<any>('SELECT * FROM orders WHERE id=?', [order.id]) };
    });
    res.status(201).json(result);
  } catch (e: any) { return sendDiscountError(res, e); }
}));

router.delete('/:id/discount', posOrAuth('orders.discount.apply', async (req, res, actor) => {
  const now = new Date().toISOString();
  try {
    const result = await transaction(async (tx) => {
      const order = await loadDiscountableOrder(tx, req, String(req.params.id), actor);
      const scope = await resolveDiscountScope(tx, order, req.body?.bill_id ? String(req.body.bill_id) : null);
      const active = await tx.queryOne<any>(scope.billId
        ? `SELECT * FROM order_discounts WHERE bill_id=? AND status='ACTIVE' FOR UPDATE`
        : `SELECT * FROM order_discounts WHERE order_id=? AND bill_id IS NULL AND status='ACTIVE' FOR UPDATE`, [scope.billId || order.id]);
      if (!active) throw Object.assign(new Error('NO_ACTIVE_DISCOUNT'), { httpStatus: 409 });
      // Soft removal: the granted discount stays on the record for audit, it is never deleted.
      await tx.execute(`UPDATE order_discounts SET status='REMOVED',removed_at=?,removed_by=? WHERE id=? AND status='ACTIVE'`, [now, actor.userId, active.id]);
      const totals = await recomputeOrderTotals(tx, order, now);
      await insertAuditLog(tx.execute, { userId: actor.userId || undefined, branchId: order.branch_id, action: 'ORDER_DISCOUNT_REMOVED', entityType: 'ORDER_DISCOUNT', entityId: active.id, oldValues: { status: 'ACTIVE', amount: String(active.amount) }, newValues: { status: 'REMOVED', removed_by: actor.userId, by_role: actor.role, totals }, req });
      return { discount: await tx.queryOne<any>('SELECT * FROM order_discounts WHERE id=?', [active.id]), order: await tx.queryOne<any>('SELECT * FROM orders WHERE id=?', [order.id]) };
    });
    res.json(result);
  } catch (e: any) { return sendDiscountError(res, e); }
}));

router.get('/:id/discounts', authenticateToken, requirePermission('orders.view'), async (req, res) => {
  const order = await queryOne<any>('SELECT id,branch_id FROM orders WHERE id=?', [req.params.id]);
  if (!order) return res.status(404).json({ error: 'NOT_FOUND', code: 'ORDER_NOT_FOUND', message: 'Order not found.', details: {} });
  if (!allowed(req, order.branch_id)) return res.status(403).json({ error: 'BRANCH_ACCESS_DENIED', code: 'BRANCH_ACCESS_DENIED', message: 'Order belongs to an unauthorized branch.', details: {} });
  const discounts = await query<any>(`SELECT d.*,u.full_name AS applied_by_name,c.name AS customer_name FROM order_discounts d LEFT JOIN users u ON u.id=d.applied_by_user_id LEFT JOIN customers c ON c.id=d.customer_id WHERE d.order_id=? ORDER BY d.created_at DESC`, [req.params.id]);
  res.json({ order_id: req.params.id, discounts });
});

// ---------------------------------------------------------------------------
// Stage 34.8 -- COMPLIMENTARY ITEMS ("ОТ ЗАВЕДЕНИЯ").
//
// A waiter or cashier may only REQUEST a compliment. Exactly ONE authorised manager approves it,
// and only then does a real order line appear at a customer price of 0. The guest pays nothing,
// but the establishment's real cost is still recorded, because the line is an ordinary order item
// with an ordinary recipe that the EXISTING payment -> consumption path consumes -- there is no
// second inventory path here.
//
// Double approval is impossible: the decision is taken under a row lock and only from PENDING.
// ---------------------------------------------------------------------------

export const COMPLIMENT_REASONS = ['COMPLIMENT', 'APOLOGY', 'GIFT', 'ESTABLISHMENT_ERROR', 'BIRTHDAY', 'OTHER'] as const;
const COMPLIMENTABLE_ORDER_STATUSES = ['PENDING_CONFIRMATION', 'CONFIRMED', 'PREPARING', 'READY'];

const COMPLIMENT_ERRORS: any = {
  ORDER_NOT_FOUND: [404, 'NOT_FOUND', 'ORDER_NOT_FOUND'],
  ORDER_ACCESS_DENIED: [403, 'BRANCH_ACCESS_DENIED', 'ORDER_ACCESS_DENIED'],
  BRANCH_ACCESS_DENIED: [403, 'BRANCH_ACCESS_DENIED', 'BRANCH_ACCESS_DENIED'],
  ORDER_NOT_EDITABLE: [409, 'INVALID_STATE', 'ORDER_NOT_EDITABLE'],
  MENU_ITEM_NOT_FOUND: [404, 'NOT_FOUND', 'MENU_ITEM_NOT_FOUND'],
  MENU_ITEM_BRANCH_MISMATCH: [403, 'BRANCH_ACCESS_DENIED', 'MENU_ITEM_BRANCH_MISMATCH'],
  COMPLIMENT_NOT_FOUND: [404, 'NOT_FOUND', 'COMPLIMENT_NOT_FOUND'],
  COMPLIMENT_ALREADY_DECIDED: [409, 'INVALID_STATE', 'COMPLIMENT_ALREADY_DECIDED'],
  SELF_APPROVAL_FORBIDDEN: [403, 'FORBIDDEN', 'SELF_APPROVAL_FORBIDDEN'],
  BILL_NOT_FOUND: [404, 'NOT_FOUND', 'BILL_NOT_FOUND'],
  BILL_ALREADY_PAID: [409, 'INVALID_STATE', 'BILL_ALREADY_PAID'],
};
function sendComplimentError(res: any, e: any) {
  const m = COMPLIMENT_ERRORS[e.message];
  if (!m) throw e;
  return res.status(m[0]).json({ error: m[1], code: m[2], message: e.message, details: e.details || {} });
}

router.get('/compliment-reasons', authenticateToken, requirePermission('orders.view'), async (_req, res) => {
  res.json({ reasons: COMPLIMENT_REASONS });
});

router.post('/:id/compliments', posOrAuth('orders.compliment.request', async (req, res, actor) => {
  const menuItemId = String(req.body?.menu_item_id || '');
  const quantity = Number(req.body?.quantity ?? 1);
  const reason = String(req.body?.reason || '').toUpperCase();
  const comment = req.body?.comment ? String(req.body.comment).trim().slice(0, 500) : null;
  const billId = req.body?.bill_id ? String(req.body.bill_id) : null;
  if (!(COMPLIMENT_REASONS as readonly string[]).includes(reason)) return res.status(400).json({ error: 'VALIDATION_ERROR', code: 'INVALID_COMPLIMENT_REASON', message: 'A recognised reason is required.', details: { reasons: COMPLIMENT_REASONS } });
  if (!Number.isInteger(quantity) || quantity <= 0 || quantity > 20) return res.status(400).json({ error: 'VALIDATION_ERROR', code: 'INVALID_COMPLIMENT_QUANTITY', message: 'quantity must be a whole number between 1 and 20.', details: {} });
  const now = new Date().toISOString();
  const requestId = `cmp_${crypto.randomUUID()}`;
  try {
    const result = await transaction(async (tx) => {
      const order = await loadDiscountableOrder(tx, req, String(req.params.id), actor);
      const item = await tx.queryOne<any>('SELECT id,branch_id,name_ru,price FROM menu_items WHERE id=?', [menuItemId]);
      if (!item) throw Object.assign(new Error('MENU_ITEM_NOT_FOUND'), { httpStatus: 404 });
      if (item.branch_id && item.branch_id !== order.branch_id) throw Object.assign(new Error('MENU_ITEM_BRANCH_MISMATCH'), { httpStatus: 403 });
      let bill: any = null;
      if (billId) {
        bill = await tx.queryOne<any>(`SELECT * FROM order_bills WHERE id=? AND order_id=? AND status<>'VOID' FOR UPDATE`, [billId, order.id]);
        if (!bill) throw Object.assign(new Error('BILL_NOT_FOUND'), { httpStatus: 404 });
        if (bill.status === 'PAID') throw Object.assign(new Error('BILL_ALREADY_PAID'), { httpStatus: 409 });
      }
      // The normal menu value is snapshotted now, so the give-away can be valued later even if the
      // menu price changes afterwards.
      const normalValue = totalsText(orderCents(item.price) * BigInt(quantity));
      await tx.execute(`INSERT INTO compliment_requests (id,branch_id,order_id,bill_id,customer_id,menu_item_id,quantity,reason,comment,status,normal_value,requester_user_id,requester_role,source,created_at) VALUES (?,?,?,?,?,?,?,?,?, 'PENDING',CAST(? AS numeric),?,?,?,?)`,
        [requestId, order.branch_id, order.id, bill?.id ?? null, bill?.customer_id ?? order.customer_id ?? null, item.id, quantity, reason, comment, normalValue, actor.userId, actor.role, actor.source, now]);
      await insertAuditLog(tx.execute, { userId: actor.userId || undefined, branchId: order.branch_id, action: 'COMPLIMENT_REQUESTED', entityType: 'COMPLIMENT_REQUEST', entityId: requestId, newValues: { order_id: order.id, bill_id: bill?.id ?? null, menu_item_id: item.id, menu_item_name: item.name_ru, quantity, reason, comment, normal_value: normalValue, requester_user_id: actor.userId, requester_role: actor.role, source: actor.source }, req });
      return await tx.queryOne<any>('SELECT * FROM compliment_requests WHERE id=?', [requestId]);
    });
    res.status(201).json({ compliment: result });
  } catch (e: any) { return sendComplimentError(res, e); }
}));

/**
 * The manager queue and, with `status=APPROVED`, the give-away report: reason, employee, approver,
 * customer, order, item, normal value, real cost, branch and date in one place. The cost is the
 * order line's own historical recipe cost snapshot -- never a recomputation from today's recipe.
 */
router.get('/compliment-requests', authenticateToken, requirePermission('orders.compliment.approve'), async (req, res) => {
  const branchId = typeof req.query.branch_id === 'string' ? req.query.branch_id : (req.user!.branch_id || '');
  if (!branchId || !allowed(req, branchId)) return res.status(403).json({ error: 'BRANCH_ACCESS_DENIED', code: 'BRANCH_ACCESS_DENIED', message: 'Branch is outside your access scope.', details: {} });
  const status = typeof req.query.status === 'string' ? String(req.query.status).toUpperCase() : 'PENDING';
  if (!['PENDING', 'APPROVED', 'REJECTED'].includes(status)) return res.status(400).json({ error: 'VALIDATION_ERROR', code: 'INVALID_COMPLIMENT_STATUS', message: 'Invalid status.', details: {} });
  const from = typeof req.query.from === 'string' ? req.query.from : null;
  const to = typeof req.query.to === 'string' ? req.query.to : null;
  const where = ['c.branch_id=?', 'c.status=?'];
  const params: any[] = [branchId, status];
  if (from) { where.push('c.created_at>=?'); params.push(from); }
  if (to) { where.push('c.created_at<?'); params.push(to); }
  const compliments = await query<any>(
    `SELECT c.*, o.order_number, m.name_ru AS menu_item_name, cu.name AS customer_name,
            u.full_name AS requester_name, a.full_name AS approver_name,
            oi.recipe_cost_snapshot AS cost
       FROM compliment_requests c
       JOIN orders o ON o.id=c.order_id
       JOIN menu_items m ON m.id=c.menu_item_id
       LEFT JOIN customers cu ON cu.id=c.customer_id
       LEFT JOIN users u ON u.id=c.requester_user_id
       LEFT JOIN users a ON a.id=c.approver_user_id
       LEFT JOIN order_items oi ON oi.id=c.order_item_id
      WHERE ${where.join(' AND ')} ORDER BY c.created_at DESC LIMIT 300`, params);
  const totals = await query<any>(
    `SELECT c.reason, COUNT(*) AS count, COALESCE(SUM(c.normal_value),0) AS normal_value, COALESCE(SUM(oi.recipe_cost_snapshot),0) AS cost
       FROM compliment_requests c LEFT JOIN order_items oi ON oi.id=c.order_item_id
      WHERE ${where.join(' AND ')} GROUP BY c.reason ORDER BY c.reason`, params);
  res.json({ branch_id: branchId, status, compliments, totals });
});

async function decideCompliment(req: Request, res: any, approve: boolean) {
  const complimentId = String(req.params.complimentId);
  const decisionReason = req.body?.reason ? String(req.body.reason).trim().slice(0, 500) : null;
  const now = new Date().toISOString();
  try {
    const result = await transaction(async (tx) => {
      // The row lock plus the PENDING guard is what makes a second approval impossible.
      const c = await tx.queryOne<any>('SELECT * FROM compliment_requests WHERE id=? FOR UPDATE', [complimentId]);
      if (!c) throw Object.assign(new Error('COMPLIMENT_NOT_FOUND'), { httpStatus: 404 });
      if (!allowed(req, c.branch_id)) throw Object.assign(new Error('BRANCH_ACCESS_DENIED'), { httpStatus: 403 });
      if (c.status !== 'PENDING') throw Object.assign(new Error('COMPLIMENT_ALREADY_DECIDED'), { httpStatus: 409 });
      if (c.requester_user_id && c.requester_user_id === req.user!.id) throw Object.assign(new Error('SELF_APPROVAL_FORBIDDEN'), { httpStatus: 403 });

      if (!approve) {
        await tx.execute(`UPDATE compliment_requests SET status='REJECTED',approver_user_id=?,decided_at=?,decision_reason=? WHERE id=? AND status='PENDING'`, [req.user!.id, now, decisionReason, complimentId]);
        await insertAuditLog(tx.execute, { userId: req.user!.id, branchId: c.branch_id, action: 'COMPLIMENT_REJECTED', entityType: 'COMPLIMENT_REQUEST', entityId: complimentId, oldValues: { status: 'PENDING' }, newValues: { status: 'REJECTED', approver_user_id: req.user!.id, decision_reason: decisionReason }, req });
        return { compliment: await tx.queryOne<any>('SELECT * FROM compliment_requests WHERE id=?', [complimentId]), order: await tx.queryOne<any>('SELECT * FROM orders WHERE id=?', [c.order_id]) };
      }

      const order = await tx.queryOne<any>('SELECT * FROM orders WHERE id=? FOR UPDATE', [c.order_id]);
      if (!order) throw Object.assign(new Error('ORDER_NOT_FOUND'), { httpStatus: 404 });
      if (!COMPLIMENTABLE_ORDER_STATUSES.includes(order.status)) throw Object.assign(new Error('ORDER_NOT_EDITABLE'), { httpStatus: 409 });
      if (c.bill_id) {
        const bill = await tx.queryOne<any>(`SELECT status FROM order_bills WHERE id=? FOR UPDATE`, [c.bill_id]);
        if (!bill) throw Object.assign(new Error('BILL_NOT_FOUND'), { httpStatus: 404 });
        if (bill.status === 'PAID') throw Object.assign(new Error('BILL_ALREADY_PAID'), { httpStatus: 409 });
      }
      const item = await tx.queryOne<any>('SELECT id,name_ru FROM menu_items WHERE id=?', [c.menu_item_id]);
      if (!item) throw Object.assign(new Error('MENU_ITEM_NOT_FOUND'), { httpStatus: 404 });

      // A REAL order line at a customer price of 0. The bill does not grow, and because it is an
      // ordinary item with an ordinary recipe, the existing payment path consumes its ingredients
      // and records its real cost.
      const lineId = `oi_${crypto.randomUUID()}`;
      await tx.execute(`INSERT INTO order_items (id,order_id,bill_id,menu_item_id,title_snapshot,price_snapshot,quantity,subtotal,comment,status,created_at) VALUES (?,?,?,?,?,0,?,0,?,'ACTIVE',?)`,
        [lineId, order.id, c.bill_id, item.id, item.name_ru, c.quantity, `ОТ ЗАВЕДЕНИЯ: ${c.reason}`, now]);
      await tx.execute(`UPDATE compliment_requests SET status='APPROVED',approver_user_id=?,decided_at=?,decision_reason=?,order_item_id=? WHERE id=? AND status='PENDING'`, [req.user!.id, now, decisionReason, lineId, complimentId]);
      const totals = await recomputeOrderTotals(tx, order, now);
      await insertAuditLog(tx.execute, { userId: req.user!.id, branchId: c.branch_id, action: 'COMPLIMENT_APPROVED', entityType: 'COMPLIMENT_REQUEST', entityId: complimentId, oldValues: { status: 'PENDING' }, newValues: { status: 'APPROVED', approver_user_id: req.user!.id, order_id: order.id, order_item_id: lineId, menu_item_id: item.id, quantity: c.quantity, reason: c.reason, normal_value: String(c.normal_value), customer_price: '0.00', decision_reason: decisionReason, totals }, req });
      return { compliment: await tx.queryOne<any>('SELECT * FROM compliment_requests WHERE id=?', [complimentId]), order: await tx.queryOne<any>('SELECT * FROM orders WHERE id=?', [order.id]) };
    });
    res.json(result);
  } catch (e: any) { return sendComplimentError(res, e); }
}
router.post('/compliment-requests/:complimentId/approve', authenticateToken, requirePermission('orders.compliment.approve'), async (req, res) => decideCompliment(req, res, true));
router.post('/compliment-requests/:complimentId/reject', authenticateToken, requirePermission('orders.compliment.approve'), async (req, res) => decideCompliment(req, res, false));

// Order-level notes. `notes` is customer-facing (pre-existing field, set at creation, now also
// editable); `internal_notes` is staff-only and must never be selected onto a customer receipt.
router.patch('/:id/notes', authenticateToken, requirePermission('orders.confirm'), async(req,res)=>{
  const o=await queryOne<any>('SELECT id,branch_id,notes,internal_notes FROM orders WHERE id=?',[req.params.id]);
  if(!o){res.status(404).json({error:'NOT_FOUND',code:'ORDER_NOT_FOUND',message:'Order not found.',details:{}});return;}
  if(!allowed(req,o.branch_id)){res.status(403).json({error:'BRANCH_ACCESS_DENIED',code:'BRANCH_ACCESS_DENIED',message:'Order belongs to an unauthorized branch.',details:{}});return;}
  const hasCustomer=Object.prototype.hasOwnProperty.call(req.body||{},'customer_note');
  const hasInternal=Object.prototype.hasOwnProperty.call(req.body||{},'internal_note');
  if(!hasCustomer&&!hasInternal){res.status(400).json({error:'VALIDATION_ERROR',code:'NOTE_FIELDS_REQUIRED',message:'customer_note or internal_note is required.',details:{}});return;}
  const customerNote=hasCustomer?(req.body.customer_note?String(req.body.customer_note).trim().slice(0,1000):null):o.notes;
  const internalNote=hasInternal?(req.body.internal_note?String(req.body.internal_note).trim().slice(0,1000):null):o.internal_notes;
  const now=new Date().toISOString();
  await transaction(async(tx)=>{
    await tx.execute('UPDATE orders SET notes=?,internal_notes=?,updated_at=? WHERE id=?',[customerNote,internalNote,now,o.id]);
    await insertAuditLog(tx.execute,{userId:req.user!.id,branchId:o.branch_id,action:'ORDER_NOTES_UPDATED',entityType:'ORDER',entityId:o.id,oldValues:{notes:o.notes,internal_notes:o.internal_notes},newValues:{notes:customerNote,internal_notes:internalNote},req});
  });
  res.json({order:await queryOne<any>('SELECT * FROM orders WHERE id=?',[o.id])});
});

// Item-level note (order_items.comment). Kitchen/KDS already reads order_items.* directly
// (kds.ts), so an updated comment is visible there without any KDS change.
router.patch('/:id/items/:itemId/note', authenticateToken, requirePermission('orders.confirm'), async(req,res)=>{
  const o=await queryOne<any>('SELECT id,branch_id FROM orders WHERE id=?',[req.params.id]);
  if(!o){res.status(404).json({error:'NOT_FOUND',code:'ORDER_NOT_FOUND',message:'Order not found.',details:{}});return;}
  if(!allowed(req,o.branch_id)){res.status(403).json({error:'BRANCH_ACCESS_DENIED',code:'BRANCH_ACCESS_DENIED',message:'Order belongs to an unauthorized branch.',details:{}});return;}
  const item=await queryOne<any>('SELECT id,comment FROM order_items WHERE id=? AND order_id=? AND status=\'ACTIVE\'',[req.params.itemId,o.id]);
  if(!item){res.status(404).json({error:'NOT_FOUND',code:'ORDER_ITEM_NOT_FOUND',message:'Order item not found.',details:{}});return;}
  const comment=req.body?.comment?String(req.body.comment).trim().slice(0,500):null;
  const now=new Date().toISOString();
  await transaction(async(tx)=>{
    await tx.execute('UPDATE order_items SET comment=? WHERE id=?',[comment,item.id]);
    await insertAuditLog(tx.execute,{userId:req.user!.id,branchId:o.branch_id,action:'ORDER_ITEM_NOTE_UPDATED',entityType:'ORDER_ITEM',entityId:item.id,oldValues:{comment:item.comment},newValues:{comment},req});
  });
  res.json({item:await queryOne<any>('SELECT * FROM order_items WHERE id=?',[item.id])});
});

router.get('/:id', authenticateToken, requirePermission('orders.view'), async(req,res)=>{const o=await queryOne<any>('SELECT o.*,u.full_name AS waiter_name,t.code AS table_code,c.name AS customer_name,c.phone AS customer_phone FROM orders o LEFT JOIN users u ON u.id=o.waiter_user_id LEFT JOIN dining_tables t ON t.id=o.table_id LEFT JOIN customers c ON c.id=o.customer_id WHERE o.id=?',[req.params.id]); if(!o){res.status(404).json({error:'NOT_FOUND',code:'ORDER_NOT_FOUND',message:'Order not found.',details:{}});return;} if(!allowed(req,o.branch_id)){res.status(403).json({error:'BRANCH_ACCESS_DENIED',code:'BRANCH_ACCESS_DENIED',message:'Order belongs to an unauthorized branch.',details:{}});return;} const items=await query<any>('SELECT * FROM order_items WHERE order_id=? ORDER BY created_at',[o.id]); for(const item of items) item.modifiers=await query<any>('SELECT * FROM order_item_modifiers WHERE order_item_id=? ORDER BY created_at',[item.id]); res.json({order:{...o,items}});});
export default router;
