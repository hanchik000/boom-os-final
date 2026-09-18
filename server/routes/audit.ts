import { Router, Request, Response } from 'express';
import { query, queryOne } from '../db';
import { authenticateToken, requirePermission } from '../auth';

const router = Router();
router.use(authenticateToken);

// GET /api/audit
router.get('/', requirePermission('audit.view'), async (req: Request, res: Response): Promise<void> => {
  const {
    user_id,
    branch_id,
    action,
    entity_type,
    search,
    start_date,
    end_date,
    limit = '50',
    offset = '0'
  } = req.query;

  const currentUser = req.user!;
  let whereClauses: string[] = ['1=1'];
  const params: any[] = [];

  // Branch isolation for non-superusers
  if (!currentUser.isSuperUser) {
    if (currentUser.allowedBranchIds.length === 0) {
      whereClauses.push('a.user_id = ?');
      params.push(currentUser.id);
    } else {
      const placeholders = currentUser.allowedBranchIds.map(() => '?').join(',');
      whereClauses.push(`(a.branch_id IN (${placeholders}) OR a.user_id = ? OR a.branch_id IS NULL)`);
      params.push(...currentUser.allowedBranchIds, currentUser.id);
    }
  }

  if (user_id && typeof user_id === 'string') {
    whereClauses.push('a.user_id = ?');
    params.push(user_id);
  }

  if (branch_id && typeof branch_id === 'string') {
    whereClauses.push('a.branch_id = ?');
    params.push(branch_id);
  }

  if (action && typeof action === 'string') {
    whereClauses.push('a.action = ?');
    params.push(action);
  }

  if (entity_type && typeof entity_type === 'string') {
    whereClauses.push('a.entity_type = ?');
    params.push(entity_type);
  }

  if (start_date && typeof start_date === 'string') {
    whereClauses.push('a.created_at >= ?');
    params.push(start_date);
  }

  if (end_date && typeof end_date === 'string') {
    whereClauses.push('a.created_at <= ?');
    params.push(end_date);
  }

  if (search && typeof search === 'string') {
    const term = `%${search.trim().toLowerCase()}%`;
    whereClauses.push(`(
      LOWER(a.action) LIKE ? OR 
      LOWER(a.entity_type) LIKE ? OR 
      LOWER(COALESCE(a.entity_id, '')) LIKE ? OR 
      LOWER(COALESCE(u.full_name, '')) LIKE ? OR 
      LOWER(COALESCE(u.email, '')) LIKE ? OR
      LOWER(COALESCE(b.name, '')) LIKE ? OR
      LOWER(COALESCE(a.new_values, '')) LIKE ?
    )`);
    params.push(term, term, term, term, term, term, term);
  }

  const whereSql = whereClauses.join(' AND ');

  const countRow = await queryOne<{ total: number }>(
    `SELECT COUNT(*)::int as total 
     FROM audit_logs a
     LEFT JOIN users u ON u.id = a.user_id
     LEFT JOIN branches b ON b.id = a.branch_id
     WHERE ${whereSql}`,
    params
  );

  const numLimit = Math.min(Math.max(parseInt(String(limit), 10) || 50, 1), 200);
  const numOffset = Math.max(parseInt(String(offset), 10) || 0, 0);

  const logs = await query(
    `SELECT 
       a.id, a.user_id, a.branch_id, a.action, a.entity_type, a.entity_id,
       a.old_values, a.new_values, a.ip_address, a.user_agent, a.created_at,
       u.full_name as user_name, u.email as user_email,
       b.name as branch_name, b.code as branch_code
     FROM audit_logs a
     LEFT JOIN users u ON u.id = a.user_id
     LEFT JOIN branches b ON b.id = a.branch_id
     WHERE ${whereSql}
     ORDER BY a.created_at DESC
     LIMIT ? OFFSET ?`,
    [...params, numLimit, numOffset]
  );

  // Available distinct actions for filter dropdown
  const distinctActionsRows = await query<{ action: string }>('SELECT DISTINCT action FROM audit_logs ORDER BY action ASC');
  const distinctActions = distinctActionsRows.map(r => r.action);

  res.json({
    logs: logs.map(l => ({
      ...l,
      old_values: l.old_values ? safeParseJson(l.old_values) : null,
      new_values: l.new_values ? safeParseJson(l.new_values) : null
    })),
    total: countRow?.total || 0,
    distinctActions,
    limit: numLimit,
    offset: numOffset
  });
});

function safeParseJson(str: string) {
  try {
    return JSON.parse(str);
  } catch {
    return str;
  }
}

export default router;
