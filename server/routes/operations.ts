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
const ACTIVE_ORDER_STATUSES = ['PENDING_CONFIRMATION', 'CONFIRMED', 'PREPARING', 'READY'];
// Raw (unrounded) minutes -- used for threshold classification, which must never lose precision
// to display rounding. displayMinutes() below rounds a value already computed from this for
// showing to the user; it must never feed back into delayState().
function rawMinutesSince(iso: string, now: Date): number { return (now.getTime() - new Date(iso).getTime()) / 60000; }
function minutesSince(iso: string, now: Date): number { return Math.round(rawMinutesSince(iso, now) * 10) / 10; }
function delayState(minutes: number, warn: number, delayed: number): 'NORMAL' | 'WARNING' | 'DELAYED' {
  if (minutes >= delayed) return 'DELAYED';
  if (minutes >= warn) return 'WARNING';
  return 'NORMAL';
}

async function getThresholds(): Promise<{ warning: number; delayed: number }> {
  const rows = await query<any>(`SELECT key,value FROM system_settings WHERE key IN ('KDS_PREP_WARNING_MINUTES','KDS_PREP_DELAYED_MINUTES')`);
  const map: Record<string, string> = {}; for (const r of rows) map[r.key] = r.value;
  const warning = Number(map.KDS_PREP_WARNING_MINUTES ?? 15);
  const delayed = Number(map.KDS_PREP_DELAYED_MINUTES ?? 25);
  return { warning: Number.isFinite(warning) ? warning : 15, delayed: Number.isFinite(delayed) ? delayed : 25 };
}

