import { Router, Request, Response } from 'express';
import crypto from 'node:crypto';
import { query, queryOne, execute, transaction } from '../db';
import { authenticateToken, requirePermission, insertAuditLog } from '../auth';
import { getWaiterSession } from './waiters';

const router = Router();
function validInt(v: unknown, fallback = 0) { const n = Number(v ?? fallback); return Number.isInteger(n) && n >= 0 ? n : null; }
function validMoney(v: unknown) { const x = String(v ?? '').trim(); return /^\d+(?:\.\d{1,2})?$/.test(x) ? x : null; }
router.get('/pos', async (req,res)=>{
  const session=await getWaiterSession(req);
  if(!session){res.status(401).json({error:'WAITER_SESSION_INVALID',code:'WAITER_SESSION_INVALID',message:'Valid Waiter POS session required.',details:{}});return;}
  const categories=await query<any>("SELECT id,name_ru,name_tk,sort_order,status FROM menu_categories WHERE (branch_id=? OR branch_id IS NULL) AND status='ACTIVE' AND deleted_at IS NULL ORDER BY sort_order,name_ru",[session.branch_id]);
  // Stage 36: the waiter POS reads the dish photo from the SAME media asset the admin attached.
  const items=await query<any>(`SELECT mi.id,mi.category_id,mi.sku,mi.name_ru,mi.name_tk,mi.description_ru,mi.description_tk,mi.price,mi.status,mi.sort_order,
      m.url AS media_url,m.kind AS media_kind,m.poster_url AS media_poster_url,m.focal_x AS media_focal_x,m.focal_y AS media_focal_y
    FROM menu_items mi LEFT JOIN media_assets m ON m.id=mi.media_asset_id AND m.active=true
    WHERE (mi.branch_id=? OR mi.branch_id IS NULL) AND mi.status='ACTIVE' AND mi.deleted_at IS NULL ORDER BY mi.sort_order,mi.name_ru`,[session.branch_id]);
  res.json({branch_id:session.branch_id,categories,items});
});
router.use(authenticateToken);

function scopedBranch(req: Request, branchId?: string): string | null {
  const id = branchId || req.user?.branch_id || undefined;
  if (!id) return null;
  if (!req.user?.isSuperUser && !req.user?.allowedBranchIds.includes(id)) return null;
  return id;
}

router.get('/', requirePermission('menu.view'), async (req, res) => {
  const branchId = scopedBranch(req, typeof req.query.branch_id === 'string' ? req.query.branch_id : undefined);
  if (!branchId) { res.status(403).json({ error:'BRANCH_ACCESS_DENIED', code:'BRANCH_ACCESS_DENIED', message:'Branch is outside your access scope.', details:{} }); return; }
  // Stage 36: the admin Menu Builder needs the archived/inactive rows too (that is the whole point
  // of an archive/restore surface), so `include_archived=true` widens the read. The default stays
  // exactly as every other caller has always seen it: ACTIVE, not deleted.
  const includeArchived = String(req.query.include_archived || '') === 'true';
  const catFilter = includeArchived ? '' : " AND status='ACTIVE' AND deleted_at IS NULL";
  const itemFilter = includeArchived ? '' : " AND mi.status='ACTIVE' AND mi.deleted_at IS NULL";
  const categories = await query<any>(`SELECT id,branch_id,name_ru,name_tk,sort_order,status,deleted_at FROM menu_categories WHERE (branch_id=? OR branch_id IS NULL)${catFilter} ORDER BY sort_order,name_ru`,[branchId]);
  // Stage 36: dish media comes from the ONE existing media_assets table via a LEFT JOIN -- the
  // admin, the waiter POS and the customer menu all read this same asset row.
  const items = await query<any>(`SELECT mi.id,mi.branch_id,mi.category_id,mi.sku,mi.name_ru,mi.name_tk,mi.description_ru,mi.description_tk,mi.price,mi.status,mi.sort_order,mi.deleted_at,mi.media_asset_id,
      m.url AS media_url,m.kind AS media_kind,m.poster_url AS media_poster_url,m.alt_ru AS media_alt_ru,m.alt_tk AS media_alt_tk,m.focal_x AS media_focal_x,m.focal_y AS media_focal_y
    FROM menu_items mi LEFT JOIN media_assets m ON m.id=mi.media_asset_id
    WHERE (mi.branch_id=? OR mi.branch_id IS NULL)${itemFilter} ORDER BY mi.sort_order,mi.name_ru`,[branchId]);
  res.json({ branch_id: branchId, categories, items });
});

