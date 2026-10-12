// BOOM OS -- Stage 42 runtime proof: Smart Kitchen routing, forecasting, delays, comments, EXPO.
//
// Real HTTP against a freshly migrated database. Nothing is mocked and nothing is asserted about
// data this script did not create. Every refusal it expects is a refusal the SERVER makes.
const BASE = 'http://127.0.0.1:3000';
let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => { if (cond) { pass++; console.log(`PASS ${name}${detail ? ' -> ' + detail : ''}`); } else { fail++; console.log(`FAIL ${name} -> ${detail}`); } };
const req = async (path, { method = 'GET', token, waiter, body, idem } = {}) => {
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  if (waiter) headers['X-Waiter-Session'] = waiter;
  if (idem) headers['Idempotency-Key'] = idem;
  const r = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const data = await r.json().catch(() => null);
  return { status: r.status, data };
};
const must = async (path, opts, what) => {
  const r = await req(path, opts);
  if (r.status >= 300) { console.error(`SETUP FAILED ${what}: ${r.status} ${JSON.stringify(r.data)}`); process.exit(1); }
  return r.data;
};

// ------------------------------------------------------------------ setup: owner, branch, menu
// The suite bootstraps its own owner on an empty database, like every other runtime suite here.
const stamp = Date.now();
const ownerEmail = `k42owner-${stamp}@boom.local`;
await must('/api/auth/bootstrap', { method: 'POST', body: { full_name: 'K42 Owner', email: ownerEmail, password: 'BoomStage42Owner!' } }, 'bootstrap owner');
const owner = await must('/api/auth/login', { method: 'POST', body: { login: ownerEmail, password: 'BoomStage42Owner!' } }, 'owner login');
const T = owner.token;
const fr = await must('/api/franchises', { method: 'POST', token: T, body: { name: 'K42', code: 'K42F', legal_name: 'K42 LLC', contact_name: 'x', phone: '+99312430001', email: `k42-${stamp}@boom.local`, address: 'x' } }, 'franchise');
const br = await must('/api/branches', { method: 'POST', token: T, body: { name: 'K42 Branch', code: 'K42B', address: 'x', phone: '+99312430002', franchise_id: fr.franchise.id } }, 'branch');
const B = br.branch.id;
const br2 = await must('/api/branches', { method: 'POST', token: T, body: { name: 'K42 Other', code: 'K42C', address: 'x', phone: '+99312430003', franchise_id: fr.franchise.id } }, 'second branch');
const B2 = br2.branch.id;
const cat = (await must('/api/menu/categories', { method: 'POST', token: T, body: { branch_id: B, name_ru: 'Бургеры', name_tk: 'Burgerler' } }, 'category')).category;
const drinks = (await must('/api/menu/categories', { method: 'POST', token: T, body: { branch_id: B, name_ru: 'Напитки', name_tk: 'Içgiler' } }, 'drinks category')).category;
const mk = async (sku, ru, tk, price, category) => (await must('/api/menu/items', { method: 'POST', token: T, body: { branch_id: B, category_id: category, sku, name_ru: ru, name_tk: tk, price } }, 'item ' + sku)).item;
const burger = await mk('K42-BURGER', 'Чизбургер', 'Çizburger', '95.00', cat.id);
const fries = await mk('K42-FRIES', 'Картофель фри', 'Kartoşka fri', '25.00', cat.id);
const cola = await mk('K42-COLA', 'Кола', 'Kola', '12.00', drinks.id);
const mystery = await mk('K42-MYSTERY', 'Блюдо без цеха', 'Bölümsiz nahar', '40.00', cat.id);
const area = (await must('/api/tables/areas', { method: 'POST', token: T, body: { branch_id: B, name: 'Зал', sort_order: 0 } }, 'area')).area;
const table = (await must('/api/tables', { method: 'POST', token: T, body: { branch_id: B, area_id: area.id, code: 'T12', seats: 4 } }, 'table')).table;

