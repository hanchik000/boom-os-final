import { Router, Request } from 'express';
import { query, queryOne } from '../db';
import { authenticateToken, requirePermission } from '../auth';

// ================================================================================================
// Stage 34.11 -- Food & Sales Analytics.
//
// This is a READ-ONLY module. It creates nothing, changes nothing, and owns no table of its own.
// Every figure here is derived from the existing Order Core (orders / order_items) and from the
// historical cost each line already carries. There is no analytics ledger, no nightly rollup and
// no cached aggregate that could drift away from the orders it claims to describe.
//
// THE THREE RULES THIS MODULE IS BUILT ON
//
// 1. WHAT COUNTS AS SOLD. Exactly the orders the Order Core calls COMPLETED. An order that was
//    cancelled, refunded or closed by the establishment is not a sale and never appears in
//    revenue -- those live in the closure reports, which is where they belong.
//
// 2. HOW COST IS KNOWN. From order_items.recipe_cost_snapshot -- the ingredient cost of that line
//    AS SOLD, stamped at consumption time. Never from today's recipe. A recipe change next month
//    can therefore never rewrite last month's margin. Lines that carry no snapshot are counted
//    and REPORTED as such rather than silently treated as free to produce.
//
// 3. WHY NOTHING IS DOUBLE-COUNTED. An order's items are a partition: a split order divides its
//    lines between separate bills, it never copies them. So summing order_items over a period
//    counts each line exactly once whether or not the order was split, and summing orders counts
//    each order exactly once. Item-level revenue (gross of order-level discounts, before service
//    charge) and order-level revenue (net of discounts, including service charge) are two
//    different questions, so they are reported as two clearly named figures and never added
//    together.
//
// The module also refuses to editorialise. It does not label a dish a star or a dog: the matrix
// endpoint returns each dish's measured popularity and margin together with the medians it was
// measured against, and leaves the judgement to the manager reading it.
// ================================================================================================

const router = Router();
router.use(authenticateToken);

function allowed(req: Request, b: string) { return Boolean(req.user?.isSuperUser || req.user?.allowedBranchIds.includes(b)); }

// All money is BigInt cents; all 4-decimal costs are BigInt scale-4. No Float anywhere.
function moneyCents(v: unknown): bigint {
  const s = String(v ?? '0').trim();
  if (!/^-?\d+(?:\.\d{1,2})?$/.test(s)) return 0n;
  const neg = s.startsWith('-'); const clean = neg ? s.slice(1) : s;
  const [a, b = ''] = clean.split('.');
  const c = BigInt(a) * 100n + BigInt((b + '00').slice(0, 2));
  return neg ? -c : c;
}
function centsText(c: bigint): string { const neg = c < 0n; const abs = neg ? -c : c; return `${neg ? '-' : ''}${abs / 100n}.${(abs % 100n).toString().padStart(2, '0')}`; }
// A 4-decimal cost (recipe_cost_snapshot) folded down to cents, truncating -- the same direction
// every other Stage 34 money conversion truncates.
function cost4ToCents(v: unknown): bigint {
  const s = String(v ?? '0').trim();
  if (!/^-?\d+(?:\.\d{1,4})?$/.test(s)) return 0n;
  const neg = s.startsWith('-'); const clean = neg ? s.slice(1) : s;
  const [a, b = ''] = clean.split('.');
  const scaled4 = BigInt(a) * 10000n + BigInt((b + '0000').slice(0, 4));
  const c = scaled4 / 100n;
  return neg ? -c : c;
}
function pctString(numeratorCents: bigint, denominatorCents: bigint): string | null {
  if (denominatorCents <= 0n) return null;
  const hundredths = (numeratorCents * 10000n) / denominatorCents;
  const neg = hundredths < 0n; const abs = neg ? -hundredths : hundredths;
  return `${neg ? '-' : ''}${abs / 100n}.${(abs % 100n).toString().padStart(2, '0')}`;
}
// pctString's own output, read back as hundredths. Percentages are compared against medians
// below, so they are parsed with BigInt like every other figure here -- never parseFloat.
function pctHundredths(v: string | null): bigint | null {
  if (v === null) return null;
  const m = /^(-?)(\d+)\.(\d{2})$/.exec(v);
  if (!m) return null;
  const h = BigInt(m[2]) * 100n + BigInt(m[3]);
  return m[1] ? -h : h;
}
function divCents(totalCents: bigint, count: number): string {
  if (count <= 0) return '0.00';
  return centsText(totalCents / BigInt(count));
}
// The median of an already-sorted BigInt list. With an even count the two middle values are
// averaged, truncating -- stated here because the matrix endpoint publishes the medians it used.
function median(sorted: bigint[]): bigint {
  if (!sorted.length) return 0n;
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2n;
}

