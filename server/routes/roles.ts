import { Router, Request, Response } from 'express';
import { query, queryOne, execute } from '../db';
import {
  authenticateToken,
  requirePermission,
  recordAuditLog
} from '../auth';

const router = Router();
router.use(authenticateToken);

// GET /api/roles
router.get('/', requirePermission('roles.view'), async (req: Request, res: Response): Promise<void> => {
  const roles = await query<{
    id: string;
    code: string;
    name: string;
    description: string | null;
    is_system: number;
    status: string;
    created_at: string;
    updated_at: string;
  }>('SELECT * FROM roles ORDER BY is_system DESC, code ASC');

  const enriched = [];
  for (const r of roles) {
    const permissions = await query<{ id: string; code: string; name: string; module: string }>(
      `SELECT p.id, p.code, p.name, p.module 
       FROM permissions p
       INNER JOIN role_permissions rp ON rp.permission_id = p.id
       WHERE rp.role_id = ?`,
      [r.id]
    );

    const userCount = await queryOne<{ count: number }>(
      `SELECT COUNT(*)::int as count 
       FROM user_roles ur
       INNER JOIN users u ON u.id = ur.user_id
       WHERE ur.role_id = ? AND u.deleted_at IS NULL`,
      [r.id]
    );

    enriched.push({
      ...r,
      permissions,
      user_count: userCount?.count || 0
    });
  }

  res.json({ roles: enriched });
});

// GET /api/roles/:id
router.get('/:id', requirePermission('roles.view'), async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  const role = await queryOne<{
    id: string;
    code: string;
    name: string;
    description: string | null;
    is_system: number;
    status: string;
    created_at: string;
    updated_at: string;
  }>('SELECT * FROM roles WHERE id = ?', [id]);

  if (!role) {
    res.status(404).json({ error: 'NOT_FOUND', message: 'Role not found.' });
    return;
  }

  const permissions = await query<{ id: string; code: string; name: string; module: string }>(
    `SELECT p.id, p.code, p.name, p.module 
     FROM permissions p
     INNER JOIN role_permissions rp ON rp.permission_id = p.id
     WHERE rp.role_id = ?`,
    [id]
  );

  const users = await query<{ id: string; full_name: string; email: string }>(
    `SELECT u.id, u.full_name, u.email 
     FROM users u
     INNER JOIN user_roles ur ON ur.user_id = u.id
     WHERE ur.role_id = ? AND u.deleted_at IS NULL`,
    [id]
  );

  res.json({
    role: {
      ...role,
      permissions,
      users
    }
  });
});

// POST /api/roles
router.post('/', requirePermission('roles.create'), async (req: Request, res: Response): Promise<void> => {
  const { code, name, description, permission_ids, status } = req.body;

  if (!code || !name) {
    res.status(400).json({ error: 'VALIDATION_ERROR', message: 'code and name are required.' });
    return;
  }

  const cleanCode = String(code).trim().toUpperCase();
  const existing = await queryOne('SELECT id FROM roles WHERE code = ?', [cleanCode]);
  if (existing) {
    res.status(409).json({ error: 'CONFLICT', message: 'Role code already exists.' });
    return;
  }

  const roleId = `role_${cleanCode.toLowerCase().replace(/[^a-z0-9]/g, '_')}_${Date.now().toString(36)}`;
  const now = new Date().toISOString();
  const roleStatus = status || 'ACTIVE';

  await execute(
    `INSERT INTO roles (id, code, name, description, is_system, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, 0, ?, ?, ?)`,
    [roleId, cleanCode, name.trim(), description || null, roleStatus, now, now]
  );

  // Link permissions
  if (Array.isArray(permission_ids)) {
    for (const permId of permission_ids) {
      const perm = await queryOne('SELECT id FROM permissions WHERE id = ? OR code = ?', [permId, permId]);
      if (perm) {
        await execute(
          `INSERT INTO role_permissions (id, role_id, permission_id, created_at) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING`,
          [`rp_${roleId}_${perm.id}`, roleId, perm.id, now]
        );
      }
    }
  }

  await recordAuditLog({
    action: 'ROLE_CREATED',
    entityType: 'ROLE',
    entityId: roleId,
    newValues: { code: cleanCode, name, permission_ids },
    req
  });

  res.status(201).json({ role: await queryOne('SELECT * FROM roles WHERE id = ?', [roleId]) });
});