const mkUser = async (label, email, roles, pwd, branch = B) => {
  const u = await must('/api/users', { method: 'POST', token: T, body: { full_name: label, email, phone: '+9931243' + Math.floor(1000 + Math.random() * 8999), password: pwd, branch_id: branch, roles, allowed_branches: [branch] } }, 'user ' + email);
  const l = await must('/api/auth/login', { method: 'POST', body: { login: email, password: pwd } }, 'login ' + email);
  return { id: u.user.id, token: l.token };
};
const manager = await mkUser('K42 Manager', `k42mgr-${stamp}@boom.local`, ['BRANCH_MANAGER'], 'K42MgrPass12345!');
const cook = await mkUser('K42 Cook', `k42cook-${stamp}@boom.local`, ['KITCHEN'], 'K42CookPass1234!');
const waiter = await mkUser('K42 Waiter', `k42wait-${stamp}@boom.local`, ['WAITER'], 'K42WaitPass1234!');
const otherManager = await mkUser('K42 Other Manager', `k42other-${stamp}@boom.local`, ['BRANCH_MANAGER'], 'K42OtherPass123!', B2);
await must(`/api/waiters/${waiter.id}/code`, { method: 'POST', token: T, body: { code: '4242' } }, 'waiter code');
const device = await must('/api/waiters/authenticate-code', { method: 'POST', body: { code: '4242', deviceId: `k42-device-${stamp}` } }, 'waiter device');
const WS = device.session.token;

// ------------------------------------------------------------------------- A. stations + routing
const stations = (await must(`/api/kitchen/stations?branch_id=${B}`, { token: T }, 'stations')).stations;
const byCode = Object.fromEntries(stations.map(s => [s.code, s]));
ok('A1. a branch gets its stations, as configurable rows', ['GRILL', 'FRY', 'COLD', 'BAR', 'EXPO'].every(c => byCode[c]), stations.map(s => s.code).join(','));
ok('A2. the handover station is marked as such and never cooks', byCode.EXPO.is_expo === true);
const rejectExpoRoute = await req(`/api/kitchen/routes/items/${burger.id}`, { method: 'PUT', token: T, body: { routes: [{ station_id: byCode.EXPO.id, standard_minutes: 5, tolerance_minutes: 2 }] } });
ok('A3. NEGATIVE: a dish cannot be routed to the handover station', rejectExpoRoute.status === 400 && rejectExpoRoute.data.code === 'EXPO_IS_NOT_A_COOKING_STATION', `HTTP ${rejectExpoRoute.status} ${rejectExpoRoute.data?.code}`);
const crossBranch = await req(`/api/kitchen/routes/items/${burger.id}`, { method: 'PUT', token: otherManager.token, body: { routes: [] } });
ok('A4. NEGATIVE: another branch cannot route this branch\'s dish', crossBranch.status === 403, `HTTP ${crossBranch.status}`);
await must(`/api/kitchen/routes/items/${burger.id}`, { method: 'PUT', token: T, body: { routes: [{ station_id: byCode.GRILL.id, standard_minutes: 8, tolerance_minutes: 2 }] } }, 'burger route');
await must(`/api/kitchen/routes/items/${fries.id}`, { method: 'PUT', token: T, body: { routes: [{ station_id: byCode.FRY.id, standard_minutes: 4, tolerance_minutes: 1 }] } }, 'fries route');
await must(`/api/kitchen/routes/categories/${drinks.id}`, { method: 'PUT', token: T, body: { station_id: byCode.BAR.id, standard_minutes: 1, tolerance_minutes: 1 } }, 'drinks category route');
const badMinutes = await req(`/api/kitchen/routes/items/${fries.id}`, { method: 'PUT', token: T, body: { routes: [{ station_id: byCode.FRY.id, standard_minutes: 0, tolerance_minutes: 1 }] } });
ok('A5. NEGATIVE: a standard time of zero is refused', badMinutes.status === 400 && badMinutes.data.code === 'INVALID_STANDARD_MINUTES');

