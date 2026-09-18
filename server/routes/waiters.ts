import { Router, Request, Response, NextFunction } from 'express';
import crypto from 'node:crypto';
import { query, queryOne, execute, transaction } from '../db';
import { authenticateToken, requirePermission, insertAuditLog } from '../auth';

const router = Router();
const WAITER_CODE_LENGTH = 4;
const WAITER_SESSION_TTL_HOURS = Number(process.env.WAITER_SESSION_TTL_HOURS || 12);
const WAITER_IDLE_TIMEOUT_MINUTES = Number(process.env.WAITER_IDLE_TIMEOUT_MINUTES || 60);

if (!Number.isInteger(WAITER_SESSION_TTL_HOURS) || WAITER_SESSION_TTL_HOURS < 1 || WAITER_SESSION_TTL_HOURS > 24) {
  throw new Error('FATAL CONFIGURATION ERROR: WAITER_SESSION_TTL_HOURS must be an integer between 1 and 24.');
}
if (!Number.isInteger(WAITER_IDLE_TIMEOUT_MINUTES) || WAITER_IDLE_TIMEOUT_MINUTES < 5 || WAITER_IDLE_TIMEOUT_MINUTES > 720) {
  throw new Error('FATAL CONFIGURATION ERROR: WAITER_IDLE_TIMEOUT_MINUTES must be an integer between 5 and 720.');
}

function normalizeCode(value: unknown): string {
  return String(value ?? '').replace(/\D/g, '').slice(0, WAITER_CODE_LENGTH);
}

function hashWaiterCode(code: string): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET is required for waiter code security.');
  return crypto.createHmac('sha256', secret).update(`BOOM-WAITER-CODE:${code}`).digest('hex');
}

function hashSessionToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function clientIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  return (typeof forwarded === 'string' ? forwarded.split(',')[0].trim() : req.socket.remoteAddress) || 'unknown';
}

function auditId(): string {
  return `aud_${Date.now()}_${crypto.randomBytes(5).toString('hex')}`;
}

function hasManagementRole(req: Request): boolean {
  const roles = req.user?.roleCodes || [];
  return req.user?.isSuperUser === true || roles.includes('GENERAL_MANAGER') || roles.includes('BRANCH_MANAGER');
}

function requireWaiterCodeManager(req: Request, res: Response, next: NextFunction): void {
  if (!hasManagementRole(req)) {
    res.status(403).json({
      error: 'FORBIDDEN',
      code: 'WAITER_CODE_MANAGER_ONLY',
      message: 'Only a General Manager, Branch Manager, Owner or Super Admin can manage waiter POS codes.',
      details: {}
    });
    return;
  }
  next();
}

async function getWaiter(userId: string) {
  return queryOne<any>(`SELECT u.id,u.full_name,u.status,u.employment_status,u.branch_id,b.name AS branch_name,b.code AS branch_code,
    ep.employee_code,ep.position_title,ep.department,
    EXISTS(SELECT 1 FROM user_roles ur INNER JOIN roles r ON r.id=ur.role_id WHERE ur.user_id=u.id AND r.code='WAITER' AND r.status='ACTIVE') AS is_waiter
    FROM users u LEFT JOIN branches b ON b.id=u.branch_id INNER JOIN employee_profiles ep ON ep.user_id=u.id
    WHERE u.id=? AND u.deleted_at IS NULL`, [userId]);
}

async function assertTargetAccess(req: Request, employee: any): Promise<boolean> {
  if (req.user?.isSuperUser) return true;
  if (!employee.branch_id) return false;
  return req.user?.allowedBranchIds.includes(employee.branch_id) ?? false;
}

// A small in-process guard complements the global limiter. Production multi-node deployments
// should move this counter to Redis so all POS devices share the same attempt budget.
const authAttempts = new Map<string, { count: number; resetAt: number }>();
function allowCodeAttempt(key: string): boolean {
  const now = Date.now();
  const current = authAttempts.get(key);
  if (!current || current.resetAt <= now) {
    authAttempts.set(key, { count: 1, resetAt: now + 5 * 60_000 });
    return true;
  }
  if (current.count >= 15) return false;
  current.count += 1;
  return true;
}

async function revokeWaiterSessions(userId: string, changedBy: string): Promise<void> {
  const now = new Date().toISOString();
  await execute(`UPDATE waiter_pos_sessions SET status='REVOKED', revoked_at=?, last_seen_at=? WHERE user_id=? AND status='ACTIVE'`, [now, now, userId]);
  void changedBy;
}