// SOLD_STATUS is the single definition of "this was sold" for the whole module. It is the Order
// Core's own COMPLETED marker -- not a second opinion about what a sale is.
const SOLD_STATUS = 'COMPLETED';
const ORDER_TYPES = ['DINE_IN', 'TAKEAWAY', 'DELIVERY'];

// Every endpoint takes the same period, resolved the same way: an explicit ISO window, or today
// in the BRANCH's own timezone. A report that silently meant "today in UTC" would be wrong for
// half of every evening service.
async function resolvePeriod(req: Request, branchId: string) {
  const branch = await queryOne<any>('SELECT id,name,timezone FROM branches WHERE id=?', [branchId]);
  const tz = branch?.timezone || 'UTC';
  let start = typeof req.query.start === 'string' && req.query.start ? req.query.start : null;
  let end = typeof req.query.end === 'string' && req.query.end ? req.query.end : null;
  if (!start || !end) {
    const bounds = await queryOne<any>(
      `SELECT (date_trunc('day', (now() AT TIME ZONE ?)) AT TIME ZONE ?) AS day_start, now() AS day_end`, [tz, tz]);
    start = start || new Date(bounds.day_start).toISOString();
    end = end || new Date(bounds.day_end).toISOString();
  }
  return { start, end, tz, branchName: branch?.name || null };
}

function branchOr403(req: Request): string | null {
  const b = String(req.query.branch_id || req.user!.branch_id || '');
  return b && allowed(req, b) ? b : null;
}
function deny(res: any) {
  return res.status(403).json({ error: 'BRANCH_ACCESS_DENIED', code: 'BRANCH_ACCESS_DENIED', message: 'Branch is outside your access scope.', details: {} });
}

