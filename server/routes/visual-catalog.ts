import { Router, Request, Response } from 'express';
import crypto from 'node:crypto';
import { query, queryOne, execute, transaction } from '../db';
import { authenticateToken, requirePermission, insertAuditLog } from '../auth';
import { activePromotionMap } from './promotions';
import { pickLang, loc, publicMenuExtras } from './public-menu';

const router = Router();
// Stage 39: the section vocabulary of the Customer Menu. MENU_ITEM (a featured dish), TEXT and
// MEDIA and CTA join the original six. Every one of them is a PRESENTATION section -- see
// REFERENCE_TYPES below for the rule that stops any of them holding business data.
const TYPES = ['HERO','CATEGORY','BANNER','PROMOTION','NEW_ITEMS','SPACER','MENU_ITEM','TEXT','MEDIA','CTA'];

// -------------------------------------------------------------------------------------------
// Stage 39 -- THE SOURCE-OF-TRUTH RULE, enforced by the server.
//
// A section that REFERENCES a Menu Engine entity may not also carry a copy of that entity's
// presentational business data. A MENU_ITEM section stores a menu_item_id and nothing else about
// the dish; its name, description, price, photo and availability are read live from the Menu
// Engine when the guest menu is rendered. The same holds for CATEGORY and PROMOTION sections.
//
// Without this, a manager could set a block title to "Classic Burger 90" while the Menu Engine
// says 95, and the guest menu would have two disagreeing prices. There is deliberately no price
// column on this table at all, and these writes are refused rather than silently ignored.
// -------------------------------------------------------------------------------------------
const REFERENCE_TYPES = ['MENU_ITEM','CATEGORY','PROMOTION'];
const REFERENCE_OWNED_FIELDS = ['title_ru','title_tk','title_en','subtitle_ru','subtitle_tk','subtitle_en','media_url','media_kind','media_asset_id'];

// Appearance presets. Each is a closed set validated here, so an administrator can never store a
// class name, a style string or any markup -- only one of these identifiers.
const PRESETS: Record<string, string[]> = {
  card_style:  ['STANDARD','PREMIUM','COMPACT','IMAGE_FIRST'],
  density:     ['COMPACT','NORMAL','SPACIOUS'],
  image_ratio: ['SQUARE','PORTRAIT','LANDSCAPE','WIDE','AUTO'],
  overlay:     ['NONE','SOFT','STRONG'],
  alignment:   ['LEFT','CENTER'],
};
const DESIGN_PRESETS: Record<string, string[]> = {
  theme:       ['MIDNIGHT','GRAPHITE','CHARCOAL'],
  accent:      ['GOLD','AMBER','COPPER','IVORY'],
  typography:  ['EDITORIAL','COMPACT','DISPLAY'],
  card_style:  PRESETS.card_style,
  density:     PRESETS.density,
  radius:      ['SHARP','SOFT','ROUNDED'],
  image_ratio: PRESETS.image_ratio,
};

/** Validate the appearance presets on a block write. Returns the cleaned values, or null if any
 *  value is outside its closed set -- which is a 400, never a silent drop. */
function readPresets(body: any, row: any): Record<string, string | null> | null {
  const out: Record<string, string | null> = {};
  for (const key of Object.keys(PRESETS)) {
    if (body?.[key] === undefined) { out[key] = row?.[key] ?? null; continue; }
    if (body[key] === null || body[key] === '') { out[key] = null; continue; }
    const v = String(body[key]).toUpperCase();
    if (!PRESETS[key].includes(v)) return null;
    out[key] = v;
  }
  return out;
}

