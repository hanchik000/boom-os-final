import { Router, Request } from 'express';
import crypto from 'node:crypto';
import { query, queryOne, transaction, TxClient } from '../db';
import { authenticateToken, requirePermission, insertAuditLog } from '../auth';

const router = Router();
const MOVEMENTS = new Set(['PURCHASE','SALE','WASTE','ADJUSTMENT','TRANSFER_IN','TRANSFER_OUT','RETURN']);
function allowed(req: Request, branchId: string) { return Boolean(req.user?.isSuperUser || req.user?.allowedBranchIds.includes(branchId)); }
function id(prefix: string) { return `${prefix}_${crypto.randomUUID()}`; }
function qty(v: unknown) { const s=String(v??'').trim(); if(!/^(?:0|[1-9]\d*)(?:\.\d{1,4})?$/.test(s)) throw new Error('INVALID_QUANTITY'); if(/^0(?:\.0{1,4})?$/.test(s)) throw new Error('QUANTITY_MUST_BE_POSITIVE'); return s; }
function qtyNonNegative(v: unknown) { const s=String(v??'').trim(); if(!/^(?:0|[1-9]\d*)(?:\.\d{1,4})?$/.test(s)) throw new Error('INVALID_QUANTITY'); return s; }
function money(v: unknown) { const s=String(v??'').trim(); if(!/^\d+(?:\.\d{1,2})?$/.test(s)) throw new Error('INVALID_MONEY'); return s; }
async function insertRecipeIngredients(tx: TxClient, recipeId: string, branchId: string, ingredients: any[], now: string) {
  const seen = new Set<string>();
  for (const x of ingredients) {
    const iid = String(x?.inventory_item_id || '');
    if (!iid || seen.has(iid)) throw Object.assign(new Error('INVALID_RECIPE_INGREDIENTS'), { httpStatus: 400 });
    seen.add(iid);
    const item = await tx.queryOne<any>('SELECT id FROM inventory_items WHERE id=? AND branch_id=? AND active=true', [iid, branchId]);
    if (!item) throw Object.assign(new Error('INVENTORY_ITEM_NOT_FOUND'), { httpStatus: 404 });
    await tx.execute(`INSERT INTO recipe_ingredients (id,recipe_id,inventory_item_id,quantity,created_at) VALUES (?,?,?,CAST(? AS numeric),?)`, [id('ri'), recipeId, iid, qty(x?.quantity), now]);
  }
}

router.use(authenticateToken);

router.get('/items', requirePermission('inventory.view'), async (req,res)=>{
  const b=String(req.query.branch_id||req.user!.branch_id||''); if(!b||!allowed(req,b)) return res.status(403).json({error:'BRANCH_ACCESS_DENIED',code:'BRANCH_ACCESS_DENIED',message:'Branch is outside your access scope.',details:{}});
  const low=String(req.query.low_stock||'')==='true';
  const where=low?'branch_id=? AND active=true AND current_stock<=reorder_point':'branch_id=?';
  res.json({items:await query<any>(`SELECT * FROM inventory_items WHERE ${where} ORDER BY name`,[b])});
});

router.post('/items', requirePermission('inventory.manage'), async (req,res)=>{
  const b=String(req.body?.branch_id||req.user!.branch_id||''); if(!b||!allowed(req,b)) return res.status(403).json({error:'BRANCH_ACCESS_DENIED',code:'BRANCH_ACCESS_DENIED',message:'Branch is outside your access scope.',details:{}});
  const sku=String(req.body?.sku||'').trim(), name=String(req.body?.name||'').trim(), unit=String(req.body?.unit||'').trim();
  if(!sku||!name||!unit) return res.status(400).json({error:'VALIDATION_ERROR',code:'INVENTORY_FIELDS_REQUIRED',message:'sku, name and unit are required.',details:{}});
  let reorder='0'; try{reorder=qty(req.body?.reorder_point??'0')}catch{return res.status(400).json({error:'VALIDATION_ERROR',code:'INVALID_REORDER_POINT',message:'reorder_point must be a non-negative quantity.',details:{}});}
  const now=new Date().toISOString(), itemId=id('inv');
  try { await transaction(async tx=>{ const branch=await tx.queryOne<any>('SELECT id FROM branches WHERE id=? AND status=\'ACTIVE\'',[b]); if(!branch) throw Object.assign(new Error('BRANCH_NOT_FOUND'),{httpStatus:404}); await tx.execute(`INSERT INTO inventory_items (id,branch_id,sku,name,unit,current_stock,reorder_point,active,created_at,updated_at) VALUES (?,?,?,?,?,0,CAST(? AS numeric),true,?,?)`,[itemId,b,sku,name,unit,reorder,now,now]); await insertAuditLog(tx.execute,{userId:req.user!.id,branchId:b,action:'INVENTORY_ITEM_CREATED',entityType:'INVENTORY_ITEM',entityId:itemId,newValues:{sku,name,unit,reorder_point:reorder},req}); }); } catch(e:any){if(e.httpStatus)return res.status(404).json({error:'NOT_FOUND',code:'BRANCH_NOT_FOUND',message:'Branch not found.',details:{}}); if(String(e.message).toLowerCase().includes('unique')) return res.status(409).json({error:'CONFLICT',code:'INVENTORY_SKU_EXISTS',message:'SKU already exists in this branch.',details:{}}); throw e;}
  res.status(201).json({item:await queryOne<any>('SELECT * FROM inventory_items WHERE id=?',[itemId])});
});

