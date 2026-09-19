import crypto from 'node:crypto';
import { TxClient } from './db';
import { insertAuditLog } from './auth';

// Stage 34.2 -- the single service-charge core.
//
// Two separate questions live here and must never be confused:
//   1. HOW MUCH service charge an order carries (a percentage of its subtotal, per order type).
//   2. WHO that money belongs to (categories -> individual employees or a common pool).
//
// Both are answered by a configuration VERSION. Editing the configuration archives the current
// version and inserts a new one, so an order is always explained by the version in force when it
// was created -- changing the configuration never re-prices or re-distributes an existing order.
//
// Service charge distribution is not salary and not KPI: it only ever moves the money the order
// actually charged, never more, and whatever is not allocated stays with the establishment.

export const SERVICE_CHARGE_CATEGORIES = ['BAR', 'KITCHEN', 'WAITERS', 'MANAGERS', 'OTHER'] as const;
export const SERVICE_CHARGE_MODES = ['COMMON', 'INDIVIDUAL'] as const;
export const SERVICE_CHARGE_STRATEGIES = ['EQUAL', 'BY_SALES', 'BY_ORDERS', 'BY_HOURS'] as const;

type Reader = { queryOne<T>(sql: string, params?: any[]): Promise<T | null>; query<T>(sql: string, params?: any[]): Promise<T[]> };

function id(prefix: string) { return `${prefix}_${crypto.randomUUID()}`; }
function cents(v: unknown): bigint {
  const s = String(v ?? '0').trim();
  if (!/^-?\d+(?:\.\d{1,2})?$/.test(s)) return 0n;
  const neg = s.startsWith('-'); const clean = neg ? s.slice(1) : s;
  const [a, b = ''] = clean.split('.');
  const c = BigInt(a) * 100n + BigInt((b + '00').slice(0, 2));
  return neg ? -c : c;
}
function centsText(c: bigint) { const neg = c < 0n; const abs = neg ? -c : c; return `${neg ? '-' : ''}${abs / 100n}.${(abs % 100n).toString().padStart(2, '0')}`; }
/** A percentage as hundredths of a percent, so 12.34% is 1234n -- no Float anywhere. */
export function pctHundredths(v: unknown): bigint {
  const s = String(v ?? '0').trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(s)) return 0n;
  const [a, b = ''] = s.split('.');
  return BigInt(a) * 100n + BigInt((b + '00').slice(0, 2));
}
function pctText(h: bigint) { return `${h / 100n}.${(h % 100n).toString().padStart(2, '0')}`; }

/**
 * The configuration version in force for a branch at a moment in time. A branch-scoped version
 * always wins over the organisation-wide default; among candidates the latest effective_from wins.
 */
export async function resolveEffectiveConfig(r: Reader, branchId: string, atIso: string): Promise<any | null> {
  const rows = await r.query<any>(
    `SELECT * FROM service_charge_configs
      WHERE status='ACTIVE' AND effective_from<=? AND (effective_to IS NULL OR effective_to>?)
        AND ((scope='BRANCH' AND branch_id=?) OR scope='ORGANIZATION')
      ORDER BY CASE WHEN scope='BRANCH' THEN 0 ELSE 1 END, effective_from DESC
      LIMIT 1`,
    [atIso, atIso, branchId]);
  return rows[0] || null;
}

async function settingValue(r: Reader, key: string): Promise<string | null> {
  const row = await r.queryOne<any>('SELECT value FROM system_settings WHERE key=?', [key]);
  return row?.value != null ? String(row.value) : null;
}

/**
 * The service charge percentage for an order type. Delivery and takeaway (pickup) are their own
 * configurable values -- never a hardcoded number and never silently reused from dine-in.
 */