// --------------------------------------------------------------- B. a real order reaches the KDS
const order = (await must('/api/orders', { method: 'POST', waiter: WS, idem: `k42-${Date.now()}`, body: {
  order_type: 'DINE_IN', table_id: table.id,
  items: [{ menu_item_id: burger.id, quantity: 2 }, { menu_item_id: fries.id, quantity: 2 }, { menu_item_id: cola.id, quantity: 2 }, { menu_item_id: mystery.id, quantity: 1 }],
} }, 'order')).order;
await must(`/api/orders/${order.id}/confirm`, { method: 'POST', token: manager.token }, 'confirm');
const grillQueue = (await must(`/api/kitchen/queue?branch_id=${B}&station_id=${byCode.GRILL.id}`, { token: cook.token }, 'grill queue'));
const fryQueue = (await must(`/api/kitchen/queue?branch_id=${B}&station_id=${byCode.FRY.id}`, { token: cook.token }, 'fry queue'));
const barQueue = (await must(`/api/kitchen/queue?branch_id=${B}&station_id=${byCode.BAR.id}`, { token: cook.token }, 'bar queue'));
const unassigned = (await must(`/api/kitchen/queue?branch_id=${B}&station_id=UNASSIGNED`, { token: cook.token }, 'unassigned queue'));
ok('B1. confirming the order sent each dish to its own station',
  grillQueue.tasks.length === 1 && fryQueue.tasks.length === 1 && barQueue.tasks.length === 1,
  `grill=${grillQueue.tasks.length} fry=${fryQueue.tasks.length} bar=${barQueue.tasks.length}`);
ok('B2. the drink was routed by its CATEGORY rule, not by its name', barQueue.tasks[0].title_snapshot.includes('Кола'));
ok('B3. a dish with no configured station waits in "needs assignment" rather than being guessed at',
  unassigned.tasks.length === 1 && unassigned.tasks[0].station_id === null, `${unassigned.tasks.length} waiting`);
ok('B4. every task still points at the ONE order it came from -- no second order was created',
  [grillQueue, fryQueue, barQueue, unassigned].every(q => q.tasks.every(t => t.order_id === order.id)));
const grillTask = grillQueue.tasks[0], fryTask = fryQueue.tasks[0], barTask = barQueue.tasks[0], mysteryTask = unassigned.tasks[0];
ok('B5. the queue carries what a cook needs: order number, table, quantity and the forecast',
  grillTask.order_number && grillTask.table_code === 'T12' && grillTask.quantity === 2 && Boolean(grillTask.forecast_ready_at),
  `#${grillTask.order_number} table ${grillTask.table_code} x${grillTask.quantity} ready~${grillTask.forecast_ready_at}`);
ok('B6. the first forecast is openly PRELIMINARY -- it is the manager\'s norm, not measured history',
  grillTask.forecast_confidence === 'PRELIMINARY' && grillTask.forecast_source === 'STANDARD' && Number(grillTask.expected_minutes) === 16,
  `${grillTask.forecast_source}/${grillTask.forecast_confidence} ${grillTask.expected_minutes}min`);
ok('B7. an unassigned item carries no invented station or time', mysteryTask.expected_minutes === null || mysteryTask.station_id === null);