router.get('/recipes', requirePermission('inventory.view'), async (req,res)=>{ const b=String(req.query.branch_id||req.user!.branch_id||''); if(!b||!allowed(req,b)) return res.status(403).json({error:'BRANCH_ACCESS_DENIED',code:'BRANCH_ACCESS_DENIED',message:'Branch is outside your access scope.',details:{}}); const recipes=await query<any>(`SELECT r.*,m.sku,m.name_ru,m.name_tk FROM recipes r JOIN menu_items m ON m.id=r.menu_item_id WHERE r.branch_id=? AND r.active=true ORDER BY r.name`,[b]); for(const r of recipes) r.ingredients=await query<any>('SELECT ri.*,i.sku,i.name,i.unit,i.average_cost FROM recipe_ingredients ri JOIN inventory_items i ON i.id=ri.inventory_item_id WHERE ri.recipe_id=? ORDER BY i.name',[r.id]); res.json({recipes}); });

router.get('/recipes/:menuItemId/versions', requirePermission('inventory.view'), async (req,res)=>{
  const b=String(req.query.branch_id||req.user!.branch_id||''); if(!b||!allowed(req,b)) return res.status(403).json({error:'BRANCH_ACCESS_DENIED',code:'BRANCH_ACCESS_DENIED',message:'Branch is outside your access scope.',details:{}});
  const recipes=await query<any>('SELECT r.*,m.sku,m.name_ru,m.name_tk FROM recipes r JOIN menu_items m ON m.id=r.menu_item_id WHERE r.branch_id=? AND r.menu_item_id=? ORDER BY r.version DESC',[b,req.params.menuItemId]);
  for(const r of recipes) r.ingredients=await query<any>('SELECT ri.*,i.sku,i.name,i.unit,i.average_cost FROM recipe_ingredients ri JOIN inventory_items i ON i.id=ri.inventory_item_id WHERE ri.recipe_id=? ORDER BY i.name',[r.id]);
  res.json({branch_id:b,menu_item_id:req.params.menuItemId,versions:recipes});
});

