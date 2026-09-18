import { Router, Request } from 'express';
import crypto from 'node:crypto';
import { query, queryOne, transaction } from '../db';
import { authenticateToken, requirePermission, insertAuditLog } from '../auth';
const router=Router(); router.use(authenticateToken);
function allowed(req:Request,b:string){return Boolean(req.user?.isSuperUser||req.user?.allowedBranchIds.includes(b));}

async function employeeRoles(userId:string){
  const rows=await query<{code:string}>(`SELECT r.code FROM roles r JOIN user_roles ur ON ur.role_id=r.id WHERE ur.user_id=? AND r.status='ACTIVE'`,[userId]);
  return new Set(rows.map(r=>String(r.code).toUpperCase()));
}

// Sales attribution follows the employee who actually owns the sale:
// WAITER -> orders.waiter_user_id; CASHIER/OPERATOR -> payments.cashier_user_id.
function moneyCents(v: unknown): bigint {
  const s=String(v??'').trim();
  if(!/^\d+(?:\.\d{1,2})?$/.test(s)) throw new Error('INVALID_MONEY');
  const [a,b='']=s.split('.');
  return BigInt(a)*100n+BigInt((b+'00').slice(0,2));
}
function centsText(c: bigint){ return `${c/100n}.${(c%100n).toString().padStart(2,'0')}`; }
function percentBps(v: unknown): bigint {
  const s=String(v??'').trim();
  if(!/^\d+(?:\.\d{1,2})?$/.test(s)) throw new Error('INVALID_PERCENT');
  const [a,b='']=s.split('.');
  return BigInt(a)*100n+BigInt((b+'00').slice(0,2));
}

async function salesForEmployee(userId:string,branchId:string,start:string,end:string,roles:Set<string>){
  if(roles.has('WAITER')){
    return queryOne<any>(`SELECT COALESCE(SUM(p.amount),0) AS value FROM payments p JOIN orders o ON o.id=p.order_id AND o.branch_id=p.branch_id WHERE p.branch_id=? AND o.waiter_user_id=? AND p.status='PAID' AND p.created_at>=? AND p.created_at<=?`,[branchId,userId,start,end]);
  }
  return queryOne<any>(`SELECT COALESCE(SUM(p.amount),0) AS value FROM payments p WHERE p.branch_id=? AND p.cashier_user_id=? AND p.status='PAID' AND p.created_at>=? AND p.created_at<=?`,[branchId,userId,start,end]);
}

