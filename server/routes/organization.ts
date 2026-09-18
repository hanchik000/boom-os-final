import { Router, Request, Response } from 'express';
import { query, queryOne } from '../db';
import { authenticateToken, requirePermission } from '../auth';

const router = Router();
router.use(authenticateToken);

/**
 * Organization read model.
 * This is deliberately an aggregation layer: future POS/CRM/Finance modules
 * should attach to franchise_id/branch_id rather than creating their own hierarchy.
 */
router.get('/tree', requirePermission('franchises.view'), async (req: Request, res: Response): Promise<void> => {
  const user = req.user!;
  let branchFilter = '';
  const params: string[] = [];

  if (!user.isSuperUser) {
    if (user.allowedBranchIds.length === 0) {
      res.json({ franchises: [] });
      return;
    }
    const placeholders = user.allowedBranchIds.map(() => '?').join(',');
    branchFilter = ` AND b.id IN (${placeholders})`;
    params.push(...user.allowedBranchIds);
  }

  const franchises = await query<any>(
    `SELECT f.id, f.name, f.code, f.legal_name, f.status,
            COUNT(DISTINCT b.id)::int AS branch_count,
            COUNT(DISTINCT CASE WHEN b.status = 'ACTIVE' THEN b.id END)::int AS active_branch_count
       FROM franchises f
       LEFT JOIN branches b ON b.franchise_id = f.id${branchFilter}
      WHERE f.deleted_at IS NULL
      GROUP BY f.id
      ORDER BY f.name ASC`,
    params
  );

  const branches = await query<any>(
    `SELECT b.id, b.name, b.code, b.status, b.franchise_id,
            f.name AS franchise_name, f.code AS franchise_code,
            COUNT(DISTINCT u.id)::int AS employee_count
       FROM branches b
       LEFT JOIN franchises f ON f.id = b.franchise_id
       LEFT JOIN users u ON u.branch_id = b.id AND u.deleted_at IS NULL
      WHERE 1=1${branchFilter}
      GROUP BY b.id, f.name, f.code
      ORDER BY f.name ASC NULLS LAST, b.name ASC`,
    params
  );

  const tree = franchises.map((f: any) => ({
    ...f,
    branches: branches.filter((b: any) => b.franchise_id === f.id)
  }));

  const unassignedBranches = branches.filter((b: any) => !b.franchise_id);
  res.json({ franchises: tree, unassigned_branches: unassignedBranches });
});

router.get('/summary', requirePermission('franchises.view'), async (req: Request, res: Response): Promise<void> => {
  const user = req.user!;
  if (!user.isSuperUser && user.allowedBranchIds.length === 0) {
    res.json({ franchises: 0, branches: 0, active_branches: 0, employees: 0, active_employees: 0 });
    return;
  }

  const branchParams = user.isSuperUser ? [] : user.allowedBranchIds;
  const branchFilter = user.isSuperUser
    ? ''
    : ` AND b.id IN (${user.allowedBranchIds.map(() => '?').join(',')})`;

  const franchiseRow = await queryOne<{ count: number }>(
    `SELECT COUNT(DISTINCT f.id)::int AS count
       FROM franchises f
       INNER JOIN branches b ON b.franchise_id = f.id${branchFilter}
      WHERE f.deleted_at IS NULL`,
    branchParams
  );

  const branchRow = await queryOne<any>(
    `SELECT COUNT(DISTINCT b.id)::int AS branches,
            COUNT(DISTINCT CASE WHEN b.status = 'ACTIVE' THEN b.id END)::int AS active_branches,
            COUNT(DISTINCT u.id)::int AS employees,
            COUNT(DISTINCT CASE WHEN u.status = 'ACTIVE' THEN u.id END)::int AS active_employees
       FROM branches b
       LEFT JOIN users u ON u.branch_id = b.id AND u.deleted_at IS NULL
      WHERE 1=1${branchFilter}`,
    branchParams
  );

  res.json({
    franchises: franchiseRow?.count || 0,
    branches: branchRow?.branches || 0,
    active_branches: branchRow?.active_branches || 0,
    employees: branchRow?.employees || 0,
    active_employees: branchRow?.active_employees || 0
  });
});

export default router;
