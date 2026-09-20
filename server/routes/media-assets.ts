import { Router, Request, Response } from 'express';
import express from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { execute, query, queryOne } from '../db';
import { authenticateToken, requirePermission, recordAuditLog } from '../auth';

const router = Router();
const DIR = path.join(process.cwd(), 'uploads', 'menu-media');
const MAX = 150 * 1024 * 1024;
const ALLOWED = new Map([
  ['video/mp4', ['VIDEO','.mp4']], ['video/webm', ['VIDEO','.webm']],
  ['image/jpeg', ['IMAGE','.jpg']], ['image/png', ['IMAGE','.png']],
  ['image/webp', ['IMAGE','.webp']], ['image/gif', ['GIF','.gif']]
]);
// Stage 37 -- 360 media.
//
// A 360 asset is an ordinary equirectangular image FILE; what makes it 360 is the declaration,
// not the bytes, so the operator marks it explicitly and the server records that declaration.
// We deliberately do NOT infer 360 from a mime type: a normal JPG must never silently become a
// 360 asset. MEDIA_360 is therefore only reachable by an explicit `kind` on the JSON create
// route or by an explicit promotion on PATCH, and only from an image asset.
const KINDS = ['IMAGE','VIDEO','GIF','MEDIA_360'];
const IMAGE_KINDS = ['IMAGE','MEDIA_360'];

const allowed = (req:Request, branchId:string|null) => !branchId || Boolean(req.user?.isSuperUser || req.user?.allowedBranchIds.includes(branchId));
const bool = (v:any, d=false) => v===undefined ? d : ['true','1','yes','on'].includes(String(v).toLowerCase());

router.use(authenticateToken);

router.get('/', requirePermission('menu.media.view'), async (req,res) => {
  const branch = typeof req.query.branch_id==='string' && req.query.branch_id ? req.query.branch_id : null;
  if(branch && !allowed(req,branch)) return res.status(403).json({error:'BRANCH_ACCESS_DENIED'});
  const params:any[]=[]; let where='';
  if(branch){where='WHERE (m.branch_id=? OR m.branch_id IS NULL)';params.push(branch)}
  else if(!req.user!.isSuperUser){const ids=req.user!.allowedBranchIds||[]; if(!ids.length)return res.json({assets:[]}); where=`WHERE m.branch_id IN (${ids.map(()=>'?').join(',')}) OR m.branch_id IS NULL`;params.push(...ids)}
  const assets=await query<any>(`SELECT m.*,b.name AS branch_name FROM media_assets m LEFT JOIN branches b ON b.id=m.branch_id ${where} ORDER BY m.priority DESC,m.created_at DESC`,params);
  res.json({assets});
});