router.post('/recipes', requirePermission('inventory.manage'), async (req,res)=>{
  const b=String(req.body?.branch_id||req.user!.branch_id||''), menuItemId=String(req.body?.menu_item_id||''), name=String(req.body?.name||'').trim(); const ingredients=Array.isArray(req.body?.ingredients)?req.body.ingredients:[];
  if(!b||!allowed(req,b)) return res.status(403).json({error:'BRANCH_ACCESS_DENIED',code:'BRANCH_ACCESS_DENIED',message:'Branch is outside your access scope.',details:{}}); if(!menuItemId||!name||!ingredients.length) return res.status(400).json({error:'VALIDATION_ERROR',code:'RECIPE_FIELDS_REQUIRED',message:'menu_item_id, name and ingredients are required.',details:{}});
  const rid=id('recipe'),now=new Date().toISOString(); try { await transaction(async tx=>{
    const menu=await tx.queryOne<any>('SELECT id FROM menu_items WHERE id=? AND (branch_id=? OR branch_id IS NULL) AND status=\'ACTIVE\'',[menuItemId,b]);if(!menu)throw Object.assign(new Error('MENU_ITEM_NOT_FOUND'),{httpStatus:404});
    // Only one ACTIVE recipe per (branch, menu item) -- enforced here now that the unique
    // constraint scope widened to include version, so multiple historical versions can coexist.
    const existingActive=await tx.queryOne<any>('SELECT id FROM recipes WHERE branch_id=? AND menu_item_id=? AND active=true FOR UPDATE',[b,menuItemId]);
    if(existingActive) throw Object.assign(new Error('RECIPE_ALREADY_EXISTS'),{httpStatus:409});
    await tx.execute(`INSERT INTO recipes (id,branch_id,menu_item_id,name,version,yield_qty,active,created_at,updated_at) VALUES (?,?,?,?,1,CAST(? AS numeric),true,?,?)`,[rid,b,menuItemId,name,qty(req.body?.yield_qty??'1'),now,now]);
    await insertRecipeIngredients(tx,rid,b,ingredients,now);
    await insertAuditLog(tx.execute,{userId:req.user!.id,branchId:b,action:'RECIPE_CREATED',entityType:'RECIPE',entityId:rid,newValues:{menu_item_id:menuItemId,version:1,ingredient_count:ingredients.length},req});
  });}catch(e:any){const map:any={MENU_ITEM_NOT_FOUND:[404,'NOT_FOUND','MENU_ITEM_NOT_FOUND'],INVENTORY_ITEM_NOT_FOUND:[404,'NOT_FOUND','INVENTORY_ITEM_NOT_FOUND'],INVALID_RECIPE_INGREDIENTS:[400,'VALIDATION_ERROR','INVALID_RECIPE_INGREDIENTS'],INVALID_QUANTITY:[400,'VALIDATION_ERROR','INVALID_QUANTITY'],RECIPE_ALREADY_EXISTS:[409,'CONFLICT','RECIPE_ALREADY_EXISTS']};if(map[e.message])return res.status(map[e.message][0]).json({error:map[e.message][1],code:map[e.message][2],message:e.message==='RECIPE_ALREADY_EXISTS'?'An active recipe already exists for this menu item in this branch. Use POST /recipes/:id/versions to change it.':e.message,details:{}});if(String(e.message).toLowerCase().includes('unique'))return res.status(409).json({error:'CONFLICT',code:'RECIPE_EXISTS',message:'An active recipe already exists for this menu item in this branch.',details:{}});throw e;}res.status(201).json({recipe:await queryOne<any>('SELECT * FROM recipes WHERE id=?',[rid])});
});

// Recipe "edit" path: never mutates the previous active row. Inserts a new version and flips the
// old one's active flag off in the same transaction, so every order_item.recipe_version_snapshot
// taken before this call keeps resolving to an immutable historical recipe row.
router.post('/recipes/:id/versions', requirePermission('inventory.manage'), async (req,res)=>{
  const ingredients=Array.isArray(req.body?.ingredients)?req.body.ingredients:[];
  if(!ingredients.length) return res.status(400).json({error:'VALIDATION_ERROR',code:'RECIPE_FIELDS_REQUIRED',message:'ingredients are required.',details:{}});
  const now=new Date().toISOString(); let newId='';
  try { await transaction(async tx=>{
    const current=await tx.queryOne<any>('SELECT * FROM recipes WHERE id=? FOR UPDATE',[req.params.id]);
    if(!current) throw Object.assign(new Error('RECIPE_NOT_FOUND'),{httpStatus:404});
    if(!allowed(req,current.branch_id)) throw Object.assign(new Error('BRANCH_ACCESS_DENIED'),{httpStatus:403});
    if(!current.active) throw Object.assign(new Error('RECIPE_NOT_ACTIVE'),{httpStatus:409});
    const newVersion=current.version+1; newId=id('recipe');
    const name=req.body?.name?String(req.body.name).trim():current.name;
    const yieldQty=req.body?.yield_qty!==undefined?qty(req.body.yield_qty):String(current.yield_qty);
    await tx.execute('UPDATE recipes SET active=false,updated_at=? WHERE id=?',[now,current.id]);
    await tx.execute(`INSERT INTO recipes (id,branch_id,menu_item_id,name,version,yield_qty,active,created_at,updated_at) VALUES (?,?,?,?,?,CAST(? AS numeric),true,?,?)`,[newId,current.branch_id,current.menu_item_id,name,newVersion,yieldQty,now,now]);
    await insertRecipeIngredients(tx,newId,current.branch_id,ingredients,now);
    await insertAuditLog(tx.execute,{userId:req.user!.id,branchId:current.branch_id,action:'RECIPE_VERSION_CREATED',entityType:'RECIPE',entityId:newId,oldValues:{previous_recipe_id:current.id,previous_version:current.version},newValues:{menu_item_id:current.menu_item_id,version:newVersion,ingredient_count:ingredients.length},req});
  });}catch(e:any){const map:any={RECIPE_NOT_FOUND:[404,'NOT_FOUND','RECIPE_NOT_FOUND'],BRANCH_ACCESS_DENIED:[403,'BRANCH_ACCESS_DENIED','BRANCH_ACCESS_DENIED'],RECIPE_NOT_ACTIVE:[409,'INVALID_STATE','RECIPE_NOT_ACTIVE'],INVENTORY_ITEM_NOT_FOUND:[404,'NOT_FOUND','INVENTORY_ITEM_NOT_FOUND'],INVALID_RECIPE_INGREDIENTS:[400,'VALIDATION_ERROR','INVALID_RECIPE_INGREDIENTS'],INVALID_QUANTITY:[400,'VALIDATION_ERROR','INVALID_QUANTITY']};if(map[e.message])return res.status(map[e.message][0]).json({error:map[e.message][1],code:map[e.message][2],message:e.message,details:{}});throw e;}
  const recipe=await queryOne<any>('SELECT * FROM recipes WHERE id=?',[newId]);
  const ingredientRows=await query<any>('SELECT ri.*,i.sku,i.name,i.unit,i.average_cost FROM recipe_ingredients ri JOIN inventory_items i ON i.id=ri.inventory_item_id WHERE ri.recipe_id=?',[newId]);
  res.status(201).json({recipe:{...recipe,ingredients:ingredientRows}});
});

