import { Router, Request } from 'express';
import crypto from 'node:crypto';
import { query, queryOne, execute, transaction, TxClient } from '../db';
import { authenticateToken, requirePermission, insertAuditLog } from '../auth';
import { getWaiterSession } from './waiters';

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
  const active=await tx.queryOne<any>(`SELECT id FROM orders WHERE table_id=? AND branch_id=? AND status NOT IN ('COMPLETED','REFUNDED','CANCELLED') LIMIT 1`,[tableId,branchId]);
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
  let service=0n; if(orderType==='DINE_IN'){const branchConfig=await queryOne<any>(`SELECT percent FROM service_charge_configs WHERE branch_id=? AND status='ACTIVE'`,[branchId]); const setting=branchConfig?.percent ?? (await queryOne<any>(`SELECT value FROM system_settings WHERE key='DINE_IN_SERVICE_CHARGE_PERCENT'`))?.value; const bps=percentToBps(setting||'10'); service=(subtotal*bps+5000n)/10000n;}
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
      await tx.execute(`INSERT INTO orders (id,order_number,branch_id,waiter_user_id,table_id,order_type,source,status,currency,subtotal,discount,promotion_amount,service_charge,final_amount,idempotency_key,notes,created_at,updated_at) VALUES (?,?,?,?,?,?,?,'PENDING_CONFIRMATION',?,CAST(? AS numeric),CAST(? AS numeric),CAST(? AS numeric),CAST(? AS numeric),CAST(? AS numeric),?,?,?,?)`,[orderId,orderNumber,branchId,session.user_id,tableId,orderType,source,currency,centsText(subtotal),'0.00','0.00',centsText(service),centsText(final),idem,req.body?.notes?String(req.body.notes).trim():null,now,now]);
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
      const subtotalRow = await tx.queryOne<any>(`SELECT COALESCE(SUM(CASE WHEN status='ACTIVE' THEN subtotal ELSE 0 END),0) AS subtotal FROM order_items WHERE order_id=?`,[order.id]);
      const subtotal = String(subtotalRow.subtotal);
      const branchConfig = await tx.queryOne<any>(`SELECT percent FROM service_charge_configs WHERE branch_id=? AND status='ACTIVE'`,[order.branch_id]);
      const setting = branchConfig?.percent ?? (await tx.queryOne<any>(`SELECT value FROM system_settings WHERE key='DINE_IN_SERVICE_CHARGE_PERCENT'`))?.value;
      const bps = percentToBps(setting || '10');
      const serviceRow = await tx.queryOne<any>(`SELECT CASE WHEN ?='DINE_IN' THEN ROUND((CAST(? AS DECIMAL(12,2))*CAST(? AS DECIMAL(12,2))/10000),2) ELSE 0 END AS service`,[order.order_type,subtotal,bps]);
      const service = String(serviceRow.service);
      const totalRow = await tx.queryOne<any>(`SELECT (CAST(? AS DECIMAL(12,2))-CAST(? AS DECIMAL(12,2))-CAST(? AS DECIMAL(12,2))+CAST(? AS DECIMAL(12,2))) AS final_amount`,[subtotal,order.discount,order.promotion_amount,service]);
      const finalAmount = String(totalRow.final_amount);
      await tx.execute(`UPDATE orders SET subtotal=CAST(? AS numeric),service_charge=CAST(? AS numeric),final_amount=CAST(? AS numeric),updated_at=? WHERE id=?`,[subtotal,service,finalAmount,now,order.id]);
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

router.get('/:id', authenticateToken, requirePermission('orders.view'), async(req,res)=>{const o=await queryOne<any>('SELECT o.*,u.full_name AS waiter_name,t.code AS table_code FROM orders o LEFT JOIN users u ON u.id=o.waiter_user_id LEFT JOIN dining_tables t ON t.id=o.table_id WHERE o.id=?',[req.params.id]); if(!o){res.status(404).json({error:'NOT_FOUND',code:'ORDER_NOT_FOUND',message:'Order not found.',details:{}});return;} if(!allowed(req,o.branch_id)){res.status(403).json({error:'BRANCH_ACCESS_DENIED',code:'BRANCH_ACCESS_DENIED',message:'Order belongs to an unauthorized branch.',details:{}});return;} const items=await query<any>('SELECT * FROM order_items WHERE order_id=? ORDER BY created_at',[o.id]); for(const item of items) item.modifiers=await query<any>('SELECT * FROM order_item_modifiers WHERE order_item_id=? ORDER BY created_at',[item.id]); res.json({order:{...o,items}});});
export default router;
