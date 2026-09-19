import { Router, Request } from 'express';
import { query, queryOne } from '../db';
import { authenticateToken, requirePermission } from '../auth';

// ================================================================================================
// Stage 34.12 -- the unified BOOMCARD Operations Journal.
//
// This is a READ MODEL over ledgers and events that already exist and remain the sole source of
// truth: boomcoin_ledger, boomback_ledger and boomcard_events. It creates no financial ledger of
// its own, writes nothing, and duplicates no transaction. Every row is a normalized view of one
// existing source row, tagged with which table and which id it came from -- "source" + "source_id"
// are exactly the drill-down back to that original record.
//
// A field the source row does not carry is returned as null. Nothing here is invented: there is no
// arithmetic in this module at all -- every money and count column is read straight out of its
// source row (cast to text/int for a uniform shape across the UNION) and never recomputed.
//
// Four categories, so the report can never mix a benefit or a settlement into sales revenue:
//   OPERATIONAL_BENEFIT -- a redemption that consumed something real (a breakfast, a birthday gift)
//   PAYMENT_SETTLEMENT  -- BOOMBACK spent against a bill (money, never a discount)
//   CUSTOMER_REWARD     -- something earned or granted to the guest (BOOMCOIN, BOOMBACK, a gift)
//   LIFECYCLE           -- the card itself: identified, activated, renewed, deactivated
// ================================================================================================

const router = Router();
// Scoped to '/journal' specifically, NOT router-wide: this router is mounted at the same
// '/api/boomcard' base path as boomcardRouter (ahead of it, so GET /journal is never swallowed by
// GET /:id -- see server.ts), and boomcardRouter has its own deliberately PUBLIC route
// (GET /cabinet/:token, the guest's own cabinet) before its authenticateToken gate. An unscoped
// router.use(authenticateToken) here would intercept every request under /api/boomcard -- cabinet
// included -- with a 401 before boomcardRouter ever saw it.
router.use('/journal', authenticateToken);

function allowed(req: Request, b: string) { return Boolean(req.user?.isSuperUser || req.user?.allowedBranchIds.includes(b)); }

const SOURCES = ['BOOMCOIN_LEDGER', 'BOOMBACK_LEDGER', 'BOOMCARD_EVENT'] as const;
const EVENT_TYPES = [
  'BOOMCOIN_EARNED', 'BOOMCOIN_REDEEMED', 'BOOMCOIN_ADJUSTED', 'BOOMCOIN_REVERSED',
  'BOOMBACK_EARNED', 'BOOMBACK_REDEEMED', 'BOOMBACK_ADJUSTED', 'BOOMBACK_REVERSED',
  'BREAKFAST_GRANTED', 'BREAKFAST_REDEEMED',
  'BIRTHDAY_GIFT_GRANTED', 'BIRTHDAY_GIFT_REDEEMED',
  'BOOMCARD_ACTIVATED', 'BOOMCARD_RENEWED', 'BOOMCARD_DEACTIVATED', 'CANDIDATE_IDENTIFIED',
] as const;

// The one scalar role lookup every branch of the union uses -- a correlated subquery rather than a
// LEFT JOIN, because a JOIN onto user_roles would fan a multi-role operator into duplicate journal
// rows and corrupt both the count and the pagination.
const ROLE_SUBQUERY = (userIdExpr: string) =>
  `(SELECT r.code FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE ur.user_id=${userIdExpr} ORDER BY r.code LIMIT 1)`;

