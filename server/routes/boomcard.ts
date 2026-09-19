import { Router, Request } from 'express';
import crypto from 'node:crypto';
import { query, queryOne, transaction, TxClient } from '../db';
import { authenticateToken, requirePermission, insertAuditLog } from '../auth';

// Stage 34.6 -- BOOMCARD lifecycle and the guest's personal cabinet.
//
// The lifecycle is driven by a MANAGER, never by the system on its own:
//
//   CANDIDATE  -- the CRM noticed enough qualifying spend in a period
//        |         (automation only ever PROPOSES; it never activates)
//   ACTIVE     -- a manager approved it, and it is valid until a date
//   INACTIVE   -- it lapsed or was withdrawn
//
// Manual management keeps working with automation switched off -- that is the whole point of the
// switch. Nothing is ever deleted: every transition is its own boomcard_events row.
//
// The guest's cabinet deliberately shows a GENERIC birthday benefit ("a birthday gift is waiting"),
// never which product it is.

const router = Router();
function allowed(req: Request, b: string){ return Boolean(req.user?.isSuperUser || req.user?.allowedBranchIds.includes(b)); }
function id(prefix: string){ return `${prefix}_${crypto.randomUUID()}`; }
function cents(v: unknown): bigint {
  const s = String(v ?? '0').trim();
  if (!/^-?\d+(?:\.\d{1,2})?$/.test(s)) return 0n;
  const neg = s.startsWith('-'); const clean = neg ? s.slice(1) : s;
  const [a, b = ''] = clean.split('.');
  const c = BigInt(a) * 100n + BigInt((b + '00').slice(0, 2));
  return neg ? -c : c;
}
function centsText(c: bigint) { return `${c / 100n}.${(c % 100n).toString().padStart(2, '0')}`; }

const SETTING_AUTO = 'BOOMCARD_AUTO_LIFECYCLE_ENABLED';
const SETTING_THRESHOLD = 'BOOMCARD_MONTHLY_SPEND_THRESHOLD';
const SETTING_VALIDITY_DAYS = 'BOOMCARD_VALIDITY_DAYS';
const SETTING_BREAKFAST = 'BOOMCARD_BREAKFAST_PER_PERIOD';

async function boomcardSettings() {
  const rows = await query<any>(`SELECT key,value FROM system_settings WHERE key IN (?,?,?,?)`, [SETTING_AUTO, SETTING_THRESHOLD, SETTING_VALIDITY_DAYS, SETTING_BREAKFAST]);
  const get = (k: string) => rows.find(x => x.key === k)?.value;
  const days = Number(get(SETTING_VALIDITY_DAYS) ?? 30);
  const breakfasts = Number(get(SETTING_BREAKFAST) ?? 4);
  return {
    autoEnabled: String(get(SETTING_AUTO) ?? 'true').toLowerCase() === 'true',
    thresholdCents: cents(get(SETTING_THRESHOLD) ?? '5000.00'),
    validityDays: Number.isFinite(days) && days > 0 ? Math.floor(days) : 30,
    breakfastsPerPeriod: Number.isFinite(breakfasts) && breakfasts >= 0 ? Math.floor(breakfasts) : 4,
  };
}

async function recordEvent(tx: TxClient, opts: { branchId: string; cardId: string; customerId: string; type: string; statusBefore?: string | null; statusAfter?: string | null; qualifyingCents?: bigint | null; periodStart?: string | null; periodEnd?: string | null; quantity?: number | null; reason?: string | null; decidedBy: string | null; automatic?: boolean; now: string; req?: any }) {
  const eventId = id('bce');
  await tx.execute(
    `INSERT INTO boomcard_events (id,branch_id,boomcard_id,customer_id,type,status_before,status_after,qualifying_spend,period_start,period_end,quantity,reason,decided_by,automatic,created_at)
     VALUES (?,?,?,?,?,?,?,${opts.qualifyingCents != null ? 'CAST(? AS numeric)' : '?'},?,?,?,?,?,?,?)`,
    [eventId, opts.branchId, opts.cardId, opts.customerId, opts.type, opts.statusBefore ?? null, opts.statusAfter ?? null,
     opts.qualifyingCents != null ? centsText(opts.qualifyingCents) : null, opts.periodStart ?? null, opts.periodEnd ?? null,
     opts.quantity ?? null, opts.reason ?? null, opts.decidedBy, Boolean(opts.automatic), opts.now]);
  await insertAuditLog(tx.execute, { userId: opts.decidedBy || undefined, branchId: opts.branchId, action: `BOOMCARD_${opts.type}`, entityType: 'BOOMCARD', entityId: opts.cardId, oldValues: opts.statusBefore ? { status: opts.statusBefore } : null, newValues: { type: opts.type, status: opts.statusAfter, customer_id: opts.customerId, reason: opts.reason ?? null, automatic: Boolean(opts.automatic), quantity: opts.quantity ?? null }, req: opts.req });
  return eventId;
}

