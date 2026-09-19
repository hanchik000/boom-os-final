import { Router, Request } from 'express';
import crypto from 'node:crypto';
import { query, queryOne, transaction, TxClient } from '../db';
import { authenticateToken, requirePermission, insertAuditLog } from '../auth';
import { getWaiterSession } from './waiters';
import { recomputeOrderTotals } from '../order-totals';

// Stage 34.4 -- SPLIT BILL / separate checks.
//
//   TABLE -> ORDER -> BILL / SPLIT -> ORDER ITEMS -> PAYMENTS
//
// One table, one ORDER, several BILLS. The order remains the single sale, and the bills are a
// PARTITION of it -- never a copy. That is what makes double-counted revenue structurally
// impossible: analytics keeps reading the order's items exactly once, while each guest settles
// their own part with their own guest record, discount, payment method and receipt.
//
// An order is in exactly one split mode at a time:
//   NONE  -- one settlement for the whole order (the original behaviour, unchanged)
//   ITEMS -- its lines are divided between bills
//   EQUAL -- its total is divided into equal shares

const router = Router();
function allowed(req: Request, b: string){ return Boolean(req.user?.isSuperUser || req.user?.allowedBranchIds.includes(b)); }
function id(prefix: string){ return `${prefix}_${crypto.randomUUID()}`; }

const SPLITTABLE_ORDER_STATUSES = ['PENDING_CONFIRMATION', 'CONFIRMED', 'PREPARING', 'READY'];
export const SPLIT_MODES = ['NONE', 'ITEMS', 'EQUAL'] as const;

const BILL_ERRORS: any = {
  ORDER_NOT_FOUND: [404, 'NOT_FOUND', 'ORDER_NOT_FOUND'],
  ORDER_ACCESS_DENIED: [403, 'BRANCH_ACCESS_DENIED', 'ORDER_ACCESS_DENIED'],
  BRANCH_ACCESS_DENIED: [403, 'BRANCH_ACCESS_DENIED', 'BRANCH_ACCESS_DENIED'],
  ORDER_NOT_SPLITTABLE: [409, 'INVALID_STATE', 'ORDER_NOT_SPLITTABLE'],
  ORDER_ALREADY_SPLIT: [409, 'CONFLICT', 'ORDER_ALREADY_SPLIT'],
  ORDER_NOT_SPLIT: [409, 'INVALID_STATE', 'ORDER_NOT_SPLIT'],
  INVALID_SPLIT_MODE: [400, 'VALIDATION_ERROR', 'INVALID_SPLIT_MODE'],
  INVALID_BILL_COUNT: [400, 'VALIDATION_ERROR', 'INVALID_BILL_COUNT'],
  BILL_NOT_FOUND: [404, 'NOT_FOUND', 'BILL_NOT_FOUND'],
  BILL_ALREADY_PAID: [409, 'INVALID_STATE', 'BILL_ALREADY_PAID'],
  BILL_NOT_EMPTY: [409, 'INVALID_STATE', 'BILL_NOT_EMPTY'],
  ITEM_NOT_FOUND: [404, 'NOT_FOUND', 'ITEM_NOT_FOUND'],
  INVALID_MOVE_QUANTITY: [409, 'INVALID_STATE', 'INVALID_MOVE_QUANTITY'],
  ITEM_MOVE_NOT_ALLOWED_IN_MODE: [409, 'INVALID_STATE', 'ITEM_MOVE_NOT_ALLOWED_IN_MODE'],
  MERGE_BLOCKED_BY_PAID_BILL: [409, 'INVALID_STATE', 'MERGE_BLOCKED_BY_PAID_BILL'],
  CUSTOMER_NOT_FOUND: [404, 'NOT_FOUND', 'CUSTOMER_NOT_FOUND'],
  CUSTOMER_BRANCH_MISMATCH: [403, 'BRANCH_ACCESS_DENIED', 'CUSTOMER_BRANCH_MISMATCH'],
};
function sendBillError(res: any, e: any) {
  const m = BILL_ERRORS[e.message];
  if (!m) throw e;
  return res.status(m[0]).json({ error: m[1], code: m[2], message: e.message, details: e.details || {} });
}

