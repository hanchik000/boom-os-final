// BOOM OS -- Stage 34.11 static source guards: Food & Sales Analytics.
// Guards against a second definition of "sold", against cost ever being recomputed from today's
// recipe, against an analytics table or cached rollup appearing, against double counting, against
// Float money, and against the module ever telling a manager which dish is best.
import fs from 'node:fs';

const failures = []; let checks = 0;
const read = p => fs.readFileSync(p, 'utf8');
function ok(label, cond, detail) { checks++; if (!cond) failures.push(`${label}${detail ? ' -> ' + String(detail).slice(0, 240) : ''}`); }

const analytics = read('server/routes/analytics.ts');
const analyticsCode = analytics.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
const serverTs = read('server.ts');
const schema = read('prisma/schema.prisma');
const seed = read('server/seed.ts');
const api = read('src/api.ts');
const view = read('src/components/AnalyticsView.tsx');
const sidebar = read('src/components/Sidebar.tsx');
const app = read('src/App.tsx');
const ru = read('src/translations/ru.ts');
const tk = read('src/translations/tk.ts');

// ---------------------------------------------------------------- 1. read-only, no second store
ok('1. the module writes nothing at all -- no INSERT, UPDATE or DELETE anywhere in it', !/INSERT INTO|UPDATE |DELETE FROM/.test(analytics));
ok('2. it opens no transaction, because it has nothing to commit', !/transaction\(/.test(analytics) && !/TxClient/.test(analytics));
ok('3. and it introduces no analytics table, rollup or cached aggregate to drift out of date', !/model \w*Analytic|model \w*Rollup|model \w*SalesSummary/i.test(schema) && !/analytics_/.test(schema));
ok('4. every figure is read live from the existing Order Core', /FROM orders o/.test(analytics) && /FROM order_items oi/.test(analytics));

// ---------------------------------------------------------------- 2. ONE definition of "sold"
ok('5. "sold" is defined exactly once, as the Order Core\'s own COMPLETED marker', (analytics.match(/const SOLD_STATUS = 'COMPLETED';/g) || []).length === 1);
ok('6. and every query uses that constant rather than restating a status', !/status='COMPLETED'/.test(analytics) && (analytics.match(/o\.status=\?/g) || []).length >= 6);
ok('7. so a cancelled, refunded or establishment-closed order can never appear as revenue', !/CANCELLED|REFUNDED|CLOSED_BY_ESTABLISHMENT/.test(analytics));
ok('8. removed lines are excluded too', (analytics.match(/oi\.status='ACTIVE'/g) || []).length >= 3);

// ---------------------------------------------------------------- 3. cost is historical
ok('9. THE HISTORICAL RULE: cost comes from the line\'s own snapshot, stamped when it was sold', /SUM\(oi\.recipe_cost_snapshot\)/.test(analytics));
ok('10. it is never recomputed from today\'s recipe or today\'s stock', !/recipe_ingredients|inventory_items|average_cost/.test(analytics));
ok('11. lines with no stamped cost are counted and reported, not treated as free', /units_without_cost/.test(analytics) && /FILTER \(WHERE oi\.recipe_cost_snapshot IS NULL\)/.test(analytics));
ok('12. and the drill-down shows each line\'s own historical cost and recipe version', /oi\.recipe_cost_snapshot, oi\.recipe_version_snapshot/.test(analytics));

// ---------------------------------------------------------------- 4. no double counting
ok('13. the two revenue questions are named separately and never added together', /item_revenue/.test(analytics) && /net_revenue/.test(analytics) && !/item_revenue \+ net_revenue|net_revenue \+ item_revenue/.test(analytics));
ok('14. order-level revenue is summed from the ORDER row, so a split order counts once', /SELECT COUNT\(\*\)::int AS orders,[\s\S]{0,300}SUM\(o\.final_amount\)[\s\S]{0,120}FROM orders o/.test(analytics));
ok('15. item-level revenue is summed from the lines, which a split partitions rather than copies', /SUM\(oi\.subtotal\)[\s\S]{0,200}FROM order_items oi\s*\n?\s*JOIN orders o/.test(analytics));
ok('16. nothing joins bills into a revenue sum, which is what would duplicate it', !/order_bills/.test(analytics));
ok('17. dishes, categories and the matrix all read ONE aggregation, so they cannot disagree', (analytics.match(/async function dishRows/g) || []).length === 1 && (analytics.match(/await dishRows\(/g) || []).length === 4);
ok('18. and a category total is folded up from those same dish rows', /const rows = await dishRows\(b, start, end\);/.test(analytics) && /cur\.revenueCents \+= moneyCents\(r\.revenue\);/.test(analytics) && /cur\.costCents \+= cost4ToCents\(r\.cost\);/.test(analytics) && /acc\.set\(key, cur\);/.test(analytics));

// ---------------------------------------------------------------- 5. money is never Float
ok('19. money is parsed into BigInt cents', /function moneyCents\(v: unknown\): bigint/.test(analytics));
ok('20. 4-decimal snapshot costs are folded down in BigInt too, never via a float', /function cost4ToCents\(v: unknown\): bigint/.test(analytics) && /const scaled4 = BigInt\(a\) \* 10000n \+ BigInt\(\(b \+ '0000'\)\.slice\(0, 4\)\);/.test(analytics));
ok('21. percentages are computed AND read back in BigInt hundredths', /function pctString\(numeratorCents: bigint, denominatorCents: bigint\)/.test(analytics) && /function pctHundredths\(v: string \| null\): bigint \| null/.test(analytics));
ok('22. there is no parseFloat anywhere in the module', !/parseFloat/.test(analyticsCode));
ok('23. and the only Number() is on a unit COUNT, never on money', (analyticsCode.match(/Number\(/g) || []).length === 1 && /units_sold: Number\(unitsMedian\)/.test(analyticsCode));
ok('24. the average check is an exact integer division of cents, not a float mean', /function divCents\(totalCents: bigint, count: number\)/.test(analytics) && /centsText\(totalCents \/ BigInt\(count\)\)/.test(analytics));

// ---------------------------------------------------------------- 6. the matrix measures, never judges
ok('25. THE MATRIX PUBLISHES ITS MEDIANS so the manager can see what the comparison was', /medians: \{ units_sold: Number\(unitsMedian\), margin_percent: centsText\(marginMedian\) \}/.test(analytics));
ok('26. and places each dish against them without naming a quadrant', /above_median_popularity/.test(analytics) && /above_median_margin/.test(analytics) && !/quadrant/i.test(analyticsCode));
ok('27. no verdict word is emitted anywhere in the module', !/\b(stars?|dogs?|puzzles?|workhorses?|ploughhorses?|winners?|losers?)\b/i.test(analyticsCode));
ok('28. a dish given away every time has no margin % to compare, and is excluded rather than called 0%', /const marginSorted = dishes\.map\(d => pctHundredths\(d\.margin_percent\)\)\.filter\(\(x\): x is bigint => x !== null\)/.test(analytics));
ok('29. the screen states in both languages that the judgement is the manager\'s', /система не называет блюда лучшими или худшими/.test(view) && /ulgam nahary iň gowy ýa iň erbet diýip atlandyrmaýar/.test(view));

// ---------------------------------------------------------------- 7. give-aways are visible
ok('30. a zero-price line is counted as a unit -- real food left the kitchen', /FILTER \(WHERE oi\.price_snapshot = 0\)/.test(analytics));
ok('31. and surfaced as a give-away rather than silently depressing a dish', (analytics.match(/give_away_units/g) || []).length >= 6);
ok('32. a give-away is NOT a discount: discounts are read from the order\'s own discount column', /SUM\(o\.discount\)/.test(analytics));

// ---------------------------------------------------------------- 8. period + timezone
ok('33. a period is resolved once, for every endpoint', (analytics.match(/async function resolvePeriod/g) || []).length === 1 && (analytics.match(/await resolvePeriod\(req, b\)/g) || []).length === 6);
ok('34. "today" means today in the BRANCH\'s timezone, never the server\'s', /SELECT id,name,timezone FROM branches WHERE id=\?/.test(analytics) && /date_trunc\('day', \(now\(\) AT TIME ZONE \?\)\)/.test(analytics));
ok('35. and the hour/weekday breakdown is computed in that timezone', /o\.created_at::timestamptz AT TIME ZONE \?/.test(analytics) && /EXTRACT\(HOUR FROM \$\{local\}\)/.test(analytics));
ok('36. every response echoes the period and the timezone it used', (analytics.match(/period: \{ start, end, timezone: tz \}/g) || []).length === 6);

// ---------------------------------------------------------------- 9. RBAC, isolation, wiring
ok('37. every endpoint is permission-gated with one read-only permission', (analytics.match(/requirePermission\('analytics\.view'\)/g) || []).length === 6 && !/analytics\.manage/.test(analytics));
// Membership, parsed rather than positional: later stages (34.12) legitimately append more codes
// to the same grant list.
ok('38. that permission is seeded and granted to the manager roles', /code: 'analytics\.view'/.test(seed) && (() => {
  const m = /const stage17RolePerms = \[([^\]]*)\]/.exec(seed);
  return Boolean(m) && m[1].split(',').map(x => x.trim().replace(/^'|'$/g, '')).includes('analytics.view');
})());
ok('39. and it is NOT granted to the cashier', (() => {
  const loop = /if \(roleCashier\) \{[\s\S]*?\n  \}/.exec(seed);
  if (!loop) return false;
  const list = /for \(const code of \[([^\]]*)\]\)/.exec(loop[0]);
  return Boolean(list) && !list[1].split(',').map(x => x.trim().replace(/^'|'$/g, '')).includes('analytics.view');
})());
ok('40. every endpoint is branch-checked through the shared helper', (analytics.match(/const b = branchOr403\(req\); if \(!b\) return deny\(res\);/g) || []).length === 6 && /req\.user\?\.isSuperUser \|\| req\.user\?\.allowedBranchIds\.includes\(b\)/.test(analytics));
ok('41. the router is mounted once and is no longer a reserved 501 stub', (serverTs.match(/app\.use\('\/api\/analytics'/g) || []).length === 1 && /const futureModules = \['crm'\];/.test(serverTs));
ok('42. the client asks the server for every figure and computes none', /getAnalyticsSales|getAnalyticsDishes|getAnalyticsMatrix/.test(api) && !/reduce\(\(s|Math\.round/.test(view));
ok('43. the screen is permission-gated in navigation and rendered from App', /permission: 'analytics\.view'/.test(sidebar) && /currentTab === 'analytics' && <AnalyticsView \/>/.test(app));
ok('44. and is bilingual, like every other screen', /"nav\.analytics": "Аналитика"/.test(ru) && /"nav\.analytics": "Analitika"/.test(tk) && /ru \? 'Матрица меню' : 'Menýu matrisasy'/.test(view));

console.log(`Stage 34.11 static checks: ${checks}`);
if (failures.length) { console.error(`\nFAILURES (${failures.length}):`); for (const f of failures) console.error(' - ' + f); process.exit(1); }
console.log('ALL STAGE 34.11 STATIC CHECKS PASSED');
