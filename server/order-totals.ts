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

/**
 * Recomputes an order's totals from its CURRENT active items and active discounts, and persists
 * them. A percentage discount follows the subtotal (removing an item shrinks it proportionally); a
 * fixed-amount discount never exceeds the subtotal. The service charge keeps its existing base --
 * the pre-discount subtotal -- at the percentage of the configuration version that priced the
 * order, never today's.
 */
export async function recomputeOrderTotals(tx: TxClient, order: any, now: string): Promise<OrderTotals> {
  const subtotalRow = await tx.queryOne<any>(`SELECT COALESCE(SUM(CASE WHEN status='ACTIVE' THEN subtotal ELSE 0 END),0) AS subtotal FROM order_items WHERE order_id=?`, [order.id]);
  const subtotal = cents(subtotalRow?.subtotal);

  const discounts = await tx.query<any>(`SELECT id,percent,amount FROM order_discounts WHERE order_id=? AND status='ACTIVE' ORDER BY created_at`, [order.id]);
  let discountTotal = 0n;
  for (const d of discounts) {
    const remaining = subtotal - discountTotal;
    let amount = d.percent != null ? applyPercent(subtotal, percentHundredths(d.percent)) : cents(d.amount);
    if (amount > remaining) amount = remaining > 0n ? remaining : 0n;
    await tx.execute('UPDATE order_discounts SET amount=CAST(? AS numeric),base_amount=CAST(? AS numeric) WHERE id=?', [centsText(amount), centsText(subtotal), d.id]);
    discountTotal += amount;
  }

  const { percent } = await serviceChargePercentFor(tx, order.branch_id, order.order_type, order.created_at);
  const service = applyPercent(subtotal, percentHundredths(percent));
  const promotion = cents(order.promotion_amount);
  const finalAmount = subtotal - discountTotal - promotion + service;

  const totals: OrderTotals = { subtotal: centsText(subtotal), discount: centsText(discountTotal), service_charge: centsText(service), final_amount: centsText(finalAmount < 0n ? 0n : finalAmount) };
  await tx.execute(`UPDATE orders SET subtotal=CAST(? AS numeric),discount=CAST(? AS numeric),service_charge=CAST(? AS numeric),final_amount=CAST(? AS numeric),updated_at=? WHERE id=?`,
    [totals.subtotal, totals.discount, totals.service_charge, totals.final_amount, now, order.id]);
  return totals;
}
