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
  const items=await query<any>("SELECT id,category_id,sku,name_ru,name_tk,description_ru,description_tk,price,status,sort_order FROM menu_items WHERE (branch_id=? OR branch_id IS NULL) AND status='ACTIVE' AND deleted_at IS NULL ORDER BY sort_order,name_ru",[session.branch_id]);
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
  const categories = await query<any>('SELECT id,name_ru,name_tk,sort_order,status FROM menu_categories WHERE (branch_id=? OR branch_id IS NULL) AND status=\'ACTIVE\' ORDER BY sort_order,name_ru',[branchId]);
  const items = await query<any>('SELECT id,category_id,sku,name_ru,name_tk,description_ru,description_tk,price,status,sort_order FROM menu_items WHERE (branch_id=? OR branch_id IS NULL) AND status=\'ACTIVE\' ORDER BY sort_order,name_ru',[branchId]);
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
  const groups=await query<any>(`SELECT * FROM menu_modifier_groups WHERE menu_item_id=? AND branch_id=? AND status='ACTIVE' AND EXISTS (SELECT 1 FROM menu_items mi WHERE mi.id=menu_item_id AND mi.deleted_at IS NULL) ORDER BY sort_order,name_ru`,[item.id,branchId]);
  for(const g of groups) g.modifiers=await query<any>(`SELECT * FROM menu_modifiers WHERE group_id=? AND status='ACTIVE' ORDER BY sort_order,name_ru`,[g.id]);
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
  const now=new Date().toISOString(); await execute('UPDATE menu_items SET name_ru=?,name_tk=?,description_ru=?,description_tk=?,price=CAST(? AS numeric),sort_order=?,status=?,updated_at=? WHERE id=?',[ru,tk,req.body?.description_ru??row.description_ru,req.body?.description_tk??row.description_tk,price,sort,status,now,row.id]);
  await insertAuditLog(execute,{userId:req.user!.id,branchId:row.branch_id,action:'MENU_ITEM_UPDATED',entityType:'MENU_ITEM',entityId:row.id,oldValues:{name_ru:row.name_ru,name_tk:row.name_tk,price:String(row.price),status:row.status},newValues:{name_ru:ru,name_tk:tk,price,status},req});
  res.json({item:await queryOne<any>('SELECT * FROM menu_items WHERE id=? AND deleted_at IS NULL',[row.id])});
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