/** Dual auth: a waiter POS session acting on its own order, or an authenticated operator. */
function billAuth(permission: string, handler: (req: Request, res: any, actor: { userId: string; role: string; waiterBranchId?: string; waiterUserId?: string }) => Promise<any>) {
  return async (req: Request, res: any, next: any) => {
    try {
      const session = await getWaiterSession(req);
      if (session) return await handler(req, res, { userId: session.user_id, role: 'WAITER', waiterBranchId: session.branch_id, waiterUserId: session.user_id });
      authenticateToken(req, res, () => {
        requirePermission(permission)(req, res, () => {
          handler(req, res, { userId: req.user!.id, role: req.user!.roleCodes[0] || 'USER' }).catch(next);
        });
      });
    } catch (e) { next(e); }
  };
}

async function loadOpenOrder(tx: TxClient, req: Request, orderId: string, actor: { waiterBranchId?: string; waiterUserId?: string }) {
  const order = await tx.queryOne<any>('SELECT * FROM orders WHERE id=? FOR UPDATE', [orderId]);
  if (!order) throw Object.assign(new Error('ORDER_NOT_FOUND'), { httpStatus: 404 });
  if (actor.waiterBranchId) {
    if (order.branch_id !== actor.waiterBranchId || order.waiter_user_id !== actor.waiterUserId) throw Object.assign(new Error('ORDER_ACCESS_DENIED'), { httpStatus: 403 });
  } else if (!allowed(req, order.branch_id)) throw Object.assign(new Error('BRANCH_ACCESS_DENIED'), { httpStatus: 403 });
  if (!SPLITTABLE_ORDER_STATUSES.includes(order.status)) throw Object.assign(new Error('ORDER_NOT_SPLITTABLE'), { httpStatus: 409 });
  return order;
}

async function billsOf(orderId: string) {
  const bills = await query<any>(`SELECT b.*,c.name AS customer_name FROM order_bills b LEFT JOIN customers c ON c.id=b.customer_id WHERE b.order_id=? AND b.status<>'VOID' ORDER BY b.bill_number`, [orderId]);
  for (const b of bills) {
    b.items = await query<any>(`SELECT id,title_snapshot,quantity,price_snapshot,subtotal,status FROM order_items WHERE bill_id=? AND status='ACTIVE' ORDER BY created_at`, [b.id]);
    b.paid = (await queryOne<any>(`SELECT COALESCE(SUM(amount),0) AS paid FROM payments WHERE bill_id=? AND status='PAID'`, [b.id]))?.paid ?? '0';
  }
  return bills;
}

router.get('/:id/bills', billAuth('orders.view', async (req, res, actor) => {
  const order = await queryOne<any>('SELECT id,branch_id,waiter_user_id,split_mode,final_amount FROM orders WHERE id=?', [String(req.params.id)]);
  if (!order) return res.status(404).json({ error: 'NOT_FOUND', code: 'ORDER_NOT_FOUND', message: 'Order not found.', details: {} });
  if (actor.waiterBranchId) { if (order.branch_id !== actor.waiterBranchId || order.waiter_user_id !== actor.waiterUserId) return res.status(403).json({ error: 'BRANCH_ACCESS_DENIED', code: 'ORDER_ACCESS_DENIED', message: 'Order belongs to another waiter.', details: {} }); }
  else if (!allowed(req, order.branch_id)) return res.status(403).json({ error: 'BRANCH_ACCESS_DENIED', code: 'BRANCH_ACCESS_DENIED', message: 'Order belongs to an unauthorized branch.', details: {} });
  const unassigned = await query<any>(`SELECT id,title_snapshot,quantity,price_snapshot,subtotal FROM order_items WHERE order_id=? AND status='ACTIVE' AND bill_id IS NULL ORDER BY created_at`, [order.id]);
  res.json({ order_id: order.id, split_mode: order.split_mode, order_final_amount: order.final_amount, bills: await billsOf(order.id), unassigned_items: unassigned });
}));

/**
 * Splits an order into separate checks. ITEMS starts with every line unassigned so the waiter can
 * move them; EQUAL divides the order's total into equal shares immediately.
 */
