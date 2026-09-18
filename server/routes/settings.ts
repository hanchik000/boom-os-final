import { Router, Request, Response } from 'express';
import { query, queryOne, execute } from '../db';
import { authenticateToken, requirePermission, recordAuditLog } from '../auth';

const router = Router();
router.use(authenticateToken);

// GET /api/settings
router.get('/', requirePermission('settings.view'), async (req: Request, res: Response): Promise<void> => {
  const settings = await query<{
    id: string;
    key: string;
    value: string;
    type: string;
    description: string | null;
    updated_by: string | null;
    created_at: string;
    updated_at: string;
    updater_name?: string;
  }>(
    `SELECT s.*, u.full_name as updater_name 
     FROM system_settings s
     LEFT JOIN users u ON u.id = s.updated_by
     ORDER BY s.key ASC`
  );

  res.json({ settings });
});

// PUT /api/settings/:key
router.put('/:key', requirePermission('settings.update'), async (req: Request, res: Response): Promise<void> => {
  const { key } = req.params;
  const { value, description, type } = req.body;

  const existing = await queryOne<{ id: string; key: string; value: string; type: string }>(
    'SELECT * FROM system_settings WHERE key = ?',
    [key]
  );

  if (!existing) {
    res.status(404).json({ error: 'NOT_FOUND', message: 'Setting not found.' });
    return;
  }

  const now = new Date().toISOString();
  await execute(
    `UPDATE system_settings 
     SET value = ?, updated_by = ?, updated_at = ?
     WHERE key = ?`,
    [String(value), req.user!.id, now, key]
  );

  await recordAuditLog({
    action: 'SETTINGS_UPDATED',
    entityType: 'SETTING',
    entityId: key,
    oldValues: { value: existing.value },
    newValues: { value: String(value) },
    req
  });

  const updated = await queryOne('SELECT * FROM system_settings WHERE key = ?', [key]);
  res.json({ setting: updated });
});

// POST /api/settings
router.post('/', requirePermission('settings.update'), async (req: Request, res: Response): Promise<void> => {
  const { key, value, type, description } = req.body;

  if (!key || value === undefined) {
    res.status(400).json({ error: 'VALIDATION_ERROR', message: 'key and value are required.' });
    return;
  }

  const cleanKey = String(key).trim();
  const existing = await queryOne('SELECT id FROM system_settings WHERE key = ?', [cleanKey]);
  if (existing) {
    res.status(409).json({ error: 'CONFLICT', message: 'Setting key already exists.' });
    return;
  }

  const id = `st_${cleanKey.replace(/[^a-z0-9]/g, '_')}`;
  const now = new Date().toISOString();

  await execute(
    `INSERT INTO system_settings (id, key, value, type, description, updated_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, cleanKey, String(value), type || 'string', description || null, req.user!.id, now, now]
  );

  await recordAuditLog({
    action: 'SETTING_CREATED',
    entityType: 'SETTING',
    entityId: cleanKey,
    newValues: { key: cleanKey, value: String(value), type },
    req
  });

  res.status(201).json({ setting: await queryOne('SELECT * FROM system_settings WHERE key = ?', [cleanKey]) });
});

export default router;
