import { Router, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { query, queryOne, execute, transaction } from '../db';
import {
  verifyPassword,
  generateToken,
  createAuthSession,
  revokeAuthSession,
  getFullUserProfile,
  authenticateToken,
  recordAuditLog,
  hashPassword,
  insertAuditLog
} from '../auth';

const router = Router();

// First-run bootstrap. This endpoint is available only while no OWNER or SUPER_ADMIN exists.
router.get('/bootstrap-status', async (_req: Request, res: Response): Promise<void> => {
  const privileged = await queryOne<{ count: number }>(
    `SELECT COUNT(*)::int AS count
       FROM user_roles ur
       INNER JOIN roles r ON r.id = ur.role_id
       INNER JOIN users u ON u.id = ur.user_id
      WHERE r.code IN ('OWNER','SUPER_ADMIN') AND u.deleted_at IS NULL`
  );
  res.json({ needsBootstrap: (privileged?.count || 0) === 0 });
});

router.post('/bootstrap', async (req: Request, res: Response): Promise<void> => {
  const { full_name, email, phone, password } = req.body || {};
  if (!full_name || !email || !password) {
    res.status(400).json({ error: 'VALIDATION_ERROR', code: 'BOOTSTRAP_FIELDS_REQUIRED', message: 'full_name, email and password are required.', details: {} });
    return;
  }
  const cleanName = String(full_name).trim();
  const cleanEmail = String(email).trim().toLowerCase();
  const cleanPhone = String(phone || '').trim();
  if (cleanName.length < 2 || !/^\S+@\S+\.\S+$/.test(cleanEmail)) {
    res.status(400).json({ error: 'VALIDATION_ERROR', code: 'INVALID_OWNER_IDENTITY', message: 'A valid owner name and email are required.', details: {} });
    return;
  }
  if (String(password).length < 12) {
    res.status(400).json({ error: 'VALIDATION_ERROR', code: 'OWNER_PASSWORD_TOO_WEAK', message: 'Owner password must be at least 12 characters.', details: {} });
    return;
  }
  const owner = await queryOne<{ id: string }>(
    `SELECT u.id FROM users u INNER JOIN user_roles ur ON ur.user_id=u.id INNER JOIN roles r ON r.id=ur.role_id WHERE r.code IN ('OWNER','SUPER_ADMIN') AND u.deleted_at IS NULL LIMIT 1`
  );
  if (owner) {
    res.status(409).json({ error: 'BOOTSTRAP_ALREADY_COMPLETED', code: 'BOOTSTRAP_ALREADY_COMPLETED', message: 'Initial owner bootstrap has already been completed.', details: {} });
    return;
  }
  const existing = await queryOne<{ id: string }>('SELECT id FROM users WHERE LOWER(email)=? AND deleted_at IS NULL', [cleanEmail]);
  if (existing) {
    res.status(409).json({ error: 'CONFLICT', code: 'EMAIL_IN_USE', message: 'Email is already in use.', details: {} });
    return;
  }
  if (cleanPhone) {
    const phoneExists = await queryOne<{ id: string }>('SELECT id FROM users WHERE phone=? AND deleted_at IS NULL', [cleanPhone]);
    if (phoneExists) {
      res.status(409).json({ error: 'CONFLICT', code: 'PHONE_IN_USE', message: 'Phone is already in use.', details: {} });
      return;
    }
  }
  const roleOwner = await queryOne<{ id: string }>(`SELECT id FROM roles WHERE code='OWNER' AND status='ACTIVE'`);
  if (!roleOwner) {
    res.status(500).json({ error: 'CONFIGURATION_ERROR', code: 'OWNER_ROLE_MISSING', message: 'OWNER system role is not available.', details: {} });
    return;
  }
  const now = new Date().toISOString();
  const userId = `usr_owner_${crypto.randomUUID()}`;
  const passwordHash = hashPassword(String(password));
  try {
    await transaction(async (tx) => {
      // Serialize first-owner bootstrap so two concurrent requests cannot both create an owner.
      // pg_advisory_xact_lock() returns SQL type `void`, which the raw-query
      // deserializer cannot decode, so take the lock as a statement rather than a row read.
      await tx.execute(`SELECT pg_advisory_xact_lock(hashtextextended('boom_os_owner_bootstrap', 0))`);
      const ownerInsideTx = await tx.queryOne<{ id: string }>(
        `SELECT u.id FROM users u
         INNER JOIN user_roles ur ON ur.user_id=u.id
         INNER JOIN roles r ON r.id=ur.role_id
         WHERE r.code IN ('OWNER','SUPER_ADMIN') AND u.deleted_at IS NULL
         LIMIT 1`
      );
      if (ownerInsideTx) throw new Error('BOOTSTRAP_ALREADY_COMPLETED');
      await tx.execute(`INSERT INTO users (id,full_name,email,phone,password_hash,status,employment_status,disciplinary_status,joined_at,created_at,updated_at) VALUES (?,?,?,?,?,'ACTIVE','ACTIVE','NONE',?,?,?)`, [userId,cleanName,cleanEmail,cleanPhone,passwordHash,now,now,now]);
    await tx.execute(`INSERT INTO employee_profiles (user_id,employee_code,position_title,employment_type,hire_date,created_at,updated_at) VALUES (?,?,?,'FULL_TIME',?,?,?)`, [userId,`EMP-${userId}`,'Owner',now,now,now]);
    await tx.execute(`INSERT INTO user_roles (id,user_id,role_id,created_at) VALUES (?,?,?,?)`, [`ur_${userId}_${roleOwner.id}`,userId,roleOwner.id,now]);
      await insertAuditLog(tx.execute,{userId,action:'OWNER_BOOTSTRAPPED',entityType:'USER',entityId:userId,newValues:{role:'OWNER',email:cleanEmail},req});
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'BOOTSTRAP_ALREADY_COMPLETED') {
      res.status(409).json({ error: 'BOOTSTRAP_ALREADY_COMPLETED', code: 'BOOTSTRAP_ALREADY_COMPLETED', message: 'Initial owner bootstrap has already been completed.', details: {} });
      return;
    }
    throw error;
  }
  const profile = await getFullUserProfile(userId);
  const session = await createAuthSession(userId, req);
  const token = generateToken({ userId, email: cleanEmail, sessionId: session.sessionId });
  res.status(201).json({ token, user: profile });
});


// POST /api/auth/login
router.post('/login', async (req: Request, res: Response): Promise<void> => {
  const { login, password } = req.body;

  if (!login || !password) {
    res.status(400).json({
      error: 'VALIDATION_ERROR',
      message: 'Login (email or phone) and password are required.'
    });
    return;
  }

  const cleanLogin = String(login).trim().toLowerCase();

  // Find user by email or phone
  const user = await queryOne<{
    id: string;
    email: string;
    phone: string;
    password_hash: string;
    status: string;
    deleted_at: string | null;
  }>(
    `SELECT id, email, phone, password_hash, status, deleted_at 
     FROM users 
     WHERE (LOWER(email) = ? OR phone = ?) AND deleted_at IS NULL`,
    [cleanLogin, login.trim()]
  );

  if (!user) {
    await recordAuditLog({
      action: 'LOGIN_FAILED',
      entityType: 'AUTH',
      entityId: cleanLogin,
      newValues: { reason: 'USER_NOT_FOUND', login: cleanLogin },
      req
    });
    res.status(401).json({
      error: 'INVALID_CREDENTIALS',
      message: 'Invalid login or password.'
    });
    return;
  }

  if (user.status !== 'ACTIVE') {
    await recordAuditLog({
      userId: user.id,
      action: 'LOGIN_REJECTED',
      entityType: 'AUTH',
      entityId: user.id,
      newValues: { reason: 'ACCOUNT_INACTIVE', status: user.status },
      req
    });
    res.status(403).json({
      error: 'ACCOUNT_SUSPENDED',
      message: 'Account is deactivated or suspended. Please contact administrator.'
    });
    return;
  }

  const passwordMatch = verifyPassword(password, user.password_hash);
  if (!passwordMatch) {
    await recordAuditLog({
      userId: user.id,
      action: 'LOGIN_FAILED',
      entityType: 'AUTH',
      entityId: user.id,
      newValues: { reason: 'WRONG_PASSWORD' },
      req
    });
    res.status(401).json({
      error: 'INVALID_CREDENTIALS',
      message: 'Invalid login or password.'
    });
    return;
  }

  // Update last_login_at
  const now = new Date().toISOString();
  await execute(`UPDATE users SET last_login_at = ? WHERE id = ?`, [now, user.id]);

  const profile = await getFullUserProfile(user.id);
  if (!profile) {
    res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Failed to construct user profile.' });
    return;
  }

  const session = await createAuthSession(user.id, req);
  const token = generateToken({ userId: user.id, email: user.email, sessionId: session.sessionId });

  await recordAuditLog({
    userId: user.id,
    branchId: profile.branch_id,
    action: 'LOGIN_SUCCESS',
    entityType: 'AUTH',
    entityId: user.id,
    newValues: { email: user.email, roles: profile.roleCodes },
    req
  });

  res.json({
    token,
    user: profile
  });
});

// GET /api/auth/me
router.get('/me', authenticateToken, (req: Request, res: Response): void => {
  if (!req.user) {
    res.status(401).json({ error: 'UNAUTHORIZED' });
    return;
  }
  res.json({ user: req.user });
});

// POST /api/auth/logout
router.post('/logout', authenticateToken, async (req: Request, res: Response): Promise<void> => {
  if (req.user) {
    const authHeader = req.headers['authorization'];
    const token = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : null;
    if (token) {
      try {
        const decoded = jwt.decode(token) as { sessionId?: string } | null;
        if (decoded?.sessionId) await revokeAuthSession(decoded.sessionId);
      } catch {}
    }
    recordAuditLog({
      userId: req.user.id,
      branchId: req.user.branch_id,
      action: 'LOGOUT',
      entityType: 'AUTH',
      entityId: req.user.id,
      req
    });
  }
  res.json({ success: true, message: 'Logged out successfully.' });
});

export default router;
