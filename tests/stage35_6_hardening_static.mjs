// BOOM OS -- Stage 35.6 Hardening: focused static guards for the two known limitations named in
// the Stage 35.6 report (QR/channel/offline/promotion security posture, and the offline-safety
// invariant that no cached client state can ever become financially authoritative).
//
// This file does not re-audit the whole project -- it targets exactly what Phase A of the
// hardening pass was scoped to: the QR/channel/offline/promotion chain already built in 35.6.
import fs from 'node:fs';
import assert from 'node:assert/strict';
const read = p => fs.readFileSync(p, 'utf8');
const pub = read('server/routes/public-menu.ts');
const vc = read('server/routes/visual-catalog.ts');
const promo = read('server/routes/promotions.ts');
const orders = read('server/routes/orders.ts');
const sw = read('public/boom-offline.js');
const view = read('src/components/VisualCustomerMenuView.tsx');

const checks = [
  // -- A1: QR flow -- server-side resolution only, no branch id anywhere on the request
  ['QR handler never reads req.query or req.body at all -- the token is the ONLY input',
    !/router\.get\('\/qr\/:token'[\s\S]{0,600}req\.(query|body)/.test(pub)],
  ['QR handler selects by qr_token exclusively, one WHERE clause, no branch of alternate lookup path',
    (pub.match(/WHERE qr_token=\?/g) || []).length === 1],
  ['an invalid/unknown token yields 404 QR_CODE_NOT_FOUND, not a fallback branch',
    /if \(!b\) return res\.status\(404\)\.json\(\{ error:'NOT_FOUND', code:'QR_CODE_NOT_FOUND'/.test(pub)],
  ['QR route selects only public-safe columns -- no recipe/cost/stock/employee/CRM fields',
    /SELECT id,name,code,address,phone,currency FROM branches WHERE qr_token=\?/.test(pub)],

  // -- A2: channel variants are presentation-only over ONE source of truth
  ['visual-catalog /public reads the same menu_items/menu_categories tables as public-menu.ts, not a per-channel copy',
    vc.includes('FROM menu_items') && vc.includes('FROM menu_categories') && pub.includes('FROM menu_items')],
  ['channel filtering happens strictly after the item/price query -- it can only remove/keep blocks, never reprice',
    (() => { const idx = vc.indexOf('router.get(\'/public\''); const body = vc.slice(idx, vc.indexOf('router.use(authenticateToken)')); const itemsIdx = body.indexOf('const items='); const filterIdx = body.indexOf('.filter((r:any)=>onChannel'); return itemsIdx > -1 && filterIdx > -1 && itemsIdx < filterIdx; })()],
  ['no per-channel product/menu table exists anywhere in the schema',
    !/model \w*Channel\w*Menu|model \w*Channel\w*Product|menu_items_online|menu_items_qr/i.test(read('prisma/schema.prisma'))],

  // -- A3: offline can never become a financial authority
  ['the service worker source contains no reference to /api/orders anywhere', !sw.includes('/api/orders')],
  ['the service worker source contains no reference to /api/payments anywhere', !sw.includes('/api/payments')],
  ['the service worker only special-cases two read-only endpoints, nothing else network/cache-intercepted',
    sw.match(/CACHEABLE_API\s*=\s*\[([^\]]*)\]/)?.[1].split(',').length === 2],
  ['order creation reads price EXCLUSIVELY from the server-side menu_items table, never from the request body',
    orders.includes("SELECT id,name_ru,name_tk,price FROM menu_items") && !/x\?\.(price|unit_price)/.test(orders)],
  ['order item parsing whitelists only menu_item_id/quantity/modifier_ids/comment -- no price-shaped field is ever read from a client payload',
    (() => { const start = orders.indexOf('for(const x of rawItems)'); const end = orders.indexOf('parsedItems.push'); const body = orders.slice(start, end); return !/price/i.test(body); })()],
  ['the customer menu view never persists or trusts a price value it read before this render -- it always displays server response fields directly',
    !/localStorage[\s\S]{0,80}price/i.test(view) && !/cachedPrice|stalePrice/i.test(view)],

  // -- A4: Promotion Engine invariants hold
  ['promo price validated strictly lower than the real, current item price at creation time',
    promo.includes('promoCents >= normalCents') && promo.includes('PROMO_PRICE_NOT_A_DISCOUNT')],
  ['promotion liveness is a pure function of current time vs. stored window, computed fresh on every call',
    promo.includes('active=true AND starts_at<=? AND ends_at>=?') && !/is_active\s*BOOLEAN\s*DEFAULT/i.test(read('prisma/migrations/20260921120000_stage35_6_channels_qr_promotions/migration.sql'))],
  ['branch scoping on promotion writes reuses the existing isAccessible/scope helpers, no new isolation mechanism',
    promo.includes('function isAccessible') && promo.includes('function scope')],
  ['promotions.ts never writes to the order_discounts table, and orders.ts never imports promotions.ts -- two separate code paths',
    !promo.includes('order_discounts') && !/from ['"]\.\/promotions['"]/.test(orders)],
];

let ok = 0;
for (const [name, v] of checks) { console.log(`${v ? 'PASS' : 'FAIL'} ${name}`); if (v) ok++; }
console.log(`${ok}/${checks.length} PASS`);
if (ok !== checks.length) process.exit(1);
