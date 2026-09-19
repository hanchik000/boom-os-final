// BOOM OS -- Stage 34.5 static source guards: BOOMCOIN.
// Guards against a hardcoded rate, a balance that is not the ledger, a coin minted by the POS or by
// a retried payment, and an earning engine that cannot actually be switched off.
import fs from 'node:fs';

const failures = []; let checks = 0;
const read = p => fs.readFileSync(p, 'utf8');
function ok(label, cond, detail) { checks++; if (!cond) failures.push(`${label}${detail ? ' -> ' + String(detail).slice(0, 220) : ''}`); }

const core = read('server/loyalty.ts');
const routes = read('server/routes/loyalty.ts');
const payments = read('server/routes/payments.ts');
const closure = read('server/order-closure.ts');
const seed = read('server/seed.ts');
const schema = read('prisma/schema.prisma');
const serverTs = read('server.ts');
const api = read('src/api.ts');
const cashier = read('src/components/CashierPOSView.tsx');
const migration = read('prisma/migrations/20260919180000_stage34_5_boomcoin/migration.sql');

// ---------------------------------------------------------------- 1. nothing hardcoded
ok('1. the rate and both switches are system settings', ['BOOMCOIN_EARNING_ENABLED', 'BOOMCOIN_COUNTER_UI_ENABLED', 'BOOMCOIN_SPEND_PER_COIN'].every(k => seed.includes(k) && core.includes(k)));
ok('2. the rate is read from configuration, never written as a literal in the earning maths', /cents\(get\(BOOMCOIN_SETTING_SPEND_PER_COIN\) \?\? '200\.00'\)/.test(core) && !/\/ 20000n|200n \*/.test(core));
ok('3. the earning engine can genuinely be switched off', /if \(!settings\.enabled\) return null;/.test(core));
ok('4. the counter switch is independent of the earning switch', /counterUiEnabled/.test(core) && /counter_ui_enabled: settings\.counterUiEnabled/.test(routes));

// ---------------------------------------------------------------- 2. the ledger is authoritative
ok('5. there is one BOOMCOIN ledger table', (schema.match(/^model BoomcoinLedger \{/m) || []).length === 1);
ok('6. the balance is recomputed as the SUM of that ledger, not read from a column', /SELECT COALESCE\(SUM\(coins\),0\) AS coins, COALESCE\(SUM\(qualifying_amount\),0\) AS spend FROM boomcoin_ledger WHERE customer_id=\?/.test(core));
ok('7. the customer columns are documented as a cache and returned beside the computed value', /cached_balance/.test(routes) && /CACHE maintained in the same transaction/.test(schema));
ok('8. every row records the balance and spend before and after', ['balance_before', 'balance_after', 'spend_before', 'spend_after'].every(f => new RegExp(`model BoomcoinLedger[\\s\\S]{0,1200}${f}`).test(schema)));
ok('9. a reversal is a new row -- nothing is ever edited or deleted', /type: 'REVERSED'/.test(core) && !/DELETE FROM boomcoin_ledger/.test(core) && !/UPDATE boomcoin_ledger SET coins/.test(core));

// ---------------------------------------------------------------- 3. a coin can never be minted twice
ok('10. idempotency is backed by a never-null entry key', /entry_key         String   @unique/.test(schema) && /ON CONFLICT \(entry_key\) DO NOTHING/.test(core));
ok('11. the key is derived from the order and the bill, so a split order earns per check exactly once', /`\$\{opts\.orderId\}\|\$\{opts\.billId \?\? 'ORDER'\}\|EARNED`/.test(core));
ok('12. an existing entry short-circuits before any balance is touched', /if \(already\) return null;/.test(core));
ok('13. the customer row is locked, so two concurrent payments cannot both mint', /FROM customers WHERE id=\? FOR UPDATE/.test(core));
ok('14. a replayed insert never double-updates the cached balance', /if \(!written \|\| written\.created_at !== opts\.now\) return written;/.test(core));

// ---------------------------------------------------------------- 4. earning is cumulative and server-side
ok('15. coins are the difference in floor(total spend / rate), so progress carries across visits', /Number\(spendAfter \/ settings\.spendPerCoinCents - spendBefore \/ settings\.spendPerCoinCents\)/.test(core));
ok('16. all of it is BigInt cents -- no Float', !/parseFloat/.test(core));
ok('17. accrual is wired into settlement, per bill when the order is split', /accrueBoomcoinForSettlement\(tx,\{branchId:order\.branch_id,customerId:bill\?bill\.customer_id:order\.customer_id/.test(payments));
ok('18. a cancelled, refunded or closed order gives its coins back', /reverseBoomcoinForOrder\(tx, \{ orderId: order\.id/.test(closure));

// ---------------------------------------------------------------- 5. RBAC, audit, wiring
ok('19. both permissions are seeded and granted through the existing role lists', ['loyalty.view', 'loyalty.manage'].every(c => seed.includes(`code: '${c}'`)));
const rolePerms = seed.match(/const stage17RolePerms = \[([^\]]*)\]/);
ok('20. managers hold both', rolePerms && rolePerms[1].includes("'loyalty.view'") && rolePerms[1].includes("'loyalty.manage'"), rolePerms?.[1]);
const cashierPerms = seed.match(/for \(const code of \[([^\]]*'credit\.repay'[^\]]*)\]\) \{/);
ok('21. a cashier may look but not adjust', cashierPerms && cashierPerms[1].includes("'loyalty.view'") && !cashierPerms[1].includes("'loyalty.manage'"), cashierPerms?.[1]);
ok('22. a manual adjustment always needs a reason', /ADJUSTMENT_REASON_REQUIRED/.test(routes));
ok('23. every route is branch-checked with the existing helper', (routes.match(/allowed\(req, ?(customer\.branch_id|b)\)/g) || []).length >= 3);
ok('24. earning, reversal and adjustment are all audited', ['BOOMCOIN_EARNED', 'BOOMCOIN_REVERSED', 'BOOMCOIN_ADJUSTED'].every(a => core.includes(a)));
ok('25. the router is mounted once and wired into async error forwarding', (serverTs.match(/app\.use\('\/api\/loyalty'/g) || []).length === 1 && /customersRouter, loyaltyRouter/.test(serverTs));
ok('26. the migration is additive: one new table plus two customer columns', /CREATE TABLE "boomcoin_ledger"/.test(migration) && /ADD COLUMN\s+"boomcoin_balance" INTEGER/.test(migration) && !/DROP TABLE/.test(migration));

// ---------------------------------------------------------------- 6. frontend: guidance only
ok('27. the POS reads the counter from the server', /getBoomcoinCounter/.test(api) && /api\.getBoomcoinCounter\(detail\.customer_id\)/.test(cashier));
ok('28. it never computes a balance, a rate or a coin itself', !/spendPerCoin|Math\.floor\([^)]*200/.test(cashier) && !/BOOMCOIN_SPEND_PER_COIN/.test(cashier));
ok('29. and it respects the counter switch', /boomcoin\.counter_ui_enabled &&/.test(cashier));
ok('30. RU + TK copy on the counter', /закажите ещё на/.test(cashier) && /sargyt ediň we 1 BOOMCOIN alyň/.test(cashier));

console.log(`Stage 34.5 static checks: ${checks}`);
if (failures.length) { console.error(`\nFAILURES (${failures.length}):`); for (const f of failures) console.error(' - ' + f); process.exit(1); }
console.log('ALL STAGE 34.5 STATIC CHECKS PASSED');
