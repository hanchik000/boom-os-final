import { Router, Request } from 'express';
import crypto from 'node:crypto';
import { query, queryOne, transaction } from '../db';
import { authenticateToken, requirePermission, insertAuditLog } from '../auth';

const router = Router();
const NEXT: Record<string, string[]> = {
  NEW: ['PREPARING', 'CANCELLED'],
  PREPARING: ['READY', 'CANCELLED'],
  READY: ['COMPLETED'],
  COMPLETED: [],
  CANCELLED: []
};
function allowed(req: Request, branchId: string) { return Boolean(req.user?.isSuperUser || req.user?.allowedBranchIds.includes(branchId)); }

router.use(authenticateToken);

router.get('/', requirePermission('kds.view'), async (req, res) => {
  const branchId = typeof req.query.branch_id === 'string' ? req.query.branch_id : (req.user!.branch_id || '');
  if (!branchId || !allowed(req, branchId)) return res.status(403).json({ error:'BRANCH_ACCESS_DENIED', code:'BRANCH_ACCESS_DENIED', message:'Branch is outside your access scope.', details:{} });
  const status = typeof req.query.status === 'string' ? req.query.status : null;
  const tickets = await query<any>(`SELECT k.*,o.order_number,o.order_type,o.table_id,t.code AS table_code,o.waiter_user_id,u.full_name AS waiter_name
    FROM kds_tickets k JOIN orders o ON o.id=k.order_id LEFT JOIN dining_tables t ON t.id=o.table_id LEFT JOIN users u ON u.id=o.waiter_user_id
    WHERE k.branch_id=? ${status ? 'AND k.status=?' : ''} ORDER BY k.created_at ASC LIMIT 200`, status ? [branchId,status] : [branchId]);
  const items = tickets.length ? await query<any>(`SELECT oi.* FROM order_items oi WHERE oi.status='ACTIVE' AND oi.order_id IN (${tickets.map(()=>'?').join(',')}) ORDER BY oi.created_at`, tickets.map(x=>x.order_id)) : [];
  const byOrder = new Map<string, any[]>(); for (const i of items) { const a=byOrder.get(i.order_id)||[]; a.push(i); byOrder.set(i.order_id,a); }
  res.json({ branch_id: branchId, tickets: tickets.map(t=>({...t, items:byOrder.get(t.order_id)||[]})) });
});

router.post('/:id/status', requirePermission('kds.update'), async (req,res) => {
  const ticket = await queryOne<any>('SELECT * FROM kds_tickets WHERE id=?',[req.params.id]);
  if (!ticket) return res.status(404).json({error:'NOT_FOUND',code:'KDS_TICKET_NOT_FOUND',message:'KDS ticket not found.',details:{}});
  if (!allowed(req,ticket.branch_id)) return res.status(403).json({error:'BRANCH_ACCESS_DENIED',code:'BRANCH_ACCESS_DENIED',message:'Ticket belongs to an unauthorized branch.',details:{}});
  const next = String(req.body?.status||'').toUpperCase();
  if (!Object.prototype.hasOwnProperty.call(NEXT,ticket.status) || !NEXT[ticket.status].includes(next)) return res.status(409).json({error:'INVALID_STATE',code:'KDS_INVALID_TRANSITION',message:'Invalid KDS status transition.',details:{from:ticket.status,to:next}});
  const now=new Date().toISOString();
  await transaction(async(tx)=>{
    const fields:any={updated_at:now}; if(next==='PREPARING') fields.started_at=now; if(next==='READY') fields.ready_at=now; if(next==='COMPLETED') fields.completed_at=now;
    await tx.execute(`UPDATE kds_tickets SET status=?, started_at=COALESCE(?,started_at), ready_at=COALESCE(?,ready_at), completed_at=COALESCE(?,completed_at), updated_at=? WHERE id=? AND status=?`,[next,fields.started_at||null,fields.ready_at||null,fields.completed_at||null,now,ticket.id,ticket.status]);
    const orderStatus = next === 'PREPARING' ? 'PREPARING' : next === 'READY' ? 'READY' : next === 'COMPLETED' ? 'READY' : 'CANCELLED';
    await tx.execute(`UPDATE orders SET status=?,updated_at=? WHERE id=?`,[orderStatus,now,ticket.order_id]);
    await insertAuditLog(tx.execute,{userId:req.user!.id,branchId:ticket.branch_id,action:'KDS_STATUS_CHANGED',entityType:'KDS_TICKET',entityId:ticket.id,oldValues:{status:ticket.status},newValues:{status:next,order_status:orderStatus},req});
  });
  res.json({ticket:await queryOne<any>('SELECT * FROM kds_tickets WHERE id=?',[ticket.id])});
});
export default router;