async function createWaiterSession(waiter: any, deviceId: string) {
  const token = crypto.randomBytes(32).toString('base64url');
  const tokenHash = hashSessionToken(token);
  const now = new Date();
  const expires = new Date(now.getTime() + WAITER_SESSION_TTL_HOURS * 60 * 60 * 1000);
  const sessionId = `wps_${crypto.randomUUID()}`;
  await execute(`INSERT INTO waiter_pos_sessions (id,user_id,branch_id,device_id,token_hash,status,expires_at,last_seen_at,created_at)
    VALUES (?,?,?,?,?,'ACTIVE',?,?,?)`, [sessionId, waiter.id, waiter.branch_id, deviceId, tokenHash, expires.toISOString(), now.toISOString(), now.toISOString()]);
  return { token, sessionId, expiresAt: expires.toISOString() };
}

export async function getWaiterSession(req: Request) {
  const raw = req.headers['x-waiter-session'];
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const tokenHash = hashSessionToken(raw.trim());
  const session = await queryOne<any>(`SELECT s.id,s.user_id,s.branch_id,s.device_id,s.status,s.expires_at,s.last_seen_at,
      u.full_name,u.status AS user_status,u.employment_status,ep.employee_code,
      EXISTS(SELECT 1 FROM user_roles ur INNER JOIN roles r ON r.id=ur.role_id WHERE ur.user_id=u.id AND r.code='WAITER' AND r.status='ACTIVE') AS is_waiter
    FROM waiter_pos_sessions s
    INNER JOIN users u ON u.id=s.user_id
    INNER JOIN employee_profiles ep ON ep.user_id=u.id
    WHERE s.token_hash=? AND s.status='ACTIVE' AND u.deleted_at IS NULL`, [tokenHash]);
  if (!session) return null;
  const now = Date.now();
  const lastSeen = new Date(session.last_seen_at).getTime();
  const expires = new Date(session.expires_at).getTime();
  if (!session.is_waiter || session.user_status !== 'ACTIVE' || session.employment_status !== 'ACTIVE' || expires <= now || now - lastSeen > WAITER_IDLE_TIMEOUT_MINUTES * 60_000) {
    await execute(`UPDATE waiter_pos_sessions SET status='EXPIRED', revoked_at=? WHERE id=? AND status='ACTIVE'`, [new Date().toISOString(), session.id]);
    return null;
  }
  await execute(`UPDATE waiter_pos_sessions SET last_seen_at=? WHERE id=? AND status='ACTIVE'`, [new Date().toISOString(), session.id]);
  return session;
}

// Public because the waiter device has no administrator login. The resulting short-lived
// session is the credential used by the waiter device for subsequent POS APIs.
router.post('/authenticate-code', async (req: Request, res: Response): Promise<void> => {
  const code = normalizeCode(req.body?.code);
  const deviceId = String(req.body?.deviceId || '').trim().slice(0, 128);
  if (code.length !== WAITER_CODE_LENGTH) {
    res.status(400).json({ error: 'VALIDATION_ERROR', code: 'INVALID_WAITER_CODE', message: 'Waiter code must contain exactly 4 digits.', details: {} });
    return;
  }
  if (!deviceId) {
    res.status(400).json({ error: 'VALIDATION_ERROR', code: 'DEVICE_ID_REQUIRED', message: 'A stable device identifier is required for Waiter POS.', details: {} });
    return;
  }
  if (!allowCodeAttempt(`${clientIp(req)}:${code}`)) {
    res.status(429).json({ error: 'RATE_LIMITED', code: 'WAITER_CODE_ATTEMPTS_EXCEEDED', message: 'Too many waiter-code attempts. Try again later.', details: {} });
    return;
  }

  const codeHash = hashWaiterCode(code);
  const waiter = await queryOne<any>(`SELECT u.id,u.full_name,u.status,u.employment_status,u.branch_id,b.name AS branch_name,b.code AS branch_code,
      ep.employee_code,ep.position_title
    FROM waiter_access_codes wac
    INNER JOIN users u ON u.id=wac.user_id
    INNER JOIN employee_profiles ep ON ep.user_id=u.id
    INNER JOIN branches b ON b.id=wac.branch_id
    INNER JOIN user_roles ur ON ur.user_id=u.id
    INNER JOIN roles r ON r.id=ur.role_id
    WHERE wac.code_hash=? AND wac.status='ACTIVE' AND u.deleted_at IS NULL AND u.status='ACTIVE'
      AND u.employment_status='ACTIVE' AND u.branch_id=wac.branch_id AND r.code='WAITER' AND r.status='ACTIVE'`, [codeHash]);

  if (!waiter) {
    res.status(401).json({ error: 'INVALID_WAITER_CODE', code: 'INVALID_WAITER_CODE', message: 'Invalid or inactive waiter code.', details: {} });
    return;
  }

  const now = new Date().toISOString();
  const session = await transaction(async (tx) => {
    await tx.execute('UPDATE waiter_access_codes SET last_used_at=?,updated_at=? WHERE user_id=? AND status=\'ACTIVE\'', [now, now, waiter.id]);
    const token = crypto.randomBytes(32).toString('base64url');
    const tokenHash = hashSessionToken(token);
    const expires = new Date(Date.now() + WAITER_SESSION_TTL_HOURS * 60 * 60 * 1000).toISOString();
    const sessionId = `wps_${crypto.randomUUID()}`;
    await tx.execute(`INSERT INTO waiter_pos_sessions (id,user_id,branch_id,device_id,token_hash,status,expires_at,last_seen_at,created_at)
      VALUES (?,?,?,?,?,'ACTIVE',?,?,?)`, [sessionId, waiter.id, waiter.branch_id, deviceId, tokenHash, expires, now, now]);
    return { token, sessionId, expiresAt: expires };
  });

  res.json({
    session: session,
    waiter: {
      id: waiter.id,
      full_name: waiter.full_name,
      employee_code: waiter.employee_code,
      branch_id: waiter.branch_id,
      branch_name: waiter.branch_name,
      branch_code: waiter.branch_code
    }
  });
});