export async function serviceChargePercentFor(r: Reader, branchId: string, orderType: string, atIso: string): Promise<{ percent: string; configId: string | null }> {
  const config = await resolveEffectiveConfig(r, branchId, atIso);
  const type = String(orderType || '').toUpperCase();
  const fromConfig = config
    ? (type === 'DINE_IN' ? config.percent : type === 'TAKEAWAY' ? config.takeaway_percent : type === 'DELIVERY' ? config.delivery_percent : null)
    : null;
  if (fromConfig != null) return { percent: String(fromConfig), configId: config.id };
  const key = type === 'DINE_IN' ? 'DINE_IN_SERVICE_CHARGE_PERCENT' : type === 'TAKEAWAY' ? 'TAKEAWAY_SERVICE_CHARGE_PERCENT' : type === 'DELIVERY' ? 'DELIVERY_SERVICE_CHARGE_PERCENT' : null;
  if (!key) return { percent: '0', configId: config?.id || null };
  const fallbackDefault = type === 'DINE_IN' ? '10' : '0';
  return { percent: (await settingValue(r, key)) ?? fallbackDefault, configId: config?.id || null };
}

async function insertLedgerRow(tx: TxClient, order: any, row: { key: string; userId: string | null; targetType: string; department: string | null; category: string | null; percent: string; amountCents: bigint; status: string; configId: string | null; strategy: string | null; poolId?: string | null }, now: string) {
  await tx.execute(
    `INSERT INTO service_charge_ledger (id,branch_id,order_id,user_id,target_type,department,base_amount,percent,amount,status,category,config_id,strategy,allocation_key,pool_id,created_at)
     VALUES (?,?,?,?,?,?,CAST(? AS numeric),CAST(? AS numeric),CAST(? AS numeric),?,?,?,?,?,?,?)
     ON CONFLICT (order_id,allocation_key) DO NOTHING`,
    [id('scl'), order.branch_id, order.id, row.userId, row.targetType, row.department, String(order.subtotal || '0'), row.percent, centsText(row.amountCents), row.status, row.category, row.configId, row.strategy, row.key, row.poolId ?? null, now]);
}

/**
 * The WAITERS category keeps the pre-existing operational rule that only a PROFESSIONAL waiter
 * shares in the service charge. It is a membership filter, not a silent re-allocation: the money
 * an excluded member would have received simply stays unallocated and falls to the establishment.
 */
async function memberEligible(tx: TxClient, category: string, userId: string): Promise<boolean> {
  if (category !== 'WAITERS') return true;
  const waiter = await tx.queryOne<any>('SELECT status FROM waiter_profiles WHERE user_id=?', [userId]);
  return !waiter || waiter.status === 'PROFESSIONAL';
}

/**
 * Records who earned this order's service charge, at payment time, from the configuration version
 * the order was priced with. INDIVIDUAL categories pay named employees immediately; COMMON
 * categories record one pool row per order, distributed later by the category's strategy. The sum
 * can never exceed the service charge the order actually charged.
 */
