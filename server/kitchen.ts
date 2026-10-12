// ----------------------------------------------------------------------------------------------
// Stage 42 — the kitchen engine.
//
// This module owns four things and nothing else:
//   1. ROUTING      -- which station cooks a given order line (from configuration, never a guess).
//   2. FORECASTING  -- when a task will start and be ready, from the queue ahead of it and the
//                      station's measured speed.
//   3. DELAY STATE  -- whether a task is on time, warning, late or critical.
//   4. AGGREGATION  -- what the ORDER's status is, given the state of its individual tasks.
//
// What it deliberately does NOT do: it never writes money, never touches recipes, stock movements,
// payments, bills or prices, and never creates a second order. A task always points back to the
// one order line it came from, so Order Core stays the single source of truth for what was sold.
// ----------------------------------------------------------------------------------------------
import crypto from 'node:crypto';
import type { TxClient } from './db';
import { query, queryOne } from './db';

export const TASK_STATUSES = ['QUEUED', 'ACCEPTED', 'IN_PROGRESS', 'READY', 'SERVED', 'CANCELLED'] as const;
export type TaskStatus = typeof TASK_STATUSES[number];

/** The station-side transitions a kitchen worker can make, and what each one records. */
export const TASK_TRANSITIONS: Record<string, TaskStatus[]> = {
  QUEUED: ['ACCEPTED', 'IN_PROGRESS', 'CANCELLED'],
  ACCEPTED: ['IN_PROGRESS', 'CANCELLED'],
  IN_PROGRESS: ['READY', 'CANCELLED'],
  READY: ['SERVED'],
  SERVED: [],
  CANCELLED: [],
};

export const DELAY_STATES = ['NONE', 'WARNING', 'LATE', 'CRITICAL'] as const;
export const COMMENT_KINDS = ['NO_ONION', 'NO_SAUCE', 'NOT_SPICY', 'ALLERGY_CHECK', 'GUEST_WAITING', 'SERVE_TOGETHER', 'URGENT', 'FREE_TEXT'] as const;
export const HELP_REASONS = ['STAFF', 'EQUIPMENT', 'INGREDIENTS', 'UNCLEAR_ITEM', 'URGENT', 'OTHER'] as const;

/** The stations a new branch starts with. Seeded as ROWS, so a branch can change them freely. */
export const DEFAULT_STATIONS = [
  { code: 'GRILL', name_ru: 'Гриль', name_tk: 'Gril', sort_order: 10, is_expo: false, parallel_capacity: 2 },
  { code: 'FRY', name_ru: 'Фритюр', name_tk: 'Fritýur', sort_order: 20, is_expo: false, parallel_capacity: 2 },
  { code: 'COLD', name_ru: 'Холодный цех', name_tk: 'Sowuk bölüm', sort_order: 30, is_expo: false, parallel_capacity: 1 },
  { code: 'BAR', name_ru: 'Бар', name_tk: 'Bar', sort_order: 40, is_expo: false, parallel_capacity: 2 },
  { code: 'EXPO', name_ru: 'Выдача', name_tk: 'Beriş', sort_order: 90, is_expo: true, parallel_capacity: 1 },
] as const;

const nowIso = () => new Date().toISOString();
const num = (v: any, fallback = 0) => { const n = Number(v); return Number.isFinite(n) ? n : fallback; };
const minutesBetween = (a: string, b: string) => (new Date(b).getTime() - new Date(a).getTime()) / 60000;

// ----------------------------------------------------------------------------------------- SEED
/**
 * Make sure a branch has its stations. Idempotent, and called lazily rather than from a migration
 * so that branches created before this stage get them the first time the kitchen is used.
 */
