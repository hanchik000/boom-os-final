import { Router, Request } from 'express';
import crypto from 'node:crypto';
import { query, queryOne, transaction, TxClient } from '../db';
import { authenticateToken, requirePermission, insertAuditLog } from '../auth';
import { getWaiterSession } from './waiters';

// Stage 34.3 -- the CRM customer surface, on the SAME `customers` table the credit module already
// uses. There is one customer record per guest per branch; nothing here forks a second CRM.
//
// A customer profile deliberately carries NO discount field of any kind. Attaching a guest to an
// order never changes its price. A discount exists only because a person granted it on one order.

const router = Router();
function allowed(req: Request, b: string){ return Boolean(req.user?.isSuperUser || req.user?.allowedBranchIds.includes(b)); }
function id(prefix: string){ return `${prefix}_${crypto.randomUUID()}`; }

/**
 * The one create-or-return-existing customer routine, shared by the CRM and credit surfaces so a
 * guest is never duplicated: a branch + phone already on file returns the existing record.
 */
export async function findOrCreateCustomer(tx: TxClient, opts: { branchId: string; name: string; phone: string; email?: string | null; actorUserId: string | null; action: string; req?: any; now: string }) {
  const existing = await tx.queryOne<any>('SELECT * FROM customers WHERE branch_id=? AND phone=? AND deleted_at IS NULL', [opts.branchId, opts.phone]);
  if (existing) return { customer: existing, existed: true };
  const cid = id('cust');
  await tx.execute(`INSERT INTO customers (id,branch_id,name,phone,email,status,created_at,updated_at) VALUES (?,?,?,?,?,'ACTIVE',?,?)`, [cid, opts.branchId, opts.name, opts.phone, opts.email || null, opts.now, opts.now]);
  await insertAuditLog(tx.execute, { userId: opts.actorUserId || undefined, branchId: opts.branchId, action: opts.action, entityType: 'CUSTOMER', entityId: cid, newValues: { name: opts.name, phone: opts.phone }, req: opts.req });
  return { customer: await tx.queryOne<any>('SELECT * FROM customers WHERE id=?', [cid]), existed: false };
}

/**
 * Customer search for the POS. Reachable from a waiter POS session as well as from an authenticated
 * operator, because both waiter and cashier need to identify a guest -- but only ever inside the
 * caller's own branch.
 */
async function posBranch(req: Request): Promise<{ branchId: string; actorId: string | null; role: string } | null> {
  const session = await getWaiterSession(req);
  if (session) return { branchId: session.branch_id, actorId: session.user_id, role: 'WAITER' };
  return null;
}

router.get('/pos/search', async (req, res) => {
  const pos = await posBranch(req);
  if (!pos) return res.status(401).json({error:'WAITER_SESSION_INVALID',code:'WAITER_SESSION_INVALID',message:'Valid Waiter POS session required.',details:{}});
  const search = typeof req.query.search === 'string' ? `%${req.query.search.trim()}%` : null;
  if (!search) return res.json({ branch_id: pos.branchId, customers: [] });
  const customers = await query<any>(`SELECT id,name,phone,email FROM customers WHERE branch_id=? AND deleted_at IS NULL AND (name ILIKE ? OR phone ILIKE ?) ORDER BY name LIMIT 25`, [pos.branchId, search, search]);
  res.json({ branch_id: pos.branchId, customers });
});

router.post('/pos', async (req, res) => {
  const pos = await posBranch(req);
  if (!pos) return res.status(401).json({error:'WAITER_SESSION_INVALID',code:'WAITER_SESSION_INVALID',message:'Valid Waiter POS session required.',details:{}});
  const name = String(req.body?.name || '').trim().slice(0, 200);
  const phone = String(req.body?.phone || '').trim().slice(0, 40);
  if (!name) return res.status(400).json({error:'VALIDATION_ERROR',code:'CUSTOMER_NAME_REQUIRED',message:'A customer name is required.',details:{}});
  if (!phone) return res.status(400).json({error:'VALIDATION_ERROR',code:'CUSTOMER_PHONE_REQUIRED',message:'A customer phone is required to identify the guest across visits.',details:{}});
  const now = new Date().toISOString();
  const result = await transaction(async (tx) => findOrCreateCustomer(tx, { branchId: pos.branchId, name, phone, actorUserId: pos.actorId, action: 'CUSTOMER_CREATED', req, now }));
  res.status(result.existed ? 200 : 201).json(result);
});

router.use(authenticateToken);

router.get('/', requirePermission('customers.view'), async (req, res) => {
  const b = String(req.query.branch_id || req.user!.branch_id || '');
  if (!b || !allowed(req, b)) return res.status(403).json({error:'BRANCH_ACCESS_DENIED',code:'BRANCH_ACCESS_DENIED',message:'Branch is outside your access scope.',details:{}});
  const search = typeof req.query.search === 'string' ? `%${req.query.search.trim()}%` : null;
  const where = search ? 'branch_id=? AND deleted_at IS NULL AND (name ILIKE ? OR phone ILIKE ?)' : 'branch_id=? AND deleted_at IS NULL';
  const params = search ? [b, search, search] : [b];
  res.json({ branch_id: b, customers: await query<any>(`SELECT * FROM customers WHERE ${where} ORDER BY name LIMIT 100`, params) });
});

router.post('/', requirePermission('customers.manage'), async (req, res) => {
  const b = String(req.body?.branch_id || req.user!.branch_id || '');
  if (!b || !allowed(req, b)) return res.status(403).json({error:'BRANCH_ACCESS_DENIED',code:'BRANCH_ACCESS_DENIED',message:'Branch is outside your access scope.',details:{}});
  const name = String(req.body?.name || '').trim().slice(0, 200);
  const phone = String(req.body?.phone || '').trim().slice(0, 40);
  if (!name || !phone) return res.status(400).json({error:'VALIDATION_ERROR',code:'CUSTOMER_FIELDS_REQUIRED',message:'name and phone are required.',details:{}});
  const now = new Date().toISOString();
  const result = await transaction(async (tx) => findOrCreateCustomer(tx, { branchId: b, name, phone, email: req.body?.email ? String(req.body.email) : null, actorUserId: req.user!.id, action: 'CUSTOMER_CREATED', req, now }));
  res.status(result.existed ? 200 : 201).json(result);
});

router.get('/:id', requirePermission('customers.view'), async (req, res) => {
  const c = await queryOne<any>('SELECT * FROM customers WHERE id=? AND deleted_at IS NULL', [req.params.id]);
  if (!c) return res.status(404).json({error:'NOT_FOUND',code:'CUSTOMER_NOT_FOUND',message:'Customer not found.',details:{}});
  if (!allowed(req, c.branch_id)) return res.status(403).json({error:'BRANCH_ACCESS_DENIED',code:'BRANCH_ACCESS_DENIED',message:'Customer belongs to an unauthorized branch.',details:{}});
  const orders = await query<any>(`SELECT id,order_number,status,order_type,subtotal,discount,final_amount,created_at FROM orders WHERE customer_id=? ORDER BY created_at DESC LIMIT 50`, [c.id]);
  const discounts = await query<any>(`SELECT * FROM order_discounts WHERE customer_id=? ORDER BY created_at DESC LIMIT 50`, [c.id]);
  res.json({ customer: c, orders, discounts });
});

export default router;