/** The source-of-truth guard. A reference section may not carry its entity's own content. */
function referenceConflict(type: string, body: any): string | null {
  if (!REFERENCE_TYPES.includes(type)) return null;
  for (const f of REFERENCE_OWNED_FIELDS) {
    const v = body?.[f];
    if (v !== undefined && v !== null && String(v).trim() !== '') return f;
  }
  return null;
}
const LINKS = ['NONE','CATEGORY','ITEM','PROMOTION','COLLECTION','EXTERNAL'];
// Stage 35.6: the four customer-menu channels. This is presentation/availability targeting ONLY --
// it never changes a price or a business rule, which is why it lives entirely in this read-model
// layer and touches nothing in the Order Core or Menu Engine.
const CHANNELS = ['ONLINE','QR','LOCAL','OFFLINE'];
const isAccessible = (req: Request, branchId: string | null) => !branchId || Boolean(req.user?.isSuperUser || req.user?.allowedBranchIds.includes(branchId));
const activeNow = (r: any) => { const n=Date.now(); return Boolean(r.active) && (!r.schedule_start || n >= new Date(r.schedule_start).getTime()) && (!r.schedule_end || n < new Date(r.schedule_end).getTime()); };
// A block with no channels set (NULL/empty) is visible on every channel -- the pre-35.6 default,
// so every block created before this stage keeps working unchanged.
const onChannel = (r: any, channel: string | null) => { if (!channel) return true; const list = String(r.channels||'').split(',').map((x:string)=>x.trim()).filter(Boolean); return !list.length || list.includes(channel); };
function scope(req: Request, branch?: string | null) { const id=branch || req.user?.branch_id || null; return id && isAccessible(req,id) ? id : null; }
// Accepts an array or a comma-separated string from the manager UI; unknown values are dropped
// rather than stored, so a typo can never silently hide a block from every channel.
function normalizeChannels(v: unknown): string | null {
  const list = Array.isArray(v) ? v : typeof v === 'string' ? v.split(',') : [];
  const clean = list.map((x: any) => String(x).trim().toUpperCase()).filter((x: string) => CHANNELS.includes(x));
  return clean.length ? [...new Set(clean)].join(',') : null;
}

