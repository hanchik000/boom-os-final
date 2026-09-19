// BOOM OS -- Stage 34.10 static source guards: credit refinements.
// Guards against a second credit ledger, against a credit sale ever being counted as cash,
// against a repayment ever being counted as a new sale, against payroll deduction happening
// without a manager, against an archived employee's debt being silently dropped, and against
// money ever touching Float on this path.
import fs from 'node:fs';

const failures = []; let checks = 0;
const read = p => fs.readFileSync(p, 'utf8');
function ok(label, cond, detail) { checks++; if (!cond) failures.push(`${label}${detail ? ' -> ' + String(detail).slice(0, 220) : ''}`); }

const credit = read('server/routes/credit.ts');
const payments = read('server/routes/payments.ts');
const schema = read('prisma/schema.prisma');
const seed = read('server/seed.ts');
const api = read('src/api.ts');
const view = read('src/components/CreditReportsView.tsx');

// ---------------------------------------------------------------- 1. ONE credit core
ok('1. there is exactly one credit account model and one credit transaction model', (schema.match(/^model CreditAccount \{/m) || []).length === 1 && (schema.match(/^model CreditTransaction \{/m) || []).length === 1);
ok('2. only ONE place ever raises a balance for a sale, and payments.ts calls it rather than duplicating it',
  (credit.match(/export async function applyCreditSale/g) || []).length === 1
  && /import \{ ?applyCreditSale ?\} from '\.\/credit'/.test(payments)
  && !/INSERT INTO credit_transactions/.test(payments)
  && !/UPDATE credit_accounts/.test(payments));
ok('3. and a credit sale is booked inside the SAME transaction as the payment itself', /if\(method==='CREDIT'\)\{[\s\S]{0,400}await applyCreditSale\(tx,\{/.test(payments));
ok('4. the two places that move a balance both lock the account row first',
  (credit.match(/FROM credit_accounts WHERE id=\?[^']*FOR UPDATE/g) || []).length >= 2);

// ---------------------------------------------------------------- 2. money is never Float
ok('5. money is parsed into BigInt cents, never parseFloat/Number', /function moneyCents\(v: unknown\): bigint/.test(credit) && !/parseFloat|Number\(/.test(credit));
ok('6. and written back through NUMERIC casts, never a JS number', (credit.match(/CAST\(\? AS numeric\)/g) || []).length >= 4);
ok('7. the stored columns are Decimal, not Float', (() => {
  const m = /model CreditAccount \{[\s\S]*?\n\}/.exec(schema)[0] + /model CreditTransaction \{[\s\S]*?\n\}/.exec(schema)[0];
  return /Decimal/.test(m) && !/\bFloat\b/.test(m);
})());

// ---------------------------------------------------------------- 3. individual limits + manager approval
ok('8. the limit lives on the ACCOUNT, so every customer and employee has their own', /model CreditAccount \{[\s\S]*?credit_limit[\s\S]*?\n\}/.test(schema));
ok('9. a cashier is refused past the available limit', /if \(opts\.amount > available && !opts\.isManager\)/.test(credit) && /CREDIT_LIMIT_EXCEEDED/.test(credit));
ok('10. and the manager gate is the EXISTING RBAC permission, not a second approval workflow', /isManager=Boolean\(req\.user!\.isSuperUser\|\|req\.user!\.permissions\.includes\('credit\.manage_limit'\)\)/.test(payments));
ok('11. changing a limit needs that same permission and is audited', /router\.put\('\/accounts\/:id\/limit', requirePermission\('credit\.manage_limit'\)/.test(credit) && /action: 'CREDIT_LIMIT_CHANGED'/.test(credit));
ok('12. available credit is computed as limit minus debt, server-side', /centsText\(moneyCents\(a\.credit_limit\) - moneyCents\(a\.current_balance\)\)/.test(credit));

// ---------------------------------------------------------------- 4. a credit sale is a sale, NOT cash
ok('13. THE CORE RULE: only CASH and CARD ever touch a shift total on a sale', /if\(method==='CASH'\|\|method==='CARD'\)\{/.test(payments) && /const col=method==='CASH'\?'cash_sales':'card_sales'/.test(payments));
ok('14. so a CREDIT sale adds nothing to cash_sales -- it only creates the receivable', !/CREDIT[^\n]{0,80}cash_sales/.test(payments));
ok('15. a CASH repayment IS a drawer inflow, but lands in its own column, never in cash_sales', /if \(method === 'CASH'\) \{[\s\S]{0,420}UPDATE cash_shifts SET credit_repayments=credit_repayments\+/.test(credit) && !/UPDATE cash_shifts SET cash_sales/.test(credit));
ok('16. a repayment never creates an order or a payment -- it is not a new sale', !/INSERT INTO payments|INSERT INTO orders/.test(credit));
ok('17. and the reports keep issued and repaid apart', /type IN \('CREDIT'\)/.test(credit) && /type IN \('REPAYMENT','PAYROLL_DEDUCTION'\)/.test(credit));

// ---------------------------------------------------------------- 5. payroll deduction needs a manager
ok('18. payroll deduction is refused unless the requesting user may approve it', /method === 'PAYROLL_DEDUCTION' && !\(req\.user!\.isSuperUser \|\| req\.user!\.permissions\.includes\('credit\.manage_limit'\)\)/.test(credit) && /PAYROLL_DEDUCTION_REQUIRES_APPROVAL/.test(credit));
ok('19. it is never automatic -- the approver is stamped onto the row', /const approvedBy = method === 'PAYROLL_DEDUCTION' \? req\.user!\.id : null;/.test(credit));
ok('20. and it is NOT a cash inflow: only CASH moves the drawer', (() => {
  const body = /router\.post\('\/repay'[\s\S]*?\n\}\);/.exec(credit)[0];
  return (body.match(/UPDATE cash_shifts/g) || []).length === 1 && /if \(method === 'CASH'\)/.test(body);
})());
ok('21. every repayment is idempotent on branch + key and audited', /WHERE branch_id=\? AND idempotency_key=\?/.test(credit) && /action: 'CREDIT_REPAYMENT_RECORDED'/.test(credit));
ok('22. and can never exceed the debt', /REPAYMENT_EXCEEDS_BALANCE/.test(credit));

// ---------------------------------------------------------------- 6. staff credit reuses the employee identity
ok('23. an employee account points at the existing users row -- there is no second employee model', /const employee = await tx\.queryOne<any>\('SELECT id FROM users WHERE id=\? AND deleted_at IS NULL'/.test(credit) && !/INSERT INTO users/.test(credit));
ok('24. and opening one twice returns the existing account instead of duplicating it', /const existing = await tx\.queryOne<any>\('SELECT \* FROM credit_accounts WHERE branch_id=\? AND employee_id=\?'[\s\S]{0,120}if \(existing\) return \{ account: existing, existed: true \};/.test(credit));
ok('25. the staff report joins the real users table and its real role', /FROM credit_accounts ca[\s\S]{0,400}JOIN users u ON u\.id=ca\.employee_id/.test(credit));

// ---------------------------------------------------------------- 7. an archived employee keeps the debt
ok('26. THE RULE: the staff report does NOT filter archived employees out', (() => {
  const body = /router\.get\('\/reports\/staff'[\s\S]*?\n\}\);/.exec(credit)[0];
  return /u\.deleted_at IS NOT NULL\) AS archived/.test(body) && !/u\.deleted_at IS NULL/.test(body);
})());
ok('27. nor does the account drill-down -- it says archived instead of hiding the owner', (() => {
  const body = /router\.get\('\/accounts\/:id'[\s\S]*?\n\}\);/.exec(credit)[0];
  return /\(deleted_at IS NOT NULL\) AS archived FROM users WHERE id=\?/.test(body) && !/deleted_at IS NULL/.test(body);
})());
ok('28. and their employment status travels with the row so the debt is explainable', /u\.employment_status/.test(credit) && /full_name AS name,phone,employment_status/.test(credit));
ok('29. nothing on this path physically deletes an account or a movement', !/DELETE FROM credit_accounts|DELETE FROM credit_transactions/.test(credit));

// ---------------------------------------------------------------- 8. debtor-status filter + drill-down
ok('30. the three debtor statuses are declared once and applied by the SERVER', /export const CREDIT_DEBTOR_STATUSES = \['WITH_DEBT', 'SETTLED', 'OVER_LIMIT'\] as const;/.test(credit) && (credit.match(/debtorStatusFilter\(req\)/g) || []).length >= 4);
ok('31. an unknown status silently means "no filter" rather than an empty report', /if \(!raw \|\| !\(CREDIT_DEBTOR_STATUSES as readonly string\[\]\)\.includes\(raw\)\) return \{ sql: '', status: null as string \| null \};/.test(credit));
ok('32. OVER_LIMIT compares each account against ITS OWN limit, not a global one', /current_balance > \$\{alias\}\.credit_limit/.test(credit));
ok('33. both debtor reports echo the applied status and flag every over-limit row', (credit.match(/status: debtorStatusFilter\(req\)\.status/g) || []).length === 2 && (credit.match(/over_limit: moneyCents\(r\.current_balance\) > moneyCents\(r\.credit_limit\)/g) || []).length === 2);
ok('34. the drill-down is period-scoped through the shared period filter', /periodFilter\(req, 'ct\.created_at'\)/.test(/router\.get\('\/accounts\/:id'[\s\S]*?\n\}\);/.exec(credit)[0]));
ok('35. and names the cashier and the approving manager of every movement', /LEFT JOIN users u ON u\.id=ct\.cashier_user_id LEFT JOIN users ap ON ap\.id=ct\.approved_by/.test(credit));
ok('36. the cashier report attributes each movement to who took it and for whom', /u\.full_name AS cashier_name,\s*\n?\s*COALESCE\(cu\.name, eu\.full_name\) AS recipient_name/.test(credit));
ok('37. the branch report separates customer receivables from staff receivables', /ca\.type='CUSTOMER'\),0\) AS customer_outstanding/.test(credit) && /ca\.type='EMPLOYEE'\),0\) AS staff_outstanding/.test(credit));

// ---------------------------------------------------------------- 9. RBAC, isolation, frontend
ok('38. every credit route is permission-gated', (credit.match(/router\.(get|post|put)\('[^']+', requirePermission\('credit\./g) || []).length >= 9);
ok('39. and branch-checked with the existing helper -- reports included', (credit.match(/allowed\(req, (b|a\.branch_id|account\.branch_id|preCheck\.branch_id)\)/g) || []).length >= 6);
ok('40. the credit permissions are the existing seeded ones, not new parallel ones', ['credit.view', 'credit.issue', 'credit.repay', 'credit.reports', 'credit.manage_limit'].every(p => seed.includes(p)));
ok('41. the frontend asks the SERVER to filter by status and by period -- it computes nothing', /getCreditReportCustomers: \(branch_id:string,status\?:string\)/.test(api) && /getCreditAccount: \(id:string,params\?:\{start\?:string;end\?:string\}\)/.test(api));
ok('42. and renders the server flags rather than deriving them in the browser', /r\.over_limit &&/.test(view) && /r\.archived &&/.test(view) && !/current_balance\) > Number\(/.test(view));
ok('43. the manager screen offers the three debtor statuses and a drill-down', /'WITH_DEBT'/.test(view) && /'SETTLED'/.test(view) && /'OVER_LIMIT'/.test(view) && /api\.getCreditAccount\(accountId, period\(\)\)/.test(view));
ok('44. the whole screen stays bilingual', /ru \? 'Сверх лимита' : 'Çäkden aşa'/.test(view) && /ru \? 'АРХИВ' : 'ARHIW'/.test(view));

console.log(`Stage 34.10 static checks: ${checks}`);
if (failures.length) { console.error(`\nFAILURES (${failures.length}):`); for (const f of failures) console.error(' - ' + f); process.exit(1); }
console.log('ALL STAGE 34.10 STATIC CHECKS PASSED');