router.post('/upload', requirePermission('menu.media.manage'), express.raw({type:()=>true,limit:MAX}), async (req:Request,res:Response)=>{
  const ct=String(req.headers['content-type']||'').split(';')[0].toLowerCase(); const spec=ALLOWED.get(ct);
  const branch=typeof req.headers['x-branch-id']==='string'&&req.headers['x-branch-id']?String(req.headers['x-branch-id']):null;
  if(!spec || !Buffer.isBuffer(req.body) || req.body.length===0)return res.status(400).json({error:'INVALID_MEDIA_UPLOAD'});
  if(branch&&!allowed(req,branch))return res.status(403).json({error:'BRANCH_ACCESS_DENIED'});
  if(!branch&&!req.user!.isSuperUser)return res.status(403).json({error:'GLOBAL_MEDIA_REQUIRES_SUPERUSER'});
  await fs.mkdir(DIR,{recursive:true});
  const id=`masset_${crypto.randomUUID()}`, ext=spec[1], filename=`${id}${ext}`;
  await fs.writeFile(path.join(DIR,filename),req.body);
  const original=String(req.headers['x-media-name']||'media').replace(/[^a-zA-Z0-9._-]/g,'_').slice(0,120);
  const name=original.replace(/\.[^.]+$/,'')||'Menu media'; const now=new Date().toISOString(); const url=`/uploads/menu-media/${filename}`;
  await execute(`INSERT INTO media_assets (id,branch_id,name,kind,mime_type,url,poster_url,alt_ru,alt_tk,focal_x,focal_y,size_bytes,width,height,duration_ms,active,priority,created_by,updated_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,[id,branch,name,spec[0],ct,url,null,null,null,50,50,req.body.length,null,null,null,true,0,req.user!.id,req.user!.id,now,now]);
  await recordAuditLog({action:'MENU_MEDIA_ASSET_UPLOADED',entityType:'MEDIA_ASSET',entityId:id,branchId:branch||undefined,newValues:{name,kind:spec[0],mime_type:ct,size_bytes:req.body.length,url},req});
  res.status(201).json({asset:await queryOne<any>('SELECT * FROM media_assets WHERE id=?',[id])});
});

router.post('/', requirePermission('menu.media.manage'), async (req,res)=>{
  const branch=req.body?.branch_id?String(req.body.branch_id):null;
  if(branch&&!allowed(req,branch))return res.status(403).json({error:'BRANCH_ACCESS_DENIED'});
  if(!branch&&!req.user!.isSuperUser)return res.status(403).json({error:'GLOBAL_MEDIA_REQUIRES_SUPERUSER'});
  const name=String(req.body?.name||'').trim(), url=String(req.body?.url||'').trim(), kind=String(req.body?.kind||'IMAGE').toUpperCase();
  if(!name||!url||!KINDS.includes(kind))return res.status(400).json({error:'INVALID_MEDIA_ASSET'});
  // A 360 asset is a still image projected by the viewer; a video or GIF cannot be one.
  const declaredMime=String(req.body?.mime_type||'');
  if(kind==='MEDIA_360'&&declaredMime&&!declaredMime.startsWith('image/'))return res.status(400).json({error:'VALIDATION_ERROR',code:'INVALID_360_ASSET',message:'A 360 asset must be an equirectangular image.'});
  const id=`masset_${crypto.randomUUID()}`,now=new Date().toISOString();
  await execute(`INSERT INTO media_assets (id,branch_id,name,kind,mime_type,url,poster_url,alt_ru,alt_tk,focal_x,focal_y,size_bytes,width,height,duration_ms,active,priority,created_by,updated_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,[id,branch,String(name),kind,String(req.body?.mime_type||''),url,req.body?.poster_url||null,req.body?.alt_ru||null,req.body?.alt_tk||null,Number(req.body?.focal_x??50),Number(req.body?.focal_y??50),null,null,null,null,bool(req.body?.active,true),Number(req.body?.priority||0),req.user!.id,req.user!.id,now,now]);
  await recordAuditLog({action:'MENU_MEDIA_ASSET_CREATED',entityType:'MEDIA_ASSET',entityId:id,branchId:branch||undefined,newValues:req.body,req});
  res.status(201).json({asset:await queryOne<any>('SELECT * FROM media_assets WHERE id=?',[id])});
});

router.patch('/:id', requirePermission('menu.media.manage'), async (req,res)=>{
  const row=await queryOne<any>('SELECT * FROM media_assets WHERE id=?',[req.params.id]); if(!row)return res.status(404).json({error:'NOT_FOUND'});
  if(row.branch_id&&!allowed(req,row.branch_id))return res.status(403).json({error:'BRANCH_ACCESS_DENIED'});
  const n={...row,...req.body,updated_at:new Date().toISOString(),updated_by:req.user!.id};
  // Stage 37: an uploaded image can be DECLARED a 360 asset (or demoted back to a flat image).
  // Only ever between the two image kinds -- a video or GIF can never be relabelled this way.
  let kind=row.kind;
  if(req.body?.kind!==undefined){
    const want=String(req.body.kind).toUpperCase();
    if(!IMAGE_KINDS.includes(want)||!IMAGE_KINDS.includes(row.kind))
      return res.status(400).json({error:'VALIDATION_ERROR',code:'INVALID_MEDIA_KIND_CHANGE',message:'Only an image asset can be marked as, or unmarked from, a 360 asset.'});
    kind=want;
  }
  await execute(`UPDATE media_assets SET name=?,kind=?,poster_url=?,alt_ru=?,alt_tk=?,focal_x=?,focal_y=?,active=?,priority=?,updated_by=?,updated_at=? WHERE id=?`,[String(n.name),kind,n.poster_url||null,n.alt_ru||null,n.alt_tk||null,Number(n.focal_x??50),Number(n.focal_y??50),bool(n.active),Number(n.priority||0),req.user!.id,n.updated_at,row.id]);
  await recordAuditLog({action:'MENU_MEDIA_ASSET_UPDATED',entityType:'MEDIA_ASSET',entityId:row.id,branchId:row.branch_id||undefined,oldValues:row,newValues:n,req});
  res.json({asset:await queryOne<any>('SELECT * FROM media_assets WHERE id=?',[row.id])});
});

router.delete('/:id', requirePermission('menu.media.manage'), async (req,res)=>{
  const row=await queryOne<any>('SELECT * FROM media_assets WHERE id=?',[req.params.id]); if(!row)return res.status(404).json({error:'NOT_FOUND'});
  if(row.branch_id&&!allowed(req,row.branch_id))return res.status(403).json({error:'BRANCH_ACCESS_DENIED'});
  await execute('UPDATE media_assets SET active=false,updated_by=?,updated_at=? WHERE id=?',[req.user!.id,new Date().toISOString(),row.id]);
  await recordAuditLog({action:'MENU_MEDIA_ASSET_DEACTIVATED',entityType:'MEDIA_ASSET',entityId:row.id,branchId:row.branch_id||undefined,oldValues:{active:row.active},newValues:{active:false},req});
  res.json({success:true});
});
export default router;
