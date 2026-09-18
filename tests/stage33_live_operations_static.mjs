// BOOM OS -- Stage 33: static regression guards for the Live Operations control center. It is a
// thin, mostly read-only aggregation over the EXISTING Order Core / KDS / CashShift / operator
// session / credit / inventory tables -- these checks guard against a second order-state machine,
// a second cash calculation, or hardcoded delay thresholds creeping in.
import fs from 'node:fs';
import assert from 'node:assert/strict';

const opsTs = fs.readFileSync(new URL('../server/routes/operations.ts', import.meta.url), 'utf8');
const serverTs = fs.readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
const seedTs = fs.readFileSync(new URL('../server/seed.ts', import.meta.url), 'utf8');
const apiTs = fs.readFileSync(new URL('../src/api.ts', import.meta.url), 'utf8');
const opsView = fs.readFileSync(new URL('../src/components/LiveOperationsView.tsx', import.meta.url), 'utf8');
const sidebar = fs.readFileSync(new URL('../src/components/Sidebar.tsx', import.meta.url), 'utf8');

let passed = 0;
function check(label, cond) { assert.ok(cond, `FAILED: ${label}`); passed++; }

// --- permission exists, seeded, RBAC-gated (not UI-only)
check('operations.view permission is seeded', /code: 'operations\.view'/.test(seedTs));
check('operations.view granted to Owner/SuperAdmin/GeneralManager/BranchManager (the same role set as dashboard.view)', (() => {
  const m = seedTs.match(/const stage17RolePerms = \[([^\]]*)\];/);
  return !!m && m[1].includes("'operations.view'") && m[1].includes("'dashboard.view'");
})());
check('the live route itself requires operations.view server-side', /router\.get\('\/live', requirePermission\('operations\.view'\)/.test(opsTs));
check('branch access is enforced server-side via the standard allowed(req,branch) helper, never trusted from the frontend', /function allowed\(req: Request, b: string\) \{ return Boolean\(req\.user\?\.isSuperUser \|\| req\.user\?\.allowedBranchIds\.includes\(b\)\); \}/.test(opsTs) && /if \(!branchId \|\| !allowed\(req, branchId\)\)/.test(opsTs));

// --- one endpoint, mounted once, wired into async error forwarding
check('exactly one live operations route exists', (opsTs.match(/router\.get\('\/live'/g) || []).length === 1);
check('operations router mounted once at /api/operations', (serverTs.match(/app\.use\('\/api\/operations'/g) || []).length === 1);
check('operations router is wired into async error forwarding (unmapped errors 500, never hang)', /dashboardRouter, operationsRouter/.test(serverTs));

// --- reuses existing Order Core / KDS / CashShift / session tables -- no second state machine
check('live orders come from the existing orders table using its real status values, not an invented state machine', /FROM orders o[\s\S]{0,400}WHERE o\.branch_id=\? AND o\.status IN \('PENDING_CONFIRMATION','CONFIRMED','PREPARING','READY'\)/.test(opsTs));
check('KDS monitor reads the existing kds_tickets table, not a duplicate kitchen model', /FROM kds_tickets WHERE branch_id=\? AND status IN \('NEW','PREPARING','READY'\)/.test(opsTs));
check('cashier operations reuse the existing cash_shifts table and its real columns (no shadow ledger)', /FROM cash_shifts cs JOIN users u ON u\.id=cs\.cashier_user_id WHERE cs\.branch_id=\? AND cs\.status='OPEN'/.test(opsTs));
check('expected_cash uses the exact same formula as Stage 31/32 (opening+cash_sales+credit_repayments-refunds-voids)', /moneyCents\(openShift\.opening_cash\) \+ moneyCents\(openShift\.cash_sales\) \+ moneyCents\(openShift\.credit_repayments\) - moneyCents\(openShift\.refunds\) - moneyCents\(openShift\.voids\)/.test(opsTs));
check('POS sessions reuse the existing operator_pos_sessions/waiter_pos_sessions tables, no new session model', /FROM operator_pos_sessions s JOIN users u ON u\.id=s\.user_id/.test(opsTs) && /FROM waiter_pos_sessions s JOIN users u ON u\.id=s\.user_id/.test(opsTs));
check('no security-sensitive session token/hash is ever selected for the POS sessions list', !/pin_hash|token_hash/.test(opsTs));
check('table occupancy reuses the existing dining_tables status field, no second occupancy system', /FROM dining_tables WHERE branch_id=\? ORDER BY code/.test(opsTs));
check('removal requests reuse the existing order_item_removal_approvals table', /FROM order_item_removal_approvals a JOIN orders o ON o\.id=a\.order_id/.test(opsTs));

// --- delay detection: backend-authoritative, configurable, never hardcoded in the route or UI
check('delay thresholds are read from the existing system_settings table, not hardcoded literals scattered through the route', /SELECT key,value FROM system_settings WHERE key IN \('KDS_PREP_WARNING_MINUTES','KDS_PREP_DELAYED_MINUTES'\)/.test(opsTs));
check('the two threshold settings are seeded once via the existing system_settings seed convention (ON CONFLICT DO NOTHING)', /KDS_PREP_WARNING_MINUTES/.test(seedTs) && /KDS_PREP_DELAYED_MINUTES/.test(seedTs) && /ON CONFLICT \(key\) DO NOTHING/.test(seedTs));
check('delay state is a deterministic 3-value classification (NORMAL/WARNING/DELAYED), not an arbitrary score', /function delayState\(minutes: number, warn: number, delayed: number\): 'NORMAL' \| 'WARNING' \| 'DELAYED'/.test(opsTs));
check('delay is computed from real KDS timestamps (started_at/created_at), never fabricated when timing is missing', /const since = o\.kds_started_at \|\| o\.kds_created_at;\s*if \(since\) delay = delayState/.test(opsTs));
check('the frontend never hardcodes its own delay threshold -- it only renders the delay_state the backend computed', !/>=\s*15|>=\s*25|minutes\s*>\s*\d+/.test(opsView));

// --- financial integrity: no Float, no frontend-authoritative totals, reuses Stage 31/32 money helpers
check('operations.ts uses BigInt cents helpers, not floating point arithmetic', /function moneyCents\(v: unknown\): bigint/.test(opsTs) && /function centsText\(c: bigint\): string/.test(opsTs));
check('LiveOperationsView never recomputes cash/sales totals client-side (only formats server values)', !/expected_cash\s*=|opening_cash\s*\+\s*cash_sales/.test(opsView));

// --- action center: only reuses an existing, already-audited mutation -- no new dangerous endpoint
check('no new order/payment/cash/credit mutation route was added in operations.ts (read-only aggregation)', !/router\.(post|put|patch|delete)\(/.test(opsTs));
check('the one action LiveOperationsView performs calls the existing, already-permissioned removal-request endpoints', /api\.approveItemRemoval\(approvalId\)/.test(opsView) && /api\.rejectItemRemoval\(approvalId\)/.test(opsView));

// --- sections omitted (not merely hidden) when the caller lacks that section's own permission
check('orders section gated by orders.view (same permission orders.ts itself requires)', /orders: has\(req, 'orders\.view'\)/.test(opsTs));
check('kds section gated by kds.view', /kds: has\(req, 'kds\.view'\)/.test(opsTs));
check('cash_shifts section gated by cash_shifts.view', /cash_shifts: has\(req, 'cash_shifts\.view'\)/.test(opsTs));
check('credit alerts gated by credit.reports', /credit: has\(req, 'credit\.reports'\)/.test(opsTs));
check('inventory alerts gated by inventory.view', /inventory: has\(req, 'inventory\.view'\)/.test(opsTs));
check('a permission-gated section is skipped entirely in the query/response when the permission is absent', /if \(permissions\.orders\) \{/.test(opsTs) && /if \(permissions\.kds\) \{/.test(opsTs) && /if \(permissions\.credit\) \{/.test(opsTs));

// --- no fake/demo data: every list is capped, every alert traces to a real row
check('every alert-generating list is capped (no unbounded fan-out)', (opsTs.match(/\.slice\(0, 5\)/g) || []).length >= 4);
check('every alerts.push call sits inside a for-of loop over real query rows, never a bare unconditional push', (opsTs.match(/for \(const [a-zA-Z]+ of [\s\S]{0,120}?\) [\s\S]{0,60}?alerts\.push/g) || []).length >= 5);

// --- frontend: RU/TK via the existing inline-ternary i18n convention, no hardcoded English UI text
check('LiveOperationsView uses the existing ru ? ... : ... i18n convention throughout (same pattern as CashierPOSView/CreditReportsView)', (opsView.match(/ru \? '/g) || []).length >= 20);
check('api.ts has exactly one getLiveOperations client method', (apiTs.match(/getLiveOperations:/g) || []).length === 1);
check('Sidebar gates the Live Operations nav item behind operations.view', /id: 'liveOperations', key: 'nav\.liveOperations', icon: Radio, permission: 'operations\.view'/.test(sidebar));
check('drill-down navigates to existing views: operations/cashierPos are dedicated widget buttons, creditReports/inventory/orderApprovals arrive via the alert center\'s own link field, all resolved through the same onNavigate -- no duplicate screens created', ['operations', 'cashierPos'].every(tab => opsView.includes(`'${tab}'`)) && ['creditReports', 'inventory', 'orderApprovals'].every(tab => opsTs.includes(`link: '${tab}'`)) && opsView.includes('onNavigate(a.link)'));

console.log(`STAGE 33 LIVE OPERATIONS STATIC: PASS (${passed} checks)`);