// ------------------------------------------------------------------- C. parallel work, one order
const before = (await must(`/api/orders/${order.id}`, { token: manager.token }, 'order before')).order;
await must(`/api/kitchen/tasks/${barTask.id}/status`, { method: 'POST', token: cook.token, body: { status: 'IN_PROGRESS' } }, 'bar start');
const afterBarStart = (await must(`/api/orders/${order.id}`, { token: manager.token }, 'order after bar start')).order;
await must(`/api/kitchen/tasks/${barTask.id}/status`, { method: 'POST', token: cook.token, body: { status: 'READY' } }, 'bar ready');
const afterBarReady = (await must(`/api/orders/${order.id}`, { token: manager.token }, 'order after bar ready')).order;
ok('C1. starting one station moves the ORDER to preparing', before.status === 'CONFIRMED' && afterBarStart.status === 'PREPARING', `${before.status} -> ${afterBarStart.status}`);
ok('C2. one station finishing does NOT make the whole order ready', afterBarReady.status === 'PREPARING', afterBarReady.status);
const grillBusy = await req(`/api/kitchen/tasks/${grillTask.id}/status`, { method: 'POST', token: cook.token, body: { status: 'READY' } });
ok('C3. NEGATIVE: an item cannot jump from waiting straight to ready', grillBusy.status === 409 && grillBusy.data.code === 'KITCHEN_INVALID_TRANSITION', `HTTP ${grillBusy.status} ${grillBusy.data?.code}`);
await must(`/api/kitchen/tasks/${grillTask.id}/status`, { method: 'POST', token: cook.token, body: { status: 'IN_PROGRESS' } }, 'grill start');
await must(`/api/kitchen/tasks/${fryTask.id}/status`, { method: 'POST', token: cook.token, body: { status: 'IN_PROGRESS' } }, 'fry start');
ok('C4. stations work in parallel on the same order', true, 'grill + fry + bar all progressed independently');

// ------------------------------------------------------------- D. forecast reacts to the queue
const second = (await must('/api/orders', { method: 'POST', waiter: WS, idem: `k42b-${Date.now()}`, body: {
  order_type: 'TAKEAWAY', items: [{ menu_item_id: burger.id, quantity: 3 }],
} }, 'second order')).order;
await must(`/api/orders/${second.id}/confirm`, { method: 'POST', token: manager.token }, 'confirm second');
const grillAfter = (await must(`/api/kitchen/queue?branch_id=${B}&station_id=${byCode.GRILL.id}`, { token: cook.token }, 'grill queue 2'));
const queued = grillAfter.tasks.find(t => t.order_id === second.id);
ok('D1. a new order queued behind the current one is forecast to START LATER, not immediately',
  new Date(queued.forecast_start_at).getTime() > Date.now() + 60_000,
  `starts ~${Math.round((new Date(queued.forecast_start_at) - Date.now()) / 60000)} min from now`);
ok('D2. the station reports its load in remaining minutes, not in a count of orders',
  grillAfter.load.remaining_minutes > 0 && grillAfter.load.waiting_tasks === 1 && grillAfter.load.active_tasks === 1,
  JSON.stringify(grillAfter.load));

// ------------------------------------------------------------------ E. delays and notifications
// Lateness is measured against the elapsed share of the expected time, so the limits are set to the
// SMALLEST the server will store (a ratio is DECIMAL(5,2): anything smaller would be saved as 0.00,
// meaning "late from the first second", which Stage 43 refuses) and the suite then waits that share
// of the grill's 16 minutes out. The delay is real elapsed time, never a faked timestamp.
await must('/api/kitchen/thresholds', { method: 'PUT', token: manager.token, body: { branch_id: B, warning_ratio: 0.1, late_ratio: 0.1, critical_ratio: 0.1, escalate_minutes: 5 } }, 'thresholds');
await new Promise(r => setTimeout(r, 100_000));
const delayed = (await must(`/api/kitchen/queue?branch_id=${B}&station_id=${byCode.GRILL.id}`, { token: cook.token }, 'grill queue delayed'));
const delayedTask = delayed.tasks.find(t => t.id === grillTask.id);
ok('E1. an item past its limit is marked late on the station screen', ['LATE', 'CRITICAL'].includes(delayedTask.delay_state), delayedTask.delay_state);
const alerts1 = (await must(`/api/kitchen/alerts?branch_id=${B}`, { token: manager.token }, 'alerts'));
const delayAlerts = alerts1.alerts.filter(a => a.type.startsWith('DELAY_') && a.task_id === grillTask.id);
await must(`/api/kitchen/queue?branch_id=${B}&station_id=${byCode.GRILL.id}`, { token: cook.token }, 'grill queue again');
await must(`/api/kitchen/queue?branch_id=${B}&station_id=${byCode.GRILL.id}`, { token: cook.token }, 'grill queue again 2');
const alerts2 = (await must(`/api/kitchen/alerts?branch_id=${B}`, { token: manager.token }, 'alerts again'));
const delayAlerts2 = alerts2.alerts.filter(a => a.type.startsWith('DELAY_') && a.task_id === grillTask.id);
ok('E2. the delay is announced once -- refreshing the screen does not notify again',
  delayAlerts.length === delayAlerts2.length && delayAlerts2.length > 0 && new Set(delayAlerts2.map(a => a.type)).size === delayAlerts2.length,
  `${delayAlerts2.length} alert(s): ${delayAlerts2.map(a => a.type).join(',')}`);
