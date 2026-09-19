// BOOM OS -- Stage 34.7 static source guards: BOOMBACK + breakfast redemption.
// Guards against BOOMBACK ever behaving like a discount, against a second inventory path for the
// breakfast, against money being spent that the guest does not hold, and against a partially paid
// order being treated as settled.
import fs from 'node:fs';

const failures = []; let checks = 0;
const read = p => fs.readFileSync(p, 'utf8');
function ok(label, cond, detail) { checks++; if (!cond) failures.push(`${label}${detail ? ' -> ' + String(detail).slice(0, 220) : ''}`); }

const core = read('server/loyalty.ts');
const routes = read('server/routes/loyalty.ts');
const boomcard = read('server/routes/boomcard.ts');
const payments = read('server/routes/payments.ts');
const totals = read('server/order-totals.ts');
const closure = read('server/order-closure.ts');
const seed = read('server/seed.ts');
const schema = read('prisma/schema.prisma');
const cashier = read('src/components/CashierPOSView.tsx');
const api = read('src/api.ts');
const migration = read('prisma/migrations/20260919220000_stage34_7_boomback/migration.sql');

// ---------------------------------------------------------------- 1. BOOMBACK IS NOT A DISCOUNT
ok('1. BOOMBACK is a payment method, never a discount', /'CREDIT','BOOMBACK'\]\)/.test(payments) && /BOOMBACK IS NOT A DISCOUNT/.test(schema));
ok('2. nothing about BOOMBACK touches the order-pricing rule', !/boomback/i.test(totals));
ok('3. no discount row is ever created from a BOOMBACK settlement', !/order_discounts/.test(core));
ok('4. the receipt prints it as a payment line, not a price reduction', /BOOMBACK prints as a PAYMENT line/.test(cashier) && /<span>BOOMBACK<\/span><span>-\{money\(p\.amount\)\}/.test(cashier));

