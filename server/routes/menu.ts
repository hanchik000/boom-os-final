import { Router, Request, Response } from 'express';
import crypto from 'node:crypto';
import { query, queryOne, execute, transaction } from '../db';
import { authenticateToken, requirePermission, insertAuditLog } from '../auth';
import { getWaiterSession } from './waiters';

const router = Router();
function validInt(v: unknown, fallback = 0) { const n = Number(v ?? fallback); return Number.isInteger(n) && n >= 0 ? n : null; }
function validMoney(v: unknown) { const x = String(v ?? '').trim(); return /^\d+(?:\.\d{1,2})?$/.test(x) ? x : null; }

// -----------------------------------------------------------------------------------------------
// Stage 37 -- shared menu-domain helpers.
// -----------------------------------------------------------------------------------------------

// Optional localized/free text: undefined means "caller did not send it, keep what is there";
// an empty string means "clear it".
function optText(sent: unknown, current: any, max = 2000): string | null | undefined {
  if (sent === undefined) return undefined;
  if (sent === null) return null;
  const t = String(sent).trim();
  if (!t) return null;
  return t.slice(0, max);
}

// Structured portion weight. A number and a unit, never a formatted string -- either BOTH are
// supplied or the weight is cleared, so a dish can never carry a value with no unit.
const WEIGHT_UNITS = ['G', 'KG', 'ML', 'L', 'PCS'];
function parseWeight(body: any, row: any): { value: string | null; unit: string | null } | null {
  const sentValue = body?.weight_value !== undefined;
  const sentUnit = body?.weight_unit !== undefined;
  if (!sentValue && !sentUnit) return { value: row?.weight_value ?? null, unit: row?.weight_unit ?? null };
  const rawValue = sentValue ? body.weight_value : row?.weight_value;
  const rawUnit = sentUnit ? body.weight_unit : row?.weight_unit;
  if (rawValue === null || rawValue === '' || rawValue === undefined) return { value: null, unit: null };
  const n = Number(rawValue);
  if (!Number.isFinite(n) || n <= 0 || n > 100000) return null;
  const unit = String(rawUnit || '').toUpperCase();
  if (!WEIGHT_UNITS.includes(unit)) return null;
  return { value: n.toFixed(3), unit };
}

// Allergen links. The caller sends the full set of allergen ids it wants; anything not in the
// list is unlinked. Unknown or inactive ids are rejected rather than silently dropped.
async function replaceAllergens(itemId: string, ids: unknown): Promise<string[] | null> {
  if (!Array.isArray(ids)) return null;
  const wanted = [...new Set(ids.map((x: any) => String(x)).filter(Boolean))].slice(0, 30);
  if (wanted.length) {
    const found = await query<any>(`SELECT id FROM allergens WHERE id IN (${wanted.map(() => '?').join(',')}) AND active=true`, wanted);
    if (found.length !== wanted.length) return null;
  }
  await execute('DELETE FROM menu_item_allergens WHERE menu_item_id=?', [itemId]);
  const now = new Date().toISOString();
  for (const a of wanted) {
    await execute('INSERT INTO menu_item_allergens (id,menu_item_id,allergen_id,created_at) VALUES (?,?,?,?) ON CONFLICT DO NOTHING', [`mia_${crypto.randomUUID()}`, itemId, a, now]);
  }
  return wanted;
}

// Gallery links. Same contract as allergens: the caller sends the whole ordered set. Each asset
// must exist, be active and be inside the caller's branch scope -- the exact rule the Stage 36
// primary-photo attach already applies, so a gallery cannot be used to borrow another branch's
// media. Returns null for "not sent", false for "rejected".
async function replaceGallery(req: Request, itemId: string, ids: unknown): Promise<string[] | null | false> {
  if (!Array.isArray(ids)) return null;
  const wanted = [...new Set(ids.map((x: any) => String(x)).filter(Boolean))].slice(0, 24);
  for (const assetId of wanted) {
    const asset = await queryOne<any>('SELECT id,branch_id FROM media_assets WHERE id=? AND active=true', [assetId]);
    if (!asset) return false;
    if (asset.branch_id && !scopedBranch(req, asset.branch_id)) return false;
  }
  await execute('DELETE FROM menu_item_media WHERE menu_item_id=?', [itemId]);
  const now = new Date().toISOString();
  for (let i = 0; i < wanted.length; i++) {
    await execute('INSERT INTO menu_item_media (id,menu_item_id,media_asset_id,sort_order,created_at) VALUES (?,?,?,?,?) ON CONFLICT DO NOTHING', [`mim_${crypto.randomUUID()}`, itemId, wanted[i], i, now]);
  }
  return wanted;
}