router.post('/:id/bills/split', billAuth('orders.confirm', async (req, res, actor) => {
  const mode = String(req.body?.mode || '').toUpperCase();
  const count = Number(req.body?.count);
  if (!['ITEMS', 'EQUAL'].includes(mode)) return res.status(400).json({ error: 'VALIDATION_ERROR', code: 'INVALID_SPLIT_MODE', message: 'mode must be ITEMS or EQUAL.', details: { modes: ['ITEMS', 'EQUAL'] } });
  if (!Number.isInteger(count) || count < 2 || count > 20) return res.status(400).json({ error: 'VALIDATION_ERROR', code: 'INVALID_BILL_COUNT', message: 'count must be a whole number between 2 and 20.', details: {} });
  const now = new Date().toISOString();
  try {
    const result = await transaction(async (tx) => {
      const order = await loadOpenOrder(tx, req, String(req.params.id), actor);
      if (String(order.split_mode) !== 'NONE') throw Object.assign(new Error('ORDER_ALREADY_SPLIT'), { httpStatus: 409 });
      // An order-level discount and a per-bill discount would be two answers to the same question,
      // so splitting starts from a clean sheet: the order-level discount is released first.
      await tx.execute(`UPDATE order_discounts SET status='REMOVED',removed_at=?,removed_by=? WHERE order_id=? AND bill_id IS NULL AND status='ACTIVE'`, [now, actor.userId, order.id]);
      const created: string[] = [];
      for (let i = 1; i <= count; i++) {
        const billId = id('bill');
        await tx.execute(`INSERT INTO order_bills (id,branch_id,order_id,bill_number,status,subtotal,discount,service_charge,final_amount,created_at,updated_at) VALUES (?,?,?,?,'OPEN',0,0,0,0,?,?)`, [billId, order.branch_id, order.id, i, now, now]);
        created.push(billId);
      }
      await tx.execute('UPDATE orders SET split_mode=?,updated_at=? WHERE id=?', [mode, now, order.id]);
      const totals = await recomputeOrderTotals(tx, order, now);
      await insertAuditLog(tx.execute, { userId: actor.userId, branchId: order.branch_id, action: 'ORDER_SPLIT', entityType: 'ORDER', entityId: order.id, oldValues: { split_mode: order.split_mode }, newValues: { split_mode: mode, bills: count, by_role: actor.role, totals }, req });
      return created;
    });
    res.status(201).json({ order_id: req.params.id, split_mode: mode, bills: await billsOf(String(req.params.id)), created_bill_ids: result });
  } catch (e: any) { return sendBillError(res, e); }
}));

/**
 * Moves a line, or part of a line, onto a bill. Moving part of a line splits the order_item into
 * two rows at the same snapshotted unit price and copies its modifiers, so the money is unchanged.
 * `bill_id: null` returns the line to the unassigned pool.
 */
