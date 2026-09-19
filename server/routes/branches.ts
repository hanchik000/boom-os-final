import { Router, Request, Response } from 'express';
import crypto from 'node:crypto';
import { config } from '../config';
import { query, queryOne, execute } from '../db';
import {
  authenticateToken,
  requirePermission,
  requireBranchAccess,
  recordAuditLog
} from '../auth';

const router = Router();
router.use(authenticateToken);

// GET /api/branches
router.get('/', requirePermission('branches.view'), async (req: Request, res: Response): Promise<void> => {
  const { status, search } = req.query;
  const currentUser = req.user!;

  let sql = `
    SELECT 
      b.id, b.name, b.code, b.address, b.phone, b.timezone, b.currency, b.status,
      b.franchise_id, f.name as franchise_name, f.code as franchise_code,
      b.created_at, b.updated_at,
      (SELECT COUNT(*)::int FROM users u WHERE u.branch_id = b.id AND u.deleted_at IS NULL) as staff_count
    FROM branches b
    LEFT JOIN franchises f ON f.id = b.franchise_id
    WHERE 1=1
  `;
  const params: any[] = [];

  // Filter allowed branches for non-superusers
  if (!currentUser.isSuperUser) {
    if (currentUser.allowedBranchIds.length === 0) {
      res.json({ branches: [] });
      return;
    }
    const placeholders = currentUser.allowedBranchIds.map(() => '?').join(',');
    sql += ` AND b.id IN (${placeholders})`;
    params.push(...currentUser.allowedBranchIds);
  }

  if (status && typeof status === 'string') {
    sql += ` AND b.status = ?`;
    params.push(status);
  }

  if (search && typeof search === 'string') {
    const term = `%${search.trim().toLowerCase()}%`;
    sql += ` AND (LOWER(b.name) LIKE ? OR LOWER(b.code) LIKE ? OR LOWER(b.address) LIKE ?)`;
    params.push(term, term, term);
  }

  sql += ` ORDER BY b.code ASC`;

  const branches = await query(sql, params);
  res.json({ branches });
});

// GET /api/branches/:id
router.get('/:id', requirePermission('branches.view'), requireBranchAccess(req => req.params.id), async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  const branch = await queryOne<{
    id: string;
    name: string;
    code: string;
    address: string;
    phone: string;
    timezone: string;
    currency: string;
    status: string;
    created_at: string;
    updated_at: string;
  }>(
    `SELECT b.*,
      (SELECT COUNT(*)::int FROM users u WHERE u.branch_id = b.id AND u.deleted_at IS NULL) as staff_count
     FROM branches b WHERE b.id = ?`,
    [id]
  );

  if (!branch) {
    res.status(404).json({ error: 'NOT_FOUND', message: 'Branch not found.' });
    return;
  }

  // Get staff members in branch
  const staff = await query(
    `SELECT u.id, u.full_name, u.email, u.phone, u.status
     FROM users u
     WHERE u.branch_id = ? AND u.deleted_at IS NULL
     ORDER BY u.full_name ASC`,
    [id]
  );

  res.json({
    branch: {
      ...branch,
      staff
    }
  });
});

