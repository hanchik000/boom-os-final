import { Router, Request } from 'express';
import crypto from 'node:crypto';
import { query, queryOne, execute, transaction } from '../db';
import { authenticateToken, requirePermission, insertAuditLog } from '../auth';

const router = Router(); router.use(authenticateToken);
function allowed(req: Request, b: string){ return Boolean(req.user?.isSuperUser || req.user?.allowedBranchIds.includes(b)); }
function moneyPercent(v: unknown){ const s=String(v??'').trim(); return /^\d+(?:\.\d{1,2})?$/.test(s) ? s : null; }

router.get('/:branchId', requirePermission('service_charge.view'), async(req,res)=>{
  const b=req.params.branchId; if(!allowed(req,b)) return res.status(403).json({error:'BRANCH_ACCESS_DENIED',code:'BRANCH_ACCESS_DENIED',message:'Branch is outside your access scope.',details:{}});
  const config=await queryOne<any>('SELECT * FROM service_charge_configs WHERE branch_id=?',[b]);
  const allocations=config?await query<any>('SELECT * FROM service_charge_allocations WHERE config_id=? AND active=true ORDER BY created_at',[config.id]):[];
  res.json({config:config?{...config,allocations}:null});
});

router.put('/:branchId', requirePermission('service_charge.manage'), async(req,res)=>{
  const b=req.params.branchId; if(!allowed(req,b)) return res.status(403).json({error:'BRANCH_ACCESS_DENIED',code:'BRANCH_ACCESS_DENIED',message:'Branch is outside your access scope.',details:{}});
  const percent=moneyPercent(req.body?.percent); const allocations=Array.isArray(req.body?.allocations)?req.body.allocations:[];
  if(percent===null || Number(percent)>100) return res.status(400).json({error:'VALIDATION_ERROR',code:'INVALID_SERVICE_CHARGE_PERCENT',message:'Service charge must be between 0 and 100 percent.',details:{}});
  let sum=0; for(const a of allocations){const p=moneyPercent(a?.percent); if(p===null||Number(p)<0)return res.status(400).json({error:'VALIDATION_ERROR',code:'INVALID_ALLOCATION',message:'Each allocation needs a non-negative percentage.',details:{}}); sum+=Number(p);}
  if(sum>Number(percent)) return res.status(400).json({error:'VALIDATION_ERROR',code:'ALLOCATIONS_EXCEED_SERVICE_CHARGE',message:'Allocation total cannot exceed the configured service charge.',details:{sum,service_charge:percent}});
  const now=new Date().toISOString();
  let result:any;
  try{
  result=await transaction(async(tx)=>{
    const existing=await tx.queryOne<any>('SELECT * FROM service_charge_configs WHERE branch_id=? FOR UPDATE',[b]);
    const id=existing?.id||`scc_${crypto.randomUUID()}`;
    if(existing) await tx.execute('UPDATE service_charge_configs SET percent=CAST(? AS numeric),status=\'ACTIVE\',updated_at=? WHERE id=?',[percent,now,id]);
    else await tx.execute('INSERT INTO service_charge_configs (id,branch_id,percent,status,created_at,updated_at) VALUES (?,?,CAST(? AS numeric),\'ACTIVE\',?,?)',[id,b,percent,now,now]);
    await tx.execute('UPDATE service_charge_allocations SET active=false,updated_at=? WHERE config_id=? AND active=true',[now,id]);
    for(const a of allocations){
      const target=String(a?.target_type||'GROUP').toUpperCase();
      if(!['GROUP','INDIVIDUAL'].includes(target)) throw new Error('INVALID_TARGET_TYPE');
      const userId=a?.user_id?String(a.user_id):null; const department=a?.department?String(a.department).trim().toUpperCase():null;
      if(target==='INDIVIDUAL'&&!userId) throw new Error('USER_REQUIRED');
      if(target==='GROUP'&&!department) throw new Error('DEPARTMENT_REQUIRED');
      if(userId){const u=await tx.queryOne<any>('SELECT id,branch_id FROM users WHERE id=? AND deleted_at IS NULL',[userId]); if(!u||!allowed(req,u.branch_id||'')) throw new Error('USER_BRANCH_MISMATCH');}
      await tx.execute('INSERT INTO service_charge_allocations (id,config_id,target_type,department,user_id,percent,active,created_at,updated_at) VALUES (?,?,?,?,?,CAST(? AS numeric),true,?,?)',[`sca_${crypto.randomUUID()}`,id,target,department,userId,String(a.percent),now,now]);
    }
    await insertAuditLog(tx.execute,{userId:req.user!.id,branchId:b,action:'SERVICE_CHARGE_SETTINGS_UPDATED',entityType:'SERVICE_CHARGE_CONFIG',entityId:id,newValues:{percent,allocations},req});
    return await tx.queryOne<any>('SELECT * FROM service_charge_configs WHERE id=?',[id]);
  });
  }catch(e:any){const map:any={INVALID_TARGET_TYPE:[400,'VALIDATION_ERROR','INVALID_TARGET_TYPE'],USER_REQUIRED:[400,'VALIDATION_ERROR','USER_REQUIRED'],DEPARTMENT_REQUIRED:[400,'VALIDATION_ERROR','DEPARTMENT_REQUIRED'],USER_BRANCH_MISMATCH:[403,'BRANCH_ACCESS_DENIED','USER_BRANCH_MISMATCH']};if(map[e.message])return res.status(map[e.message][0]).json({error:map[e.message][1],code:map[e.message][2],message:e.message,details:{}});throw e;}
  res.json({config:result,allocations:await query<any>('SELECT * FROM service_charge_allocations WHERE config_id=? AND active=true ORDER BY created_at',[result.id])});
});

router.get('/:branchId/ledger', requirePermission('service_charge.view'), async(req,res)=>{
  const b=req.params.branchId; if(!allowed(req,b)) return res.status(403).json({error:'BRANCH_ACCESS_DENIED',code:'BRANCH_ACCESS_DENIED',message:'Branch is outside your access scope.',details:{}});
  const rows=await query<any>('SELECT scl.*,u.full_name AS user_name,o.order_number FROM service_charge_ledger scl LEFT JOIN users u ON u.id=scl.user_id LEFT JOIN orders o ON o.id=scl.order_id WHERE scl.branch_id=? ORDER BY scl.created_at DESC LIMIT 500',[b]);
  res.json({ledger:rows});
});
export default router;