export async function ensureBranchStations(tx: TxClient, branchId: string): Promise<void> {
  const existing = await tx.query<any>('SELECT code FROM kitchen_stations WHERE branch_id=?', [branchId]);
  const have = new Set(existing.map(x => x.code));
  const ts = nowIso();
  for (const s of DEFAULT_STATIONS) {
    if (have.has(s.code)) continue;
    await tx.execute(
      `INSERT INTO kitchen_stations (id,branch_id,code,name_ru,name_tk,is_expo,parallel_capacity,sort_order,status,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,'ACTIVE',?,?) ON CONFLICT (branch_id,code) DO NOTHING`,
      [`kst_${crypto.randomUUID()}`, branchId, s.code, s.name_ru, s.name_tk, s.is_expo, s.parallel_capacity, s.sort_order, ts, ts]
    );
  }
}

// -------------------------------------------------------------------------------------- ROUTING
interface RouteRow { station_id: string; standard_minutes: any; tolerance_minutes: any; is_secondary?: boolean }

/**
 * The routes for one dish: its own configuration first, the explicitly configured route of its
 * category second, and nothing at all third. A dish name is never parsed to find a station.
 */
async function routesForItem(tx: TxClient, menuItemId: string | null, branchId: string): Promise<RouteRow[]> {
  if (!menuItemId) return [];
  const own = await tx.query<RouteRow>(
    `SELECT r.station_id, r.standard_minutes, r.tolerance_minutes, r.is_secondary
       FROM menu_item_routes r
       JOIN kitchen_stations s ON s.id=r.station_id
      WHERE r.menu_item_id=? AND r.status='ACTIVE' AND s.branch_id=? AND s.status='ACTIVE' AND s.deleted_at IS NULL AND s.is_expo=false
      ORDER BY r.is_secondary ASC`, [menuItemId, branchId]);
  if (own.length) return own;
  const byCategory = await tx.query<RouteRow>(
    `SELECT r.station_id, r.standard_minutes, r.tolerance_minutes, false AS is_secondary
       FROM menu_category_routes r
       JOIN menu_items mi ON mi.category_id=r.category_id
       JOIN kitchen_stations s ON s.id=r.station_id
      WHERE mi.id=? AND r.status='ACTIVE' AND s.branch_id=? AND s.status='ACTIVE' AND s.deleted_at IS NULL AND s.is_expo=false`,
    [menuItemId, branchId]);
  return byCategory;
}

/**
 * Create the kitchen work for an order, once. Every ACTIVE line of the order becomes one task per
 * routed station; a line with no configured route becomes a task with NO station, which is the
 * "needs assignment" queue -- visible, never silently dropped and never guessed at.
 *
 * Modifiers that are themselves real menu items (the Stage 38 source-item link) can add a step on
 * another station; that is an ADDITIONAL task on the same order line, not a second order.
 */