router.post('/categories', requirePermission('menu.manage'), async (req,res) => {
  const branchId = scopedBranch(req, String(req.body?.branch_id || ''));
  if (!branchId) { res.status(403).json({ error:'BRANCH_ACCESS_DENIED', code:'BRANCH_ACCESS_DENIED', message:'Branch is outside your access scope.', details:{} }); return; }
  const nameRu=String(req.body?.name_ru||'').trim(), nameTk=String(req.body?.name_tk||'').trim();
  if(!nameRu||!nameTk){res.status(400).json({error:'VALIDATION_ERROR',code:'CATEGORY_NAME_REQUIRED',message:'Russian and Turkmen category names are required.',details:{}});return;}
  const now=new Date().toISOString(), id=`mcat_${crypto.randomUUID()}`;
  await execute('INSERT INTO menu_categories (id,branch_id,name_ru,name_tk,sort_order,status,created_at,updated_at) VALUES (?,?,?,?,?,\'ACTIVE\',?,?)',[id,branchId,nameRu,nameTk,Number(req.body?.sort_order||0),now,now]);
  res.status(201).json({category:await queryOne<any>('SELECT * FROM menu_categories WHERE id=? AND deleted_at IS NULL',[id])});
});

router.post('/items', requirePermission('menu.manage'), async (req,res) => {
  const branchId = scopedBranch(req, String(req.body?.branch_id || ''));
  const categoryId=String(req.body?.category_id||''); const sku=String(req.body?.sku||'').trim().toUpperCase();
  const nameRu=String(req.body?.name_ru||'').trim(), nameTk=String(req.body?.name_tk||'').trim(); const price=String(req.body?.price||'').trim();
  if(!branchId||!categoryId||!sku||!nameRu||!nameTk||!/^[0-9]+(?:\.[0-9]{1,2})?$/.test(price)){res.status(400).json({error:'VALIDATION_ERROR',code:'INVALID_MENU_ITEM',message:'branch_id, category_id, sku, bilingual names and a precise decimal price are required.',details:{}});return;}
  const category=await queryOne<any>('SELECT id FROM menu_categories WHERE id=? AND (branch_id=? OR branch_id IS NULL) AND status=\'ACTIVE\'',[categoryId,branchId]);
  if(!category){res.status(404).json({error:'NOT_FOUND',code:'MENU_CATEGORY_NOT_FOUND',message:'Menu category not found for this branch.',details:{}});return;}
  const id=`mit_${crypto.randomUUID()}`,now=new Date().toISOString();
  try { await execute('INSERT INTO menu_items (id,branch_id,category_id,sku,name_ru,name_tk,description_ru,description_tk,price,status,sort_order,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,CAST(? AS numeric),\'ACTIVE\',?,?,?)',[id,branchId,categoryId,sku,nameRu,nameTk,req.body?.description_ru||null,req.body?.description_tk||null,price,Number(req.body?.sort_order||0),now,now]); }
  catch(e:any){ if(String(e.message).toLowerCase().includes('unique')){res.status(409).json({error:'CONFLICT',code:'MENU_SKU_IN_USE',message:'SKU is already assigned.',details:{sku}});return;} throw e; }
  res.status(201).json({item:await queryOne<any>('SELECT * FROM menu_items WHERE id=? AND deleted_at IS NULL',[id])});
});

