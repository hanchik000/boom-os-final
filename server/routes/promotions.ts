import { Router, Request, Response } from 'express';
import crypto from 'node:crypto';
import { query, queryOne, execute } from '../db';
import { authenticateToken, requirePermission, insertAuditLog } from '../auth';

// ================================================================================================
// Stage 35.6 -- the Promotion Engine.
//
// A promotion attaches a REAL, server-computed promotional price to a REAL menu item. It is not a
// second product and not a customer discount (that is the existing manual OrderDiscount, applied
// per order by a cashier/waiter): a promotion is a catalog-level price the SERVER offers every
// guest who looks at that item on that branch's menu, for as long as it is scheduled to run.
//
// Whether a promotion is live right now is never a stored flag -- it is computed on every read as
// `active AND starts_at <= now <= ends_at`, so expiry is automatic: nothing has to notice a
// promotion ended and flip a switch. `activePromotionMap()` is the ONE place this is computed;
// every public read (public-menu.ts, visual-catalog.ts) calls it rather than repeating the rule.
// ================================================================================================

const router = Router();
const PLACEMENTS = ['PRODUCT_CARD', 'CATALOG', 'BANNER', 'CATEGORY', 'PROMOTIONS_SECTION'];

function isAccessible(req: Request, branchId: string | null) {
  return !branchId || Boolean(req.user?.isSuperUser || req.user?.allowedBranchIds.includes(branchId));
}
function scope(req: Request, branch?: string | null) {
  const id = branch || req.user?.branch_id || null;
  return id && isAccessible(req, id) ? id : null;
}
function moneyCents(v: unknown): bigint | null {
  const s = String(v ?? '').trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(s)) return null;
  const [a, b = ''] = s.split('.');
  return BigInt(a) * 100n + BigInt((b + '00').slice(0, 2));
}

// ---------------------------------------------------------------- the one "is this live" rule
// Returns a Map<menu_item_id, { promo_price, badge_ru, badge_tk, ends_at }> of every promotion
// that is active AND inside its own [starts_at, ends_at] window, for a branch (network-wide
// promotions -- branch_id NULL -- apply everywhere). A menu item never carries more than one
// active promotion at a time in the map: if more than one somehow overlaps, the one ending
// soonest wins, so the guest always sees a price that is genuinely about to be honoured.
export async function activePromotionMap(branchId: string, nowIso: string): Promise<Map<string, { promo_price: string; badge_ru: string | null; badge_tk: string | null; ends_at: string; placements: string[] }>> {
  const rows = await query<any>(
    `SELECT * FROM promotions WHERE (branch_id=? OR branch_id IS NULL) AND active=true AND starts_at<=? AND ends_at>=? ORDER BY ends_at ASC`,
    [branchId, nowIso, nowIso]);
  const map = new Map<string, any>();
  for (const r of rows) {
    if (map.has(r.menu_item_id)) continue; // first row wins -- already sorted by soonest-ending
    map.set(r.menu_item_id, { promo_price: String(r.promo_price), badge_ru: r.badge_ru, badge_tk: r.badge_tk, ends_at: r.ends_at, placements: String(r.placements || '').split(',').map((x: string) => x.trim()).filter(Boolean) });
  }
  return map;
}

// ---------------------------------------------------------------- manager CRUD
router.use(authenticateToken);

router.get('/', requirePermission('promotions.view'), async (req, res) => {
  const branch = scope(req, typeof req.query.branch_id === 'string' ? req.query.branch_id : null);
  if (!branch) return res.status(403).json({ error: 'BRANCH_ACCESS_DENIED', code: 'BRANCH_ACCESS_DENIED', message: 'Branch is outside your access scope.', details: {} });
  const rows = await query<any>(`SELECT p.*,m.name_ru AS item_name_ru,m.name_tk AS item_name_tk,m.price AS item_price FROM promotions p JOIN menu_items m ON m.id=p.menu_item_id WHERE (p.branch_id=? OR p.branch_id IS NULL) ORDER BY p.created_at DESC LIMIT 200`, [branch]);
  const now = new Date().toISOString();
  res.json({ branch_id: branch, promotions: rows.map((r: any) => ({ ...r, is_live: Boolean(r.active) && r.starts_at <= now && r.ends_at >= now })) });
});