// Activate/retire a recipe without creating a replacement version (e.g. discontinuing an item).
router.put('/recipes/:id/status', requirePermission('inventory.manage'), async (req,res)=>{
  const active=Boolean(req.body?.active); const now=new Date().toISOString();
  try { const result=await transaction(async tx=>{
    const r=await tx.queryOne<any>('SELECT * FROM recipes WHERE id=? FOR UPDATE',[req.params.id]);
    if(!r) throw Object.assign(new Error('RECIPE_NOT_FOUND'),{httpStatus:404});
    if(!allowed(req,r.branch_id)) throw Object.assign(new Error('BRANCH_ACCESS_DENIED'),{httpStatus:403});
    if(active && !r.active){const conflict=await tx.queryOne<any>('SELECT id FROM recipes WHERE branch_id=? AND menu_item_id=? AND active=true FOR UPDATE',[r.branch_id,r.menu_item_id]);if(conflict)throw Object.assign(new Error('ANOTHER_VERSION_ACTIVE'),{httpStatus:409});}
    await tx.execute('UPDATE recipes SET active=?,updated_at=? WHERE id=?',[active,now,r.id]);
    await insertAuditLog(tx.execute,{userId:req.user!.id,branchId:r.branch_id,action:active?'RECIPE_ACTIVATED':'RECIPE_DEACTIVATED',entityType:'RECIPE',entityId:r.id,oldValues:{active:r.active},newValues:{active},req});
    return await tx.queryOne<any>('SELECT * FROM recipes WHERE id=?',[r.id]);
  }); res.json({recipe:result}); } catch(e:any){const map:any={RECIPE_NOT_FOUND:[404,'NOT_FOUND','RECIPE_NOT_FOUND'],BRANCH_ACCESS_DENIED:[403,'BRANCH_ACCESS_DENIED','BRANCH_ACCESS_DENIED'],ANOTHER_VERSION_ACTIVE:[409,'INVALID_STATE','ANOTHER_VERSION_ACTIVE']};if(map[e.message])return res.status(map[e.message][0]).json({error:map[e.message][1],code:map[e.message][2],message:e.message,details:{}});throw e;}
});