export async function routeOrderTasks(tx: TxClient, order: { id: string; branch_id: string }): Promise<{ created: number; unassigned: number }> {
  await ensureBranchStations(tx, order.branch_id);
  const items = await tx.query<any>(
    `SELECT id, menu_item_id, title_snapshot, quantity FROM order_items WHERE order_id=? AND status='ACTIVE' ORDER BY created_at`, [order.id]);
  const ts = nowIso();
  let created = 0, unassigned = 0;
  for (const item of items) {
    const routes = await routesForItem(tx, item.menu_item_id, order.branch_id);
    // A modifier whose source dish has its own station adds that station's step to this line.
    const modifierRoutes: RouteRow[] = [];
    const mods = await tx.query<any>(
      `SELECT m.source_menu_item_id FROM order_item_modifiers oim
         JOIN menu_modifiers m ON m.id=oim.modifier_id
        WHERE oim.order_item_id=? AND m.source_menu_item_id IS NOT NULL`, [item.id]);
    for (const m of mods) {
      for (const r of await routesForItem(tx, m.source_menu_item_id, order.branch_id)) {
        if (!routes.some(x => x.station_id === r.station_id) && !modifierRoutes.some(x => x.station_id === r.station_id)) {
          modifierRoutes.push({ ...r, is_secondary: true });
        }
      }
    }
    const all = [...routes, ...modifierRoutes];
    if (!all.length) {
      const ins = await tx.execute(
        `INSERT INTO kds_item_tasks (id,branch_id,order_id,order_item_id,station_id,menu_item_id,title_snapshot,quantity,is_secondary,status,standard_minutes,tolerance_minutes,created_at,updated_at)
         VALUES (?,?,?,?,NULL,?,?,?,false,'QUEUED',NULL,NULL,?,?) ON CONFLICT (order_item_id,station_id) DO NOTHING`,
        [`ktk_${crypto.randomUUID()}`, order.branch_id, order.id, item.id, item.menu_item_id, item.title_snapshot, item.quantity, ts, ts]);
      if (ins.changes) { created++; unassigned++; }
      continue;
    }
    for (const r of all) {
      const ins = await tx.execute(
        `INSERT INTO kds_item_tasks (id,branch_id,order_id,order_item_id,station_id,menu_item_id,title_snapshot,quantity,is_secondary,status,standard_minutes,tolerance_minutes,created_at,updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,'QUEUED',CAST(? AS numeric),CAST(? AS numeric),?,?) ON CONFLICT (order_item_id,station_id) DO NOTHING`,
        [`ktk_${crypto.randomUUID()}`, order.branch_id, order.id, item.id, r.station_id, item.menu_item_id, item.title_snapshot,
         item.quantity, Boolean(r.is_secondary), String(num(r.standard_minutes, 5)), String(num(r.tolerance_minutes, 2)), ts, ts]);
      if (ins.changes) created++;
    }
  }
  return { created, unassigned };
}

/**
 * Stage 43: mark an order's kitchen work as "must leave together".
 *
 * The declaration itself is the waiter's existing SERVE_TOGETHER note -- there is no second place
 * to say it and nothing is added to the order's own row. This copies that fact onto the tasks so
 * the forecast can pace the stations to each other instead of each one racing on its own.
 */
export async function applyServeTogether(tx: TxClient, orderId: string): Promise<boolean> {
  const note = await tx.queryOne<any>(
    `SELECT id FROM kitchen_comments WHERE order_id=? AND kind='SERVE_TOGETHER' LIMIT 1`, [orderId]);
  if (!note) return false;
  const r = await tx.execute(
    `UPDATE kds_item_tasks SET serve_together=true, updated_at=? WHERE order_id=? AND serve_together=false`,
    [nowIso(), orderId]);
  return r.changes > 0;
}

// ---------------------------------------------------------------------------------- FORECASTING
/**
 * How long this dish actually takes on this station, measured from finished work.
 *
 * Only genuinely cooked tasks count: a task must have both a start and a ready time, and its order
 * must not have been cancelled or voided. The MEDIAN is used rather than the mean, so one forgotten
 * ticket left open for an hour cannot drag the whole estimate. Below three samples the number is
 * not trusted at all and the manager's norm is used, which is why confidence is reported with it.
 */
export interface Expectation { minutes: number; source: 'MEASURED' | 'STANDARD' | 'FALLBACK'; confidence: 'MEASURED' | 'ESTIMATED' | 'PRELIMINARY'; samples: number }

const MEASURED_MIN_SAMPLES = 8;
const ESTIMATE_MIN_SAMPLES = 3;
const FALLBACK_MINUTES = 5;

export async function measuredMinutes(stationId: string | null, menuItemId: string | null, limit = 20): Promise<{ median: number | null; samples: number }> {
  if (!stationId || !menuItemId) return { median: null, samples: 0 };
  const rows = await query<any>(
    `SELECT t.started_at, t.ready_at, t.quantity
       FROM kds_item_tasks t JOIN orders o ON o.id=t.order_id
      WHERE t.station_id=? AND t.menu_item_id=? AND t.started_at IS NOT NULL AND t.ready_at IS NOT NULL
        AND t.status IN ('READY','SERVED') AND o.status NOT IN ('CANCELLED','VOID')
      ORDER BY t.ready_at DESC LIMIT ?`, [stationId, menuItemId, limit]);
  const perUnit = rows
    .map(r => minutesBetween(r.started_at, r.ready_at) / Math.max(1, num(r.quantity, 1)))
    .filter(v => Number.isFinite(v) && v > 0);
  if (!perUnit.length) return { median: null, samples: 0 };
  perUnit.sort((a, b) => a - b);
  const mid = Math.floor(perUnit.length / 2);
  const median = perUnit.length % 2 ? perUnit[mid] : (perUnit[mid - 1] + perUnit[mid]) / 2;
  return { median, samples: perUnit.length };
}