export async function recordServiceChargeLedger(tx: TxClient, order: any, actorId: string, now: string) {
  const serviceCents = cents(order.service_charge || '0');
  if (serviceCents <= 0n) return;
  const baseCents = cents(order.subtotal || '0');
  const configId: string | null = order.service_charge_config_id || (await resolveEffectiveConfig(tx, order.branch_id, order.created_at))?.id || null;

  let allocated = 0n;
  if (configId) {
    const categories = await tx.query<any>(`SELECT * FROM service_charge_categories WHERE config_id=? AND active=true ORDER BY category`, [configId]);
    for (const cat of categories) {
      const catCents = (baseCents * pctHundredths(cat.percent)) / 10000n;
      if (catCents <= 0n) continue;
      if (String(cat.mode).toUpperCase() === 'INDIVIDUAL') {
        const members = await tx.query<any>(`SELECT * FROM service_charge_allocations WHERE category_id=? AND active=true AND user_id IS NOT NULL ORDER BY created_at`, [cat.id]);
        for (const m of members) {
          const amount = (baseCents * pctHundredths(m.percent)) / 10000n;
          if (amount <= 0n) continue; // a member configured at 0% legitimately earns nothing
          if (allocated + amount > serviceCents) continue;
          if (!(await memberEligible(tx, cat.category, m.user_id))) continue;
          await insertLedgerRow(tx, order, { key: `${cat.category}|INDIVIDUAL|${m.user_id}`, userId: m.user_id, targetType: 'INDIVIDUAL', department: cat.category, category: cat.category, percent: String(m.percent), amountCents: amount, status: 'EARNED', configId, strategy: null }, now);
          allocated += amount;
        }
      } else {
        if (allocated + catCents > serviceCents) continue;
        await insertLedgerRow(tx, order, { key: `${cat.category}|POOL`, userId: null, targetType: 'POOL', department: cat.category, category: cat.category, percent: String(cat.percent), amountCents: catCents, status: 'POOLED', configId, strategy: String(cat.strategy) }, now);
        allocated += catCents;
      }
    }
  }

  const remainder = serviceCents - allocated;
  if (remainder > 0n) {
    await insertLedgerRow(tx, order, { key: 'ESTABLISHMENT', userId: null, targetType: 'ESTABLISHMENT', department: null, category: null, percent: '0', amountCents: remainder, status: 'EARNED', configId, strategy: null }, now);
  }
}

/** Weight per member for a COMMON category, computed from real data over the distribution period. */
async function memberWeights(tx: TxClient, branchId: string, strategy: string, userIds: string[], from: string, to: string): Promise<Map<string, bigint>> {
  const weights = new Map<string, bigint>();
  for (const u of userIds) weights.set(u, 0n);
  if (strategy === 'EQUAL') { for (const u of userIds) weights.set(u, 1n); return weights; }
  if (strategy === 'BY_SALES' || strategy === 'BY_ORDERS') {
    const rows = await tx.query<any>(
      `SELECT waiter_user_id AS user_id, COALESCE(SUM(subtotal),0) AS sales, COUNT(*) AS orders
         FROM orders WHERE branch_id=? AND status='COMPLETED' AND created_at>=? AND created_at<? AND waiter_user_id IS NOT NULL
        GROUP BY waiter_user_id`, [branchId, from, to]);
    for (const r of rows) {
      if (!weights.has(r.user_id)) continue;
      weights.set(r.user_id, strategy === 'BY_SALES' ? cents(r.sales) : BigInt(r.orders));
    }
    return weights;
  }
  // BY_HOURS -- real logged-in POS time (waiter and operator sessions), clamped to the period and
  // counted in whole minutes. Staff who never log into a POS have no recorded hours here; that is
  // stated rather than guessed, and a category whose members all weigh zero is reported, not split.
  const fromMs = Date.parse(from), toMs = Date.parse(to);
  for (const table of ['waiter_pos_sessions', 'operator_pos_sessions']) {
    const rows = await tx.query<any>(`SELECT user_id,created_at,last_seen_at FROM ${table} WHERE branch_id=? AND last_seen_at>=? AND created_at<?`, [branchId, from, to]);
    for (const r of rows) {
      if (!weights.has(r.user_id)) continue;
      const start = Math.max(Date.parse(r.created_at), fromMs);
      const end = Math.min(Date.parse(r.last_seen_at), toMs);
      if (!(end > start)) continue;
      weights.set(r.user_id, (weights.get(r.user_id) || 0n) + BigInt(Math.floor((end - start) / 60000)));
    }
  }
  return weights;
}

