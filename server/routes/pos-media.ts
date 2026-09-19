import { Router, Request, Response } from 'express';
import express from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { execute, query, queryOne } from '../db';
import { authenticateToken, requirePermission, recordAuditLog } from '../auth';
import { getWaiterSession } from './waiters';

const router = Router();
const MEDIA_DIR = path.join(process.cwd(), 'uploads', 'pos-media');
const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
const ALLOWED = new Map([
  ['video/mp4', '.mp4'], ['video/webm', '.webm'],
  ['image/jpeg', '.jpg'], ['image/png', '.png'], ['image/webp', '.webp'], ['image/gif', '.gif']
]);

function allowed(req: Request, branchId: string) {
  return Boolean(req.user?.isSuperUser || req.user?.allowedBranchIds.includes(branchId));
}

function parseBool(v: unknown, fallback = false) {
  if (v === undefined) return fallback;
  return ['true','1','yes','on'].includes(String(v).toLowerCase());
}

function activeWindow(row: any) {
  const now = Date.now();
  if (!row.active) return false;
  if (row.schedule_start && now < new Date(row.schedule_start).getTime()) return false;
  if (row.schedule_end && now >= new Date(row.schedule_end).getTime()) return false;
  return true;
}

// Waiter POS reads only its own branch and only active/scheduled media.
router.get('/current', async (req: Request, res: Response): Promise<void> => {
  const session = await getWaiterSession(req);
  if (!session) { res.status(401).json({ error:'UNAUTHORIZED', code:'WAITER_SESSION_REQUIRED', message:'Valid waiter POS session required.', details:{} }); return; }
  const rows = await query<any>(`SELECT id,branch_id,name,kind,url,mime_type,size_bytes,active,priority,sort_order,schedule_start,schedule_end,is_fallback,created_at,updated_at
    FROM pos_media WHERE (branch_id=? OR branch_id IS NULL) AND active=true ORDER BY priority DESC, sort_order ASC, created_at DESC`, [session.branch_id]);
  const visible = rows.filter(activeWindow);
  const primary = visible.find((x:any)=>!x.is_fallback) || visible.find((x:any)=>x.is_fallback) || null;
  res.json({ media: visible, primary });
});

router.use(authenticateToken);

router.get('/', requirePermission('pos.media.view'), async (req: Request, res: Response): Promise<void> => {
  const branchId = typeof req.query.branch_id === 'string' && req.query.branch_id ? String(req.query.branch_id) : null;
  if (branchId && !allowed(req, branchId)) { res.status(403).json({ error:'BRANCH_ACCESS_DENIED', code:'BRANCH_ACCESS_DENIED', message:'Branch is outside your access scope.', details:{} }); return; }
  const params:any[] = [];
  let where = '';
  if (branchId) { where = 'WHERE m.branch_id=?'; params.push(branchId); }
  else if (!req.user!.isSuperUser) {
    const ids = req.user!.allowedBranchIds || [];
    if (!ids.length) { res.json({ media: [] }); return; }
    where = `WHERE m.branch_id IN (${ids.map(()=>'?').join(',')})`;
    params.push(...ids);
  }
  const media = await query<any>(`SELECT m.*, b.name AS branch_name, b.code AS branch_code, u.full_name AS created_by_name
    FROM pos_media m LEFT JOIN branches b ON b.id=m.branch_id LEFT JOIN users u ON u.id=m.created_by ${where}
    ORDER BY m.priority DESC,m.sort_order ASC,m.created_at DESC`, params);
  res.json({ media });
});