export async function expectationFor(task: { station_id: string | null; menu_item_id: string | null; standard_minutes: any; quantity: any }): Promise<Expectation> {
  const { median, samples } = await measuredMinutes(task.station_id, task.menu_item_id);
  const qty = Math.max(1, num(task.quantity, 1));
  const standard = num(task.standard_minutes, 0);
  if (median !== null && samples >= ESTIMATE_MIN_SAMPLES) {
    return {
      minutes: median * qty,
      source: 'MEASURED',
      confidence: samples >= MEASURED_MIN_SAMPLES ? 'MEASURED' : 'ESTIMATED',
      samples,
    };
  }
  if (standard > 0) return { minutes: standard * qty, source: 'STANDARD', confidence: 'PRELIMINARY', samples };
  return { minutes: FALLBACK_MINUTES * qty, source: 'FALLBACK', confidence: 'PRELIMINARY', samples };
}

/**
 * Recompute the queue of one station: for every task that is not finished, when the station can
 * realistically start it and when it should be ready.
 *
 * The model is deliberately ordinary and checkable: work waiting ahead of a task, divided by how
 * many items the station can cook at once. A task already in progress contributes only the time it
 * has left. No part of this is called artificial intelligence, because it is arithmetic.
 */
export async function recalculateStationForecast(tx: TxClient, branchId: string, stationId: string | null): Promise<number> {
  const station = stationId
    ? await tx.queryOne<any>('SELECT * FROM kitchen_stations WHERE id=? AND branch_id=?', [stationId, branchId])
    : null;
  const capacity = Math.max(1, num(station?.parallel_capacity, 1));
  const open = await tx.query<any>(
    `SELECT * FROM kds_item_tasks
      WHERE branch_id=? AND ${stationId ? 'station_id=?' : 'station_id IS NULL'} AND status IN ('QUEUED','ACCEPTED','IN_PROGRESS')
      ORDER BY priority DESC, created_at ASC`, stationId ? [branchId, stationId] : [branchId]);
  const ts = nowIso();
  const now = Date.now();
  // Remaining work of the items already being cooked, spread over the station's parallel slots.
  let workAheadMinutes = 0;
  const updates: Array<{ id: string; exp: Expectation; start: string; ready: string }> = [];
  for (const task of open) {
    const exp = await expectationFor(task);
    let startMs: number;
    if (task.status === 'IN_PROGRESS' && task.started_at) {
      startMs = new Date(task.started_at).getTime();
      const elapsed = (now - startMs) / 60000;
      workAheadMinutes += Math.max(0, exp.minutes - elapsed) / capacity;
    } else {
      startMs = now + workAheadMinutes * 60000;
      workAheadMinutes += exp.minutes / capacity;
    }
    const readyMs = Math.max(startMs, now) + exp.minutes * 60000;
    updates.push({
      id: task.id,
      exp,
      start: new Date(Math.max(startMs, now)).toISOString(),
      ready: new Date(readyMs).toISOString(),
    });
  }
  for (const u of updates) {
    await tx.execute(
      `UPDATE kds_item_tasks SET expected_minutes=CAST(? AS numeric), forecast_source=?, forecast_confidence=?, forecast_sample_size=?,
              forecast_start_at=?, forecast_ready_at=?, updated_at=? WHERE id=?`,
      [u.exp.minutes.toFixed(2), u.exp.source, u.exp.confidence, u.exp.samples, u.start, u.ready, ts, u.id]);
  }
  // An order that must be served together is paced to its SLOWEST station, so the fast ones are
  // told to start later instead of plating food that then stands under a lamp.
  for (const orderId of new Set(open.filter(t => t.serve_together).map(t => t.order_id))) {
    await recalculateCoordinatedOrder(tx, String(orderId));
  }
  return updates.length;
}