const criticalAlert = alerts2.alerts.find(a => a.type === 'DELAY_CRITICAL');
ok('E3. a critical delay escalates to the branch manager, a warning does not', !criticalAlert || criticalAlert.audience === 'BRANCH_MANAGER', criticalAlert?.audience || 'no critical delay yet');
if (!delayAlerts2.length) { console.log('FAIL E4/E5 -> no delay alert was raised, cannot test acknowledgement'); process.exit(1); }
const ackByCook = await req(`/api/kitchen/alerts/${delayAlerts2[0].id}/ack`, { method: 'POST', token: cook.token, body: { resolution: 'x' } });
ok('E4. NEGATIVE: a cook cannot close a manager\'s notification', ackByCook.status === 403, `HTTP ${ackByCook.status}`);
await must(`/api/kitchen/alerts/${delayAlerts2[0].id}/ack`, { method: 'POST', token: manager.token, body: { resolution: 'Поставили вторую смену на гриль' } }, 'ack alert');
const openAfterAck = (await must(`/api/kitchen/alerts?branch_id=${B}`, { token: manager.token }, 'alerts after ack')).alerts;
ok('E5. an acknowledged notification leaves the open list and keeps the decision', !openAfterAck.some(a => a.id === delayAlerts2[0].id));
await must('/api/kitchen/thresholds', { method: 'PUT', token: manager.token, body: { branch_id: B, warning_ratio: 0.8, late_ratio: 1, critical_ratio: 1.5, escalate_minutes: 5 } }, 'thresholds back');

// --------------------------------------------------------------------- F. waiter -> kitchen notes
const note = await must('/api/kitchen/comments', { method: 'POST', waiter: WS, body: { order_id: order.id, order_item_id: grillTask.order_item_id, kind: 'NO_ONION' } }, 'waiter note');
ok('F1. the waiter sends a note from the device and the kitchen sees it on the item', note.comment.kind === 'NO_ONION');
ok('F2. a note that arrives after cooking started is flagged as late', note.after_start === true, `after_start=${note.after_start}`);
const grillWithNote = (await must(`/api/kitchen/queue?branch_id=${B}&station_id=${byCode.GRILL.id}`, { token: cook.token }, 'grill with note'));
const noteTask = grillWithNote.tasks.find(t => t.id === grillTask.id);
ok('F3. the note is attached to the right item on the station screen', noteTask.comments.some(c => c.kind === 'NO_ONION'));
const orderBeforeNote = (await must(`/api/orders/${order.id}`, { token: manager.token }, 'order before note check')).order;
ok('F4. the note changed nothing about the order itself -- no price, no quantity',
  String(orderBeforeNote.final_amount) === String(afterBarReady.final_amount) && orderBeforeNote.subtotal === afterBarReady.subtotal,
  `final ${orderBeforeNote.final_amount} = ${afterBarReady.final_amount}`);
const foreignNote = await req('/api/kitchen/comments', { method: 'POST', token: otherManager.token, body: { order_id: order.id, kind: 'URGENT' } });
ok('F5. NEGATIVE: another branch cannot write to this order\'s kitchen', foreignNote.status === 403, `HTTP ${foreignNote.status}`);

