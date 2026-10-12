// BOOM OS -- Stage 43 runtime proof: serving an order together, delay limits per dish category,
// and escalation reminders that repeat.
//
// Real HTTP against a freshly migrated database. Every refusal expected here is one the SERVER makes.
const BASE = 'http://127.0.0.1:3000';
let pass = 0, fail = 0;
const ok = (n, c, d = '') => { if (c) { pass++; console.log(`PASS ${n}${d ? ' -> ' + d : ''}`); } else { fail++; console.log(`FAIL ${n} -> ${d}`); } };
const req = async (path, { method = 'GET', token, waiter, body, idem } = {}) => {
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  if (waiter) headers['X-Waiter-Session'] = waiter;
  if (idem) headers['Idempotency-Key'] = idem;
  const r = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, data: await r.json().catch(() => null) };
};
const must = async (p, o, what) => { const r = await req(p, o); if (r.status >= 300) { console.error(`SETUP FAILED ${what}: ${r.status} ${JSON.stringify(r.data)}`); process.exit(1); } return r.data; };
const minutes = iso => (new Date(iso).getTime() - Date.now()) / 60000;

const stamp = Date.now();
const ownerEmail = `k43owner-${stamp}@boom.local`;
await must('/api/auth/bootstrap', { method: 'POST', body: { full_name: 'K43 Owner', email: ownerEmail, password: 'BoomStage43Owner!' } }, 'bootstrap');
const T = (await must('/api/auth/login', { method: 'POST', body: { login: ownerEmail, password: 'BoomStage43Owner!' } }, 'login')).token;
const fr = await must('/api/franchises', { method: 'POST', token: T, body: { name: 'K43', code: 'K43F', legal_name: 'K43 LLC', contact_name: 'x', phone: '+99312450001', email: `k43-${stamp}@boom.local`, address: 'x' } }, 'franchise');
const B = (await must('/api/branches', { method: 'POST', token: T, body: { name: 'K43 Branch', code: 'K43B', address: 'x', phone: '+99312450002', franchise_id: fr.franchise.id } }, 'branch')).branch.id;
const steaks = (await must('/api/menu/categories', { method: 'POST', token: T, body: { branch_id: B, name_ru: 'Стейки', name_tk: 'Steýkler' } }, 'steaks')).category;
const drinks = (await must('/api/menu/categories', { method: 'POST', token: T, body: { branch_id: B, name_ru: 'Напитки', name_tk: 'Içgiler' } }, 'drinks')).category;
const mk = async (sku, ru, tk, price, cat) => (await must('/api/menu/items', { method: 'POST', token: T, body: { branch_id: B, category_id: cat, sku, name_ru: ru, name_tk: tk, price } }, 'item ' + sku)).item;
const steak = await mk('K43-STEAK', 'Стейк', 'Steýk', '180.00', steaks.id);
const cola = await mk('K43-COLA', 'Кола', 'Kola', '12.00', drinks.id);
const area = (await must('/api/tables/areas', { method: 'POST', token: T, body: { branch_id: B, name: 'Зал', sort_order: 0 } }, 'area')).area;
const table = (await must('/api/tables', { method: 'POST', token: T, body: { branch_id: B, area_id: area.id, code: 'T7', seats: 2 } }, 'table')).table;
const mkUser = async (label, email, roles, pwd) => {
  const u = await must('/api/users', { method: 'POST', token: T, body: { full_name: label, email, phone: '+9931245' + Math.floor(1000 + Math.random() * 8999), password: pwd, branch_id: B, roles, allowed_branches: [B] } }, 'user ' + email);
  const l = await must('/api/auth/login', { method: 'POST', body: { login: email, password: pwd } }, 'login ' + email);
  return { id: u.user.id, token: l.token };
};
const manager = await mkUser('K43 Manager', `k43mgr-${stamp}@boom.local`, ['BRANCH_MANAGER'], 'K43MgrPass12345!');
const cook = await mkUser('K43 Cook', `k43cook-${stamp}@boom.local`, ['KITCHEN'], 'K43CookPass1234!');
const waiter = await mkUser('K43 Waiter', `k43wait-${stamp}@boom.local`, ['WAITER'], 'K43WaitPass1234!');
await must(`/api/waiters/${waiter.id}/code`, { method: 'POST', token: T, body: { code: '4343' } }, 'waiter code');
const WS = (await must('/api/waiters/authenticate-code', { method: 'POST', body: { code: '4343', deviceId: `k43-${stamp}` } }, 'device')).session.token;
const stations = (await must(`/api/kitchen/stations?branch_id=${B}`, { token: T }, 'stations')).stations;
const byCode = Object.fromEntries(stations.map(s => [s.code, s]));
// A steak takes 20 minutes on the grill, a cola one minute at the bar: the whole point of pacing.
await must(`/api/kitchen/routes/items/${steak.id}`, { method: 'PUT', token: T, body: { routes: [{ station_id: byCode.GRILL.id, standard_minutes: 20, tolerance_minutes: 3 }] } }, 'steak route');
await must(`/api/kitchen/routes/items/${cola.id}`, { method: 'PUT', token: T, body: { routes: [{ station_id: byCode.BAR.id, standard_minutes: 1, tolerance_minutes: 1 }] } }, 'cola route');

