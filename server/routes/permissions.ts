import { Router, Request, Response } from 'express';
import { query, queryOne, execute } from '../db';
import { authenticateToken, requirePermission, recordAuditLog } from '../auth';

const router = Router();
router.use(authenticateToken);

// GET /api/permissions
router.get('/', requirePermission('permissions.view'), async (req: Request, res: Response): Promise<void> => {
  const permissions = await query<{
    id: string;
    code: string;
    name: string;
    module: string;
    description: string | null;
    created_at: string;
  }>('SELECT * FROM permissions ORDER BY module ASC, code ASC');

  // Group by module
  const grouped: Record<string, typeof permissions> = {};
  for (const p of permissions) {
    if (!grouped[p.module]) grouped[p.module] = [];
    grouped[p.module].push(p);
  }

  res.json({
    permissions,
    grouped
  });
});

// POST /api/permissions
router.post('/', requirePermission('permissions.create'), async (req: Request, res: Response): Promise<void> => {
  const { code, name, module, description } = req.body;

  if (!code || !name || !module) {
    res.status(400).json({ error: 'VALIDATION_ERROR', message: 'code, name, and module are required.' });
    return;
  }

  const cleanCode = String(code).trim().toLowerCase();
  const existing = await queryOne('SELECT id FROM permissions WHERE code = ?', [cleanCode]);
  if (existing) {
    res.status(409).json({ error: 'CONFLICT', message: 'Permission code already exists.' });
    return;
  }

  const id = `perm_${cleanCode.replace(/[^a-z0-9]/g, '_')}`;
  const now = new Date().toISOString();

  await execute(
    `INSERT INTO permissions (id, code, name, module, description, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [id, cleanCode, name.trim(), module.trim().toLowerCase(), description || null, now]
  );

  await recordAuditLog({
    action: 'PERMISSION_CREATED',
    entityType: 'PERMISSION',
    entityId: id,
    newValues: { code: cleanCode, name, module },
    req
  });

  res.status(201).json({ permission: await queryOne('SELECT * FROM permissions WHERE id = ?', [id]) });
});

export default router;