// ---------------------------------------------------------------- 2. partial settlement is real
ok('5. only BOOMBACK may settle an order partially', /const PARTIAL_METHODS=new Set\(\['BOOMBACK'\]\);/.test(payments));
ok('6. every other method still has to settle the remainder exactly', /allowPartial \? \(requested>remaining\|\|requested<=0n\) : \(requested!==remaining\)/.test(payments));
ok('7. a partially settled order is NOT completed', /const stillOpen=!fullySettled\?\{id:'partial'\}:/.test(payments));
ok('8. and its bill is not closed either', /if\(bill&&fullySettled\)\{/.test(payments));

// ---------------------------------------------------------------- 3. the guest can only spend what they hold
ok('9. a BOOMBACK payment requires an identified guest', /BOOMBACK_REQUIRES_CUSTOMER/.test(payments));
ok('10. the balance is checked before the payment is written', /if\(requested>balance\)throw Object\.assign\(new Error\('BOOMBACK_INSUFFICIENT_BALANCE'\)/.test(payments));
ok('11. and re-checked under a row lock when the ledger entry is written', /FROM customers WHERE id=\? FOR UPDATE/.test(core) && /if \(opts\.amountCents > balance\) throw Object\.assign\(new Error\('BOOMBACK_INSUFFICIENT_BALANCE'\)/.test(core));
ok('12. the balance is the SUM of the authoritative ledger, with the cache shown beside it', /SELECT COALESCE\(SUM\(amount\),0\) AS balance FROM boomback_ledger WHERE customer_id=\?/.test(core) && /cached_balance/.test(routes));
ok('13. every entry carries a never-null key, so a retry cannot spend the same money twice', /entry_key      String   @unique/.test(schema) && /ON CONFLICT \(entry_key\) DO NOTHING/.test(core));
ok('14. all of it is BigInt cents -- no Float', !/parseFloat/.test(core));

// ---------------------------------------------------------------- 4. refunds give it back
ok('15. BOOMBACK spent on a refunded order comes back', /reverseBoombackForOrder/.test(closure) && /type: 'REVERSED'/.test(core));
ok('16. cashback earned on a refunded order is taken back too', /Cashback reversed with the order/.test(core));
ok('17. a reversal is its own row -- nothing is edited or deleted', !/DELETE FROM boomback_ledger/.test(core) && !/UPDATE boomback_ledger SET amount/.test(core));

// ---------------------------------------------------------------- 5. cashback is configuration, not an invented rule
ok('18. cashback is off and zero by default', /'BOOMBACK_CASHBACK_ENABLED','false'/.test(seed) && /'BOOMBACK_CASHBACK_PERCENT','0'/.test(seed));
ok('19. it earns nothing unless the switch is on', /!== 'true'\) return null;/.test(core));
ok('20. and only for an ACTIVE card holder', /FROM boomcards WHERE customer_id=\? AND status='ACTIVE'/.test(core));

// ---------------------------------------------------------------- 6. breakfast: one inventory path
ok('21. a breakfast redemption is a REAL order line at price 0', /INSERT INTO order_items[\s\S]{0,200}price_snapshot,quantity,subtotal[\s\S]{0,120},0,\?,0,/.test(boomcard));
ok('22. it does NOT consume inventory itself -- the existing payment path does', (() => {
  const i = boomcard.indexOf("router.post('/:id/breakfast/redeem'");
  const body = i < 0 ? '' : boomcard.slice(i, boomcard.indexOf('/**\n * The monthly lifecycle run'));
  return i >= 0 && !/stock_movements|inventory_items|recipe_ingredients/.test(body);
})());
ok('23. the allowance limits it and cannot be exceeded', /BREAKFAST_BALANCE_EXHAUSTED/.test(boomcard) && /if \(quantity > remaining\)/.test(boomcard));
ok('24. only an ACTIVE card may redeem', /if \(card\.status !== 'ACTIVE'\) throw Object\.assign\(new Error\('BOOMCARD_NOT_ACTIVE'\)/.test(boomcard));
ok('25. only an open order may receive one', /ORDER_NOT_EDITABLE/.test(boomcard));
ok('26. the redemption is recorded in the card\'s own event ledger, separate from BOOMBACK', /type: 'BREAKFAST_REDEEMED'/.test(boomcard));
ok('27. BOOM OS does not hardcode which dishes count as breakfast', /does not hardcode which dishes count as breakfast/.test(boomcard) && !/BREAKFAST_MENU_ITEM/.test(seed));
ok('28. the order totals are recomputed through the one pricing rule', /await recomputeOrderTotals\(tx, order, now\)/.test(boomcard));

// ---------------------------------------------------------------- 7. RBAC, audit, wiring, frontend
ok('29. a manual BOOMBACK grant needs loyalty.manage and a reason', /router\.post\('\/boomback\/adjust', requirePermission\('loyalty\.manage'\)/.test(routes) && /ADJUSTMENT_REASON_REQUIRED/.test(routes));
ok('30. redeeming a breakfast needs boomcard.manage', /router\.post\('\/:id\/breakfast\/redeem', requirePermission\('boomcard\.manage'\)/.test(boomcard));
ok('31. grant, redemption, cashback and reversal are all audited', ['BOOMBACK_ADJUSTED', 'BOOMBACK_REDEEMED', 'BOOMBACK_EARNED', 'BOOMBACK_REVERSED'].every(a => core.includes(a)));
ok('32. the guest cabinet reports the real cashback balance from the ledger', /FROM boomback_ledger WHERE customer_id=\?/.test(boomcard) && /cashback_balance: String\(boomback\?\.balance/.test(boomcard));
ok('33. the migration is additive: one new table plus one customer column', /CREATE TABLE "boomback_ledger"/.test(migration) && /ADD COLUMN\s+"boomback_balance"/.test(migration) && !/DROP TABLE/.test(migration));
ok('34. the POS never decides the amount itself -- it states the server validates it', /the SERVER validates the amount/.test(cashier) && /getBoombackBalance/.test(api));
ok('35. a partial BOOMBACK payment gets its own idempotency key, so it cannot collide with the cash one', /PARTIAL_PAYMENT_METHODS\.includes\(payMethod\) \? `-\$\{payMethod\.toLowerCase\(\)\}`/.test(cashier));
ok('36. RU + TK copy stating it is not a discount', /BOOMBACK — это не скидка/.test(cashier) && /BOOMBACK arzanladyş däl/.test(cashier));

console.log(`Stage 34.7 static checks: ${checks}`);
if (failures.length) { console.error(`\nFAILURES (${failures.length}):`); for (const f of failures) console.error(' - ' + f); process.exit(1); }
console.log('ALL STAGE 34.7 STATIC CHECKS PASSED');