router.get('/items/:itemId/modifiers', requirePermission('menu.view'), async (req,res)=>{
  const branchId=scopedBranch(req, typeof req.query.branch_id==='string'?req.query.branch_id:undefined);
  if(!branchId) return res.status(403).json({error:'BRANCH_ACCESS_DENIED',code:'BRANCH_ACCESS_DENIED',message:'Branch is outside your access scope.',details:{}});
  const item=await queryOne<any>(`SELECT id,name_ru,name_tk FROM menu_items WHERE id=? AND deleted_at IS NULL AND (branch_id=? OR branch_id IS NULL)`,[req.params.itemId,branchId]);
  if(!item) return res.status(404).json({error:'NOT_FOUND',code:'MENU_ITEM_NOT_FOUND',message:'Menu item not found.',details:{}});
  // Stage 36: the Menu Builder / Burger Constructor needs archived rows to be able to restore
  // them; every other caller keeps the ACTIVE-only view it has always had.
  const withArchived = String(req.query.include_archived || '') === 'true';
  const groupFilter = withArchived ? '' : " AND status='ACTIVE'";
  const modifierFilter = withArchived ? '' : " AND status='ACTIVE'";
  const groups=await query<any>(`SELECT * FROM menu_modifier_groups WHERE menu_item_id=? AND branch_id=?${groupFilter} AND EXISTS (SELECT 1 FROM menu_items mi WHERE mi.id=menu_item_id AND mi.deleted_at IS NULL) ORDER BY sort_order,name_ru`,[item.id,branchId]);
  for(const g of groups) g.modifiers=await query<any>(`SELECT * FROM menu_modifiers WHERE group_id=?${modifierFilter} ORDER BY sort_order,name_ru`,[g.id]);
  res.json({item,groups});
});

router.post('/items/:itemId/modifier-groups', requirePermission('menu.manage'), async(req,res)=>{
  const branchId=scopedBranch(req, String(req.body?.branch_id||'')); if(!branchId) return res.status(403).json({error:'BRANCH_ACCESS_DENIED',code:'BRANCH_ACCESS_DENIED',message:'Branch is outside your access scope.',details:{}});
  const item=await queryOne<any>(`SELECT id FROM menu_items WHERE id=? AND branch_id=? AND status='ACTIVE'`,[req.params.itemId,branchId]); if(!item) return res.status(404).json({error:'NOT_FOUND',code:'MENU_ITEM_NOT_FOUND',message:'Menu item not found for this branch.',details:{}});
  const nameRu=String(req.body?.name_ru||'').trim(), nameTk=String(req.body?.name_tk||'').trim(), min=validInt(req.body?.min_select), max=validInt(req.body?.max_select,1), required=Boolean(req.body?.required);
  if(!nameRu||!nameTk||min===null||max===null||min>max||max>50|| (required && min<1)) return res.status(400).json({error:'VALIDATION_ERROR',code:'INVALID_MODIFIER_GROUP',message:'Modifier group names and valid selection bounds are required.',details:{}});
  const id=`mmg_${crypto.randomUUID()}`,now=new Date().toISOString();
  await execute(`INSERT INTO menu_modifier_groups (id,branch_id,menu_item_id,name_ru,name_tk,min_select,max_select,required,sort_order,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,'ACTIVE',?,?)`,[id,branchId,item.id,nameRu,nameTk,min,max,required,validInt(req.body?.sort_order,0),now,now]);
  await insertAuditLog(execute,{userId:req.user!.id,branchId,action:'MENU_MODIFIER_GROUP_CREATED',entityType:'MENU_MODIFIER_GROUP',entityId:id,newValues:{menu_item_id:item.id,name_ru:nameRu,min_select:min,max_select:max,required},req});
  res.status(201).json({group:await queryOne<any>('SELECT * FROM menu_modifier_groups WHERE id=?',[id])});
});