router.get('/public', async (req,res) => {
  const branch=String(req.query.branch_id||'').trim();
  // Stage 37: the QR/visual guest surface shares the SAME language resolver and the SAME public
  // extras helper as /api/public/menu, so the two customer screens can never disagree about a
  // dish's translation, weight, allergens or selectable components.
  const lang=pickLang(req.query.lang);
  const channelRaw=String(req.query.channel||'').toUpperCase();
  const channel=CHANNELS.includes(channelRaw)?channelRaw:null;
  if(!branch) return res.status(400).json({error:'BRANCH_REQUIRED',message:'branch_id is required.'});
  const b=await queryOne<any>(`SELECT id,name,code,address,phone,currency FROM branches WHERE id=? AND status='ACTIVE'`,[branch]);
  if(!b) return res.status(404).json({error:'BRANCH_NOT_FOUND',message:'Branch not found.'});
  const categories=await query<any>(`SELECT id,name_ru,name_tk,name_en,sort_order FROM menu_categories WHERE (branch_id=? OR branch_id IS NULL) AND status='ACTIVE' AND deleted_at IS NULL ORDER BY sort_order,name_ru`,[branch]);
  // Stage 36: the dish photo attached in ADMIN, joined from the same media_assets row the plain
  // public menu reads -- the two customer surfaces can never show different photos.
  const itemRows=await query<any>(`SELECT mi.id,mi.category_id,mi.sku,mi.name_ru,mi.name_tk,mi.name_en,mi.description_ru,mi.description_tk,mi.description_en,mi.ingredients_ru,mi.ingredients_tk,mi.ingredients_en,mi.weight_value,mi.weight_unit,mi.price,mi.sort_order,
      md.url AS media_url,md.kind AS media_kind,md.poster_url AS media_poster_url,md.alt_ru AS media_alt_ru,md.alt_tk AS media_alt_tk,md.focal_x AS media_focal_x,md.focal_y AS media_focal_y
    FROM menu_items mi LEFT JOIN media_assets md ON md.id=mi.media_asset_id AND md.active=true
    WHERE (mi.branch_id=? OR mi.branch_id IS NULL) AND mi.status='ACTIVE' AND mi.deleted_at IS NULL ORDER BY mi.sort_order,mi.name_ru`,[branch]);
  // Stage 35.6: the real promotional price for every item that is genuinely inside an active
  // promotion window right now -- the SAME rule public-menu.ts uses, never a second computation.
  const promos=await activePromotionMap(branch, new Date().toISOString());
  const extra=await publicMenuExtras(branch, itemRows.map((x:any)=>x.id), lang);
  const items=itemRows.map((x:any)=>{ const promo=promos.get(x.id); return {...x,
    name: loc(x,'name',lang), description: loc(x,'description',lang), ingredients: loc(x,'ingredients',lang),
    weight_value: x.weight_value===null?null:String(x.weight_value), weight_unit: x.weight_unit||null,
    allergens: extra.allergens.get(x.id)||[], gallery: extra.gallery.get(x.id)||[], modifier_groups: extra.groups.get(x.id)||[],
    promo_price: promo?promo.promo_price:null, promo_badge: promo?(lang==='tk'?promo.badge_tk:promo.badge_ru):null, promo_ends_at: promo?promo.ends_at:null}; });
  const rows=await query<any>(`SELECT v.*,m.url AS asset_url,m.kind AS asset_kind,m.mime_type AS asset_mime_type,m.poster_url AS asset_poster_url,m.alt_ru AS asset_alt_ru,m.alt_tk AS asset_alt_tk,m.focal_x AS asset_focal_x,m.focal_y AS asset_focal_y FROM visual_catalog_blocks v LEFT JOIN media_assets m ON m.id=v.media_asset_id WHERE (v.branch_id=? OR v.branch_id IS NULL) AND v.active=true AND (v.media_asset_id IS NULL OR m.active=true) ORDER BY v.priority DESC,v.sort_order ASC,v.created_at DESC`,[branch]);
  // Stage 39: a section is either its OWN content (hero/banner/text) or a REFERENCE to a Menu
  // Engine entity. A reference section carries no title, price or photo of its own -- the guest
  // menu resolves it against `items`/`categories` above, which are the live Menu Engine rows. A
  // reference whose entity has since been archived simply drops out rather than rendering broken.
  const itemIds=new Set(items.map((i:any)=>i.id)); const categoryIds=new Set(categories.map((c:any)=>c.id));
  const blocks=rows.filter(activeNow).filter((r:any)=>onChannel(r,channel))
    .filter((r:any)=>{
      if(r.type==='MENU_ITEM') return Boolean(r.menu_item_id)&&itemIds.has(r.menu_item_id);
      if(r.type==='CATEGORY') return Boolean(r.category_id)&&categoryIds.has(r.category_id);
      return true;
    })
    .map((r:any)=>{
      const isReference=REFERENCE_TYPES.includes(r.type);
      return {
        id:r.id, type:r.type, sort_order:r.sort_order, priority:r.priority,
        link_type:r.link_type, category_id:r.category_id, menu_item_id:r.menu_item_id, external_url:r.external_url,
        // Appearance presets fall back to the page-level design when a section does not override it.
        card_style:r.card_style||null, density:r.density||null, image_ratio:r.image_ratio||null,
        overlay:r.overlay||null, alignment:r.alignment||null,
        // A reference section serves NO text or media of its own: null, every time, by construction.
        title:isReference?null:loc(r,'title',lang),
        subtitle:isReference?null:loc(r,'subtitle',lang),
        cta_label:isReference?null:loc(r,'cta_label',lang),
        media_url:isReference?null:(r.asset_url||r.media_url||null),
        media_kind:isReference?null:(r.asset_kind||r.media_kind||null),
        poster_url:isReference?null:(r.asset_poster_url||null),
        media_alt:isReference?null:((lang==='tk'?r.asset_alt_tk:r.asset_alt_ru)||null),
        focal_x:r.asset_focal_x??50, focal_y:r.asset_focal_y??50,
      };
    });
  res.json({branch,language:lang,channel,categories,items,blocks,design:await siteDesignFor(branch)});
});

