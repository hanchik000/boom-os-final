// BOOM OS -- Stage 34.2 static source guards: configurable service charge / business configuration.
// Guards against a second service-charge calculation, a hardcoded percentage, an allocation that
// could exceed what the order collected, a configuration edited in place (destroying history), and
// any recalculation of an already-priced order.
import fs from 'node:fs';

const failures = []; let checks = 0;
const read = p => fs.readFileSync(p, 'utf8');
function ok(label, cond, detail) { checks++; if (!cond) failures.push(`${label}${detail ? ' -> ' + String(detail).slice(0, 220) : ''}`); }

const core = read('server/service-charge.ts');
const routes = read('server/routes/service-charge.ts');
const orders = read('server/routes/orders.ts');
const totals = read('server/order-totals.ts');
const payments = read('server/routes/payments.ts');
const seed = read('server/seed.ts');
const schema = read('prisma/schema.prisma');
const migration = read('prisma/migrations/20260919120000_stage34_2_service_charge_config/migration.sql');
const api = read('src/api.ts');
const view = read('src/components/ServiceChargeView.tsx');
const sidebar = read('src/components/Sidebar.tsx');

// ---------------------------------------------------------------- 1. one core, no forks
ok('1. there is exactly one service charge recording routine', (core.match(/export async function recordServiceChargeLedger/g) || []).length === 1);
ok('2. payments.ts no longer carries its own copy of it', !/async function recordServiceChargeLedger/.test(payments) && /from '\.\.\/service-charge'/.test(payments));
ok('3. orders.ts resolves the percentage through the same core, not its own query', /serviceChargePercentFor/.test(orders) && !/FROM service_charge_configs/.test(orders));
ok('4. no second ledger table was introduced', (schema.match(/^model ServiceChargeLedger \{/m) || []).length === 1);

// ---------------------------------------------------------------- 2. nothing hardcoded per order type
ok('5. takeaway and delivery have their own configurable percentages', /takeaway_percent/.test(schema) && /delivery_percent/.test(schema));
ok('6. and their own system settings as the fallback', /TAKEAWAY_SERVICE_CHARGE_PERCENT/.test(seed) && /DELIVERY_SERVICE_CHARGE_PERCENT/.test(seed));
ok('7. the order-type percentage is resolved in one place, per type', /type === 'DINE_IN' \? config\.percent : type === 'TAKEAWAY' \? config\.takeaway_percent : type === 'DELIVERY' \? config\.delivery_percent/.test(core));
ok('8. order creation no longer hardcodes "DINE_IN only" service charge', !/if\(orderType==='DINE_IN'\)\{const branchConfig/.test(orders));

// ---------------------------------------------------------------- 3. versioning: history is never destroyed
ok('9. a configuration is a version with an effective window', /effective_from/.test(schema) && /effective_to/.test(schema) && /scope/.test(schema));
ok('10. publishing archives the previous version instead of updating it in place', /UPDATE service_charge_configs SET status='ARCHIVED',effective_to=/.test(routes) && !/UPDATE service_charge_configs SET percent=/.test(routes));
ok('11. the effective version is resolved by time, branch first then organisation default', /scope='BRANCH' AND branch_id=\?\) OR scope='ORGANIZATION'/.test(core) && /CASE WHEN scope='BRANCH' THEN 0 ELSE 1 END/.test(core));
ok('12. the order snapshots which version priced it', /service_charge_config_id/.test(schema) && /service_charge_config_id/.test(orders));
// Stage 34.3 moved the recalculation into the single order-totals core. The invariant is the
// same one: the order\'s own creation moment decides which configuration version applies.
ok('13. recalculating after an item removal uses the order\'s own creation moment, not today', /await recomputeOrderTotals\(tx, order, now\)/.test(orders) && /serviceChargePercentFor\(tx, fresh\.branch_id, fresh\.order_type, fresh\.created_at\)/.test(totals));
ok('14. recording the ledger prefers the order\'s snapshotted version', /order\.service_charge_config_id \|\| \(await resolveEffectiveConfig/.test(core));

// ---------------------------------------------------------------- 4. allocation can never exceed what was collected
ok('15. the category total is validated against the service charge percentage', /ALLOCATIONS_EXCEED_SERVICE_CHARGE/.test(routes) && /categorySum>pctHundredths\(percent\)/.test(routes));
ok('16. individual allocations are validated against their own category', /MEMBER_ALLOCATIONS_EXCEED_CATEGORY/.test(routes) && /memberSum>pctHundredths\(cp\)/.test(routes));
ok('17. recording refuses to allocate more than the order actually charged', (core.match(/allocated \+ \w+ > serviceCents/g) || []).length === 2);
ok('18. whatever is left over is recorded to the establishment, never silently dropped', /const remainder = serviceCents - allocated;/.test(core) && /targetType: 'ESTABLISHMENT'/.test(core));

// ---------------------------------------------------------------- 5. categories, modes, strategies
ok('19. exactly the five business categories are defined, in one place', /SERVICE_CHARGE_CATEGORIES = \['BAR', 'KITCHEN', 'WAITERS', 'MANAGERS', 'OTHER'\]/.test(core));
ok('20. both distribution modes exist and are validated', /SERVICE_CHARGE_MODES = \['COMMON', 'INDIVIDUAL'\]/.test(core) && /INVALID_SERVICE_CHARGE_MODE/.test(routes));
ok('21. all four common-distribution strategies exist and are validated', /SERVICE_CHARGE_STRATEGIES = \['EQUAL', 'BY_SALES', 'BY_ORDERS', 'BY_HOURS'\]/.test(core) && /INVALID_SERVICE_CHARGE_STRATEGY/.test(routes));
ok('22. mixed modes are possible because the mode lives on each category, not on the configuration', /model ServiceChargeCategory[\s\S]{0,700}mode\s+String/.test(schema));
ok('23. a COMMON category records one pool per order rather than per-person rows', /targetType: 'POOL'/.test(core) && /status: 'POOLED'/.test(core));
ok('24. an INDIVIDUAL member configured at 0% simply earns nothing (no row, no error)', /if \(amount <= 0n\) continue; \/\/ a member configured at 0% legitimately earns nothing/.test(core));

// ---------------------------------------------------------------- 6. distribution is real, never guessed
ok('25. every strategy is computed from real data, not invented weights', /strategy === 'BY_SALES' \|\| strategy === 'BY_ORDERS'/.test(core) && /FROM orders WHERE branch_id=\? AND status='COMPLETED'/.test(core));
ok('26. BY_HOURS uses real recorded POS session time', /waiter_pos_sessions', 'operator_pos_sessions'/.test(core) && /Math\.floor\(\(end - start\) \/ 60000\)/.test(core));
ok('27. a pool whose members all weigh zero is reported, never split on a guess', /ZERO_WEIGHT/.test(core) && /if \(shares\.size === 0\)/.test(core));
ok('28. the split is exact -- leftover cents go by largest remainder, none are lost or invented', /function splitByWeight/.test(core) && /let leftover = total - assigned;/.test(core));
ok('29. distributing marks the pool DISTRIBUTED so it can never be paid twice', /UPDATE service_charge_ledger SET status='DISTRIBUTED' WHERE id=\? AND status='POOLED'/.test(core));
ok('30. distributed rows stay attached to the order that earned them', /poolId: pool\.id/.test(core) && /pool\.order_id/.test(core));

// ---------------------------------------------------------------- 7. money precision, idempotency, audit, RBAC
ok('31. all service charge maths is BigInt hundredths -- no Float', /function pctHundredths/.test(core) && !/parseFloat|Number\(.*percent\)/.test(core));
ok('32. ledger recording is genuinely idempotent (a never-null allocation key backs the uniqueness)', /allocation_key String  @default\(""\)/.test(schema) && /ON CONFLICT \(order_id,allocation_key\) DO NOTHING/.test(core));
ok('33. the migration backfills that key before the unique index can hold', /UPDATE "service_charge_ledger"[\s\S]{0,200}allocation_key/.test(migration) && /uq_service_charge_ledger_order_allocation_key/.test(migration));
ok('34. publishing and distributing are both audited', /SERVICE_CHARGE_VERSION_PUBLISHED/.test(routes) && /SERVICE_CHARGE_POOLS_DISTRIBUTED/.test(core));
ok('35. every route keeps the existing permission + branch authorization pattern', (routes.match(/requirePermission\('service_charge\.(view|manage)'\)/g) || []).length === 5 && (routes.match(/!allowed\(req,b\)/g) || []).length === 5);
ok('36. publishing the organisation-wide default needs organisation-level rights', /ORGANIZATION_SCOPE_FORBIDDEN/.test(routes));
ok('37. a category member must belong to a branch the caller may administer', /MEMBER_BRANCH_MISMATCH/.test(routes));

// ---------------------------------------------------------------- 8. frontend
ok('38. the API client exposes the flow through the one central client', /publishServiceCharge/.test(api) && /getServiceChargeHistory/.test(api) && /distributeServiceCharge/.test(api));
ok('39. the admin screen is permission-gated and wired into the existing navigation', /hasPermission\('service_charge\.view'\)/.test(view) && /permission: 'service_charge\.view'/.test(sidebar));
ok('40. the screen states that the frontend rule is guidance and the backend is authoritative', /the backend is the authority/.test(view));
ok('41. it never computes an authoritative distributed amount itself', !/allocation_key|POOLED|splitByWeight/.test(view));
ok('42. RU + TK copy throughout', /Общее распределение/.test(view) && /Umumy paýlanyş/.test(view) && /nav\.serviceCharge/.test(sidebar));

console.log(`Stage 34.2 static checks: ${checks}`);
if (failures.length) { console.error(`\nFAILURES (${failures.length}):`); for (const f of failures) console.error(' - ' + f); process.exit(1); }
console.log('ALL STAGE 34.2 STATIC CHECKS PASSED');