router.post('/', requirePermission('pos.media.manage'), async (req: Request, res: Response): Promise<void> => {
  const branchId = req.body?.branch_id ? String(req.body.branch_id) : null;
  if (branchId && !allowed(req, branchId)) { res.status(403).json({ error:'BRANCH_ACCESS_DENIED', code:'BRANCH_ACCESS_DENIED', message:'Branch is outside your access scope.', details:{} }); return; }
  if (!branchId && !req.user!.isSuperUser) { res.status(403).json({ error:'GLOBAL_MEDIA_REQUIRES_SUPERUSER', code:'GLOBAL_MEDIA_REQUIRES_SUPERUSER', message:'Global POS media requires superuser access.', details:{} }); return; }
  const name = String(req.body?.name || '').trim();
  const url = String(req.body?.url || '').trim();
  const kind = String(req.body?.kind || 'VIDEO').toUpperCase();
  if (!name || !url || !['VIDEO','IMAGE','GIF'].includes(kind)) { res.status(400).json({ error:'VALIDATION_ERROR', code:'INVALID_MEDIA', message:'name, url and a valid media kind are required.', details:{} }); return; }
  const id = `pmed_${crypto.randomUUID()}`; const now = new Date().toISOString();
  await execute(`INSERT INTO pos_media (id,branch_id,name,kind,url,mime_type,size_bytes,active,priority,sort_order,schedule_start,schedule_end,is_fallback,created_by,updated_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id,branchId,name,kind,url,req.body?.mime_type||null,req.body?.size_bytes?Number(req.body.size_bytes):null,parseBool(req.body?.active,true),Number(req.body?.priority||0),Number(req.body?.sort_order||0),req.body?.schedule_start||null,req.body?.schedule_end||null,parseBool(req.body?.is_fallback,false),req.user!.id,req.user!.id,now,now]);
  await recordAuditLog({ action:'POS_MEDIA_CREATED', entityType:'POS_MEDIA', entityId:id, branchId:branchId||undefined, newValues:{name,kind,url,active:parseBool(req.body?.active,true)}, req });
  res.status(201).json({ media: await queryOne<any>('SELECT * FROM pos_media WHERE id=?',[id]) });
});

router.post('/upload', requirePermission('pos.media.manage'), express.raw({ type: () => true, limit: MAX_UPLOAD_BYTES }), async (req: Request, res: Response): Promise<void> => {
  const contentType = String(req.headers['content-type'] || '').split(';')[0].toLowerCase();
  const ext = ALLOWED.get(contentType);
  const branchId = typeof req.headers['x-branch-id'] === 'string' && req.headers['x-branch-id'] ? String(req.headers['x-branch-id']) : null;
  if (!ext || !Buffer.isBuffer(req.body) || req.body.length === 0) { res.status(400).json({ error:'VALIDATION_ERROR', code:'INVALID_UPLOAD', message:'Supported media file required.', details:{} }); return; }
  if (branchId && !allowed(req, branchId)) { res.status(403).json({ error:'BRANCH_ACCESS_DENIED', code:'BRANCH_ACCESS_DENIED', message:'Branch is outside your access scope.', details:{} }); return; }
  if (!branchId && !req.user!.isSuperUser) { res.status(403).json({ error:'GLOBAL_MEDIA_REQUIRES_SUPERUSER', code:'GLOBAL_MEDIA_REQUIRES_SUPERUSER', message:'Global POS media requires superuser access.', details:{} }); return; }
  const original = String(req.headers['x-media-name'] || 'media').replace(/[^a-zA-Z0-9._-]/g,'_').slice(0,100);
  const id = `pmed_${crypto.randomUUID()}`; const filename = `${id}${ext}`; await fs.mkdir(MEDIA_DIR,{recursive:true});
  await fs.writeFile(path.join(MEDIA_DIR,filename), req.body);
  const kind = contentType.startsWith('video/') ? 'VIDEO' : contentType === 'image/gif' ? 'GIF' : 'IMAGE';
  const name = original.replace(/\.[^.]+$/,'') || 'POS media'; const now = new Date().toISOString();
  const url = `/uploads/pos-media/${filename}`;
  await execute(`INSERT INTO pos_media (id,branch_id,name,kind,url,mime_type,size_bytes,active,priority,sort_order,schedule_start,schedule_end,is_fallback,created_by,updated_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id,branchId,name,kind,url,contentType,req.body.length,true,0,0,null,null,false,req.user!.id,req.user!.id,now,now]);
  await recordAuditLog({ action:'POS_MEDIA_UPLOADED', entityType:'POS_MEDIA', entityId:id, branchId:branchId||undefined, newValues:{name,kind,mime_type:contentType,size_bytes:req.body.length,url}, req });
  res.status(201).json({ media: await queryOne<any>('SELECT * FROM pos_media WHERE id=?',[id]) });
});

router.patch('/:id', requirePermission('pos.media.manage'), async (req: Request, res: Response): Promise<void> => {
  const id=String(req.params.id); const existing=await queryOne<any>('SELECT * FROM pos_media WHERE id=?',[id]);
  if(!existing){res.status(404).json({error:'NOT_FOUND',code:'POS_MEDIA_NOT_FOUND',message:'POS media not found.',details:{}});return;}
  if(existing.branch_id&&!allowed(req,existing.branch_id)){res.status(403).json({error:'BRANCH_ACCESS_DENIED',code:'BRANCH_ACCESS_DENIED',message:'Branch is outside your access scope.',details:{}});return;}
  const next={
    name:req.body?.name!==undefined?String(req.body.name).trim():existing.name,
    active:req.body?.active!==undefined?parseBool(req.body.active):existing.active,
    priority:req.body?.priority!==undefined?Number(req.body.priority):existing.priority,
    sort_order:req.body?.sort_order!==undefined?Number(req.body.sort_order):existing.sort_order,
    schedule_start:req.body?.schedule_start!==undefined?(req.body.schedule_start||null):existing.schedule_start,
    schedule_end:req.body?.schedule_end!==undefined?(req.body.schedule_end||null):existing.schedule_end,
    is_fallback:req.body?.is_fallback!==undefined?parseBool(req.body.is_fallback):existing.is_fallback,
    updated_at:new Date().toISOString()
  };
  await execute(`UPDATE pos_media SET name=?,active=?,priority=?,sort_order=?,schedule_start=?,schedule_end=?,is_fallback=?,updated_by=?,updated_at=? WHERE id=?`,[next.name,next.active,next.priority,next.sort_order,next.schedule_start,next.schedule_end,next.is_fallback,req.user!.id,next.updated_at,id]);
  await recordAuditLog({action:'POS_MEDIA_UPDATED',entityType:'POS_MEDIA',entityId:id,branchId:existing.branch_id||undefined,oldValues:existing,newValues:next,req});
  res.json({media:await queryOne<any>('SELECT * FROM pos_media WHERE id=?',[id])});
});

router.delete('/:id', requirePermission('pos.media.manage'), async (req: Request, res: Response): Promise<void> => {
  const id=String(req.params.id); const existing=await queryOne<any>('SELECT * FROM pos_media WHERE id=?',[id]);
  if(!existing){res.status(404).json({error:'NOT_FOUND',code:'POS_MEDIA_NOT_FOUND',message:'POS media not found.',details:{}});return;}
  if(existing.branch_id&&!allowed(req,existing.branch_id)){res.status(403).json({error:'BRANCH_ACCESS_DENIED',code:'BRANCH_ACCESS_DENIED',message:'Branch is outside your access scope.',details:{}});return;}
  await execute('UPDATE pos_media SET active=false,updated_by=?,updated_at=? WHERE id=?',[req.user!.id,new Date().toISOString(),id]);
  await recordAuditLog({action:'POS_MEDIA_DEACTIVATED',entityType:'POS_MEDIA',entityId:id,branchId:existing.branch_id||undefined,oldValues:{active:existing.active},newValues:{active:false},req});
  res.json({success:true});
});

export default router;