/**
 * Stage 43: pace one "serve together" order.
 *
 * The binding moment is the LATEST forecast among the order's unfinished tasks -- the slowest
 * station decides. Every other task is then told to start at that moment minus its own expected
 * time. Two rules keep this honest:
 *   - a start time is never pushed into the past: a task that cannot make the target starts now;
 *   - the station's own estimate (forecast_ready_at) is left exactly as it was, and the shared
 *     target is written to a SEPARATE column, so a plan and an estimate are never confused.
 * An item already being cooked is not re-paced -- it is in the pan.
 */
export async function recalculateCoordinatedOrder(tx: TxClient, orderId: string): Promise<string | null> {
  const tasks = await tx.query<any>(
    `SELECT * FROM kds_item_tasks WHERE order_id=? AND status IN ('QUEUED','ACCEPTED','IN_PROGRESS','READY')`, [orderId]);
  const live = tasks.filter(t => t.status !== 'READY');
  if (!live.length) return null;
  const targets = tasks
    .map(t => (t.status === 'READY' ? t.ready_at : t.forecast_ready_at))
    .filter(Boolean)
    .map(x => new Date(String(x)).getTime())
    .filter(n => Number.isFinite(n));
  if (!targets.length) return null;
  const targetMs = Math.max(...targets);
  const target = new Date(targetMs).toISOString();
  const ts = nowIso();
  const now = Date.now();
  for (const t of tasks) {
    const expected = num(t.expected_minutes, num(t.standard_minutes, FALLBACK_MINUTES));
    const startMs = t.status === 'IN_PROGRESS' || t.status === 'READY'
      ? (t.started_at ? new Date(t.started_at).getTime() : now)
      : Math.max(now, targetMs - expected * 60000);
    await tx.execute(
      `UPDATE kds_item_tasks SET coordinated_ready_at=?, forecast_start_at=?, updated_at=? WHERE id=?`,
      [target, new Date(startMs).toISOString(), ts, t.id]);
  }
  return target;
}

/** Recompute every station touched by an order, plus the unassigned queue. */
export async function recalculateForOrder(tx: TxClient, branchId: string, orderId: string): Promise<void> {
  const rows = await tx.query<any>('SELECT DISTINCT station_id FROM kds_item_tasks WHERE order_id=?', [orderId]);
  for (const r of rows) await recalculateStationForecast(tx, branchId, r.station_id);
}

// -------------------------------------------------------------------------------------- DELAYS
export interface Thresholds { warning_ratio: number; late_ratio: number; critical_ratio: number; escalate_minutes: number }
const DEFAULT_THRESHOLDS: Thresholds = { warning_ratio: 0.8, late_ratio: 1, critical_ratio: 1.5, escalate_minutes: 5 };

/**
 * The thresholds in force for one task: the most specific configured row wins -- station, then the
 * branch default, then the built-in default. Nothing here invents a limit of its own.
 */