router.get('/suppliers', requirePermission('inventory.view'), async(req,res)=>{const b=String(req.query.branch_id||req.user!.branch_id||'');if(!b||!allowed(req,b))return res.status(403).json({error:'BRANCH_ACCESS_DENIED',code:'BRANCH_ACCESS_DENIED',message:'Branch is outside your access scope.',details:{}});res.json({suppliers:await query<any>('SELECT * FROM suppliers WHERE branch_id=? ORDER BY name',[b])});});
router.post('/suppliers', requirePermission('inventory.purchase'), async(req,res)=>{const b=String(req.body?.branch_id||req.user!.branch_id||''),name=String(req.body?.name||'').trim();if(!b||!allowed(req,b))return res.status(403).json({error:'BRANCH_ACCESS_DENIED',code:'BRANCH_ACCESS_DENIED',message:'Branch is outside your access scope.',details:{}});if(!name)return res.status(400).json({error:'VALIDATION_ERROR',code:'SUPPLIER_NAME_REQUIRED',message:'Supplier name is required.',details:{}});const sid=id('sup'),now=new Date().toISOString();try{await transaction(async tx=>{const br=await tx.queryOne<any>('SELECT id FROM branches WHERE id=? AND status=\'ACTIVE\'',[b]);if(!br)throw Object.assign(new Error('BRANCH_NOT_FOUND'),{httpStatus:404});await tx.execute(`INSERT INTO suppliers (id,branch_id,name,phone,email,address,status,created_at,updated_at) VALUES (?,?,?,?,?,?, 'ACTIVE',?,?)`,[sid,b,name,req.body?.phone?String(req.body.phone):null,req.body?.email?String(req.body.email):null,req.body?.address?String(req.body.address):null,now,now]);await insertAuditLog(tx.execute,{userId:req.user!.id,branchId:b,action:'SUPPLIER_CREATED',entityType:'SUPPLIER',entityId:sid,newValues:{name},req});});}catch(e:any){if(e.httpStatus)return res.status(404).json({error:'NOT_FOUND',code:'BRANCH_NOT_FOUND',message:'Branch not found.',details:{}});if(String(e.message).toLowerCase().includes('unique'))return res.status(409).json({error:'CONFLICT',code:'SUPPLIER_EXISTS',message:'Supplier already exists in this branch.',details:{}});throw e;}res.status(201).json({supplier:await queryOne<any>('SELECT * FROM suppliers WHERE id=?',[sid])});});

router.post('/purchases', requirePermission('inventory.purchase'), async(req,res)=>{const b=String(req.body?.branch_id||req.user!.branch_id||''),supplierId=String(req.body?.supplier_id||''),items=Array.isArray(req.body?.items)?req.body.items:[];if(!b||!allowed(req,b))return res.status(403).json({error:'BRANCH_ACCESS_DENIED',code:'BRANCH_ACCESS_DENIED',message:'Branch is outside your access scope.',details:{}});if(!supplierId||!items.length)return res.status(400).json({error:'VALIDATION_ERROR',code:'PURCHASE_FIELDS_REQUIRED',message:'supplier_id and items are required.',details:{}});const pid=id('purchase'),now=new Date().toISOString();try{await transaction(async tx=>{const supplier=await tx.queryOne<any>('SELECT id FROM suppliers WHERE id=? AND branch_id=? AND status=\'ACTIVE\'',[supplierId,b]);if(!supplier)throw Object.assign(new Error('SUPPLIER_NOT_FOUND'),{httpStatus:404});await tx.execute(`INSERT INTO purchases (id,branch_id,supplier_id,status,reference,notes,total_cost,created_at,updated_at) VALUES (?,?,?,?,?,?,CAST(? AS numeric),?,?)`,[pid,b,supplierId,'DRAFT',req.body?.reference?String(req.body.reference):null,req.body?.notes?String(req.body.notes):null,'0',now,now]);for(const x of items){const q=qty(x?.quantity),c=money(x?.unit_cost);const item=await tx.queryOne<any>('SELECT id FROM inventory_items WHERE id=? AND branch_id=? AND active=true',[String(x?.inventory_item_id||''),b]);if(!item)throw Object.assign(new Error('INVENTORY_ITEM_NOT_FOUND'),{httpStatus:404});const row=await tx.queryOne<any>('SELECT CAST(? AS DECIMAL(14,4))*CAST(? AS DECIMAL(14,2)) AS subtotal',[q,c]);await tx.execute(`INSERT INTO purchase_items (id,purchase_id,inventory_item_id,quantity,unit_cost,subtotal) VALUES (?,?,?,CAST(? AS numeric),CAST(? AS numeric),CAST(? AS numeric))`,[id('pi'),pid,item.id,q,c,String(row.subtotal)]);}await tx.execute('UPDATE purchases SET total_cost=(SELECT COALESCE(SUM(subtotal),0) FROM purchase_items WHERE purchase_id=?),updated_at=? WHERE id=?',[pid,now,pid]);const totalRow=await tx.queryOne<any>('SELECT total_cost FROM purchases WHERE id=?',[pid]);const total=String(totalRow.total_cost);await insertAuditLog(tx.execute,{userId:req.user!.id,branchId:b,action:'PURCHASE_CREATED',entityType:'PURCHASE',entityId:pid,newValues:{total_cost:total,status:'DRAFT'},req});});}catch(e:any){const map:any={SUPPLIER_NOT_FOUND:[404,'NOT_FOUND','SUPPLIER_NOT_FOUND'],INVENTORY_ITEM_NOT_FOUND:[404,'NOT_FOUND','INVENTORY_ITEM_NOT_FOUND'],INVALID_QUANTITY:[400,'VALIDATION_ERROR','INVALID_QUANTITY'],INVALID_MONEY:[400,'VALIDATION_ERROR','INVALID_MONEY']};if(map[e.message])return res.status(map[e.message][0]).json({error:map[e.message][1],code:map[e.message][2],message:e.message,details:{}});throw e;}res.status(201).json({purchase:await queryOne<any>('SELECT * FROM purchases WHERE id=?',[pid])});});