// The public-safe media columns, selected the same way everywhere so no surface can accidentally
// widen what a guest sees.
const GALLERY_SELECT = `SELECT mim.menu_item_id, mim.sort_order, m.id, m.url, m.kind, m.mime_type, m.poster_url, m.alt_ru, m.alt_tk, m.focal_x, m.focal_y
  FROM menu_item_media mim JOIN media_assets m ON m.id=mim.media_asset_id AND m.active=true`;

// Attach allergens and gallery to a list of dish rows in two queries, never N+1.
async function decorateItems(items: any[]): Promise<any[]> {
  if (!items.length) return items;
  const ids = items.map(i => i.id);
  const ph = ids.map(() => '?').join(',');
  const allergens = await query<any>(`SELECT mia.menu_item_id, a.id, a.code, a.label_ru, a.label_tk, a.label_en, a.sort_order
    FROM menu_item_allergens mia JOIN allergens a ON a.id=mia.allergen_id AND a.active=true
    WHERE mia.menu_item_id IN (${ph}) ORDER BY a.sort_order`, ids);
  const gallery = await query<any>(`${GALLERY_SELECT} WHERE mim.menu_item_id IN (${ph}) ORDER BY mim.sort_order`, ids);
  const byItem = <T extends { menu_item_id: string }>(rows: T[]) => {
    const map = new Map<string, T[]>();
    for (const r of rows) { if (!map.has(r.menu_item_id)) map.set(r.menu_item_id, []); map.get(r.menu_item_id)!.push(r); }
    return map;
  };
  const aMap = byItem(allergens), gMap = byItem(gallery);
  for (const it of items) { it.allergens = aMap.get(it.id) || []; it.gallery = gMap.get(it.id) || []; }
  return items;
}
router.get('/pos', async (req,res)=>{
  const session=await getWaiterSession(req);
  if(!session){res.status(401).json({error:'WAITER_SESSION_INVALID',code:'WAITER_SESSION_INVALID',message:'Valid Waiter POS session required.',details:{}});return;}
  const categories=await query<any>("SELECT id,name_ru,name_tk,sort_order,status FROM menu_categories WHERE (branch_id=? OR branch_id IS NULL) AND status='ACTIVE' AND deleted_at IS NULL ORDER BY sort_order,name_ru",[session.branch_id]);
  // Stage 36: the waiter POS reads the dish photo from the SAME media asset the admin attached.
  const items=await query<any>(`SELECT mi.id,mi.category_id,mi.sku,mi.name_ru,mi.name_tk,mi.name_en,mi.description_ru,mi.description_tk,mi.description_en,mi.price,mi.status,mi.sort_order,
      mi.weight_value,mi.weight_unit,mi.ingredients_ru,mi.ingredients_tk,mi.ingredients_en,
      m.url AS media_url,m.kind AS media_kind,m.poster_url AS media_poster_url,m.focal_x AS media_focal_x,m.focal_y AS media_focal_y
    FROM menu_items mi LEFT JOIN media_assets m ON m.id=mi.media_asset_id AND m.active=true
    WHERE (mi.branch_id=? OR mi.branch_id IS NULL) AND mi.status='ACTIVE' AND mi.deleted_at IS NULL ORDER BY mi.sort_order,mi.name_ru`,[session.branch_id]);
  // Stage 37 -- THE WAITER POS MODIFIER FIX.
  //
  // The Waiter POS used to fetch modifiers from /api/menu/items/:id/modifiers, which is a JWT
  // route. A waiter device holds only a device session, so that call ALWAYS failed, the POS
  // swallowed the error, and the burger was added with NO components at all -- the Burger
  // Constructor was silently dead on the one surface that takes the order. The device menu now
  // carries the groups with the dishes: same tables, same branch scope, one round trip, and the
  // POS never has to guess. Prices still mean nothing here -- Order Core reprices from these same
  // rows when the order is created.
  const groupRows = items.length ? await query<any>(`SELECT id,menu_item_id,name_ru,name_tk,name_en,min_select,max_select,required,sort_order
      FROM menu_modifier_groups WHERE branch_id=? AND status='ACTIVE' AND menu_item_id IN (${items.map(()=>'?').join(',')}) ORDER BY sort_order,name_ru`,
      [session.branch_id, ...items.map((i:any)=>i.id)]) : [];
  // Stage 38: same rule on the waiter device -- an option whose source dish is archived is not
  // offered, because Order Core would refuse it (MODIFIER_SOURCE_UNAVAILABLE).
  const modRows = groupRows.length ? await query<any>(`SELECT mm.id,mm.group_id,mm.name_ru,mm.name_tk,mm.name_en,mm.price_delta,mm.sort_order,mm.source_menu_item_id
      FROM menu_modifiers mm
      LEFT JOIN menu_items src ON src.id=mm.source_menu_item_id
        WHERE mm.status='ACTIVE' AND (mm.source_menu_item_id IS NULL OR (src.status='ACTIVE' AND src.deleted_at IS NULL)) AND mm.group_id IN (${groupRows.map(()=>'?').join(',')}) ORDER BY mm.sort_order,mm.name_ru`,
      groupRows.map((g:any)=>g.id)) : [];
  const modsByGroup = new Map<string, any[]>();
  for (const m of modRows) { if(!modsByGroup.has(m.group_id)) modsByGroup.set(m.group_id, []); modsByGroup.get(m.group_id)!.push(m); }
  const groupsByItem = new Map<string, any[]>();
  for (const g of groupRows) { const row = { ...g, modifiers: modsByGroup.get(g.id) || [] }; if(!groupsByItem.has(g.menu_item_id)) groupsByItem.set(g.menu_item_id, []); groupsByItem.get(g.menu_item_id)!.push(row); }
  for (const it of items) it.modifier_groups = groupsByItem.get(it.id) || [];
  await decorateItems(items);
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
  const categories = await query<any>(`SELECT id,branch_id,name_ru,name_tk,name_en,sort_order,status,deleted_at FROM menu_categories WHERE (branch_id=? OR branch_id IS NULL)${catFilter} ORDER BY sort_order,name_ru`,[branchId]);
  // Stage 36: dish media comes from the ONE existing media_assets table via a LEFT JOIN -- the
  // admin, the waiter POS and the customer menu all read this same asset row.
  const items = await query<any>(`SELECT mi.id,mi.branch_id,mi.category_id,mi.sku,mi.name_ru,mi.name_tk,mi.name_en,mi.description_ru,mi.description_tk,mi.description_en,mi.ingredients_ru,mi.ingredients_tk,mi.ingredients_en,mi.weight_value,mi.weight_unit,mi.price,mi.status,mi.sort_order,mi.deleted_at,mi.media_asset_id,
      m.url AS media_url,m.kind AS media_kind,m.poster_url AS media_poster_url,m.alt_ru AS media_alt_ru,m.alt_tk AS media_alt_tk,m.focal_x AS media_focal_x,m.focal_y AS media_focal_y
    FROM menu_items mi LEFT JOIN media_assets m ON m.id=mi.media_asset_id
    WHERE (mi.branch_id=? OR mi.branch_id IS NULL)${itemFilter} ORDER BY mi.sort_order,mi.name_ru`,[branchId]);
  await decorateItems(items);
  res.json({ branch_id: branchId, categories, items });
});

