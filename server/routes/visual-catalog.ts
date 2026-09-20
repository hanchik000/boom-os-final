import { Router, Request, Response } from 'express';
import crypto from 'node:crypto';
import { query, queryOne, execute } from '../db';
import { authenticateToken, requirePermission, insertAuditLog } from '../auth';
import { activePromotionMap } from './promotions';

const router = Router();
const TYPES = ['HERO','CATEGORY','BANNER','PROMOTION','NEW_ITEMS','SPACER'];
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
  const branch=String(req.query.branch_id||'').trim(); const lang=String(req.query.lang||'ru')==='tk'?'tk':'ru';
  const channelRaw=String(req.query.channel||'').toUpperCase();
  const channel=CHANNELS.includes(channelRaw)?channelRaw:null;
  if(!branch) return res.status(400).json({error:'BRANCH_REQUIRED',message:'branch_id is required.'});
  const b=await queryOne<any>(`SELECT id,name,code,address,phone,currency FROM branches WHERE id=? AND status='ACTIVE'`,[branch]);
  if(!b) return res.status(404).json({error:'BRANCH_NOT_FOUND',message:'Branch not found.'});
  const categories=await query<any>(`SELECT id,name_ru,name_tk,sort_order FROM menu_categories WHERE (branch_id=? OR branch_id IS NULL) AND status='ACTIVE' AND deleted_at IS NULL ORDER BY sort_order,name_ru`,[branch]);
  // Stage 36: the dish photo attached in ADMIN, joined from the same media_assets row the plain
  // public menu reads -- the two customer surfaces can never show different photos.
  const itemRows=await query<any>(`SELECT mi.id,mi.category_id,mi.sku,mi.name_ru,mi.name_tk,mi.description_ru,mi.description_tk,mi.price,mi.sort_order,
      md.url AS media_url,md.kind AS media_kind,md.poster_url AS media_poster_url,md.alt_ru AS media_alt_ru,md.alt_tk AS media_alt_tk,md.focal_x AS media_focal_x,md.focal_y AS media_focal_y
    FROM menu_items mi LEFT JOIN media_assets md ON md.id=mi.media_asset_id AND md.active=true
    WHERE (mi.branch_id=? OR mi.branch_id IS NULL) AND mi.status='ACTIVE' AND mi.deleted_at IS NULL ORDER BY mi.sort_order,mi.name_ru`,[branch]);
  // Stage 35.6: the real promotional price for every item that is genuinely inside an active
  // promotion window right now -- the SAME rule public-menu.ts uses, never a second computation.
  const promos=await activePromotionMap(branch, new Date().toISOString());
  const items=itemRows.map((x:any)=>{ const promo=promos.get(x.id); return {...x, promo_price: promo?promo.promo_price:null, promo_badge: promo?(lang==='tk'?promo.badge_tk:promo.badge_ru):null, promo_ends_at: promo?promo.ends_at:null}; });
  const rows=await query<any>(`SELECT v.*,m.url AS asset_url,m.kind AS asset_kind,m.mime_type AS asset_mime_type,m.poster_url AS asset_poster_url,m.alt_ru AS asset_alt_ru,m.alt_tk AS asset_alt_tk,m.focal_x AS asset_focal_x,m.focal_y AS asset_focal_y FROM visual_catalog_blocks v LEFT JOIN media_assets m ON m.id=v.media_asset_id WHERE (v.branch_id=? OR v.branch_id IS NULL) AND v.active=true AND (v.media_asset_id IS NULL OR m.active=true) ORDER BY v.priority DESC,v.sort_order ASC,v.created_at DESC`,[branch]);
  const blocks=rows.filter(activeNow).filter((r:any)=>onChannel(r,channel)).map((r:any)=>({...r,title:lang==='tk'?r.title_tk:r.title_ru,subtitle:lang==='tk'?r.subtitle_tk:r.subtitle_ru,media_url:r.asset_url||r.media_url,media_kind:r.asset_kind||r.media_kind,poster_url:r.asset_poster_url||null,media_alt:lang==='tk'?r.asset_alt_tk:r.asset_alt_ru,focal_x:r.asset_focal_x??50,focal_y:r.asset_focal_y??50}));
  res.json({branch,language:lang,channel,categories,items,blocks});
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
  const id=`vcb_${crypto.randomUUID()}`, now=new Date().toISOString();
  await execute(`INSERT INTO visual_catalog_blocks (id,branch_id,type,title_ru,title_tk,subtitle_ru,subtitle_tk,media_url,media_kind,media_asset_id,link_type,link_target,category_id,menu_item_id,external_url,sort_order,priority,active,schedule_start,schedule_end,channels,created_by,updated_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,[id,branch,type,req.body?.title_ru||null,req.body?.title_tk||null,req.body?.subtitle_ru||null,req.body?.subtitle_tk||null,req.body?.media_url||null,req.body?.media_kind||null,req.body?.media_asset_id||null,link,req.body?.link_target||null,req.body?.category_id||null,req.body?.menu_item_id||null,req.body?.external_url||null,Number(req.body?.sort_order||0),Number(req.body?.priority||0),req.body?.active!==false,req.body?.schedule_start||null,req.body?.schedule_end||null,normalizeChannels(req.body?.channels),req.user!.id,req.user!.id,now,now]);
  await insertAuditLog(execute,{userId:req.user!.id,branchId:branch,action:'VISUAL_CATALOG_BLOCK_CREATED',entityType:'VISUAL_CATALOG_BLOCK',entityId:id,newValues:req.body,req});
  res.status(201).json({block:await queryOne<any>('SELECT * FROM visual_catalog_blocks WHERE id=?',[id])});
});

router.patch('/:id', requirePermission('visual_catalog.manage'), async (req,res)=>{
  const row=await queryOne<any>('SELECT * FROM visual_catalog_blocks WHERE id=?',[req.params.id]); if(!row||!isAccessible(req,row.branch_id)) return res.status(404).json({error:'NOT_FOUND',message:'Visual catalog block not found.'});
  const n={...row,...req.body,updated_at:new Date().toISOString(),updated_by:req.user!.id};
  if(n.type&&!TYPES.includes(String(n.type).toUpperCase())||n.link_type&&!LINKS.includes(String(n.link_type).toUpperCase())) return res.status(400).json({error:'INVALID_VISUAL_BLOCK',message:'Invalid block type or link type.'});
  const channels = req.body?.channels !== undefined ? normalizeChannels(req.body.channels) : row.channels;
  await execute(`UPDATE visual_catalog_blocks SET type=?,title_ru=?,title_tk=?,subtitle_ru=?,subtitle_tk=?,media_url=?,media_kind=?,media_asset_id=?,link_type=?,link_target=?,category_id=?,menu_item_id=?,external_url=?,sort_order=?,priority=?,active=?,schedule_start=?,schedule_end=?,channels=?,updated_by=?,updated_at=? WHERE id=?`,[String(n.type).toUpperCase(),n.title_ru||null,n.title_tk||null,n.subtitle_ru||null,n.subtitle_tk||null,n.media_url||null,n.media_kind||null,n.media_asset_id||null,String(n.link_type).toUpperCase(),n.link_target||null,n.category_id||null,n.menu_item_id||null,n.external_url||null,Number(n.sort_order||0),Number(n.priority||0),Boolean(n.active),n.schedule_start||null,n.schedule_end||null,channels,n.updated_by,n.updated_at,row.id]);
  await insertAuditLog(execute,{userId:req.user!.id,branchId:row.branch_id,action:'VISUAL_CATALOG_BLOCK_UPDATED',entityType:'VISUAL_CATALOG_BLOCK',entityId:row.id,oldValues:row,newValues:n,req});
  res.json({block:await queryOne<any>('SELECT * FROM visual_catalog_blocks WHERE id=?',[row.id])});
});

router.delete('/:id', requirePermission('visual_catalog.manage'), async (req,res)=>{
  const row=await queryOne<any>('SELECT * FROM visual_catalog_blocks WHERE id=?',[req.params.id]); if(!row||!isAccessible(req,row.branch_id)) return res.status(404).json({error:'NOT_FOUND',message:'Visual catalog block not found.'});
  await execute('UPDATE visual_catalog_blocks SET active=false,updated_by=?,updated_at=? WHERE id=?',[req.user!.id,new Date().toISOString(),row.id]);
  await insertAuditLog(execute,{userId:req.user!.id,branchId:row.branch_id,action:'VISUAL_CATALOG_BLOCK_DEACTIVATED',entityType:'VISUAL_CATALOG_BLOCK',entityId:row.id,oldValues:{active:row.active},newValues:{active:false},req});
  res.json({success:true});
});
export default router;
