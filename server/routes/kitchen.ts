// ----------------------------------------------------------------------------------------------
// Stage 42 — the kitchen API.
//
// Every route here is server-authorised, branch-scoped and additive. Nothing in this file writes a
// price, a payment, a bill, a recipe or a stock movement: the kitchen reads the order lines Order
// Core already created and records how they are being cooked.
// ----------------------------------------------------------------------------------------------
import { Router, Request, Response } from 'express';
import crypto from 'node:crypto';
import { query, queryOne, transaction } from '../db';
import { authenticateToken, requirePermission, insertAuditLog } from '../auth';
import { getWaiterSession } from './waiters';
import {
  COMMENT_KINDS, HELP_REASONS, TASK_TRANSITIONS, applyServeTogether, ensureBranchStations, evaluateDelays,
  recalculateCoordinatedOrder, recalculateForOrder, recalculateStationForecast, routeOrderTasks, stationLoad,
  syncOrderStatusFromTasks, thresholdsFor,
} from '../kitchen';

const router = Router();
const nowIso = () => new Date().toISOString();
const num = (v: any, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };

function allowed(req: Request, branchId: string) {
  return Boolean(req.user?.isSuperUser || req.user?.allowedBranchIds.includes(branchId));
}
/** The branch a request may work in: explicit when given, the caller's own otherwise, 403 if neither. */
function scopeBranch(req: Request, res: Response): string | null {
  const branchId = typeof req.query.branch_id === 'string' && req.query.branch_id
    ? req.query.branch_id
    : (typeof req.body?.branch_id === 'string' ? req.body.branch_id : (req.user?.branch_id || ''));
  if (!branchId || !allowed(req, branchId)) {
    res.status(403).json({ error: 'BRANCH_ACCESS_DENIED', code: 'BRANCH_ACCESS_DENIED', message: 'Branch is outside your access scope.', details: {} });
    return null;
  }
  return branchId;
}
const bad = (res: Response, code: string, message: string, details: any = {}) =>
  res.status(400).json({ error: 'VALIDATION_ERROR', code, message, details });

// =============================================================== STATIONS AND ROUTING (CONFIG)
router.get('/stations', authenticateToken, requirePermission('kitchen.stations.view'), async (req, res) => {
  const branchId = scopeBranch(req, res); if (!branchId) return;
  await transaction(async (tx) => { await ensureBranchStations(tx, branchId); });
  const stations = await query<any>(
    `SELECT * FROM kitchen_stations WHERE branch_id=? AND deleted_at IS NULL ORDER BY sort_order, code`, [branchId]);
  res.json({ branch_id: branchId, stations });
});

router.post('/stations', authenticateToken, requirePermission('kitchen.stations.manage'), async (req, res) => {
  const branchId = scopeBranch(req, res); if (!branchId) return;
  const code = String(req.body?.code || '').trim().toUpperCase();
  const nameRu = String(req.body?.name_ru || '').trim();
  const nameTk = String(req.body?.name_tk || '').trim();
  if (!/^[A-Z0-9_]{2,24}$/.test(code)) return bad(res, 'INVALID_STATION_CODE', 'A station code is 2-24 letters, digits or underscores.');
  if (!nameRu || !nameTk) return bad(res, 'STATION_NAME_REQUIRED', 'Both names are required.');
  const ts = nowIso();
  const id = `kst_${crypto.randomUUID()}`;
  try {
    await transaction(async (tx) => {
      await tx.execute(
        `INSERT INTO kitchen_stations (id,branch_id,code,name_ru,name_tk,is_expo,parallel_capacity,sort_order,status,created_at,updated_at)
         VALUES (?,?,?,?,?,?,?,?,'ACTIVE',?,?)`,
        [id, branchId, code, nameRu, nameTk, Boolean(req.body?.is_expo), Math.max(1, num(req.body?.parallel_capacity, 1)), num(req.body?.sort_order, 50), ts, ts]);
      await insertAuditLog(tx.execute, { userId: req.user!.id, branchId, action: 'KITCHEN_STATION_CREATED', entityType: 'KITCHEN_STATION', entityId: id, newValues: { code, name_ru: nameRu }, req });
    });
  } catch (e: any) {
    if (String(e?.message || '').includes('kitchen_stations_branch_code_key')) {
      return res.status(409).json({ error: 'CONFLICT', code: 'STATION_CODE_IN_USE', message: 'This branch already has a station with that code.', details: { code } });
    }
    throw e;
  }
  res.status(201).json({ station: await queryOne<any>('SELECT * FROM kitchen_stations WHERE id=?', [id]) });
});