// ---------------------------------------------------------------- the three normalized branches
// Each SELECT produces the exact same column list in the exact same order, so a plain UNION ALL is
// safe. branch_id and the period (both indexed as (branch_id, created_at) on every source table)
// are applied HERE, inside each branch, so the union can actually use those indexes; every other
// filter is applied once, on the combined result, in the outer query below.
function boomcoinBranch(branchId: string, start: string | null, end: string | null, params: any[]) {
  params.push(branchId); let sql = `bcl.branch_id=?`;
  if (start) { params.push(start); sql += ` AND bcl.created_at>=?`; }
  if (end) { params.push(end); sql += ` AND bcl.created_at<=?`; }
  return `SELECT
      'BOOMCOIN_LEDGER' AS source, bcl.id AS source_id,
      CASE bcl.type WHEN 'EARNED' THEN 'BOOMCOIN_EARNED' WHEN 'REDEEMED' THEN 'BOOMCOIN_REDEEMED' WHEN 'ADJUSTMENT' THEN 'BOOMCOIN_ADJUSTED' WHEN 'REVERSED' THEN 'BOOMCOIN_REVERSED' ELSE 'BOOMCOIN_' || bcl.type END AS event_type,
      'CUSTOMER_REWARD' AS event_category,
      bcl.created_at, bcl.branch_id, br.name AS branch_name,
      bc.id AS boomcard_id, bc.card_number,
      bcl.customer_id, c.name AS customer_name, c.phone AS customer_phone,
      bcl.order_id, o.order_number,
      NULL::text AS payment_id,
      NULL::text AS menu_item_id, NULL::text AS menu_item_name_ru, NULL::text AS menu_item_name_tk,
      NULL::int AS quantity,
      bcl.qualifying_amount::text AS amount,
      NULL::text AS boomback_amount,
      bcl.coins AS boomcoin_amount,
      bcl.balance_before::text AS balance_before, bcl.balance_after::text AS balance_after,
      bcl.created_by AS operator_id, u.full_name AS operator_name, ${ROLE_SUBQUERY('bcl.created_by')} AS operator_role,
      NULL::text AS approver_id, NULL::text AS approver_name,
      bcl.reason, 'POSTED' AS status,
      NULL::text AS audit_action, NULL::text AS audit_entity_type, NULL::text AS audit_entity_id
    FROM boomcoin_ledger bcl
    JOIN customers c ON c.id=bcl.customer_id
    JOIN branches br ON br.id=bcl.branch_id
    LEFT JOIN boomcards bc ON bc.customer_id=bcl.customer_id
    LEFT JOIN orders o ON o.id=bcl.order_id
    LEFT JOIN users u ON u.id=bcl.created_by
    WHERE ${sql}`;
}
function boombackBranch(branchId: string, start: string | null, end: string | null, params: any[]) {
  params.push(branchId); let sql = `bbl.branch_id=?`;
  if (start) { params.push(start); sql += ` AND bbl.created_at>=?`; }
  if (end) { params.push(end); sql += ` AND bbl.created_at<=?`; }
  return `SELECT
      'BOOMBACK_LEDGER' AS source, bbl.id AS source_id,
      CASE bbl.type WHEN 'EARNED' THEN 'BOOMBACK_EARNED' WHEN 'REDEEMED' THEN 'BOOMBACK_REDEEMED' WHEN 'ADJUSTMENT' THEN 'BOOMBACK_ADJUSTED' WHEN 'REVERSED' THEN 'BOOMBACK_REVERSED' ELSE 'BOOMBACK_' || bbl.type END AS event_type,
      -- Rule: a BOOMBACK redemption is a PAYMENT SETTLEMENT, never a discount -- it gets its own
      -- category so a report can never fold it into a discount total.
      CASE WHEN bbl.type='REDEEMED' THEN 'PAYMENT_SETTLEMENT' ELSE 'CUSTOMER_REWARD' END AS event_category,
      bbl.created_at, bbl.branch_id, br.name AS branch_name,
      bc.id AS boomcard_id, bc.card_number,
      bbl.customer_id, c.name AS customer_name, c.phone AS customer_phone,
      bbl.order_id, o.order_number,
      bbl.payment_id,
      NULL::text AS menu_item_id, NULL::text AS menu_item_name_ru, NULL::text AS menu_item_name_tk,
      NULL::int AS quantity,
      NULL::text AS amount,
      bbl.amount::text AS boomback_amount,
      NULL::int AS boomcoin_amount,
      bbl.balance_before::text AS balance_before, bbl.balance_after::text AS balance_after,
      bbl.created_by AS operator_id, u.full_name AS operator_name, ${ROLE_SUBQUERY('bbl.created_by')} AS operator_role,
      NULL::text AS approver_id, NULL::text AS approver_name,
      bbl.reason, 'POSTED' AS status,
      NULL::text AS audit_action, NULL::text AS audit_entity_type, NULL::text AS audit_entity_id
    FROM boomback_ledger bbl
    JOIN customers c ON c.id=bbl.customer_id
    JOIN branches br ON br.id=bbl.branch_id
    LEFT JOIN boomcards bc ON bc.customer_id=bbl.customer_id
    LEFT JOIN orders o ON o.id=bbl.order_id
    LEFT JOIN users u ON u.id=bbl.created_by
    WHERE ${sql}`;
}
function eventsBranch(branchId: string, start: string | null, end: string | null, params: any[]) {
  params.push(branchId); let sql = `be.branch_id=?`;
  if (start) { params.push(start); sql += ` AND be.created_at>=?`; }
  if (end) { params.push(end); sql += ` AND be.created_at<=?`; }
  return `SELECT
      'BOOMCARD_EVENT' AS source, be.id AS source_id,
      CASE be.type WHEN 'ACTIVATED' THEN 'BOOMCARD_ACTIVATED' WHEN 'RENEWED' THEN 'BOOMCARD_RENEWED' WHEN 'DEACTIVATED' THEN 'BOOMCARD_DEACTIVATED' ELSE be.type END AS event_type,
      CASE
        WHEN be.type IN ('BREAKFAST_REDEEMED','BIRTHDAY_GIFT_REDEEMED') THEN 'OPERATIONAL_BENEFIT'
        WHEN be.type IN ('BREAKFAST_GRANTED','BIRTHDAY_GIFT_GRANTED') THEN 'CUSTOMER_REWARD'
        ELSE 'LIFECYCLE'
      END AS event_category,
      be.created_at, be.branch_id, br.name AS branch_name,
      be.boomcard_id, bc.card_number,
      be.customer_id, c.name AS customer_name, c.phone AS customer_phone,
      be.order_id, o.order_number,
      NULL::text AS payment_id,
      be.menu_item_id, mi.name_ru AS menu_item_name_ru, mi.name_tk AS menu_item_name_tk,
      be.quantity,
      be.qualifying_spend::text AS amount,
      NULL::text AS boomback_amount,
      NULL::int AS boomcoin_amount,
      NULL::text AS balance_before, NULL::text AS balance_after,
      be.decided_by AS operator_id, u.full_name AS operator_name, ${ROLE_SUBQUERY('be.decided_by')} AS operator_role,
      -- These operations are a single manager decision, not a two-step request/approval workflow
      -- (unlike compliments or closures) -- there is no separate approver to report, so it is null
      -- rather than restating the operator as a fake approver.
      NULL::text AS approver_id, NULL::text AS approver_name,
      be.reason, be.status_after AS status,
      ('BOOMCARD_' || be.type) AS audit_action, 'BOOMCARD' AS audit_entity_type, be.boomcard_id AS audit_entity_id
    FROM boomcard_events be
    JOIN boomcards bc ON bc.id=be.boomcard_id
    JOIN customers c ON c.id=be.customer_id
    JOIN branches br ON br.id=be.branch_id
    LEFT JOIN orders o ON o.id=be.order_id
    LEFT JOIN menu_items mi ON mi.id=be.menu_item_id
    LEFT JOIN users u ON u.id=be.decided_by
    WHERE ${sql}`;
}

