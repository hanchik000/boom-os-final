// BOOM OS -- Stage 42: Smart Kitchen. Source guards for the architecture this stage is defined by.
//
// The behavioural proof is tests/stage42_kitchen_flow_e2e.mjs. These checks guard the rules that a
// future change could quietly break: routing is configured and never guessed, the forecast is
// arithmetic over measured facts, an order's status is never spoken for by one station, notifications
// cannot duplicate, and no part of the kitchen writes money, recipes or stock.
import fs from 'node:fs';
const read = p => fs.readFileSync(p, 'utf8');

const engine = read('server/kitchen.ts');
const routes = read('server/routes/kitchen.ts');
const migration = read('prisma/migrations/20260926000000_stage42_kitchen_flow/migration.sql');
const schema = read('prisma/schema.prisma');
const orders = read('server/routes/orders.ts');
const seed = read('server/seed.ts');
const serverTs = read('server.ts');
const api = read('src/api.ts');
const station = read('src/components/KitchenStationView.tsx');
const expo = read('src/components/ExpoView.tsx');
const control = read('src/components/KitchenControlView.tsx');
const dishEditor = read('src/components/MenuDishEditor.tsx');
const waiter = read('src/components/WaiterPOSView.tsx');
const css = read('src/design-system/kitchen.css');
const sidebar = read('src/components/Sidebar.tsx');
const app = read('src/App.tsx');
const ru = read('src/translations/ru.ts');
const tk = read('src/translations/tk.ts');

// A guard reads what RUNS: the comments in these files discuss the very things the rules forbid
// (that this is not AI, that a note is not a price change), so they are stripped before scanning.
const stripComments = src => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '')
  .replace(/^\s*\*.*$/gm, '')
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
const engineCode = stripComments(engine), routesCode = stripComments(routes);
const uiCode = stripComments(station + expo + control);