router.get('/session', async (req: Request, res: Response): Promise<void> => {
  const session = await getWaiterSession(req);
  if (!session) {
    res.status(401).json({ error: 'WAITER_SESSION_INVALID', code: 'WAITER_SESSION_INVALID', message: 'Waiter POS session is invalid, expired or revoked.', details: {} });
    return;
  }
  res.json({ session: { id: session.id, device_id: session.device_id, branch_id: session.branch_id, expires_at: session.expires_at, last_seen_at: session.last_seen_at }, waiter: { id: session.user_id, full_name: session.full_name, employee_code: session.employee_code } });
});

router.post('/logout', async (req: Request, res: Response): Promise<void> => {
  const session = await getWaiterSession(req);
  if (session) await execute(`UPDATE waiter_pos_sessions SET status='REVOKED',revoked_at=? WHERE id=? AND status='ACTIVE'`, [new Date().toISOString(), session.id]);
  res.json({ success: true });
});

router.use(authenticateToken);
router.use(requirePermission('waiter_codes.manage'));
router.use(requireWaiterCodeManager);

router.get('/', async (req: Request, res: Response): Promise<void> => {
  const u = req.user!;
  const params: any[] = [];
  let where = `u.deleted_at IS NULL AND u.employment_status='ACTIVE' AND u.branch_id IS NOT NULL AND r.code='WAITER' AND r.status='ACTIVE'`;
  if (!u.isSuperUser) {
    if (!u.allowedBranchIds.length) { res.json({ waiters: [] }); return; }
    const ph = u.allowedBranchIds.map(() => '?').join(',');
    where += ` AND u.branch_id IN (${ph})`;
    params.push(...u.allowedBranchIds);
  }
  if (typeof req.query.branch_id === 'string' && req.query.branch_id) {
    const branchId = req.query.branch_id;
    if (!u.isSuperUser && !u.allowedBranchIds.includes(branchId)) {
      res.status(403).json({ error: 'BRANCH_ACCESS_DENIED', code: 'BRANCH_ACCESS_DENIED', message: 'Requested branch is outside your assigned access scope.', details: { branch_id: branchId } });
      return;
    }
    where += ' AND u.branch_id=?'; params.push(branchId);
  }
  const waiters = await query<any>(`SELECT u.id,u.full_name,u.status,u.employment_status,u.branch_id,b.name AS branch_name,b.code AS branch_code,
      ep.employee_code,ep.position_title,wac.status AS waiter_code_status,wac.updated_at AS code_updated_at,wac.last_used_at
    FROM users u
    INNER JOIN user_roles ur ON ur.user_id=u.id
    INNER JOIN roles r ON r.id=ur.role_id
    INNER JOIN employee_profiles ep ON ep.user_id=u.id
    LEFT JOIN branches b ON b.id=u.branch_id
    LEFT JOIN waiter_access_codes wac ON wac.user_id=u.id
    WHERE ${where}
    GROUP BY u.id,u.full_name,u.status,u.employment_status,u.branch_id,b.name,b.code,ep.employee_code,ep.position_title,wac.status,wac.updated_at,wac.last_used_at
    ORDER BY u.full_name ASC`, params);
  res.json({ waiters });
});


