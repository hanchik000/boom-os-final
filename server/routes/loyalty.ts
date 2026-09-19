import { Router, Request } from 'express';
import { query, queryOne, transaction } from '../db';
import { authenticateToken, requirePermission, insertAuditLog } from '../auth';
import { getWaiterSession } from './waiters';
import { boomcoinSettings, boomcoinStateFor, adjustBoomcoin } from '../loyalty';

// Stage 34.5 -- BOOMCOIN read surface and manual adjustments.
// Everything returned here is recomputed from the authoritative boomcoin_ledger.

const router = Router();
function allowed(req: Request, b: string){ return Boolean(req.user?.isSuperUser || req.user?.allowedBranchIds.includes(b)); }

/** The POS counter. Reachable from a waiter POS session as well as an authenticated operator. */
router.get('/boomcoin/customers/:id', async (req, res, next) => {
  try {
    const customer = await queryOne<any>('SELECT id,branch_id,name FROM customers WHERE id=? AND deleted_at IS NULL', [String(req.params.id)]);
    if (!customer) return res.status(404).json({error:'NOT_FOUND',code:'CUSTOMER_NOT_FOUND',message:'Customer not found.',details:{}});
    const session = await getWaiterSession(req);
    if (session) {
      if (session.branch_id !== customer.branch_id) return res.status(403).json({error:'BRANCH_ACCESS_DENIED',code:'BRANCH_ACCESS_DENIED',message:'Customer belongs to another branch.',details:{}});
      return res.json(await counterPayload(customer));
    }
    authenticateToken(req, res, () => {
      requirePermission('loyalty.view')(req, res, () => {
        (async () => {
          if (!allowed(req, customer.branch_id)) return res.status(403).json({error:'BRANCH_ACCESS_DENIED',code:'BRANCH_ACCESS_DENIED',message:'Customer belongs to an unauthorized branch.',details:{}});
          res.json(await counterPayload(customer));
        })().catch(next);
      });
    });
  } catch (e) { next(e); }
});

async function counterPayload(customer: any) {
  const settings = await boomcoinSettings({ query, queryOne });
  const state = await boomcoinStateFor({ query, queryOne }, customer.id, settings);
  // cached_balance is the customer-row cache; balance above is recomputed from the ledger. They are
  // returned side by side so a drift is visible rather than hidden.
  const cached = await queryOne<any>('SELECT boomcoin_balance,qualifying_spend FROM customers WHERE id=?', [customer.id]);
  return {
    customer_id: customer.id, customer_name: customer.name,
    earning_enabled: settings.enabled, counter_ui_enabled: settings.counterUiEnabled,
    ...state,
    cached_balance: Number(cached?.boomcoin_balance ?? 0),
    cached_qualifying_spend: String(cached?.qualifying_spend ?? '0'),
  };
}

router.use(authenticateToken);

router.get('/boomcoin/settings', requirePermission('loyalty.view'), async (_req, res) => {
  const s = await boomcoinSettings({ query, queryOne });
  res.json({ earning_enabled: s.enabled, counter_ui_enabled: s.counterUiEnabled, spend_per_coin: String(s.spendPerCoinCents / 100n) + '.' + String(s.spendPerCoinCents % 100n).padStart(2, '0') });
});

router.get('/boomcoin/ledger', requirePermission('loyalty.view'), async (req, res) => {
  const b = String(req.query.branch_id || req.user!.branch_id || '');
  if (!b || !allowed(req, b)) return res.status(403).json({error:'BRANCH_ACCESS_DENIED',code:'BRANCH_ACCESS_DENIED',message:'Branch is outside your access scope.',details:{}});
  const customerId = typeof req.query.customer_id === 'string' ? req.query.customer_id : null;
  const where = customerId ? 'l.branch_id=? AND l.customer_id=?' : 'l.branch_id=?';
  const params = customerId ? [b, customerId] : [b];
  const entries = await query<any>(`SELECT l.*,c.name AS customer_name,o.order_number,u.full_name AS created_by_name FROM boomcoin_ledger l LEFT JOIN customers c ON c.id=l.customer_id LEFT JOIN orders o ON o.id=l.order_id LEFT JOIN users u ON u.id=l.created_by WHERE ${where} ORDER BY l.created_at DESC LIMIT 500`, params);
  const totals = await query<any>(`SELECT type,COALESCE(SUM(coins),0) AS coins FROM boomcoin_ledger WHERE branch_id=? GROUP BY type ORDER BY type`, [b]);
  res.json({ branch_id: b, entries, totals });
});

router.post('/boomcoin/adjust', requirePermission('loyalty.manage'), async (req, res) => {
  const customerId = String(req.body?.customer_id || '');
  const coins = Number(req.body?.coins);
  const reason = String(req.body?.reason || '').trim().slice(0, 500);
  if (!customerId || !Number.isInteger(coins) || coins === 0) return res.status(400).json({error:'VALIDATION_ERROR',code:'INVALID_BOOMCOIN_ADJUSTMENT',message:'customer_id and a non-zero whole number of coins are required.',details:{}});
  if (!reason) return res.status(400).json({error:'VALIDATION_ERROR',code:'ADJUSTMENT_REASON_REQUIRED',message:'A reason is required for a manual BOOMCOIN adjustment.',details:{}});
  const customer = await queryOne<any>('SELECT id,branch_id FROM customers WHERE id=? AND deleted_at IS NULL', [customerId]);
  if (!customer) return res.status(404).json({error:'NOT_FOUND',code:'CUSTOMER_NOT_FOUND',message:'Customer not found.',details:{}});
  if (!allowed(req, customer.branch_id)) return res.status(403).json({error:'BRANCH_ACCESS_DENIED',code:'BRANCH_ACCESS_DENIED',message:'Customer belongs to an unauthorized branch.',details:{}});
  const now = new Date().toISOString();
  const row = await transaction(async (tx) => adjustBoomcoin(tx, { branchId: customer.branch_id, customerId, coins, reason, actorId: req.user!.id, now, req }));
  res.status(201).json({ entry: row });
});

export default router;