// ---------------------------------------------------------------- outer filters (applied once, to the union)
function buildOuterFilter(req: Request, params: any[]) {
  const clauses: string[] = [];
  const source = typeof req.query.source === 'string' ? req.query.source.toUpperCase() : '';
  if (source && (SOURCES as readonly string[]).includes(source)) { clauses.push('source=?'); params.push(source); }

  const typesRaw = typeof req.query.event_type === 'string' ? req.query.event_type.split(',').map(s => s.trim().toUpperCase()).filter(Boolean) : [];
  const types = typesRaw.filter(t => (EVENT_TYPES as readonly string[]).includes(t));
  if (types.length) { clauses.push(`event_type IN (${types.map(() => '?').join(',')})`); params.push(...types); }

  const status = typeof req.query.status === 'string' && req.query.status.trim() ? req.query.status.trim() : '';
  if (status) { clauses.push('status=?'); params.push(status); }

  const customerId = typeof req.query.customer_id === 'string' && req.query.customer_id ? req.query.customer_id : '';
  const boomcardId = typeof req.query.boomcard_id === 'string' && req.query.boomcard_id ? req.query.boomcard_id : '';
  if (customerId && boomcardId) { clauses.push('(customer_id=? OR boomcard_id=?)'); params.push(customerId, boomcardId); }
  else if (customerId) { clauses.push('customer_id=?'); params.push(customerId); }
  else if (boomcardId) { clauses.push('boomcard_id=?'); params.push(boomcardId); }

  const orderId = typeof req.query.order_id === 'string' && req.query.order_id ? req.query.order_id : '';
  if (orderId) { clauses.push('order_id=?'); params.push(orderId); }

  const operatorId = typeof req.query.operator_id === 'string' && req.query.operator_id ? req.query.operator_id : '';
  if (operatorId) { clauses.push('operator_id=?'); params.push(operatorId); }

  const search = typeof req.query.search === 'string' && req.query.search.trim() ? `%${req.query.search.trim()}%` : '';
  if (search) { clauses.push('(customer_name ILIKE ? OR customer_phone ILIKE ? OR card_number ILIKE ? OR order_number ILIKE ?)'); params.push(search, search, search, search); }

  return clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
}

