import crypto from 'node:crypto';
import { TxClient } from './db';
import { insertAuditLog } from './auth';

// Stage 34.1 -- the single place where a cancellation / "closed by establishment" is applied.
//
// The rule this module exists to enforce: REFUNDING MONEY IS NOT RETURNING INGREDIENTS. Once a
// dish has been produced, its ingredients are gone; a financial refund never puts them back on
// the shelf. The financial side (payments, cash shift, credit, service charge) and the inventory
// side (restore / write off / leave as consumed) are therefore applied independently, and the
// inventory outcome is always the explicitly chosen, manager-approved decision recorded on the
// closure row -- never guessed from the refund.
//
// Both entry points (the manager approval endpoint in routes/orders.ts and the gated refund
// endpoint in routes/payments.ts) funnel through applyApprovedClosure(), so there is exactly one
// implementation of the semantics.

export const CLOSURE_TYPES = ['CANCELLATION', 'CLOSED_BY_ESTABLISHMENT'] as const;
export const INVENTORY_TREATMENTS = ['WRITE_OFF', 'NO_WRITE_OFF', 'RESTORE_STOCK'] as const;
export const CLOSABLE_ORDER_STATUSES = ['PENDING_CONFIRMATION', 'CONFIRMED', 'PREPARING', 'READY', 'COMPLETED'];
export const CLOSED_ORDER_STATUSES = ['CANCELLED', 'REFUNDED', 'CLOSED_BY_ESTABLISHMENT'];

function id(prefix: string) { return `${prefix}_${crypto.randomUUID()}`; }

// Quantities and unit costs are DECIMAL(14,4); keep every product in BigInt ten-thousandths so no
// Float ever touches a cost. (Same helpers as payments.ts / food-cost.ts -- deliberately local,
// matching the existing per-module convention.)
function scaled4(v: unknown): bigint {
  const s = String(v ?? '0').trim();
  if (!/^-?\d+(?:\.\d{1,4})?$/.test(s)) return 0n;
  const neg = s.startsWith('-'); const clean = neg ? s.slice(1) : s;
  const [a, b = ''] = clean.split('.');
  const c = BigInt(a) * 10000n + BigInt((b + '0000').slice(0, 4));
  return neg ? -c : c;
}
function fromScaled4(c: bigint): string {
  const neg = c < 0n; const abs = neg ? -c : c;
  return `${neg ? '-' : ''}${abs / 10000n}.${(abs % 10000n).toString().padStart(4, '0')}`;
}

export type ProductionSnapshot = { state: string; started: boolean };

/**
 * The production lifecycle is the pre-existing KDS ticket -- no second state machine was
 * introduced. NOT_STARTED (no ticket) -> QUEUED (NEW) -> PREPARING -> READY -> SERVED (COMPLETED).
 * `started` is authoritative for the "ingredients are already gone" decision and is derived from
 * started_at as well as the status, so a ticket cancelled mid-production still counts as started.
 */
export async function productionSnapshot(tx: TxClient, orderId: string): Promise<ProductionSnapshot> {
  const k = await tx.queryOne<any>('SELECT status,started_at,ready_at,completed_at FROM kds_tickets WHERE order_id=?', [orderId]);
  if (!k) return { state: 'NOT_STARTED', started: false };
  const map: Record<string, string> = { NEW: 'QUEUED', PREPARING: 'PREPARING', READY: 'READY', COMPLETED: 'SERVED', CANCELLED: 'CANCELLED' };
  const state = map[String(k.status)] || 'NOT_STARTED';
  const started = Boolean(k.started_at) || ['PREPARING', 'READY', 'COMPLETED'].includes(String(k.status));
  return { state, started };
}

async function saleMovements(tx: TxClient, orderId: string, branchId: string) {
  return await tx.query<any>(`SELECT inventory_item_id,quantity,unit_cost FROM stock_movements WHERE branch_id=? AND reference_type='ORDER' AND reference_id=? AND type='SALE'`, [branchId, orderId]);
}

/**
 * Applies the approved inventory decision. Returns the production-loss cost (DECIMAL(14,4) text)
 * when products were written off, or null when the decision was to move no stock.
 *
 * - RESTORE_STOCK  : only reachable when production never started; reverses the recorded SALE
 *                    quantities literally (never re-derived from today's recipe).
 * - WRITE_OFF      : never restores. If the order was already paid the SALE movement has already
 *                    removed the stock, so nothing is moved again (moving it twice would
 *                    double-count) and only the loss value is recorded. If the order was never
 *                    paid but production had started, the ingredients were physically used
 *                    without ever being deducted, so they are deducted now as WASTE /
 *                    PRODUCTION_LOSS at the recipe quantity and the current average cost.
 * - NO_WRITE_OFF   : explicitly leaves inventory untouched.
 */