// ================================================================= A. SERVE THE ORDER TOGETHER
const order = (await must('/api/orders', { method: 'POST', waiter: WS, idem: `k43-${stamp}`, body: {
  order_type: 'DINE_IN', table_id: table.id, items: [{ menu_item_id: steak.id, quantity: 1 }, { menu_item_id: cola.id, quantity: 1 }],
} }, 'order')).order;
await must(`/api/orders/${order.id}/confirm`, { method: 'POST', token: manager.token }, 'confirm');
const barBefore = (await must(`/api/kitchen/queue?branch_id=${B}&station_id=${byCode.BAR.id}`, { token: cook.token }, 'bar before')).tasks[0];
const grillBefore = (await must(`/api/kitchen/queue?branch_id=${B}&station_id=${byCode.GRILL.id}`, { token: cook.token }, 'grill before')).tasks[0];
ok('A1. without the note each station races on its own: the drink is due long before the steak',
  minutes(barBefore.forecast_ready_at) < 3 && minutes(grillBefore.forecast_ready_at) > 15 && barBefore.serve_together === false,
  `кола ~${Math.round(minutes(barBefore.forecast_ready_at))} мин, стейк ~${Math.round(minutes(grillBefore.forecast_ready_at))} мин`);

const note = await must('/api/kitchen/comments', { method: 'POST', waiter: WS, body: { order_id: order.id, kind: 'SERVE_TOGETHER' } }, 'serve-together note');
ok('A2. the waiter declares it with the SAME note mechanism, not a new field on the order', note.comment.kind === 'SERVE_TOGETHER');
const barAfter = (await must(`/api/kitchen/queue?branch_id=${B}&station_id=${byCode.BAR.id}`, { token: cook.token }, 'bar after')).tasks[0];
const grillAfter = (await must(`/api/kitchen/queue?branch_id=${B}&station_id=${byCode.GRILL.id}`, { token: cook.token }, 'grill after')).tasks[0];
ok('A3. the note becomes a planning fact on every task of that order', barAfter.serve_together === true && grillAfter.serve_together === true);
// Read every task of the order in ONE call: two separate queue reads are taken moments apart, and
// each read legitimately refreshes the forecast, so comparing across them proves nothing.
const pacedBoard = (await must(`/api/kitchen/expo?branch_id=${B}`, { token: manager.token }, 'paced board')).orders.find(o => o.order_id === order.id);
const pacedTargets = new Set(pacedBoard.items.map(i => i.coordinated_ready_at));
ok('A4. both stations are paced to ONE shared target -- the slowest of them',
  pacedTargets.size === 1 && minutes([...pacedTargets][0]) > 15,
  `${pacedTargets.size} ориентир(а) на заказ, ~${Math.round(minutes([...pacedTargets][0]))} мин`);
