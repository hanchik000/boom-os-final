import { Router, Request, Response } from 'express';
import { query, queryOne, execute } from '../db';
import {
  authenticateToken,
  requirePermission,
  recordAuditLog,
  AuthenticatedUser
} from '../auth';

const router = Router();
router.use(authenticateToken);

// Helper to check if current user has access to a franchise
async function canUserAccessFranchise(user: AuthenticatedUser, franchiseId: string): Promise<boolean> {
  if (user.isSuperUser) return true;
  // If user has allowedBranchIds, check if any branch in this franchise is in allowedBranchIds
  const branches = await query<{ id: string }>('SELECT id FROM branches WHERE franchise_id = ?', [franchiseId]);
  const branchIds = branches.map(b => b.id);
  return branchIds.some(bId => user.allowedBranchIds.includes(bId));
}

// GET /api/franchises
router.get('/', requirePermission('franchises.view'), async (req: Request, res: Response): Promise<void> => {
  const { search, status } = req.query;
  const currentUser = req.user!;

  let sql = `
    SELECT 
      f.id, f.name, f.code, f.legal_name, f.contact_name, f.phone, f.email, f.address, f.status,
      f.created_at, f.updated_at, f.deleted_at,
      (SELECT COUNT(*)::int FROM branches b WHERE b.franchise_id = f.id) as branch_count,
      (SELECT COUNT(*)::int FROM branches b WHERE b.franchise_id = f.id AND b.status = 'ACTIVE') as active_branch_count,
      (
        SELECT COUNT(DISTINCT u.id)::int 
        FROM users u 
        LEFT JOIN user_branch_access uba ON uba.user_id = u.id
        LEFT JOIN branches b1 ON b1.id = u.branch_id
        LEFT JOIN branches b2 ON b2.id = uba.branch_id
        WHERE (b1.franchise_id = f.id OR b2.franchise_id = f.id) AND u.deleted_at IS NULL
      ) as employee_count,
      (
        SELECT COUNT(DISTINCT u.id)::int 
        FROM users u 
        LEFT JOIN user_branch_access uba ON uba.user_id = u.id
        LEFT JOIN branches b1 ON b1.id = u.branch_id
        LEFT JOIN branches b2 ON b2.id = uba.branch_id
        WHERE (b1.franchise_id = f.id OR b2.franchise_id = f.id) 
          AND u.deleted_at IS NULL 
          AND u.status = 'ACTIVE' 
          AND (u.employment_status IS NULL OR u.employment_status = 'ACTIVE')
      ) as active_employee_count
    FROM franchises f
    WHERE f.deleted_at IS NULL
  `;
  const params: any[] = [];

  // Multi-branch isolation for non-superusers: only franchises where user has branch access
  if (!currentUser.isSuperUser) {
    if (currentUser.allowedBranchIds.length === 0) {
      res.json({ franchises: [] });
      return;
    }
    const placeholders = currentUser.allowedBranchIds.map(() => '?').join(',');
    sql += ` AND f.id IN (SELECT DISTINCT franchise_id FROM branches WHERE id IN (${placeholders}) AND franchise_id IS NOT NULL)`;
    params.push(...currentUser.allowedBranchIds);
  }

  if (status && typeof status === 'string') {
    sql += ` AND f.status = ?`;
    params.push(status);
  }

  if (search && typeof search === 'string') {
    const term = `%${search.trim().toLowerCase()}%`;
    sql += ` AND (LOWER(f.name) LIKE ? OR LOWER(f.code) LIKE ? OR LOWER(f.legal_name) LIKE ? OR LOWER(f.contact_name) LIKE ?)`;
    params.push(term, term, term, term);
  }

  sql += ` ORDER BY f.code ASC`;

  const franchises = await query(sql, params);
  res.json({ franchises });
});