// Stage 37: the allergen reference list. A read-only regulated set (seeded, see server/seed.ts) --
// ADMIN links dishes to these, it does not invent new ones, so there is deliberately no CRUD here.
router.get('/allergens', requirePermission('menu.view'), async (_req, res) => {
  const allergens = await query<any>('SELECT id,code,label_ru,label_tk,label_en,sort_order FROM allergens WHERE active=true ORDER BY sort_order,code');
  res.json({ allergens });
});

router.post('/categories', requirePermission('menu.manage'), async (req,res) => {
  const branchId = scopedBranch(req, String(req.body?.branch_id || ''));
  if (!branchId) { res.status(403).json({ error:'BRANCH_ACCESS_DENIED', code:'BRANCH_ACCESS_DENIED', message:'Branch is outside your access scope.', details:{} }); return; }
  const nameRu=String(req.body?.name_ru||'').trim(), nameTk=String(req.body?.name_tk||'').trim();
  if(!nameRu||!nameTk){res.status(400).json({error:'VALIDATION_ERROR',code:'CATEGORY_NAME_REQUIRED',message:'Russian and Turkmen category names are required.',details:{}});return;}
  const now=new Date().toISOString(), id=`mcat_${crypto.randomUUID()}`;
  await execute('INSERT INTO menu_categories (id,branch_id,name_ru,name_tk,name_en,sort_order,status,created_at,updated_at) VALUES (?,?,?,?,?,?,\'ACTIVE\',?,?)',[id,branchId,nameRu,nameTk,optText(req.body?.name_en,null)??null,Number(req.body?.sort_order||0),now,now]);
  res.status(201).json({category:await queryOne<any>('SELECT * FROM menu_categories WHERE id=? AND deleted_at IS NULL',[id])});
});