// ---------------------------------------------------------------- public: the guest's cabinet
// No authentication: the opaque cabinet token IS the credential. It returns only what the guest may
// see -- and deliberately not which product their birthday benefit is.
router.get('/cabinet/:token', async (req, res) => {
  const card = await queryOne<any>(`SELECT b.*,c.name AS customer_name FROM boomcards b JOIN customers c ON c.id=b.customer_id WHERE b.cabinet_token=?`, [String(req.params.token)]);
  if (!card) return res.status(404).json({ error: 'NOT_FOUND', code: 'CABINET_NOT_FOUND', message: 'Cabinet not found.', details: {} });
  const now = new Date().toISOString();
  const gifts = await query<any>(`SELECT id,status,quantity,valid_from,valid_until FROM boomcard_birthday_gifts WHERE boomcard_id=? AND status='GRANTED' AND valid_from<=? AND valid_until>=?`, [card.id, now, now]);
  // Cashback (BOOMBACK) is wired into this cabinet in Stage 34.7, which introduces its ledger.
  // Reporting null is honest; inventing a number here would not be.
  res.json({
    customer_name: card.customer_name,
    status: card.status,
    valid_until: card.valid_until,
    breakfast: { granted: card.breakfast_granted, used: card.breakfast_used, remaining: Math.max(0, Number(card.breakfast_granted) - Number(card.breakfast_used)) },
    // Generic on purpose: the guest learns that a birthday benefit is waiting and how many, never
    // which dish it is.
    birthday_benefit: gifts.length > 0 ? { available: true, quantity: gifts.reduce((s, g) => s + Number(g.quantity), 0), valid_until: gifts[0].valid_until } : { available: false },
    cashback_balance: null,
  });
});

router.use(authenticateToken);

router.get('/settings', requirePermission('boomcard.view'), async (_req, res) => {
  const s = await boomcardSettings();
  res.json({ automatic_lifecycle_enabled: s.autoEnabled, monthly_spend_threshold: centsText(s.thresholdCents), validity_days: s.validityDays, breakfasts_per_period: s.breakfastsPerPeriod });
});

router.get('/', requirePermission('boomcard.view'), async (req, res) => {
  const b = String(req.query.branch_id || req.user!.branch_id || '');
  if (!b || !allowed(req, b)) return res.status(403).json({ error: 'BRANCH_ACCESS_DENIED', code: 'BRANCH_ACCESS_DENIED', message: 'Branch is outside your access scope.', details: {} });
  const status = typeof req.query.status === 'string' ? String(req.query.status).toUpperCase() : null;
  const where = status ? 'b.branch_id=? AND b.status=?' : 'b.branch_id=?';
  const params = status ? [b, status] : [b];
  res.json({ branch_id: b, cards: await query<any>(`SELECT b.*,c.name AS customer_name,c.phone AS customer_phone FROM boomcards b JOIN customers c ON c.id=b.customer_id WHERE ${where} ORDER BY b.created_at DESC LIMIT 200`, params) });
});

