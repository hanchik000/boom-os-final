import { Router, Request } from 'express';
import crypto from 'node:crypto';
import { query, queryOne, execute, transaction, TxClient } from '../db';
import { authenticateToken, requirePermission, insertAuditLog } from '../auth';
import { requireOperatorPosSession } from './operator-pos';

const router = Router();
router.use(authenticateToken);

function allowed(req: Request, b: string) { return Boolean(req.user?.isSuperUser || req.user?.allowedBranchIds.includes(b)); }
function id(prefix: string) { return `${prefix}_${crypto.randomUUID()}`; }
function moneyCents(v: unknown): bigint {
  const s = String(v ?? '').trim();
  if (!/^-?\d+(?:\.\d{1,2})?$/.test(s)) throw new Error('INVALID_MONEY');
  const neg = s.startsWith('-');
  const clean = neg ? s.slice(1) : s;
  const [a, b = ''] = clean.split('.');
  const c = BigInt(a) * 100n + BigInt((b + '00').slice(0, 2));
  return neg ? -c : c;
}
function centsText(c: bigint): string { const neg = c < 0n; const abs = neg ? -c : c; return `${neg ? '-' : ''}${abs / 100n}.${(abs % 100n).toString().padStart(2, '0')}`; }

// ================================================================================================
// applyCreditSale -- called from payments.ts, inside the SAME transaction as the payment insert,
// when method === 'CREDIT'. This is the one place a CreditTransaction of type CREDIT is ever
// created and a CreditAccount.current_balance is ever increased for a sale. Not a second payment
// path: the caller (payments.ts) has already validated the order/idempotency/remaining-balance
// exactly as it does for CASH/CARD -- this only adds the receivable bookkeeping on top.
// ================================================================================================
export async function applyCreditSale(tx: TxClient, opts: {
  branchId: string; accountId: string; amount: bigint; orderId: string; paymentId: string;
  cashierUserId: string; isManager: boolean; now: string;
}) {
  const account = await tx.queryOne<any>('SELECT * FROM credit_accounts WHERE id=? AND branch_id=? FOR UPDATE', [opts.accountId, opts.branchId]);
  if (!account || account.status !== 'ACTIVE') throw Object.assign(new Error('CREDIT_ACCOUNT_NOT_FOUND'), { httpStatus: 404 });
  const limitCents = moneyCents(account.credit_limit);
  const balanceCents = moneyCents(account.current_balance);
  const available = limitCents - balanceCents;
  // A cashier can issue credit only within the approved available limit. A manager (holding
  // credit.manage_limit) may push an over-limit sale through -- this is the existing RBAC
  // permission system acting as the approval gate, not a second approval workflow.
  if (opts.amount > available && !opts.isManager) {
    throw Object.assign(new Error('CREDIT_LIMIT_EXCEEDED'), { httpStatus: 409, details: { credit_limit: account.credit_limit, current_balance: account.current_balance, available: centsText(available), requested: centsText(opts.amount) } });
  }
  const newBalance = balanceCents + opts.amount;
  await tx.execute('UPDATE credit_accounts SET current_balance=CAST(? AS numeric),updated_at=? WHERE id=?', [centsText(newBalance), opts.now, account.id]);
  const txId = id('ctx');
  await tx.execute(`INSERT INTO credit_transactions (id,credit_account_id,type,amount,order_id,payment_id,branch_id,cashier_user_id,created_at) VALUES (?,?,'CREDIT',CAST(? AS numeric),?,?,?,?,?)`,
    [txId, account.id, centsText(opts.amount), opts.orderId, opts.paymentId, opts.branchId, opts.cashierUserId, opts.now]);
  return { account: await tx.queryOne<any>('SELECT * FROM credit_accounts WHERE id=?', [account.id]), transactionId: txId };
}