router.post('/items', requirePermission('menu.manage'), async (req,res) => {
  const branchId = scopedBranch(req, String(req.body?.branch_id || ''));
  const categoryId=String(req.body?.category_id||''); const sku=String(req.body?.sku||'').trim().toUpperCase();
  const nameRu=String(req.body?.name_ru||'').trim(), nameTk=String(req.body?.name_tk||'').trim(); const price=String(req.body?.price||'').trim();
  if(!branchId||!categoryId||!sku||!nameRu||!nameTk||!/^[0-9]+(?:\.[0-9]{1,2})?$/.test(price)){res.status(400).json({error:'VALIDATION_ERROR',code:'INVALID_MENU_ITEM',message:'branch_id, category_id, sku, bilingual names and a precise decimal price are required.',details:{}});return;}
  const category=await queryOne<any>('SELECT id FROM menu_categories WHERE id=? AND (branch_id=? OR branch_id IS NULL) AND status=\'ACTIVE\'',[categoryId,branchId]);
  if(!category){res.status(404).json({error:'NOT_FOUND',code:'MENU_CATEGORY_NOT_FOUND',message:'Menu category not found for this branch.',details:{}});return;}
  // Stage 37: the public-information fields. Weight is structured (number + unit) and rejected
  // outright if it is half-supplied, so a dish can never carry a number with no unit.
  const weight = parseWeight(req.body, null);
  if (weight === null) { res.status(400).json({error:'VALIDATION_ERROR',code:'INVALID_DISH_WEIGHT',message:'weight_value must be a positive number and weight_unit one of G, KG, ML, L, PCS.',details:{}}); return; }
  const id=`mit_${crypto.randomUUID()}`,now=new Date().toISOString();
  try { await execute('INSERT INTO menu_items (id,branch_id,category_id,sku,name_ru,name_tk,name_en,description_ru,description_tk,description_en,ingredients_ru,ingredients_tk,ingredients_en,weight_value,weight_unit,price,status,sort_order,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,CAST(? AS numeric),?,CAST(? AS numeric),\'ACTIVE\',?,?,?)',[id,branchId,categoryId,sku,nameRu,nameTk,optText(req.body?.name_en,null)??null,optText(req.body?.description_ru,null)??null,optText(req.body?.description_tk,null)??null,optText(req.body?.description_en,null)??null,optText(req.body?.ingredients_ru,null)??null,optText(req.body?.ingredients_tk,null)??null,optText(req.body?.ingredients_en,null)??null,weight.value,weight.unit,price,Number(req.body?.sort_order||0),now,now]); }
  catch(e:any){ if(String(e.message).toLowerCase().includes('unique')){res.status(409).json({error:'CONFLICT',code:'MENU_SKU_IN_USE',message:'SKU is already assigned.',details:{sku}});return;} throw e; }
  if (Array.isArray(req.body?.allergen_ids) && await replaceAllergens(id, req.body.allergen_ids) === null) {
    res.status(400).json({error:'VALIDATION_ERROR',code:'INVALID_ALLERGEN',message:'One or more allergen ids are unknown or inactive.',details:{}}); return;
  }
  await insertAuditLog(execute,{userId:req.user!.id,branchId,action:'MENU_ITEM_CREATED',entityType:'MENU_ITEM',entityId:id,newValues:{sku,name_ru:nameRu,price,weight_value:weight.value,weight_unit:weight.unit},req});
  const created=await queryOne<any>('SELECT * FROM menu_items WHERE id=? AND deleted_at IS NULL',[id]);
  await decorateItems([created]);
  res.status(201).json({item:created});
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
  const modifierFilter = withArchived ? '' : " AND mm.status='ACTIVE'";
  const groups=await query<any>(`SELECT id,name_ru,name_tk,name_en,min_select,max_select,required,sort_order,status FROM menu_modifier_groups WHERE menu_item_id=? AND branch_id=?${groupFilter} ORDER BY sort_order,name_ru`,[item.id,branchId]);
  for(const g of groups){
    // Stage 37: an option can be backed by a real Menu Engine item, so the constructor can show
    // which dish a component actually is. Read-only here -- the link itself is set on write.
    g.modifiers=await query<any>(`SELECT mm.id,mm.name_ru,mm.name_tk,mm.name_en,mm.price_delta,mm.sort_order,mm.status,mm.source_menu_item_id,
        src.name_ru AS source_name_ru,src.sku AS source_sku
      FROM menu_modifiers mm LEFT JOIN menu_items src ON src.id=mm.source_menu_item_id
      WHERE mm.group_id=?${modifierFilter} ORDER BY mm.sort_order,mm.name_ru`,[g.id]);
  }
  res.json({item,groups});
});