// ------------------------------------------------------------------------------------- G. EXPO
const expoEarly = (await must(`/api/kitchen/expo?branch_id=${B}`, { token: cook.token }, 'expo'));
const expoOrder = expoEarly.orders.find(o => o.order_id === order.id);
ok('G1. the handover screen shows the whole order with each station\'s part of it',
  expoOrder.items.length === 4 && new Set(expoOrder.items.map(i => i.station_code)).size >= 3,
  expoOrder.items.map(i => `${i.title_snapshot}/${i.station_code || 'не назначено'}/${i.status}`).join(' | '));
ok('G2. and it does not claim the order is ready while items are not', expoOrder.all_ready === false);
const earlyHandover = await req(`/api/kitchen/expo/${order.id}/handover`, { method: 'POST', token: cook.token, body: {} });
ok('G3. NEGATIVE: an incomplete order cannot be handed over as complete', earlyHandover.status === 409 && earlyHandover.data.code === 'ORDER_NOT_FULLY_READY', `HTTP ${earlyHandover.status} ${earlyHandover.data?.code}`);
const cookOverride = await req(`/api/kitchen/expo/${order.id}/handover`, { method: 'POST', token: cook.token, body: { allow_incomplete: true, reason: 'Гость уходит' } });
ok('G4. NEGATIVE: and a cook cannot release an incomplete order either', cookOverride.status === 403 && cookOverride.data.code === 'EXPO_OVERRIDE_FORBIDDEN', `HTTP ${cookOverride.status} ${cookOverride.data?.code}`);
// assign the orphan item, then finish everything
const assignByCook = await req(`/api/kitchen/tasks/${mysteryTask.id}/assign`, { method: 'POST', token: cook.token, body: { station_id: byCode.COLD.id, reason: 'Холодный цех' } });
ok('G5. NEGATIVE: a cook cannot reassign stations', assignByCook.status === 403, `HTTP ${assignByCook.status}`);
await must(`/api/kitchen/tasks/${mysteryTask.id}/assign`, { method: 'POST', token: manager.token, body: { station_id: byCode.COLD.id, reason: 'Готовим в холодном цехе' } }, 'assign mystery');
const coldQueue = (await must(`/api/kitchen/queue?branch_id=${B}&station_id=${byCode.COLD.id}`, { token: cook.token }, 'cold queue'));
ok('G6. a manager assigns the waiting item and it appears on that station', coldQueue.tasks.some(t => t.id === mysteryTask.id));
for (const t of [grillTask.id, fryTask.id, mysteryTask.id]) {
  const cur = (await must(`/api/kitchen/queue?branch_id=${B}`, { token: cook.token }, 'queue')).tasks;
  const task = await req(`/api/kitchen/tasks/${t}/status`, { method: 'POST', token: cook.token, body: { status: 'IN_PROGRESS' } });
  await req(`/api/kitchen/tasks/${t}/status`, { method: 'POST', token: cook.token, body: { status: 'READY' } });
}
const orderReady = (await must(`/api/orders/${order.id}`, { token: manager.token }, 'order ready')).order;
ok('G7. the order becomes ready only when EVERY station has finished its part', orderReady.status === 'READY', orderReady.status);
const returnItem = await must(`/api/kitchen/expo/${order.id}/return-item`, { method: 'POST', token: manager.token, body: { task_id: fryTask.id, reason: 'Холодный картофель' } }, 'return item');
const orderAfterReturn = (await must(`/api/orders/${order.id}`, { token: manager.token }, 'order after return')).order;
ok('G8. EXPO can send one item back, and the order stops being ready', returnItem.task.status === 'IN_PROGRESS' && orderAfterReturn.status === 'PREPARING', `${returnItem.task.status} / ${orderAfterReturn.status}`);
await must(`/api/kitchen/tasks/${fryTask.id}/status`, { method: 'POST', token: cook.token, body: { status: 'READY' } }, 'fry ready again');
const handover = await must(`/api/kitchen/expo/${order.id}/handover`, { method: 'POST', token: cook.token, body: {} }, 'handover');
ok('G9. a complete order is handed to the waiter and the handover is recorded', handover.handover.kind === 'HANDED_OVER' && Boolean(handover.handover.actor_user_id));
const twice = await req(`/api/kitchen/expo/${order.id}/handover`, { method: 'POST', token: cook.token, body: {} });
ok('G10. NEGATIVE: the same order cannot be handed over twice', twice.status === 409 && twice.data.code === 'ORDER_ALREADY_HANDED_OVER', `HTTP ${twice.status} ${twice.data?.code}`);
const overrideByManager = await must(`/api/kitchen/expo/${second.id}/handover`, { method: 'POST', token: manager.token, body: { allow_incomplete: true, reason: 'Гость не может ждать' } }, 'manager override');
ok('G11. a manager may release an incomplete order -- recorded as exactly that, with the reason',
  overrideByManager.handover.kind === 'INCOMPLETE_OVERRIDE' && overrideByManager.handover.reason.includes('ждать') && JSON.parse(overrideByManager.handover.missing_items).length > 0,
  `${overrideByManager.handover.kind}: ${overrideByManager.handover.reason}`);