router.post('/modifier-groups/:groupId/modifiers', requirePermission('menu.manage'), async(req,res)=>{
  const nameRu=String(req.body?.name_ru||'').trim(), nameTk=String(req.body?.name_tk||'').trim(), delta=validMoney(req.body?.price_delta ?? '0');
  const group=await queryOne<any>(`SELECT g.id,g.branch_id FROM menu_modifier_groups g WHERE g.id=? AND g.status='ACTIVE'`,[req.params.groupId]);
  if(!group||!scopedBranch(req,group.branch_id)) return res.status(404).json({error:'NOT_FOUND',code:'MODIFIER_GROUP_NOT_FOUND',message:'Modifier group not found.',details:{}});
  if(!nameRu||!nameTk||delta===null) return res.status(400).json({error:'VALIDATION_ERROR',code:'INVALID_MODIFIER',message:'Bilingual modifier names and precise price_delta are required.',details:{}});
  const id=`mm_${crypto.randomUUID()}`,now=new Date().toISOString();
  await execute(`INSERT INTO menu_modifiers (id,group_id,name_ru,name_tk,price_delta,sort_order,status,created_at,updated_at) VALUES (?,?,?,?,CAST(? AS numeric),?,'ACTIVE',?,?)`,[id,group.id,nameRu,nameTk,delta,validInt(req.body?.sort_order,0),now,now]);
  await insertAuditLog(execute,{userId:req.user!.id,branchId:group.branch_id,action:'MENU_MODIFIER_CREATED',entityType:'MENU_MODIFIER',entityId:id,newValues:{group_id:group.id,name_ru:nameRu,price_delta:delta},req});
  res.status(201).json({modifier:await queryOne<any>('SELECT * FROM menu_modifiers WHERE id=?',[id])});
});

router.patch('/categories/:id', requirePermission('menu.manage'), async(req,res)=>{
  const row=await queryOne<any>('SELECT * FROM menu_categories WHERE id=? AND deleted_at IS NULL',[req.params.id]); if(!row||(!row.branch_id && !req.user?.isSuperUser)||!scopedBranch(req,row.branch_id||req.user!.branch_id||'')) return res.status(404).json({error:'NOT_FOUND',code:'MENU_CATEGORY_NOT_FOUND',message:'Menu category not found.',details:{}});
  const ru=String(req.body?.name_ru??row.name_ru).trim(),tk=String(req.body?.name_tk??row.name_tk).trim(),status=String(req.body?.status??row.status).toUpperCase(); const sort=validInt(req.body?.sort_order,row.sort_order);
  if(!ru||!tk||sort===null||!['ACTIVE','INACTIVE'].includes(status)) return res.status(400).json({error:'VALIDATION_ERROR',code:'INVALID_CATEGORY_UPDATE',message:'Invalid category update.',details:{}});
  const now=new Date().toISOString(); await execute('UPDATE menu_categories SET name_ru=?,name_tk=?,sort_order=?,status=?,updated_at=? WHERE id=?',[ru,tk,sort,status,now,row.id]);
  await insertAuditLog(execute,{userId:req.user!.id,branchId:row.branch_id,action:'MENU_CATEGORY_UPDATED',entityType:'MENU_CATEGORY',entityId:row.id,oldValues:{name_ru:row.name_ru,name_tk:row.name_tk,status:row.status,sort_order:row.sort_order},newValues:{name_ru:ru,name_tk:tk,status,sort_order:sort},req});
  res.json({category:await queryOne<any>('SELECT * FROM menu_categories WHERE id=? AND deleted_at IS NULL',[row.id])});
});