router.get('/:id', requirePermission('boomcard.view'), async (req, res) => {
  const card = await queryOne<any>(`SELECT b.*,c.name AS customer_name,c.phone AS customer_phone,c.birth_date FROM boomcards b JOIN customers c ON c.id=b.customer_id WHERE b.id=?`, [String(req.params.id)]);
  if (!card) return res.status(404).json({ error: 'NOT_FOUND', code: 'BOOMCARD_NOT_FOUND', message: 'Card not found.', details: {} });
  if (!allowed(req, card.branch_id)) return res.status(403).json({ error: 'BRANCH_ACCESS_DENIED', code: 'BRANCH_ACCESS_DENIED', message: 'Card belongs to an unauthorized branch.', details: {} });
  const events = await query<any>(`SELECT e.*,u.full_name AS decided_by_name FROM boomcard_events e LEFT JOIN users u ON u.id=e.decided_by WHERE e.boomcard_id=? ORDER BY e.created_at DESC LIMIT 200`, [card.id]);
  // The manager DOES see the actual product -- they chose it. Only the guest's cabinet is generic.
  const gifts = await query<any>(`SELECT g.*,m.name_ru AS menu_item_name FROM boomcard_birthday_gifts g LEFT JOIN menu_items m ON m.id=g.menu_item_id WHERE g.boomcard_id=? ORDER BY g.granted_at DESC LIMIT 50`, [card.id]);
  res.json({ card, events, gifts });
});

/** Manual creation. Works exactly the same whether automation is on or off. */
router.post('/', requirePermission('boomcard.manage'), async (req, res) => {
  const customerId = String(req.body?.customer_id || '');
  const customer = await queryOne<any>('SELECT id,branch_id FROM customers WHERE id=? AND deleted_at IS NULL', [customerId]);
  if (!customer) return res.status(404).json({ error: 'NOT_FOUND', code: 'CUSTOMER_NOT_FOUND', message: 'Customer not found.', details: {} });
  if (!allowed(req, customer.branch_id)) return res.status(403).json({ error: 'BRANCH_ACCESS_DENIED', code: 'BRANCH_ACCESS_DENIED', message: 'Customer belongs to an unauthorized branch.', details: {} });
  const existing = await queryOne<any>('SELECT id FROM boomcards WHERE customer_id=?', [customerId]);
  if (existing) return res.status(409).json({ error: 'CONFLICT', code: 'BOOMCARD_ALREADY_EXISTS', message: 'This guest already has a card.', details: { boomcard_id: existing.id } });
  const now = new Date().toISOString(), cardId = id('bcd');
  const card = await transaction(async (tx) => {
    await tx.execute(`INSERT INTO boomcards (id,branch_id,customer_id,card_number,status,cabinet_token,qualifying_spend,breakfast_granted,breakfast_used,created_by,created_at,updated_at) VALUES (?,?,?,?,'CANDIDATE',?,0,0,0,?,?,?)`,
      [cardId, customer.branch_id, customerId, `BC${crypto.randomBytes(5).toString('hex').toUpperCase()}`, crypto.randomBytes(24).toString('hex'), req.user!.id, now, now]);
    await recordEvent(tx, { branchId: customer.branch_id, cardId, customerId, type: 'CANDIDATE_IDENTIFIED', statusAfter: 'CANDIDATE', reason: req.body?.reason ? String(req.body.reason).slice(0, 500) : 'Created manually', decidedBy: req.user!.id, automatic: false, now, req });
    return await tx.queryOne<any>('SELECT * FROM boomcards WHERE id=?', [cardId]);
  });
  res.status(201).json({ card });
});