ok('A5. so the bar is told to START LATER instead of pouring a drink that would stand 20 minutes',
  minutes(barAfter.forecast_start_at) > 10, `бар начинает через ~${Math.round(minutes(barAfter.forecast_start_at))} мин`);
ok('A6. the slow station is not delayed by the pacing', Math.abs(minutes(grillAfter.forecast_start_at)) < 2, `гриль начинает сразу (${Math.round(minutes(grillAfter.forecast_start_at))} мин)`);
ok('A7. the station\'s own estimate is kept separate from the shared target',
  barAfter.forecast_ready_at !== barAfter.coordinated_ready_at && minutes(barAfter.forecast_ready_at) < 3,
  `оценка бара ~${Math.round(minutes(barAfter.forecast_ready_at))} мин, ориентир ~${Math.round(minutes(barAfter.coordinated_ready_at))} мин`);
const expoBoard = (await must(`/api/kitchen/expo?branch_id=${B}`, { token: manager.token }, 'expo')).orders.find(o => o.order_id === order.id);
ok('A8. the pass is told the order must leave together', expoBoard.serve_together === true && Boolean(expoBoard.coordinated_ready_at));
const orderAfterNote = (await must(`/api/orders/${order.id}`, { token: manager.token }, 'order')).order;
ok('A9. and pacing changed nothing about the order itself',
  Number(orderAfterNote.final_amount) === Number(order.final_amount) && orderAfterNote.status === 'CONFIRMED',
  `${orderAfterNote.final_amount} = ${order.final_amount}, статус ${orderAfterNote.status}`);
// a cook starting the drink anyway is not blocked -- the forecast advises, it does not police
const startEarly = await req(`/api/kitchen/tasks/${barAfter.id}/status`, { method: 'POST', token: cook.token, body: { status: 'IN_PROGRESS' } });
ok('A10. pacing advises the kitchen, it does not lock a station out', startEarly.status === 200, `HTTP ${startEarly.status}`);

// ============================================================ B. DELAY LIMITS PER DISH CATEGORY
await must('/api/kitchen/thresholds', { method: 'PUT', token: manager.token, body: { branch_id: B, warning_ratio: 0.8, late_ratio: 1, critical_ratio: 1.5, escalate_minutes: 5 } }, 'branch limits');
await must('/api/kitchen/thresholds', { method: 'PUT', token: manager.token, body: { branch_id: B, category_id: steaks.id, warning_ratio: 1.5, late_ratio: 2, critical_ratio: 3, escalate_minutes: 10 } }, 'steak limits');
const limits = (await must(`/api/kitchen/thresholds?branch_id=${B}`, { token: manager.token }, 'limits')).thresholds;
const steakLimit = limits.find(t => t.category_id === steaks.id);
ok('B1. a limit can be set for a whole dish category, alongside the branch default',
  Boolean(steakLimit) && Number(steakLimit.late_ratio) === 2 && limits.some(t => !t.category_id && !t.station_id),
  `категория «Стейки»: задержка ×${Number(steakLimit?.late_ratio)}, филиал ×${Number(limits.find(t => !t.category_id && !t.station_id)?.late_ratio)}`);
ok('B2. and it names its scope, so a screen can show what is configured where',
  steakLimit.category_name_ru === 'Стейки', steakLimit.category_name_ru);
const foreignCategory = await req('/api/kitchen/thresholds', { method: 'PUT', token: manager.token, body: { branch_id: B, category_id: 'mc_does_not_exist', warning_ratio: 1, late_ratio: 1, critical_ratio: 1 } });
ok('B3. NEGATIVE: a category that is not in this branch is refused', foreignCategory.status === 400 && foreignCategory.data.code === 'CATEGORY_NOT_IN_BRANCH', `HTTP ${foreignCategory.status} ${foreignCategory.data?.code}`);
const badOrder = await req('/api/kitchen/thresholds', { method: 'PUT', token: manager.token, body: { branch_id: B, category_id: drinks.id, warning_ratio: 2, late_ratio: 1, critical_ratio: 1 } });
ok('B4. NEGATIVE: a warning limit above the delay limit is refused', badOrder.status === 400 && badOrder.data.code === 'INVALID_THRESHOLDS', `HTTP ${badOrder.status} ${badOrder.data?.code}`);
// A limit the column could not keep would be stored as 0.00, which silently means "late from the
// first second". The server refuses it rather than saving something it cannot hold.
const unstorable = await req('/api/kitchen/thresholds', { method: 'PUT', token: manager.token, body: { branch_id: B, warning_ratio: 0.004, late_ratio: 0.004, critical_ratio: 0.006, escalate_minutes: 1 } });
ok('B4b. NEGATIVE: a limit too small for the stored precision is refused, not rounded to zero',
  unstorable.status === 400 && unstorable.data.code === 'INVALID_THRESHOLDS', `HTTP ${unstorable.status} ${unstorable.data?.code}`);