const checks = [
  // ----------------------------------------------------------------- A. ONE ORDER CORE, EXTENDED
  ['the kitchen is a layer on Order Core, not a second order system',
    /kds_item_tasks/.test(migration) && /order_item_id.*REFERENCES "order_items"/s.test(migration) &&
    !/CREATE TABLE "orders/.test(migration) && !/ALTER TABLE "orders"/.test(migration)],
  ['every kitchen task belongs to one real order line',
    /"order_id".*NOT NULL/s.test(migration) && /"order_item_id".*NOT NULL/s.test(migration) &&
    engine.includes('kds_item_tasks_item_station_key') === false && migration.includes('kds_item_tasks_item_station_key')],
  ['the existing per-order KDS ticket is untouched and still maintained',
    !/DROP TABLE "kds_tickets"|ALTER TABLE "kds_tickets"/.test(migration) && engine.includes('UPDATE kds_tickets SET status=?')],
  ['nothing in the kitchen writes money, a recipe or a stock movement',
    !/(INSERT INTO|UPDATE)\s+(payments|order_bills|recipes|recipe_ingredients|stock_movements|inventory_items|credit_|boomcoin|boomback)/i.test(engineCode + routesCode) &&
    !/final_amount\s*=|subtotal\s*=|price_snapshot\s*=/.test(engineCode + routesCode)],
  ['the migration is additive: no table dropped, no column retyped',
    !/DROP (TABLE|COLUMN)|ALTER COLUMN/i.test(migration)],
  ['every new table carries its branch, its timestamps and its indexes',
    ['kitchen_stations','kds_item_tasks','kitchen_comments','kitchen_alerts','expo_handovers','kitchen_thresholds']
      .every(t => new RegExp(`CREATE TABLE "${t}"[\\s\\S]*?"branch_id" *TEXT NOT NULL`).test(migration)) &&
    (migration.match(/CREATE INDEX/g) || []).length >= 10],
  ['the Prisma schema and the migration describe the same tables',
    ['KitchenStation','KitchenItemRoute','KitchenCategoryRoute','KdsItemTask','KitchenThreshold','KitchenComment','KitchenAlert','ExpoHandover']
      .every(m => new RegExp(`^model ${m} \\{`, 'm').test(schema))],

  // --------------------------------------------------------------------- B. ROUTING, NOT GUESSING
  ['stations are rows a branch configures, not constants in the business logic',
    engine.includes('export const DEFAULT_STATIONS') && engine.includes('ensureBranchStations') &&
    routes.includes("router.post('/stations'") && routes.includes("router.patch('/stations/:id'")],
  ['a station is routed from configuration: the dish first, then its category',
    /FROM menu_item_routes/.test(engine) && /FROM menu_category_routes/.test(engine) &&
    engine.includes('if (own.length) return own;')],
  // The two functions that decide WHERE an item goes are read on their own: they may mention a
  // station only as a configured row id, never a dish word and never a station code literal.
  ['nothing infers a station from a dish NAME',
    (() => {
      const routing = (engineCode.match(/async function routesForItem[\s\S]*?\n\}/) || [''])[0]
        + (engineCode.match(/export async function routeOrderTasks[\s\S]*?\n\}/) || [''])[0];
      if (!routing.includes('menu_item_routes') || !routing.includes('menu_category_routes')) return false;
      return !/(burger|бургер|fries|картоф|salad|салат|cola|кола|pizza|пицца|name_ru|name_tk|title_snapshot\s*(\.|=~|match|includes))/i.test(routing)
        && !/'(GRILL|FRY|COLD|BAR|EXPO)'/.test(routing);
    })()],
  ['an unrouted item goes to a visible "needs assignment" queue instead of a guess',
    engine.includes('station_id,menu_item_id,title_snapshot,quantity,is_secondary,status,standard_minutes,tolerance_minutes,created_at,updated_at)\n         VALUES (?,?,?,?,NULL') &&
    routes.includes("unassigned = req.query.station_id === 'UNASSIGNED'") && station.includes('kt-station-unassigned')],
  ['a modifier backed by a real dish can add a step on another station',
    engine.includes('source_menu_item_id IS NOT NULL') && engine.includes('is_secondary: true')],
  ['the handover station never receives cooking work',
    engine.includes('s.is_expo=false') && routes.includes("code: 'EXPO_IS_NOT_A_COOKING_STATION'")],
  ['routing happens on the server when the order is confirmed',
    orders.includes('await routeOrderTasks(tx,{id:o.id,branch_id:o.branch_id})') && orders.includes("requirePermission('orders.confirm')")],

  // ---------------------------------------------------------------------------- C. THE FORECAST
  ['the forecast is the queue ahead divided by what the station can cook at once',
    engine.includes('parallel_capacity') && engine.includes('workAheadMinutes += exp.minutes / capacity')],
  ['it learns from measured facts, and only from genuinely cooked items',
    engine.includes("t.started_at IS NOT NULL AND t.ready_at IS NOT NULL") &&
    engine.includes("o.status NOT IN ('CANCELLED','VOID')")],
  ['it uses the median, so one forgotten ticket cannot distort it',
    engine.includes('perUnit.sort((a, b) => a - b)') && engine.includes('const median =')],
  ['with too little history it says so instead of inventing precision',
    engine.includes("confidence: 'PRELIMINARY'") && engine.includes('MEASURED_MIN_SAMPLES') && engine.includes('ESTIMATE_MIN_SAMPLES') &&
    station.includes('предварительно')],
  ['the norm, the forecast and the fact are separate columns',
    /"standard_minutes" *DECIMAL/.test(migration) && /"expected_minutes" *DECIMAL/.test(migration) &&
    /"forecast_ready_at" *TEXT/.test(migration) && /"ready_at" *TEXT/.test(migration)],
  ['nothing calls this arithmetic artificial intelligence',
    !/\b(AI|artificial intelligence|machine learning|ML model|neural)\b/i.test(engineCode + routesCode + uiCode)],

  // ------------------------------------------------------- D. PER-ITEM STATUS, AGGREGATED SAFELY
  ['only the listed transitions are possible, and they are checked server-side',
    engine.includes('export const TASK_TRANSITIONS') && routes.includes('TASK_TRANSITIONS[task.status]') &&
    routes.includes("code: 'KITCHEN_INVALID_TRANSITION'")],
  ['an order is ready only when every live task is ready',
    engine.includes("if (live.every(t => t.status === 'READY' || t.status === 'SERVED')) return 'READY';")],
  ['and a station finishing its own part cannot make the order look untouched',
    /live.some\(t => t.status === 'ACCEPTED' \|\| t.status === 'IN_PROGRESS' \|\| t.status === 'READY' \|\| t.status === 'SERVED'\)\) return 'PREPARING'/.test(engine)],
  ['the kitchen never moves an order that is paid, cancelled or closed',
    engine.includes("const KITCHEN_MOVABLE_ORDER_STATUSES = ['CONFIRMED', 'PREPARING', 'READY']")],
  ['concurrent updates cannot both win',
    routes.includes('SELECT * FROM kds_item_tasks WHERE id=? FOR UPDATE') &&
    routes.includes('WHERE id=? AND status=?') && routes.includes("code: 'KITCHEN_TASK_CHANGED'")],

  // ------------------------------------------------------------------ E. DELAYS AND NOTIFICATIONS
  ['delay limits are configured as ratios of the expected time, with a branch default',
    /CREATE TABLE "kitchen_thresholds"/.test(migration) && engine.includes('export async function thresholdsFor') &&
    engine.includes('const DEFAULT_THRESHOLDS')],
  ['a notification can only exist once per event',
    /CREATE UNIQUE INDEX "kitchen_alerts_dedupe_key"/.test(migration) &&
    engine.includes('ON CONFLICT (dedupe_key) DO NOTHING') && engine.includes('dedupeKey: `delay:${task.id}:${state}`')],
  ['a critical delay reaches the branch manager; a warning stays in the kitchen',
    engine.includes("const audience = state === 'CRITICAL' ? 'BRANCH_MANAGER' : 'KITCHEN'")],
  ['a notification can be acknowledged with what was actually done',
    routes.includes("router.post('/alerts/:id/ack'") && /"resolution" *TEXT/.test(migration) &&
    routes.includes("requirePermission('kitchen.alerts.resolve')")],
  ['a station can ask for help, from a closed list of reasons',
    engine.includes('export const HELP_REASONS') && routes.includes("'INVALID_HELP_REASON'") &&
    routes.includes('(HELP_REASONS as readonly string[]).includes(reason)')],

  // ------------------------------------------------------------------------ F. NOTES FROM THE FLOOR
  ['a note is a message: it has no price, quantity or recipe anywhere near it',
    /CREATE TABLE "kitchen_comments"/.test(migration) &&
    !/price|amount|quantity|recipe/i.test((migration.match(/CREATE TABLE "kitchen_comments"[\s\S]*?\);/) || [''])[0])],
  ['the waiter device can send one over its own session, like every other POS call',
    api.includes("sendWaiterKitchenComment") && api.includes("waiterRequest<{ comment:any; after_start:boolean }>('/api/kitchen/comments'") &&
    waiter.includes('sendWaiterKitchenComment')],
  ['a note that arrives after cooking started is flagged and the kitchen is told',
    routes.includes('const afterStart = num(started?.n, 0) > 0;') && routes.includes("type: 'COMMENT_AFTER_START'") &&
    station.includes('пришло после начала готовки')],
  ['the quick notes are the ones the stage asked for',
    ['NO_ONION','NO_SAUCE','NOT_SPICY','ALLERGY_CHECK','GUEST_WAITING','SERVE_TOGETHER','URGENT','FREE_TEXT'].every(k => engine.includes(`'${k}'`))],

  // ------------------------------------------------------------------------------------- G. EXPO
  ['the pass sees the whole order with every station\'s part of it',
    routes.includes("router.get('/expo'") && routes.includes('all_ready') && expo.includes('kt-expo-line')],
  ['an incomplete order cannot be passed off as ready',
    routes.includes("code: 'ORDER_NOT_FULLY_READY'") && routes.includes("code: 'EXPO_OVERRIDE_FORBIDDEN'")],
  ['releasing one anyway needs a named authority, a reason, and is recorded as exactly that',
    routes.includes("permissions.includes('kitchen.expo.override')") && routes.includes("kind = missing.length ? 'INCOMPLETE_OVERRIDE' : 'HANDED_OVER'") &&
    routes.includes("action: kind === 'HANDED_OVER' ? 'EXPO_ORDER_HANDED_OVER' : 'EXPO_ORDER_HANDED_OVER_INCOMPLETE'")],
  ['the same order cannot be handed over twice',
    routes.includes("code: 'ORDER_ALREADY_HANDED_OVER'")],
  ['an item can be sent back to its station, with a reason',
    routes.includes("router.post('/expo/:orderId/return-item'") && routes.includes("code: 'REASON_REQUIRED'")],
  ['handover does not touch payment, refunds or closing the order',
    !/payments|refund|closure/i.test((routes.match(/router\.post\('\/expo\/:orderId\/handover'[\s\S]*?^\}\);/m) || [''])[0])],

  // ---------------------------------------------------------------- H. PERMISSIONS AND ISOLATION
  ['the new permissions exist and are granted by role, not by hiding buttons',
    ['kitchen.stations.view','kitchen.stations.manage','kitchen.tasks.reassign','kitchen.help.request','kitchen.alerts.view',
     'kitchen.alerts.resolve','kitchen.comments.create','kitchen.expo.view','kitchen.expo.handover','kitchen.expo.override',
     'kitchen.thresholds.manage'].every(c => seed.includes(`'${c}'`)) && seed.includes('KITCHEN_MANAGER_PERMS')],
  ['a cook cannot release an incomplete order and cannot reassign stations',
    !/grant\(roleKitchen\?\.id, \[[^\]]*kitchen\.expo\.override/.test(seed) &&
    !/grant\(roleKitchen\?\.id, \[[^\]]*kitchen\.tasks\.reassign/.test(seed)],
  ['every kitchen route demands a permission and checks the branch',
    (routes.match(/requirePermission\(/g) || []).length >= 15 && routes.includes('function scopeBranch') &&
    (routes.match(/BRANCH_ACCESS_DENIED/g) || []).length >= 8],
  ['every kitchen decision is written to the EXISTING audit log',
    routes.includes("import { authenticateToken, requirePermission, insertAuditLog } from '../auth';") &&
    (routes.match(/insertAuditLog\(/g) || []).length >= 10 && !/CREATE TABLE "kitchen_audit/.test(migration)],
  ['the kitchen router is mounted once, next to the existing one',
    (serverTs.match(/app\.use\('\/api\/kitchen'/g) || []).length === 1 && serverTs.includes("app.use('/api/kds', kdsRouter);")],

  // ------------------------------------------------------------------------------------ I. THE UI
  ['the kitchen screens have their own layer, not the admin table density',
    fs.existsSync('src/design-system/kitchen.css') && css.includes('.kt-btn') && /min-height: 48px/.test(css) &&
    read('src/main.tsx').includes('kitchen.css')],
  ['their buttons grow on a touch screen and respect reduced motion',
    /@media \(pointer: coarse\)[\s\S]*?min-height: 56px/.test(css) && /prefers-reduced-motion: reduce/.test(css) &&
    station.includes('boom-reduced-motion-safe') && expo.includes('boom-reduced-motion-safe')],
  ['the station screen shows the four queues the stage asked for',
    ['QUEUED','ACCEPTED','IN_PROGRESS','READY'].every(k => station.includes(`'${k}'`)) && station.includes('kt-board')],
  ['it offers accept, start, ready, report a problem and ask for help',
    ['Принять','Начать','Готово','Проблема','нужна помощь'].every(w => station.includes(w))],
  ['no screen computes a time, a load or a delay of its own',
    !/expected_minutes\s*=|forecast_ready_at\s*=\s*new Date|delay_state\s*=\s*'/.test(uiCode)],
  ['the dish editor is where a station and its standard time are configured',
    dishEditor.includes("section === 'kitchen'") && dishEditor.includes('setKitchenItemRoutes') && dishEditor.includes('Цех и нормативное время')],
  ['the kitchen screens are reachable from the existing navigation, by permission',
    sidebar.includes("{ id: 'kitchen', key: 'nav.kitchen'") && sidebar.includes("permission: 'kitchen.expo.view'") &&
    app.includes("currentTab === 'kitchen' && <KitchenStationView />") && app.includes("currentTab === 'expo' && <ExpoView />")],
  ['and they are named in both languages, like every other screen',
    ['nav.kitchen','nav.expo','nav.kitchenLoad'].every(k => ru.includes(`"${k}"`) && tk.includes(`"${k}"`))],
  ['the load screen reports work in minutes, not a count of orders',
    control.includes('remaining_minutes') && control.includes('within_norm_share') && control.includes('bottleneck_items') &&
    routes.includes('throughput_per_hour')],
  ['the stage report exists', fs.existsSync('docs/STAGE-42-SMART-KITCHEN-REPORT.md')],
  ['the runtime proof exists', fs.existsSync('tests/stage42_kitchen_flow_e2e.mjs')],
];

let ok = 0;
for (const [name, v] of checks) { console.log(`${v ? 'PASS' : 'FAIL'} ${name}`); if (v) ok++; }
console.log(`${ok}/${checks.length} PASS`);
if (ok !== checks.length) process.exit(1);