// ---------------------------------------------------------------- Customers (minimal CRM seed)
router.post('/customers', requirePermission('credit.issue'), async (req, res) => {
  const b = String(req.body?.branch_id || ''); if (!b || !allowed(req, b)) return res.status(403).json({ error: 'BRANCH_ACCESS_DENIED', code: 'BRANCH_ACCESS_DENIED', message: 'Branch is outside your access scope.', details: {} });
  const name = String(req.body?.name || '').trim();
  const phone = String(req.body?.phone || '').trim();
  if (!name || !phone) return res.status(400).json({ error: 'VALIDATION_ERROR', code: 'CUSTOMER_FIELDS_REQUIRED', message: 'name and phone are required.', details: {} });
  const existing = await queryOne<any>('SELECT * FROM customers WHERE branch_id=? AND phone=? AND deleted_at IS NULL', [b, phone]);
  if (existing) { res.status(200).json({ customer: existing, existed: true }); return; }
  const now = new Date().toISOString(), cid = id('cust');
  await transaction(async (tx) => {
    await tx.execute('INSERT INTO customers (id,branch_id,name,phone,email,status,created_at,updated_at) VALUES (?,?,?,?,?,\'ACTIVE\',?,?)', [cid, b, name, phone, req.body?.email ? String(req.body.email) : null, now, now]);
    await insertAuditLog(tx.execute, { userId: req.user!.id, branchId: b, action: 'CREDIT_CUSTOMER_CREATED', entityType: 'CUSTOMER', entityId: cid, newValues: { name, phone }, req });
  });
  res.status(201).json({ customer: await queryOne<any>('SELECT * FROM customers WHERE id=?', [cid]), existed: false });
});

router.get('/customers', requirePermission('credit.view'), async (req, res) => {
  const b = String(req.query.branch_id || req.user!.branch_id || ''); if (!b || !allowed(req, b)) return res.status(403).json({ error: 'BRANCH_ACCESS_DENIED', code: 'BRANCH_ACCESS_DENIED', message: 'Branch is outside your access scope.', details: {} });
  const search = typeof req.query.search === 'string' ? `%${req.query.search.trim()}%` : null;
  const where = search ? 'branch_id=? AND deleted_at IS NULL AND (name ILIKE ? OR phone ILIKE ?)' : 'branch_id=? AND deleted_at IS NULL';
  const params = search ? [b, search, search] : [b];
  res.json({ customers: await query<any>(`SELECT * FROM customers WHERE ${where} ORDER BY name LIMIT 100`, params) });
});

router.get('/customers/:id', requirePermission('credit.view'), async (req, res) => {
  const c = await queryOne<any>('SELECT * FROM customers WHERE id=? AND deleted_at IS NULL', [req.params.id]);
  if (!c) return res.status(404).json({ error: 'NOT_FOUND', code: 'CUSTOMER_NOT_FOUND', message: 'Customer not found.', details: {} });
  if (!allowed(req, c.branch_id)) return res.status(403).json({ error: 'BRANCH_ACCESS_DENIED', code: 'BRANCH_ACCESS_DENIED', message: 'Customer belongs to an unauthorized branch.', details: {} });
  const account = await queryOne<any>(`SELECT * FROM credit_accounts WHERE branch_id=? AND customer_id=?`, [c.branch_id, c.id]);
  const orders = await query<any>(`SELECT DISTINCT o.id,o.order_number,o.final_amount,o.created_at FROM credit_transactions ct JOIN orders o ON o.id=ct.order_id WHERE ct.credit_account_id=? ORDER BY o.created_at DESC LIMIT 50`, account ? [account.id] : ['__none__']);
  const transactions = account ? await query<any>('SELECT * FROM credit_transactions WHERE credit_account_id=? ORDER BY created_at DESC LIMIT 100', [account.id]) : [];
  res.json({ customer: c, account, orders, transactions });
});