function buildUnion(branchId: string, start: string | null, end: string | null, params: any[]) {
  return `${boomcoinBranch(branchId, start, end, params)}
    UNION ALL
    ${boombackBranch(branchId, start, end, params)}
    UNION ALL
    ${eventsBranch(branchId, start, end, params)}`;
}

router.get('/journal', requirePermission('boomcard.journal.view'), async (req, res) => {
  const b = String(req.query.branch_id || req.user!.branch_id || '');
  if (!b || !allowed(req, b)) return res.status(403).json({ error: 'BRANCH_ACCESS_DENIED', code: 'BRANCH_ACCESS_DENIED', message: 'Branch is outside your access scope.', details: {} });
  const start = typeof req.query.start === 'string' && req.query.start ? req.query.start : null;
  const end = typeof req.query.end === 'string' && req.query.end ? req.query.end : null;
  const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);
  const pageSize = Math.min(200, Math.max(1, parseInt(String(req.query.page_size || '50'), 10) || 50));
  const offset = (page - 1) * pageSize;

  const dataParams: any[] = [];
  const unionSql = buildUnion(b, start, end, dataParams);
  const outerWhere = buildOuterFilter(req, dataParams);
  const rows = await query<any>(
    `WITH journal AS (${unionSql}) SELECT * FROM journal ${outerWhere} ORDER BY created_at DESC, source_id DESC LIMIT ? OFFSET ?`,
    [...dataParams, pageSize, offset]);

  const countParams: any[] = [];
  const countUnionSql = buildUnion(b, start, end, countParams);
  const countOuterWhere = buildOuterFilter(req, countParams);
  const totalRow = await queryOne<any>(`WITH journal AS (${countUnionSql}) SELECT COUNT(*)::int AS total FROM journal ${countOuterWhere}`, countParams);

  res.json({
    branch_id: b, period: { start, end },
    page, page_size: pageSize, total: totalRow?.total || 0, total_pages: Math.max(1, Math.ceil((totalRow?.total || 0) / pageSize)),
    rows,
  });
});

// ---------------------------------------------------------------- reporting rollup
// One count + one amount per event type, over the SAME normalized rows the journal itself lists --
// so the report and the journal can never disagree. Grouped by event_category too, so operational
// benefits, settlements, rewards and lifecycle events are never summed into one another or into
// sales revenue.
router.get('/journal/summary', requirePermission('boomcard.journal.view'), async (req, res) => {
  const b = String(req.query.branch_id || req.user!.branch_id || '');
  if (!b || !allowed(req, b)) return res.status(403).json({ error: 'BRANCH_ACCESS_DENIED', code: 'BRANCH_ACCESS_DENIED', message: 'Branch is outside your access scope.', details: {} });
  const start = typeof req.query.start === 'string' && req.query.start ? req.query.start : null;
  const end = typeof req.query.end === 'string' && req.query.end ? req.query.end : null;
  const params: any[] = [];
  const unionSql = buildUnion(b, start, end, params);
  const rows = await query<any>(
    `WITH journal AS (${unionSql})
     SELECT event_type, event_category, COUNT(*)::int AS count,
       COALESCE(SUM(quantity),0)::int AS total_quantity,
       COALESCE(SUM(ABS(COALESCE(boomback_amount::numeric,0))),0)::text AS total_boomback_amount,
       COALESCE(SUM(ABS(COALESCE(boomcoin_amount,0))),0)::int AS total_boomcoin_amount
     FROM journal GROUP BY event_type, event_category ORDER BY event_category, event_type`, params);
  res.json({ branch_id: b, period: { start, end }, event_types: rows });
});

export default router;