// PUT /api/roles/:id
router.put('/:id', requirePermission('roles.update'), async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  const { name, description, permission_ids, status } = req.body;

  const role = await queryOne<{ id: string; code: string; name: string; is_system: number; status: string }>(
    'SELECT * FROM roles WHERE id = ?',
    [id]
  );

  if (!role) {
    res.status(404).json({ error: 'NOT_FOUND', message: 'Role not found.' });
    return;
  }

  // Security check: non-superusers cannot modify their own assigned roles' permissions
  if (!req.user!.isSuperUser && req.user!.roleCodes.includes(role.code)) {
    res.status(403).json({
      error: 'PRIVILEGE_ESCALATION_FORBIDDEN',
      message: 'You cannot alter the permissions or parameters of your own assigned role.'
    });
    return;
  }

  const now = new Date().toISOString();
  await execute(
    `UPDATE roles 
     SET name = ?, description = ?, status = ?, updated_at = ?
     WHERE id = ?`,
    [
      name !== undefined ? name.trim() : role.name,
      description !== undefined ? description : null,
      status !== undefined ? status : role.status,
      now,
      id
    ]
  );

  // Update permissions if provided
  if (Array.isArray(permission_ids)) {
    await execute('DELETE FROM role_permissions WHERE role_id = ?', [id]);
    for (const permId of permission_ids) {
      const perm = await queryOne<{ id: string }>('SELECT id FROM permissions WHERE id = ? OR code = ?', [permId, permId]);
      if (perm) {
        await execute(
          `INSERT INTO role_permissions (id, role_id, permission_id, created_at) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING`,
          [`rp_${id}_${perm.id}`, id, perm.id, now]
        );
      }
    }

    await recordAuditLog({
      action: 'PERMISSION_CHANGED',
      entityType: 'ROLE',
      entityId: id,
      newValues: { role_code: role.code, granted_permissions: permission_ids },
      req
    });
  }

  await recordAuditLog({
    action: 'ROLE_UPDATED',
    entityType: 'ROLE',
    entityId: id,
    oldValues: role,
    newValues: { name, description, status },
    req
  });

  res.json({ role: await queryOne('SELECT * FROM roles WHERE id = ?', [id]) });
});

// DELETE /api/roles/:id
router.delete('/:id', requirePermission('roles.delete'), async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  const role = await queryOne<{ id: string; code: string; is_system: number }>('SELECT * FROM roles WHERE id = ?', [id]);

  if (!role) {
    res.status(404).json({ error: 'NOT_FOUND', message: 'Role not found.' });
    return;
  }

  if (role.is_system === 1) {
    res.status(400).json({ error: 'SYSTEM_ROLE_PROTECTED', message: 'System baseline roles cannot be deleted.' });
    return;
  }

  const usersInRole = await queryOne<{ count: number }>(
    'SELECT COUNT(*)::int as count FROM user_roles WHERE role_id = ?',
    [id]
  );

  if ((usersInRole?.count || 0) > 0) {
    res.status(409).json({
      error: 'ROLE_IN_USE',
      message: `Cannot delete role. There are ${usersInRole?.count} active users assigned to this role.`
    });
    return;
  }

  await execute('DELETE FROM role_permissions WHERE role_id = ?', [id]);
  await execute('DELETE FROM roles WHERE id = ?', [id]);

  await recordAuditLog({
    action: 'ROLE_DELETED',
    entityType: 'ROLE',
    entityId: id,
    oldValues: { code: role.code },
    req
  });

  res.json({ success: true, message: `Role ${role.code} deleted.` });
});

export default router;