// ---------------------------------------------------------------- Credit accounts
router.post('/accounts', requirePermission('credit.issue'), async (req, res) => {
  const b = String(req.body?.branch_id || ''); if (!b || !allowed(req, b)) return res.status(403).json({ error: 'BRANCH_ACCESS_DENIED', code: 'BRANCH_ACCESS_DENIED', message: 'Branch is outside your access scope.', details: {} });
  const type = String(req.body?.type || '').toUpperCase();
  if (!['CUSTOMER', 'EMPLOYEE'].includes(type)) return res.status(400).json({ error: 'VALIDATION_ERROR', code: 'INVALID_CREDIT_ACCOUNT_TYPE', message: 'type must be CUSTOMER or EMPLOYEE.', details: {} });
  const now = new Date().toISOString();
  try {
    const result = await transaction(async (tx) => {
      if (type === 'CUSTOMER') {
        const customerId = String(req.body?.customer_id || '');
        const customer = await tx.queryOne<any>('SELECT id FROM customers WHERE id=? AND branch_id=? AND deleted_at IS NULL', [customerId, b]);
        if (!customer) throw Object.assign(new Error('CUSTOMER_NOT_FOUND'), { httpStatus: 404 });
        const existing = await tx.queryOne<any>('SELECT * FROM credit_accounts WHERE branch_id=? AND customer_id=?', [b, customerId]);
        if (existing) return { account: existing, existed: true };
        const aid = id('cra');
        await tx.execute(`INSERT INTO credit_accounts (id,type,customer_id,branch_id,credit_limit,current_balance,status,created_at,updated_at) VALUES (?,'CUSTOMER',?,?,0,0,'ACTIVE',?,?)`, [aid, customerId, b, now, now]);
        await insertAuditLog(tx.execute, { userId: req.user!.id, branchId: b, action: 'CREDIT_ACCOUNT_CREATED', entityType: 'CREDIT_ACCOUNT', entityId: aid, newValues: { type: 'CUSTOMER', customer_id: customerId }, req });
        return { account: await tx.queryOne<any>('SELECT * FROM credit_accounts WHERE id=?', [aid]), existed: false };
      } else {
        const employeeId = String(req.body?.employee_id || '');
        // Employee credit MUST reuse the existing employee/HR identity -- no second employee
        // model. branch_id here is the account's own branch, not necessarily the employee's
        // CURRENT primary branch, so an archived/transferred employee's account is still
        // reachable; but the employee row itself must genuinely exist.
        const employee = await tx.queryOne<any>('SELECT id FROM users WHERE id=? AND deleted_at IS NULL', [employeeId]);
        if (!employee) throw Object.assign(new Error('EMPLOYEE_NOT_FOUND'), { httpStatus: 404 });
        const existing = await tx.queryOne<any>('SELECT * FROM credit_accounts WHERE branch_id=? AND employee_id=?', [b, employeeId]);
        if (existing) return { account: existing, existed: true };
        const aid = id('cra');
        await tx.execute(`INSERT INTO credit_accounts (id,type,employee_id,branch_id,credit_limit,current_balance,status,created_at,updated_at) VALUES (?,'EMPLOYEE',?,?,0,0,'ACTIVE',?,?)`, [aid, employeeId, b, now, now]);
        await insertAuditLog(tx.execute, { userId: req.user!.id, branchId: b, action: 'CREDIT_ACCOUNT_CREATED', entityType: 'CREDIT_ACCOUNT', entityId: aid, newValues: { type: 'EMPLOYEE', employee_id: employeeId }, req });
        return { account: await tx.queryOne<any>('SELECT * FROM credit_accounts WHERE id=?', [aid]), existed: false };
      }
    });
    res.status(result.existed ? 200 : 201).json(result);
  } catch (e: any) {
    const map: any = { CUSTOMER_NOT_FOUND: [404, 'NOT_FOUND', 'CUSTOMER_NOT_FOUND'], EMPLOYEE_NOT_FOUND: [404, 'NOT_FOUND', 'EMPLOYEE_NOT_FOUND'] };
    if (map[e.message]) return res.status(map[e.message][0]).json({ error: map[e.message][1], code: map[e.message][2], message: e.message, details: {} });
    throw e;
  }
});

router.get('/accounts/:id', requirePermission('credit.view'), async (req, res) => {
  const a = await queryOne<any>('SELECT * FROM credit_accounts WHERE id=?', [req.params.id]);
  if (!a) return res.status(404).json({ error: 'NOT_FOUND', code: 'CREDIT_ACCOUNT_NOT_FOUND', message: 'Credit account not found.', details: {} });
  if (!allowed(req, a.branch_id)) return res.status(403).json({ error: 'BRANCH_ACCESS_DENIED', code: 'BRANCH_ACCESS_DENIED', message: 'Credit account belongs to an unauthorized branch.', details: {} });
  const owner = a.type === 'CUSTOMER'
    ? await queryOne<any>('SELECT id,name,phone FROM customers WHERE id=?', [a.customer_id])
    : await queryOne<any>('SELECT id,full_name AS name,phone FROM users WHERE id=?', [a.employee_id]);
  const transactions = await query<any>('SELECT * FROM credit_transactions WHERE credit_account_id=? ORDER BY created_at DESC LIMIT 200', [a.id]);
  const available = centsText(moneyCents(a.credit_limit) - moneyCents(a.current_balance));
  res.json({ account: a, owner, available_credit: available, transactions });
});

