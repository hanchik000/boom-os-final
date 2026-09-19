// BOOM OS -- Stage 35.8: Manager Dashboard (Command Center) Design (visual/UX only).
//
// This stage restyles ManagerCommandCenterView.tsx -- top bar, alert center, KPI strip,
// financial reconciliation, cash position, live orders, KDS, inventory, waiter/cashier tables,
// credit and staff panels -- into the black/graphite/white/metallic-gold design language, reusing
// the same presentation-only-companion-CSS pattern Stage 35.1/35.7 established.
//
// The one rule this whole stage exists to prove: every number still comes from the same
// /api/dashboard/manager response, formatted the same way, gated by the same permissions and
// branch scope -- only how it is painted changed.
import fs from 'node:fs';
const read = p => fs.readFileSync(p, 'utf8');
const view = read('src/components/ManagerCommandCenterView.tsx');
const css = read('src/design-system/command-center.css');
const main = read('src/main.tsx');
const dashboard = read('server/routes/dashboard.ts');

const checks = [
  // -- Loads / registered the same way as the other 35.x visual stages
  ['ManagerCommandCenterView still exports the same component', view.includes('export const ManagerCommandCenterView: React.FC<Props>')],
  ['the new stylesheet is registered globally, same pattern as cashier-pos.css/waiter-pos.css', main.includes("import './design-system/command-center.css'")],
  ['command-center.css declares itself presentation-only, no business rule', css.includes('Presentation only') && css.includes('no business rule')],

  // -- Single source of truth: one server-aggregated endpoint, no client totals
  ['the dashboard still loads from the ONE server-aggregated endpoint, same params', view.includes('api.getManagerDashboard({ branch_id: branchId, start: range.start, end: range.end })')],
  ['money() still only formats a server-given value, never computes one', /function money\(v: any\) \{ const n = Number\(v \?\? 0\); return Number\.isFinite\(n\) \? n\.toLocaleString/.test(view)],
  ['no arithmetic on financial fields anywhere in the render (+/-/*// on data.* fields)', !/data\.(financial|cash_position|credit)\.[a-zA-Z_.]+\s*[+\-*/]/.test(view)],
  ['date-range presets are still computed the same way (today/yesterday/week/month/custom)', view.includes("function computeRange(preset: Preset, customStart: string, customEnd: string)")],
  // REFRESH_MS itself was deliberately changed by Stage 35.9 (45s -> the spec-mandated 30s); this
  // check only pins that SOME interval-driven auto-refresh mechanism still exists at all -- the
  // exact interval value and its pause/cleanup behavior are Stage 35.9's own responsibility now
  // (tests/stage35_9_live_operations_static.mjs).
  ['an auto-refresh interval mechanism exists', /const REFRESH_MS = \d+;/.test(view) && view.includes('window.setInterval(')],

  // -- SALES != CASH RECEIVED stays visually distinct (two separate panels, two separate totals)
  ['sales and received-money are still two separate panels, never merged into one total', /cmd-panel">[\s\S]{0,80}Продажи[\s\S]{0,1200}cmd-panel">[\s\S]{0,80}Получено/.test(view)],
  ['the received total is still the sum of cash + card + credit_repayments only, never re-labeled as a sale', view.includes('data.financial.received.credit_repayments')],

  // -- Cash position: difference stays prominent, still from the existing CashShift data
  ['cash position still reads expected_cash from the server, never recomputed', view.includes('money(data.cash_position.expected_cash)')],
  ['the last-closed-shift difference is still shown and still branch/shift-scoped from the server', view.includes('data.cash_position.last_closed_shift.difference')],

  // -- Live operations: orders / KDS / waiters / cashiers all still server-aggregated
  ['orders-by-status still drives from data.orders.by_status, not a local count', view.includes('Object.entries(data.orders.by_status)')],
  ['KDS status counts and average prep time still come from data.kds, unchanged', view.includes('Object.entries(data.kds.by_status)') && view.includes('data.kds.average_preparation_minutes')],
  ['waiter table still reads real per-waiter fields (orders/sales/average_check/status/removal_requests)', view.includes('w.orders') && view.includes('w.sales') && view.includes('w.average_check') && view.includes('w.removal_requests')],
  ['cashier table still reads real per-cashier fields, credit column still permission-gated by p.credit', view.includes('{p.credit && <th>') && view.includes('{p.credit && <td>')],

  // -- Credit / inventory: real data only, no invented alert types
  ['credit panel still reads top_debtors/issued_today/repayments_today from the server', view.includes('data.credit.top_debtors') && view.includes('data.credit.issued_today.total') && view.includes('data.credit.repayments_today.total')],
  ['inventory panel still reads low_stock/out_of_stock counts from the server, not a hardcoded list', view.includes('data.inventory.low_stock.length') && view.includes('data.inventory.out_of_stock.length')],
  ['alertText() still switches only on the existing, real alert types -- none invented', /case 'LOW_STOCK':/.test(view) && /case 'ORDER_DELAY':/.test(view) && /case 'CASH_DIFFERENCE':/.test(view) && /case 'CREDIT_LIMIT_ISSUE':/.test(view) && /case 'OPEN_CASH_SHIFT':/.test(view) && !/case 'NEW_ALERT_TYPE'/.test(view)],
  ['no alert is ever rendered unless data.alerts has real entries', view.includes('data.alerts?.length > 0 &&')],

  // -- Drill-down reuses existing screens, no duplicate pages created
  ['drill-down still calls the existing onNavigate(tab) prop, no new routing/page was invented', view.includes('interface Props { onNavigate: (tab: NavTab) => void; }') && (view.match(/onNavigate\(/g) || []).length >= 8],
  ['no new NavTab or duplicate dashboard-like screen file was created for this stage', !fs.existsSync('src/components/ManagerDashboardV2View.tsx') && !fs.existsSync('src/components/CommandCenterV2View.tsx')],

  // -- Security: branch isolation stays server-enforced, unchanged by this visual stage
  ['branch access is still gated server-side by dashboard.view + branch scope, this stage did not touch it', dashboard.includes("requirePermission('dashboard.view')") && dashboard.includes('if (!branchId || !allowed(req, branchId))')],
  ['the branch selector still drives the SAME branchId used in the API call, never a second, disconnected value', /setBranchId\(e\.target\.value\)/.test(view) && view.includes('branch_id: branchId')],

  // -- Reduced motion / accessibility
  ['command-center.css disables its own transitions under prefers-reduced-motion', css.includes('@media (prefers-reduced-motion:reduce)')],
  ['no financial value class (kpi value, stat-row total, cash difference) carries a transition/animation rule', !/\.cmd-kpi-value[^}]*transition/.test(css) && !/\.cmd-stat-row\.total[^}]*transition/.test(css) && !/\.cmd-cash-diff \.value[^}]*transition/.test(css)],

  ['stage doc exists', fs.existsSync('docs/STAGE-35.8-MANAGER-DASHBOARD-DESIGN.md')],
];

let ok = 0;
for (const [name, v] of checks) { console.log(`${v ? 'PASS' : 'FAIL'} ${name}`); if (v) ok++; }
console.log(`${ok}/${checks.length} PASS`);
if (ok !== checks.length) process.exit(1);