export async function applyInventoryTreatment(tx: TxClient, closure: any, order: any, actorUserId: string, now: string): Promise<string | null> {
  const treatment = String(closure.inventory_treatment);
  const sales = await saleMovements(tx, order.id, order.branch_id);

  if (treatment === 'RESTORE_STOCK') {
    for (const m of sales) {
      await tx.execute(`UPDATE inventory_items SET current_stock=current_stock+CAST(? AS numeric),updated_at=? WHERE id=? AND branch_id=?`, [m.quantity, now, m.inventory_item_id, order.branch_id]);
      await tx.execute(`INSERT INTO stock_movements (id,branch_id,inventory_item_id,type,quantity,unit_cost,reference_type,reference_id,reason,created_by,created_at) VALUES (?,?,?,?,CAST(? AS numeric),CAST(? AS numeric),?,?,?,?,?) ON CONFLICT (branch_id,reference_type,reference_id,inventory_item_id,type) DO NOTHING`, [id('mov'), order.branch_id, m.inventory_item_id, 'RETURN', m.quantity, String(m.unit_cost || '0'), 'PAYMENT_REFUND', order.id, 'Restored: production had not started', actorUserId, now]);
    }
    return null;
  }

  if (treatment === 'NO_WRITE_OFF') return null;

  // WRITE_OFF
  if (sales.length > 0) {
    let lossScaled4 = 0n;
    for (const m of sales) lossScaled4 += (scaled4(m.quantity) * scaled4(m.unit_cost)) / 10000n;
    return fromScaled4(lossScaled4);
  }

  const prod = await productionSnapshot(tx, order.id);
  if (!prod.started) return null; // nothing was produced and nothing was consumed -- no movement

  let lossScaled4 = 0n;
  const items = await tx.query<any>('SELECT id,menu_item_id,quantity FROM order_items WHERE order_id=? AND status=?', [order.id, 'ACTIVE']);
  for (const orderItem of items) {
    if (!orderItem.menu_item_id) continue;
    const recipe = await tx.queryOne<any>('SELECT id,version,yield_qty FROM recipes WHERE branch_id=? AND menu_item_id=? AND active=true', [order.branch_id, orderItem.menu_item_id]);
    if (!recipe) continue;
    const ingredients = await tx.query<any>('SELECT inventory_item_id,quantity FROM recipe_ingredients WHERE recipe_id=?', [recipe.id]);
    for (const ingredient of ingredients) {
      const requiredRow = await tx.queryOne<any>(`SELECT (CAST(? AS DECIMAL(14,4))*CAST(? AS DECIMAL(14,4))/NULLIF(CAST(? AS DECIMAL(14,4)),0)) AS required_qty`, [ingredient.quantity, orderItem.quantity, recipe.yield_qty]);
      const required = String(requiredRow.required_qty);
      const stock = await tx.queryOne<any>('SELECT id,current_stock,average_cost FROM inventory_items WHERE id=? AND branch_id=? FOR UPDATE', [ingredient.inventory_item_id, order.branch_id]);
      if (!stock) continue;
      await tx.execute(`UPDATE inventory_items SET current_stock=current_stock-CAST(? AS numeric),updated_at=? WHERE id=? AND branch_id=?`, [required, now, stock.id, order.branch_id]);
      await tx.execute(`INSERT INTO stock_movements (id,branch_id,inventory_item_id,type,quantity,unit_cost,reference_type,reference_id,reason,created_by,created_at) VALUES (?,?,?,?,CAST(? AS numeric),CAST(? AS numeric),?,?,?,?,?) ON CONFLICT (branch_id,reference_type,reference_id,inventory_item_id,type) DO NOTHING`, [id('mov'), order.branch_id, stock.id, 'WASTE', required, String(stock.average_cost || '0'), 'ORDER_CLOSURE', closure.id, 'PRODUCTION_LOSS', actorUserId, now]);
      lossScaled4 += (scaled4(required) * scaled4(stock.average_cost)) / 10000n;
    }
  }
  return fromScaled4(lossScaled4);
}

/**
 * The financial half: reverses one PAID payment. Inventory is deliberately NOT touched here --
 * that is applyInventoryTreatment()'s job and its outcome is a separate, explicitly approved
 * decision.
 */
export async function refundPaymentFinancials(tx: TxClient, p: any, actorUserId: string, req: any, now: string) {
  await tx.execute(`UPDATE payments SET status='REFUNDED',refunded_at=?,updated_at=? WHERE id=? AND status='PAID'`, [now, now, p.id]);
  if (p.cash_shift_id && p.method === 'CASH') {
    await tx.execute(`UPDATE cash_shifts SET refunds=refunds+CAST(? AS numeric),expected_cash=opening_cash+cash_sales-(refunds+CAST(? AS numeric))-voids,updated_at=? WHERE id=?`, [p.amount, p.amount, now, p.cash_shift_id]);
  }
  if (p.method === 'CREDIT') {
    const creditTx = await tx.queryOne<any>(`SELECT * FROM credit_transactions WHERE payment_id=? AND type='CREDIT'`, [p.id]);
    if (creditTx) {
      const account = await tx.queryOne<any>('SELECT * FROM credit_accounts WHERE id=? FOR UPDATE', [creditTx.credit_account_id]);
      if (account) {
        await tx.execute('UPDATE credit_accounts SET current_balance=current_balance-CAST(? AS numeric),updated_at=? WHERE id=?', [p.amount, now, account.id]);
        await tx.execute(`INSERT INTO credit_transactions (id,credit_account_id,type,amount,order_id,payment_id,branch_id,cashier_user_id,note,created_at) VALUES (?,?,'ADJUSTMENT',CAST(? AS numeric),?,?,?,?,?,?)`, [id('ctx'), account.id, `-${p.amount}`, p.order_id, p.id, p.branch_id, actorUserId, 'Reversed by approved order closure', now]);
      }
    }
  }
  await insertAuditLog(tx.execute, { userId: actorUserId, branchId: p.branch_id, action: 'PAYMENT_REFUNDED', entityType: 'PAYMENT', entityId: p.id, oldValues: { status: 'PAID' }, newValues: { status: 'REFUNDED', amount: p.amount }, req });
}

