import crypto from 'node:crypto';
import { TxClient } from './db';
import { insertAuditLog } from './auth';

// Stage 34.5 -- BOOMCOIN.
//
// The LEDGER is authoritative. A guest's balance is the sum of boomcoin_ledger, never a number
// anybody typed and never something the POS computed; the cached columns on the customer are only
// a convenience maintained inside the same transaction as the row that caused them, and the read
// endpoints recompute from the ledger so the two can be proven equal.
//
// The POS counter ("order 40 more and you get a BOOMCOIN") is UI GUIDANCE derived from the same
// ledger numbers. It never grants anything.
//
// Nothing here is hardcoded: the earning rate and both switches are system settings.

export const BOOMCOIN_SETTING_ENABLED = 'BOOMCOIN_EARNING_ENABLED';
export const BOOMCOIN_SETTING_COUNTER_UI = 'BOOMCOIN_COUNTER_UI_ENABLED';
export const BOOMCOIN_SETTING_SPEND_PER_COIN = 'BOOMCOIN_SPEND_PER_COIN';

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

export type BoomcoinSettings = { enabled: boolean; counterUiEnabled: boolean; spendPerCoinCents: bigint };

export async function boomcoinSettings(r: Reader): Promise<BoomcoinSettings> {
  const rows = await r.query<any>(`SELECT key,value FROM system_settings WHERE key IN (?,?,?)`, [BOOMCOIN_SETTING_ENABLED, BOOMCOIN_SETTING_COUNTER_UI, BOOMCOIN_SETTING_SPEND_PER_COIN]);
  const get = (k: string) => rows.find(x => x.key === k)?.value;
  const rate = cents(get(BOOMCOIN_SETTING_SPEND_PER_COIN) ?? '200.00');
  return {
    enabled: String(get(BOOMCOIN_SETTING_ENABLED) ?? 'true').toLowerCase() === 'true',
    counterUiEnabled: String(get(BOOMCOIN_SETTING_COUNTER_UI) ?? 'true').toLowerCase() === 'true',
    spendPerCoinCents: rate > 0n ? rate : cents('200.00'),
  };
}

/** The balance and the progress counter, both recomputed from the ledger. */
export async function boomcoinStateFor(r: Reader, customerId: string, settings: BoomcoinSettings) {
  const row = await r.queryOne<any>(`SELECT COALESCE(SUM(coins),0) AS coins, COALESCE(SUM(qualifying_amount),0) AS spend FROM boomcoin_ledger WHERE customer_id=?`, [customerId]);
  const balance = Number(row?.coins ?? 0);
  const spend = cents(row?.spend ?? '0');
  const rate = settings.spendPerCoinCents;
  const remainder = spend % rate;
  const toNext = remainder === 0n ? rate : rate - remainder;
  return {
    balance,
    qualifying_spend: centsText(spend),
    spend_per_coin: centsText(rate),
    remainder: centsText(remainder),
    to_next_coin: centsText(toNext),
    coins_from_spend: Number(spend / rate),
  };
}

async function writeLedger(tx: TxClient, opts: { entryKey: string; branchId: string; customerId: string; type: string; coins: number; qualifyingCents: bigint; orderId?: string | null; billId?: string | null; reason?: string | null; actorId: string | null; now: string }) {
  // The customer row is the serialisation point, so two concurrent payments for the same guest
  // cannot both read the same balance and each mint a coin.
  const customer = await tx.queryOne<any>('SELECT id,branch_id,boomcoin_balance,qualifying_spend FROM customers WHERE id=? FOR UPDATE', [opts.customerId]);
  if (!customer) return null;
  const balanceBefore = Number(customer.boomcoin_balance ?? 0);
  const spendBefore = cents(customer.qualifying_spend ?? '0');
  const balanceAfter = balanceBefore + opts.coins;
  const spendAfter = spendBefore + opts.qualifyingCents;
  await tx.execute(
    `INSERT INTO boomcoin_ledger (id,branch_id,customer_id,type,coins,qualifying_amount,balance_before,balance_after,spend_before,spend_after,order_id,bill_id,reason,created_by,created_at,entry_key)
     VALUES (?,?,?,?,?,CAST(? AS numeric),?,?,CAST(? AS numeric),CAST(? AS numeric),?,?,?,?,?,?)
     ON CONFLICT (entry_key) DO NOTHING`,
    [id('bcl'), opts.branchId, opts.customerId, opts.type, opts.coins, centsText(opts.qualifyingCents), balanceBefore, balanceAfter, centsText(spendBefore), centsText(spendAfter), opts.orderId ?? null, opts.billId ?? null, opts.reason ?? null, opts.actorId, opts.now, opts.entryKey]);
  const written = await tx.queryOne<any>('SELECT * FROM boomcoin_ledger WHERE entry_key=?', [opts.entryKey]);
  if (!written || written.created_at !== opts.now) return written; // a replay: nothing was minted twice
  await tx.execute('UPDATE customers SET boomcoin_balance=?,qualifying_spend=CAST(? AS numeric),updated_at=? WHERE id=?', [balanceAfter, centsText(spendAfter), opts.now, opts.customerId]);
  return written;
}

