import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { query, queryOne, execute } from './db';
import { config } from './config';

export function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.trim() === '') {
    throw new Error('FATAL: JWT_SECRET environment variable is missing. The application cannot start without a configured JWT_SECRET.');
  }
  return secret;
}

// Enforce immediate startup validation
getJwtSecret();

export interface UserTokenPayload {
  userId: string;
  email: string;
  sessionId: string;
}

export interface AuthenticatedUser {
  id: string;
  email: string;
  phone: string;
  full_name: string;
  avatar_url: string | null;
  status: string;
  branch_id: string | null;
  roles: Array<{ id: string; code: string; name: string }>;
  roleCodes: string[];
  permissions: string[];
  allowedBranchIds: string[];
  isSuperUser: boolean;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

export function hashPassword(plainText: string): string {
  const salt = bcrypt.genSaltSync(10);
  return bcrypt.hashSync(plainText, salt);
}

export function verifyPassword(plainText: string, hash: string): boolean {
  return bcrypt.compareSync(plainText, hash);
}

export function generateSessionId(): string {
  return crypto.randomUUID();
}

export function hashSessionId(sessionId: string): string {
  return crypto.createHash('sha256').update(sessionId).digest('hex');
}

export function generateToken(payload: UserTokenPayload): string {
  return jwt.sign(payload, getJwtSecret(), { expiresIn: `${config.sessionTtlDays}d` });
}

export async function createAuthSession(userId: string, req?: Request): Promise<{ sessionId: string; token: string }> {
  const sessionId = generateSessionId();
  const sessionHash = hashSessionId(sessionId);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + config.sessionTtlDays * 24 * 60 * 60 * 1000);
  await execute(
    `INSERT INTO auth_sessions (id, user_id, token_hash, expires_at, created_at, last_seen_at, ip_address, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [sessionId, userId, sessionHash, expiresAt.toISOString(), now.toISOString(), now.toISOString(), req?.ip || req?.socket?.remoteAddress || null, req?.headers['user-agent'] || null]
  );
  return { sessionId, token: '' };
}

export async function revokeAuthSession(sessionId: string): Promise<void> {
  await execute(`UPDATE auth_sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL`, [new Date().toISOString(), sessionId]);
}

export async function getFullUserProfile(userId: string): Promise<AuthenticatedUser | null> {
  const user = await queryOne<{
    id: string;
    email: string;
    phone: string;
    full_name: string;
    avatar_url: string | null;
    status: string;
    branch_id: string | null;
    deleted_at: string | null;
  }>(
    `SELECT id, email, phone, full_name, avatar_url, status, branch_id, deleted_at 
     FROM users 
     WHERE id = ? AND deleted_at IS NULL`,
    [userId]
  );

  if (!user || user.status !== 'ACTIVE') {
    return null;
  }

  // Fetch roles
  const roles = await query<{ id: string; code: string; name: string }>(
    `SELECT r.id, r.code, r.name 
     FROM roles r 
     INNER JOIN user_roles ur ON ur.role_id = r.id 
     WHERE ur.user_id = ? AND r.status = 'ACTIVE'`,
    [userId]
  );

  const roleCodes = roles.map(r => r.code);
  const isSuperUser = roleCodes.includes('OWNER') || roleCodes.includes('SUPER_ADMIN');

  // Fetch permissions aggregated from all active assigned roles
  const permissionsRows = await query<{ code: string }>(
    `SELECT DISTINCT p.code 
     FROM permissions p 
     INNER JOIN role_permissions rp ON rp.permission_id = p.id 
     INNER JOIN user_roles ur ON ur.role_id = rp.role_id 
     INNER JOIN roles r ON r.id = ur.role_id 
     WHERE ur.user_id = ? AND r.status = 'ACTIVE'`,
    [userId]
  );

  const permissions = permissionsRows.map(p => p.code);

  // Fetch allowed branches
  let allowedBranchIds: string[] = [];
  if (isSuperUser) {
    const allBranches = await query<{ id: string }>('SELECT id FROM branches WHERE status = ?', ['ACTIVE']);
    allowedBranchIds = allBranches.map(b => b.id);
  } else {
    const branchAccess = await query<{ branch_id: string }>(
      `SELECT DISTINCT branch_id FROM user_branch_access WHERE user_id = ?`,
      [userId]
    );
    allowedBranchIds = branchAccess.map(b => b.branch_id);
    if (user.branch_id && !allowedBranchIds.includes(user.branch_id)) {
      allowedBranchIds.push(user.branch_id);
    }
  }

  return {
    id: user.id,
    email: user.email,
    phone: user.phone,
    full_name: user.full_name,
    avatar_url: user.avatar_url,
    status: user.status,
    branch_id: user.branch_id,
    roles,
    roleCodes,
    permissions,
    allowedBranchIds,
    isSuperUser
  };
}

// Authentication Middleware
export async function authenticateToken(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers['authorization'];
  let token: string | undefined;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7);
  }

  if (!token) {
    res.status(401).json({
      error: 'UNAUTHORIZED',
      message: 'Authentication required. No bearer token provided.'
    });
    return;
  }

  try {
    const decoded = jwt.verify(token, getJwtSecret()) as UserTokenPayload;
    if (!decoded.sessionId) {
      res.status(401).json({ error: 'INVALID_TOKEN', message: 'Session-bound token required.' });
      return;
    }
    const session = await queryOne<{ id: string; user_id: string; expires_at: string; revoked_at: string | null; last_seen_at: string | null }>(
      `SELECT id, user_id, expires_at, revoked_at, last_seen_at FROM auth_sessions WHERE id = ? AND token_hash = ?`,
      [decoded.sessionId, hashSessionId(decoded.sessionId)]
    );
    const idleExpired = session?.last_seen_at
      ? Date.now() - new Date(session.last_seen_at).getTime() > config.sessionIdleTimeoutMinutes * 60 * 1000
      : false;
    if (!session || session.user_id !== decoded.userId || session.revoked_at || new Date(session.expires_at).getTime() <= Date.now() || idleExpired) {
      res.status(401).json({ error: 'SESSION_REVOKED', message: 'Session is invalid or expired.' });
      return;
    }
    await execute(`UPDATE auth_sessions SET last_seen_at = ? WHERE id = ?`, [new Date().toISOString(), decoded.sessionId]);
    const userProfile = await getFullUserProfile(decoded.userId);

    if (!userProfile) {
      res.status(401).json({
        error: 'INVALID_SESSION',
        message: 'User account is suspended, deleted, or does not exist.'
      });
      return;
    }

    req.user = userProfile;
    next();
  } catch (err) {
    res.status(401).json({
      error: 'INVALID_TOKEN',
      message: 'Invalid or expired authorization token.'
    });
    return;
  }
}

// Permission Enforcement Middleware
export function requirePermission(permissionCode: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'UNAUTHORIZED', message: 'Authentication required' });
      return;
    }

    // Superusers (OWNER, SUPER_ADMIN) have universal access
    if (req.user.isSuperUser) {
      return next();
    }

    if (req.user.permissions.includes(permissionCode)) {
      return next();
    }

    res.status(403).json({
      error: 'FORBIDDEN',
      message: `Access denied. Missing required permission: ${permissionCode}`,
      requiredPermission: permissionCode
    });
  };
}

// Branch Isolation & Enforcement Middleware
export function requireBranchAccess(branchIdExtractor: (req: Request) => string | undefined) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'UNAUTHORIZED', message: 'Authentication required' });
      return;
    }

    if (req.user.isSuperUser) {
      return next();
    }

    const targetBranchId = branchIdExtractor(req);
    if (!targetBranchId) {
      res.status(400).json({
        error: 'BRANCH_REQUIRED',
        code: 'BRANCH_REQUIRED',
        message: 'A branch identifier is required for this operation.',
        details: {}
      });
      return;
    }

    if (req.user.allowedBranchIds.includes(targetBranchId)) {
      return next();
    }

    res.status(403).json({
      error: 'BRANCH_ACCESS_DENIED',
      message: `Access denied. You do not have permission to access branch: ${targetBranchId}`,
      branchId: targetBranchId
    });
  };
}

// Audit Logger Helper
export interface AuditLogOptions {
  userId?: string | null;
  branchId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  oldValues?: any;
  newValues?: any;
  req?: Request;
}

export async function insertAuditLog(
  executeFn: (sql: string, params?: any[]) => Promise<any>,
  options: AuditLogOptions
): Promise<void> {
  const id = `aud_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  const now = new Date().toISOString();
  let ip = '127.0.0.1';
  let userAgent = 'internal';
  if (options.req) {
    const forwarded = options.req.headers['x-forwarded-for'];
    ip = (typeof forwarded === 'string' ? forwarded.split(',')[0] : options.req.socket?.remoteAddress) || '127.0.0.1';
    userAgent = (options.req.headers['user-agent'] as string) || 'unknown';
  }
  const oldJson = options.oldValues !== undefined && options.oldValues !== null ? JSON.stringify(options.oldValues) : null;
  const newJson = options.newValues !== undefined && options.newValues !== null ? JSON.stringify(options.newValues) : null;
  await executeFn(
    `INSERT INTO audit_logs (id, user_id, branch_id, action, entity_type, entity_id, old_values, new_values, ip_address, user_agent, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, options.userId || options.req?.user?.id || null, options.branchId || options.req?.user?.branch_id || null,
      options.action, options.entityType, options.entityId || null, oldJson, newJson, ip, userAgent, now]
  );
}

export async function recordAuditLog(options: AuditLogOptions): Promise<void> {
  await insertAuditLog(execute, options);
}

// Basic Rate Limiter
interface RateLimitBucket {
  count: number;
  resetAt: number;
}
const rateLimitStore = new Map<string, RateLimitBucket>();

export function basicRateLimiter(limitPerMinute = 200) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const windowMs = 60 * 1000;

    let bucket = rateLimitStore.get(ip);
    if (!bucket || now > bucket.resetAt) {
      bucket = { count: 1, resetAt: now + windowMs };
      rateLimitStore.set(ip, bucket);
      return next();
    }

    bucket.count++;
    if (bucket.count > limitPerMinute) {
      res.status(429).json({
        error: 'RATE_LIMITED',
        message: 'Too many requests. Please slow down.'
      });
      return;
    }

    next();
  };
}