// ================================================================================================
// GET /api/analytics/sales -- the period's sales at ORDER level.
//
// Both revenue figures are reported side by side and named for what they are, because they answer
// different questions and adding them together would double-count:
//   item_revenue    = SUM(order_items.subtotal)  -- what the food was priced at, before any
//                     order-level discount and before service charge
//   net_revenue     = SUM(orders.final_amount)   -- what the guest actually owed: items, less
//                     discounts, plus service charge
// The identity item_revenue - discounts + service_charge = net_revenue is asserted by the tests.
// ================================================================================================
router.get('/sales', requirePermission('analytics.view'), async (req, res) => {
  const b = branchOr403(req); if (!b) return deny(res);
  const { start, end, tz } = await resolvePeriod(req, b);
  const orderType = typeof req.query.order_type === 'string' && ORDER_TYPES.includes(req.query.order_type.toUpperCase()) ? req.query.order_type.toUpperCase() : null;
  const typeSql = orderType ? ' AND o.order_type=?' : '';
  const typeParam = orderType ? [orderType] : [];

  const totals = await queryOne<any>(`SELECT COUNT(*)::int AS orders,
      COALESCE(SUM(o.subtotal),0) AS subtotal, COALESCE(SUM(o.discount),0) AS discounts,
      COALESCE(SUM(o.service_charge),0) AS service_charge, COALESCE(SUM(o.final_amount),0) AS net_revenue
    FROM orders o WHERE o.branch_id=? AND o.status=? AND o.created_at>=? AND o.created_at<=?${typeSql}`,
    [b, SOLD_STATUS, start, end, ...typeParam]);

  const itemRow = await queryOne<any>(`SELECT COALESCE(SUM(oi.subtotal),0) AS item_revenue,
      COALESCE(SUM(oi.quantity),0)::int AS units,
      COALESCE(SUM(oi.quantity) FILTER (WHERE oi.price_snapshot = 0),0)::int AS give_away_units
    FROM order_items oi JOIN orders o ON o.id=oi.order_id
    WHERE o.branch_id=? AND o.status=? AND oi.status='ACTIVE' AND o.created_at>=? AND o.created_at<=?${typeSql}`,
    [b, SOLD_STATUS, start, end, ...typeParam]);

  const byType = await query<any>(`SELECT o.order_type, COUNT(*)::int AS orders, COALESCE(SUM(o.final_amount),0) AS net_revenue
    FROM orders o WHERE o.branch_id=? AND o.status=? AND o.created_at>=? AND o.created_at<=?${typeSql}
    GROUP BY o.order_type ORDER BY net_revenue DESC`, [b, SOLD_STATUS, start, end, ...typeParam]);

  const bySource = await query<any>(`SELECT o.source, COUNT(*)::int AS orders, COALESCE(SUM(o.final_amount),0) AS net_revenue
    FROM orders o WHERE o.branch_id=? AND o.status=? AND o.created_at>=? AND o.created_at<=?${typeSql}
    GROUP BY o.source ORDER BY net_revenue DESC`, [b, SOLD_STATUS, start, end, ...typeParam]);

  // How the money was settled. A credit sale is a real sale and appears here as CREDIT; a credit
  // REPAYMENT is not a sale and has no payment row, so it can never leak into this breakdown.
  const byMethod = await query<any>(`SELECT p.method, COUNT(*)::int AS payments, COALESCE(SUM(p.amount),0) AS amount
    FROM payments p JOIN orders o ON o.id=p.order_id
    WHERE o.branch_id=? AND o.status=? AND p.status='PAID' AND o.created_at>=? AND o.created_at<=?${typeSql}
    GROUP BY p.method ORDER BY amount DESC`, [b, SOLD_STATUS, start, end, ...typeParam]);

  const orders = totals?.orders || 0;
  const netCents = moneyCents(totals?.net_revenue);
  res.json({
    branch_id: b, period: { start, end, timezone: tz }, order_type: orderType,
    orders,
    item_revenue: centsText(moneyCents(itemRow?.item_revenue)),
    discounts: centsText(moneyCents(totals?.discounts)),
    service_charge: centsText(moneyCents(totals?.service_charge)),
    net_revenue: centsText(netCents),
    average_check: divCents(netCents, orders),
    units_sold: itemRow?.units || 0,
    give_away_units: itemRow?.give_away_units || 0,
    by_order_type: byType.map((r: any) => ({ order_type: r.order_type, orders: r.orders, net_revenue: centsText(moneyCents(r.net_revenue)), average_check: divCents(moneyCents(r.net_revenue), r.orders) })),
    by_source: bySource.map((r: any) => ({ source: r.source, orders: r.orders, net_revenue: centsText(moneyCents(r.net_revenue)) })),
    by_payment_method: byMethod.map((r: any) => ({ method: r.method, payments: r.payments, amount: centsText(moneyCents(r.amount)) })),
  });
});

// ================================================================================================
// The one dish-level aggregation every dish/category/matrix endpoint is built from, so those three
// can never disagree about what a dish sold or cost.
// ================================================================================================
async function dishRows(branchId: string, start: string, end: string) {
  return query<any>(`SELECT oi.menu_item_id, m.name_ru, m.name_tk, m.category_id, c.name_ru AS category_ru, c.name_tk AS category_tk,
      COALESCE(SUM(oi.quantity),0)::int AS units_sold,
      COALESCE(SUM(oi.quantity) FILTER (WHERE oi.price_snapshot = 0),0)::int AS give_away_units,
      COALESCE(SUM(oi.subtotal),0) AS revenue,
      COALESCE(SUM(oi.recipe_cost_snapshot),0) AS cost,
      COALESCE(SUM(oi.quantity) FILTER (WHERE oi.recipe_cost_snapshot IS NULL),0)::int AS units_without_cost,
      COUNT(DISTINCT oi.order_id)::int AS orders
    FROM order_items oi
    JOIN orders o ON o.id=oi.order_id
    LEFT JOIN menu_items m ON m.id=oi.menu_item_id
    LEFT JOIN menu_categories c ON c.id=m.category_id
    WHERE o.branch_id=? AND o.status=? AND oi.status='ACTIVE' AND oi.menu_item_id IS NOT NULL
      AND o.created_at>=? AND o.created_at<=?
    GROUP BY oi.menu_item_id, m.name_ru, m.name_tk, m.category_id, c.name_ru, c.name_tk`,
    [branchId, SOLD_STATUS, start, end]);
}