router.patch('/items/:id', requirePermission('menu.manage'), async(req,res)=>{
  const row=await queryOne<any>('SELECT * FROM menu_items WHERE id=? AND deleted_at IS NULL',[req.params.id]); if(!row||!scopedBranch(req,row.branch_id||req.user!.branch_id||'')) return res.status(404).json({error:'NOT_FOUND',code:'MENU_ITEM_NOT_FOUND',message:'Menu item not found.',details:{}});
  const ru=String(req.body?.name_ru??row.name_ru).trim(),tk=String(req.body?.name_tk??row.name_tk).trim(),status=String(req.body?.status??row.status).toUpperCase(),price=validMoney(req.body?.price??row.price); const sort=validInt(req.body?.sort_order,row.sort_order);
  if(!ru||!tk||price===null||sort===null||!['ACTIVE','INACTIVE'].includes(status)) return res.status(400).json({error:'VALIDATION_ERROR',code:'INVALID_MENU_ITEM_UPDATE',message:'Invalid menu item update.',details:{}});
  // Stage 36: the dish photo. `media_asset_id` is only touched when the caller actually sends the
  // field, so every existing caller keeps its current behaviour. The asset must exist, be active,
  // and belong to this branch (or be a global asset) -- the client cannot attach another branch's
  // media by id. Sending null detaches the photo.
  let mediaAssetId = row.media_asset_id;
  if (req.body?.media_asset_id !== undefined) {
    const raw = req.body.media_asset_id;
    if (raw === null || raw === '') mediaAssetId = null;
    else {
      const asset = await queryOne<any>('SELECT id,branch_id FROM media_assets WHERE id=? AND active=true',[String(raw)]);
      if (!asset) return res.status(404).json({error:'NOT_FOUND',code:'MEDIA_ASSET_NOT_FOUND',message:'Media asset not found.',details:{}});
      if (asset.branch_id && !scopedBranch(req, asset.branch_id)) return res.status(403).json({error:'BRANCH_ACCESS_DENIED',code:'BRANCH_ACCESS_DENIED',message:'Media asset is outside your access scope.',details:{}});
      mediaAssetId = asset.id;
    }
  }
  const now=new Date().toISOString(); await execute('UPDATE menu_items SET name_ru=?,name_tk=?,description_ru=?,description_tk=?,price=CAST(? AS numeric),sort_order=?,status=?,media_asset_id=?,updated_at=? WHERE id=?',[ru,tk,req.body?.description_ru??row.description_ru,req.body?.description_tk??row.description_tk,price,sort,status,mediaAssetId,now,row.id]);
  await insertAuditLog(execute,{userId:req.user!.id,branchId:row.branch_id,action:'MENU_ITEM_UPDATED',entityType:'MENU_ITEM',entityId:row.id,oldValues:{name_ru:row.name_ru,name_tk:row.name_tk,price:String(row.price),status:row.status,media_asset_id:row.media_asset_id},newValues:{name_ru:ru,name_tk:tk,price,status,media_asset_id:mediaAssetId},req});
  res.json({item:await queryOne<any>('SELECT * FROM menu_items WHERE id=? AND deleted_at IS NULL',[row.id])});
});

// ---------------------------------------------------------------------------------------------
// Stage 36 -- modifier group / option editing and archiving.
//
// The Modifier Engine could previously only CREATE: a manager who mistyped a burger component,
// or needed to retire one, had no way to fix it from ADMIN. These four routes close that gap and
// nothing more -- same table, same permission, same audit helper, same branch scoping as the
// create routes above. Archiving sets status='INACTIVE' (never a hard delete), so historical
// order lines keep their `price_delta_snapshot` and their modifier reference intact.
// ---------------------------------------------------------------------------------------------

async function loadScopedGroup(req: Request, groupId: string) {
  const group = await queryOne<any>('SELECT * FROM menu_modifier_groups WHERE id=?',[groupId]);
  if (!group || !scopedBranch(req, group.branch_id)) return null;
  return group;
}