router.put('/accounts/:id/limit', requirePermission('credit.manage_limit'), async (req, res) => {
  const a = await queryOne<any>('SELECT * FROM credit_accounts WHERE id=?', [req.params.id]);
  if (!a) return res.status(404).json({ error: 'NOT_FOUND', code: 'CREDIT_ACCOUNT_NOT_FOUND', message: 'Credit account not found.', details: {} });
  if (!allowed(req, a.branch_id)) return res.status(403).json({ error: 'BRANCH_ACCESS_DENIED', code: 'BRANCH_ACCESS_DENIED', message: 'Credit account belongs to an unauthorized branch.', details: {} });
  let limitCents: bigint;
  try { limitCents = moneyCents(req.body?.credit_limit); } catch { return res.status(400).json({ error: 'VALIDATION_ERROR', code: 'INVALID_CREDIT_LIMIT', message: 'credit_limit must be a non-negative amount with up to two decimals.', details: {} }); }
  if (limitCents < 0n) return res.status(400).json({ error: 'VALIDATION_ERROR', code: 'INVALID_CREDIT_LIMIT', message: 'credit_limit cannot be negative.', details: {} });
  const now = new Date().toISOString();
  await transaction(async (tx) => {
    await tx.execute('UPDATE credit_accounts SET credit_limit=CAST(? AS numeric),updated_at=? WHERE id=?', [centsText(limitCents), now, a.id]);
    await insertAuditLog(tx.execute, { userId: req.user!.id, branchId: a.branch_id, action: 'CREDIT_LIMIT_CHANGED', entityType: 'CREDIT_ACCOUNT', entityId: a.id, oldValues: { credit_limit: a.credit_limit }, newValues: { credit_limit: centsText(limitCents) }, req });
  });
  res.json({ account: await queryOne<any>('SELECT * FROM credit_accounts WHERE id=?', [a.id]) });
});

// ---------------------------------------------------------------- Repayment (full or partial)
const REPAYMENT_METHODS = new Set(['CASH', 'CARD', 'ONLINE', 'BONUS', 'OTHER', 'PAYROLL_DEDUCTION']);
router.post('/repay', requirePermission('credit.repay'), requireOperatorPosSession, async (req, res) => {
  const accountId = String(req.body?.account_id || '');
  const method = String(req.body?.method || '').toUpperCase();
  const idem = String(req.headers['idempotency-key'] || '').trim().slice(0, 128);
  if (!accountId || !REPAYMENT_METHODS.has(method) || !idem) return res.status(400).json({ error: 'VALIDATION_ERROR', code: 'REPAYMENT_FIELDS_REQUIRED', message: 'account_id, a supported method and Idempotency-Key are required.', details: {} });
  let requested: bigint;
  try { requested = moneyCents(req.body?.amount); } catch { return res.status(400).json({ error: 'VALIDATION_ERROR', code: 'INVALID_REPAYMENT_AMOUNT', message: 'amount must be a positive amount with up to two decimals.', details: {} }); }
  if (requested <= 0n) return res.status(400).json({ error: 'VALIDATION_ERROR', code: 'REPAYMENT_AMOUNT_MUST_BE_POSITIVE', message: 'Repayment amount must be positive.', details: {} });
  // Payroll deduction must never happen automatically: it requires the REQUESTING user to
  // themselves hold credit.manage_limit (a manager/admin submitting it), recorded as the
  // approver -- the same RBAC-as-approval-gate pattern used for over-limit credit sales, not a
  // second approval workflow.
  if (method === 'PAYROLL_DEDUCTION' && !(req.user!.isSuperUser || req.user!.permissions.includes('credit.manage_limit'))) {
    return res.status(403).json({ error: 'FORBIDDEN', code: 'PAYROLL_DEDUCTION_REQUIRES_APPROVAL', message: 'Payroll deduction requires an authorized manager to submit it.', details: {} });
  }
  const now = new Date().toISOString();
  try {
    const result = await transaction(async (tx) => {
      const account = await tx.queryOne<any>('SELECT * FROM credit_accounts WHERE id=? FOR UPDATE', [accountId]);
      if (!account) throw Object.assign(new Error('CREDIT_ACCOUNT_NOT_FOUND'), { httpStatus: 404 });
      if (!allowed(req, account.branch_id)) throw Object.assign(new Error('BRANCH_ACCESS_DENIED'), { httpStatus: 403 });
      const existing = await tx.queryOne<any>('SELECT * FROM credit_transactions WHERE branch_id=? AND idempotency_key=?', [account.branch_id, idem]);
      if (existing) return { transaction: existing, account: await tx.queryOne<any>('SELECT * FROM credit_accounts WHERE id=?', [account.id]), replayed: true };
      const balance = moneyCents(account.current_balance);
      if (requested > balance) throw Object.assign(new Error('REPAYMENT_EXCEEDS_BALANCE'), { httpStatus: 409, details: { current_balance: account.current_balance, requested: centsText(requested) } });
      const newBalance = balance - requested;
      await tx.execute('UPDATE credit_accounts SET current_balance=CAST(? AS numeric),updated_at=? WHERE id=?', [centsText(newBalance), now, account.id]);
      const txId = id('ctx');
      const txType = method === 'PAYROLL_DEDUCTION' ? 'PAYROLL_DEDUCTION' : 'REPAYMENT';
      const approvedBy = method === 'PAYROLL_DEDUCTION' ? req.user!.id : null;
      await tx.execute(`INSERT INTO credit_transactions (id,credit_account_id,type,amount,branch_id,cashier_user_id,approved_by,method,note,idempotency_key,created_at) VALUES (?,?,?,CAST(? AS numeric),?,?,?,?,?,?,?)`,
        [txId, account.id, txType, centsText(requested), account.branch_id, req.user!.id, approvedBy, method, req.body?.note ? String(req.body.note).trim().slice(0, 500) : null, idem, now]);
      // Cash physically received into the drawer -- tracked separately from cash_sales so
      // reports never count this repayment as a new sale, while the shift still reconciles.
      if (method === 'CASH') {
        const shift = await tx.queryOne<any>(`SELECT id FROM cash_shifts WHERE branch_id=? AND status='OPEN' FOR UPDATE`, [account.branch_id]);
        if (shift) await tx.execute('UPDATE cash_shifts SET credit_repayments=credit_repayments+CAST(? AS numeric),expected_cash=expected_cash+CAST(? AS numeric),updated_at=? WHERE id=?', [centsText(requested), centsText(requested), now, shift.id]);
      }
      await insertAuditLog(tx.execute, { userId: req.user!.id, branchId: account.branch_id, action: 'CREDIT_REPAYMENT_RECORDED', entityType: 'CREDIT_TRANSACTION', entityId: txId, newValues: { account_id: account.id, amount: centsText(requested), method, approved_by: approvedBy }, req });
      return { transaction: await tx.queryOne<any>('SELECT * FROM credit_transactions WHERE id=?', [txId]), account: await tx.queryOne<any>('SELECT * FROM credit_accounts WHERE id=?', [account.id]), replayed: false };
    });
    res.status(result.replayed ? 200 : 201).json(result);
  } catch (e: any) {
    const map: any = { CREDIT_ACCOUNT_NOT_FOUND: [404, 'NOT_FOUND', 'CREDIT_ACCOUNT_NOT_FOUND'], BRANCH_ACCESS_DENIED: [403, 'BRANCH_ACCESS_DENIED', 'BRANCH_ACCESS_DENIED'], REPAYMENT_EXCEEDS_BALANCE: [409, 'INVALID_STATE', 'REPAYMENT_EXCEEDS_BALANCE'] };
    if (map[e.message]) return res.status(map[e.message][0]).json({ error: map[e.message][1], code: map[e.message][2], message: e.message, details: e.details || {} });
    throw e;
  }
});