// GET /api/franchises/:id
router.get('/:id', requirePermission('franchises.view'), async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  const currentUser = req.user!;

  if (!(await canUserAccessFranchise(currentUser, id))) {
    res.status(403).json({ error: 'FORBIDDEN', message: 'Access denied to this franchise.' });
    return;
  }

  const franchise = await queryOne<{
    id: string;
    name: string;
    code: string;
    legal_name: string;
    contact_name: string;
    phone: string;
    email: string;
    address: string;
    status: string;
    created_at: string;
    updated_at: string;
    deleted_at: string | null;
  }>(
    'SELECT * FROM franchises WHERE id = ? AND deleted_at IS NULL',
    [id]
  );

  if (!franchise) {
    res.status(404).json({ error: 'NOT_FOUND', message: 'Franchise not found.' });
    return;
  }

  // Count branches and staff
  const branchCount = (await queryOne<{ count: number }>(
    'SELECT COUNT(*)::int as count FROM branches WHERE franchise_id = ?',
    [id]
  ))?.count || 0;

  const activeBranchCount = (await queryOne<{ count: number }>(
    "SELECT COUNT(*)::int as count FROM branches WHERE franchise_id = ? AND status = 'ACTIVE'",
    [id]
  ))?.count || 0;

  const employeeCount = (await queryOne<{ count: number }>(
    `SELECT COUNT(DISTINCT u.id)::int as count 
     FROM users u 
     LEFT JOIN user_branch_access uba ON uba.user_id = u.id
     LEFT JOIN branches b1 ON b1.id = u.branch_id
     LEFT JOIN branches b2 ON b2.id = uba.branch_id
     WHERE (b1.franchise_id = ? OR b2.franchise_id = ?) AND u.deleted_at IS NULL`,
    [id, id]
  ))?.count || 0;

  const activeEmployeeCount = (await queryOne<{ count: number }>(
    `SELECT COUNT(DISTINCT u.id)::int as count 
     FROM users u 
     LEFT JOIN user_branch_access uba ON uba.user_id = u.id
     LEFT JOIN branches b1 ON b1.id = u.branch_id
     LEFT JOIN branches b2 ON b2.id = uba.branch_id
     WHERE (b1.franchise_id = ? OR b2.franchise_id = ?) 
       AND u.deleted_at IS NULL 
       AND u.status = 'ACTIVE'
       AND (u.employment_status IS NULL OR u.employment_status = 'ACTIVE')`,
    [id, id]
  ))?.count || 0;

  res.json({
    franchise: {
      ...franchise,
      branch_count: branchCount,
      active_branch_count: activeBranchCount,
      employee_count: employeeCount,
      active_employee_count: activeEmployeeCount
    }
  });
});