async function loadCardForDecision(tx: TxClient, req: Request, cardId: string) {
  const card = await tx.queryOne<any>('SELECT * FROM boomcards WHERE id=? FOR UPDATE', [cardId]);
  if (!card) throw Object.assign(new Error('BOOMCARD_NOT_FOUND'), { httpStatus: 404 });
  if (!allowed(req, card.branch_id)) throw Object.assign(new Error('BRANCH_ACCESS_DENIED'), { httpStatus: 403 });
  return card;
}
const CARD_ERRORS: any = {
  BOOMCARD_NOT_FOUND: [404, 'NOT_FOUND', 'BOOMCARD_NOT_FOUND'],
  BRANCH_ACCESS_DENIED: [403, 'BRANCH_ACCESS_DENIED', 'BRANCH_ACCESS_DENIED'],
  BOOMCARD_ALREADY_ACTIVE: [409, 'INVALID_STATE', 'BOOMCARD_ALREADY_ACTIVE'],
  BOOMCARD_NOT_ACTIVE: [409, 'INVALID_STATE', 'BOOMCARD_NOT_ACTIVE'],
  MENU_ITEM_NOT_FOUND: [404, 'NOT_FOUND', 'MENU_ITEM_NOT_FOUND'],
  MENU_ITEM_BRANCH_MISMATCH: [403, 'BRANCH_ACCESS_DENIED', 'MENU_ITEM_BRANCH_MISMATCH'],
  INVALID_GIFT_QUANTITY: [400, 'VALIDATION_ERROR', 'INVALID_GIFT_QUANTITY'],
};
function sendCardError(res: any, e: any) { const m = CARD_ERRORS[e.message]; if (!m) throw e; return res.status(m[0]).json({ error: m[1], code: m[2], message: e.message, details: e.details || {} }); }

/** Activation / renewal is always a manager decision, automation or not. */
async function activateOrRenew(req: Request, res: any, renewing: boolean) {
  const now = new Date().toISOString();
  const settings = await boomcardSettings();
  try {
    const result = await transaction(async (tx) => {
      const card = await loadCardForDecision(tx, req, String(req.params.id));
      if (!renewing && card.status === 'ACTIVE') throw Object.assign(new Error('BOOMCARD_ALREADY_ACTIVE'), { httpStatus: 409 });
      if (renewing && card.status !== 'ACTIVE') throw Object.assign(new Error('BOOMCARD_NOT_ACTIVE'), { httpStatus: 409 });
      // A manager may either extend by a number of days or name the exact end of the period (e.g. a
      // campaign that ends on a fixed date). An explicit date always wins over the day count.
      const explicitUntil = typeof req.body?.valid_until === 'string' && !Number.isNaN(Date.parse(req.body.valid_until)) ? new Date(req.body.valid_until).toISOString() : null;
      const days = Number(req.body?.validity_days) > 0 ? Math.floor(Number(req.body.validity_days)) : settings.validityDays;
      const base = renewing && card.valid_until && card.valid_until > now ? Date.parse(card.valid_until) : Date.now();
      const validUntil = explicitUntil ?? new Date(base + days * 86400000).toISOString();
      const grant = Number.isInteger(Number(req.body?.breakfasts)) && Number(req.body.breakfasts) >= 0 ? Number(req.body.breakfasts) : settings.breakfastsPerPeriod;
      await tx.execute(`UPDATE boomcards SET status='ACTIVE',activated_at=COALESCE(activated_at,?),valid_until=?,deactivated_at=NULL,breakfast_granted=breakfast_granted+?,updated_at=? WHERE id=?`, [now, validUntil, grant, now, card.id]);
      await recordEvent(tx, { branchId: card.branch_id, cardId: card.id, customerId: card.customer_id, type: renewing ? 'RENEWED' : 'ACTIVATED', statusBefore: card.status, statusAfter: 'ACTIVE', reason: req.body?.reason ? String(req.body.reason).slice(0, 500) : null, decidedBy: req.user!.id, automatic: false, now, req });
      if (grant > 0) await recordEvent(tx, { branchId: card.branch_id, cardId: card.id, customerId: card.customer_id, type: 'BREAKFAST_GRANTED', statusAfter: 'ACTIVE', quantity: grant, reason: `Granted with ${renewing ? 'renewal' : 'activation'}`, decidedBy: req.user!.id, automatic: false, now, req });
      return await tx.queryOne<any>('SELECT * FROM boomcards WHERE id=?', [card.id]);
    });
    res.json({ card: result });
  } catch (e: any) { return sendCardError(res, e); }
}
router.post('/:id/activate', requirePermission('boomcard.manage'), async (req, res) => activateOrRenew(req, res, false));
router.post('/:id/renew', requirePermission('boomcard.manage'), async (req, res) => activateOrRenew(req, res, true));

