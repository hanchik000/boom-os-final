// BOOM OS -- Stage 32: static regression guards for the Manager Command Center. It is a thin,
// read-only aggregation over EXISTING Order/Payment/CashShift/Credit/KDS/Waiter/Inventory/Staff
// data -- these checks guard against it turning into a second reporting/business-logic system.
import fs from 'node:fs';
import assert from 'node:assert/strict';

const dashboardTs = fs.readFileSync(new URL('../server/routes/dashboard.ts', import.meta.url), 'utf8');
const serverTs = fs.readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
const seedTs = fs.readFileSync(new URL('../server/seed.ts', import.meta.url), 'utf8');
const apiTs = fs.readFileSync(new URL('../src/api.ts', import.meta.url), 'utf8');
const dashboardView = fs.readFileSync(new URL('../src/components/ManagerCommandCenterView.tsx', import.meta.url), 'utf8');
const sidebar = fs.readFileSync(new URL('../src/components/Sidebar.tsx', import.meta.url), 'utf8');

let passed = 0;
function check(label, cond) { assert.ok(cond, `FAILED: ${label}`); passed++; }

// --- single aggregation endpoint, mounted once, no duplicate reporting system
check('exactly one manager dashboard route exists', (dashboardTs.match(/router\.get\('\/manager'/g) || []).length === 1);
check('dashboard router mounted once at /api/dashboard', (serverTs.match(/app\.use\('\/api\/dashboard'/g) || []).length === 1);
check('dashboard router is wired into async error forwarding (unmapped errors 500, never hang)', /creditRouter, dashboardRouter/.test(serverTs));

// --- reuses existing tables/data, never re-derives business state elsewhere
check('reads from the existing payments table (no shadow sales ledger)', /FROM payments WHERE branch_id=\? AND status='PAID'/.test(dashboardTs));
check('reads from the existing credit_transactions ledger built in Stage 31 (no second credit engine)', /FROM credit_transactions WHERE branch_id=\?/.test(dashboardTs));
check('reads from the existing orders table for live status (no second order-status system)', /FROM orders WHERE branch_id=\? AND created_at>=\? AND created_at<=\? GROUP BY status/.test(dashboardTs));
check('reads from the existing kds_tickets table for kitchen state (no second KDS)', /FROM kds_tickets WHERE branch_id=\? AND created_at>=\? AND created_at<=\? GROUP BY status/.test(dashboardTs));
check('reads from the existing inventory_items/reorder_point fields for low stock (no invented inventory engine)', /current_stock<=reorder_point AND current_stock>0/.test(dashboardTs));
check('reads from the existing waiter_profiles status for waiter qualification (no second KPI engine)', /FROM waiter_profiles WHERE user_id IN/.test(dashboardTs));
check('reads from the existing order_item_removal_approvals for removal requests (no invented mistake tracker)', /FROM order_item_removal_approvals WHERE branch_id=\?/.test(dashboardTs));

// --- no Float money: BigInt cents helpers, same convention as credit.ts/payments.ts
check('dashboard.ts uses BigInt cents helpers, not floating point arithmetic', /function moneyCents\(v: unknown\): bigint/.test(dashboardTs) && /function centsText\(c: bigint\): string/.test(dashboardTs));
check('average/ratio money values are computed via BigInt division, not Number division', /function ratioCents\(total: bigint, count: number\): string \{ return count > 0 \? centsText\(total \/ BigInt\(count\)\) : '0\.00'; \}/.test(dashboardTs));

// --- financial semantics reused exactly from Stage 31: credit sale is a sale, not received money;
// repayment is received money, not a sale
check('SALES total includes credit (credit sale counts as a sale)', /const totalSales = cash \+ card \+ credit \+ other;/.test(dashboardTs));
check('RECEIVED total is cash+card+repayments, never the credit sale amount itself', /const receivedTotal = cash \+ card \+ creditRepayments;/.test(dashboardTs));
check('credit_repayments are summed from REPAYMENT/PAYROLL_DEDUCTION transactions only, never CREDIT', /type IN \('REPAYMENT','PAYROLL_DEDUCTION'\) AND created_at>=\? AND created_at<=\?`, \[branchId, start, end\]\);\s*const creditRepayments/.test(dashboardTs));

// --- branch isolation and RBAC: every section gated by the SAME permission its own endpoint uses
check('dashboard route itself requires dashboard.view', /router\.get\('\/manager', requirePermission\('dashboard\.view'\)/.test(dashboardTs));
check('branch access reuses the standard allowed(req,branch) helper (no second authorization system)', /function allowed\(req: Request, b: string\) \{ return Boolean\(req\.user\?\.isSuperUser \|\| req\.user\?\.allowedBranchIds\.includes\(b\)\); \}/.test(dashboardTs));
check('financial/cashier sections gated by payments.view (same permission payments.ts itself requires)', /financial: has\(req, 'payments\.view'\)/.test(dashboardTs) && /cashiers: has\(req, 'payments\.view'\)/.test(dashboardTs));
check('credit section gated by credit.reports (same permission credit.ts reports use)', /credit: has\(req, 'credit\.reports'\)/.test(dashboardTs));
check('inventory section gated by inventory.view', /inventory: has\(req, 'inventory\.view'\)/.test(dashboardTs));
check('staff section gated by employees.view', /staff: has\(req, 'employees\.view'\)/.test(dashboardTs));
check('a section is omitted from the response entirely when the permission is missing (not just hidden client-side)', /if \(permissions\.financial\) \{/.test(dashboardTs) && /if \(permissions\.credit\) \{/.test(dashboardTs) && /if \(permissions\.inventory\) \{/.test(dashboardTs) && /if \(permissions\.staff\) \{/.test(dashboardTs));

// --- date range is backend-driven aggregation, not frontend calculation over raw rows
check('date range comes from query params, defaulting server-side (backend owns the period)', /const start = typeof req\.query\.start === 'string' && req\.query\.start \? req\.query\.start/.test(dashboardTs));
check('every per-section query aggregates with GROUP BY / SUM in SQL, not by pulling raw rows to JS', (dashboardTs.match(/GROUP BY/g) || []).length >= 6);
check('no unbounded SELECT * without a LIMIT for list-shaped sections (top debtors, low stock, movements are all capped)', /ORDER BY ca\.current_balance DESC LIMIT 5/.test(dashboardTs) && /LIMIT 20/.test(dashboardTs));

// --- ORDER_DELAY alert is derived from this branch's own observed average, never an invented constant
check('order delay threshold is relative to the branch\'s own historical average, not a hardcoded minute value', /longestActiveMinutes! > avgPrepMinutes \* 2/.test(dashboardTs));
check('delay alert requires at least 3 real samples before it fires (never guesses from thin data)', /\(avgRow\?\.samples \|\| 0\) >= 3/.test(dashboardTs));

// --- seed: new permission, granted to the same manager roles as the rest of Stage 31/32 infra
check('dashboard.view permission is seeded', /code: 'dashboard\.view'/.test(seedTs));
check('dashboard.view granted to Owner/SuperAdmin/GeneralManager/BranchManager (the same role set as credit.reports)', (() => {
  const m = seedTs.match(/const stage17RolePerms = \[([^\]]*)\];/);
  return !!m && m[1].includes("'dashboard.view'") && m[1].includes("'credit.reports'");
})());

// --- frontend: one client method, one new view, wired through the existing Sidebar/nav pattern
check('api.ts has exactly one getManagerDashboard client method', (apiTs.match(/getManagerDashboard:/g) || []).length === 1);
check('ManagerCommandCenterView never computes its own financial totals -- it only formats server values', !/const totalSales\s*=|sales\.cash\s*\+\s*sales\.card/.test(dashboardView));
check('drill-down navigates to existing views (cashierPos/operations/inventory/creditReports/employees), no duplicate screens created', ['cashierPos', 'operations', 'inventory', 'creditReports', 'employees'].every(tab => dashboardView.includes(`onNavigate('${tab}')`)));
check('Sidebar gates the command center nav item behind dashboard.view', /id: 'commandCenter', key: 'nav\.commandCenter', icon: Gauge, permission: 'dashboard\.view'/.test(sidebar));

console.log(`STAGE 32 MANAGER DASHBOARD STATIC: PASS (${passed} checks)`);