// GET /api/franchises/:id/overview (Full Franchise Card & metrics)
router.get('/:id/overview', requirePermission('franchises.view'), async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  const currentUser = req.user!;

  if (!(await canUserAccessFranchise(currentUser, id))) {
    res.status(403).json({ error: 'FORBIDDEN', message: 'Access denied to this franchise.' });
    return;
  }

  const franchise = await queryOne<any>(
    'SELECT * FROM franchises WHERE id = ? AND deleted_at IS NULL',
    [id]
  );
  if (!franchise) {
    res.status(404).json({ error: 'NOT_FOUND', message: 'Franchise not found.' });
    return;
  }

  // Real Database Metrics
  const totalBranches = (await queryOne<{ count: number }>(
    'SELECT COUNT(*)::int as count FROM branches WHERE franchise_id = ?',
    [id]
  ))?.count || 0;

  const activeBranches = (await queryOne<{ count: number }>(
    "SELECT COUNT(*)::int as count FROM branches WHERE franchise_id = ? AND status = 'ACTIVE'",
    [id]
  ))?.count || 0;

  const totalEmployees = (await queryOne<{ count: number }>(
    `SELECT COUNT(DISTINCT u.id)::int as count 
     FROM users u 
     LEFT JOIN user_branch_access uba ON uba.user_id = u.id
     LEFT JOIN branches b1 ON b1.id = u.branch_id
     LEFT JOIN branches b2 ON b2.id = uba.branch_id
     WHERE (b1.franchise_id = ? OR b2.franchise_id = ?) AND u.deleted_at IS NULL`,
    [id, id]
  ))?.count || 0;

  const activeEmployees = (await queryOne<{ count: number }>(
    `SELECT COUNT(DISTINCT u.id)::int as count 
     FROM users u 
     LEFT JOIN user_branch_access uba ON uba.user_id = u.id
     LEFT JOIN branches b1 ON b1.id = u.branch_id
     LEFT JOIN branches b2 ON b2.id = uba.branch_id
     WHERE (b1.franchise_id = ? OR b2.franchise_id = ?) 
       AND u.deleted_at IS NULL 
       AND u.status = 'ACTIVE' 
       AND (u.employment_status IS NULL OR u.employment_status = 'ACTIVE')`,
    [id, id]
  ))?.count || 0;

  const inactiveEmployees = totalEmployees - activeEmployees;

  // Strict constraint: Future metrics are marked "N/A" (NO fake numbers)
  res.json({
    franchise,
    metrics: {
      total_branches: totalBranches,
      active_branches: activeBranches,
      total_employees: totalEmployees,
      active_employees: activeEmployees,
      inactive_employees: inactiveEmployees,
      // Future module indicators - cleanly flagged as disconnected
      orders_today: 'N/A',
      orders_this_week: 'N/A',
      orders_this_month: 'N/A',
      revenue_today: 'N/A',
      revenue_this_week: 'N/A',
      revenue_this_month: 'N/A',
      average_check: 'N/A',
      customers: 'N/A',
      average_rating: 'N/A',
      modules: {
        pos: { connected: false, status: 'DISCONNECTED', label: 'POS & Orders' },
        crm: { connected: false, status: 'DISCONNECTED', label: 'CRM & Customers' },
        kitchen: { connected: false, status: 'DISCONNECTED', label: 'Kitchen Display (KDS)' },
        inventory: { connected: false, status: 'DISCONNECTED', label: 'Inventory & Stock' },
        finance: { connected: false, status: 'DISCONNECTED', label: 'Finance & P&L' }
      }
    }
  });
});

// GET /api/franchises/:id/orders (Integration interface - strictly empty until POS connected)
router.get('/:id/orders', requirePermission('franchises.view'), async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  const currentUser = req.user!;

  if (!(await canUserAccessFranchise(currentUser, id))) {
    res.status(403).json({ error: 'FORBIDDEN', message: 'Access denied to this franchise.' });
    return;
  }

  // Pure integration interface: NO fake orders
  res.json({
    connected: false,
    franchise_id: id,
    message: 'Orders module not connected yet. Real-time POS bridge pending.',
    orders: []
  });
});

// POST /api/franchises
router.post('/', requirePermission('franchises.create'), async (req: Request, res: Response): Promise<void> => {
  const { name, code, legal_name, contact_name, phone, email, address, status } = req.body;

  if (!name || !code || !legal_name || !contact_name || !phone || !email || !address) {
    res.status(400).json({
      error: 'VALIDATION_ERROR',
      message: 'All fields (name, code, legal_name, contact_name, phone, email, address) are required.'
    });
    return;
  }

  const cleanCode = String(code).trim().toUpperCase();

  // Check unique code
  const existingCode = await queryOne('SELECT id FROM franchises WHERE UPPER(code) = ? AND deleted_at IS NULL', [cleanCode]);
  if (existingCode) {
    res.status(409).json({
      error: 'CONFLICT',
      message: `A franchise with code '${cleanCode}' already exists.`
    });
    return;
  }

  const franchiseId = `fr_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const now = new Date().toISOString();
  const franchiseStatus = status || 'ACTIVE';

  await execute(
    `INSERT INTO franchises (id, name, code, legal_name, contact_name, phone, email, address, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      franchiseId,
      name.trim(),
      cleanCode,
      legal_name.trim(),
      contact_name.trim(),
      phone.trim(),
      email.trim().toLowerCase(),
      address.trim(),
      franchiseStatus,
      now,
      now
    ]
  );

  await recordAuditLog({
    userId: req.user!.id,
    branchId: req.user!.branch_id,
    action: 'FRANCHISE_CREATED',
    entityType: 'FRANCHISE',
    entityId: franchiseId,
    newValues: {
      id: franchiseId,
      name: name.trim(),
      code: cleanCode,
      legal_name: legal_name.trim(),
      contact_name: contact_name.trim(),
      status: franchiseStatus
    },
    req
  });

  const created = await queryOne('SELECT * FROM franchises WHERE id = ?', [franchiseId]);
  res.status(201).json({
    message: 'Franchise registered successfully.',
    franchise: created
  });
});

