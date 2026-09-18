import { Router, Request } from 'express';
import { query, queryOne } from '../db';
import { authenticateToken, requirePermission } from '../auth';

const router = Router();
router.use(authenticateToken);

function allowed(req: Request, b: string) { return Boolean(req.user?.isSuperUser || req.user?.allowedBranchIds.includes(b)); }
function has(req: Request, code: string) { return Boolean(req.user?.isSuperUser || req.user?.permissions.includes(code)); }
function moneyCents(v: unknown): bigint {
  const s = String(v ?? '0').trim();
  if (!/^-?\d+(?:\.\d{1,2})?$/.test(s)) return 0n;
  const neg = s.startsWith('-'); const clean = neg ? s.slice(1) : s;
  const [a, b = ''] = clean.split('.');
  const c = BigInt(a) * 100n + BigInt((b + '00').slice(0, 2));
  return neg ? -c : c;
}
function centsText(c: bigint): string { const neg = c < 0n; const abs = neg ? -c : c; return `${neg ? '-' : ''}${abs / 100n}.${(abs % 100n).toString().padStart(2, '0')}`; }
function ratioCents(total: bigint, count: number): string { return count > 0 ? centsText(total / BigInt(count)) : '0.00'; }

// ================================================================================================
// GET /api/dashboard/manager -- a single, branch-scoped, date-ranged aggregation of data that
// already exists behind its own endpoint (payments, credit, orders, KDS, waiters, cashiers,
// inventory, staff). It runs one set of GROUP BY queries per section instead of pulling raw rows
// to the frontend, and includes a section only when the caller holds that section's own existing
// permission -- it grants no access beyond what the caller already has through those endpoints.
// ================================================================================================
router.get('/manager', requirePermission('dashboard.view'), async (req, res) => {
  const branchId = String(req.query.branch_id || req.user!.branch_id || '');
  if (!branchId || !allowed(req, branchId)) return res.status(403).json({ error: 'BRANCH_ACCESS_DENIED', code: 'BRANCH_ACCESS_DENIED', message: 'Branch is outside your access scope.', details: {} });
  const now = new Date();
  const start = typeof req.query.start === 'string' && req.query.start ? req.query.start : new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const end = typeof req.query.end === 'string' && req.query.end ? req.query.end : now.toISOString();
  const nowIso = now.toISOString();

  const branch = await queryOne<any>('SELECT id,name,currency FROM branches WHERE id=?', [branchId]);
  if (!branch) return res.status(404).json({ error: 'NOT_FOUND', code: 'BRANCH_NOT_FOUND', message: 'Branch not found.', details: {} });

  const permissions = {
    financial: has(req, 'payments.view'),
    cash_shifts: has(req, 'cash_shifts.view'),
    orders: has(req, 'orders.view'),
    kds: has(req, 'kds.view'),
    waiters: has(req, 'kpi.view'),
    cashiers: has(req, 'payments.view'),
    credit: has(req, 'credit.reports'),
    inventory: has(req, 'inventory.view'),
    staff: has(req, 'employees.view'),
  };

  const response: any = { branch: { id: branch.id, name: branch.name, currency: branch.currency }, period: { start, end }, permissions, alerts: [] };
  const alerts: Array<{ type: string; severity: 'info' | 'warning' | 'critical'; message_key: string; params?: any; link: string }> = [];

  // ---------------------------------------------------------------- FINANCIAL (sales / received / receivables)
  if (permissions.financial) {
    const byMethod = await query<any>(`SELECT method, COALESCE(SUM(amount),0) AS total, COUNT(*)::int AS count FROM payments WHERE branch_id=? AND status='PAID' AND created_at>=? AND created_at<=? GROUP BY method`, [branchId, start, end]);
    const m: Record<string, { total: bigint; count: number }> = {};
    for (const row of byMethod) m[row.method] = { total: moneyCents(row.total), count: row.count };
    const cash = m.CASH?.total || 0n, card = m.CARD?.total || 0n, credit = m.CREDIT?.total || 0n;
    const other = (m.ONLINE?.total || 0n) + (m.BONUS?.total || 0n) + (m.OTHER?.total || 0n);
    const totalSales = cash + card + credit + other;
    const orderCount = (m.CASH?.count || 0) + (m.CARD?.count || 0) + (m.CREDIT?.count || 0) + (m.ONLINE?.count || 0) + (m.BONUS?.count || 0) + (m.OTHER?.count || 0);
    const repayRow = await queryOne<any>(`SELECT COALESCE(SUM(amount),0) AS total FROM credit_transactions WHERE branch_id=? AND type IN ('REPAYMENT','PAYROLL_DEDUCTION') AND created_at>=? AND created_at<=?`, [branchId, start, end]);
    const creditRepayments = moneyCents(repayRow?.total);
    const receivedTotal = cash + card + creditRepayments;
    response.kpi = {
      today_sales: centsText(totalSales),
      cash: centsText(cash),
      card: centsText(card),
      credit: centsText(credit),
      orders: orderCount,
      average_check: ratioCents(totalSales, orderCount),
    };
    response.financial = {
      sales: { cash: centsText(cash), card: centsText(card), credit: centsText(credit), other: centsText(other), total: centsText(totalSales) },
      received: { cash: centsText(cash), card: centsText(card), credit_repayments: centsText(creditRepayments), total: centsText(receivedTotal) },
    };
    const refundRow = await queryOne<any>(`SELECT COALESCE(SUM(amount),0) AS total, COUNT(*)::int AS count FROM payments WHERE branch_id=? AND status='REFUNDED' AND updated_at>=? AND updated_at<=?`, [branchId, start, end]);
    response.financial.refunds = { total: centsText(moneyCents(refundRow?.total)), count: refundRow?.count || 0 };
  }

  // ---------------------------------------------------------------- CASH POSITION
  if (permissions.cash_shifts) {
    const openShift = await queryOne<any>(`SELECT cs.*,u.full_name AS cashier_name FROM cash_shifts cs JOIN users u ON u.id=cs.cashier_user_id WHERE cs.branch_id=? AND cs.status='OPEN'`, [branchId]);
    const lastClosed = await queryOne<any>(`SELECT cs.*,u.full_name AS cashier_name FROM cash_shifts cs JOIN users u ON u.id=cs.cashier_user_id WHERE cs.branch_id=? AND cs.status='CLOSED' AND cs.closed_at>=? AND cs.closed_at<=? ORDER BY cs.closed_at DESC LIMIT 1`, [branchId, start, end]);
    response.cash_position = { open_shift: openShift, last_closed_shift: lastClosed };
    if (openShift) {
      const expected = moneyCents(openShift.opening_cash) + moneyCents(openShift.cash_sales) + moneyCents(openShift.credit_repayments) - moneyCents(openShift.refunds) - moneyCents(openShift.voids);
      response.cash_position.expected_cash = centsText(expected);
      if (new Date(openShift.opened_at) < new Date(start)) {
        alerts.push({ type: 'OPEN_CASH_SHIFT', severity: 'warning', message_key: 'dashboard.alert.openShiftCarriedOver', params: { cashier: openShift.cashier_name }, link: 'cashierPos' });
      }
    }
    if (lastClosed && moneyCents(lastClosed.difference) !== 0n) {
      alerts.push({ type: 'CASH_DIFFERENCE', severity: Math.abs(Number(lastClosed.difference)) > 5 ? 'critical' : 'warning', message_key: 'dashboard.alert.cashDifference', params: { cashier: lastClosed.cashier_name, difference: lastClosed.difference }, link: 'cashierPos' });
    }
  }

  // ---------------------------------------------------------------- ORDERS LIVE STATUS
  if (permissions.orders) {
    const rows = await query<any>(`SELECT status, COUNT(*)::int AS count FROM orders WHERE branch_id=? AND created_at>=? AND created_at<=? GROUP BY status`, [branchId, start, end]);
    const byStatus: Record<string, number> = { PENDING_CONFIRMATION: 0, CONFIRMED: 0, PREPARING: 0, READY: 0, COMPLETED: 0, CANCELLED: 0, REFUNDED: 0 };
    for (const r of rows) byStatus[r.status] = r.count;
    response.orders = { by_status: byStatus, total: rows.reduce((s, r) => s + r.count, 0) };
  }

  // ---------------------------------------------------------------- KDS / KITCHEN
  if (permissions.kds) {
    const rows = await query<any>(`SELECT status, COUNT(*)::int AS count FROM kds_tickets WHERE branch_id=? AND created_at>=? AND created_at<=? GROUP BY status`, [branchId, start, end]);
    const byStatus: Record<string, number> = { NEW: 0, PREPARING: 0, READY: 0, COMPLETED: 0, CANCELLED: 0 };
    for (const r of rows) byStatus[r.status] = r.count;
    const avgRow = await queryOne<any>(`SELECT AVG(EXTRACT(EPOCH FROM (ready_at::timestamptz - started_at::timestamptz))/60) AS avg_minutes, COUNT(*)::int AS samples FROM kds_tickets WHERE branch_id=? AND started_at IS NOT NULL AND ready_at IS NOT NULL AND created_at>=? AND created_at<=?`, [branchId, start, end]);
    const avgPrepMinutes = avgRow?.avg_minutes !== null && avgRow?.avg_minutes !== undefined ? Number(avgRow.avg_minutes) : null;
    const oldestActive = await queryOne<any>(`SELECT k.id,k.order_id,k.status,k.created_at,o.order_number FROM kds_tickets k JOIN orders o ON o.id=k.order_id WHERE k.branch_id=? AND k.status IN ('NEW','PREPARING') ORDER BY k.created_at ASC LIMIT 1`, [branchId]);
    const longestActiveMinutes = oldestActive ? (now.getTime() - new Date(oldestActive.created_at).getTime()) / 60000 : null;
    response.kds = { by_status: byStatus, average_preparation_minutes: avgPrepMinutes !== null ? Math.round(avgPrepMinutes * 10) / 10 : null, longest_active_order: oldestActive ? { order_id: oldestActive.order_id, order_number: oldestActive.order_number, status: oldestActive.status, minutes: Math.round(longestActiveMinutes! * 10) / 10 } : null };
    // Delay is flagged only relative to this branch's own observed average, from at least 3
    // completed samples in range -- never an invented absolute time limit.
    if (avgPrepMinutes !== null && (avgRow?.samples || 0) >= 3 && oldestActive && longestActiveMinutes! > avgPrepMinutes * 2) {
      alerts.push({ type: 'ORDER_DELAY', severity: 'warning', message_key: 'dashboard.alert.orderDelay', params: { order_number: oldestActive.order_number, minutes: Math.round(longestActiveMinutes!) }, link: 'operations' });
    }
  }

  // ---------------------------------------------------------------- WAITER PERFORMANCE
  if (permissions.waiters) {
    const sales = await query<any>(`SELECT o.waiter_user_id AS id, u.full_name AS name, COUNT(DISTINCT o.id)::int AS orders, COALESCE(SUM(p.amount),0) AS sales
      FROM orders o JOIN users u ON u.id=o.waiter_user_id LEFT JOIN payments p ON p.order_id=o.id AND p.status='PAID'
      WHERE o.branch_id=? AND o.waiter_user_id IS NOT NULL AND o.created_at>=? AND o.created_at<=? AND o.status NOT IN ('CANCELLED')
      GROUP BY o.waiter_user_id, u.full_name ORDER BY sales DESC LIMIT 50`, [branchId, start, end]);
    const removals = await query<any>(`SELECT requester_user_id AS id, COUNT(*)::int AS count FROM order_item_removal_approvals WHERE branch_id=? AND created_at>=? AND created_at<=? GROUP BY requester_user_id`, [branchId, start, end]);
    const removalMap = new Map(removals.map((r: any) => [r.id, r.count]));
    const statuses = sales.length ? await query<any>(`SELECT user_id AS id, status FROM waiter_profiles WHERE user_id IN (${sales.map(() => '?').join(',')})`, sales.map((s: any) => s.id)) : [];
    const statusMap = new Map(statuses.map((s: any) => [s.id, s.status]));
    response.waiters = sales.map((s: any) => {
      const salesCents = moneyCents(s.sales);
      return { id: s.id, name: s.name, orders: s.orders, sales: centsText(salesCents), average_check: ratioCents(salesCents, s.orders), status: statusMap.get(s.id) || 'PROBATION', removal_requests: removalMap.get(s.id) || 0 };
    });
  }

  // ---------------------------------------------------------------- CASHIER PERFORMANCE
  if (permissions.cashiers) {
    const rows = await query<any>(`SELECT p.cashier_user_id AS id, u.full_name AS name,
        COUNT(*) FILTER (WHERE p.status='PAID')::int AS orders,
        COALESCE(SUM(p.amount) FILTER (WHERE p.status='PAID'),0) AS sales,
        COALESCE(SUM(p.amount) FILTER (WHERE p.status='PAID' AND p.method='CASH'),0) AS cash,
        COALESCE(SUM(p.amount) FILTER (WHERE p.status='PAID' AND p.method='CARD'),0) AS card,
        COALESCE(SUM(p.amount) FILTER (WHERE p.status='PAID' AND p.method='CREDIT'),0) AS credit,
        COALESCE(SUM(p.amount) FILTER (WHERE p.status='REFUNDED'),0) AS refunds
      FROM payments p JOIN users u ON u.id=p.cashier_user_id
      WHERE p.branch_id=? AND p.created_at>=? AND p.created_at<=?
      GROUP BY p.cashier_user_id, u.full_name ORDER BY sales DESC LIMIT 50`, [branchId, start, end]);
    let creditByCashier = new Map<string, { issued: string; repayments: string }>();
    if (permissions.credit) {
      const creditRows = await query<any>(`SELECT cashier_user_id AS id,
          COALESCE(SUM(amount) FILTER (WHERE type='CREDIT'),0) AS issued,
          COALESCE(SUM(amount) FILTER (WHERE type IN ('REPAYMENT','PAYROLL_DEDUCTION')),0) AS repayments
        FROM credit_transactions WHERE branch_id=? AND created_at>=? AND created_at<=? GROUP BY cashier_user_id`, [branchId, start, end]);
      creditByCashier = new Map(creditRows.map((r: any) => [r.id, { issued: String(r.issued), repayments: String(r.repayments) }]));
    }
    response.cashiers = rows.map((r: any) => ({
      id: r.id, name: r.name, orders: r.orders, sales: centsText(moneyCents(r.sales)),
      cash: centsText(moneyCents(r.cash)), card: centsText(moneyCents(r.card)), credit: centsText(moneyCents(r.credit)), refunds: centsText(moneyCents(r.refunds)),
      ...(permissions.credit ? { credit_issued: creditByCashier.get(r.id)?.issued ?? '0.00', credit_repayments: creditByCashier.get(r.id)?.repayments ?? '0.00' } : {}),
    }));
  }

  // ---------------------------------------------------------------- CREDIT / RECEIVABLES
  if (permissions.credit) {
    const outstanding = await queryOne<any>(`SELECT
        COALESCE(SUM(current_balance),0) AS total,
        COALESCE(SUM(current_balance) FILTER (WHERE type='CUSTOMER'),0) AS customer,
        COALESCE(SUM(current_balance) FILTER (WHERE type='EMPLOYEE'),0) AS staff
      FROM credit_accounts WHERE branch_id=?`, [branchId]);
    const issuedToday = await queryOne<any>(`SELECT COALESCE(SUM(amount),0) AS total, COUNT(*)::int AS count FROM credit_transactions WHERE branch_id=? AND type='CREDIT' AND created_at>=? AND created_at<=?`, [branchId, start, end]);
    const repaidToday = await queryOne<any>(`SELECT COALESCE(SUM(amount),0) AS total, COUNT(*)::int AS count FROM credit_transactions WHERE branch_id=? AND type IN ('REPAYMENT','PAYROLL_DEDUCTION') AND created_at>=? AND created_at<=?`, [branchId, start, end]);
    const topDebtors = await query<any>(`SELECT ca.id AS account_id, ca.type, ca.credit_limit, ca.current_balance, COALESCE(c.name, e.full_name) AS name
      FROM credit_accounts ca LEFT JOIN customers c ON c.id=ca.customer_id LEFT JOIN users e ON e.id=ca.employee_id
      WHERE ca.branch_id=? AND ca.current_balance>0 ORDER BY ca.current_balance DESC LIMIT 5`, [branchId]);
    response.credit = {
      outstanding_total: String(outstanding?.total || '0'), customer_debt: String(outstanding?.customer || '0'), staff_debt: String(outstanding?.staff || '0'),
      issued_today: { total: String(issuedToday?.total || '0'), count: issuedToday?.count || 0 },
      repayments_today: { total: String(repaidToday?.total || '0'), count: repaidToday?.count || 0 },
      top_debtors: topDebtors,
    };
    if (permissions.financial) response.financial.receivables = { customer: String(outstanding?.customer || '0'), staff: String(outstanding?.staff || '0'), total: String(outstanding?.total || '0') };
    const overLimit = await query<any>(`SELECT ca.id, COALESCE(c.name, e.full_name) AS name FROM credit_accounts ca LEFT JOIN customers c ON c.id=ca.customer_id LEFT JOIN users e ON e.id=ca.employee_id WHERE ca.branch_id=? AND ca.current_balance>=ca.credit_limit AND ca.credit_limit>0`, [branchId]);
    for (const acc of overLimit.slice(0, 5)) alerts.push({ type: 'CREDIT_LIMIT_ISSUE', severity: 'warning', message_key: 'dashboard.alert.creditLimit', params: { name: acc.name }, link: 'creditReports' });
  }

  // ---------------------------------------------------------------- INVENTORY
  if (permissions.inventory) {
    const lowStock = await query<any>(`SELECT id,sku,name,unit,current_stock,reorder_point FROM inventory_items WHERE branch_id=? AND active=true AND current_stock<=reorder_point AND current_stock>0 ORDER BY current_stock ASC LIMIT 20`, [branchId]);
    const outOfStock = await query<any>(`SELECT id,sku,name,unit,current_stock,reorder_point FROM inventory_items WHERE branch_id=? AND active=true AND current_stock<=0 ORDER BY updated_at DESC LIMIT 20`, [branchId]);
    const writeOffs = await query<any>(`SELECT sm.id,sm.quantity,sm.reason,sm.created_at,i.name,i.unit FROM stock_movements sm JOIN inventory_items i ON i.id=sm.inventory_item_id WHERE sm.branch_id=? AND sm.type='WASTE' AND sm.created_at>=? AND sm.created_at<=? ORDER BY sm.created_at DESC LIMIT 10`, [branchId, start, end]);
    const receipts = await query<any>(`SELECT sm.id,sm.quantity,sm.created_at,i.name,i.unit FROM stock_movements sm JOIN inventory_items i ON i.id=sm.inventory_item_id WHERE sm.branch_id=? AND sm.type='PURCHASE' AND sm.created_at>=? AND sm.created_at<=? ORDER BY sm.created_at DESC LIMIT 10`, [branchId, start, end]);
    const transfers = await query<any>(`SELECT sm.id,sm.type,sm.quantity,sm.created_at,i.name,i.unit FROM stock_movements sm JOIN inventory_items i ON i.id=sm.inventory_item_id WHERE sm.branch_id=? AND sm.type IN ('TRANSFER_IN','TRANSFER_OUT') AND sm.created_at>=? AND sm.created_at<=? ORDER BY sm.created_at DESC LIMIT 10`, [branchId, start, end]);
    response.inventory = { low_stock: lowStock, out_of_stock: outOfStock, recent_write_offs: writeOffs, recent_receipts: receipts, recent_transfers: transfers };
    for (const item of outOfStock.slice(0, 5)) alerts.push({ type: 'LOW_STOCK', severity: 'critical', message_key: 'dashboard.alert.outOfStock', params: { name: item.name }, link: 'inventory' });
    for (const item of lowStock.slice(0, 5)) alerts.push({ type: 'LOW_STOCK', severity: 'warning', message_key: 'dashboard.alert.lowStock', params: { name: item.name, stock: item.current_stock, unit: item.unit }, link: 'inventory' });
  }

  // ---------------------------------------------------------------- STAFF
  if (permissions.staff) {
    const byStatus = await query<any>(`SELECT employment_status, COUNT(*)::int AS count FROM users WHERE branch_id=? AND deleted_at IS NULL GROUP BY employment_status`, [branchId]);
    const statusMap: Record<string, number> = { ACTIVE: 0, INTERN: 0, PROBATION: 0, ON_LEAVE: 0, SUSPENDED: 0, TERMINATED: 0 };
    for (const r of byStatus) statusMap[r.employment_status] = r.count;
    const waiterQualification = await query<any>(`SELECT wp.status, COUNT(*)::int AS count FROM waiter_profiles wp JOIN users u ON u.id=wp.user_id JOIN user_roles ur ON ur.user_id=u.id JOIN roles r ON r.id=ur.role_id WHERE u.branch_id=? AND u.deleted_at IS NULL AND u.employment_status='ACTIVE' AND r.code='WAITER' GROUP BY wp.status`, [branchId]);
    const activeCashierSessions = await queryOne<any>(`SELECT COUNT(*)::int AS count FROM operator_pos_sessions WHERE branch_id=? AND status='ACTIVE' AND expires_at>?`, [branchId, nowIso]);
    const activeWaiterSessions = await queryOne<any>(`SELECT COUNT(*)::int AS count FROM waiter_pos_sessions WHERE branch_id=? AND status='ACTIVE' AND expires_at>?`, [branchId, nowIso]);
    response.staff = {
      by_employment_status: statusMap,
      total_active: statusMap.ACTIVE,
      waiter_qualification: Object.fromEntries(waiterQualification.map((r: any) => [r.status, r.count])),
      active_pos_sessions: { cashiers: activeCashierSessions?.count || 0, waiters: activeWaiterSessions?.count || 0 },
    };
  }

  response.alerts = alerts;
  res.json(response);
});

export default router;