router.post('/items/:itemId/modifier-groups', requirePermission('menu.manage'), async(req,res)=>{
  const branchId=scopedBranch(req, String(req.body?.branch_id||'')); if(!branchId) return res.status(403).json({error:'BRANCH_ACCESS_DENIED',code:'BRANCH_ACCESS_DENIED',message:'Branch is outside your access scope.',details:{}});
  const item=await queryOne<any>(`SELECT id FROM menu_items WHERE id=? AND branch_id=? AND status='ACTIVE'`,[req.params.itemId,branchId]); if(!item) return res.status(404).json({error:'NOT_FOUND',code:'MENU_ITEM_NOT_FOUND',message:'Menu item not found for this branch.',details:{}});
  const nameRu=String(req.body?.name_ru||'').trim(), nameTk=String(req.body?.name_tk||'').trim(), min=validInt(req.body?.min_select), max=validInt(req.body?.max_select,1), required=Boolean(req.body?.required);
  if(!nameRu||!nameTk||min===null||max===null||min>max||max>50|| (required && min<1)) return res.status(400).json({error:'VALIDATION_ERROR',code:'INVALID_MODIFIER_GROUP',message:'Modifier group names and valid selection bounds are required.',details:{}});
  const id=`mmg_${crypto.randomUUID()}`,now=new Date().toISOString();
  await execute(`INSERT INTO menu_modifier_groups (id,branch_id,menu_item_id,name_ru,name_tk,name_en,min_select,max_select,required,sort_order,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,'ACTIVE',?,?)`,[id,branchId,item.id,nameRu,nameTk,optText(req.body?.name_en,null)??null,min,max,required,validInt(req.body?.sort_order,0),now,now]);
  await insertAuditLog(execute,{userId:req.user!.id,branchId,action:'MENU_MODIFIER_GROUP_CREATED',entityType:'MENU_MODIFIER_GROUP',entityId:id,newValues:{menu_item_id:item.id,name_ru:nameRu,min_select:min,max_select:max,required},req});
  res.status(201).json({group:await queryOne<any>('SELECT * FROM menu_modifier_groups WHERE id=?',[id])});
});