// PUT /api/franchises/:id
router.put('/:id', requirePermission('franchises.update'), async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  if (!(await canUserAccessFranchise(req.user!, id))) {
    res.status(403).json({ error: 'FORBIDDEN', code: 'FRANCHISE_ACCESS_DENIED', message: 'Access denied to this franchise.' });
    return;
  }
  const { name, code, legal_name, contact_name, phone, email, address, status } = req.body;

  const existing = await queryOne<any>('SELECT * FROM franchises WHERE id = ? AND deleted_at IS NULL', [id]);
  if (!existing) {
    res.status(404).json({ error: 'NOT_FOUND', message: 'Franchise not found.' });
    return;
  }

  let cleanCode = existing.code;
  if (code && String(code).trim().toUpperCase() !== existing.code) {
    cleanCode = String(code).trim().toUpperCase();
    const codeConflict = await queryOne(
      'SELECT id FROM franchises WHERE UPPER(code) = ? AND id != ? AND deleted_at IS NULL',
      [cleanCode, id]
    );
    if (codeConflict) {
      res.status(409).json({ error: 'CONFLICT', message: `Franchise code '${cleanCode}' is already taken.` });
      return;
    }
  }

  const updatedName = name !== undefined ? name.trim() : existing.name;
  const updatedLegalName = legal_name !== undefined ? legal_name.trim() : existing.legal_name;
  const updatedContactName = contact_name !== undefined ? contact_name.trim() : existing.contact_name;
  const updatedPhone = phone !== undefined ? phone.trim() : existing.phone;
  const updatedEmail = email !== undefined ? email.trim().toLowerCase() : existing.email;
  const updatedAddress = address !== undefined ? address.trim() : existing.address;
  const updatedStatus = status !== undefined ? status : existing.status;
  const now = new Date().toISOString();

  await execute(
    `UPDATE franchises 
     SET name = ?, code = ?, legal_name = ?, contact_name = ?, phone = ?, email = ?, address = ?, status = ?, updated_at = ?
     WHERE id = ?`,
    [
      updatedName,
      cleanCode,
      updatedLegalName,
      updatedContactName,
      updatedPhone,
      updatedEmail,
      updatedAddress,
      updatedStatus,
      now,
      id
    ]
  );

  await recordAuditLog({
    userId: req.user!.id,
    branchId: req.user!.branch_id,
    action: 'FRANCHISE_UPDATED',
    entityType: 'FRANCHISE',
    entityId: id,
    oldValues: existing,
    newValues: {
      name: updatedName,
      code: cleanCode,
      legal_name: updatedLegalName,
      contact_name: updatedContactName,
      phone: updatedPhone,
      email: updatedEmail,
      address: updatedAddress,
      status: updatedStatus
    },
    req
  });

  const updated = await queryOne('SELECT * FROM franchises WHERE id = ?', [id]);
  res.json({
    message: 'Franchise updated successfully.',
    franchise: updated
  });
});

// PATCH /api/franchises/:id/status
router.patch('/:id/status', requirePermission('franchises.update'), async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  if (!(await canUserAccessFranchise(req.user!, id))) {
    res.status(403).json({ error: 'FORBIDDEN', code: 'FRANCHISE_ACCESS_DENIED', message: 'Access denied to this franchise.' });
    return;
  }
  const { status } = req.body;

  const validStatuses = ['ACTIVE', 'INACTIVE', 'SUSPENDED'];
  if (!validStatuses.includes(status)) {
    res.status(400).json({ error: 'VALIDATION_ERROR', message: `Status must be one of: ${validStatuses.join(', ')}` });
    return;
  }

  const existing = await queryOne<any>('SELECT * FROM franchises WHERE id = ? AND deleted_at IS NULL', [id]);
  if (!existing) {
    res.status(404).json({ error: 'NOT_FOUND', message: 'Franchise not found.' });
    return;
  }

  const now = new Date().toISOString();
  await execute('UPDATE franchises SET status = ?, updated_at = ? WHERE id = ?', [status, now, id]);

  await recordAuditLog({
    userId: req.user!.id,
    branchId: req.user!.branch_id,
    action: 'FRANCHISE_STATUS_CHANGED',
    entityType: 'FRANCHISE',
    entityId: id,
    oldValues: { status: existing.status },
    newValues: { status },
    req
  });

  res.json({
    message: `Franchise status changed to ${status}.`,
    status,
    franchise: { id, status }
  });
});