/** Split `total` across `weights` exactly, with the leftover cents going by largest remainder. */
function splitByWeight(total: bigint, entries: Array<[string, bigint]>): Map<string, bigint> {
  const out = new Map<string, bigint>();
  const totalWeight = entries.reduce((s, [, w]) => s + w, 0n);
  if (totalWeight <= 0n) return out;
  let assigned = 0n;
  const remainders: Array<[string, bigint]> = [];
  for (const [user, w] of entries) {
    const share = (total * w) / totalWeight;
    out.set(user, share); assigned += share;
    remainders.push([user, (total * w) % totalWeight]);
  }
  remainders.sort((a, b) => (b[1] === a[1] ? (a[0] < b[0] ? -1 : 1) : (b[1] > a[1] ? 1 : -1)));
  let leftover = total - assigned;
  for (const [user] of remainders) { if (leftover <= 0n) break; out.set(user, (out.get(user) || 0n) + 1n); leftover -= 1n; }
  return out;
}

/**
 * Distributes the COMMON category pools recorded in a period to their members, by each category's
 * configured strategy. Every pool is split within its own order, so each distributed row stays
 * attached to the order that earned it and the totals reconcile exactly.
 */
export async function distributeServiceChargePools(tx: TxClient, branchId: string, from: string, to: string, actorId: string, req: any, now: string) {
  const pools = await tx.query<any>(
    `SELECT * FROM service_charge_ledger WHERE branch_id=? AND target_type='POOL' AND status='POOLED' AND created_at>=? AND created_at<? ORDER BY created_at FOR UPDATE`,
    [branchId, from, to]);
  const distributed: any[] = [];
  const skipped: any[] = [];
  const weightCache = new Map<string, Map<string, bigint>>();

  for (const pool of pools) {
    const groupKey = `${pool.config_id}|${pool.category}`;
    let weights = weightCache.get(groupKey);
    if (!weights) {
      const cat = await tx.queryOne<any>('SELECT * FROM service_charge_categories WHERE config_id=? AND category=?', [pool.config_id, pool.category]);
      const members = cat ? await tx.query<any>(`SELECT user_id FROM service_charge_allocations WHERE category_id=? AND active=true AND user_id IS NOT NULL ORDER BY created_at`, [cat.id]) : [];
      const eligible: string[] = [];
      for (const m of members) if (await memberEligible(tx, String(pool.category), m.user_id)) eligible.push(m.user_id);
      weights = await memberWeights(tx, branchId, String(pool.strategy || 'EQUAL'), eligible, from, to);
      weightCache.set(groupKey, weights);
    }
    const entries = [...weights.entries()];
    const shares = splitByWeight(cents(pool.amount), entries);
    if (shares.size === 0) { skipped.push({ ledger_id: pool.id, order_id: pool.order_id, category: pool.category, strategy: pool.strategy, reason: entries.length === 0 ? 'NO_MEMBERS' : 'ZERO_WEIGHT' }); continue; }
    const order = await tx.queryOne<any>('SELECT id,branch_id,subtotal FROM orders WHERE id=?', [pool.order_id]);
    for (const [userId, amount] of shares) {
      if (amount <= 0n) continue;
      await insertLedgerRow(tx, order, { key: `${pool.category}|DISTRIBUTED|${userId}`, userId, targetType: 'DISTRIBUTED', department: pool.category, category: pool.category, percent: '0', amountCents: amount, status: 'DISTRIBUTED', configId: pool.config_id, strategy: String(pool.strategy || 'EQUAL'), poolId: pool.id }, now);
      distributed.push({ ledger_id: pool.id, order_id: pool.order_id, category: pool.category, user_id: userId, amount: centsText(amount) });
    }
    await tx.execute(`UPDATE service_charge_ledger SET status='DISTRIBUTED' WHERE id=? AND status='POOLED'`, [pool.id]);
  }

  await insertAuditLog(tx.execute, { userId: actorId, branchId, action: 'SERVICE_CHARGE_POOLS_DISTRIBUTED', entityType: 'SERVICE_CHARGE_LEDGER', entityId: branchId, newValues: { from, to, pools: pools.length, distributed_rows: distributed.length, skipped }, req });
  return { pools_processed: pools.length, distributed, skipped };
}

export { cents as serviceChargeCents, centsText as serviceChargeCentsText, pctText as serviceChargePercentText };