router.use(authenticateToken);
router.get('/', requirePermission('visual_catalog.view'), async (req,res)=>{
  const branch=scope(req, typeof req.query.branch_id==='string'?req.query.branch_id:null);
  if(!branch) return res.status(403).json({error:'BRANCH_ACCESS_DENIED',message:'Branch is outside your access scope.'});
  const blocks=await query<any>(`SELECT v.*,m.url AS asset_url,m.kind AS asset_kind,m.mime_type AS asset_mime_type,m.poster_url AS asset_poster_url,m.alt_ru AS asset_alt_ru,m.alt_tk AS asset_alt_tk,m.focal_x AS asset_focal_x,m.focal_y AS asset_focal_y FROM visual_catalog_blocks v LEFT JOIN media_assets m ON m.id=v.media_asset_id WHERE (v.branch_id=? OR v.branch_id IS NULL) ORDER BY v.priority DESC,v.sort_order ASC,v.created_at DESC`,[branch]);
  const categories=await query<any>(`SELECT id,name_ru,name_tk,sort_order FROM menu_categories WHERE (branch_id=? OR branch_id IS NULL) AND status='ACTIVE' AND deleted_at IS NULL ORDER BY sort_order,name_ru`,[branch]);
  const items=await query<any>(`SELECT id,category_id,name_ru,name_tk,price FROM menu_items WHERE (branch_id=? OR branch_id IS NULL) AND status='ACTIVE' AND deleted_at IS NULL ORDER BY sort_order,name_ru`,[branch]);
  res.json({blocks,categories,items});
});