// ---------------------------------------------------------------- Adjustment (manager-only, audited)
router.post('/accounts/:id/adjust', requirePermission('credit.manage_limit'), async (req, res) => {
  const preCheck = await queryOne<any>('SELECT branch_id FROM credit_accounts WHERE id=?', [req.params.id]);
  if (!preCheck) return res.status(404).json({ error: 'NOT_FOUND', code: 'CREDIT_ACCOUNT_NOT_FOUND', message: 'Credit account not found.', details: {} });
  if (!allowed(req, preCheck.branch_id)) return res.status(403).json({ error: 'BRANCH_ACCESS_DENIED', code: 'BRANCH_ACCESS_DENIED', message: 'Credit account belongs to an unauthorized branch.', details: {} });
  let amount: bigint;
  try { amount = moneyCents(req.body?.amount); } catch { return res.status(400).json({ error: 'VALIDATION_ERROR', code: 'INVALID_ADJUSTMENT_AMOUNT', message: 'amount must be a signed amount with up to two decimals.', details: {} }); }
  const note = req.body?.note ? String(req.body.note).trim().slice(0, 500) : null;
  if (!note) return res.status(400).json({ error: 'VALIDATION_ERROR', code: 'ADJUSTMENT_NOTE_REQUIRED', message: 'A note is required for a manual balance adjustment.', details: {} });
  const now = new Date().toISOString();
  const result = await transaction(async (tx) => {
    const a = await tx.queryOne<any>('SELECT * FROM credit_accounts WHERE id=? FOR UPDATE', [req.params.id]);
    if (!a) throw Object.assign(new Error('CREDIT_ACCOUNT_NOT_FOUND'), { httpStatus: 404 });
    const balance = moneyCents(a.current_balance);
    const newBalance = balance + amount;
    if (newBalance < 0n) throw Object.assign(new Error('ADJUSTMENT_WOULD_GO_NEGATIVE'), { httpStatus: 409 });
    await tx.execute('UPDATE credit_accounts SET current_balance=CAST(? AS numeric),updated_at=? WHERE id=?', [centsText(newBalance), now, a.id]);
    const txId = id('ctx');
    await tx.execute(`INSERT INTO credit_transactions (id,credit_account_id,type,amount,branch_id,cashier_user_id,approved_by,note,created_at) VALUES (?,?,'ADJUSTMENT',CAST(? AS numeric),?,?,?,?,?)`, [txId, a.id, centsText(amount), a.branch_id, req.user!.id, req.user!.id, note, now]);
    await insertAuditLog(tx.execute, { userId: req.user!.id, branchId: a.branch_id, action: 'CREDIT_ADJUSTMENT_POSTED', entityType: 'CREDIT_TRANSACTION', entityId: txId, oldValues: { current_balance: a.current_balance }, newValues: { current_balance: centsText(newBalance), amount: centsText(amount), note }, req });
    return { transaction: await tx.queryOne<any>('SELECT * FROM credit_transactions WHERE id=?', [txId]), account: await tx.queryOne<any>('SELECT * FROM credit_accounts WHERE id=?', [a.id]) };
  }).catch((e: any) => { if (e.message === 'ADJUSTMENT_WOULD_GO_NEGATIVE' || e.message === 'CREDIT_ACCOUNT_NOT_FOUND') return { failed: e.message }; throw e; });
  if (result && 'failed' in result) {
    if (result.failed === 'CREDIT_ACCOUNT_NOT_FOUND') return res.status(404).json({ error: 'NOT_FOUND', code: 'CREDIT_ACCOUNT_NOT_FOUND', message: 'Credit account not found.', details: {} });
    return res.status(409).json({ error: 'INVALID_STATE', code: 'ADJUSTMENT_WOULD_GO_NEGATIVE', message: 'This adjustment would drive the balance below zero.', details: {} });
  }
  res.status(201).json(result);
});