router.post('/:id/bills/move-item', billAuth('orders.confirm', async (req, res, actor) => {
  const itemId = String(req.body?.order_item_id || '');
  const billId = req.body?.bill_id ? String(req.body.bill_id) : null;
  const rawQty = req.body?.quantity;
  const now = new Date().toISOString();
  try {
    const result = await transaction(async (tx) => {
      const order = await loadOpenOrder(tx, req, String(req.params.id), actor);
      if (String(order.split_mode) !== 'ITEMS') throw Object.assign(new Error('ITEM_MOVE_NOT_ALLOWED_IN_MODE'), { httpStatus: 409, details: { split_mode: order.split_mode } });
      const item = await tx.queryOne<any>(`SELECT * FROM order_items WHERE id=? AND order_id=? AND status='ACTIVE' FOR UPDATE`, [itemId, order.id]);
      if (!item) throw Object.assign(new Error('ITEM_NOT_FOUND'), { httpStatus: 404 });
      if (billId) {
        const bill = await tx.queryOne<any>(`SELECT * FROM order_bills WHERE id=? AND order_id=? AND status<>'VOID' FOR UPDATE`, [billId, order.id]);
        if (!bill) throw Object.assign(new Error('BILL_NOT_FOUND'), { httpStatus: 404 });
        if (bill.status === 'PAID') throw Object.assign(new Error('BILL_ALREADY_PAID'), { httpStatus: 409 });
      }
      if (item.bill_id) {
        const from = await tx.queryOne<any>(`SELECT status FROM order_bills WHERE id=? FOR UPDATE`, [item.bill_id]);
        if (from?.status === 'PAID') throw Object.assign(new Error('BILL_ALREADY_PAID'), { httpStatus: 409 });
      }
      const qty = rawQty === undefined || rawQty === null || String(rawQty).trim() === '' ? Number(item.quantity) : Number(rawQty);
      if (!Number.isInteger(qty) || qty <= 0 || qty > Number(item.quantity)) throw Object.assign(new Error('INVALID_MOVE_QUANTITY'), { httpStatus: 409, details: { available: item.quantity } });
      let movedItemId = item.id;
      if (qty < Number(item.quantity)) {
        const remaining = Number(item.quantity) - qty;
        const unit = String(item.price_snapshot);
        const newId = id('oi');
        await tx.execute(`UPDATE order_items SET quantity=?,subtotal=ROUND(CAST(? AS numeric)*?,2) WHERE id=?`, [remaining, unit, remaining, item.id]);
        await tx.execute(`INSERT INTO order_items (id,order_id,bill_id,menu_item_id,title_snapshot,price_snapshot,quantity,subtotal,comment,status,created_at) VALUES (?,?,?,?,?,CAST(? AS numeric),?,ROUND(CAST(? AS numeric)*?,2),?,'ACTIVE',?)`,
          [newId, order.id, billId, item.menu_item_id, item.title_snapshot, unit, qty, unit, qty, item.comment, now]);
        const mods = await tx.query<any>('SELECT * FROM order_item_modifiers WHERE order_item_id=?', [item.id]);
        for (const m of mods) await tx.execute(`INSERT INTO order_item_modifiers (id,order_item_id,modifier_id,name_snapshot,price_delta_snapshot,quantity,created_at) VALUES (?,?,?,?,CAST(? AS numeric),?,?)`, [id('oim'), newId, m.modifier_id, m.name_snapshot, String(m.price_delta_snapshot), m.quantity, now]);
        movedItemId = newId;
      } else {
        await tx.execute('UPDATE order_items SET bill_id=? WHERE id=?', [billId, item.id]);
      }
      const totals = await recomputeOrderTotals(tx, order, now);
      await insertAuditLog(tx.execute, { userId: actor.userId, branchId: order.branch_id, action: 'ORDER_BILL_ITEM_MOVED', entityType: 'ORDER_BILL', entityId: billId || order.id, newValues: { order_id: order.id, order_item_id: movedItemId, from_bill_id: item.bill_id, to_bill_id: billId, quantity: qty, by_role: actor.role, totals }, req });
      return movedItemId;
    });
    res.json({ order_id: req.params.id, moved_item_id: result, bills: await billsOf(String(req.params.id)) });
  } catch (e: any) { return sendBillError(res, e); }
}));

router.post('/:id/bills/:billId/customer', billAuth('orders.confirm', async (req, res, actor) => {
  const customerId = req.body?.customer_id ? String(req.body.customer_id) : null;
  const now = new Date().toISOString();
  try {
    const result = await transaction(async (tx) => {
      const order = await loadOpenOrder(tx, req, String(req.params.id), actor);
      const bill = await tx.queryOne<any>(`SELECT * FROM order_bills WHERE id=? AND order_id=? AND status<>'VOID' FOR UPDATE`, [String(req.params.billId), order.id]);
      if (!bill) throw Object.assign(new Error('BILL_NOT_FOUND'), { httpStatus: 404 });
      if (bill.status === 'PAID') throw Object.assign(new Error('BILL_ALREADY_PAID'), { httpStatus: 409 });
      if (customerId) {
        const customer = await tx.queryOne<any>('SELECT id,branch_id FROM customers WHERE id=? AND deleted_at IS NULL', [customerId]);
        if (!customer) throw Object.assign(new Error('CUSTOMER_NOT_FOUND'), { httpStatus: 404 });
        if (customer.branch_id !== order.branch_id) throw Object.assign(new Error('CUSTOMER_BRANCH_MISMATCH'), { httpStatus: 403 });
      }
      await tx.execute('UPDATE order_bills SET customer_id=?,updated_at=? WHERE id=?', [customerId, now, bill.id]);
      await tx.execute(`UPDATE order_discounts SET customer_id=? WHERE bill_id=? AND status='ACTIVE'`, [customerId, bill.id]);
      await insertAuditLog(tx.execute, { userId: actor.userId, branchId: order.branch_id, action: customerId ? 'ORDER_BILL_CUSTOMER_ATTACHED' : 'ORDER_BILL_CUSTOMER_DETACHED', entityType: 'ORDER_BILL', entityId: bill.id, oldValues: { customer_id: bill.customer_id }, newValues: { customer_id: customerId, by_role: actor.role }, req });
      return bill.id;
    });
    res.json({ order_id: req.params.id, bill_id: result, bills: await billsOf(String(req.params.id)) });
  } catch (e: any) { return sendBillError(res, e); }
}));