const branchNow = (await must(`/api/kitchen/load?branch_id=${B}`, { token: manager.token }, 'load after refusal')).thresholds;
ok('B4c. and the limit in force is still a real number, never zero', Number(branchNow.late_ratio) >= 0.1, `×${Number(branchNow.late_ratio)}`);

// The drink has no category row, so it falls back to the strict BRANCH default; the steak has its
// own category row with ordinary limits. Seconds after the order is placed only the drink can be
// late -- which is exactly what a category limit is for.
await must('/api/kitchen/thresholds', { method: 'PUT', token: manager.token, body: { branch_id: B, warning_ratio: 0.1, late_ratio: 0.1, critical_ratio: 0.1, escalate_minutes: 1 } }, 'strict branch limits');
await must('/api/kitchen/thresholds', { method: 'PUT', token: manager.token, body: { branch_id: B, category_id: steaks.id, warning_ratio: 0.8, late_ratio: 1, critical_ratio: 1.5, escalate_minutes: 10 } }, 'ordinary steak limits');
await new Promise(r => setTimeout(r, 9000));
const barLate = (await must(`/api/kitchen/queue?branch_id=${B}&station_id=${byCode.BAR.id}`, { token: cook.token }, 'bar late')).tasks[0];
const grillCalm = (await must(`/api/kitchen/queue?branch_id=${B}&station_id=${byCode.GRILL.id}`, { token: cook.token }, 'grill calm')).tasks[0];
ok('B5. the category limit really governs: the steak is calm while the drink is late',
  ['LATE', 'CRITICAL'].includes(barLate.delay_state) && grillCalm.delay_state === 'NONE',
  `кола=${barLate.delay_state}, стейк=${grillCalm.delay_state}`);

// ==================================================================== C. ESCALATION REMINDERS
// escalate_minutes is measured in MINUTES of unresolved critical delay, so this section genuinely
// waits them out rather than faking a timestamp. The drink is already critical from section B.
const ESCALATE_WAIT_MS = 66_000;
await new Promise(r => setTimeout(r, ESCALATE_WAIT_MS));
await must(`/api/kitchen/queue?branch_id=${B}&station_id=${byCode.BAR.id}`, { token: cook.token }, 'bar after a minute');
const alerts1 = (await must(`/api/kitchen/alerts?branch_id=${B}`, { token: manager.token }, 'alerts')).alerts;
const firstEscalations = alerts1.filter(a => a.type === 'DELAY_ESCALATED' && a.task_id === barLate.id);
ok('C1. a critical delay nobody resolved produces an escalation reminder, not just one alert',
  firstEscalations.length >= 1 && firstEscalations[0].audience === 'BRANCH_MANAGER' && firstEscalations[0].severity === 'CRITICAL',
  `${firstEscalations.length} напоминание(й), адресат ${firstEscalations[0]?.audience}`);
ok('C2. each reminder says which round it is, so a manager sees it getting worse',
  firstEscalations.every(a => /^round \d+$/.test(a.reason)), firstEscalations.map(a => a.reason).join(','));
for (let i = 0; i < 3; i++) await must(`/api/kitchen/queue?branch_id=${B}&station_id=${byCode.BAR.id}`, { token: cook.token }, 'bar re-read');
const sameRound = (await must(`/api/kitchen/alerts?branch_id=${B}`, { token: manager.token }, 'alerts again')).alerts
  .filter(a => a.type === 'DELAY_ESCALATED' && a.task_id === barLate.id);