function shapeDish(r: any) {
  const revenue = moneyCents(r.revenue);
  const cost = cost4ToCents(r.cost);
  const margin = revenue - cost;
  return {
    menu_item_id: r.menu_item_id, name_ru: r.name_ru, name_tk: r.name_tk,
    category_id: r.category_id, category_ru: r.category_ru, category_tk: r.category_tk,
    units_sold: r.units_sold, orders: r.orders,
    // A compliment and a redeemed breakfast are real lines priced at zero: they consume real food
    // and are counted in units, so they are shown separately rather than quietly depressing a
    // dish's margin with no explanation.
    give_away_units: r.give_away_units,
    revenue: centsText(revenue), cost: centsText(cost),
    margin: centsText(margin), margin_percent: pctString(margin, revenue),
    average_price: r.units_sold > 0 ? divCents(revenue, r.units_sold) : '0.00',
    // Stated, never assumed: lines whose cost was never stamped are not free to produce.
    units_without_cost: r.units_without_cost,
  };
}

const DISH_SORTS: Record<string, (a: any, b: any) => number> = {
  UNITS: (a, b) => b.units_sold - a.units_sold,
  REVENUE: (a, b) => (moneyCents(b.revenue) > moneyCents(a.revenue) ? 1 : moneyCents(b.revenue) < moneyCents(a.revenue) ? -1 : 0),
  MARGIN: (a, b) => (moneyCents(b.margin) > moneyCents(a.margin) ? 1 : moneyCents(b.margin) < moneyCents(a.margin) ? -1 : 0),
};

// ================================================================================================
// GET /api/analytics/dishes -- the dish ranking. sort=UNITS|REVENUE|MARGIN, order=DESC|ASC.
// The ranking is whatever the manager asked to rank by; the module attaches no verdict to it.
// ================================================================================================
router.get('/dishes', requirePermission('analytics.view'), async (req, res) => {
  const b = branchOr403(req); if (!b) return deny(res);
  const { start, end, tz } = await resolvePeriod(req, b);
  const sortRaw = typeof req.query.sort === 'string' ? req.query.sort.toUpperCase() : 'REVENUE';
  const sort = DISH_SORTS[sortRaw] ? sortRaw : 'REVENUE';
  const ascending = typeof req.query.order === 'string' && req.query.order.toUpperCase() === 'ASC';
  const limit = Math.min(Math.max(parseInt(String(req.query.limit || '100'), 10) || 100, 1), 500);
  const categoryId = typeof req.query.category_id === 'string' && req.query.category_id ? req.query.category_id : null;

  let items = (await dishRows(b, start, end)).map(shapeDish);
  if (categoryId) items = items.filter(d => d.category_id === categoryId);
  items.sort(DISH_SORTS[sort]);
  if (ascending) items.reverse();
  res.json({ branch_id: b, period: { start, end, timezone: tz }, sort, order: ascending ? 'ASC' : 'DESC', category_id: categoryId, total_dishes: items.length, dishes: items.slice(0, limit) });
});