router.post('/purchases/:id/receive', requirePermission('inventory.purchase'), async(req,res)=>{const now=new Date().toISOString();try{const result=await transaction(async tx=>{const p=await tx.queryOne<any>('SELECT * FROM purchases WHERE id=? FOR UPDATE',[req.params.id]);if(!p)throw Object.assign(new Error('PURCHASE_NOT_FOUND'),{httpStatus:404});if(!allowed(req,p.branch_id))throw Object.assign(new Error('BRANCH_ACCESS_DENIED'),{httpStatus:403});if(p.status!=='DRAFT')throw Object.assign(new Error('PURCHASE_NOT_DRAFT'),{httpStatus:409});const items=await tx.query<any>('SELECT * FROM purchase_items WHERE purchase_id=?',[p.id]);for(const x of items){
  // Stage 34: moving weighted-average cost, the authoritative cost basis recipe costing reads.
  // new_avg = (old_stock*old_avg + received_qty*received_cost) / (old_stock+received_qty),
  // computed in Postgres NUMERIC -- never Float -- and stored on the item so every later read is
  // O(1) rather than re-scanning purchase history.
  const item=await tx.queryOne<any>('SELECT current_stock,average_cost FROM inventory_items WHERE id=? AND branch_id=? FOR UPDATE',[x.inventory_item_id,p.branch_id]);
  if(!item) throw Object.assign(new Error('INVENTORY_ITEM_NOT_FOUND'),{httpStatus:404});
  const avgRow=await tx.queryOne<any>(`SELECT CASE WHEN (CAST(? AS DECIMAL(14,4))+CAST(? AS DECIMAL(14,4)))=0 THEN 0 ELSE ((CAST(? AS DECIMAL(14,4))*CAST(? AS DECIMAL(14,4)))+(CAST(? AS DECIMAL(14,4))*CAST(? AS DECIMAL(14,2))))/(CAST(? AS DECIMAL(14,4))+CAST(? AS DECIMAL(14,4))) END AS new_avg`,[item.current_stock,x.quantity,item.current_stock,item.average_cost,x.quantity,x.unit_cost,item.current_stock,x.quantity]);
  const newAvg=String(avgRow.new_avg);
  await tx.execute(`UPDATE inventory_items SET current_stock=current_stock+CAST(? AS numeric),average_cost=CAST(? AS numeric),updated_at=? WHERE id=? AND branch_id=?`,[x.quantity,newAvg,now,x.inventory_item_id,p.branch_id]);
  await tx.execute(`INSERT INTO stock_movements (id,branch_id,inventory_item_id,type,quantity,unit_cost,reference_type,reference_id,reason,created_by,created_at) VALUES (?,?,?,?,CAST(? AS numeric),CAST(? AS numeric),?,?,?,?,?)`,[id('mov'),p.branch_id,x.inventory_item_id,'PURCHASE',x.quantity,x.unit_cost,'PURCHASE',p.id,'Supplier purchase received',req.user!.id,now]);
}await tx.execute(`UPDATE purchases SET status='RECEIVED',received_at=?,updated_at=? WHERE id=? AND status='DRAFT'`,[now,now,p.id]);await insertAuditLog(tx.execute,{userId:req.user!.id,branchId:p.branch_id,action:'PURCHASE_RECEIVED',entityType:'PURCHASE',entityId:p.id,oldValues:{status:'DRAFT'},newValues:{status:'RECEIVED'},req});return await tx.queryOne<any>('SELECT * FROM purchases WHERE id=?',[p.id]);});res.json({purchase:result});}catch(e:any){const map:any={PURCHASE_NOT_FOUND:[404,'NOT_FOUND','PURCHASE_NOT_FOUND'],BRANCH_ACCESS_DENIED:[403,'BRANCH_ACCESS_DENIED','BRANCH_ACCESS_DENIED'],PURCHASE_NOT_DRAFT:[409,'INVALID_STATE','PURCHASE_NOT_DRAFT'],INVENTORY_ITEM_NOT_FOUND:[404,'NOT_FOUND','INVENTORY_ITEM_NOT_FOUND']};if(map[e.message])return res.status(map[e.message][0]).json({error:map[e.message][1],code:map[e.message][2],message:e.message,details:{}});throw e;}});