// DELETE /api/franchises/:id (Safe delete)
router.delete('/:id', requirePermission('franchises.delete'), async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  if (!(await canUserAccessFranchise(req.user!, id))) {
    res.status(403).json({ error: 'FORBIDDEN', code: 'FRANCHISE_ACCESS_DENIED', message: 'Access denied to this franchise.' });
    return;
  }
  const currentUser = req.user!;

  const existing = await queryOne<any>('SELECT * FROM franchises WHERE id = ? AND deleted_at IS NULL', [id]);
  if (!existing) {
    res.status(404).json({ error: 'NOT_FOUND', message: 'Franchise not found.' });
    return;
  }

  // 1. Check for active branches
  const activeBranchCount = (await queryOne<{ count: number }>(
    "SELECT COUNT(*)::int as count FROM branches WHERE franchise_id = ? AND status = 'ACTIVE'",
    [id]
  ))?.count || 0;

  // 2. Check for active employees
  const activeEmployeeCount = (await queryOne<{ count: number }>(
    `SELECT COUNT(DISTINCT u.id)::int as count
     FROM users u
     LEFT JOIN user_branch_access uba ON uba.user_id = u.id
     LEFT JOIN branches b1 ON b1.id = u.branch_id
     LEFT JOIN branches b2 ON b2.id = uba.branch_id
     WHERE (b1.franchise_id = ? OR b2.franchise_id = ?) 
       AND u.deleted_at IS NULL 
       AND u.status = 'ACTIVE'`,
    [id, id]
  ))?.count || 0;

  if (activeBranchCount > 0 || activeEmployeeCount > 0) {
    res.status(400).json({
      error: 'FRANCHISE_HAS_DEPENDENCIES',
      message: 'This franchise cannot be deleted because it contains active branches or employees.',
      suggestion: 'Deactivate Franchise',
      dependencies: {
        active_branches: activeBranchCount,
        active_employees: activeEmployeeCount
      }
    });
    return;
  }

  const now = new Date().toISOString();
  // Safe soft delete
  await execute("UPDATE franchises SET deleted_at = ?, status = 'INACTIVE', updated_at = ? WHERE id = ?", [now, now, id]);

  await recordAuditLog({
    userId: currentUser.id,
    branchId: currentUser.branch_id,
    action: 'FRANCHISE_DELETED',
    entityType: 'FRANCHISE',
    entityId: id,
    oldValues: { name: existing.name, code: existing.code, status: existing.status },
    newValues: { status: 'INACTIVE', deleted_at: now },
    req
  });

  res.json({
    message: `Franchise '${existing.name}' (${existing.code}) safely deleted and archived.`,
    success: true
  });
});

// GET /api/franchises/:id/branches
router.get('/:id/branches', requirePermission('franchises.view'), async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  const currentUser = req.user!;

  if (!(await canUserAccessFranchise(currentUser, id))) {
    res.status(403).json({ error: 'FORBIDDEN', message: 'Access denied to this franchise.' });
    return;
  }

  let sql = `
    SELECT 
      b.id, b.name, b.code, b.address, b.phone, b.timezone, b.currency, b.status,
      b.franchise_id, b.created_at, b.updated_at,
      (SELECT COUNT(*)::int FROM users u WHERE u.branch_id = b.id AND u.deleted_at IS NULL) as staff_count
    FROM branches b
    WHERE b.franchise_id = ?
  `;
  const params: any[] = [id];

  if (!currentUser.isSuperUser) {
    const placeholders = currentUser.allowedBranchIds.map(() => '?').join(',');
    sql += ` AND b.id IN (${placeholders})`;
    params.push(...currentUser.allowedBranchIds);
  }

  sql += ` ORDER BY b.code ASC`;

  const branches = await query(sql, params);
  res.json({ branches });
});