router.get('/:id/status', requirePermission('waiters.status.view'), async (req: Request, res: Response): Promise<void> => {
  const employee = await getWaiter(req.params.id);
  if (!employee || !(await assertTargetAccess(req, employee))) { res.status(404).json({ error:'NOT_FOUND', code:'WAITER_NOT_FOUND', message:'Waiter not found.', details:{} }); return; }
  const profile=await queryOne<any>('SELECT * FROM waiter_profiles WHERE user_id=?',[employee.id]);
  res.json({status:profile?.status||'PROBATION'});
});

router.put('/:id/status', requirePermission('waiters.status.manage'), async (req: Request, res: Response): Promise<void> => {
  const employee = await getWaiter(req.params.id);
  if (!employee || !(await assertTargetAccess(req, employee))) { res.status(404).json({ error:'NOT_FOUND', code:'WAITER_NOT_FOUND', message:'Waiter not found.', details:{} }); return; }
  const status=String(req.body?.status||'').toUpperCase();
  if(!['PROBATION','PROFESSIONAL'].includes(status)) { res.status(400).json({error:'VALIDATION_ERROR',code:'INVALID_WAITER_STATUS',message:'Status must be PROBATION or PROFESSIONAL.',details:{}}); return; }
  const now=new Date().toISOString(); const old=await queryOne<any>('SELECT status FROM waiter_profiles WHERE user_id=?',[employee.id]);
  await transaction(async(tx)=>{await tx.execute(`INSERT INTO waiter_profiles (user_id,status,changed_by,changed_at) VALUES (?,?,?,?) ON CONFLICT (user_id) DO UPDATE SET status=EXCLUDED.status,changed_by=EXCLUDED.changed_by,changed_at=EXCLUDED.changed_at`,[employee.id,status,req.user!.id,now]);await tx.execute(`INSERT INTO waiter_status_history (id,user_id,status,changed_by,effective_at,created_at) VALUES (?,?,?,?,?,?)`,[`wsh_${crypto.randomUUID()}`,employee.id,status,req.user!.id,now,now]);await insertAuditLog(tx.execute,{userId:req.user!.id,branchId:employee.branch_id,action:'WAITER_STATUS_CHANGED',entityType:'WAITER_PROFILE',entityId:employee.id,oldValues:{status:old?.status||'PROBATION'},newValues:{status},req});});
  res.json({status});
});