// ---------------------------------------------------------------- Transactions (filtered list / drill-down)
router.get('/transactions', requirePermission('credit.view'), async (req, res) => {
  const b = String(req.query.branch_id || req.user!.branch_id || ''); if (!b || !allowed(req, b)) return res.status(403).json({ error: 'BRANCH_ACCESS_DENIED', code: 'BRANCH_ACCESS_DENIED', message: 'Branch is outside your access scope.', details: {} });
  const where: string[] = ['ct.branch_id=?']; const params: any[] = [b];
  if (typeof req.query.type === 'string' && req.query.type) { where.push('ct.type=?'); params.push(req.query.type); }
  if (typeof req.query.cashier_id === 'string' && req.query.cashier_id) { where.push('ct.cashier_user_id=?'); params.push(req.query.cashier_id); }
  if (typeof req.query.account_id === 'string' && req.query.account_id) { where.push('ct.credit_account_id=?'); params.push(req.query.account_id); }
  if (typeof req.query.start === 'string' && req.query.start) { where.push('ct.created_at>=?'); params.push(req.query.start); }
  if (typeof req.query.end === 'string' && req.query.end) { where.push('ct.created_at<=?'); params.push(req.query.end); }
  const rows = await query<any>(`SELECT ct.*,ca.type AS account_type,cu.name AS customer_name,cu.phone AS customer_phone,eu.full_name AS employee_name,u.full_name AS cashier_name,o.order_number
    FROM credit_transactions ct
    JOIN credit_accounts ca ON ca.id=ct.credit_account_id
    LEFT JOIN customers cu ON cu.id=ca.customer_id
    LEFT JOIN users eu ON eu.id=ca.employee_id
    LEFT JOIN users u ON u.id=ct.cashier_user_id
    LEFT JOIN orders o ON o.id=ct.order_id
    WHERE ${where.join(' AND ')} ORDER BY ct.created_at DESC LIMIT 500`, params);
  res.json({ transactions: rows });
});