export async function thresholdsFor(branchId: string, stationId: string | null, categoryId: string | null = null): Promise<Thresholds> {
  const rows = await query<any>(
    `SELECT * FROM kitchen_thresholds
      WHERE branch_id=? AND (station_id=? OR station_id IS NULL) AND (category_id=? OR category_id IS NULL)`,
    [branchId, stationId, categoryId]);
  // Stage 43: the most specific configured row wins -- this station AND this category, then the
  // category alone, then the station alone, then the branch default, then the built-in default.
  // A category limit is what lets a kitchen say "a steak may take three times its norm, a drink
  // may not" without touching every dish.
  const row = rows.find(r => r.station_id === stationId && r.category_id === categoryId && stationId && categoryId)
    || rows.find(r => r.category_id === categoryId && categoryId && !r.station_id)
    || rows.find(r => r.station_id === stationId && stationId && !r.category_id)
    || rows.find(r => !r.station_id && !r.category_id);
  if (!row) return DEFAULT_THRESHOLDS;
  return {
    warning_ratio: num(row.warning_ratio, DEFAULT_THRESHOLDS.warning_ratio),
    late_ratio: num(row.late_ratio, DEFAULT_THRESHOLDS.late_ratio),
    critical_ratio: num(row.critical_ratio, DEFAULT_THRESHOLDS.critical_ratio),
    escalate_minutes: num(row.escalate_minutes, DEFAULT_THRESHOLDS.escalate_minutes),
  };
}

/** How far past the critical limit a task is, in minutes. Zero when it is not critical. */
export function minutesPastCritical(task: any, th: Thresholds, at = Date.now()): number {
  const expected = num(task.expected_minutes, num(task.standard_minutes, FALLBACK_MINUTES));
  if (expected <= 0) return 0;
  const from = task.started_at || task.created_at;
  const elapsed = (at - new Date(from).getTime()) / 60000;
  return Math.max(0, elapsed - expected * th.critical_ratio);
}

/** How late a task is right now, as a state rather than a number of seconds. */
export function delayStateOf(task: any, th: Thresholds, at = Date.now()): 'NONE' | 'WARNING' | 'LATE' | 'CRITICAL' {
  if (task.status === 'READY' || task.status === 'SERVED' || task.status === 'CANCELLED') return 'NONE';
  const expected = num(task.expected_minutes, num(task.standard_minutes, FALLBACK_MINUTES));
  if (expected <= 0) return 'NONE';
  const from = task.started_at || task.created_at;
  const elapsed = (at - new Date(from).getTime()) / 60000;
  const ratio = elapsed / expected;
  if (ratio >= th.critical_ratio) return 'CRITICAL';
  if (ratio >= th.late_ratio) return 'LATE';
  if (ratio >= th.warning_ratio) return 'WARNING';
  return 'NONE';
}

/**
 * Raise an alert at most once. The dedupe key is the identity of the event -- this task, this kind
 * of alert -- and the unique index on it is what makes a repeated recalculation harmless. A screen
 * refreshing a hundred times cannot produce a hundred notifications.
 */
export async function raiseAlert(tx: TxClient, a: {
  branchId: string; stationId?: string | null; orderId?: string | null; taskId?: string | null;
  type: string; severity?: string; audience: string; reason?: string | null;
  messageRu?: string | null; messageTk?: string | null; dedupeKey: string; createdBy?: string | null;
}): Promise<boolean> {
  const r = await tx.execute(
    `INSERT INTO kitchen_alerts (id,branch_id,station_id,order_id,task_id,type,severity,audience,reason,message_ru,message_tk,dedupe_key,created_by,created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT (dedupe_key) DO NOTHING`,
    [`kal_${crypto.randomUUID()}`, a.branchId, a.stationId ?? null, a.orderId ?? null, a.taskId ?? null, a.type,
     a.severity || 'INFO', a.audience, a.reason ?? null, a.messageRu ?? null, a.messageTk ?? null, a.dedupeKey, a.createdBy ?? null, nowIso()]);
  return r.changes > 0;
}

/**
 * Re-evaluate the delay state of a branch's open tasks and announce the transitions. Called when
 * the kitchen screens are read and when a status changes, so there is no polling job; the dedupe
 * key keeps it idempotent however often that happens.
 */