// POST /api/franchises/:id/branches/:branchId (Assign existing branch to franchise)
router.post('/:id/branches/:branchId', requirePermission('franchises.update'), async (req: Request, res: Response): Promise<void> => {
  const { id, branchId } = req.params;
  // Moving a branch between franchises changes who can see its data, so the caller must
  // hold both the target franchise and the branch itself. Superusers are exempt, as everywhere.
  if (!(await canUserAccessFranchise(req.user!, id))) {
    res.status(403).json({ error: 'FORBIDDEN', code: 'FRANCHISE_ACCESS_DENIED', message: 'Access denied to this franchise.' });
    return;
  }
  if (!req.user!.isSuperUser && !req.user!.allowedBranchIds.includes(branchId)) {
    res.status(403).json({ error: 'BRANCH_ACCESS_DENIED', code: 'BRANCH_ACCESS_DENIED', message: 'Branch is outside your access scope.', details: { branch_id: branchId } });
    return;
  }

  const franchise = await queryOne<{ id: string; name: string }>(
    'SELECT id, name FROM franchises WHERE id = ? AND deleted_at IS NULL',
    [id]
  );
  if (!franchise) {
    res.status(404).json({ error: 'NOT_FOUND', message: 'Franchise not found.' });
    return;
  }

  const branch = await queryOne<{ id: string; name: string; franchise_id: string | null }>(
    'SELECT id, name, franchise_id FROM branches WHERE id = ?',
    [branchId]
  );
  if (!branch) {
    res.status(404).json({ error: 'NOT_FOUND', message: 'Branch not found.' });
    return;
  }

  const oldFranchiseId = branch.franchise_id;
  const now = new Date().toISOString();

  await execute('UPDATE branches SET franchise_id = ?, updated_at = ? WHERE id = ?', [id, now, branchId]);

  await recordAuditLog({
    userId: req.user!.id,
    branchId: branchId,
    action: 'BRANCH_ASSIGNED_TO_FRANCHISE',
    entityType: 'BRANCH',
    entityId: branchId,
    oldValues: { franchise_id: oldFranchiseId },
    newValues: { franchise_id: id, franchise_name: franchise.name },
    req
  });

  res.json({
    message: `Branch '${branch.name}' successfully assigned to franchise '${franchise.name}'.`,
    branch: { id: branch.id, name: branch.name, franchise_id: id }
  });
});

// DELETE /api/franchises/:id/branches/:branchId (Remove branch from franchise without deleting the branch itself)
router.delete('/:id/branches/:branchId', requirePermission('franchises.update'), async (req: Request, res: Response): Promise<void> => {
  const { id, branchId } = req.params;
  // Moving a branch between franchises changes who can see its data, so the caller must
  // hold both the target franchise and the branch itself. Superusers are exempt, as everywhere.
  if (!(await canUserAccessFranchise(req.user!, id))) {
    res.status(403).json({ error: 'FORBIDDEN', code: 'FRANCHISE_ACCESS_DENIED', message: 'Access denied to this franchise.' });
    return;
  }
  if (!req.user!.isSuperUser && !req.user!.allowedBranchIds.includes(branchId)) {
    res.status(403).json({ error: 'BRANCH_ACCESS_DENIED', code: 'BRANCH_ACCESS_DENIED', message: 'Branch is outside your access scope.', details: { branch_id: branchId } });
    return;
  }

  const branch = await queryOne<{ id: string; name: string; franchise_id: string | null }>(
    'SELECT id, name, franchise_id FROM branches WHERE id = ? AND franchise_id = ?',
    [branchId, id]
  );

  if (!branch) {
    res.status(404).json({ error: 'NOT_FOUND', message: 'Branch not found or does not belong to this franchise.' });
    return;
  }

  const now = new Date().toISOString();
  await execute('UPDATE branches SET franchise_id = NULL, updated_at = ? WHERE id = ?', [now, branchId]);

  await recordAuditLog({
    userId: req.user!.id,
    branchId: branchId,
    action: 'BRANCH_REMOVED_FROM_FRANCHISE',
    entityType: 'BRANCH',
    entityId: branchId,
    oldValues: { franchise_id: id },
    newValues: { franchise_id: null },
    req
  });

  res.json({
    message: `Branch '${branch.name}' unlinked from franchise. Branch was not deleted.`,
    branch: { id: branch.id, name: branch.name, franchise_id: null }
  });
});