router.post('/:id/deactivate', requirePermission('boomcard.manage'), async (req, res) => {
  const now = new Date().toISOString();
  try {
    const result = await transaction(async (tx) => {
      const card = await loadCardForDecision(tx, req, String(req.params.id));
      // Deactivating never deletes the card or its history -- it only changes its state.
      await tx.execute(`UPDATE boomcards SET status='INACTIVE',deactivated_at=?,updated_at=? WHERE id=?`, [now, now, card.id]);
      await recordEvent(tx, { branchId: card.branch_id, cardId: card.id, customerId: card.customer_id, type: 'DEACTIVATED', statusBefore: card.status, statusAfter: 'INACTIVE', reason: req.body?.reason ? String(req.body.reason).slice(0, 500) : null, decidedBy: req.user!.id, automatic: false, now, req });
      return await tx.queryOne<any>('SELECT * FROM boomcards WHERE id=?', [card.id]);
    });
    res.json({ card: result });
  } catch (e: any) { return sendCardError(res, e); }
});

/** The manager picks the exact product and quantity. The guest's cabinet never reveals it. */
router.post('/:id/birthday-gift', requirePermission('boomcard.manage'), async (req, res) => {
  const menuItemId = String(req.body?.menu_item_id || '');
  const quantity = Number(req.body?.quantity ?? 1);
  const now = new Date().toISOString();
  try {
    const result = await transaction(async (tx) => {
      const card = await loadCardForDecision(tx, req, String(req.params.id));
      if (card.status !== 'ACTIVE') throw Object.assign(new Error('BOOMCARD_NOT_ACTIVE'), { httpStatus: 409 });
      if (!Number.isInteger(quantity) || quantity <= 0 || quantity > 20) throw Object.assign(new Error('INVALID_GIFT_QUANTITY'), { httpStatus: 400 });
      const item = await tx.queryOne<any>('SELECT id,branch_id,name_ru FROM menu_items WHERE id=?', [menuItemId]);
      if (!item) throw Object.assign(new Error('MENU_ITEM_NOT_FOUND'), { httpStatus: 404 });
      if (item.branch_id && item.branch_id !== card.branch_id) throw Object.assign(new Error('MENU_ITEM_BRANCH_MISMATCH'), { httpStatus: 403 });
      const validFrom = typeof req.body?.valid_from === 'string' ? req.body.valid_from : now;
      const validUntil = typeof req.body?.valid_until === 'string' ? req.body.valid_until : new Date(Date.now() + 30 * 86400000).toISOString();
      const giftId = id('bgf');
      await tx.execute(`INSERT INTO boomcard_birthday_gifts (id,branch_id,boomcard_id,customer_id,menu_item_id,quantity,status,valid_from,valid_until,granted_by,granted_at) VALUES (?,?,?,?,?,?,'GRANTED',?,?,?,?)`,
        [giftId, card.branch_id, card.id, card.customer_id, item.id, quantity, validFrom, validUntil, req.user!.id, now]);
      await recordEvent(tx, { branchId: card.branch_id, cardId: card.id, customerId: card.customer_id, type: 'BIRTHDAY_GIFT_GRANTED', statusAfter: card.status, quantity, reason: req.body?.reason ? String(req.body.reason).slice(0, 500) : null, decidedBy: req.user!.id, automatic: false, now, req });
      return await tx.queryOne<any>('SELECT * FROM boomcard_birthday_gifts WHERE id=?', [giftId]);
    });
    res.status(201).json({ gift: result });
  } catch (e: any) { return sendCardError(res, e); }
});

/**
 * The monthly lifecycle run. It computes each guest's REAL qualifying spend for the period from
 * completed orders, and reports who crosses the threshold. It never activates anybody: with
 * automation ON it records them as CANDIDATE for a manager to approve, and with automation OFF it
 * only reports, leaving manual management untouched.
 */
