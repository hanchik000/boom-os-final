import { TxClient } from './db';
import { serviceChargePercentFor } from './service-charge';

// Stage 34.3 -- the single place an order's money is recomputed.
//
// Before this, the item-removal path recomputed subtotal / service charge / final amount inline.
// Manual discounts need exactly the same recomputation, so it lives here once and both paths call
// it: there is one order-pricing rule, not two that can drift apart.
//
// The frontend never computes an authoritative total; it only ever displays what this returns.

function cents(v: unknown): bigint {
  const s = String(v ?? '0').trim();
  if (!/^-?\d+(?:\.\d{1,2})?$/.test(s)) return 0n;
  const neg = s.startsWith('-'); const clean = neg ? s.slice(1) : s;
  const [a, b = ''] = clean.split('.');
  const c = BigInt(a) * 100n + BigInt((b + '00').slice(0, 2));
  return neg ? -c : c;
}
export function centsText(c: bigint) { const neg = c < 0n; const abs = neg ? -c : c; return `${neg ? '-' : ''}${abs / 100n}.${(abs % 100n).toString().padStart(2, '0')}`; }
export function orderCents(v: unknown) { return cents(v); }
/** A percentage as hundredths of a percent: 12.34% -> 1234n. No Float anywhere. */
export function percentHundredths(v: unknown): bigint {
  const s = String(v ?? '0').trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(s)) return 0n;
  const [a, b = ''] = s.split('.');
  return BigInt(a) * 100n + BigInt((b + '00').slice(0, 2));
}
/** Half-up rounding of `base * percent`, entirely in integers. */
export function applyPercent(baseCents: bigint, percentH: bigint): bigint {
  return (baseCents * percentH + 5000n) / 10000n;
}

export type OrderTotals = { subtotal: string; discount: string; service_charge: string; final_amount: string };

/** Splits `total` into `parts` shares that sum EXACTLY to it, leftover cents by largest index-stable remainder. */
export function splitEvenly(total: bigint, parts: number): bigint[] {
  if (parts <= 0) return [];
  const n = BigInt(parts);
  const base = total / n;
  let leftover = total - base * n;
  const out: bigint[] = [];
  for (let i = 0; i < parts; i++) { const extra = leftover > 0n ? 1n : 0n; leftover -= extra; out.push(base + extra); }
  return out;
}

/** Splits `total` proportionally to `weights`, summing EXACTLY to it (largest remainder). */
export function splitProportionally(total: bigint, weights: bigint[]): bigint[] {
  const sum = weights.reduce((a, b) => a + b, 0n);
  if (sum <= 0n) return splitEvenly(total, weights.length);
  const shares = weights.map(w => (total * w) / sum);
  const rem = weights.map((w, i) => ({ i, r: (total * w) % sum }));
  let leftover = total - shares.reduce((a, b) => a + b, 0n);
  rem.sort((a, b) => (b.r === a.r ? a.i - b.i : (b.r > a.r ? 1 : -1)));
  for (const { i } of rem) { if (leftover <= 0n) break; shares[i] += 1n; leftover -= 1n; }
  return shares;
}

/**
 * Recomputes an order's totals from its CURRENT active items and active discounts, and persists
 * them -- together with its separate checks, if it has any.
 *
 * The ORDER stays the single financial truth: its subtotal is all of its items and its discount is
 * every active discount, whether granted on the order or on one of its bills. The bills are a
 * PARTITION of that order, never a copy of it, so revenue can never be counted twice. Their service
 * charges and (in EQUAL mode) their amounts are split by largest remainder, so the bills always sum
 * back to the order exactly -- not a cent is invented or lost.
 *
 * A percentage discount follows the subtotal of whatever it was granted on (the bill, or the whole
 * order); a fixed-amount discount never exceeds it. The service charge keeps its existing base --
 * the pre-discount subtotal -- at the percentage of the configuration version that priced the
 * order, never today's.
 */