// POST /api/branches
router.post('/', requirePermission('branches.create'), async (req: Request, res: Response): Promise<void> => {
  const { name, code, address, phone, timezone, currency, status, franchise_id } = req.body;

  if (!name || !code || !address || !phone) {
    res.status(400).json({
      error: 'VALIDATION_ERROR',
      message: 'name, code, address, and phone are required.'
    });
    return;
  }

  const cleanCode = String(code).trim().toUpperCase();
  const existingCode = await queryOne('SELECT id FROM branches WHERE code = ?', [cleanCode]);
  if (existingCode) {
    res.status(409).json({ error: 'CONFLICT', message: 'Branch code is already in use.' });
    return;
  }

  // Assigning a new branch to a franchise is branch<->franchise re-parenting under a
  // different name, with a worse side effect: creation auto-grants the creator access to
  // the branch it just made (see below), so a non-superuser could otherwise use franchise_id
  // here to silently gain a foothold inside a franchise they hold no branch of. Restricted to
  // superuser semantics, matching /franchises/:id/branches/:branchId.
  if (franchise_id && !req.user!.isSuperUser) {
    res.status(403).json({
      error: 'FORBIDDEN', code: 'FRANCHISE_STRUCTURE_SUPERUSER_ONLY',
      message: 'Only OWNER or SUPER_ADMIN may assign a new branch to a franchise.',
      details: {}
    });
    return;
  }
  // If franchise_id provided, verify franchise exists
  if (franchise_id) {
    const fExists = await queryOne('SELECT id FROM franchises WHERE id = ?', [franchise_id]);
    if (!fExists) {
      res.status(400).json({ error: 'VALIDATION_ERROR', message: `Franchise ${franchise_id} does not exist.` });
      return;
    }
  }

  const branchId = `br_${cleanCode.toLowerCase().replace(/[^a-z0-9]/g, '_')}_${Date.now().toString(36)}`;
  const now = new Date().toISOString();
  const branchStatus = status || 'ACTIVE';
  const tz = timezone || config.defaultTimezone;
  const curr = currency || config.defaultCurrency;

  await execute(
    `INSERT INTO branches (id, name, code, address, phone, timezone, currency, status, franchise_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [branchId, name.trim(), cleanCode, address.trim(), phone.trim(), tz, curr, branchStatus, franchise_id || null, now, now]
  );

  // Automatically grant access to current creator if not superuser
  if (!req.user!.isSuperUser) {
    await execute(
      `INSERT INTO user_branch_access (id, user_id, branch_id, created_at) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING`,
      [`uba_${req.user!.id}_${branchId}`, req.user!.id, branchId, now]
    );
  }

  await recordAuditLog({
    action: 'BRANCH_CREATED',
    entityType: 'BRANCH',
    entityId: branchId,
    branchId,
    newValues: { name, code: cleanCode, address, phone, timezone: tz, currency: curr, status: branchStatus, franchise_id },
    req
  });

  const created = await queryOne('SELECT * FROM branches WHERE id = ?', [branchId]);
  res.status(201).json({ branch: created });
});

// PUT /api/branches/:id
router.put('/:id', requirePermission('branches.update'), requireBranchAccess(req => req.params.id), async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  const { name, code, address, phone, timezone, currency, status, franchise_id } = req.body;

  const existing = await queryOne<{
    id: string;
    name: string;
    code: string;
    address: string;
    phone: string;
    timezone: string;
    currency: string;
    status: string;
    franchise_id: string | null;
  }>('SELECT * FROM branches WHERE id = ?', [id]);

  if (!existing) {
    res.status(404).json({ error: 'NOT_FOUND', message: 'Branch not found.' });
    return;
  }

  // Re-parenting an EXISTING branch into a different franchise is the exact operation
  // Stage 23 restricted to superuser semantics on /franchises/:id/branches/:branchId.
  // requireBranchAccess above only proves the caller holds THIS branch -- it says nothing
  // about the destination franchise, so this field must not move through a second endpoint
  // under a weaker check. A no-op (same value, or omitted) is not a re-parent and is allowed.
  if (franchise_id !== undefined && franchise_id !== existing.franchise_id && !req.user!.isSuperUser) {
    res.status(403).json({
      error: 'FORBIDDEN', code: 'FRANCHISE_STRUCTURE_SUPERUSER_ONLY',
      message: 'Only OWNER or SUPER_ADMIN may move a branch between franchises.',
      details: { branch_id: id }
    });
    return;
  }

  const cleanCode = code ? String(code).trim().toUpperCase() : existing.code;
  if (cleanCode !== existing.code) {
    const conflict = await queryOne('SELECT id FROM branches WHERE code = ? AND id != ?', [cleanCode, id]);
    if (conflict) {
      res.status(409).json({ error: 'CONFLICT', message: 'Branch code is already in use.' });
      return;
    }
  }

  const now = new Date().toISOString();
  const targetFranchiseId = franchise_id !== undefined ? franchise_id : existing.franchise_id;

  await execute(
    `UPDATE branches 
     SET name = ?, code = ?, address = ?, phone = ?, timezone = ?, currency = ?, status = ?, franchise_id = ?, updated_at = ?
     WHERE id = ?`,
    [
      name !== undefined ? name.trim() : existing.name,
      cleanCode,
      address !== undefined ? address.trim() : existing.address,
      phone !== undefined ? phone.trim() : existing.phone,
      timezone !== undefined ? timezone : existing.timezone,
      currency !== undefined ? currency : existing.currency,
      status !== undefined ? status : existing.status,
      targetFranchiseId || null,
      now,
      id
    ]
  );

  await recordAuditLog({
    action: 'BRANCH_UPDATED',
    entityType: 'BRANCH',
    entityId: id,
    branchId: id,
    oldValues: existing,
    newValues: { name, code: cleanCode, address, phone, timezone, currency, status },
    req
  });

  const updated = await queryOne('SELECT * FROM branches WHERE id = ?', [id]);
  res.json({ branch: updated });
});

// DELETE /api/branches/:id (Deactivate branch)
router.delete('/:id', requirePermission('branches.delete'), requireBranchAccess(req => req.params.id), async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  const branch = await queryOne<{ id: string; name: string; code: string }>('SELECT id, name, code FROM branches WHERE id = ?', [id]);

  if (!branch) {
    res.status(404).json({ error: 'NOT_FOUND', message: 'Branch not found.' });
    return;
  }

  const now = new Date().toISOString();
  await execute(`UPDATE branches SET status = 'INACTIVE', updated_at = ? WHERE id = ?`, [now, id]);

  await recordAuditLog({
    action: 'BRANCH_DEACTIVATED',
    entityType: 'BRANCH',
    entityId: id,
    branchId: id,
    newValues: { status: 'INACTIVE' },
    req
  });

  res.json({ success: true, message: `Branch ${branch.name} (${branch.code}) deactivated.` });
});

// ==================================================================================================
// Stage 35.6 -- QR menu entry. A QR code encodes only this opaque token, never a branch id: the
// public resolution endpoint (server/routes/public-menu.ts) looks the token up server-side and
// returns the branch it belongs to. The client can never choose which branch a QR token resolves
// to, so a scanned code can never be redirected onto another branch's data.
// ==================================================================================================
router.get('/:id/qr', requirePermission('branches.update'), requireBranchAccess(req => req.params.id), async (req: Request, res: Response): Promise<void> => {
  const branch = await queryOne<{ id: string; qr_token: string | null }>('SELECT id, qr_token FROM branches WHERE id = ?', [req.params.id]);
  if (!branch) { res.status(404).json({ error: 'NOT_FOUND', message: 'Branch not found.' }); return; }
  res.json({ branch_id: branch.id, qr_token: branch.qr_token, qr_url: branch.qr_token ? `${config.appUrl}/?screen=customer&qr=${branch.qr_token}` : null });
});

router.post('/:id/qr/regenerate', requirePermission('branches.update'), requireBranchAccess(req => req.params.id), async (req: Request, res: Response): Promise<void> => {
  const branch = await queryOne<{ id: string; name: string }>('SELECT id, name FROM branches WHERE id = ?', [req.params.id]);
  if (!branch) { res.status(404).json({ error: 'NOT_FOUND', message: 'Branch not found.' }); return; }
  const token = crypto.randomBytes(18).toString('base64url');
  const now = new Date().toISOString();
  await execute('UPDATE branches SET qr_token = ?, updated_at = ? WHERE id = ?', [token, now, branch.id]);
  await recordAuditLog({ action: 'BRANCH_QR_REGENERATED', entityType: 'BRANCH', entityId: branch.id, branchId: branch.id, newValues: { qr_token_regenerated: true }, req });
  res.status(201).json({ branch_id: branch.id, qr_token: token, qr_url: `${config.appUrl}/?screen=customer&qr=${token}` });
});

export default router;