router.patch('/modifier-groups/:groupId', requirePermission('menu.manage'), async(req,res)=>{
  const row = await loadScopedGroup(req, req.params.groupId);
  if(!row) return res.status(404).json({error:'NOT_FOUND',code:'MODIFIER_GROUP_NOT_FOUND',message:'Modifier group not found.',details:{}});
  const ru=String(req.body?.name_ru??row.name_ru).trim(), tk=String(req.body?.name_tk??row.name_tk).trim();
  const min=validInt(req.body?.min_select??row.min_select), max=validInt(req.body?.max_select??row.max_select,1);
  const required=req.body?.required!==undefined?Boolean(req.body.required):Boolean(row.required);
  const sort=validInt(req.body?.sort_order??row.sort_order,0);
  const status=String(req.body?.status??row.status).toUpperCase();
  if(!ru||!tk||min===null||max===null||sort===null||min>max||max>50||(required&&min<1)||!['ACTIVE','INACTIVE'].includes(status))
    return res.status(400).json({error:'VALIDATION_ERROR',code:'INVALID_MODIFIER_GROUP',message:'Modifier group names and valid selection bounds are required.',details:{}});
  const now=new Date().toISOString();
  await execute('UPDATE menu_modifier_groups SET name_ru=?,name_tk=?,min_select=?,max_select=?,required=?,sort_order=?,status=?,updated_at=? WHERE id=?',[ru,tk,min,max,required,sort,status,now,row.id]);
  await insertAuditLog(execute,{userId:req.user!.id,branchId:row.branch_id,action:'MENU_MODIFIER_GROUP_UPDATED',entityType:'MENU_MODIFIER_GROUP',entityId:row.id,oldValues:{name_ru:row.name_ru,name_tk:row.name_tk,min_select:row.min_select,max_select:row.max_select,required:row.required,status:row.status},newValues:{name_ru:ru,name_tk:tk,min_select:min,max_select:max,required,status},req});
  res.json({group:await queryOne<any>('SELECT * FROM menu_modifier_groups WHERE id=?',[row.id])});
});

router.delete('/modifier-groups/:groupId', requirePermission('menu.manage'), async(req,res)=>{
  const row = await loadScopedGroup(req, req.params.groupId);
  if(!row) return res.status(404).json({error:'NOT_FOUND',code:'MODIFIER_GROUP_NOT_FOUND',message:'Modifier group not found.',details:{}});
  const now=new Date().toISOString();
  // Archive the group and its options together: a live option under an archived group would be
  // unreachable from the POS but still selectable by a stale client payload.
  await execute("UPDATE menu_modifier_groups SET status='INACTIVE',updated_at=? WHERE id=?",[now,row.id]);
  await execute("UPDATE menu_modifiers SET status='INACTIVE',updated_at=? WHERE group_id=?",[now,row.id]);
  await insertAuditLog(execute,{userId:req.user!.id,branchId:row.branch_id,action:'MENU_MODIFIER_GROUP_ARCHIVED',entityType:'MENU_MODIFIER_GROUP',entityId:row.id,oldValues:{status:row.status},newValues:{status:'INACTIVE'},req});
  res.json({success:true,message:'Modifier group archived. Historical order modifiers remain intact.'});
});

router.patch('/modifiers/:modifierId', requirePermission('menu.manage'), async(req,res)=>{
  const row = await queryOne<any>('SELECT mm.*,g.branch_id FROM menu_modifiers mm JOIN menu_modifier_groups g ON g.id=mm.group_id WHERE mm.id=?',[req.params.modifierId]);
  if(!row || !scopedBranch(req,row.branch_id)) return res.status(404).json({error:'NOT_FOUND',code:'MODIFIER_NOT_FOUND',message:'Modifier not found.',details:{}});
  const ru=String(req.body?.name_ru??row.name_ru).trim(), tk=String(req.body?.name_tk??row.name_tk).trim();
  const delta=validMoney(req.body?.price_delta??row.price_delta);
  const sort=validInt(req.body?.sort_order??row.sort_order,0);
  const status=String(req.body?.status??row.status).toUpperCase();
  if(!ru||!tk||delta===null||sort===null||!['ACTIVE','INACTIVE'].includes(status))
    return res.status(400).json({error:'VALIDATION_ERROR',code:'INVALID_MODIFIER',message:'Bilingual modifier names and a precise price_delta are required.',details:{}});
  const now=new Date().toISOString();
  await execute('UPDATE menu_modifiers SET name_ru=?,name_tk=?,price_delta=CAST(? AS numeric),sort_order=?,status=?,updated_at=? WHERE id=?',[ru,tk,delta,sort,status,now,row.id]);
  await insertAuditLog(execute,{userId:req.user!.id,branchId:row.branch_id,action:'MENU_MODIFIER_UPDATED',entityType:'MENU_MODIFIER',entityId:row.id,oldValues:{name_ru:row.name_ru,name_tk:row.name_tk,price_delta:String(row.price_delta),status:row.status},newValues:{name_ru:ru,name_tk:tk,price_delta:delta,status},req});
  res.json({modifier:await queryOne<any>('SELECT * FROM menu_modifiers WHERE id=?',[row.id])});
});