export async function evaluateDelays(tx: TxClient, branchId: string): Promise<{ changed: number; alerts: number; escalations: number }> {
  const open = await tx.query<any>(
    `SELECT t.*, s.name_ru AS station_name_ru, s.name_tk AS station_name_tk, o.order_number, mi.category_id
       FROM kds_item_tasks t
       LEFT JOIN kitchen_stations s ON s.id=t.station_id
       JOIN orders o ON o.id=t.order_id
       LEFT JOIN menu_items mi ON mi.id=t.menu_item_id
      WHERE t.branch_id=? AND t.status IN ('QUEUED','ACCEPTED','IN_PROGRESS')`, [branchId]);
  const ts = nowIso();
  let changed = 0, alerts = 0, escalations = 0;
  const cache = new Map<string, Thresholds>();
  for (const task of open) {
    // Stage 43: the limits in force for THIS task -- its station and its dish category, with the
    // branch default behind them.
    const key = `${task.station_id}|${task.category_id}`;
    if (!cache.has(key)) cache.set(key, await thresholdsFor(branchId, task.station_id, task.category_id || null));
    const th = cache.get(key)!;
    const state = delayStateOf(task, th);
    // Stage 43: a critical delay that nobody has resolved is repeated, not announced once and
    // forgotten. The round is derived from how far past the limit the task is, so the reminder
    // fires at most once per escalate_minutes and the dedupe key makes a re-read harmless.
    if (state === 'CRITICAL' && th.escalate_minutes > 0) {
      const round = Math.floor(minutesPastCritical(task, th) / th.escalate_minutes);
      if (round > num(task.escalation_round, 0)) {
        const raised = await raiseAlert(tx, {
          branchId, stationId: task.station_id, orderId: task.order_id, taskId: task.id,
          type: 'DELAY_ESCALATED', severity: 'CRITICAL', audience: 'BRANCH_MANAGER',
          reason: `round ${round}`,
          messageRu: `Заказ №${task.order_number}: «${task.title_snapshot}» всё ещё не готов — задержка критическая уже ${Math.round(round * th.escalate_minutes)} мин.`,
          messageTk: `Sargyt №${task.order_number}: «${task.title_snapshot}» henizem taýýar däl — kritiki gijä galma eýýäm ${Math.round(round * th.escalate_minutes)} min.`,
          dedupeKey: `escalate:${task.id}:${round}`,
        });
        await tx.execute('UPDATE kds_item_tasks SET escalation_round=?, updated_at=? WHERE id=?', [round, ts, task.id]);
        if (raised) { escalations++; alerts++; }
      }
    }
    if (state === task.delay_state) continue;
    await tx.execute('UPDATE kds_item_tasks SET delay_state=?, updated_at=? WHERE id=?', [state, ts, task.id]);
    changed++;
    if (state === 'NONE') continue;
    const severity = state === 'CRITICAL' ? 'CRITICAL' : state === 'LATE' ? 'HIGH' : 'INFO';
    // A critical delay goes to the branch manager as well as the kitchen; a warning stays inside
    // the kitchen, so the floor is not paged for every dish that is a minute behind.
    const audience = state === 'CRITICAL' ? 'BRANCH_MANAGER' : 'KITCHEN';
    const raised = await raiseAlert(tx, {
      branchId, stationId: task.station_id, orderId: task.order_id, taskId: task.id,
      type: `DELAY_${state}`, severity, audience,
      messageRu: `Заказ №${task.order_number}: «${task.title_snapshot}» задерживается на ${task.station_name_ru || 'не назначено'}.`,
      messageTk: `Sargyt №${task.order_number}: «${task.title_snapshot}» ${task.station_name_tk || 'bellenmedik'} bölüminde gijä galýar.`,
      dedupeKey: `delay:${task.id}:${state}`,
    });
    if (raised) alerts++;
  }
  return { changed, alerts, escalations };
}

// ---------------------------------------------------------------------------------- AGGREGATION
/**
 * What the ORDER's status is, given its tasks. This is the rule that stops one station's work from
 * speaking for the whole order: an order is READY only when every task that still counts is ready,
 * and PREPARING as soon as any task has actually been started.
 *
 * Order Core keeps its own statuses; this only maps the kitchen's view onto them, and never moves
 * an order that has already been paid, closed or cancelled.
 */