router.post('/modifier-groups/:groupId/modifiers', requirePermission('menu.manage'), async(req,res)=>{
  const nameRu=String(req.body?.name_ru||'').trim(), nameTk=String(req.body?.name_tk||'').trim(), delta=validMoney(req.body?.price_delta ?? '0');
  const group=await queryOne<any>(`SELECT g.id,g.branch_id FROM menu_modifier_groups g WHERE g.id=? AND g.status='ACTIVE'`,[req.params.groupId]);
  if(!group||!scopedBranch(req,group.branch_id)) return res.status(404).json({error:'NOT_FOUND',code:'MODIFIER_GROUP_NOT_FOUND',message:'Modifier group not found.',details:{}});
  if(!nameRu||!nameTk||delta===null) return res.status(400).json({error:'VALIDATION_ERROR',code:'INVALID_MODIFIER',message:'Bilingual modifier names and precise price_delta are required.',details:{}});
  const source = await resolveSourceItem(req, group.branch_id, req.body?.source_menu_item_id);
  if (source === false) return res.status(404).json({error:'NOT_FOUND',code:'MODIFIER_SOURCE_ITEM_NOT_FOUND',message:'The source menu item does not exist in this branch.',details:{}});
  const id=`mm_${crypto.randomUUID()}`,now=new Date().toISOString();
  await execute(`INSERT INTO menu_modifiers (id,group_id,name_ru,name_tk,name_en,source_menu_item_id,price_delta,sort_order,status,created_at,updated_at) VALUES (?,?,?,?,?,?,CAST(? AS numeric),?,'ACTIVE',?,?)`,[id,group.id,nameRu,nameTk,optText(req.body?.name_en,null)??null,source===undefined?null:source,delta,validInt(req.body?.sort_order,0),now,now]);
  await insertAuditLog(execute,{userId:req.user!.id,branchId:group.branch_id,action:'MENU_MODIFIER_CREATED',entityType:'MENU_MODIFIER',entityId:id,newValues:{group_id:group.id,name_ru:nameRu,price_delta:delta},req});
  res.status(201).json({modifier:await queryOne<any>('SELECT * FROM menu_modifiers WHERE id=?',[id])});
});