router.delete('/modifiers/:modifierId', requirePermission('menu.manage'), async(req,res)=>{
  const row = await queryOne<any>('SELECT mm.*,g.branch_id FROM menu_modifiers mm JOIN menu_modifier_groups g ON g.id=mm.group_id WHERE mm.id=?',[req.params.modifierId]);
  if(!row || !scopedBranch(req,row.branch_id)) return res.status(404).json({error:'NOT_FOUND',code:'MODIFIER_NOT_FOUND',message:'Modifier not found.',details:{}});
  const now=new Date().toISOString();
  await execute("UPDATE menu_modifiers SET status='INACTIVE',updated_at=? WHERE id=?",[now,row.id]);
  await insertAuditLog(execute,{userId:req.user!.id,branchId:row.branch_id,action:'MENU_MODIFIER_ARCHIVED',entityType:'MENU_MODIFIER',entityId:row.id,oldValues:{status:row.status},newValues:{status:'INACTIVE'},req});
  res.json({success:true,message:'Modifier archived. Historical order modifiers remain intact.'});
});


router.delete('/items/:id', requirePermission('menu.manage'), async (req,res) => {
  const row=await queryOne<any>('SELECT * FROM menu_items WHERE id=? AND deleted_at IS NULL',[req.params.id]);
  if(!row || !scopedBranch(req,row.branch_id||req.user!.branch_id||'')) return res.status(404).json({error:'NOT_FOUND',code:'MENU_ITEM_NOT_FOUND',message:'Menu item not found.',details:{}});
  const now=new Date().toISOString();
  await execute("UPDATE menu_items SET deleted_at=?, status='INACTIVE', updated_at=? WHERE id=? AND deleted_at IS NULL",[now,now,row.id]);
  await insertAuditLog(execute,{userId:req.user!.id,branchId:row.branch_id,action:'MENU_ITEM_DELETED',entityType:'MENU_ITEM',entityId:row.id,oldValues:{name_ru:row.name_ru,name_tk:row.name_tk,price:String(row.price),status:row.status},newValues:{status:'INACTIVE',deleted_at:now},req});
  res.json({success:true,message:'Menu item archived. Historical orders remain intact.'});
});

router.delete('/categories/:id', requirePermission('menu.manage'), async (req,res) => {
  const row=await queryOne<any>('SELECT * FROM menu_categories WHERE id=? AND deleted_at IS NULL',[req.params.id]);
  if(!row || !scopedBranch(req,row.branch_id||req.user!.branch_id||'')) return res.status(404).json({error:'NOT_FOUND',code:'MENU_CATEGORY_NOT_FOUND',message:'Menu category not found.',details:{}});
  const activeItems=await queryOne<any>("SELECT COUNT(*)::int AS count FROM menu_items WHERE category_id=? AND deleted_at IS NULL AND status='ACTIVE'",[row.id]);
  if(Number(activeItems?.count||0)>0) return res.status(409).json({error:'CATEGORY_HAS_ACTIVE_ITEMS',code:'CATEGORY_HAS_ACTIVE_ITEMS',message:'Archive active menu items before archiving this category.',details:{active_items:Number(activeItems.count)}});
  const now=new Date().toISOString();
  await execute("UPDATE menu_categories SET deleted_at=?, status='INACTIVE', updated_at=? WHERE id=? AND deleted_at IS NULL",[now,now,row.id]);
  await insertAuditLog(execute,{userId:req.user!.id,branchId:row.branch_id,action:'MENU_CATEGORY_DELETED',entityType:'MENU_CATEGORY',entityId:row.id,oldValues:{name_ru:row.name_ru,name_tk:row.name_tk,status:row.status},newValues:{status:'INACTIVE',deleted_at:now},req});
  res.json({success:true,message:'Menu category archived.'});
});

export default router;