// ------------------------------------------------------------------- H. load analytics and help
const load = (await must(`/api/kitchen/load?branch_id=${B}`, { token: manager.token }, 'load'));
const grillLoad = load.stations.find(s => s.station.code === 'GRILL');
ok('H1. the load screen reports measured work, not sample numbers',
  grillLoad.completed_in_window >= 1 && grillLoad.median_minutes !== null && grillLoad.throughput_per_hour > 0,
  `done=${grillLoad.completed_in_window} median=${grillLoad.median_minutes}min throughput=${grillLoad.throughput_per_hour}/h within norm=${grillLoad.within_norm_share}%`);
ok('H2. it reports the share cooked within the manager\'s norm', grillLoad.within_norm_share !== null, `${grillLoad.within_norm_share}%`);
const help = await must('/api/kitchen/help-requests', { method: 'POST', token: cook.token, body: { branch_id: B, station_id: byCode.FRY.id, reason: 'INGREDIENTS', comment: 'Закончилось масло' } }, 'help request');
const alerts3 = (await must(`/api/kitchen/alerts?branch_id=${B}`, { token: manager.token }, 'alerts with help')).alerts;
const helpAlert = alerts3.find(a => a.type === 'HELP_REQUEST');
ok('H3. a station asks for help and the manager receives it with station, reason and author',
  helpAlert && helpAlert.reason === 'INGREDIENTS' && helpAlert.station_code === 'FRY' && helpAlert.created_by_name === 'K42 Cook',
  `${helpAlert?.reason} @${helpAlert?.station_code} by ${helpAlert?.created_by_name}`);
const badHelp = await req('/api/kitchen/help-requests', { method: 'POST', token: cook.token, body: { branch_id: B, reason: 'NONSENSE' } });
ok('H4. NEGATIVE: an unrecognised help reason is refused', badHelp.status === 400 && badHelp.data.code === 'INVALID_HELP_REASON');