router.post('/', requirePermission('visual_catalog.manage'), async (req,res)=>{
  const branch=scope(req,String(req.body?.branch_id||''));
  const type=String(req.body?.type||'BANNER').toUpperCase(), link=String(req.body?.link_type||'NONE').toUpperCase();
  if(!branch||!TYPES.includes(type)||!LINKS.includes(link)) return res.status(400).json({error:'INVALID_VISUAL_BLOCK',message:'Invalid branch, block type or link type.'});
  if(link==='CATEGORY'&&!req.body?.category_id || link==='ITEM'&&!req.body?.menu_item_id || link==='EXTERNAL'&&!req.body?.external_url) return res.status(400).json({error:'LINK_TARGET_REQUIRED',message:'Selected link type requires a target.'});
  // Stage 39: a reference section must point at a real entity, and must not duplicate its content.
  if(type==='MENU_ITEM'&&!req.body?.menu_item_id) return res.status(400).json({error:'VALIDATION_ERROR',code:'BLOCK_REFERENCE_REQUIRED',message:'A MENU_ITEM section must reference a real menu item.'});
  if(type==='CATEGORY'&&!req.body?.category_id) return res.status(400).json({error:'VALIDATION_ERROR',code:'BLOCK_REFERENCE_REQUIRED',message:'A CATEGORY section must reference a real category.'});
  const conflict=referenceConflict(type,req.body);
  if(conflict) return res.status(400).json({error:'VALIDATION_ERROR',code:'BLOCK_DUPLICATES_MENU_DATA',message:`A ${type} section reads its content from the Menu Engine; it cannot carry its own ${conflict}.`,details:{field:conflict}});
  const presets=readPresets(req.body,null);
  if(!presets) return res.status(400).json({error:'VALIDATION_ERROR',code:'INVALID_DESIGN_PRESET',message:'An appearance preset is outside its allowed set.',details:{allowed:PRESETS}});
  const id=`vcb_${crypto.randomUUID()}`, now=new Date().toISOString();
  await execute(`INSERT INTO visual_catalog_blocks (id,branch_id,type,title_ru,title_tk,title_en,subtitle_ru,subtitle_tk,subtitle_en,cta_label_ru,cta_label_tk,cta_label_en,card_style,density,image_ratio,overlay,alignment,media_url,media_kind,media_asset_id,link_type,link_target,category_id,menu_item_id,external_url,sort_order,priority,active,schedule_start,schedule_end,channels,created_by,updated_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,[id,branch,type,req.body?.title_ru||null,req.body?.title_tk||null,req.body?.title_en||null,req.body?.subtitle_ru||null,req.body?.subtitle_tk||null,req.body?.subtitle_en||null,req.body?.cta_label_ru||null,req.body?.cta_label_tk||null,req.body?.cta_label_en||null,presets.card_style,presets.density,presets.image_ratio,presets.overlay,presets.alignment,req.body?.media_url||null,req.body?.media_kind||null,req.body?.media_asset_id||null,link,req.body?.link_target||null,req.body?.category_id||null,req.body?.menu_item_id||null,req.body?.external_url||null,Number(req.body?.sort_order||0),Number(req.body?.priority||0),req.body?.active!==false,req.body?.schedule_start||null,req.body?.schedule_end||null,normalizeChannels(req.body?.channels),req.user!.id,req.user!.id,now,now]);
  await insertAuditLog(execute,{userId:req.user!.id,branchId:branch,action:'VISUAL_CATALOG_BLOCK_CREATED',entityType:'VISUAL_CATALOG_BLOCK',entityId:id,newValues:req.body,req});
  res.status(201).json({block:await queryOne<any>('SELECT * FROM visual_catalog_blocks WHERE id=?',[id])});
});

router.patch('/:id', requirePermission('visual_catalog.manage'), async (req,res)=>{
  const row=await queryOne<any>('SELECT * FROM visual_catalog_blocks WHERE id=?',[req.params.id]); if(!row||!isAccessible(req,row.branch_id)) return res.status(404).json({error:'NOT_FOUND',message:'Visual catalog block not found.'});
  const n={...row,...req.body,updated_at:new Date().toISOString(),updated_by:req.user!.id};
  if(n.type&&!TYPES.includes(String(n.type).toUpperCase())||n.link_type&&!LINKS.includes(String(n.link_type).toUpperCase())) return res.status(400).json({error:'INVALID_VISUAL_BLOCK',message:'Invalid block type or link type.'});
  const channels = req.body?.channels !== undefined ? normalizeChannels(req.body.channels) : row.channels;
  // Stage 39: the same source-of-truth guard applies on edit. It is checked against the RESULTING
  // type, so a block cannot be converted to MENU_ITEM while keeping a duplicated title or photo.
  const finalType=String(n.type).toUpperCase();
  const conflict=referenceConflict(finalType,{...row,...req.body});
  if(conflict) return res.status(400).json({error:'VALIDATION_ERROR',code:'BLOCK_DUPLICATES_MENU_DATA',message:`A ${finalType} section reads its content from the Menu Engine; it cannot carry its own ${conflict}.`,details:{field:conflict}});
  const presets=readPresets(req.body,row);
  if(!presets) return res.status(400).json({error:'VALIDATION_ERROR',code:'INVALID_DESIGN_PRESET',message:'An appearance preset is outside its allowed set.',details:{allowed:PRESETS}});
  const keepText=(k:string)=>req.body?.[k]===undefined?(row[k]||null):(req.body[k]||null);
  await execute(`UPDATE visual_catalog_blocks SET type=?,title_ru=?,title_tk=?,title_en=?,subtitle_ru=?,subtitle_tk=?,subtitle_en=?,cta_label_ru=?,cta_label_tk=?,cta_label_en=?,card_style=?,density=?,image_ratio=?,overlay=?,alignment=?,media_url=?,media_kind=?,media_asset_id=?,link_type=?,link_target=?,category_id=?,menu_item_id=?,external_url=?,sort_order=?,priority=?,active=?,schedule_start=?,schedule_end=?,channels=?,updated_by=?,updated_at=? WHERE id=?`,[finalType,n.title_ru||null,n.title_tk||null,keepText('title_en'),n.subtitle_ru||null,n.subtitle_tk||null,keepText('subtitle_en'),keepText('cta_label_ru'),keepText('cta_label_tk'),keepText('cta_label_en'),presets.card_style,presets.density,presets.image_ratio,presets.overlay,presets.alignment,n.media_url||null,n.media_kind||null,n.media_asset_id||null,String(n.link_type).toUpperCase(),n.link_target||null,n.category_id||null,n.menu_item_id||null,n.external_url||null,Number(n.sort_order||0),Number(n.priority||0),Boolean(n.active),n.schedule_start||null,n.schedule_end||null,channels,n.updated_by,n.updated_at,row.id]);
  await insertAuditLog(execute,{userId:req.user!.id,branchId:row.branch_id,action:'VISUAL_CATALOG_BLOCK_UPDATED',entityType:'VISUAL_CATALOG_BLOCK',entityId:row.id,oldValues:row,newValues:n,req});
  res.json({block:await queryOne<any>('SELECT * FROM visual_catalog_blocks WHERE id=?',[row.id])});
});

router.delete('/:id', requirePermission('visual_catalog.manage'), async (req,res)=>{
  const row=await queryOne<any>('SELECT * FROM visual_catalog_blocks WHERE id=?',[req.params.id]); if(!row||!isAccessible(req,row.branch_id)) return res.status(404).json({error:'NOT_FOUND',message:'Visual catalog block not found.'});
  await execute('UPDATE visual_catalog_blocks SET active=false,updated_by=?,updated_at=? WHERE id=?',[req.user!.id,new Date().toISOString(),row.id]);
  await insertAuditLog(execute,{userId:req.user!.id,branchId:row.branch_id,action:'VISUAL_CATALOG_BLOCK_DEACTIVATED',entityType:'VISUAL_CATALOG_BLOCK',entityId:row.id,oldValues:{active:row.active},newValues:{active:false},req});
  res.json({success:true});
});
// -------------------------------------------------------------------------------------------
// Stage 39 -- section ordering, persisted server-side.
//
// The guest menu renders the order this table holds; the browser never decides it. The whole
// ordered list is sent at once so a reorder is one atomic intent rather than N racing PATCHes,
// and every id must belong to a branch the caller may touch.
// -------------------------------------------------------------------------------------------
router.post('/reorder', requirePermission('visual_catalog.manage'), async (req,res)=>{
  const branch=scope(req,String(req.body?.branch_id||''));
  if(!branch) return res.status(403).json({error:'BRANCH_ACCESS_DENIED',code:'BRANCH_ACCESS_DENIED',message:'Branch is outside your access scope.',details:{}});
  const ids=Array.isArray(req.body?.block_ids)?req.body.block_ids.map((x:any)=>String(x)).filter(Boolean):[];
  if(!ids.length||ids.length>200||new Set(ids).size!==ids.length) return res.status(400).json({error:'VALIDATION_ERROR',code:'INVALID_BLOCK_ORDER',message:'block_ids must be a unique, non-empty list.',details:{}});
  const rows=await query<any>(`SELECT id,branch_id FROM visual_catalog_blocks WHERE id IN (${ids.map(()=>'?').join(',')})`,ids);
  if(rows.length!==ids.length) return res.status(404).json({error:'NOT_FOUND',code:'VISUAL_CATALOG_BLOCK_NOT_FOUND',message:'One or more sections do not exist.',details:{}});
  // Every section must belong to THIS branch. A global (branch_id NULL) section is shared, so it
  // is not reorderable from a single branch's editor.
  if(rows.some((r:any)=>r.branch_id!==branch)) return res.status(403).json({error:'BRANCH_ACCESS_DENIED',code:'BRANCH_ACCESS_DENIED',message:'A section belongs to another branch.',details:{}});
  const now=new Date().toISOString();
  await transaction(async (tx)=>{
    for(let i=0;i<ids.length;i++) await tx.execute('UPDATE visual_catalog_blocks SET sort_order=?,priority=0,updated_by=?,updated_at=? WHERE id=? AND branch_id=?',[i,req.user!.id,now,ids[i],branch]);
    await insertAuditLog(tx.execute,{userId:req.user!.id,branchId:branch,action:'VISUAL_CATALOG_REORDERED',entityType:'VISUAL_CATALOG',entityId:branch,newValues:{block_ids:ids},req});
  });
  res.json({success:true,block_ids:ids});
});

// -------------------------------------------------------------------------------------------
// Stage 39 -- the page-level design of a branch's Customer Menu.
//
// Preset identifiers only, each validated against a closed set. There is no field here that can
// hold CSS, HTML or a script, so this editor cannot be used as an injection surface.
// -------------------------------------------------------------------------------------------
const DESIGN_DEFAULTS = { theme:'MIDNIGHT', accent:'GOLD', typography:'EDITORIAL', card_style:'STANDARD', density:'NORMAL', radius:'ROUNDED', image_ratio:'LANDSCAPE', show_hero:true };

export async function siteDesignFor(branchId: string) {
  const row = await queryOne<any>('SELECT * FROM site_designs WHERE branch_id=?',[branchId]);
  if (!row) return { ...DESIGN_DEFAULTS, branch_id: branchId };
  return { branch_id: branchId, theme:row.theme, accent:row.accent, typography:row.typography, card_style:row.card_style, density:row.density, radius:row.radius, image_ratio:row.image_ratio, show_hero:Boolean(row.show_hero) };
}

router.get('/design', requirePermission('visual_catalog.view'), async (req,res)=>{
  const branch=scope(req, typeof req.query.branch_id==='string'?req.query.branch_id:null);
  if(!branch) return res.status(403).json({error:'BRANCH_ACCESS_DENIED',code:'BRANCH_ACCESS_DENIED',message:'Branch is outside your access scope.',details:{}});
  res.json({design:await siteDesignFor(branch),presets:DESIGN_PRESETS});
});

router.put('/design', requirePermission('visual_catalog.manage'), async (req,res)=>{
  const branch=scope(req,String(req.body?.branch_id||''));
  if(!branch) return res.status(403).json({error:'BRANCH_ACCESS_DENIED',code:'BRANCH_ACCESS_DENIED',message:'Branch is outside your access scope.',details:{}});
  const current=await siteDesignFor(branch);
  const next:any={...current};
  for(const key of Object.keys(DESIGN_PRESETS)){
    if(req.body?.[key]===undefined) continue;
    const v=String(req.body[key]).toUpperCase();
    if(!DESIGN_PRESETS[key].includes(v)) return res.status(400).json({error:'VALIDATION_ERROR',code:'INVALID_DESIGN_PRESET',message:`${key} must be one of ${DESIGN_PRESETS[key].join(', ')}.`,details:{field:key,allowed:DESIGN_PRESETS[key]}});
    next[key]=v;
  }
  if(req.body?.show_hero!==undefined) next.show_hero=Boolean(req.body.show_hero);
  const now=new Date().toISOString();
  await execute(`INSERT INTO site_designs (id,branch_id,theme,accent,typography,card_style,density,radius,image_ratio,show_hero,updated_by,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT (branch_id) DO UPDATE SET theme=EXCLUDED.theme,accent=EXCLUDED.accent,typography=EXCLUDED.typography,card_style=EXCLUDED.card_style,density=EXCLUDED.density,radius=EXCLUDED.radius,image_ratio=EXCLUDED.image_ratio,show_hero=EXCLUDED.show_hero,updated_by=EXCLUDED.updated_by,updated_at=EXCLUDED.updated_at`,
    [`sdz_${crypto.randomUUID()}`,branch,next.theme,next.accent,next.typography,next.card_style,next.density,next.radius,next.image_ratio,next.show_hero,req.user!.id,now,now]);
  await insertAuditLog(execute,{userId:req.user!.id,branchId:branch,action:'SITE_DESIGN_UPDATED',entityType:'SITE_DESIGN',entityId:branch,oldValues:current,newValues:next,req});
  res.json({design:await siteDesignFor(branch)});
});

export default router;