router.post('/movements', requirePermission('inventory.manage'), async(req,res)=>{const b=String(req.body?.branch_id||req.user!.branch_id||''),itemId=String(req.body?.inventory_item_id||''),type=String(req.body?.type||'').toUpperCase(),reason=req.body?.reason?String(req.body.reason):null;if(!b||!allowed(req,b))return res.status(403).json({error:'BRANCH_ACCESS_DENIED',code:'BRANCH_ACCESS_DENIED',message:'Branch is outside your access scope.',details:{}});if(!MOVEMENTS.has(type)||type==='SALE'||type==='PURCHASE')return res.status(400).json({error:'VALIDATION_ERROR',code:'INVALID_MANUAL_MOVEMENT_TYPE',message:'Manual movements support WASTE, ADJUSTMENT, TRANSFER_IN, TRANSFER_OUT and RETURN.',details:{}});let q;try{q=qty(req.body?.quantity)}catch{return res.status(400).json({error:'VALIDATION_ERROR',code:'INVALID_QUANTITY',message:'quantity must be non-negative with up to four decimals.',details:{}});}const now=new Date().toISOString(),mid=id('mov');try{await transaction(async tx=>{const item=await tx.queryOne<any>('SELECT * FROM inventory_items WHERE id=? AND branch_id=? AND active=true FOR UPDATE',[itemId,b]);if(!item)throw Object.assign(new Error('INVENTORY_ITEM_NOT_FOUND'),{httpStatus:404});const signed=['WASTE','TRANSFER_OUT'].includes(type)?'-':'+';const next=await tx.queryOne<any>(`SELECT CAST(current_stock AS DECIMAL(14,4)) ${signed==='-'?'-':'+'} CAST(? AS DECIMAL(14,4)) AS next_stock FROM inventory_items WHERE id=? FOR UPDATE`,[q,itemId]);if(String(next.next_stock).startsWith('-'))throw Object.assign(new Error('INSUFFICIENT_STOCK'),{httpStatus:409});await tx.execute(`UPDATE inventory_items SET current_stock=current_stock ${signed} CAST(? AS numeric),updated_at=? WHERE id=?`,[q,now,itemId]);await tx.execute(`INSERT INTO stock_movements (id,branch_id,inventory_item_id,type,quantity,reason,created_by,created_at) VALUES (?,?,?,?,CAST(? AS numeric),?,?,?)`,[mid,b,itemId,type,q,reason,req.user!.id,now]);await insertAuditLog(tx.execute,{userId:req.user!.id,branchId:b,action:'STOCK_ADJUSTMENT',entityType:'STOCK_MOVEMENT',entityId:mid,newValues:{type,quantity:q,reason},req});});}catch(e:any){const map:any={INVENTORY_ITEM_NOT_FOUND:[404,'NOT_FOUND','INVENTORY_ITEM_NOT_FOUND'],INSUFFICIENT_STOCK:[409,'INVALID_STATE','INSUFFICIENT_STOCK']};if(map[e.message])return res.status(map[e.message][0]).json({error:map[e.message][1],code:map[e.message][2],message:e.message,details:{}});throw e;}res.status(201).json({movement:await queryOne<any>('SELECT * FROM stock_movements WHERE id=?',[mid]),item:await queryOne<any>('SELECT * FROM inventory_items WHERE id=?',[itemId])});});

router.get('/movements', requirePermission('inventory.view'), async(req,res)=>{const b=String(req.query.branch_id||req.user!.branch_id||'');if(!b||!allowed(req,b))return res.status(403).json({error:'BRANCH_ACCESS_DENIED',code:'BRANCH_ACCESS_DENIED',message:'Branch is outside your access scope.',details:{}});res.json({movements:await query<any>('SELECT sm.*,i.sku,i.name,i.unit FROM stock_movements sm JOIN inventory_items i ON i.id=sm.inventory_item_id WHERE sm.branch_id=? ORDER BY sm.created_at DESC LIMIT 500',[b])});});