router.delete('/:id/bills/:billId', billAuth('orders.confirm', async (req, res, actor) => {
  const now = new Date().toISOString();
  try {
    await transaction(async (tx) => {
      const order = await loadOpenOrder(tx, req, String(req.params.id), actor);
      const bill = await tx.queryOne<any>(`SELECT * FROM order_bills WHERE id=? AND order_id=? AND status<>'VOID' FOR UPDATE`, [String(req.params.billId), order.id]);
      if (!bill) throw Object.assign(new Error('BILL_NOT_FOUND'), { httpStatus: 404 });
      if (bill.status === 'PAID') throw Object.assign(new Error('BILL_ALREADY_PAID'), { httpStatus: 409 });
      const held = await tx.queryOne<any>(`SELECT id FROM order_items WHERE bill_id=? AND status='ACTIVE' LIMIT 1`, [bill.id]);
      if (held) throw Object.assign(new Error('BILL_NOT_EMPTY'), { httpStatus: 409 });
      // Soft: the bill is voided, never deleted, so its history survives.
      await tx.execute(`UPDATE order_bills SET status='VOID',updated_at=? WHERE id=?`, [now, bill.id]);
      await tx.execute(`UPDATE order_discounts SET status='REMOVED',removed_at=?,removed_by=? WHERE bill_id=? AND status='ACTIVE'`, [now, actor.userId, bill.id]);
      await recomputeOrderTotals(tx, order, now);
      await insertAuditLog(tx.execute, { userId: actor.userId, branchId: order.branch_id, action: 'ORDER_BILL_VOIDED', entityType: 'ORDER_BILL', entityId: bill.id, oldValues: { status: bill.status }, newValues: { status: 'VOID', by_role: actor.role }, req });
    });
    res.json({ order_id: req.params.id, bills: await billsOf(String(req.params.id)) });
  } catch (e: any) { return sendBillError(res, e); }
}));

/** Merge back into a single settlement. Safe by construction: refused once any bill has been paid. */
router.post('/:id/bills/merge', billAuth('orders.confirm', async (req, res, actor) => {
  const now = new Date().toISOString();
  try {
    await transaction(async (tx) => {
      const order = await loadOpenOrder(tx, req, String(req.params.id), actor);
      if (String(order.split_mode) === 'NONE') throw Object.assign(new Error('ORDER_NOT_SPLIT'), { httpStatus: 409 });
      const paid = await tx.queryOne<any>(`SELECT id FROM order_bills WHERE order_id=? AND status='PAID' LIMIT 1`, [order.id]);
      if (paid) throw Object.assign(new Error('MERGE_BLOCKED_BY_PAID_BILL'), { httpStatus: 409 });
      await tx.execute(`UPDATE order_discounts SET status='REMOVED',removed_at=?,removed_by=? WHERE order_id=? AND bill_id IS NOT NULL AND status='ACTIVE'`, [now, actor.userId, order.id]);
      await tx.execute('UPDATE order_items SET bill_id=NULL WHERE order_id=?', [order.id]);
      await tx.execute(`UPDATE order_bills SET status='VOID',updated_at=? WHERE order_id=? AND status<>'VOID'`, [now, order.id]);
      await tx.execute(`UPDATE orders SET split_mode='NONE',updated_at=? WHERE id=?`, [now, order.id]);
      const totals = await recomputeOrderTotals(tx, order, now);
      await insertAuditLog(tx.execute, { userId: actor.userId, branchId: order.branch_id, action: 'ORDER_BILLS_MERGED', entityType: 'ORDER', entityId: order.id, oldValues: { split_mode: order.split_mode }, newValues: { split_mode: 'NONE', by_role: actor.role, totals }, req });
    });
    res.json({ order_id: req.params.id, split_mode: 'NONE', bills: await billsOf(String(req.params.id)) });
  } catch (e: any) { return sendBillError(res, e); }
}));

export default router;
