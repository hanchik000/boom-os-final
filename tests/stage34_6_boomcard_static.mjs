// BOOM OS -- Stage 34.6 static source guards: BOOMCARD lifecycle and the guest's cabinet.
// Guards against a card that activates itself, a threshold baked into code, history being deleted,
// manual management breaking when automation is off, and the guest's cabinet leaking which product
// their birthday benefit is.
import fs from 'node:fs';

const failures = []; let checks = 0;
const read = p => fs.readFileSync(p, 'utf8');
function ok(label, cond, detail) { checks++; if (!cond) failures.push(`${label}${detail ? ' -> ' + String(detail).slice(0, 220) : ''}`); }

const routes = read('server/routes/boomcard.ts');
const customers = read('server/routes/customers.ts');
const seed = read('server/seed.ts');
const schema = read('prisma/schema.prisma');
const serverTs = read('server.ts');
const api = read('src/api.ts');
const view = read('src/components/BoomcardView.tsx');
const sidebar = read('src/components/Sidebar.tsx');
const migration = read('prisma/migrations/20260919200000_stage34_6_boomcard/migration.sql');

// ---------------------------------------------------------------- 1. automation proposes, a manager decides
ok('1. the lifecycle states are exactly CANDIDATE / ACTIVE / INACTIVE', /status          String  @default\("CANDIDATE"\) \/\/ CANDIDATE \| ACTIVE \| INACTIVE/.test(schema));
ok('2. the evaluation endpoint never sets a card ACTIVE', (() => {
  const i = routes.indexOf("router.post('/lifecycle/evaluate'");
  const body = i < 0 ? '' : routes.slice(i);
  // A SELECT that FINDS active cards to lapse is fine; what must never appear is an UPDATE that
  // puts a card into ACTIVE without a manager.
  return i >= 0 && !/UPDATE boomcards SET status='ACTIVE'/.test(body);
})());
ok('3. activation and renewal are manager-permissioned routes', /router\.post\('\/:id\/activate', requirePermission\('boomcard\.manage'\)/.test(routes) && /router\.post\('\/:id\/renew', requirePermission\('boomcard\.manage'\)/.test(routes));
ok('4. with automation off the evaluation reports but creates nothing', /if \(!settings\.autoEnabled\) \{ candidates\.push\(entry\); continue; \}/.test(routes));
ok('5. and the automatic lapse only runs when automation is on', /if \(settings\.autoEnabled\) \{[\s\S]{0,260}status='ACTIVE' AND valid_until IS NOT NULL AND valid_until<\?/.test(routes));
ok('6. manual creation and activation do not consult the automation switch at all', (() => {
  const i = routes.indexOf("router.post('/', requirePermission('boomcard.manage')");
  const body = i < 0 ? '' : routes.slice(i, routes.indexOf('async function loadCardForDecision'));
  return i >= 0 && !/autoEnabled/.test(body);
})());

// ---------------------------------------------------------------- 2. nothing hardcoded
ok('7. the threshold, validity, breakfast allowance and switch are all settings', ['BOOMCARD_AUTO_LIFECYCLE_ENABLED', 'BOOMCARD_MONTHLY_SPEND_THRESHOLD', 'BOOMCARD_VALIDITY_DAYS', 'BOOMCARD_BREAKFAST_PER_PERIOD'].every(k => seed.includes(k) && routes.includes(k)));
ok('8. the qualifying spend is computed from REAL completed orders, not invented', /FROM orders o WHERE o\.branch_id=\? AND o\.status='COMPLETED' AND o\.customer_id IS NOT NULL/.test(routes));
ok('9. money comparison is BigInt cents -- no Float', /cents\(r\.spend\) >= settings\.thresholdCents/.test(routes) && !/parseFloat/.test(routes));

// ---------------------------------------------------------------- 3. history is never destroyed
ok('10. every transition is its own event row', /INSERT INTO boomcard_events/.test(routes) && (routes.match(/recordEvent\(tx/g) || []).length >= 6);
ok('11. nothing is ever deleted', !/DELETE FROM boomcards|DELETE FROM boomcard_events|DELETE FROM boomcard_birthday_gifts/.test(routes));
ok('12. deactivation only changes state', /UPDATE boomcards SET status='INACTIVE',deactivated_at=\?/.test(routes));
ok('13. an event records who decided and whether it was automatic', /automatic    Boolean @default\(false\)/.test(schema) && /decided_by   String\?/.test(schema));
ok('14. a guest can only ever have one card', /customer_id     String  @unique/.test(schema) && /BOOMCARD_ALREADY_EXISTS/.test(routes));

// ---------------------------------------------------------------- 4. the cabinet is generic about the gift
ok('15. the cabinet is reached by an opaque token, never by the customer id', /cabinet_token   String  @unique/.test(schema) && /WHERE b\.cabinet_token=\?/.test(routes));
ok('16. THE PRIVACY RULE: the cabinet response never selects the gift\'s product', (() => {
  const i = routes.indexOf("router.get('/cabinet/:token'");
  const body = i < 0 ? '' : routes.slice(i, routes.indexOf('router.use(authenticateToken);'));
  return i >= 0 && !/menu_item_id|menu_items|name_ru/.test(body);
})());
ok('17. it reports only availability, quantity and validity', /birthday_benefit: gifts\.length > 0 \? \{ available: true, quantity/.test(routes));
ok('18. the MANAGER view does resolve the product, because they chose it', /LEFT JOIN menu_items m ON m\.id=g\.menu_item_id/.test(routes));
// Stage 34.6 had no BOOMBACK ledger yet, so the cabinet reported null rather than inventing a
// number. Stage 34.7 built that ledger; the invariant is the same one, now enforceable: the
// cabinet reads the cashback balance from the authoritative ledger and never computes its own.
ok('19. the cabinet reports the cashback balance from the authoritative BOOMBACK ledger, never an invented one', /SELECT COALESCE\(SUM\(amount\),0\) AS balance FROM boomback_ledger WHERE customer_id=\?/.test(routes) && /cashback_balance: String\(boomback\?\.balance \?\? '0'\)/.test(routes));

// ---------------------------------------------------------------- 5. RBAC, audit, wiring, schema
ok('20. both permissions are seeded', ['boomcard.view', 'boomcard.manage'].every(c => seed.includes(`code: '${c}'`)));
const rolePerms = seed.match(/const stage17RolePerms = \[([^\]]*)\]/);
ok('21. managers hold both', rolePerms && rolePerms[1].includes("'boomcard.view'") && rolePerms[1].includes("'boomcard.manage'"), rolePerms?.[1]);
const cashierPerms = seed.match(/for \(const code of \[([^\]]*'credit\.repay'[^\]]*)\]\) \{/);
ok('22. a cashier may look but not manage', cashierPerms && cashierPerms[1].includes("'boomcard.view'") && !cashierPerms[1].includes("'boomcard.manage'"), cashierPerms?.[1]);
ok('23. every authenticated route is branch-checked with the existing helper', (routes.match(/allowed\(req, ?(card\.branch_id|customer\.branch_id|b)\)/g) || []).length >= 4);
ok('24. every transition is audited through the existing audit log', /action: `BOOMCARD_\$\{opts\.type\}`/.test(routes));
// Stage 34.12 legitimately mounts a second router (the journal) at the same '/api/boomcard' base
// path, the same established pattern as order-bills before orders -- so this counts mounts of
// boomcardRouter itself, not every app.use('/api/boomcard' line.
ok('25. the router is mounted once and wired into async error forwarding', (serverTs.match(/app\.use\('\/api\/boomcard', boomcardRouter\)/g) || []).length === 1 && /loyaltyRouter, boomcardRouter/.test(serverTs));
ok('26. the migration is additive: three new tables plus one nullable customer column', (migration.match(/CREATE TABLE "boomcard/g) || []).length === 3 && /ADD COLUMN\s+"birth_date" TEXT/.test(migration) && !/DROP TABLE/.test(migration));
ok('27. a birth date is recorded on the guest but grants nothing by itself', /INVALID_BIRTH_DATE/.test(customers) && /never a discount and grants nothing by itself/.test(customers));

// ---------------------------------------------------------------- 6. frontend
ok('28. the screen is permission-gated and wired into the existing navigation', /hasPermission\('boomcard\.view'\)/.test(view) && /permission: 'boomcard\.view'/.test(sidebar));
ok('29. lifecycle actions exist for a manager only', /canManage = hasPermission\('boomcard\.manage'\)/.test(view) && /activateBoomcard/.test(api) && /deactivateBoomcard/.test(api));
ok('30. the screen states that the evaluation activates nobody', /Расчёт никого не активирует/.test(view));
ok('31. and that the guest never sees which dish the gift is', /конкретное блюдо ему не показывается/.test(view));
ok('32. the client never decides a status or a validity window itself', !/'ACTIVE'\s*;|valid_until =/.test(view));
ok('33. RU + TK copy throughout', /Dalaşgärler/.test(view) && /nav\.boomcard/.test(sidebar));

console.log(`Stage 34.6 static checks: ${checks}`);
if (failures.length) { console.error(`\nFAILURES (${failures.length}):`); for (const f of failures) console.error(' - ' + f); process.exit(1); }
console.log('ALL STAGE 34.6 STATIC CHECKS PASSED');