export function aggregateOrderStatus(tasks: Array<{ status: string }>): 'CONFIRMED' | 'PREPARING' | 'READY' | null {
  const live = tasks.filter(t => t.status !== 'CANCELLED');
  if (!live.length) return null;
  if (live.every(t => t.status === 'READY' || t.status === 'SERVED')) return 'READY';
  // Work has demonstrably begun if ANY task has been accepted, started or finished. An order whose
  // bar drink is already poured is being prepared, even though the grill has not been touched yet:
  // without the READY/SERVED cases here the order would fall back to CONFIRMED and look untouched.
  if (live.some(t => t.status === 'ACCEPTED' || t.status === 'IN_PROGRESS' || t.status === 'READY' || t.status === 'SERVED')) return 'PREPARING';
  return 'CONFIRMED';
}

const KITCHEN_MOVABLE_ORDER_STATUSES = ['CONFIRMED', 'PREPARING', 'READY'];

/**
 * Push the aggregated kitchen status onto the order and its existing KDS ticket, so the screens
 * written before this stage keep showing the truth. Deliberately conservative: it only ever moves
 * an order between CONFIRMED/PREPARING/READY, never into or out of payment, cancellation or
 * closure, which belong to Order Core.
 */
export async function syncOrderStatusFromTasks(tx: TxClient, orderId: string): Promise<string | null> {
  const order = await tx.queryOne<any>('SELECT id,branch_id,status FROM orders WHERE id=? FOR UPDATE', [orderId]);
  if (!order || !KITCHEN_MOVABLE_ORDER_STATUSES.includes(order.status)) return null;
  const tasks = await tx.query<any>('SELECT status FROM kds_item_tasks WHERE order_id=?', [orderId]);
  const next = aggregateOrderStatus(tasks);
  if (!next || next === order.status) return null;
  const ts = nowIso();
  await tx.execute('UPDATE orders SET status=?, updated_at=? WHERE id=? AND status=?', [next, ts, orderId, order.status]);
  const ticketStatus = next === 'READY' ? 'READY' : next === 'PREPARING' ? 'PREPARING' : 'NEW';
  await tx.execute(
    `UPDATE kds_tickets SET status=?, started_at=COALESCE(started_at,?), ready_at=COALESCE(?,ready_at), updated_at=? WHERE order_id=?`,
    [ticketStatus, next === 'PREPARING' ? ts : null, next === 'READY' ? ts : null, ts, orderId]);
  return next;
}

// ------------------------------------------------------------------------------------ ANALYTICS
/**
 * The load of one station right now, in the terms a kitchen manager actually uses. Counting orders
 * is not a measure of load -- one order can be six grilled dishes -- so the headline figure here is
 * the remaining work in minutes.
 */
export async function stationLoad(branchId: string, stationId: string | null): Promise<any> {
  const open = await query<any>(
    `SELECT * FROM kds_item_tasks WHERE branch_id=? AND ${stationId ? 'station_id=?' : 'station_id IS NULL'}
       AND status IN ('QUEUED','ACCEPTED','IN_PROGRESS')`, stationId ? [branchId, stationId] : [branchId]);
  let remaining = 0;
  for (const t of open) {
    const expected = num(t.expected_minutes, num(t.standard_minutes, FALLBACK_MINUTES));
    const elapsed = t.started_at ? (Date.now() - new Date(t.started_at).getTime()) / 60000 : 0;
    remaining += Math.max(0, expected - elapsed);
  }
  return {
    station_id: stationId,
    active_tasks: open.filter(t => t.status === 'IN_PROGRESS').length,
    waiting_tasks: open.filter(t => t.status === 'QUEUED' || t.status === 'ACCEPTED').length,
    distinct_orders: new Set(open.map(t => t.order_id)).size,
    remaining_minutes: Number(remaining.toFixed(1)),
    delayed_tasks: open.filter(t => t.delay_state === 'LATE' || t.delay_state === 'CRITICAL').length,
  };
}
