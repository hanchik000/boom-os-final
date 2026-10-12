// BOOM OS -- Stage 43: finishing the kitchen flow. Source guards for the three rules this stage
// adds, and for the boundaries it must not cross.
//
// The behavioural proof is tests/stage43_kitchen_coordination_e2e.mjs.
import fs from 'node:fs';
const read = p => fs.readFileSync(p, 'utf8');
const stripComments = src => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '')
  .replace(/^\s*\*.*$/gm, '')
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

const engine = read('server/kitchen.ts');
const engineCode = stripComments(engine);
const routes = read('server/routes/kitchen.ts');
const routesCode = stripComments(routes);
const migration = read('prisma/migrations/20260927000000_stage43_kitchen_coordination/migration.sql');
// The comments in a migration describe what it does NOT do ("no column is dropped or retyped"), so
// the forbidden-statement check reads the SQL alone.
const migrationSql = migration.split('\n').filter(l => !l.trim().startsWith('--')).join('\n');
const schema = read('prisma/schema.prisma');
const station = read('src/components/KitchenStationView.tsx');
const expo = read('src/components/ExpoView.tsx');
const control = read('src/components/KitchenControlView.tsx');
const api = read('src/api.ts');

const checks = [
  // ------------------------------------------------------------------ A. SERVE THE ORDER TOGETHER
  ['"подать вместе" is declared through the EXISTING waiter note, not a new field on the order',
    engine.includes("WHERE order_id=? AND kind='SERVE_TOGETHER'") &&
    !/ALTER TABLE "orders"/.test(migration) && !/orders\.serve_together|serve_together.*orders/i.test(routesCode)],
  ['it is carried on the kitchen\'s own table, as a planning fact',
    /ALTER TABLE "kds_item_tasks" ADD COLUMN "serve_together" BOOLEAN NOT NULL DEFAULT false/.test(migration) &&
    /serve_together\s+Boolean\s+@default\(false\)/.test(schema)],
  ['the note applies it and immediately re-paces the order',
    routes.includes("if (kind === 'SERVE_TOGETHER')") && routes.includes('await applyServeTogether(tx, order.id)') &&
    routes.includes('await recalculateCoordinatedOrder(tx, order.id)')],
  ['the whole order is paced to its SLOWEST station',
    engine.includes('export async function recalculateCoordinatedOrder') && engineCode.includes('Math.max(...targets)')],
  ['a start time is never pushed into the past',
    engineCode.includes('Math.max(now, targetMs - expected * 60000)')],
  ['an item already in the pan is not re-paced',
    /t.status === 'IN_PROGRESS' \|\| t.status === 'READY'/.test(engineCode)],
  ['the station\'s own estimate and the shared target are different columns',
    /ALTER TABLE "kds_item_tasks" ADD COLUMN "coordinated_ready_at" TEXT/.test(migration) &&
    engineCode.includes('SET coordinated_ready_at=?, forecast_start_at=?') &&
    !engineCode.includes('SET forecast_ready_at=? WHERE id=? AND serve_together')],
  ['pacing is applied only to orders that asked for it',
    engineCode.includes('open.filter(t => t.serve_together)')],
  ['the kitchen and the pass both show it, with the time to start',
    station.includes('task.serve_together') && station.includes('coordinated_ready_at') &&
    expo.includes('o.serve_together') && routes.includes('serve_together: false, coordinated_ready_at: null')],

  // ------------------------------------------------------------- B. DELAY LIMITS PER DISH CATEGORY
  ['a delay limit can be scoped to a dish category',
    engine.includes('export async function thresholdsFor(branchId: string, stationId: string | null, categoryId: string | null = null)') &&
    routes.includes("const categoryId = req.body?.category_id ? String(req.body.category_id) : null;")],
  ['the most specific configured limit wins, with the branch default behind it',
    engineCode.includes('rows.find(r => r.station_id === stationId && r.category_id === categoryId && stationId && categoryId)') &&
    engineCode.includes('rows.find(r => !r.station_id && !r.category_id)')],
  ['the delay pass knows each task\'s category, so the right limit is used',
    engineCode.includes('LEFT JOIN menu_items mi ON mi.id=t.menu_item_id') &&
    engineCode.includes('await thresholdsFor(branchId, task.station_id, task.category_id || null)')],
  ['a category from another branch is refused',
    routes.includes("'CATEGORY_NOT_IN_BRANCH'")],
  ['the ordering rule on the limits themselves still holds',
    routes.includes("code: 'INVALID_THRESHOLDS'") || routes.includes("'INVALID_THRESHOLDS'")],
  ['the limits screen can set and show a category scope',
    control.includes("limitScope") && control.includes("'CATEGORY'") && control.includes('category_name_ru') &&
    api.includes('category_id?:string|null; warning_ratio:number')],
  ['the category column is indexed and points at a real category',
    /CREATE INDEX "idx_kitchen_thresholds_category"/.test(migration) &&
    /kitchen_thresholds_category_id_fkey/.test(migration)],

  // ---------------------------------------------------------------------- C. ESCALATION REMINDERS
  ['an unresolved critical delay is reminded about, in rounds',
    engineCode.includes("type: 'DELAY_ESCALATED'") && engineCode.includes('minutesPastCritical(task, th) / th.escalate_minutes')],
  ['a round can only be announced once, however often a screen is read',
    engineCode.includes('dedupeKey: `escalate:${task.id}:${round}`') &&
    /ALTER TABLE "kds_item_tasks" ADD COLUMN "escalation_round" INTEGER NOT NULL DEFAULT 0/.test(migration) &&
    engineCode.includes('if (round > num(task.escalation_round, 0))')],
  ['a reminder goes to the branch manager and is marked critical',
    engineCode.includes("audience: 'BRANCH_MANAGER'") && engineCode.includes("severity: 'CRITICAL'")],
  ['only an unfinished item can be reminded about',
    engineCode.includes("WHERE t.branch_id=? AND t.status IN ('QUEUED','ACCEPTED','IN_PROGRESS')")],
  ['escalate_minutes of zero turns reminders off rather than dividing by zero',
    engineCode.includes("state === 'CRITICAL' && th.escalate_minutes > 0")],
  ['the manager\'s screen names the reminder in plain words',
    control.includes("a.type === 'DELAY_ESCALATED'") && /Напоминание/.test(control)],

  // ----------------------------------------------------------------- D. WHAT MUST NOT HAVE CHANGED
  ['this stage changed nothing outside the kitchen\'s own tables',
    /ALTER TABLE "(kds_item_tasks|kitchen_thresholds)"/.test(migration) &&
    !/ALTER TABLE "(orders|order_items|payments|menu_items|recipes|inventory_items)"/.test(migration) &&
    !/DROP (TABLE|COLUMN)|ALTER COLUMN/i.test(migrationSql)],
  ['pacing advises the kitchen and never blocks a station',
    !/serve_together[\s\S]{0,200}(403|FORBIDDEN|INVALID_STATE|cannot start)/i.test(routesCode)],
  ['nothing here writes money, a recipe or a stock movement',
    !/(INSERT INTO|UPDATE)\s+(payments|order_bills|recipes|stock_movements|inventory_items)/i.test(engineCode + routesCode)],
  ['every change is still written to the existing audit log, with its scope',
    routes.includes("action: 'KITCHEN_THRESHOLDS_UPDATED'") && routes.includes('category_id: categoryId')],
  ['the stage report exists', fs.existsSync('docs/STAGE-43-KITCHEN-COORDINATION-REPORT.md')],
  ['the runtime proof exists', fs.existsSync('tests/stage43_kitchen_coordination_e2e.mjs')],
];

let ok = 0;
for (const [name, v] of checks) { console.log(`${v ? 'PASS' : 'FAIL'} ${name}`); if (v) ok++; }
console.log(`${ok}/${checks.length} PASS`);
if (ok !== checks.length) process.exit(1);