// ================================================================================================
// GET /api/operations/live -- "what is happening right now." Same discipline as Stage 32's
// /api/dashboard/manager: every section reads existing tables through grouped/aggregated SQL, is
// gated by the SAME permission its own endpoint already requires, and is omitted entirely (not
// just hidden) when the caller lacks that permission. Delay detection uses the configurable
// KDS_PREP_WARNING_MINUTES / KDS_PREP_DELAYED_MINUTES system_settings, never a hardcoded number.
// ================================================================================================
router.get('/live', requirePermission('operations.view'), async (req, res) => {
  const branchId = String(req.query.branch_id || req.user!.branch_id || '');
  if (!branchId || !allowed(req, branchId)) return res.status(403).json({ error: 'BRANCH_ACCESS_DENIED', code: 'BRANCH_ACCESS_DENIED', message: 'Branch is outside your access scope.', details: {} });
  const branch = await queryOne<any>('SELECT id,name,currency FROM branches WHERE id=?', [branchId]);
  if (!branch) return res.status(404).json({ error: 'NOT_FOUND', code: 'BRANCH_NOT_FOUND', message: 'Branch not found.', details: {} });

  const now = new Date();
  const nowIso = now.toISOString();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const { warning, delayed } = await getThresholds();

  const permissions = {
    orders: has(req, 'orders.view'),
    kds: has(req, 'kds.view'),
    tables: has(req, 'tables.view'),
    waiters: has(req, 'kpi.view'),
    removals: has(req, 'orders.item_remove.approve'),
    cash_shifts: has(req, 'cash_shifts.view'),
    pos_sessions: has(req, 'pos.operator') || has(req, 'waiter_codes.manage'),
    credit: has(req, 'credit.reports'),
    inventory: has(req, 'inventory.view'),
  };

  const response: any = { branch: { id: branch.id, name: branch.name, currency: branch.currency }, generated_at: nowIso, thresholds: { warning_minutes: warning, delayed_minutes: delayed }, permissions, alerts: [] };
  const alerts: Array<{ type: string; severity: 'critical' | 'warning' | 'info'; timestamp: string; branch_id: string; entity?: any; message_key: string; params?: any; link: string }> = [];

  // ---------------------------------------------------------------- LIVE ORDER BOARD + per-order delay
  let liveOrders: any[] = [];
  if (permissions.orders) {
    const rows = await query<any>(`SELECT o.id,o.order_number,o.branch_id,o.table_id,t.code AS table_code,o.waiter_user_id,u.full_name AS waiter_name,
        o.order_type,o.status,o.final_amount,o.created_at,
        (SELECT COUNT(*)::int FROM order_items oi WHERE oi.order_id=o.id AND oi.status='ACTIVE') AS item_count,
        (SELECT p.status FROM payments p WHERE p.order_id=o.id ORDER BY p.created_at DESC LIMIT 1) AS payment_status,
        k.status AS kds_status, k.started_at AS kds_started_at, k.created_at AS kds_created_at
      FROM orders o
      LEFT JOIN users u ON u.id=o.waiter_user_id
      LEFT JOIN dining_tables t ON t.id=o.table_id
      LEFT JOIN kds_tickets k ON k.order_id=o.id
      WHERE o.branch_id=? AND o.status IN ('PENDING_CONFIRMATION','CONFIRMED','PREPARING','READY')
      ORDER BY o.created_at ASC LIMIT 150`, [branchId]);
    liveOrders = rows.map((o: any) => {
      const elapsed = minutesSince(o.created_at, now);
      let delay: 'NORMAL' | 'WARNING' | 'DELAYED' = 'NORMAL';
      if (o.status === 'PREPARING' && o.kds_status === 'PREPARING') {
        const since = o.kds_started_at || o.kds_created_at;
        if (since) delay = delayState(rawMinutesSince(since, now), warning, delayed);
      } else if (o.status === 'CONFIRMED' && o.kds_status === 'NEW') {
        if (o.kds_created_at) delay = delayState(rawMinutesSince(o.kds_created_at, now), warning, delayed);
      }
      return {
        id: o.id, order_number: o.order_number, table_code: o.table_code, waiter_name: o.waiter_name,
        order_type: o.order_type, status: o.status, final_amount: o.final_amount, item_count: o.item_count,
        payment_status: o.payment_status || 'UNPAID', created_at: o.created_at, elapsed_minutes: elapsed, delay_state: delay,
      };
    });
    response.live_orders = liveOrders;
    for (const o of liveOrders.filter((x) => x.delay_state === 'DELAYED').slice(0, 5)) {
      alerts.push({ type: 'DELAYED_ORDER', severity: 'critical', timestamp: nowIso, branch_id: branchId, entity: { order_id: o.id, order_number: o.order_number }, message_key: 'ops.alert.delayedOrder', params: { order_number: o.order_number, minutes: o.elapsed_minutes }, link: 'operations' });
    }
  }

  // ---------------------------------------------------------------- KDS OPERATIONAL MONITOR
  if (permissions.kds) {
    const byStatusRows = await query<any>(`SELECT status, COUNT(*)::int AS count FROM kds_tickets WHERE branch_id=? AND status IN ('NEW','PREPARING','READY') GROUP BY status`, [branchId]);
    const byStatus: Record<string, number> = { NEW: 0, PREPARING: 0, READY: 0 };
    for (const r of byStatusRows) byStatus[r.status] = r.count;
    const activeTickets = await query<any>(`SELECT k.id,k.order_id,k.status,k.created_at,k.started_at,o.order_number FROM kds_tickets k JOIN orders o ON o.id=k.order_id WHERE k.branch_id=? AND k.status IN ('NEW','PREPARING') ORDER BY k.created_at ASC LIMIT 100`, [branchId]);
    const ticketsWithDelay = activeTickets.map((t: any) => {
      const since = t.status === 'PREPARING' ? (t.started_at || t.created_at) : t.created_at;
      return { id: t.id, order_id: t.order_id, order_number: t.order_number, status: t.status, elapsed_minutes: minutesSince(since, now), delay_state: delayState(rawMinutesSince(since, now), warning, delayed) };
    });
    const avgRow = await queryOne<any>(`SELECT AVG(EXTRACT(EPOCH FROM (ready_at::timestamptz - started_at::timestamptz))/60) AS avg_minutes, COUNT(*)::int AS samples FROM kds_tickets WHERE branch_id=? AND started_at IS NOT NULL AND ready_at IS NOT NULL AND created_at>=?`, [branchId, todayStart]);
    const avgPrepMinutes = avgRow?.avg_minutes !== null && avgRow?.avg_minutes !== undefined ? Math.round(Number(avgRow.avg_minutes) * 10) / 10 : null;
    response.kds = {
      by_status: byStatus, active_tickets: ticketsWithDelay, active_count: activeTickets.length,
      oldest_active: ticketsWithDelay[0] || null, average_preparation_minutes: avgPrepMinutes,
      delayed_count: ticketsWithDelay.filter((t) => t.delay_state === 'DELAYED').length,
    };
  }

  // ---------------------------------------------------------------- TABLE / ORDER OCCUPANCY
  if (permissions.tables) {
    const tables = await query<any>(`SELECT id,code,name,status FROM dining_tables WHERE branch_id=? ORDER BY code`, [branchId]);
    const orderByTable = new Map(liveOrders.filter((o) => o.table_code).map((o) => [o.table_code, o]));
    const byStatus: Record<string, number> = { AVAILABLE: 0, OCCUPIED: 0 };
    for (const t of tables) byStatus[t.status] = (byStatus[t.status] || 0) + 1;
    response.tables = {
      by_status: byStatus,
      occupied: tables.filter((t: any) => t.status === 'OCCUPIED').map((t: any) => ({ id: t.id, code: t.code, name: t.name, active_order: orderByTable.get(t.code) ? { id: orderByTable.get(t.code).id, order_number: orderByTable.get(t.code).order_number, status: orderByTable.get(t.code).status } : null })),
    };
  }

  // ---------------------------------------------------------------- WAITER WORKLOAD
  if (permissions.waiters) {
    const waiters = await query<any>(`SELECT u.id,u.full_name,u.employment_status,ws.id AS session_id,ws.created_at AS session_started_at,ws.last_seen_at AS session_last_seen
      FROM users u JOIN user_roles ur ON ur.user_id=u.id JOIN roles r ON r.id=ur.role_id
      LEFT JOIN waiter_pos_sessions ws ON ws.user_id=u.id AND ws.branch_id=u.branch_id AND ws.status='ACTIVE' AND ws.expires_at>?
      WHERE u.branch_id=? AND u.deleted_at IS NULL AND u.employment_status='ACTIVE' AND r.code='WAITER' AND r.status='ACTIVE'
      ORDER BY u.full_name`, [nowIso, branchId]);
    const workload = await query<any>(`SELECT waiter_user_id AS id, COUNT(*)::int AS active_orders, COUNT(DISTINCT table_id)::int AS open_tables
      FROM orders WHERE branch_id=? AND waiter_user_id IS NOT NULL AND status IN ('PENDING_CONFIRMATION','CONFIRMED','PREPARING','READY') GROUP BY waiter_user_id`, [branchId]);
    const workloadMap = new Map(workload.map((w: any) => [w.id, w]));
    const salesToday = await query<any>(`SELECT o.waiter_user_id AS id, COALESCE(SUM(p.amount),0) AS sales FROM payments p JOIN orders o ON o.id=p.order_id WHERE p.branch_id=? AND p.status='PAID' AND p.created_at>=? GROUP BY o.waiter_user_id`, [branchId, todayStart]);
    const salesMap = new Map(salesToday.map((s: any) => [s.id, s.sales]));
    const removalCounts = await query<any>(`SELECT requester_user_id AS id, COUNT(*)::int AS count FROM order_item_removal_approvals WHERE branch_id=? AND status='PENDING' GROUP BY requester_user_id`, [branchId]);
    const removalMap = new Map(removalCounts.map((r: any) => [r.id, r.count]));
    response.waiters = waiters.map((w: any) => {
      const wl: any = workloadMap.get(w.id) || { active_orders: 0, open_tables: 0 };
      return {
        id: w.id, name: w.full_name, employment_status: w.employment_status,
        session: w.session_id ? { active: true, started_at: w.session_started_at, last_activity: w.session_last_seen } : { active: false },
        active_orders: wl.active_orders, open_tables: wl.open_tables,
        sales_today: String(salesMap.get(w.id) || '0'),
        pending_removal_requests: removalMap.get(w.id) || 0,
      };
    });
  }

  // ---------------------------------------------------------------- CASHIER OPERATIONS (open shift)
  if (permissions.cash_shifts) {
    const openShift = await queryOne<any>(`SELECT cs.*,u.full_name AS cashier_name FROM cash_shifts cs JOIN users u ON u.id=cs.cashier_user_id WHERE cs.branch_id=? AND cs.status='OPEN'`, [branchId]);
    if (openShift) {
      const expected = moneyCents(openShift.opening_cash) + moneyCents(openShift.cash_sales) + moneyCents(openShift.credit_repayments) - moneyCents(openShift.refunds) - moneyCents(openShift.voids);
      const txCount = await queryOne<any>(`SELECT COUNT(*)::int AS count FROM payments WHERE cash_shift_id=? AND status='PAID'`, [openShift.id]);
      const session = await queryOne<any>(`SELECT id,created_at,last_seen_at FROM operator_pos_sessions WHERE user_id=? AND branch_id=? AND status='ACTIVE' AND expires_at>? ORDER BY created_at DESC LIMIT 1`, [openShift.cashier_user_id, branchId, nowIso]);
      response.cashier_operations = {
        cashier_name: openShift.cashier_name, shift_id: openShift.id, opened_at: openShift.opened_at,
        opening_cash: openShift.opening_cash, cash_sales: openShift.cash_sales, credit_repayments: openShift.credit_repayments, refunds: openShift.refunds,
        expected_cash: centsText(expected), transactions_this_shift: txCount?.count || 0,
        pos_session: session ? { active: true, started_at: session.created_at, last_activity: session.last_seen_at } : { active: false },
      };
      if (new Date(openShift.opened_at) < new Date(todayStart)) {
        alerts.push({ type: 'OPEN_CASH_SHIFT', severity: 'warning', timestamp: nowIso, branch_id: branchId, entity: { shift_id: openShift.id }, message_key: 'ops.alert.openShiftCarriedOver', params: { cashier: openShift.cashier_name }, link: 'cashierPos' });
      }
    } else {
      response.cashier_operations = null;
    }
    const lastClosedToday = await queryOne<any>(`SELECT cs.*,u.full_name AS cashier_name FROM cash_shifts cs JOIN users u ON u.id=cs.cashier_user_id WHERE cs.branch_id=? AND cs.status='CLOSED' AND cs.closed_at>=? ORDER BY cs.closed_at DESC LIMIT 1`, [branchId, todayStart]);
    if (lastClosedToday && moneyCents(lastClosedToday.difference) !== 0n) {
      alerts.push({ type: 'CASH_DIFFERENCE', severity: Math.abs(Number(lastClosedToday.difference)) > 5 ? 'critical' : 'warning', timestamp: lastClosedToday.closed_at, branch_id: branchId, entity: { shift_id: lastClosedToday.id }, message_key: 'ops.alert.cashDifference', params: { cashier: lastClosedToday.cashier_name, difference: lastClosedToday.difference }, link: 'cashierPos' });
    }
  }

  // ---------------------------------------------------------------- ACTIVE POS SESSIONS
  if (permissions.pos_sessions) {
    const operatorSessions = await query<any>(`SELECT s.id,s.created_at,s.last_seen_at,u.full_name AS employee_name FROM operator_pos_sessions s JOIN users u ON u.id=s.user_id WHERE s.branch_id=? AND s.status='ACTIVE' AND s.expires_at>? ORDER BY s.created_at DESC`, [branchId, nowIso]);
    const waiterSessions = await query<any>(`SELECT s.id,s.created_at,s.last_seen_at,u.full_name AS employee_name FROM waiter_pos_sessions s JOIN users u ON u.id=s.user_id WHERE s.branch_id=? AND s.status='ACTIVE' AND s.expires_at>? ORDER BY s.created_at DESC`, [branchId, nowIso]);
    response.pos_sessions = [
      ...operatorSessions.map((s: any) => ({ id: s.id, employee_name: s.employee_name, role: 'CASHIER', started_at: s.created_at, last_activity: s.last_seen_at })),
      ...waiterSessions.map((s: any) => ({ id: s.id, employee_name: s.employee_name, role: 'WAITER', started_at: s.created_at, last_activity: s.last_seen_at })),
    ];
  }

  // ---------------------------------------------------------------- PENDING REMOVAL REQUESTS (also drives the inline action)
  if (permissions.removals) {
    const pending = await query<any>(`SELECT a.id,a.order_id,a.order_item_id,a.requested_quantity,a.reason,a.created_at,o.order_number,oi.title_snapshot,u.full_name AS requester_name
      FROM order_item_removal_approvals a JOIN orders o ON o.id=a.order_id JOIN order_items oi ON oi.id=a.order_item_id LEFT JOIN users u ON u.id=a.requester_user_id
      WHERE a.branch_id=? AND a.status='PENDING' ORDER BY a.created_at ASC LIMIT 50`, [branchId]);
    response.removal_requests = pending;
    for (const r of pending.slice(0, 5)) {
      alerts.push({ type: 'PENDING_REMOVAL_REQUEST', severity: 'warning', timestamp: r.created_at, branch_id: branchId, entity: { approval_id: r.id, order_id: r.order_id }, message_key: 'ops.alert.pendingRemoval', params: { order_number: r.order_number, item: r.title_snapshot, requester: r.requester_name }, link: 'orderApprovals' });
    }
  }

  // ---------------------------------------------------------------- CREDIT (limit issues only -- live/actionable)
  if (permissions.credit) {
    const overLimit = await query<any>(`SELECT ca.id, COALESCE(c.name, e.full_name) AS name FROM credit_accounts ca LEFT JOIN customers c ON c.id=ca.customer_id LEFT JOIN users e ON e.id=ca.employee_id WHERE ca.branch_id=? AND ca.current_balance>=ca.credit_limit AND ca.credit_limit>0`, [branchId]);
    response.credit_alerts_count = overLimit.length;
    for (const acc of overLimit.slice(0, 5)) alerts.push({ type: 'CREDIT_LIMIT_ISSUE', severity: 'warning', timestamp: nowIso, branch_id: branchId, entity: { account_id: acc.id }, message_key: 'ops.alert.creditLimit', params: { name: acc.name }, link: 'creditReports' });
  }

  // ---------------------------------------------------------------- INVENTORY (live actionable alerts)
  if (permissions.inventory) {
    const lowStock = await query<any>(`SELECT id,name,unit,current_stock,reorder_point FROM inventory_items WHERE branch_id=? AND active=true AND current_stock<=reorder_point AND current_stock>0 ORDER BY current_stock ASC LIMIT 10`, [branchId]);
    const outOfStock = await query<any>(`SELECT id,name,unit,current_stock,reorder_point FROM inventory_items WHERE branch_id=? AND active=true AND current_stock<=0 ORDER BY updated_at DESC LIMIT 10`, [branchId]);
    response.inventory_alerts_count = lowStock.length + outOfStock.length;
    for (const item of outOfStock.slice(0, 5)) alerts.push({ type: 'LOW_STOCK', severity: 'critical', timestamp: nowIso, branch_id: branchId, entity: { item_id: item.id }, message_key: 'ops.alert.outOfStock', params: { name: item.name }, link: 'inventory' });
    for (const item of lowStock.slice(0, 5)) alerts.push({ type: 'LOW_STOCK', severity: 'warning', timestamp: nowIso, branch_id: branchId, entity: { item_id: item.id }, message_key: 'ops.alert.lowStock', params: { name: item.name, stock: item.current_stock, unit: item.unit }, link: 'inventory' });
  }

  response.alerts = alerts;
  res.json(response);
});

export default router;