async function releaseTableIfNoActiveOrders(tx: TxClient, tableId: string, branchId: string, now: string) {
  const active = await tx.queryOne<any>(`SELECT id FROM orders WHERE table_id=? AND branch_id=? AND status NOT IN ('COMPLETED','REFUNDED','CANCELLED','CLOSED_BY_ESTABLISHMENT') LIMIT 1`, [tableId, branchId]);
  if (!active) await tx.execute(`UPDATE dining_tables SET status='AVAILABLE',updated_at=? WHERE id=? AND branch_id=? AND status='OCCUPIED'`, [now, tableId, branchId]);
}

/**
 * Applies an APPROVED closure exactly once: inventory decision, then (only if it was requested and
 * approved) the financial refund, then the final order status. Orders are never physically
 * deleted -- the order keeps its history and simply reaches a terminal status.
 */
export async function applyApprovedClosure(tx: TxClient, closure: any, actorUserId: string, req: any, now: string) {
  const order = await tx.queryOne<any>('SELECT * FROM orders WHERE id=? FOR UPDATE', [closure.order_id]);
  if (!order) throw Object.assign(new Error('ORDER_NOT_FOUND'), { httpStatus: 404 });

  const prod = await productionSnapshot(tx, order.id);
  if (closure.inventory_treatment === 'RESTORE_STOCK' && prod.started) {
    throw Object.assign(new Error('INVENTORY_RESTORE_FORBIDDEN_AFTER_PRODUCTION'), { httpStatus: 409 });
  }

  const writeOffCost = closure.inventory_applied ? null : await applyInventoryTreatment(tx, closure, order, actorUserId, now);

  let refundPaymentId: string | null = closure.refund_payment_id || null;
  if (closure.refund_requested) {
    const payments = await tx.query<any>(`SELECT * FROM payments WHERE order_id=? AND status='PAID' ORDER BY created_at`, [order.id]);
    for (const p of payments) {
      await refundPaymentFinancials(tx, p, actorUserId, req, now);
      refundPaymentId = p.id;
    }
    if (payments.length > 0) {
      await tx.execute(`UPDATE service_charge_ledger SET status='REVERSED' WHERE order_id=? AND status='EARNED'`, [order.id]);
    }
  }

  const refundedAny = Boolean(refundPaymentId);
  const finalStatus = closure.type === 'CLOSED_BY_ESTABLISHMENT' ? 'CLOSED_BY_ESTABLISHMENT' : (refundedAny ? 'REFUNDED' : 'CANCELLED');
  await tx.execute(`UPDATE orders SET status=?,updated_at=? WHERE id=?`, [finalStatus, now, order.id]);
  await tx.execute(`UPDATE kds_tickets SET status='CANCELLED',updated_at=? WHERE order_id=? AND status<>'COMPLETED'`, [now, order.id]);
  if (order.table_id) await releaseTableIfNoActiveOrders(tx, order.table_id, order.branch_id, now);

  await tx.execute(`UPDATE order_closures SET status='APPROVED',approver_user_id=?,decided_at=?,inventory_applied=true,write_off_cost=CAST(? AS numeric),refund_payment_id=? WHERE id=? AND status='PENDING'`, [actorUserId, now, writeOffCost, refundPaymentId, closure.id]);

  await insertAuditLog(tx.execute, {
    userId: actorUserId, branchId: order.branch_id, action: 'ORDER_CLOSURE_APPROVED', entityType: 'ORDER_CLOSURE', entityId: closure.id,
    oldValues: { status: 'PENDING', order_status: order.status },
    newValues: { status: 'APPROVED', type: closure.type, order_status: finalStatus, inventory_treatment: closure.inventory_treatment, production_state_at_decision: prod.state, write_off_cost: writeOffCost, refund_requested: closure.refund_requested, refund_payment_id: refundPaymentId, reason: closure.reason },
    req,
  });

  return {
    closure: await tx.queryOne<any>('SELECT * FROM order_closures WHERE id=?', [closure.id]),
    order: await tx.queryOne<any>('SELECT * FROM orders WHERE id=?', [order.id]),
  };
}