// ---------------------------------------------------------------- Reports
function periodFilter(req: Request, col = 'created_at') {
  const where: string[] = []; const params: any[] = [];
  if (typeof req.query.start === 'string' && req.query.start) { where.push(`${col}>=?`); params.push(req.query.start); }
  if (typeof req.query.end === 'string' && req.query.end) { where.push(`${col}<=?`); params.push(req.query.end); }
  return { where, params };
}

router.get('/reports/overview', requirePermission('credit.reports'), async (req, res) => {
  const b = String(req.query.branch_id || req.user!.branch_id || ''); if (!b || !allowed(req, b)) return res.status(403).json({ error: 'BRANCH_ACCESS_DENIED', code: 'BRANCH_ACCESS_DENIED', message: 'Branch is outside your access scope.', details: {} });
  const { where, params } = periodFilter(req);
  const whereSql = ['branch_id=?', ...where].join(' AND ');
  const issued = await queryOne<any>(`SELECT COALESCE(SUM(amount),0) AS total, COUNT(*)::int AS count FROM credit_transactions WHERE type IN ('CREDIT') AND ${whereSql}`, [b, ...params]);
  const repaid = await queryOne<any>(`SELECT COALESCE(SUM(amount),0) AS total, COUNT(*)::int AS count FROM credit_transactions WHERE type IN ('REPAYMENT','PAYROLL_DEDUCTION') AND ${whereSql}`, [b, ...params]);
  const partial = await queryOne<any>(`SELECT COUNT(*)::int AS count FROM credit_transactions ct WHERE ct.type='REPAYMENT' AND ct.amount < (SELECT ca.credit_limit FROM credit_accounts ca WHERE ca.id=ct.credit_account_id) AND ${['ct.branch_id=?', ...where.map(w=>'ct.'+w)].join(' AND ')}`, [b, ...params]).catch(() => ({ count: 0 }));
  const outstanding = await queryOne<any>(`SELECT COALESCE(SUM(current_balance),0) AS total, COUNT(*) FILTER (WHERE current_balance > 0)::int AS debtors FROM credit_accounts WHERE branch_id=?`, [b]);
  res.json({
    branch_id: b, period: { start: req.query.start || null, end: req.query.end || null },
    credits_issued: issued?.count || 0, amount_issued: String(issued?.total || '0'),
    repayments: repaid?.count || 0, repaid_amount: String(repaid?.total || '0'),
    current_outstanding: String(outstanding?.total || '0'), debtor_count: outstanding?.debtors || 0,
    partial_payment_count: partial?.count || 0,
  });
});

router.get('/reports/customers', requirePermission('credit.reports'), async (req, res) => {
  const b = String(req.query.branch_id || req.user!.branch_id || ''); if (!b || !allowed(req, b)) return res.status(403).json({ error: 'BRANCH_ACCESS_DENIED', code: 'BRANCH_ACCESS_DENIED', message: 'Branch is outside your access scope.', details: {} });
  const rows = await query<any>(`SELECT c.id AS customer_id,c.name,c.phone,ca.id AS account_id,ca.credit_limit,ca.current_balance,
      (SELECT COUNT(DISTINCT ct.order_id) FROM credit_transactions ct WHERE ct.credit_account_id=ca.id AND ct.type='CREDIT')::int AS orders,
      COALESCE((SELECT SUM(amount) FROM credit_transactions ct WHERE ct.credit_account_id=ca.id AND ct.type='CREDIT'),0) AS credit_issued,
      COALESCE((SELECT SUM(amount) FROM credit_transactions ct WHERE ct.credit_account_id=ca.id AND ct.type IN ('REPAYMENT','PAYROLL_DEDUCTION')),0) AS repayments,
      (SELECT MAX(created_at) FROM credit_transactions ct WHERE ct.credit_account_id=ca.id AND ct.type IN ('REPAYMENT','PAYROLL_DEDUCTION')) AS last_payment
    FROM credit_accounts ca JOIN customers c ON c.id=ca.customer_id WHERE ca.branch_id=? AND ca.type='CUSTOMER' ORDER BY ca.current_balance DESC`, [b]);
  const items = rows.map((r: any) => ({ ...r, available: centsText(moneyCents(r.credit_limit) - moneyCents(r.current_balance)), branch_id: b }));
  res.json({ branch_id: b, customers: items });
});