router.patch('/stations/:id', authenticateToken, requirePermission('kitchen.stations.manage'), async (req, res) => {
  const station = await queryOne<any>('SELECT * FROM kitchen_stations WHERE id=?', [req.params.id]);
  if (!station) return res.status(404).json({ error: 'NOT_FOUND', code: 'STATION_NOT_FOUND', message: 'Station not found.', details: {} });
  if (!allowed(req, station.branch_id)) return res.status(403).json({ error: 'BRANCH_ACCESS_DENIED', code: 'BRANCH_ACCESS_DENIED', message: 'Station belongs to another branch.', details: {} });
  const ts = nowIso();
  const next = {
    name_ru: req.body?.name_ru !== undefined ? String(req.body.name_ru).trim() : station.name_ru,
    name_tk: req.body?.name_tk !== undefined ? String(req.body.name_tk).trim() : station.name_tk,
    parallel_capacity: req.body?.parallel_capacity !== undefined ? Math.max(1, num(req.body.parallel_capacity, 1)) : station.parallel_capacity,
    sort_order: req.body?.sort_order !== undefined ? num(req.body.sort_order, station.sort_order) : station.sort_order,
    status: req.body?.status !== undefined ? (String(req.body.status).toUpperCase() === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE') : station.status,
  };
  if (!next.name_ru || !next.name_tk) return bad(res, 'STATION_NAME_REQUIRED', 'Both names are required.');
  await transaction(async (tx) => {
    await tx.execute('UPDATE kitchen_stations SET name_ru=?,name_tk=?,parallel_capacity=?,sort_order=?,status=?,updated_at=? WHERE id=?',
      [next.name_ru, next.name_tk, next.parallel_capacity, next.sort_order, next.status, ts, station.id]);
    await insertAuditLog(tx.execute, { userId: req.user!.id, branchId: station.branch_id, action: 'KITCHEN_STATION_UPDATED', entityType: 'KITCHEN_STATION', entityId: station.id, oldValues: { name_ru: station.name_ru, status: station.status, parallel_capacity: station.parallel_capacity }, newValues: next, req });
  });
  res.json({ station: await queryOne<any>('SELECT * FROM kitchen_stations WHERE id=?', [station.id]) });
});

// Archiving a station, never deleting it: its finished tasks are the history the forecast learns
// from, and an order's past is not rewritten because a kitchen was reorganised.
router.delete('/stations/:id', authenticateToken, requirePermission('kitchen.stations.manage'), async (req, res) => {
  const station = await queryOne<any>('SELECT * FROM kitchen_stations WHERE id=?', [req.params.id]);
  if (!station) return res.status(404).json({ error: 'NOT_FOUND', code: 'STATION_NOT_FOUND', message: 'Station not found.', details: {} });
  if (!allowed(req, station.branch_id)) return res.status(403).json({ error: 'BRANCH_ACCESS_DENIED', code: 'BRANCH_ACCESS_DENIED', message: 'Station belongs to another branch.', details: {} });
  const openTasks = await queryOne<any>(`SELECT COUNT(*)::int AS n FROM kds_item_tasks WHERE station_id=? AND status IN ('QUEUED','ACCEPTED','IN_PROGRESS')`, [station.id]);
  if (num(openTasks?.n, 0) > 0) {
    return res.status(409).json({ error: 'CONFLICT', code: 'STATION_HAS_OPEN_WORK', message: 'This station still has unfinished items. Reassign them first.', details: { open_tasks: openTasks?.n } });
  }
  const ts = nowIso();
  await transaction(async (tx) => {
    await tx.execute(`UPDATE kitchen_stations SET status='INACTIVE', deleted_at=?, updated_at=? WHERE id=?`, [ts, ts, station.id]);
    await insertAuditLog(tx.execute, { userId: req.user!.id, branchId: station.branch_id, action: 'KITCHEN_STATION_ARCHIVED', entityType: 'KITCHEN_STATION', entityId: station.id, oldValues: { status: station.status }, newValues: { status: 'INACTIVE' }, req });
  });
  res.json({ success: true, message: 'Station archived.' });
});

/** The routing configuration of a branch: per dish and per category. */
router.get('/routes', authenticateToken, requirePermission('menu.view'), async (req, res) => {
  const branchId = scopeBranch(req, res); if (!branchId) return;
  const items = await query<any>(
    `SELECT r.*, mi.name_ru AS item_name_ru, mi.name_tk AS item_name_tk, s.code AS station_code
       FROM menu_item_routes r
       JOIN menu_items mi ON mi.id=r.menu_item_id
       JOIN kitchen_stations s ON s.id=r.station_id
      WHERE s.branch_id=? AND r.status='ACTIVE' ORDER BY mi.name_ru, r.is_secondary`, [branchId]);
  const categories = await query<any>(
    `SELECT r.*, mc.name_ru AS category_name_ru, mc.name_tk AS category_name_tk, s.code AS station_code
       FROM menu_category_routes r
       JOIN menu_categories mc ON mc.id=r.category_id
       JOIN kitchen_stations s ON s.id=r.station_id
      WHERE s.branch_id=? AND r.status='ACTIVE' ORDER BY mc.sort_order`, [branchId]);
  res.json({ branch_id: branchId, item_routes: items, category_routes: categories });
});

/** Replace the station routing of ONE dish. Menu configuration, so it needs menu.manage. */
router.put('/routes/items/:menuItemId', authenticateToken, requirePermission('menu.manage'), async (req, res) => {
  const item = await queryOne<any>('SELECT id,branch_id,category_id FROM menu_items WHERE id=?', [req.params.menuItemId]);
  if (!item) return res.status(404).json({ error: 'NOT_FOUND', code: 'MENU_ITEM_NOT_FOUND', message: 'Dish not found.', details: {} });
  const branchId = item.branch_id || (req.user!.branch_id || '');
  if (!branchId || !allowed(req, branchId)) return res.status(403).json({ error: 'BRANCH_ACCESS_DENIED', code: 'BRANCH_ACCESS_DENIED', message: 'Dish belongs to another branch.', details: {} });
  const routes = Array.isArray(req.body?.routes) ? req.body.routes : [];
  if (routes.length > 4) return bad(res, 'TOO_MANY_ROUTES', 'A dish can pass through at most four stations.');
  const stations = await query<any>(`SELECT id,is_expo FROM kitchen_stations WHERE branch_id=? AND status='ACTIVE' AND deleted_at IS NULL`, [branchId]);
  const byId = new Map(stations.map(s => [s.id, s]));
  for (const r of routes) {
    const st = byId.get(String(r?.station_id));
    if (!st) return bad(res, 'STATION_NOT_IN_BRANCH', 'One of the stations does not belong to this branch.', { station_id: r?.station_id });
    if (st.is_expo) return bad(res, 'EXPO_IS_NOT_A_COOKING_STATION', 'The handover station does not cook items.', { station_id: r?.station_id });
    if (num(r?.standard_minutes, -1) <= 0 || num(r?.standard_minutes, 0) > 240) return bad(res, 'INVALID_STANDARD_MINUTES', 'Standard time must be between 1 and 240 minutes.');
    if (num(r?.tolerance_minutes, -1) < 0 || num(r?.tolerance_minutes, 0) > 120) return bad(res, 'INVALID_TOLERANCE', 'Tolerance must be between 0 and 120 minutes.');
  }
  const ts = nowIso();
  await transaction(async (tx) => {
    const before = await tx.query<any>('SELECT station_id,standard_minutes,is_secondary FROM menu_item_routes WHERE menu_item_id=?', [item.id]);
    await tx.execute('DELETE FROM menu_item_routes WHERE menu_item_id=?', [item.id]);
    for (const r of routes) {
      await tx.execute(
        `INSERT INTO menu_item_routes (id,menu_item_id,station_id,standard_minutes,tolerance_minutes,is_secondary,status,created_at,updated_at)
         VALUES (?,?,?,CAST(? AS numeric),CAST(? AS numeric),?,'ACTIVE',?,?)`,
        [`kir_${crypto.randomUUID()}`, item.id, r.station_id, String(num(r.standard_minutes, 5)), String(num(r.tolerance_minutes, 2)), Boolean(r.is_secondary), ts, ts]);
    }
    await insertAuditLog(tx.execute, { userId: req.user!.id, branchId, action: 'KITCHEN_ROUTE_UPDATED', entityType: 'MENU_ITEM', entityId: item.id, oldValues: { routes: before }, newValues: { routes }, req });
  });
  res.json({ success: true, routes: await query<any>('SELECT * FROM menu_item_routes WHERE menu_item_id=? ORDER BY is_secondary', [item.id]) });
});

/** Replace the station routing of a whole CATEGORY -- the explicit fallback for its dishes. */
router.put('/routes/categories/:categoryId', authenticateToken, requirePermission('menu.manage'), async (req, res) => {
  const category = await queryOne<any>('SELECT id,branch_id FROM menu_categories WHERE id=?', [req.params.categoryId]);
  if (!category) return res.status(404).json({ error: 'NOT_FOUND', code: 'MENU_CATEGORY_NOT_FOUND', message: 'Category not found.', details: {} });
  const branchId = category.branch_id || (req.user!.branch_id || '');
  if (!branchId || !allowed(req, branchId)) return res.status(403).json({ error: 'BRANCH_ACCESS_DENIED', code: 'BRANCH_ACCESS_DENIED', message: 'Category belongs to another branch.', details: {} });
  const stationId = req.body?.station_id ? String(req.body.station_id) : null;
  const ts = nowIso();
  if (stationId) {
    const st = await queryOne<any>(`SELECT id,is_expo FROM kitchen_stations WHERE id=? AND branch_id=? AND status='ACTIVE' AND deleted_at IS NULL`, [stationId, branchId]);
    if (!st) return bad(res, 'STATION_NOT_IN_BRANCH', 'That station does not belong to this branch.', { station_id: stationId });
    if (st.is_expo) return bad(res, 'EXPO_IS_NOT_A_COOKING_STATION', 'The handover station does not cook items.');
  }
  await transaction(async (tx) => {
    await tx.execute('DELETE FROM menu_category_routes WHERE category_id=?', [category.id]);
    if (stationId) {
      await tx.execute(
        `INSERT INTO menu_category_routes (id,category_id,station_id,standard_minutes,tolerance_minutes,status,created_at,updated_at)
         VALUES (?,?,?,CAST(? AS numeric),CAST(? AS numeric),'ACTIVE',?,?)`,
        [`kcr_${crypto.randomUUID()}`, category.id, stationId, String(num(req.body?.standard_minutes, 5)), String(num(req.body?.tolerance_minutes, 2)), ts, ts]);
    }
    await insertAuditLog(tx.execute, { userId: req.user!.id, branchId, action: 'KITCHEN_CATEGORY_ROUTE_UPDATED', entityType: 'MENU_CATEGORY', entityId: category.id, newValues: { station_id: stationId }, req });
  });
  res.json({ success: true, routes: await query<any>('SELECT * FROM menu_category_routes WHERE category_id=?', [category.id]) });
});

// ============================================================================= STATION QUEUES
/**
 * One station's work, in the four columns a cook reads: waiting, accepted, cooking and ready.
 * Reading the queue also refreshes the forecast and the delay states, so there is no background
 * job and no stale screen; the alert dedupe key keeps that safe to do on every read.
 */
router.get('/queue', authenticateToken, requirePermission('kds.view'), async (req, res) => {
  const branchId = scopeBranch(req, res); if (!branchId) return;
  const stationParam = typeof req.query.station_id === 'string' && req.query.station_id ? req.query.station_id : null;
  const unassigned = req.query.station_id === 'UNASSIGNED';
  const stationId = unassigned ? null : stationParam;
  if (stationId) {
    const st = await queryOne<any>('SELECT id FROM kitchen_stations WHERE id=? AND branch_id=?', [stationId, branchId]);
    if (!st) return res.status(404).json({ error: 'NOT_FOUND', code: 'STATION_NOT_FOUND', message: 'Station not found in this branch.', details: {} });
  }
  await transaction(async (tx) => {
    await recalculateStationForecast(tx, branchId, stationId);
    await evaluateDelays(tx, branchId);
  });
  const where = unassigned || !stationId ? 't.station_id IS NULL' : 't.station_id=?';
  const params: any[] = unassigned || !stationId ? [branchId] : [branchId, stationId];
  const tasks = await query<any>(
    `SELECT t.*, o.order_number, o.order_type, o.source, dt.code AS table_code, u.full_name AS waiter_name,
            s.code AS station_code, s.name_ru AS station_name_ru, s.name_tk AS station_name_tk
       FROM kds_item_tasks t
       JOIN orders o ON o.id=t.order_id
       LEFT JOIN dining_tables dt ON dt.id=o.table_id
       LEFT JOIN users u ON u.id=o.waiter_user_id
       LEFT JOIN kitchen_stations s ON s.id=t.station_id
      WHERE t.branch_id=? AND ${where} AND t.status IN ('QUEUED','ACCEPTED','IN_PROGRESS','READY')
      ORDER BY t.priority DESC, t.created_at ASC LIMIT 300`, params);
  const orderIds = [...new Set(tasks.map(t => t.order_id))];
  const comments = orderIds.length
    ? await query<any>(
        `SELECT c.*, u.full_name AS author_name FROM kitchen_comments c LEFT JOIN users u ON u.id=c.author_user_id
          WHERE c.order_id IN (${orderIds.map(() => '?').join(',')}) ORDER BY c.created_at DESC`, orderIds)
    : [];
  const modifiers = tasks.length
    ? await query<any>(
        `SELECT order_item_id, name_snapshot FROM order_item_modifiers WHERE order_item_id IN (${tasks.map(() => '?').join(',')})`,
        tasks.map(t => t.order_item_id))
    : [];
  const byItem = new Map<string, string[]>();
  for (const m of modifiers) { const a = byItem.get(m.order_item_id) || []; a.push(m.name_snapshot); byItem.set(m.order_item_id, a); }
  const byOrder = new Map<string, any[]>();
  for (const c of comments) { const a = byOrder.get(c.order_id) || []; a.push(c); byOrder.set(c.order_id, a); }
  res.json({
    branch_id: branchId,
    station_id: stationId,
    unassigned: !stationId,
    load: await stationLoad(branchId, stationId),
    tasks: tasks.map(t => ({
      ...t,
      modifiers: byItem.get(t.order_item_id) || [],
      comments: (byOrder.get(t.order_id) || []).filter(c => !c.order_item_id || c.order_item_id === t.order_item_id),
    })),
  });
});

/**
 * A station moves one item along. Only the transitions in TASK_TRANSITIONS are possible, the row is
 * locked and re-checked inside the transaction (so two tablets pressing at once cannot both win),
 * and the ORDER's status is then recomputed from ALL of its tasks -- never from this one alone.
 */
router.post('/tasks/:id/status', authenticateToken, requirePermission('kds.update'), async (req, res) => {
  const next = String(req.body?.status || '').toUpperCase();
  const reason = req.body?.reason ? String(req.body.reason).trim().slice(0, 300) : null;
  const out = await transaction(async (tx) => {
    const task = await tx.queryOne<any>('SELECT * FROM kds_item_tasks WHERE id=? FOR UPDATE', [req.params.id]);
    if (!task) return { status: 404, body: { error: 'NOT_FOUND', code: 'KITCHEN_TASK_NOT_FOUND', message: 'This kitchen item no longer exists.', details: {} } };
    if (!allowed(req, task.branch_id)) return { status: 403, body: { error: 'BRANCH_ACCESS_DENIED', code: 'BRANCH_ACCESS_DENIED', message: 'Item belongs to another branch.', details: {} } };
    if (!task.station_id) return { status: 409, body: { error: 'INVALID_STATE', code: 'TASK_NOT_ASSIGNED', message: 'Assign this item to a station before cooking it.', details: {} } };
    const permitted = TASK_TRANSITIONS[task.status] || [];
    if (!permitted.includes(next as any)) {
      return { status: 409, body: { error: 'INVALID_STATE', code: 'KITCHEN_INVALID_TRANSITION', message: 'That step is not possible from the current one.', details: { from: task.status, to: next, allowed: permitted } } };
    }
    const ts = nowIso();
    const changed = await tx.execute(
      `UPDATE kds_item_tasks SET status=?,
              accepted_at=COALESCE(accepted_at, CASE WHEN ?='ACCEPTED' OR ?='IN_PROGRESS' THEN ? END),
              started_at=COALESCE(started_at, CASE WHEN ?='IN_PROGRESS' THEN ? END),
              ready_at=COALESCE(ready_at, CASE WHEN ?='READY' THEN ? END),
              served_at=COALESCE(served_at, CASE WHEN ?='SERVED' THEN ? END),
              cancelled_at=COALESCE(cancelled_at, CASE WHEN ?='CANCELLED' THEN ? END),
              delay_reason=COALESCE(?, delay_reason), updated_at=?
        WHERE id=? AND status=?`,
      [next, next, next, ts, next, ts, next, ts, next, ts, next, ts, reason, ts, task.id, task.status]);
    if (!changed.changes) {
      return { status: 409, body: { error: 'CONFLICT', code: 'KITCHEN_TASK_CHANGED', message: 'Someone else just updated this item. Refresh the screen.', details: {} } };
    }
    const orderStatus = await syncOrderStatusFromTasks(tx, task.order_id);
    await recalculateForOrder(tx, task.branch_id, task.order_id);
    await insertAuditLog(tx.execute, {
      userId: req.user!.id, branchId: task.branch_id, action: 'KITCHEN_TASK_STATUS_CHANGED', entityType: 'KITCHEN_TASK', entityId: task.id,
      oldValues: { status: task.status }, newValues: { status: next, reason, order_status: orderStatus }, req,
    });
    return { status: 200, body: { task: await tx.queryOne<any>('SELECT * FROM kds_item_tasks WHERE id=?', [task.id]), order_status: orderStatus } };
  });
  res.status(out.status).json(out.body);
});

/** A manager moves an item to another station, with a reason. */
router.post('/tasks/:id/assign', authenticateToken, requirePermission('kitchen.tasks.reassign'), async (req, res) => {
  const stationId = String(req.body?.station_id || '');
  const reason = String(req.body?.reason || '').trim();
  if (!stationId) return bad(res, 'STATION_REQUIRED', 'Choose the station this item should go to.');
  if (reason.length < 3) return bad(res, 'REASON_REQUIRED', 'Say why this item is moving.');
  const out = await transaction(async (tx) => {
    const task = await tx.queryOne<any>('SELECT * FROM kds_item_tasks WHERE id=? FOR UPDATE', [req.params.id]);
    if (!task) return { status: 404, body: { error: 'NOT_FOUND', code: 'KITCHEN_TASK_NOT_FOUND', message: 'This kitchen item no longer exists.', details: {} } };
    if (!allowed(req, task.branch_id)) return { status: 403, body: { error: 'BRANCH_ACCESS_DENIED', code: 'BRANCH_ACCESS_DENIED', message: 'Item belongs to another branch.', details: {} } };
    if (['READY', 'SERVED', 'CANCELLED'].includes(task.status)) {
      return { status: 409, body: { error: 'INVALID_STATE', code: 'TASK_ALREADY_FINISHED', message: 'A finished item is not moved to another station.', details: { status: task.status } } };
    }
    const st = await tx.queryOne<any>(`SELECT id,is_expo FROM kitchen_stations WHERE id=? AND branch_id=? AND status='ACTIVE' AND deleted_at IS NULL`, [stationId, task.branch_id]);
    if (!st) return { status: 400, body: { error: 'VALIDATION_ERROR', code: 'STATION_NOT_IN_BRANCH', message: 'That station is not available in this branch.', details: {} } };
    if (st.is_expo) return { status: 400, body: { error: 'VALIDATION_ERROR', code: 'EXPO_IS_NOT_A_COOKING_STATION', message: 'The handover station does not cook items.', details: {} } };
    const ts = nowIso();
    const moved = await tx.execute(
      `UPDATE kds_item_tasks SET station_id=?, reassigned_from=?, reassign_reason=?, status='QUEUED', accepted_at=NULL, started_at=NULL,
              expected_minutes=NULL, forecast_start_at=NULL, forecast_ready_at=NULL, forecast_confidence=NULL, delay_state='NONE', updated_at=?
        WHERE id=? AND status=?`, [stationId, task.station_id, reason, ts, task.id, task.status]);
    if (!moved.changes) return { status: 409, body: { error: 'CONFLICT', code: 'KITCHEN_TASK_CHANGED', message: 'Someone else just updated this item. Refresh the screen.', details: {} } };
    await recalculateStationForecast(tx, task.branch_id, stationId);
    if (task.station_id) await recalculateStationForecast(tx, task.branch_id, task.station_id);
    await syncOrderStatusFromTasks(tx, task.order_id);
    await insertAuditLog(tx.execute, {
      userId: req.user!.id, branchId: task.branch_id, action: 'KITCHEN_TASK_REASSIGNED', entityType: 'KITCHEN_TASK', entityId: task.id,
      oldValues: { station_id: task.station_id, status: task.status }, newValues: { station_id: stationId, reason }, req,
    });
    return { status: 200, body: { task: await tx.queryOne<any>('SELECT * FROM kds_item_tasks WHERE id=?', [task.id]) } };
  });
  res.status(out.status).json(out.body);
});

/** A station reports a problem with one item. The record is an alert, not a status change. */
router.post('/tasks/:id/problem', authenticateToken, requirePermission('kds.update'), async (req, res) => {
  const reason = String(req.body?.reason || '').trim();
  if (reason.length < 3) return bad(res, 'REASON_REQUIRED', 'Describe the problem.');
  const task = await queryOne<any>('SELECT * FROM kds_item_tasks WHERE id=?', [req.params.id]);
  if (!task) return res.status(404).json({ error: 'NOT_FOUND', code: 'KITCHEN_TASK_NOT_FOUND', message: 'This kitchen item no longer exists.', details: {} });
  if (!allowed(req, task.branch_id)) return res.status(403).json({ error: 'BRANCH_ACCESS_DENIED', code: 'BRANCH_ACCESS_DENIED', message: 'Item belongs to another branch.', details: {} });
  const order = await queryOne<any>('SELECT order_number FROM orders WHERE id=?', [task.order_id]);
  const id = `problem:${task.id}:${Date.now()}`;
  await transaction(async (tx) => {
    await tx.execute('UPDATE kds_item_tasks SET delay_reason=?, updated_at=? WHERE id=?', [reason.slice(0, 300), nowIso(), task.id]);
    const { raiseAlert } = await import('../kitchen');
    await raiseAlert(tx, {
      branchId: task.branch_id, stationId: task.station_id, orderId: task.order_id, taskId: task.id,
      type: 'PROBLEM', severity: 'HIGH', audience: 'KITCHEN_MANAGER', reason: reason.slice(0, 300),
      messageRu: `Заказ №${order?.order_number}: проблема с «${task.title_snapshot}» — ${reason.slice(0, 160)}`,
      messageTk: `Sargyt №${order?.order_number}: «${task.title_snapshot}» bilen mesele — ${reason.slice(0, 160)}`,
      dedupeKey: id, createdBy: req.user!.id,
    });
    await insertAuditLog(tx.execute, { userId: req.user!.id, branchId: task.branch_id, action: 'KITCHEN_PROBLEM_REPORTED', entityType: 'KITCHEN_TASK', entityId: task.id, newValues: { reason }, req });
  });
  res.status(201).json({ success: true });
});

/** A station asks for help: people, equipment, ingredients, an unclear item, or something urgent. */
router.post('/help-requests', authenticateToken, requirePermission('kitchen.help.request'), async (req, res) => {
  const branchId = scopeBranch(req, res); if (!branchId) return;
  const reason = String(req.body?.reason || '').toUpperCase();
  if (!(HELP_REASONS as readonly string[]).includes(reason)) return bad(res, 'INVALID_HELP_REASON', 'Choose one of the listed reasons.', { reasons: HELP_REASONS });
  const comment = req.body?.comment ? String(req.body.comment).trim().slice(0, 300) : null;
  const stationId = req.body?.station_id ? String(req.body.station_id) : null;
  if (stationId) {
    const st = await queryOne<any>('SELECT id FROM kitchen_stations WHERE id=? AND branch_id=?', [stationId, branchId]);
    if (!st) return bad(res, 'STATION_NOT_IN_BRANCH', 'That station is not in this branch.');
  }
  const orderId = req.body?.order_id ? String(req.body.order_id) : null;
  if (orderId) {
    const o = await queryOne<any>('SELECT id,branch_id FROM orders WHERE id=?', [orderId]);
    if (!o || o.branch_id !== branchId) return bad(res, 'ORDER_NOT_IN_BRANCH', 'That order is not in this branch.');
  }
  const { raiseAlert } = await import('../kitchen');
  await transaction(async (tx) => {
    await raiseAlert(tx, {
      branchId, stationId, orderId, type: 'HELP_REQUEST', severity: reason === 'URGENT' ? 'CRITICAL' : 'HIGH',
      audience: 'KITCHEN_MANAGER', reason, messageRu: comment, messageTk: comment,
      dedupeKey: `help:${branchId}:${stationId || 'ALL'}:${reason}:${Date.now()}`, createdBy: req.user!.id,
    });
    await insertAuditLog(tx.execute, { userId: req.user!.id, branchId, action: 'KITCHEN_HELP_REQUESTED', entityType: 'KITCHEN_ALERT', entityId: `${branchId}:${reason}`, newValues: { station_id: stationId, reason, comment, order_id: orderId }, req });
  });
  res.status(201).json({ success: true });
});

// ================================================================================== COMMENTS
/**
 * What the floor tells the kitchen. Reachable from the waiter device session as well as from a
 * logged-in cashier or manager, exactly like the existing compliment and closure requests.
 *
 * A comment can never change what was ordered: there is no quantity, price or recipe in this
 * payload, and the order's own rows are not touched. If cooking has already started the comment is
 * flagged as late and the station is alerted, because by then it may be too late to honour.
 */
router.post('/comments', async (req: Request, res: Response, next) => {
  const handle = async (actor: { userId: string | null; role: string; source: string; waiterBranchId?: string; waiterUserId?: string }) => {
    const orderId = String(req.body?.order_id || '');
    const kind = String(req.body?.kind || 'FREE_TEXT').toUpperCase();
    const text = req.body?.text ? String(req.body.text).trim().slice(0, 500) : null;
    const orderItemId = req.body?.order_item_id ? String(req.body.order_item_id) : null;
    if (!(COMMENT_KINDS as readonly string[]).includes(kind)) return res.status(400).json({ error: 'VALIDATION_ERROR', code: 'INVALID_COMMENT_KIND', message: 'Choose one of the quick notes or write your own.', details: { kinds: COMMENT_KINDS } });
    if (kind === 'FREE_TEXT' && !text) return res.status(400).json({ error: 'VALIDATION_ERROR', code: 'COMMENT_TEXT_REQUIRED', message: 'Write the note for the kitchen.', details: {} });
    const out = await transaction(async (tx) => {
      const order = await tx.queryOne<any>('SELECT id,branch_id,status,waiter_user_id,order_number FROM orders WHERE id=?', [orderId]);
      if (!order) return { status: 404, body: { error: 'NOT_FOUND', code: 'ORDER_NOT_FOUND', message: 'Order not found.', details: {} } };
      if (actor.waiterBranchId) {
        if (order.branch_id !== actor.waiterBranchId || order.waiter_user_id !== actor.waiterUserId) {
          return { status: 403, body: { error: 'FORBIDDEN', code: 'ORDER_ACCESS_DENIED', message: 'This order is not yours.', details: {} } };
        }
      } else if (!allowed(req, order.branch_id)) {
        return { status: 403, body: { error: 'BRANCH_ACCESS_DENIED', code: 'BRANCH_ACCESS_DENIED', message: 'Order belongs to another branch.', details: {} } };
      }
      if (orderItemId) {
        const line = await tx.queryOne<any>('SELECT id FROM order_items WHERE id=? AND order_id=?', [orderItemId, order.id]);
        if (!line) return { status: 404, body: { error: 'NOT_FOUND', code: 'ORDER_ITEM_NOT_FOUND', message: 'That line is not part of this order.', details: {} } };
      }
      const started = await tx.queryOne<any>(
        `SELECT COUNT(*)::int AS n FROM kds_item_tasks WHERE order_id=? ${orderItemId ? 'AND order_item_id=?' : ''} AND status IN ('IN_PROGRESS','READY','SERVED')`,
        orderItemId ? [order.id, orderItemId] : [order.id]);
      const afterStart = num(started?.n, 0) > 0;
      const id = `kcm_${crypto.randomUUID()}`;
      const ts = nowIso();
      await tx.execute(
        `INSERT INTO kitchen_comments (id,branch_id,order_id,order_item_id,kind,text,author_user_id,author_role,source,after_start,created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        [id, order.branch_id, order.id, orderItemId, kind, text, actor.userId, actor.role, actor.source, afterStart, ts]);
      // Stage 43: "подать вместе" is the one note that changes HOW the kitchen plans, so it is
      // applied to the order's tasks and the stations are re-paced to the slowest of them. It still
      // changes nothing about what was ordered or what it costs.
      if (kind === 'SERVE_TOGETHER') {
        await applyServeTogether(tx, order.id);
        await recalculateCoordinatedOrder(tx, order.id);
      }
      if (afterStart) {
        const { raiseAlert } = await import('../kitchen');
        await raiseAlert(tx, {
          branchId: order.branch_id, orderId: order.id, type: 'COMMENT_AFTER_START', severity: 'HIGH', audience: 'KITCHEN',
          reason: kind, messageRu: `Заказ №${order.order_number}: уточнение пришло, когда блюдо уже готовится.`,
          messageTk: `Sargyt №${order.order_number}: nahar eýýäm taýýarlananda düşündiriş geldi.`,
          dedupeKey: `comment:${id}`, createdBy: actor.userId,
        });
      }
      await insertAuditLog(tx.execute, {
        userId: actor.userId || undefined, branchId: order.branch_id, action: 'KITCHEN_COMMENT_CREATED', entityType: 'KITCHEN_COMMENT', entityId: id,
        newValues: { order_id: order.id, order_item_id: orderItemId, kind, text, after_start: afterStart, source: actor.source }, req,
      });
      return { status: 201, body: { comment: await tx.queryOne<any>('SELECT * FROM kitchen_comments WHERE id=?', [id]), after_start: afterStart } };
    });
    return res.status(out.status).json(out.body);
  };
  try {
    const session = await getWaiterSession(req);
    if (session) return await handle({ userId: session.user_id, role: 'WAITER', source: 'WAITER_POS', waiterBranchId: session.branch_id, waiterUserId: session.user_id });
    authenticateToken(req, res, () => {
      requirePermission('kitchen.comments.create')(req, res, () => {
        handle({ userId: req.user!.id, role: req.user!.roleCodes[0] || 'USER', source: 'ADMIN' }).catch(next);
      });
    });
  } catch (e) { next(e); }
});

/** The kitchen marks a note as seen. */
router.post('/comments/:id/ack', authenticateToken, requirePermission('kds.update'), async (req, res) => {
  const comment = await queryOne<any>('SELECT * FROM kitchen_comments WHERE id=?', [req.params.id]);
  if (!comment) return res.status(404).json({ error: 'NOT_FOUND', code: 'KITCHEN_COMMENT_NOT_FOUND', message: 'Note not found.', details: {} });
  if (!allowed(req, comment.branch_id)) return res.status(403).json({ error: 'BRANCH_ACCESS_DENIED', code: 'BRANCH_ACCESS_DENIED', message: 'Note belongs to another branch.', details: {} });
  const ts = nowIso();
  await transaction(async (tx) => {
    await tx.execute('UPDATE kitchen_comments SET acknowledged_at=COALESCE(acknowledged_at,?), acknowledged_by=COALESCE(acknowledged_by,?) WHERE id=?', [ts, req.user!.id, comment.id]);
  });
  res.json({ success: true });
});

// ====================================================================================== EXPO
/** Every order the kitchen is working on, with the state of each station's part of it. */
router.get('/expo', authenticateToken, requirePermission('kitchen.expo.view'), async (req, res) => {
  const branchId = scopeBranch(req, res); if (!branchId) return;
  await transaction(async (tx) => { await evaluateDelays(tx, branchId); });
  const tasks = await query<any>(
    `SELECT t.*, o.order_number, o.order_type, o.status AS order_status, dt.code AS table_code, u.full_name AS waiter_name,
            s.code AS station_code, s.name_ru AS station_name_ru, s.name_tk AS station_name_tk
       FROM kds_item_tasks t
       JOIN orders o ON o.id=t.order_id
       LEFT JOIN dining_tables dt ON dt.id=o.table_id
       LEFT JOIN users u ON u.id=o.waiter_user_id
       LEFT JOIN kitchen_stations s ON s.id=t.station_id
      WHERE t.branch_id=? AND t.status<>'CANCELLED' AND o.status IN ('CONFIRMED','PREPARING','READY')
      ORDER BY o.created_at ASC, t.created_at ASC LIMIT 400`, [branchId]);
  const orders = new Map<string, any>();
  for (const t of tasks) {
    if (!orders.has(t.order_id)) {
      orders.set(t.order_id, {
        order_id: t.order_id, order_number: t.order_number, order_type: t.order_type, order_status: t.order_status,
        table_code: t.table_code, waiter_name: t.waiter_name, items: [], all_ready: true, forecast_ready_at: null as string | null,
        serve_together: false, coordinated_ready_at: null as string | null,
      });
    }
    const o = orders.get(t.order_id)!;
    o.items.push(t);
    if (t.serve_together) { o.serve_together = true; o.coordinated_ready_at = t.coordinated_ready_at || o.coordinated_ready_at; }
    if (t.status !== 'READY' && t.status !== 'SERVED') o.all_ready = false;
    if (t.forecast_ready_at && (!o.forecast_ready_at || t.forecast_ready_at > o.forecast_ready_at)) o.forecast_ready_at = t.forecast_ready_at;
  }
  const ids = [...orders.keys()];
  const comments = ids.length
    ? await query<any>(`SELECT * FROM kitchen_comments WHERE order_id IN (${ids.map(() => '?').join(',')}) ORDER BY created_at DESC`, ids)
    : [];
  const handovers = ids.length
    ? await query<any>(`SELECT * FROM expo_handovers WHERE order_id IN (${ids.map(() => '?').join(',')}) ORDER BY created_at DESC`, ids)
    : [];
  for (const c of comments) orders.get(c.order_id)?.items && (orders.get(c.order_id)!.comments = [...(orders.get(c.order_id)!.comments || []), c]);
  for (const h of handovers) orders.get(h.order_id) && (orders.get(h.order_id)!.handovers = [...(orders.get(h.order_id)!.handovers || []), h]);
  res.json({ branch_id: branchId, orders: [...orders.values()] });
});

/**
 * The handover. A complete order is handed to the waiter; an INCOMPLETE one can only be released by
 * someone who additionally holds the override permission, and only with a reason, and it is
 * recorded as exactly that -- never as "fully ready".
 *
 * Nothing here touches payment, refunds or closing the order: that stays Order Core's.
 */
router.post('/expo/:orderId/handover', authenticateToken, requirePermission('kitchen.expo.handover'), async (req, res) => {
  const allowIncomplete = Boolean(req.body?.allow_incomplete);
  const reason = req.body?.reason ? String(req.body.reason).trim().slice(0, 300) : '';
  const out = await transaction(async (tx) => {
    const order = await tx.queryOne<any>('SELECT * FROM orders WHERE id=? FOR UPDATE', [req.params.orderId]);
    if (!order) return { status: 404, body: { error: 'NOT_FOUND', code: 'ORDER_NOT_FOUND', message: 'Order not found.', details: {} } };
    if (!allowed(req, order.branch_id)) return { status: 403, body: { error: 'BRANCH_ACCESS_DENIED', code: 'BRANCH_ACCESS_DENIED', message: 'Order belongs to another branch.', details: {} } };
    const tasks = await tx.query<any>(`SELECT * FROM kds_item_tasks WHERE order_id=? AND status<>'CANCELLED'`, [order.id]);
    if (!tasks.length) return { status: 409, body: { error: 'INVALID_STATE', code: 'ORDER_HAS_NO_KITCHEN_WORK', message: 'This order has nothing for the kitchen to hand over.', details: {} } };
    const already = await tx.queryOne<any>(`SELECT id FROM expo_handovers WHERE order_id=? AND kind IN ('HANDED_OVER','INCOMPLETE_OVERRIDE') LIMIT 1`, [order.id]);
    if (already) return { status: 409, body: { error: 'CONFLICT', code: 'ORDER_ALREADY_HANDED_OVER', message: 'This order has already been handed over.', details: {} } };
    const missing = tasks.filter(t => t.status !== 'READY' && t.status !== 'SERVED');
    if (missing.length) {
      if (!allowIncomplete) {
        return { status: 409, body: { error: 'INVALID_STATE', code: 'ORDER_NOT_FULLY_READY', message: 'Not every item is ready yet.', details: { missing: missing.map(m => ({ task_id: m.id, title: m.title_snapshot, status: m.status })) } } };
      }
      // Releasing an incomplete order is a separate, named authority -- hiding the button would not
      // be a control, so the server demands the permission itself.
      const canOverride = req.user!.isSuperUser || req.user!.permissions.includes('kitchen.expo.override');
      if (!canOverride) {
        return { status: 403, body: { error: 'FORBIDDEN', code: 'EXPO_OVERRIDE_FORBIDDEN', message: 'Only a manager may release an incomplete order.', details: {} } };
      }
      if (reason.length < 3) return { status: 400, body: { error: 'VALIDATION_ERROR', code: 'REASON_REQUIRED', message: 'Say why the order is going out incomplete.', details: {} } };
    }
    const ts = nowIso();
    const kind = missing.length ? 'INCOMPLETE_OVERRIDE' : 'HANDED_OVER';
    const id = `exh_${crypto.randomUUID()}`;
    await tx.execute(
      `INSERT INTO expo_handovers (id,branch_id,order_id,kind,missing_items,reason,actor_user_id,actor_role,created_at) VALUES (?,?,?,?,?,?,?,?,?)`,
      [id, order.branch_id, order.id, kind, missing.length ? JSON.stringify(missing.map(m => ({ task_id: m.id, title: m.title_snapshot, status: m.status }))) : null,
       reason || null, req.user!.id, req.user!.roleCodes[0] || null, ts]);
    // Ready items become served; what was never cooked stays exactly as it is.
    await tx.execute(`UPDATE kds_item_tasks SET status='SERVED', served_at=COALESCE(served_at,?), updated_at=? WHERE order_id=? AND status='READY'`, [ts, ts, order.id]);
    const { raiseAlert } = await import('../kitchen');
    await raiseAlert(tx, {
      branchId: order.branch_id, orderId: order.id, type: kind === 'HANDED_OVER' ? 'ORDER_HANDED_OVER' : 'ORDER_HANDED_OVER_INCOMPLETE',
      severity: kind === 'HANDED_OVER' ? 'INFO' : 'HIGH', audience: 'WAITER', reason: reason || null,
      messageRu: kind === 'HANDED_OVER' ? `Заказ №${order.order_number} собран и передан официанту.` : `Заказ №${order.order_number} передан НЕ полностью: ${reason}`,
      messageTk: kind === 'HANDED_OVER' ? `Sargyt №${order.order_number} ýygnaldy we ofisianta berildi.` : `Sargyt №${order.order_number} doly däl berildi: ${reason}`,
      dedupeKey: `handover:${order.id}`, createdBy: req.user!.id,
    });
    await insertAuditLog(tx.execute, {
      userId: req.user!.id, branchId: order.branch_id, action: kind === 'HANDED_OVER' ? 'EXPO_ORDER_HANDED_OVER' : 'EXPO_ORDER_HANDED_OVER_INCOMPLETE',
      entityType: 'ORDER', entityId: order.id, newValues: { handover_id: id, kind, reason: reason || null, missing: missing.map(m => m.id) }, req,
    });
    return { status: 201, body: { handover: await tx.queryOne<any>('SELECT * FROM expo_handovers WHERE id=?', [id]) } };
  });
  res.status(out.status).json(out.body);
});

/** EXPO sends one item back to its station, with a reason. */
router.post('/expo/:orderId/return-item', authenticateToken, requirePermission('kitchen.expo.handover'), async (req, res) => {
  const taskId = String(req.body?.task_id || '');
  const reason = String(req.body?.reason || '').trim();
  if (!taskId) return bad(res, 'TASK_REQUIRED', 'Choose the item to send back.');
  if (reason.length < 3) return bad(res, 'REASON_REQUIRED', 'Say what is wrong with it.');
  const out = await transaction(async (tx) => {
    const task = await tx.queryOne<any>('SELECT * FROM kds_item_tasks WHERE id=? AND order_id=? FOR UPDATE', [taskId, req.params.orderId]);
    if (!task) return { status: 404, body: { error: 'NOT_FOUND', code: 'KITCHEN_TASK_NOT_FOUND', message: 'That item is not part of this order.', details: {} } };
    if (!allowed(req, task.branch_id)) return { status: 403, body: { error: 'BRANCH_ACCESS_DENIED', code: 'BRANCH_ACCESS_DENIED', message: 'Item belongs to another branch.', details: {} } };
    if (task.status !== 'READY') return { status: 409, body: { error: 'INVALID_STATE', code: 'TASK_NOT_READY', message: 'Only an item the kitchen marked ready can be sent back.', details: { status: task.status } } };
    const ts = nowIso();
    const moved = await tx.execute(
      `UPDATE kds_item_tasks SET status='IN_PROGRESS', ready_at=NULL, delay_reason=?, updated_at=? WHERE id=? AND status='READY'`,
      [reason.slice(0, 300), ts, task.id]);
    if (!moved.changes) return { status: 409, body: { error: 'CONFLICT', code: 'KITCHEN_TASK_CHANGED', message: 'Someone else just updated this item. Refresh the screen.', details: {} } };
    await syncOrderStatusFromTasks(tx, task.order_id);
    await recalculateForOrder(tx, task.branch_id, task.order_id);
    const { raiseAlert } = await import('../kitchen');
    await raiseAlert(tx, {
      branchId: task.branch_id, stationId: task.station_id, orderId: task.order_id, taskId: task.id, type: 'ITEM_RETURNED',
      severity: 'HIGH', audience: 'KITCHEN', reason: reason.slice(0, 300),
      messageRu: `«${task.title_snapshot}» вернули на доработку: ${reason.slice(0, 160)}`,
      messageTk: `«${task.title_snapshot}» täzeden işlemäge gaýtaryldy: ${reason.slice(0, 160)}`,
      dedupeKey: `return:${task.id}:${Date.now()}`, createdBy: req.user!.id,
    });
    await insertAuditLog(tx.execute, { userId: req.user!.id, branchId: task.branch_id, action: 'EXPO_ITEM_RETURNED', entityType: 'KITCHEN_TASK', entityId: task.id, oldValues: { status: 'READY' }, newValues: { status: 'IN_PROGRESS', reason }, req });
    return { status: 200, body: { task: await tx.queryOne<any>('SELECT * FROM kds_item_tasks WHERE id=?', [task.id]) } };
  });
  res.status(out.status).json(out.body);
});

// ============================================================ LOAD ANALYTICS AND MANAGER VIEW
/**
 * The load of every station, and how the kitchen has actually been performing. Every number comes
 * from the task rows; nothing here is a sample figure.
 */
router.get('/load', authenticateToken, requirePermission('kds.view'), async (req, res) => {
  const branchId = scopeBranch(req, res); if (!branchId) return;
  const from = typeof req.query.from === 'string' && req.query.from ? req.query.from : new Date(Date.now() - 12 * 3600_000).toISOString();
  const to = typeof req.query.to === 'string' && req.query.to ? req.query.to : nowIso();
  await transaction(async (tx) => {
    await ensureBranchStations(tx, branchId);
    for (const s of await tx.query<any>(`SELECT id FROM kitchen_stations WHERE branch_id=? AND status='ACTIVE' AND deleted_at IS NULL AND is_expo=false`, [branchId])) {
      await recalculateStationForecast(tx, branchId, s.id);
    }
    await recalculateStationForecast(tx, branchId, null);
    await evaluateDelays(tx, branchId);
  });
  const stations = await query<any>(`SELECT * FROM kitchen_stations WHERE branch_id=? AND status='ACTIVE' AND deleted_at IS NULL ORDER BY sort_order`, [branchId]);
  const out: any[] = [];
  for (const s of stations) {
    if (s.is_expo) continue;
    const load = await stationLoad(branchId, s.id);
    // Finished work in the window: the FACT, used for throughput and for the share cooked within
    // the norm. Cancelled and voided orders are excluded -- they were never cooked to completion.
    const done = await query<any>(
      `SELECT t.started_at, t.ready_at, t.quantity, t.standard_minutes, t.tolerance_minutes, t.title_snapshot, t.menu_item_id
         FROM kds_item_tasks t JOIN orders o ON o.id=t.order_id
        WHERE t.branch_id=? AND t.station_id=? AND t.ready_at IS NOT NULL AND t.started_at IS NOT NULL
          AND t.ready_at>=? AND t.ready_at<=? AND o.status NOT IN ('CANCELLED','VOID')`, [branchId, s.id, from, to]);
    const durations = done.map(d => (new Date(d.ready_at).getTime() - new Date(d.started_at).getTime()) / 60000).filter(v => v > 0).sort((a, b) => a - b);
    const median = durations.length ? (durations.length % 2 ? durations[(durations.length - 1) / 2] : (durations[durations.length / 2 - 1] + durations[durations.length / 2]) / 2) : null;
    const avg = durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : null;
    const withinNorm = done.filter(d => {
      const norm = num(d.standard_minutes, 0) * Math.max(1, num(d.quantity, 1)) + num(d.tolerance_minutes, 0);
      if (norm <= 0) return false;
      return (new Date(d.ready_at).getTime() - new Date(d.started_at).getTime()) / 60000 <= norm;
    }).length;
    const windowHours = Math.max(0.25, (new Date(to).getTime() - new Date(from).getTime()) / 3600_000);
    // Which dishes are actually holding this station up: the most remaining minutes, not the most rows.
    const bottleneck = await query<any>(
      `SELECT t.title_snapshot, COUNT(*)::int AS tasks, SUM(COALESCE(t.expected_minutes, t.standard_minutes, 5))::float AS minutes
         FROM kds_item_tasks t WHERE t.branch_id=? AND t.station_id=? AND t.status IN ('QUEUED','ACCEPTED','IN_PROGRESS')
        GROUP BY t.title_snapshot ORDER BY minutes DESC LIMIT 3`, [branchId, s.id]);
    out.push({
      station: { id: s.id, code: s.code, name_ru: s.name_ru, name_tk: s.name_tk, parallel_capacity: s.parallel_capacity },
      ...load,
      forecast_wait_minutes: Number((load.remaining_minutes / Math.max(1, s.parallel_capacity)).toFixed(1)),
      completed_in_window: done.length,
      throughput_per_hour: Number((done.length / windowHours).toFixed(2)),
      median_minutes: median === null ? null : Number(median.toFixed(1)),
      average_minutes: avg === null ? null : Number(avg.toFixed(1)),
      within_norm_share: done.length ? Number(((withinNorm / done.length) * 100).toFixed(1)) : null,
      bottleneck_items: bottleneck,
    });
  }
  const unassigned = await stationLoad(branchId, null);
  const delays = await query<any>(
    `SELECT delay_state, COUNT(*)::int AS n FROM kds_item_tasks WHERE branch_id=? AND status IN ('QUEUED','ACCEPTED','IN_PROGRESS') GROUP BY delay_state`, [branchId]);
  res.json({ branch_id: branchId, window: { from, to }, stations: out, unassigned, delays, thresholds: await thresholdsFor(branchId, null) });
});

/** The kitchen manager's queue of things to decide: delays, problems, help requests, escalations. */
router.get('/alerts', authenticateToken, requirePermission('kitchen.alerts.view'), async (req, res) => {
  const branchId = scopeBranch(req, res); if (!branchId) return;
  const open = req.query.status !== 'ALL';
  const alerts = await query<any>(
    `SELECT a.*, s.code AS station_code, o.order_number, u.full_name AS created_by_name
       FROM kitchen_alerts a
       LEFT JOIN kitchen_stations s ON s.id=a.station_id
       LEFT JOIN orders o ON o.id=a.order_id
       LEFT JOIN users u ON u.id=a.created_by
      WHERE a.branch_id=? ${open ? 'AND a.acknowledged_at IS NULL' : ''}
      ORDER BY a.created_at DESC LIMIT 200`, [branchId]);
  const newComments = await query<any>(
    `SELECT c.*, o.order_number, u.full_name AS author_name FROM kitchen_comments c
       JOIN orders o ON o.id=c.order_id LEFT JOIN users u ON u.id=c.author_user_id
      WHERE c.branch_id=? AND c.acknowledged_at IS NULL ORDER BY c.created_at DESC LIMIT 50`, [branchId]);
  const awaitingExpo = await query<any>(
    `SELECT o.id, o.order_number, COUNT(*)::int AS items,
            SUM(CASE WHEN t.status IN ('READY','SERVED') THEN 1 ELSE 0 END)::int AS ready_items
       FROM kds_item_tasks t JOIN orders o ON o.id=t.order_id
      WHERE t.branch_id=? AND t.status<>'CANCELLED' AND o.status IN ('CONFIRMED','PREPARING','READY')
      GROUP BY o.id, o.order_number ORDER BY o.created_at ASC LIMIT 50`, [branchId]);
  res.json({ branch_id: branchId, alerts, comments: newComments, awaiting_expo: awaitingExpo });
});

/** A manager records what was done about an alert. */
router.post('/alerts/:id/ack', authenticateToken, requirePermission('kitchen.alerts.resolve'), async (req, res) => {
  const alert = await queryOne<any>('SELECT * FROM kitchen_alerts WHERE id=?', [req.params.id]);
  if (!alert) return res.status(404).json({ error: 'NOT_FOUND', code: 'KITCHEN_ALERT_NOT_FOUND', message: 'Notification not found.', details: {} });
  if (!allowed(req, alert.branch_id)) return res.status(403).json({ error: 'BRANCH_ACCESS_DENIED', code: 'BRANCH_ACCESS_DENIED', message: 'Notification belongs to another branch.', details: {} });
  const resolution = req.body?.resolution ? String(req.body.resolution).trim().slice(0, 300) : null;
  const ts = nowIso();
  await transaction(async (tx) => {
    await tx.execute('UPDATE kitchen_alerts SET acknowledged_at=COALESCE(acknowledged_at,?), acknowledged_by=COALESCE(acknowledged_by,?), resolution=COALESCE(?,resolution) WHERE id=?',
      [ts, req.user!.id, resolution, alert.id]);
    await insertAuditLog(tx.execute, { userId: req.user!.id, branchId: alert.branch_id, action: 'KITCHEN_ALERT_RESOLVED', entityType: 'KITCHEN_ALERT', entityId: alert.id, newValues: { resolution }, req });
  });
  res.json({ success: true });
});

/** The delay thresholds of a branch, and of one station when it needs its own. */
router.get('/thresholds', authenticateToken, requirePermission('kds.view'), async (req, res) => {
  const branchId = scopeBranch(req, res); if (!branchId) return;
  const rows = await query<any>(
    `SELECT t.*, s.code AS station_code, mc.name_ru AS category_name_ru, mc.name_tk AS category_name_tk
       FROM kitchen_thresholds t
       LEFT JOIN kitchen_stations s ON s.id=t.station_id
       LEFT JOIN menu_categories mc ON mc.id=t.category_id
      WHERE t.branch_id=?`, [branchId]);
  res.json({ branch_id: branchId, thresholds: rows, effective: await thresholdsFor(branchId, null) });
});

router.put('/thresholds', authenticateToken, requirePermission('kitchen.thresholds.manage'), async (req, res) => {
  const branchId = scopeBranch(req, res); if (!branchId) return;
  const stationId = req.body?.station_id ? String(req.body.station_id) : null;
  // Stage 43: a limit may now be set for a whole dish category -- "a steak may take three times its
  // norm, a drink may not" -- without editing every dish.
  const categoryId = req.body?.category_id ? String(req.body.category_id) : null;
  const warning = num(req.body?.warning_ratio, 0.8), late = num(req.body?.late_ratio, 1), critical = num(req.body?.critical_ratio, 1.5);
  const escalate = Math.max(0, Math.min(120, Math.round(num(req.body?.escalate_minutes, 5))));
  // The ratios are stored as DECIMAL(5,2), so anything below 0.005 would be SAVED as 0.00 -- which
  // silently means "late from the first second". The input is therefore held to what the column can
  // actually keep: two decimals, and never small enough to round away.
  const RATIO_MIN = 0.1, RATIO_MAX = 5;
  const storable = (v: number) => Number.isFinite(v) && v >= RATIO_MIN && v <= RATIO_MAX && Math.abs(v * 100 - Math.round(v * 100)) < 1e-9;
  if (![warning, late, critical].every(storable)) {
    return bad(res, 'INVALID_THRESHOLDS', `Each limit is between ${RATIO_MIN} and ${RATIO_MAX} of the expected time, with at most two decimals.`, { warning, late, critical });
  }
  if (!(warning <= late && late <= critical)) {
    return bad(res, 'INVALID_THRESHOLDS', 'Warning must be at or below the delay limit, and that at or below the critical limit.', { warning, late, critical });
  }
  if (stationId) {
    const st = await queryOne<any>('SELECT id FROM kitchen_stations WHERE id=? AND branch_id=?', [stationId, branchId]);
    if (!st) return bad(res, 'STATION_NOT_IN_BRANCH', 'That station is not in this branch.');
  }
  if (categoryId) {
    const cat = await queryOne<any>('SELECT id,branch_id FROM menu_categories WHERE id=?', [categoryId]);
    if (!cat || (cat.branch_id && cat.branch_id !== branchId)) return bad(res, 'CATEGORY_NOT_IN_BRANCH', 'That category is not in this branch.');
  }
  const ts = nowIso();
  await transaction(async (tx) => {
    const existing = await tx.queryOne<any>(
      `SELECT id FROM kitchen_thresholds WHERE branch_id=? AND ${stationId ? 'station_id=?' : 'station_id IS NULL'} AND ${categoryId ? 'category_id=?' : 'category_id IS NULL'}`,
      [branchId, ...(stationId ? [stationId] : []), ...(categoryId ? [categoryId] : [])]);
    if (existing) {
      await tx.execute(`UPDATE kitchen_thresholds SET warning_ratio=CAST(? AS numeric),late_ratio=CAST(? AS numeric),critical_ratio=CAST(? AS numeric),escalate_minutes=?,updated_by=?,updated_at=? WHERE id=?`,
        [String(warning), String(late), String(critical), escalate, req.user!.id, ts, existing.id]);
    } else {
      await tx.execute(`INSERT INTO kitchen_thresholds (id,branch_id,station_id,category_id,warning_ratio,late_ratio,critical_ratio,escalate_minutes,updated_by,created_at,updated_at)
        VALUES (?,?,?,?,CAST(? AS numeric),CAST(? AS numeric),CAST(? AS numeric),?,?,?,?)`,
        [`kth_${crypto.randomUUID()}`, branchId, stationId, categoryId, String(warning), String(late), String(critical), escalate, req.user!.id, ts, ts]);
    }
    await insertAuditLog(tx.execute, { userId: req.user!.id, branchId, action: 'KITCHEN_THRESHOLDS_UPDATED', entityType: 'KITCHEN_THRESHOLD', entityId: categoryId || stationId || branchId, newValues: { station_id: stationId, category_id: categoryId, warning, late, critical, escalate }, req });
  });
  res.json({ success: true, thresholds: await query<any>('SELECT * FROM kitchen_thresholds WHERE branch_id=?', [branchId]) });
});

/**
 * Create the kitchen work for an order that was confirmed before this stage existed, or whose
 * lines changed afterwards. Idempotent: the unique key on (order_item_id, station_id) means
 * calling it twice adds nothing.
 */
router.post('/orders/:orderId/route', authenticateToken, requirePermission('kds.update'), async (req, res) => {
  const out = await transaction(async (tx) => {
    const order = await tx.queryOne<any>('SELECT id,branch_id,status FROM orders WHERE id=? FOR UPDATE', [req.params.orderId]);
    if (!order) return { status: 404, body: { error: 'NOT_FOUND', code: 'ORDER_NOT_FOUND', message: 'Order not found.', details: {} } };
    if (!allowed(req, order.branch_id)) return { status: 403, body: { error: 'BRANCH_ACCESS_DENIED', code: 'BRANCH_ACCESS_DENIED', message: 'Order belongs to another branch.', details: {} } };
    if (!['CONFIRMED', 'PREPARING', 'READY'].includes(order.status)) {
      return { status: 409, body: { error: 'INVALID_STATE', code: 'ORDER_NOT_IN_KITCHEN', message: 'Only a confirmed order is sent to the kitchen.', details: { status: order.status } } };
    }
    const result = await routeOrderTasks(tx, order);
    await recalculateForOrder(tx, order.branch_id, order.id);
    return { status: 200, body: { ...result } };
  });
  res.status(out.status).json(out.body);
});

export default router;