/**
 * Accrues BOOMCOIN for one settled order (or one settled separate check). Coins are earned on
 * CUMULATIVE qualifying spend, so the guest's progress carries across visits:
 * `coins = floor(total_spend / rate)`, and each settlement mints the difference.
 */
export async function accrueBoomcoinForSettlement(tx: TxClient, opts: { branchId: string; customerId: string | null; orderId: string; billId?: string | null; amountCents: bigint; actorId: string | null; now: string; req?: any }) {
  if (!opts.customerId || opts.amountCents <= 0n) return null;
  const settings = await boomcoinSettings(tx);
  if (!settings.enabled) return null; // the earning engine is switched off; nothing is recorded

  const entryKey = `${opts.orderId}|${opts.billId ?? 'ORDER'}|EARNED`;
  const already = await tx.queryOne<any>('SELECT id FROM boomcoin_ledger WHERE entry_key=?', [entryKey]);
  if (already) return null;

  const customer = await tx.queryOne<any>('SELECT qualifying_spend FROM customers WHERE id=?', [opts.customerId]);
  if (!customer) return null;
  const spendBefore = cents(customer.qualifying_spend ?? '0');
  const spendAfter = spendBefore + opts.amountCents;
  const coins = Number(spendAfter / settings.spendPerCoinCents - spendBefore / settings.spendPerCoinCents);

  const row = await writeLedger(tx, { entryKey, branchId: opts.branchId, customerId: opts.customerId, type: 'EARNED', coins, qualifyingCents: opts.amountCents, orderId: opts.orderId, billId: opts.billId ?? null, reason: null, actorId: opts.actorId, now: opts.now });
  if (row) await insertAuditLog(tx.execute, { userId: opts.actorId || undefined, branchId: opts.branchId, action: 'BOOMCOIN_EARNED', entityType: 'BOOMCOIN_LEDGER', entityId: row.id, newValues: { customer_id: opts.customerId, order_id: opts.orderId, bill_id: opts.billId ?? null, coins, qualifying_amount: centsText(opts.amountCents), balance_after: row.balance_after }, req: opts.req });
  return row;
}

/**
 * Reverses everything an order earned, when that order is cancelled, refunded or closed by the
 * establishment. The reversal is its own ledger row -- the original is never deleted or edited.
 */
export async function reverseBoomcoinForOrder(tx: TxClient, opts: { orderId: string; branchId: string; actorId: string | null; now: string; req?: any }) {
  const earned = await tx.query<any>(`SELECT * FROM boomcoin_ledger WHERE order_id=? AND type='EARNED'`, [opts.orderId]);
  for (const e of earned) {
    const entryKey = `${opts.orderId}|${e.bill_id ?? 'ORDER'}|REVERSED`;
    const row = await writeLedger(tx, { entryKey, branchId: opts.branchId, customerId: e.customer_id, type: 'REVERSED', coins: -Number(e.coins), qualifyingCents: -cents(e.qualifying_amount), orderId: opts.orderId, billId: e.bill_id, reason: 'Order closed or refunded', actorId: opts.actorId, now: opts.now });
    if (row) await insertAuditLog(tx.execute, { userId: opts.actorId || undefined, branchId: opts.branchId, action: 'BOOMCOIN_REVERSED', entityType: 'BOOMCOIN_LEDGER', entityId: row.id, oldValues: { source_entry: e.id, coins: e.coins }, newValues: { coins: -Number(e.coins), balance_after: row.balance_after }, req: opts.req });
  }
}

/** A manual manager adjustment. Always a new ledger row, always with a reason. */
export async function adjustBoomcoin(tx: TxClient, opts: { branchId: string; customerId: string; coins: number; reason: string; actorId: string; now: string; req?: any }) {
  const entryKey = `ADJ|${id('adj')}`;
  const row = await writeLedger(tx, { entryKey, branchId: opts.branchId, customerId: opts.customerId, type: 'ADJUSTMENT', coins: opts.coins, qualifyingCents: 0n, reason: opts.reason, actorId: opts.actorId, now: opts.now });
  if (row) await insertAuditLog(tx.execute, { userId: opts.actorId, branchId: opts.branchId, action: 'BOOMCOIN_ADJUSTED', entityType: 'BOOMCOIN_LEDGER', entityId: row.id, newValues: { customer_id: opts.customerId, coins: opts.coins, reason: opts.reason, balance_before: row.balance_before, balance_after: row.balance_after }, req: opts.req });
  return row;
}

export { cents as loyaltyCents, centsText as loyaltyCentsText };