// ================================================================================================
// GET /api/analytics/categories -- the same dish figures rolled up by menu category. Rolled up
// from the SAME aggregation, so a category total is always exactly its dishes' totals.
// ================================================================================================
router.get('/categories', requirePermission('analytics.view'), async (req, res) => {
  const b = branchOr403(req); if (!b) return deny(res);
  const { start, end, tz } = await resolvePeriod(req, b);
  const rows = await dishRows(b, start, end);
  const acc = new Map<string, { category_id: string | null; name_ru: string | null; name_tk: string | null; units_sold: number; give_away_units: number; dishes: number; revenueCents: bigint; costCents: bigint; units_without_cost: number }>();
  for (const r of rows) {
    const key = r.category_id || 'UNCATEGORIZED';
    const cur = acc.get(key) || { category_id: r.category_id, name_ru: r.category_ru, name_tk: r.category_tk, units_sold: 0, give_away_units: 0, dishes: 0, revenueCents: 0n, costCents: 0n, units_without_cost: 0 };
    cur.units_sold += r.units_sold;
    cur.give_away_units += r.give_away_units;
    cur.units_without_cost += r.units_without_cost;
    cur.dishes += 1;
    cur.revenueCents += moneyCents(r.revenue);
    cur.costCents += cost4ToCents(r.cost);
    acc.set(key, cur);
  }
  const totalRevenue = [...acc.values()].reduce((s, c) => s + c.revenueCents, 0n);
  const categories = [...acc.values()].map(c => {
    const margin: bigint = c.revenueCents - c.costCents;
    return {
      category_id: c.category_id, name_ru: c.name_ru, name_tk: c.name_tk,
      dishes: c.dishes, units_sold: c.units_sold, give_away_units: c.give_away_units,
      revenue: centsText(c.revenueCents), cost: centsText(c.costCents),
      margin: centsText(margin), margin_percent: pctString(margin, c.revenueCents),
      revenue_share_percent: pctString(c.revenueCents, totalRevenue),
      units_without_cost: c.units_without_cost,
    };
  }).sort((a, z) => (moneyCents(z.revenue) > moneyCents(a.revenue) ? 1 : moneyCents(z.revenue) < moneyCents(a.revenue) ? -1 : 0));
  res.json({ branch_id: b, period: { start, end, timezone: tz }, total_revenue: centsText(totalRevenue), categories });
});

// ================================================================================================
// GET /api/analytics/time -- when the branch actually sells, in the BRANCH's own timezone.
// ================================================================================================
router.get('/time', requirePermission('analytics.view'), async (req, res) => {
  const b = branchOr403(req); if (!b) return deny(res);
  const { start, end, tz } = await resolvePeriod(req, b);
  const local = `(o.created_at::timestamptz AT TIME ZONE ?)`;
  const byHour = await query<any>(`SELECT EXTRACT(HOUR FROM ${local})::int AS hour, COUNT(*)::int AS orders,
      COALESCE(SUM(o.final_amount),0) AS net_revenue
    FROM orders o WHERE o.branch_id=? AND o.status=? AND o.created_at>=? AND o.created_at<=?
    GROUP BY 1 ORDER BY 1`, [tz, b, SOLD_STATUS, start, end]);
  const byWeekday = await query<any>(`SELECT EXTRACT(ISODOW FROM ${local})::int AS weekday, COUNT(*)::int AS orders,
      COALESCE(SUM(o.final_amount),0) AS net_revenue
    FROM orders o WHERE o.branch_id=? AND o.status=? AND o.created_at>=? AND o.created_at<=?
    GROUP BY 1 ORDER BY 1`, [tz, b, SOLD_STATUS, start, end]);
  const byDay = await query<any>(`SELECT to_char(${local}, 'YYYY-MM-DD') AS day, COUNT(*)::int AS orders,
      COALESCE(SUM(o.final_amount),0) AS net_revenue
    FROM orders o WHERE o.branch_id=? AND o.status=? AND o.created_at>=? AND o.created_at<=?
    GROUP BY 1 ORDER BY 1`, [tz, b, SOLD_STATUS, start, end]);
  const shape = (rows: any[], key: string) => rows.map((r: any) => ({ [key]: r[key], orders: r.orders, net_revenue: centsText(moneyCents(r.net_revenue)), average_check: divCents(moneyCents(r.net_revenue), r.orders) }));
  res.json({ branch_id: b, period: { start, end, timezone: tz }, by_hour: shape(byHour, 'hour'), by_weekday: shape(byWeekday, 'weekday'), by_day: shape(byDay, 'day') });
});