ok('C3. re-reading the screen three times does NOT repeat the same reminder',
  sameRound.length === firstEscalations.length, `${firstEscalations.length} -> ${sameRound.length}`);
await new Promise(r => setTimeout(r, ESCALATE_WAIT_MS));
await must(`/api/kitchen/queue?branch_id=${B}&station_id=${byCode.BAR.id}`, { token: cook.token }, 'bar later');
const laterRounds = (await must(`/api/kitchen/alerts?branch_id=${B}`, { token: manager.token }, 'alerts later')).alerts
  .filter(a => a.type === 'DELAY_ESCALATED' && a.task_id === barLate.id);
ok('C4. but once another escalate_minutes has passed, the NEXT round does fire',
  laterRounds.length > sameRound.length,
  `${sameRound.length} -> ${laterRounds.length} (${laterRounds.map(a => a.reason).join(', ')})`);
const resolvedRound = laterRounds[0];
await must(`/api/kitchen/alerts/${resolvedRound.id}/ack`, { method: 'POST', token: manager.token, body: { resolution: 'Бар поставил напиток заново' } }, 'ack');
const openAlerts = (await must(`/api/kitchen/alerts?branch_id=${B}`, { token: manager.token }, 'open alerts')).alerts;
ok('C5. acknowledging one round clears it from the open list and keeps the decision', !openAlerts.some(a => a.id === resolvedRound.id));
await must(`/api/kitchen/tasks/${barLate.id}/status`, { method: 'POST', token: cook.token, body: { status: 'READY' } }, 'bar ready');
const beforeFinish = (await must(`/api/kitchen/alerts?branch_id=${B}&status=ALL`, { token: manager.token }, 'all alerts')).alerts.filter(a => a.type === 'DELAY_ESCALATED').length;
await new Promise(r => setTimeout(r, ESCALATE_WAIT_MS));
for (let i = 0; i < 2; i++) await must(`/api/kitchen/queue?branch_id=${B}&station_id=${byCode.BAR.id}`, { token: cook.token }, 'bar after ready');
const afterFinish = (await must(`/api/kitchen/alerts?branch_id=${B}&status=ALL`, { token: manager.token }, 'all alerts again')).alerts.filter(a => a.type === 'DELAY_ESCALATED').length;
ok('C6. a finished item stops reminding anyone', afterFinish === beforeFinish, `${beforeFinish} -> ${afterFinish}`);

// ===================================================== D. NOTHING ELSE MOVED (SPOT REGRESSION)
const load = (await must(`/api/kitchen/load?branch_id=${B}`, { token: manager.token }, 'load'));
ok('D1. the load screen still answers, with the branch limits it is actually using',
  Array.isArray(load.stations) && load.thresholds && Number(load.thresholds.late_ratio) > 0, `×${Number(load.thresholds.late_ratio)}`);
const audit = (await must(`/api/audit?branch_id=${B}&limit=200`, { token: T }, 'audit')).logs || [];
const kitchenAudit = audit.filter(a => a.action === 'KITCHEN_THRESHOLDS_UPDATED');
ok('D2. every limit change is in the existing audit log, with its scope',
  kitchenAudit.length >= 4 && kitchenAudit.some(a => {
    const v = typeof a.new_values === 'string' ? JSON.parse(a.new_values || '{}') : (a.new_values || {});
    return v.category_id === steaks.id;
  }),
  `${kitchenAudit.length} записей`);
const cookLimits = await req('/api/kitchen/thresholds', { method: 'PUT', token: cook.token, body: { branch_id: B, warning_ratio: 1, late_ratio: 1, critical_ratio: 1 } });
ok('D3. NEGATIVE: a cook still cannot change the delay limits', cookLimits.status === 403, `HTTP ${cookLimits.status}`);

console.log(`\n${pass}/${pass + fail} Stage 43 runtime checks passed`);
if (fail) process.exit(1);