export async function recomputeOrderTotals(tx: TxClient, order: any, now: string): Promise<OrderTotals> {
  const fresh = await tx.queryOne<any>('SELECT * FROM orders WHERE id=?', [order.id]) || order;
  const splitMode = String(fresh.split_mode || 'NONE');
  const bills = await tx.query<any>(`SELECT * FROM order_bills WHERE order_id=? AND status<>'VOID' ORDER BY bill_number`, [order.id]);

  const subtotalRow = await tx.queryOne<any>(`SELECT COALESCE(SUM(CASE WHEN status='ACTIVE' THEN subtotal ELSE 0 END),0) AS subtotal FROM order_items WHERE order_id=?`, [order.id]);
  const subtotal = cents(subtotalRow?.subtotal);

  // Each bill's own item subtotal (ITEMS mode); empty in the other modes.
  const billSubtotals = new Map<string, bigint>();
  for (const b of bills) {
    const row = await tx.queryOne<any>(`SELECT COALESCE(SUM(CASE WHEN status='ACTIVE' THEN subtotal ELSE 0 END),0) AS subtotal FROM order_items WHERE order_id=? AND bill_id=?`, [order.id, b.id]);
    billSubtotals.set(b.id, cents(row?.subtotal));
  }

  // Every active discount is recomputed against the subtotal of its OWN scope.
  const discounts = await tx.query<any>(`SELECT id,bill_id,percent,amount FROM order_discounts WHERE order_id=? AND status='ACTIVE' ORDER BY created_at`, [order.id]);
  const billDiscounts = new Map<string, bigint>();
  let discountTotal = 0n;
  const consumed = new Map<string, bigint>();
  for (const d of discounts) {
    const scopeId = d.bill_id || '';
    const scopeBase = d.bill_id ? (billSubtotals.get(d.bill_id) ?? 0n) : subtotal;
    const already = consumed.get(scopeId) ?? 0n;
    const remaining = scopeBase - already;
    let amount = d.percent != null ? applyPercent(scopeBase, percentHundredths(d.percent)) : cents(d.amount);
    if (amount > remaining) amount = remaining > 0n ? remaining : 0n;
    await tx.execute('UPDATE order_discounts SET amount=CAST(? AS numeric),base_amount=CAST(? AS numeric) WHERE id=?', [centsText(amount), centsText(scopeBase), d.id]);
    consumed.set(scopeId, already + amount);
    if (d.bill_id) billDiscounts.set(d.bill_id, (billDiscounts.get(d.bill_id) ?? 0n) + amount);
    discountTotal += amount;
  }

  const { percent } = await serviceChargePercentFor(tx, fresh.branch_id, fresh.order_type, fresh.created_at);
  const service = applyPercent(subtotal, percentHundredths(percent));
  const promotion = cents(fresh.promotion_amount);
  const finalAmount = subtotal - discountTotal - promotion + service;
  const clampedFinal = finalAmount < 0n ? 0n : finalAmount;

  const totals: OrderTotals = { subtotal: centsText(subtotal), discount: centsText(discountTotal), service_charge: centsText(service), final_amount: centsText(clampedFinal) };
  await tx.execute(`UPDATE orders SET subtotal=CAST(? AS numeric),discount=CAST(? AS numeric),service_charge=CAST(? AS numeric),final_amount=CAST(? AS numeric),updated_at=? WHERE id=?`,
    [totals.subtotal, totals.discount, totals.service_charge, totals.final_amount, now, order.id]);

  if (bills.length > 0) {
    if (splitMode === 'EQUAL') {
      const finals = splitEvenly(clampedFinal, bills.length);
      const subs = splitEvenly(subtotal, bills.length);
      const servs = splitEvenly(service, bills.length);
      const discs = splitEvenly(discountTotal, bills.length);
      for (let i = 0; i < bills.length; i++) {
        await tx.execute(`UPDATE order_bills SET subtotal=CAST(? AS numeric),discount=CAST(? AS numeric),service_charge=CAST(? AS numeric),final_amount=CAST(? AS numeric),updated_at=? WHERE id=?`,
          [centsText(subs[i]), centsText(discs[i]), centsText(servs[i]), centsText(finals[i]), now, bills[i].id]);
      }
    } else {
      // ITEMS: the service charge is apportioned by each bill's share of the subtotal, by largest
      // remainder, so the bills' service charges sum back to the order's exactly.
      const weights = bills.map(b => billSubtotals.get(b.id) ?? 0n);
      const servShares = splitProportionally(service, weights);
      for (let i = 0; i < bills.length; i++) {
        const sub = weights[i];
        const disc = billDiscounts.get(bills[i].id) ?? 0n;
        const billFinal = sub - disc + servShares[i];
        await tx.execute(`UPDATE order_bills SET subtotal=CAST(? AS numeric),discount=CAST(? AS numeric),service_charge=CAST(? AS numeric),final_amount=CAST(? AS numeric),updated_at=? WHERE id=?`,
          [centsText(sub), centsText(disc), centsText(servShares[i]), centsText(billFinal < 0n ? 0n : billFinal), now, bills[i].id]);
      }
    }
  }

  return totals;
}