router.get('/rules',requirePermission('kpi.view'),async(req,res)=>{const b=typeof req.query.branch_id==='string'?req.query.branch_id:null;if(b&&!allowed(req,b))return res.status(403).json({error:'BRANCH_ACCESS_DENIED',code:'BRANCH_ACCESS_DENIED',message:'Branch is outside your access scope.',details:{}});const rows=await query<any>(`SELECT * FROM kpi_rules WHERE active=true AND (branch_id IS NULL ${b?'OR branch_id=?':''}) ORDER BY created_at DESC`,b?[b]:[]);res.json({rules:rows});});
router.post('/rules',requirePermission('kpi.manage'),async(req,res)=>{const b=req.body?.branch_id?String(req.body.branch_id):null;if(b&&!allowed(req,b))return res.status(403).json({error:'BRANCH_ACCESS_DENIED',code:'BRANCH_ACCESS_DENIED',message:'Branch is outside your access scope.',details:{}});const name=String(req.body?.name||'').trim(),metric=String(req.body?.metric||'SALES').toUpperCase(),threshold=String(req.body?.threshold??''),mode=String(req.body?.threshold_mode||'GREATER_THAN').toUpperCase(),rewardType=String(req.body?.reward_type||'FIXED').toUpperCase(),rewardValue=String(req.body?.reward_value??'');if(!name||!/^\d+(?:\.\d{1,2})?$/.test(threshold)||!/^\d+(?:\.\d{1,2})?$/.test(rewardValue)||!['GREATER_THAN','GREATER_OR_EQUAL'].includes(mode)||!['FIXED','PERCENT'].includes(rewardType))return res.status(400).json({error:'VALIDATION_ERROR',code:'INVALID_KPI_RULE',message:'Invalid KPI rule.',details:{}});const now=new Date().toISOString(),id=`kpir_${crypto.randomUUID()}`;await transaction(async(tx)=>{await tx.execute('INSERT INTO kpi_rules (id,branch_id,name,role_code,user_id,metric,threshold,threshold_mode,reward_type,reward_value,active,created_at,updated_at) VALUES (?,?,?,?,?,?,CAST(? AS numeric),?,?,CAST(? AS numeric),true,?,?)',[id,b,name,req.body?.role_code?String(req.body.role_code).toUpperCase():null,req.body?.user_id?String(req.body.user_id):null,metric,threshold,mode,rewardType,rewardValue,now,now]);await insertAuditLog(tx.execute,{userId:req.user!.id,branchId:b,action:'KPI_RULE_CREATED',entityType:'KPI_RULE',entityId:id,newValues:{name,metric,threshold,mode,rewardType,rewardValue},req});});res.status(201).json({rule:await queryOne<any>('SELECT * FROM kpi_rules WHERE id=?',[id])});});
router.get('/employees/:userId',requirePermission('kpi.view'),async(req,res)=>{const u=await queryOne<any>('SELECT id,branch_id,full_name FROM users WHERE id=?',[req.params.userId]);if(!u)return res.status(404).json({error:'NOT_FOUND',code:'USER_NOT_FOUND',message:'User not found.',details:{}});if(!allowed(req,u.branch_id||''))return res.status(403).json({error:'BRANCH_ACCESS_DENIED',code:'BRANCH_ACCESS_DENIED',message:'Branch is outside your access scope.',details:{}});const start=typeof req.query.start==='string'?req.query.start:new Date(new Date().getFullYear(),new Date().getMonth(),1).toISOString();const end=typeof req.query.end==='string'?req.query.end:new Date().toISOString();const roles=await employeeRoles(u.id);const sales=await salesForEmployee(u.id,u.branch_id,start,end,roles);const rules=await query<any>(`SELECT * FROM kpi_rules WHERE active=true AND (branch_id IS NULL OR branch_id=?) AND (user_id=? OR user_id IS NULL)`,[u.branch_id,u.id]);res.json({employee:u,period:{start,end},metric:{sales:String(sales?.value||'0')},attribution:roles.has('WAITER')?'ORDER_WAITER':'PAYMENT_CASHIER',rules});});
router.post('/evaluate',requirePermission('kpi.manage'),async(req,res)=>{const b=String(req.body?.branch_id||'');const userId=String(req.body?.user_id||'');const start=String(req.body?.period_start||'');const end=String(req.body?.period_end||'');if(!b||!userId||!start||!end||!allowed(req,b))return res.status(400).json({error:'VALIDATION_ERROR',code:'INVALID_KPI_PERIOD',message:'branch_id, user_id, period_start and period_end are required.',details:{}});const u=await queryOne<any>('SELECT id,branch_id,employment_status,deleted_at FROM users WHERE id=?',[userId]);if(!u||u.branch_id!==b)return res.status(404).json({error:'NOT_FOUND',code:'USER_NOT_FOUND',message:'Employee not found in branch.',details:{}});const roles=await employeeRoles(userId);const sales=await salesForEmployee(userId,b,start,end,roles);const valueText=String(sales?.value||'0');
const valueCents=moneyCents(valueText);const rules=await query<any>(`SELECT * FROM kpi_rules WHERE active=true AND (branch_id IS NULL OR branch_id=?) AND (user_id=? OR user_id IS NULL) AND metric='SALES'`,[b,userId]);const created:any[]=[];await transaction(async(tx)=>{for(const r of rules){if(r.role_code && !roles.has(String(r.role_code).toUpperCase())) continue;const thresholdCents=moneyCents(r.threshold);const qualifies=r.threshold_mode==='GREATER_OR_EQUAL'?valueCents>=thresholdCents:valueCents>thresholdCents;if(!qualifies)continue;const reward=r.reward_type==='PERCENT'?centsText((valueCents*percentBps(r.reward_value))/10000n):centsText(moneyCents(r.reward_value));const id=`kpil_${crypto.randomUUID()}`;const exists=await tx.queryOne<any>('SELECT id FROM kpi_ledger WHERE rule_id=? AND user_id=? AND period_start=? AND period_end=?',[r.id,userId,start,end]);if(exists){created.push(exists);continue;}await tx.execute('INSERT INTO kpi_ledger (id,rule_id,branch_id,user_id,period_start,period_end,metric_value,reward_amount,status,created_at) VALUES (?,?,?,?,?,?,CAST(? AS numeric),CAST(? AS numeric),\'EARNED\',?)',[id,r.id,b,userId,start,end,valueText,reward,new Date().toISOString()]);await insertAuditLog(tx.execute,{userId:req.user!.id,branchId:b,action:'KPI_BONUS_EARNED',entityType:'KPI_LEDGER',entityId:id,newValues:{rule_id:r.id,user_id:userId,metric_value:valueText,reward_amount:reward,period_start:start,period_end:end,attribution:roles.has('WAITER')?'ORDER_WAITER':'PAYMENT_CASHIER'},req});created.push(await tx.queryOne<any>('SELECT * FROM kpi_ledger WHERE id=?',[id]));}});res.json({metric_value:valueText,attribution:roles.has('WAITER')?'ORDER_WAITER':'PAYMENT_CASHIER',earned:created});});
export default router;