// ---------------------------------------------------------------------------------------------
// Inventory counts (theoretical vs actual, controlled adjustment): a physical count is recorded
// against the item's current (theoretical) stock, and any resulting delta is applied through the
// SAME ADJUSTMENT stock-movement ledger every other manual movement uses -- never a silent direct
// stock write with no ledger trace.
// ---------------------------------------------------------------------------------------------
router.post('/counts', requirePermission('inventory.manage'), async (req,res) => {
  const b=String(req.body?.branch_id||req.user!.branch_id||''); const itemId=String(req.body?.inventory_item_id||''); const reason=req.body?.reason?String(req.body.reason).trim().slice(0,500):null;
  if(!b||!allowed(req,b)) return res.status(403).json({error:'BRANCH_ACCESS_DENIED',code:'BRANCH_ACCESS_DENIED',message:'Branch is outside your access scope.',details:{}});
  let counted:string; try{counted=qtyNonNegative(req.body?.counted_quantity)}catch{return res.status(400).json({error:'VALIDATION_ERROR',code:'INVALID_QUANTITY',message:'counted_quantity must be a non-negative quantity with up to four decimals.',details:{}});}
  const now=new Date().toISOString(), cid=id('invcount');
  try {
    const result = await transaction(async tx=>{
      const item=await tx.queryOne<any>('SELECT * FROM inventory_items WHERE id=? AND branch_id=? AND active=true FOR UPDATE',[itemId,b]);
      if(!item) throw Object.assign(new Error('INVENTORY_ITEM_NOT_FOUND'),{httpStatus:404});
      const theoretical=String(item.current_stock);
      const deltaRow=await tx.queryOne<any>('SELECT (CAST(? AS DECIMAL(14,4))-CAST(? AS DECIMAL(14,4))) AS delta',[counted,theoretical]);
      const delta=String(deltaRow.delta);
      let movementId:string|null=null;
      if (Number(delta) !== 0) {
        movementId=id('mov');
        const magRow=await tx.queryOne<any>('SELECT ABS(CAST(? AS DECIMAL(14,4))) AS mag',[delta]);
        await tx.execute('INSERT INTO stock_movements (id,branch_id,inventory_item_id,type,quantity,reference_type,reference_id,reason,created_by,created_at) VALUES (?,?,?,?,CAST(? AS numeric),?,?,?,?,?)',[movementId,b,itemId,'ADJUSTMENT',String(magRow.mag),'INVENTORY_COUNT',cid,`Inventory count variance ${Number(delta)>0?'+':''}${delta}${reason?`: ${reason}`:''}`,req.user!.id,now]);
      }
      await tx.execute('UPDATE inventory_items SET current_stock=CAST(? AS numeric),updated_at=? WHERE id=?',[counted,now,itemId]);
      await tx.execute('INSERT INTO inventory_counts (id,branch_id,inventory_item_id,theoretical_quantity,counted_quantity,delta,reason,counted_by,stock_movement_id,created_at) VALUES (?,?,?,CAST(? AS numeric),CAST(? AS numeric),CAST(? AS numeric),?,?,?,?)',[cid,b,itemId,theoretical,counted,delta,reason,req.user!.id,movementId,now]);
      await insertAuditLog(tx.execute,{userId:req.user!.id,branchId:b,action:'INVENTORY_COUNT_RECORDED',entityType:'INVENTORY_COUNT',entityId:cid,newValues:{inventory_item_id:itemId,theoretical_quantity:theoretical,counted_quantity:counted,delta,reason},req});
      return await tx.queryOne<any>('SELECT * FROM inventory_counts WHERE id=?',[cid]);
    });
    res.status(201).json({count:result,item:await queryOne<any>('SELECT * FROM inventory_items WHERE id=?',[itemId])});
  } catch(e:any) { const map:any={INVENTORY_ITEM_NOT_FOUND:[404,'NOT_FOUND','INVENTORY_ITEM_NOT_FOUND']}; if(map[e.message]) return res.status(map[e.message][0]).json({error:map[e.message][1],code:map[e.message][2],message:e.message,details:{}}); throw e; }
});

router.get('/counts', requirePermission('inventory.view'), async (req,res) => {
  const b=String(req.query.branch_id||req.user!.branch_id||''); if(!b||!allowed(req,b)) return res.status(403).json({error:'BRANCH_ACCESS_DENIED',code:'BRANCH_ACCESS_DENIED',message:'Branch is outside your access scope.',details:{}});
  const rows=await query<any>('SELECT ic.*,i.name,i.sku,i.unit,u.full_name AS counted_by_name FROM inventory_counts ic JOIN inventory_items i ON i.id=ic.inventory_item_id LEFT JOIN users u ON u.id=ic.counted_by WHERE ic.branch_id=? ORDER BY ic.created_at DESC LIMIT 200',[b]);
  res.json({counts:rows});
});

export default router;
