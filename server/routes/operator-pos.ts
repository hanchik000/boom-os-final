import { Router, Request, Response, NextFunction } from 'express';
import { authenticateToken, requirePermission, verifyPassword, insertAuditLog } from '../auth';
import { queryOne, execute, transaction } from '../db';
import crypto from 'node:crypto';
const router=Router(); router.use(authenticateToken);
function allowed(req:Request,b:string){return Boolean(req.user?.isSuperUser||req.user?.allowedBranchIds.includes(b));}

/**
 * Cashier POS guard. Managers/superusers keep their existing permission-based flow;
 * CASHIER users must present the short-lived operator POS session token issued by /unlock.
 */
export async function requireOperatorPosSession(req:Request,res:Response,next:NextFunction){
  if(req.user?.isSuperUser || !req.user?.roleCodes.includes('CASHIER')) return next();
  const token=String(req.headers['x-pos-session-token']||'').trim();
  if(!token) return res.status(401).json({error:'POS_SESSION_REQUIRED',code:'POS_SESSION_REQUIRED',message:'Active operator POS session is required.',details:{}});
  // Resolve the protected resource branch first. Never trust a caller-supplied branch_id
  // when an order/payment identifies the authoritative branch.
  let branchId=String(req.body?.branch_id||req.query?.branch_id||req.user?.branch_id||'');
  if(req.body?.order_id){
    const order=await queryOne<{branch_id:string}>('SELECT branch_id FROM orders WHERE id=?',[String(req.body.order_id)]);
    if(order) branchId=order.branch_id;
  } else if(req.params?.id && req.path.includes('/refund')) {
    const payment=await queryOne<{branch_id:string}>('SELECT branch_id FROM payments WHERE id=?',[String(req.params.id)]);
    if(payment) branchId=payment.branch_id;
  }
  if(!branchId||!allowed(req,branchId)) return res.status(403).json({error:'BRANCH_ACCESS_DENIED',code:'BRANCH_ACCESS_DENIED',message:'Branch is outside your access scope.',details:{}});
  const hash=crypto.createHash('sha256').update(token).digest('hex');
  const now=new Date().toISOString();
  const session=await queryOne<any>(`SELECT id FROM operator_pos_sessions WHERE user_id=? AND branch_id=? AND pin_hash=? AND status='ACTIVE' AND expires_at>? LIMIT 1`,[req.user!.id,branchId,hash,now]);
  if(!session) return res.status(401).json({error:'POS_SESSION_INVALID',code:'POS_SESSION_INVALID',message:'Operator POS session is locked, revoked or expired.',details:{}});
  await execute('UPDATE operator_pos_sessions SET last_seen_at=? WHERE id=? AND status=\'ACTIVE\'',[now,session.id]);
  next();
}

router.post('/lock',requirePermission('pos.operator'),async(req,res)=>{
  const b=String(req.body?.branch_id||req.user!.branch_id||'');
  if(!allowed(req,b))return res.status(403).json({error:'BRANCH_ACCESS_DENIED',code:'BRANCH_ACCESS_DENIED',message:'Branch is outside your access scope.',details:{}});
  const now=new Date().toISOString();
  await execute("UPDATE operator_pos_sessions SET status='LOCKED',locked_at=? WHERE user_id=? AND branch_id=? AND status='ACTIVE'",[now,req.user!.id,b]);
  await insertAuditLog(execute,{userId:req.user!.id,branchId:b,action:'OPERATOR_POS_LOCKED',entityType:'OPERATOR_POS',entityId:req.user!.id,newValues:{locked:true},req});
  res.json({locked:true});
});

router.post('/unlock',requirePermission('pos.operator'),async(req,res)=>{
  const password=String(req.body?.password||'');
  const b=String(req.body?.branch_id||req.user!.branch_id||'');
  if(!allowed(req,b))return res.status(403).json({error:'BRANCH_ACCESS_DENIED',code:'BRANCH_ACCESS_DENIED',message:'Branch is outside your access scope.',details:{}});
  const u=await queryOne<any>('SELECT id,password_hash,status,deleted_at FROM users WHERE id=?',[req.user!.id]);
  if(!u||u.status!=='ACTIVE'||u.deleted_at||!verifyPassword(password,u.password_hash))return res.status(401).json({error:'INVALID_CREDENTIALS',code:'INVALID_OPERATOR_PASSWORD',message:'Invalid operator password.',details:{}});
  const now=new Date().toISOString(),id=`ops_${crypto.randomUUID()}`,sessionSecret=crypto.randomBytes(32).toString('hex'),sessionHash=crypto.createHash('sha256').update(sessionSecret).digest('hex');
  await transaction(async(tx)=>{
    await tx.execute("UPDATE operator_pos_sessions SET status='LOCKED',locked_at=? WHERE user_id=? AND branch_id=? AND status='ACTIVE'",[now,u.id,b]);
    await tx.execute('INSERT INTO operator_pos_sessions (id,user_id,branch_id,pin_hash,status,device_id,last_seen_at,expires_at,created_at) VALUES (?,?,?,?,?,?,?,?,?)',[id,u.id,b,sessionHash,'ACTIVE',String(req.body?.device_id||'operator'),now,new Date(Date.now()+8*60*60*1000).toISOString(),now]);
    await insertAuditLog(tx.execute,{userId:u.id,branchId:b,action:'OPERATOR_POS_UNLOCKED',entityType:'OPERATOR_POS_SESSION',entityId:id,newValues:{device_id:String(req.body?.device_id||'operator')},req});
  });
  res.json({unlocked:true,session_id:id,session_token:sessionSecret});
});
export default router;