router.post('/lifecycle/evaluate', requirePermission('boomcard.manage'), async (req, res) => {
  const b = String(req.body?.branch_id || req.user!.branch_id || '');
  if (!b || !allowed(req, b)) return res.status(403).json({ error: 'BRANCH_ACCESS_DENIED', code: 'BRANCH_ACCESS_DENIED', message: 'Branch is outside your access scope.', details: {} });
  const from = typeof req.body?.from === 'string' ? req.body.from : null;
  const to = typeof req.body?.to === 'string' ? req.body.to : null;
  if (!from || !to || Number.isNaN(Date.parse(from)) || Number.isNaN(Date.parse(to)) || Date.parse(to) <= Date.parse(from)) {
    return res.status(400).json({ error: 'VALIDATION_ERROR', code: 'INVALID_LIFECYCLE_PERIOD', message: 'from and to must be ISO timestamps with to after from.', details: {} });
  }
  const settings = await boomcardSettings();
  const now = new Date().toISOString();
  const rows = await query<any>(
    `SELECT o.customer_id, COALESCE(SUM(o.final_amount),0) AS spend
       FROM orders o WHERE o.branch_id=? AND o.status='COMPLETED' AND o.customer_id IS NOT NULL AND o.created_at>=? AND o.created_at<?
      GROUP BY o.customer_id`, [b, from, to]);
  const qualifying = rows.filter(r => cents(r.spend) >= settings.thresholdCents);
  const candidates: any[] = [];
  const expired: string[] = [];

  await transaction(async (tx) => {
    for (const r of qualifying) {
      const existing = await tx.queryOne<any>('SELECT * FROM boomcards WHERE customer_id=? FOR UPDATE', [r.customer_id]);
      const entry = { customer_id: r.customer_id, qualifying_spend: String(r.spend), boomcard_id: existing?.id ?? null, status: existing?.status ?? null, created: false };
      if (!settings.autoEnabled) { candidates.push(entry); continue; }
      if (existing) {
        await tx.execute('UPDATE boomcards SET qualifying_spend=CAST(? AS numeric),updated_at=? WHERE id=?', [String(r.spend), now, existing.id]);
        candidates.push({ ...entry, status: existing.status });
        continue;
      }
      const cardId = id('bcd');
      await tx.execute(`INSERT INTO boomcards (id,branch_id,customer_id,card_number,status,cabinet_token,qualifying_spend,breakfast_granted,breakfast_used,created_by,created_at,updated_at) VALUES (?,?,?,?,'CANDIDATE',?,CAST(? AS numeric),0,0,?,?,?)`,
        [cardId, b, r.customer_id, `BC${crypto.randomBytes(5).toString('hex').toUpperCase()}`, crypto.randomBytes(24).toString('hex'), String(r.spend), req.user!.id, now, now]);
      await recordEvent(tx, { branchId: b, cardId, customerId: r.customer_id, type: 'CANDIDATE_IDENTIFIED', statusAfter: 'CANDIDATE', qualifyingCents: cents(r.spend), periodStart: from, periodEnd: to, reason: 'Qualifying spend threshold reached', decidedBy: req.user!.id, automatic: true, now, req });
      candidates.push({ ...entry, boomcard_id: cardId, status: 'CANDIDATE', created: true });
    }
    // A card whose validity has run out lapses to INACTIVE -- also only when automation is on.
    if (settings.autoEnabled) {
      const lapsed = await tx.query<any>(`SELECT * FROM boomcards WHERE branch_id=? AND status='ACTIVE' AND valid_until IS NOT NULL AND valid_until<? FOR UPDATE`, [b, now]);
      for (const c of lapsed) {
        await tx.execute(`UPDATE boomcards SET status='INACTIVE',deactivated_at=?,updated_at=? WHERE id=?`, [now, now, c.id]);
        await recordEvent(tx, { branchId: b, cardId: c.id, customerId: c.customer_id, type: 'DEACTIVATED', statusBefore: 'ACTIVE', statusAfter: 'INACTIVE', reason: 'Validity expired', decidedBy: req.user!.id, automatic: true, now, req });
        expired.push(c.id);
      }
    }
  });

  res.json({ branch_id: b, from, to, automatic_lifecycle_enabled: settings.autoEnabled, threshold: centsText(settings.thresholdCents), evaluated_customers: rows.length, candidates, expired_card_ids: expired });
});

export default router;