router.post('/', requirePermission('promotions.manage'), async (req, res) => {
  const branch = req.body?.branch_id ? scope(req, String(req.body.branch_id)) : null;
  if (req.body?.branch_id && !branch) return res.status(403).json({ error: 'BRANCH_ACCESS_DENIED', code: 'BRANCH_ACCESS_DENIED', message: 'Branch is outside your access scope.', details: {} });
  const menuItemId = String(req.body?.menu_item_id || '');
  const item = await queryOne<any>('SELECT id,branch_id,price FROM menu_items WHERE id=? AND status=\'ACTIVE\' AND deleted_at IS NULL', [menuItemId]);
  if (!item) return res.status(404).json({ error: 'NOT_FOUND', code: 'MENU_ITEM_NOT_FOUND', message: 'Menu item not found.', details: {} });
  // A promotion can never be scoped to a branch the item itself does not belong to (a
  // network-wide item, branch_id NULL, may run a promotion on any branch the manager chooses).
  if (item.branch_id && branch && item.branch_id !== branch) return res.status(409).json({ error: 'INVALID_STATE', code: 'MENU_ITEM_BRANCH_MISMATCH', message: 'This menu item belongs to a different branch.', details: {} });
  const promoCents = moneyCents(req.body?.promo_price);
  const normalCents = moneyCents(item.price);
  if (promoCents === null || promoCents <= 0n) return res.status(400).json({ error: 'VALIDATION_ERROR', code: 'INVALID_PROMO_PRICE', message: 'promo_price must be a positive amount with up to two decimals.', details: {} });
  // A "promotion" that is not actually cheaper than the real price is not a promotion -- it would
  // just be an invented price with a badge on it.
  if (normalCents !== null && promoCents >= normalCents) return res.status(400).json({ error: 'VALIDATION_ERROR', code: 'PROMO_PRICE_NOT_A_DISCOUNT', message: 'promo_price must be lower than the item\'s real price.', details: { price: item.price } });
  const startsAt = typeof req.body?.starts_at === 'string' && !Number.isNaN(Date.parse(req.body.starts_at)) ? new Date(req.body.starts_at).toISOString() : new Date().toISOString();
  const endsAt = typeof req.body?.ends_at === 'string' && !Number.isNaN(Date.parse(req.body.ends_at)) ? new Date(req.body.ends_at).toISOString() : null;
  if (!endsAt || endsAt <= startsAt) return res.status(400).json({ error: 'VALIDATION_ERROR', code: 'INVALID_PROMOTION_WINDOW', message: 'ends_at is required and must be after starts_at.', details: {} });
  const placementsRaw: string[] = Array.isArray(req.body?.placements) ? req.body.placements.map((x: any) => String(x).toUpperCase()) : ['PRODUCT_CARD', 'CATALOG'];
  const placements = placementsRaw.filter(p => PLACEMENTS.includes(p));
  if (!placements.length) return res.status(400).json({ error: 'VALIDATION_ERROR', code: 'PLACEMENT_REQUIRED', message: 'At least one valid placement is required.', details: { allowed: PLACEMENTS } });
  const id = `promo_${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  await execute(
    `INSERT INTO promotions (id,branch_id,menu_item_id,promo_price,starts_at,ends_at,active,placements,badge_ru,badge_tk,created_by,updated_by,created_at,updated_at) VALUES (?,?,?,CAST(? AS numeric),?,?,?,?,?,?,?,?,?,?)`,
    [id, branch, item.id, req.body.promo_price, startsAt, endsAt, req.body?.active !== false, placements.join(','), req.body?.badge_ru ? String(req.body.badge_ru).slice(0, 60) : 'Акция', req.body?.badge_tk ? String(req.body.badge_tk).slice(0, 60) : 'BOOM DEAL', req.user!.id, req.user!.id, now, now]);
  await insertAuditLog(execute, { userId: req.user!.id, branchId: branch, action: 'PROMOTION_CREATED', entityType: 'PROMOTION', entityId: id, newValues: { menu_item_id: item.id, promo_price: req.body.promo_price, starts_at: startsAt, ends_at: endsAt, placements }, req });
  res.status(201).json({ promotion: await queryOne<any>('SELECT * FROM promotions WHERE id=?', [id]) });
});

router.patch('/:id', requirePermission('promotions.manage'), async (req, res) => {
  const row = await queryOne<any>('SELECT * FROM promotions WHERE id=?', [req.params.id]);
  if (!row || !isAccessible(req, row.branch_id)) return res.status(404).json({ error: 'NOT_FOUND', code: 'PROMOTION_NOT_FOUND', message: 'Promotion not found.', details: {} });
  const now = new Date().toISOString();
  const active = req.body?.active !== undefined ? Boolean(req.body.active) : row.active;
  let promoPriceText = row.promo_price;
  if (req.body?.promo_price !== undefined) {
    const c = moneyCents(req.body.promo_price);
    if (c === null || c <= 0n) return res.status(400).json({ error: 'VALIDATION_ERROR', code: 'INVALID_PROMO_PRICE', message: 'promo_price must be a positive amount with up to two decimals.', details: {} });
    promoPriceText = req.body.promo_price;
  }
  const startsAt = typeof req.body?.starts_at === 'string' && !Number.isNaN(Date.parse(req.body.starts_at)) ? new Date(req.body.starts_at).toISOString() : row.starts_at;
  const endsAt = typeof req.body?.ends_at === 'string' && !Number.isNaN(Date.parse(req.body.ends_at)) ? new Date(req.body.ends_at).toISOString() : row.ends_at;
  if (endsAt <= startsAt) return res.status(400).json({ error: 'VALIDATION_ERROR', code: 'INVALID_PROMOTION_WINDOW', message: 'ends_at must be after starts_at.', details: {} });
  const placements = Array.isArray(req.body?.placements) ? req.body.placements.map((x: any) => String(x).toUpperCase()).filter((p: string) => PLACEMENTS.includes(p)) : String(row.placements || '').split(',').filter(Boolean);
  await execute(`UPDATE promotions SET promo_price=CAST(? AS numeric),starts_at=?,ends_at=?,active=?,placements=?,badge_ru=?,badge_tk=?,updated_by=?,updated_at=? WHERE id=?`,
    [promoPriceText, startsAt, endsAt, active, placements.join(','), req.body?.badge_ru !== undefined ? (req.body.badge_ru || null) : row.badge_ru, req.body?.badge_tk !== undefined ? (req.body.badge_tk || null) : row.badge_tk, req.user!.id, now, row.id]);
  await insertAuditLog(execute, { userId: req.user!.id, branchId: row.branch_id, action: 'PROMOTION_UPDATED', entityType: 'PROMOTION', entityId: row.id, oldValues: row, newValues: { promo_price: promoPriceText, starts_at: startsAt, ends_at: endsAt, active }, req });
  res.json({ promotion: await queryOne<any>('SELECT * FROM promotions WHERE id=?', [row.id]) });
});

router.delete('/:id', requirePermission('promotions.manage'), async (req, res) => {
  const row = await queryOne<any>('SELECT * FROM promotions WHERE id=?', [req.params.id]);
  if (!row || !isAccessible(req, row.branch_id)) return res.status(404).json({ error: 'NOT_FOUND', code: 'PROMOTION_NOT_FOUND', message: 'Promotion not found.', details: {} });
  await execute('UPDATE promotions SET active=false,updated_by=?,updated_at=? WHERE id=?', [req.user!.id, new Date().toISOString(), row.id]);
  await insertAuditLog(execute, { userId: req.user!.id, branchId: row.branch_id, action: 'PROMOTION_DEACTIVATED', entityType: 'PROMOTION', entityId: row.id, oldValues: { active: row.active }, newValues: { active: false }, req });
  res.json({ success: true });
});

export default router;