router.patch('/categories/:id', requirePermission('menu.manage'), async(req,res)=>{
  const row=await queryOne<any>('SELECT * FROM menu_categories WHERE id=? AND deleted_at IS NULL',[req.params.id]); if(!row||(!row.branch_id && !req.user?.isSuperUser)||!scopedBranch(req,row.branch_id||req.user!.branch_id||'')) return res.status(404).json({error:'NOT_FOUND',code:'MENU_CATEGORY_NOT_FOUND',message:'Menu category not found.',details:{}});
  const ru=String(req.body?.name_ru??row.name_ru).trim(),tk=String(req.body?.name_tk??row.name_tk).trim(),status=String(req.body?.status??row.status).toUpperCase(); const sort=validInt(req.body?.sort_order,row.sort_order);
  if(!ru||!tk||sort===null||!['ACTIVE','INACTIVE'].includes(status)) return res.status(400).json({error:'VALIDATION_ERROR',code:'INVALID_CATEGORY_UPDATE',message:'Invalid category update.',details:{}});
  const nameEn=req.body?.name_en===undefined?row.name_en:(optText(req.body.name_en,row.name_en)??null);
  const now=new Date().toISOString(); await execute('UPDATE menu_categories SET name_ru=?,name_tk=?,name_en=?,sort_order=?,status=?,updated_at=? WHERE id=?',[ru,tk,nameEn,sort,status,now,row.id]);
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
  // Stage 37 public-information fields. Each is only touched when the caller actually sends it,
  // so every pre-Stage-37 caller keeps its exact behaviour.
  const keep = (sent: unknown, current: any) => { const v = optText(sent, current); return v === undefined ? current : v; };
  const weight = parseWeight(req.body, row);
  if (weight === null) return res.status(400).json({error:'VALIDATION_ERROR',code:'INVALID_DISH_WEIGHT',message:'weight_value must be a positive number and weight_unit one of G, KG, ML, L, PCS.',details:{}});
  const nameEn = keep(req.body?.name_en, row.name_en);
  const descRu = keep(req.body?.description_ru, row.description_ru);
  const descTk = keep(req.body?.description_tk, row.description_tk);
  const descEn = keep(req.body?.description_en, row.description_en);
  const ingRu = keep(req.body?.ingredients_ru, row.ingredients_ru);
  const ingTk = keep(req.body?.ingredients_tk, row.ingredients_tk);
  const ingEn = keep(req.body?.ingredients_en, row.ingredients_en);

  // Allergens and gallery are replace-the-whole-set operations, validated BEFORE the dish row is
  // written so a rejected link never leaves a half-applied update behind.
  if (req.body?.allergen_ids !== undefined && await replaceAllergens(row.id, req.body.allergen_ids) === null) {
    return res.status(400).json({error:'VALIDATION_ERROR',code:'INVALID_ALLERGEN',message:'One or more allergen ids are unknown or inactive.',details:{}});
  }
  if (req.body?.gallery_media_ids !== undefined) {
    const g = await replaceGallery(req, row.id, req.body.gallery_media_ids);
    if (g === false) return res.status(403).json({error:'BRANCH_ACCESS_DENIED',code:'BRANCH_ACCESS_DENIED',message:'A gallery asset is missing, inactive or outside your access scope.',details:{}});
  }

  const now=new Date().toISOString(); await execute('UPDATE menu_items SET name_ru=?,name_tk=?,name_en=?,description_ru=?,description_tk=?,description_en=?,ingredients_ru=?,ingredients_tk=?,ingredients_en=?,weight_value=CAST(? AS numeric),weight_unit=?,price=CAST(? AS numeric),sort_order=?,status=?,media_asset_id=?,updated_at=? WHERE id=?',[ru,tk,nameEn,descRu,descTk,descEn,ingRu,ingTk,ingEn,weight.value,weight.unit,price,sort,status,mediaAssetId,now,row.id]);
  await insertAuditLog(execute,{userId:req.user!.id,branchId:row.branch_id,action:'MENU_ITEM_UPDATED',entityType:'MENU_ITEM',entityId:row.id,oldValues:{name_ru:row.name_ru,name_tk:row.name_tk,name_en:row.name_en,price:String(row.price),status:row.status,media_asset_id:row.media_asset_id,weight_value:row.weight_value===null?null:String(row.weight_value),weight_unit:row.weight_unit},newValues:{name_ru:ru,name_tk:tk,name_en:nameEn,price,status,media_asset_id:mediaAssetId,weight_value:weight.value,weight_unit:weight.unit,allergen_ids:req.body?.allergen_ids,gallery_media_ids:req.body?.gallery_media_ids},req});
  const updated=await queryOne<any>('SELECT * FROM menu_items WHERE id=? AND deleted_at IS NULL',[row.id]);
  await decorateItems([updated]);
  res.json({item:updated});
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

// Stage 37: resolve `source_menu_item_id` on a modifier option. The source dish must be a real,
// live dish in the SAME branch scope -- an option cannot be pointed at another branch's menu.
// Returns undefined for "not sent", null for "cleared", false for "rejected".
async function resolveSourceItem(req: Request, branchId: string, sent: unknown): Promise<string | null | undefined | false> {
  if (sent === undefined) return undefined;
  if (sent === null || sent === '') return null;
  const src = await queryOne<any>(`SELECT id,branch_id FROM menu_items WHERE id=? AND status='ACTIVE' AND deleted_at IS NULL`, [String(sent)]);
  if (!src) return false;
  if (src.branch_id && src.branch_id !== branchId) return false;
  return src.id;
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
  const nameEn=req.body?.name_en===undefined?row.name_en:(optText(req.body.name_en,row.name_en)??null);
  const now=new Date().toISOString();
  await execute('UPDATE menu_modifier_groups SET name_ru=?,name_tk=?,name_en=?,min_select=?,max_select=?,required=?,sort_order=?,status=?,updated_at=? WHERE id=?',[ru,tk,nameEn,min,max,required,sort,status,now,row.id]);
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
  const nameEn=req.body?.name_en===undefined?row.name_en:(optText(req.body.name_en,row.name_en)??null);
  const source = await resolveSourceItem(req, row.branch_id, req.body?.source_menu_item_id);
  if (source === false) return res.status(404).json({error:'NOT_FOUND',code:'MODIFIER_SOURCE_ITEM_NOT_FOUND',message:'The source menu item does not exist in this branch.',details:{}});
  const sourceId = source === undefined ? row.source_menu_item_id : source;
  const now=new Date().toISOString();
  await execute('UPDATE menu_modifiers SET name_ru=?,name_tk=?,name_en=?,source_menu_item_id=?,price_delta=CAST(? AS numeric),sort_order=?,status=?,updated_at=? WHERE id=?',[ru,tk,nameEn,sourceId,delta,sort,status,now,row.id]);
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