router.get('/reports/staff', requirePermission('credit.reports'), async (req, res) => {
  const b = String(req.query.branch_id || req.user!.branch_id || ''); if (!b || !allowed(req, b)) return res.status(403).json({ error: 'BRANCH_ACCESS_DENIED', code: 'BRANCH_ACCESS_DENIED', message: 'Branch is outside your access scope.', details: {} });
  const rows = await query<any>(`SELECT u.id AS employee_id,u.full_name,r.code AS role_code,ca.id AS account_id,ca.credit_limit,ca.current_balance,
      COALESCE((SELECT SUM(amount) FROM credit_transactions ct WHERE ct.credit_account_id=ca.id AND ct.type='CREDIT'),0) AS credit_issued,
      COALESCE((SELECT SUM(amount) FROM credit_transactions ct WHERE ct.credit_account_id=ca.id AND ct.type='REPAYMENT'),0) AS repayments,
      COALESCE((SELECT SUM(amount) FROM credit_transactions ct WHERE ct.credit_account_id=ca.id AND ct.type='PAYROLL_DEDUCTION'),0) AS payroll_deductions
    FROM credit_accounts ca JOIN users u ON u.id=ca.employee_id
    LEFT JOIN user_roles ur ON ur.user_id=u.id LEFT JOIN roles r ON r.id=ur.role_id
    WHERE ca.branch_id=? AND ca.type='EMPLOYEE' ORDER BY ca.current_balance DESC`, [b]);
  const seen = new Set<string>(); const items: any[] = [];
  for (const r of rows) { if (seen.has(r.employee_id)) continue; seen.add(r.employee_id); items.push({ ...r, available: centsText(moneyCents(r.credit_limit) - moneyCents(r.current_balance)), branch_id: b }); }
  res.json({ branch_id: b, staff: items });
});

router.get('/reports/branch', requirePermission('credit.reports'), async (req, res) => {
  const branchIds = req.user!.isSuperUser ? (await query<any>(`SELECT id FROM branches WHERE status='ACTIVE'`)).map((x: any) => x.id) : req.user!.allowedBranchIds;
  if (!branchIds.length) return res.json({ branches: [] });
  const ph = branchIds.map(() => '?').join(',');
  const rows = await query<any>(`SELECT b.id AS branch_id,b.name,
      COALESCE((SELECT SUM(amount) FROM credit_transactions ct WHERE ct.branch_id=b.id AND ct.type='CREDIT'),0) AS issued,
      COALESCE((SELECT SUM(amount) FROM credit_transactions ct WHERE ct.branch_id=b.id AND ct.type IN ('REPAYMENT','PAYROLL_DEDUCTION')),0) AS repaid,
      COALESCE((SELECT SUM(current_balance) FROM credit_accounts ca WHERE ca.branch_id=b.id),0) AS outstanding,
      (SELECT COUNT(*) FROM credit_accounts ca WHERE ca.branch_id=b.id AND ca.current_balance>0)::int AS debtor_count,
      COALESCE((SELECT SUM(current_balance) FROM credit_accounts ca WHERE ca.branch_id=b.id AND ca.type='CUSTOMER'),0) AS customer_outstanding,
      COALESCE((SELECT SUM(current_balance) FROM credit_accounts ca WHERE ca.branch_id=b.id AND ca.type='EMPLOYEE'),0) AS staff_outstanding
    FROM branches b WHERE b.id IN (${ph}) ORDER BY b.name`, branchIds);
  res.json({ branches: rows });
});

router.get('/reports/cashier', requirePermission('credit.reports'), async (req, res) => {
  const b = String(req.query.branch_id || req.user!.branch_id || ''); if (!b || !allowed(req, b)) return res.status(403).json({ error: 'BRANCH_ACCESS_DENIED', code: 'BRANCH_ACCESS_DENIED', message: 'Branch is outside your access scope.', details: {} });
  const { where, params } = periodFilter(req, 'ct.created_at');
  const whereSql = ['ct.branch_id=?', ...where].join(' AND ');
  const rows = await query<any>(`SELECT ct.id,ct.type,ct.amount,ct.created_at,ct.order_id,ct.approved_by,o.order_number,u.id AS cashier_id,u.full_name AS cashier_name,
      COALESCE(cu.name, eu.full_name) AS recipient_name
    FROM credit_transactions ct
    JOIN users u ON u.id=ct.cashier_user_id
    JOIN credit_accounts ca ON ca.id=ct.credit_account_id
    LEFT JOIN customers cu ON cu.id=ca.customer_id
    LEFT JOIN users eu ON eu.id=ca.employee_id
    LEFT JOIN orders o ON o.id=ct.order_id
    WHERE ${whereSql} ORDER BY ct.created_at DESC LIMIT 500`, [b, ...params]);
  res.json({ branch_id: b, transactions: rows });
});

export default router;