// GET /api/franchises/:id/employees
router.get('/:id/employees', requirePermission('franchises.view'), async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  const currentUser = req.user!;

  if (!(await canUserAccessFranchise(currentUser, id))) {
    res.status(403).json({ error: 'FORBIDDEN', message: 'Access denied to this franchise.' });
    return;
  }

  // Passing the franchise gate only means the caller holds *some* branch of it. The rows
  // themselves must still be limited to the branches they actually hold, exactly as
  // GET /:id/branches does.
  let scopeClause = '';
  const scopeParams: string[] = [];
  if (!currentUser.isSuperUser) {
    if (!currentUser.allowedBranchIds.length) { res.json({ employees: [] }); return; }
    const ph = currentUser.allowedBranchIds.map(() => '?').join(',');
    scopeClause = `AND (pb.id IN (${ph}) OR ab.id IN (${ph}))`;
    scopeParams.push(...currentUser.allowedBranchIds, ...currentUser.allowedBranchIds);
  }

  // Find all employees whose primary branch or allowed branch belongs to this franchise
  const rawEmployees = await query<any>(
    `SELECT DISTINCT
      u.id, u.full_name, u.email, u.phone, u.status, u.employment_status, u.disciplinary_status,
      u.joined_at, u.status_reason, u.status_changed_at, u.status_changed_by,
      u.branch_id as primary_branch_id,
      pb.name as primary_branch_name, pb.code as primary_branch_code
    FROM users u
    LEFT JOIN branches pb ON pb.id = u.branch_id
    LEFT JOIN user_branch_access uba ON uba.user_id = u.id
    LEFT JOIN branches ab ON ab.id = uba.branch_id
    WHERE (pb.franchise_id = ? OR ab.franchise_id = ?) AND u.deleted_at IS NULL
    ${scopeClause}
    ORDER BY u.full_name ASC`,
    [id, id, ...scopeParams]
  );

  const totalBranchesInFranchise = (await queryOne<{ count: number }>(
    'SELECT COUNT(*)::int as count FROM branches WHERE franchise_id = ?',
    [id]
  ))?.count || 0;

  const employees: any[] = [];
  for (const emp of rawEmployees) {
    // Roles
    const roles = await query<{ id: string; code: string; name: string }>(
      `SELECT r.id, r.code, r.name 
       FROM roles r 
       INNER JOIN user_roles ur ON ur.role_id = r.id 
       WHERE ur.user_id = ? AND r.status = 'ACTIVE'`,
      [emp.id]
    );

    // Branch access list
    const branchAccess = await query<{ branch_id: string; name: string; code: string }>(
      `SELECT uba.branch_id, b.name, b.code
       FROM user_branch_access uba
       INNER JOIN branches b ON b.id = uba.branch_id
       WHERE uba.user_id = ?`,
      [emp.id]
    );

    const isSuper = roles.some(r => r.code === 'OWNER' || r.code === 'SUPER_ADMIN');
    const hasAllBranches = isSuper || (branchAccess.length > 0 && branchAccess.length >= totalBranchesInFranchise);

    employees.push({
      ...emp,
      employment_status: emp.employment_status || 'ACTIVE',
      disciplinary_status: emp.disciplinary_status || 'NONE',
      roles,
      branch_access: branchAccess,
      has_all_branches: hasAllBranches
    });
  }

  res.json({ employees });
});

export default router;