router.post('/:id/code', async (req: Request, res: Response): Promise<void> => {
  const employee = await getWaiter(req.params.id);
  if (!employee) { res.status(404).json({ error: 'NOT_FOUND', code: 'EMPLOYEE_NOT_FOUND', message: 'Employee not found.', details: {} }); return; }
  if (!employee.is_waiter) { res.status(409).json({ error: 'NOT_WAITER', code: 'NOT_WAITER', message: 'A personal Waiter POS code can only be assigned to a user with the WAITER role.', details: {} }); return; }
  if (employee.status !== 'ACTIVE' || employee.employment_status !== 'ACTIVE') { res.status(409).json({ error: 'INACTIVE_WAITER', code: 'INACTIVE_WAITER', message: 'Inactive waiters cannot receive an active POS code.', details: {} }); return; }
  if (!employee.branch_id) { res.status(409).json({ error: 'BRANCH_REQUIRED', code: 'BRANCH_REQUIRED', message: 'Waiter must be assigned to a branch before receiving a POS code.', details: {} }); return; }
  if (!(await assertTargetAccess(req, employee))) { res.status(403).json({ error: 'BRANCH_ACCESS_DENIED', code: 'BRANCH_ACCESS_DENIED', message: 'Employee belongs to an unauthorized branch.', details: { branch_id: employee.branch_id } }); return; }

  const code = normalizeCode(req.body?.code);
  if (code.length !== WAITER_CODE_LENGTH) { res.status(400).json({ error: 'VALIDATION_ERROR', code: 'INVALID_WAITER_CODE', message: 'Waiter code must contain exactly 4 digits.', details: {} }); return; }
  const codeHash = hashWaiterCode(code);
  const collision = await queryOne<{ user_id: string }>('SELECT user_id FROM waiter_access_codes WHERE code_hash=? AND user_id<>? AND status=\'ACTIVE\'', [codeHash, employee.id]);
  if (collision) { res.status(409).json({ error: 'CONFLICT', code: 'WAITER_CODE_IN_USE', message: 'This waiter code is already assigned to another active waiter.', details: {} }); return; }

  const existing = await queryOne<any>('SELECT user_id,branch_id,status,created_at,updated_at FROM waiter_access_codes WHERE user_id=?', [employee.id]);
  const now = new Date().toISOString();
  await transaction(async (tx) => {
    await tx.execute(`INSERT INTO waiter_profiles (user_id,status,changed_by,changed_at) VALUES (?, 'PROBATION', ?, ?) ON CONFLICT (user_id) DO NOTHING`, [employee.id, req.user!.id, now]);
    await tx.execute(`INSERT INTO waiter_status_history (id,user_id,status,changed_by,effective_at,created_at) VALUES (?,?,?,?,?,?) ON CONFLICT DO NOTHING`, [`wsh_${employee.id}_initial`,employee.id,'PROBATION',req.user!.id,now,now]);
    if (existing) {
      await tx.execute(`UPDATE waiter_access_codes SET branch_id=?,code_hash=?,status='ACTIVE',updated_at=?,changed_by=? WHERE user_id=?`, [employee.branch_id, codeHash, now, req.user!.id, employee.id]);
      await tx.execute(`UPDATE waiter_pos_sessions SET status='REVOKED',revoked_at=? WHERE user_id=? AND status='ACTIVE'`, [now, employee.id]);
    } else {
      await tx.execute(`INSERT INTO waiter_access_codes (user_id,branch_id,code_hash,status,created_at,updated_at,changed_by) VALUES (?,?,?,'ACTIVE',?,?,?)`, [employee.id, employee.branch_id, codeHash, now, now, req.user!.id]);
    }
    await tx.execute(`INSERT INTO audit_logs (id,user_id,branch_id,action,entity_type,entity_id,old_values,new_values,ip_address,user_agent,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`, [auditId(), req.user!.id, employee.branch_id, existing ? 'WAITER_CODE_REPLACED' : 'WAITER_CODE_CREATED', 'WAITER_ACCESS_CODE', employee.id,
      existing ? JSON.stringify({ status: existing.status, branch_id: existing.branch_id }) : null,
      JSON.stringify({ status: 'ACTIVE', branch_id: employee.branch_id, changed_by: req.user!.id }), clientIp(req), req.headers['user-agent'] || 'unknown', now]);
  });

  res.status(existing ? 200 : 201).json({ success: true, waiter_id: employee.id, temporary_code: code, message: existing ? 'Waiter code replaced. Previous code and active POS sessions are no longer valid.' : 'Waiter code created. Store it securely and give it to the waiter.' });
});

router.delete('/:id/code', async (req: Request, res: Response): Promise<void> => {
  const employee = await getWaiter(req.params.id);
  if (!employee) { res.status(404).json({ error: 'NOT_FOUND', code: 'EMPLOYEE_NOT_FOUND', message: 'Employee not found.', details: {} }); return; }
  if (!(await assertTargetAccess(req, employee))) { res.status(403).json({ error: 'BRANCH_ACCESS_DENIED', code: 'BRANCH_ACCESS_DENIED', message: 'Employee belongs to an unauthorized branch.', details: { branch_id: employee.branch_id } }); return; }
  const existing = await queryOne<any>('SELECT user_id,status,branch_id FROM waiter_access_codes WHERE user_id=?', [employee.id]);
  if (!existing || existing.status !== 'ACTIVE') { res.status(404).json({ error: 'NOT_FOUND', code: 'WAITER_CODE_NOT_ACTIVE', message: 'No active waiter code exists.', details: {} }); return; }
  const now = new Date().toISOString();
  await transaction(async (tx) => {
    await tx.execute(`UPDATE waiter_access_codes SET status='REVOKED',updated_at=?,changed_by=? WHERE user_id=?`, [now, req.user!.id, employee.id]);
    await tx.execute(`UPDATE waiter_pos_sessions SET status='REVOKED',revoked_at=? WHERE user_id=? AND status='ACTIVE'`, [now, employee.id]);
    await tx.execute(`INSERT INTO audit_logs (id,user_id,branch_id,action,entity_type,entity_id,old_values,new_values,ip_address,user_agent,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`, [auditId(), req.user!.id, employee.branch_id, 'WAITER_CODE_REVOKED', 'WAITER_ACCESS_CODE', employee.id,
      JSON.stringify({ status: 'ACTIVE', branch_id: employee.branch_id }), JSON.stringify({ status: 'REVOKED', changed_by: req.user!.id }), clientIp(req), req.headers['user-agent'] || 'unknown', now]);
  });
  res.json({ success: true, message: 'Waiter POS code revoked. Active waiter POS sessions are also revoked.' });
});

export { revokeWaiterSessions };
export default router;