// ================================================================================================
// GET /api/analytics/matrix -- the menu matrix, WITHOUT a verdict.
//
// Each dish is returned with its measured popularity (units sold) and its measured margin
// percentage, plus the two medians those were measured against and which side of each median the
// dish falls on. It deliberately does NOT name quadrants or call any dish a star, a puzzle or a
// dog: which of these numbers matters, and what to do about it, is the manager's decision. The
// medians are published so the manager can see exactly what the comparison was against.
// ================================================================================================
router.get('/matrix', requirePermission('analytics.view'), async (req, res) => {
  const b = branchOr403(req); if (!b) return deny(res);
  const { start, end, tz } = await resolvePeriod(req, b);
  const dishes = (await dishRows(b, start, end)).map(shapeDish).filter(d => d.units_sold > 0);
  const unitsSorted = dishes.map(d => BigInt(d.units_sold)).sort((a, z) => (a < z ? -1 : a > z ? 1 : 0));
  // A dish with no revenue (given away every time) has no margin percentage to compare, so it is
  // excluded from the margin median rather than counted as 0%.
  const marginSorted = dishes.map(d => pctHundredths(d.margin_percent)).filter((x): x is bigint => x !== null).sort((a, z) => (a < z ? -1 : a > z ? 1 : 0));
  const unitsMedian = median(unitsSorted);
  const marginMedian = median(marginSorted);
  res.json({
    branch_id: b, period: { start, end, timezone: tz },
    // units_sold is a COUNT, not money -- the only Number() in this file, and exact for counts.
    medians: { units_sold: Number(unitsMedian), margin_percent: centsText(marginMedian) },
    dishes: dishes.map(d => ({
      menu_item_id: d.menu_item_id, name_ru: d.name_ru, name_tk: d.name_tk,
      category_id: d.category_id, category_ru: d.category_ru,
      units_sold: d.units_sold, revenue: d.revenue, margin: d.margin, margin_percent: d.margin_percent,
      give_away_units: d.give_away_units, units_without_cost: d.units_without_cost,
      above_median_popularity: BigInt(d.units_sold) >= unitsMedian,
      above_median_margin: pctHundredths(d.margin_percent) === null ? null : (pctHundredths(d.margin_percent) as bigint) >= marginMedian,
    })),
  });
});

// ================================================================================================
// GET /api/analytics/dishes/:menuItemId -- the drill-down. Every order line behind one dish's
// numbers, so a figure in the ranking can be traced back to the orders that produced it.
// ================================================================================================
router.get('/dishes/:menuItemId', requirePermission('analytics.view'), async (req, res) => {
  const b = branchOr403(req); if (!b) return deny(res);
  const { start, end, tz } = await resolvePeriod(req, b);
  const item = await queryOne<any>('SELECT id,name_ru,name_tk,category_id,price FROM menu_items WHERE id=?', [req.params.menuItemId]);
  if (!item) return res.status(404).json({ error: 'NOT_FOUND', code: 'MENU_ITEM_NOT_FOUND', message: 'Menu item not found.', details: {} });
  const summary = (await dishRows(b, start, end)).filter((r: any) => r.menu_item_id === item.id).map(shapeDish)[0] || null;
  const lines = await query<any>(`SELECT oi.id, oi.order_id, o.order_number, o.order_type, o.source, o.created_at,
      oi.quantity, oi.price_snapshot, oi.subtotal, oi.recipe_cost_snapshot, oi.recipe_version_snapshot,
      u.full_name AS waiter_name, cu.name AS customer_name
    FROM order_items oi
    JOIN orders o ON o.id=oi.order_id
    LEFT JOIN users u ON u.id=o.waiter_user_id
    LEFT JOIN customers cu ON cu.id=o.customer_id
    WHERE o.branch_id=? AND o.status=? AND oi.status='ACTIVE' AND oi.menu_item_id=?
      AND o.created_at>=? AND o.created_at<=?
    ORDER BY o.created_at DESC LIMIT 500`, [b, SOLD_STATUS, item.id, start, end]);
  res.json({
    branch_id: b, period: { start, end, timezone: tz },
    menu_item: { id: item.id, name_ru: item.name_ru, name_tk: item.name_tk, category_id: item.category_id, current_price: item.price },
    summary,
    lines: lines.map((l: any) => ({ ...l, is_give_away: moneyCents(l.price_snapshot) === 0n })),
  });
});

export default router;