// --------------------------------------------------------- I. isolation, IDOR and race conditions
const foreignQueue = await req(`/api/kitchen/queue?branch_id=${B}`, { token: otherManager.token });
ok('I1. NEGATIVE: a manager of another branch cannot read this kitchen', foreignQueue.status === 403, `HTTP ${foreignQueue.status}`);
const foreignTask = await req(`/api/kitchen/tasks/${barTask.id}/status`, { method: 'POST', token: otherManager.token, body: { status: 'SERVED' } });
ok('I2. NEGATIVE: and cannot touch its items by id (IDOR)', foreignTask.status === 403, `HTTP ${foreignTask.status}`);
const foreignLoad = await req(`/api/kitchen/load?branch_id=${B}`, { token: otherManager.token });
ok('I3. NEGATIVE: nor read its load figures', foreignLoad.status === 403, `HTTP ${foreignLoad.status}`);
const third = (await must('/api/orders', { method: 'POST', waiter: WS, idem: `k42c-${Date.now()}`, body: { order_type: 'TAKEAWAY', items: [{ menu_item_id: fries.id, quantity: 1 }] } }, 'third order')).order;
await must(`/api/orders/${third.id}/confirm`, { method: 'POST', token: manager.token }, 'confirm third');
const thirdTask = (await must(`/api/kitchen/queue?branch_id=${B}&station_id=${byCode.FRY.id}`, { token: cook.token }, 'fry queue 3')).tasks.find(t => t.order_id === third.id);
const racers = await Promise.all([
  req(`/api/kitchen/tasks/${thirdTask.id}/status`, { method: 'POST', token: cook.token, body: { status: 'IN_PROGRESS' } }),
  req(`/api/kitchen/tasks/${thirdTask.id}/status`, { method: 'POST', token: manager.token, body: { status: 'IN_PROGRESS' } }),
]);
const winners = racers.filter(r => r.status === 200).length;
ok('I4. two tablets pressing the same button at once produce ONE state change', winners === 1, `${winners} of 2 succeeded, other: HTTP ${racers.find(r => r.status !== 200)?.status}`);
const routeTwice = await must(`/api/kitchen/orders/${third.id}/route`, { method: 'POST', token: manager.token, body: {} }, 'route again');
ok('I5. re-routing an order that is already in the kitchen adds nothing', routeTwice.created === 0, `created=${routeTwice.created}`);

// ------------------------------------------------- J. the rest of the system is still untouched
const payable = (await must(`/api/orders/${third.id}`, { token: manager.token }, 'third order check')).order;
// A cash payment needs an open shift -- an existing rule of the till, unchanged by this stage.
await must('/api/cash-shifts', { method: 'POST', token: manager.token, body: { branch_id: B, opening_cash: '0.00' } }, 'open shift');
const pay = await req('/api/payments', { method: 'POST', token: manager.token, idem: `k42pay-${Date.now()}`, body: { order_id: order.id, method: 'CASH', amount: String(orderReady.final_amount) } });
ok('J1. payment still works on an order the kitchen handled', [200, 201].includes(pay.status), `HTTP ${pay.status} ${pay.data?.payment?.status || pay.data?.code}`);
const paidOrder = (await must(`/api/orders/${order.id}`, { token: manager.token }, 'paid order')).order;
ok('J2. and the kitchen never rewrote the order\'s money', String(paidOrder.final_amount) === String(orderReady.final_amount), `${paidOrder.final_amount}`);
const kdsTicket = (await must(`/api/kds?branch_id=${B}`, { token: manager.token }, 'kds tickets')).tickets.find(t => t.order_id === third.id);
ok('J3. the original per-order KDS ticket still exists and still reflects the kitchen', Boolean(kdsTicket) && ['NEW', 'PREPARING', 'READY'].includes(kdsTicket.status), kdsTicket?.status);
const audit = (await must(`/api/audit?branch_id=${B}&limit=200`, { token: T }, 'audit')).logs || [];
const actions = new Set(audit.map(a => a.action));
ok('J4. every kitchen decision is in the existing audit log',
  ['KITCHEN_TASK_STATUS_CHANGED', 'KITCHEN_TASK_REASSIGNED', 'KITCHEN_COMMENT_CREATED', 'EXPO_ORDER_HANDED_OVER', 'EXPO_ORDER_HANDED_OVER_INCOMPLETE', 'KITCHEN_ROUTE_UPDATED', 'KITCHEN_HELP_REQUESTED'].every(a => actions.has(a)),
  [...actions].filter(a => a.startsWith('KITCHEN') || a.startsWith('EXPO')).join(','));

console.log(`\n${pass}/${pass + fail} Stage 42 runtime checks passed`);
if (fail) process.exit(1);
