import { Router, Request, Response } from 'express';
import { query, queryOne, execute, transaction } from '../db';
import {
  authenticateToken,
  requirePermission,
  hashPassword,
  recordAuditLog,
  getFullUserProfile,
  insertAuditLog
} from '../auth';

const router = Router();
router.use(authenticateToken);

// GET /api/users
// Branch scope for a target employee. Mirrors the check GET /:id and PUT /:id already
// apply, so every employee-scoped route denies identically instead of each route
// re-deriving the rule (or omitting it).
function denyIfForeignBranch(req: Request, res: Response, target: { id: string; branch_id: string | null }): boolean {
  const u = req.user!;
  if (u.isSuperUser || target.id === u.id) return false;
  if (target.branch_id && !u.allowedBranchIds.includes(target.branch_id)) {
    res.status(403).json({ error: 'BRANCH_ACCESS_DENIED', code: 'BRANCH_ACCESS_DENIED', message: 'User belongs to an unauthorized branch.' });
    return true;
  }
  return false;
}

router.get('/', requirePermission('users.view'), async (req: Request, res: Response): Promise<void> => {
  const { branch_id, search, status, role } = req.query;
  const currentUser = req.user!;

  let sql = `
    SELECT 
      u.id, u.full_name, u.email, u.phone, u.avatar_url, u.status,
      u.employment_status, u.disciplinary_status, u.joined_at, u.status_reason, u.status_changed_at, u.status_changed_by,
      u.branch_id, u.created_at, u.updated_at, u.last_login_at,
      b.name as branch_name, b.code as branch_code
    FROM users u
    LEFT JOIN branches b ON b.id = u.branch_id
    WHERE u.deleted_at IS NULL
  `;
  const params: any[] = [];

  // Multi-branch isolation for non-superusers
  if (!currentUser.isSuperUser) {
    if (currentUser.allowedBranchIds.length === 0) {
      res.json({ users: [] });
      return;
    }
    const placeholders = currentUser.allowedBranchIds.map(() => '?').join(',');
    sql += ` AND (u.branch_id IN (${placeholders}) OR EXISTS (SELECT 1 FROM user_branch_access uba_scope WHERE uba_scope.user_id = u.id AND uba_scope.branch_id IN (${placeholders})) OR u.id = ?)`;
    params.push(...currentUser.allowedBranchIds, ...currentUser.allowedBranchIds, currentUser.id);
  }

  if (branch_id && typeof branch_id === 'string') {
    if (!currentUser.isSuperUser && !currentUser.allowedBranchIds.includes(branch_id)) {
      res.status(403).json({ error: 'BRANCH_ACCESS_DENIED', code: 'BRANCH_ACCESS_DENIED', message: 'Requested branch is outside your assigned access scope.', details: { branch_id } });
      return;
    }
    sql += ` AND (u.branch_id = ? OR EXISTS (SELECT 1 FROM user_branch_access uba_branch WHERE uba_branch.user_id = u.id AND uba_branch.branch_id = ?))`;
    params.push(branch_id, branch_id);
  }

  if (status && typeof status === 'string') {
    sql += ` AND u.status = ?`;
    params.push(status);
  }

  if (search && typeof search === 'string') {
    const term = `%${search.trim().toLowerCase()}%`;
    sql += ` AND (LOWER(u.full_name) LIKE ? OR LOWER(u.email) LIKE ? OR u.phone LIKE ?)`;
    params.push(term, term, term);
  }

  sql += ` ORDER BY u.created_at DESC`;

  const rawUsers = await query<any>(sql, params);

  // Fetch roles and branches for each user
  const usersWithDetails: any[] = [];
  for (const u of rawUsers) {
    const roles = await query<{ id: string; code: string; name: string }>(
      `SELECT r.id, r.code, r.name 
       FROM roles r 
       INNER JOIN user_roles ur ON ur.role_id = r.id 
       WHERE ur.user_id = ? AND r.status = 'ACTIVE'`,
      [u.id]
    );

    const branchAccess = await query<{ branch_id: string; name: string; code: string }>(
      `SELECT uba.branch_id, b.name, b.code
       FROM user_branch_access uba
       INNER JOIN branches b ON b.id = uba.branch_id
       WHERE uba.user_id = ?`,
      [u.id]
    );

    usersWithDetails.push({
      ...u,
      roles,
      branchAccess
    });
  }

  // Optional role filter after joining
  let filtered = usersWithDetails;
  if (role && typeof role === 'string') {
    filtered = usersWithDetails.filter(u => u.roles.some((r: any) => r.code === role));
  }

  res.json({ users: filtered });
});

// GET /api/users/:id
router.get('/:id', requirePermission('users.view'), async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  const user = await queryOne<{
    id: string;
    full_name: string;
    email: string;
    phone: string;
    avatar_url: string | null;
    status: string;
    employment_status: string;
    disciplinary_status: string;
    joined_at: string | null;
    status_reason: string | null;
    status_changed_at: string | null;
    status_changed_by: string | null;
    branch_id: string | null;
    created_at: string;
    updated_at: string;
    last_login_at: string | null;
    deleted_at: string | null;
  }>(
    `SELECT 
      id, full_name, email, phone, avatar_url, status,
      employment_status, disciplinary_status, joined_at, status_reason, status_changed_at, status_changed_by,
      branch_id, created_at, updated_at, last_login_at, deleted_at
     FROM users WHERE id = ? AND deleted_at IS NULL`,
    [id]
  );

  if (!user) {
    res.status(404).json({ error: 'NOT_FOUND', message: 'User not found.' });
    return;
  }

  // Branch security check for non-superusers
  if (!req.user!.isSuperUser && user.branch_id && !req.user!.allowedBranchIds.includes(user.branch_id) && user.id !== req.user!.id) {
    res.status(403).json({ error: 'BRANCH_ACCESS_DENIED', message: 'User belongs to an unauthorized branch.' });
    return;
  }

  const roles = await query<{ id: string; code: string; name: string }>(
    `SELECT r.id, r.code, r.name 
     FROM roles r 
     INNER JOIN user_roles ur ON ur.role_id = r.id 
     WHERE ur.user_id = ?`,
    [id]
  );

  const branchAccess = await query<{ branch_id: string; name: string; code: string }>(
    `SELECT uba.branch_id, b.name, b.code
     FROM user_branch_access uba
     INNER JOIN branches b ON b.id = uba.branch_id
     WHERE uba.user_id = ?`,
    [id]
  );

  res.json({
    user: {
      ...user,
      roles,
      branchAccess
    }
  });
});

// POST /api/users
router.post('/', requirePermission('users.create'), async (req: Request, res: Response): Promise<void> => {
  const { 
    full_name, email, phone, password, branch_id, roles, allowed_branches, avatar_url, status,
    employment_status, disciplinary_status, joined_at
  } = req.body;

  if (!full_name || !email || !phone || !password) {
    res.status(400).json({
      error: 'VALIDATION_ERROR',
      message: 'full_name, email, phone, and password are required fields.'
    });
    return;
  }

  if (String(password).length < 8) {
    res.status(400).json({
      error: 'VALIDATION_ERROR',
      message: 'Password must be at least 8 characters.'
    });
    return;
  }

  const cleanEmail = String(email).trim().toLowerCase();
  const cleanPhone = String(phone).trim();

  // Check unique constraints
  const existingEmail = await queryOne('SELECT id FROM users WHERE LOWER(email) = ? AND deleted_at IS NULL', [cleanEmail]);
  if (existingEmail) {
    res.status(409).json({ error: 'CONFLICT', message: 'A user with this email address already exists.' });
    return;
  }

  const existingPhone = await queryOne('SELECT id FROM users WHERE phone = ? AND deleted_at IS NULL', [cleanPhone]);
  if (existingPhone) {
    res.status(409).json({ error: 'CONFLICT', message: 'A user with this phone number already exists.' });
    return;
  }

  const userId = `usr_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const now = new Date().toISOString();
  const passwordHash = hashPassword(password);
  const empStatus = employment_status || 'ACTIVE';
  const discStatus = disciplinary_status || 'NONE';
  const userJoinedAt = joined_at || now;
  const userStatus = status || (empStatus === 'TERMINATED' ? 'INACTIVE' : (empStatus === 'SUSPENDED' ? 'SUSPENDED' : 'ACTIVE'));

  const requestedBranchIds = Array.from(new Set<string>([
    ...(branch_id ? [String(branch_id)] : []),
    ...(Array.isArray(allowed_branches) ? allowed_branches.map(String) : [])
  ]));
  if (!req.user!.isSuperUser) {
    const unauthorized = requestedBranchIds.filter(id => !req.user!.allowedBranchIds.includes(id));
    if (unauthorized.length) {
      res.status(403).json({ error: 'BRANCH_ACCESS_DENIED', code: 'BRANCH_ACCESS_DENIED', message: 'Cannot assign a user to a branch outside your access scope.', details: { branch_ids: unauthorized } });
      return;
    }
  }
  if (requestedBranchIds.length) {
    const placeholders = requestedBranchIds.map(() => '?').join(',');
    const branches = await query<{ id: string }>(`SELECT id FROM branches WHERE id IN (${placeholders}) AND status <> 'INACTIVE'`, requestedBranchIds);
    const found = new Set(branches.map(b => b.id));
    const missing = requestedBranchIds.filter(id => !found.has(id));
    if (missing.length) {
      res.status(400).json({ error: 'VALIDATION_ERROR', code: 'INVALID_BRANCH', message: 'One or more requested branches do not exist or are inactive.', details: { branch_ids: missing } });
      return;
    }
  }

  const roleRows: Array<{ id: string; code: string }> = [];
  if (Array.isArray(roles)) {
    for (const roleIdOrCode of roles) {
      const roleRow = await queryOne<{ id: string; code: string }>("SELECT id, code FROM roles WHERE (id = ? OR code = ?) AND status = 'ACTIVE'", [roleIdOrCode, roleIdOrCode]);
      if (!roleRow) {
        res.status(400).json({ error: 'VALIDATION_ERROR', code: 'INVALID_ROLE', message: `Role ${roleIdOrCode} does not exist or is inactive.`, details: { role: roleIdOrCode } });
        return;
      }
      if (!req.user!.isSuperUser && ['OWNER', 'SUPER_ADMIN'].includes(roleRow.code)) {
        res.status(403).json({ error: 'FORBIDDEN', code: 'FORBIDDEN', message: 'Only OWNER and SUPER_ADMIN can grant administrative roles.', details: { role: roleRow.code } });
        return;
      }
      if (!roleRows.some(r => r.id === roleRow.id)) roleRows.push(roleRow);
    }
  }

  const assignedRoleCodes = roleRows.map(r => r.code);

  // Prevent privilege escalation through role assignment. A non-superuser may
  // only grant roles whose effective permissions are a subset of their own.
  if (!req.user!.isSuperUser && roleRows.length) {
    const rolePlaceholders = roleRows.map(() => '?').join(',');
    const requestedPerms = await query<{ code: string }>(
      `SELECT DISTINCT p.code FROM permissions p
       INNER JOIN role_permissions rp ON rp.permission_id = p.id
       WHERE rp.role_id IN (${rolePlaceholders})`,
      roleRows.map(r => r.id)
    );
    const callerPerms = new Set(req.user!.permissions);
    const forbidden = requestedPerms.map(p => p.code).filter(code => !callerPerms.has(code));
    if (forbidden.length) {
      res.status(403).json({
        error: 'PRIVILEGE_ESCALATION_FORBIDDEN',
        code: 'PRIVILEGE_ESCALATION_FORBIDDEN',
        message: 'You cannot assign a role that grants permissions you do not possess.',
        details: { permissions: forbidden }
      });
      return;
    }
  }

  await transaction(async ({ execute: txExecute }) => {
    await txExecute(

    `INSERT INTO users (
      id, full_name, email, phone, password_hash, avatar_url, status,
      employment_status, disciplinary_status, joined_at, status_changed_at, status_changed_by,
      branch_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      userId, full_name.trim(), cleanEmail, cleanPhone, passwordHash, avatar_url || null, userStatus,
      empStatus, discStatus, userJoinedAt, now, req.user!.full_name || req.user!.email,
      branch_id || null, now, now
    ]
  );

    // Initial status history
    await txExecute(
    `INSERT INTO employee_status_history 
     (id, user_id, employment_status, disciplinary_status, reason, notes, effective_from, changed_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      `esh_${userId}_init`,
      userId,
      empStatus,
      discStatus,
      'Initial employee provisioning',
      'System recorded initial employee status upon onboarding',
      userJoinedAt,
      req.user!.full_name || req.user!.email,
      now
    ]
  );

    // Create the operational employee profile alongside every user.
    const employeeCode = `EMP-${userId}`;
    await txExecute(
    `INSERT INTO employee_profiles (user_id, employee_code, position_title, employment_type, hire_date, created_at, updated_at) VALUES (?, ?, ?, 'FULL_TIME', ?, ?, ?) ON CONFLICT (user_id) DO NOTHING`,
    [userId, employeeCode, 'Staff', userJoinedAt, now, now]
  );

    // Assign validated roles atomically.
    for (const roleRow of roleRows) {
      await txExecute(
        `INSERT INTO user_roles (id, user_id, role_id, created_at) VALUES (?, ?, ?, ?)`,
        [`ur_${userId}_${roleRow.id}`, userId, roleRow.id, now]
      );
    }

    // Assign validated branch access atomically.
    for (const bId of requestedBranchIds) {
      await txExecute(
        `INSERT INTO user_branch_access (id, user_id, branch_id, created_at) VALUES (?, ?, ?, ?)`,
        [`uba_${userId}_${bId}`, userId, bId, now]
      );
    }

    await insertAuditLog(txExecute, {
      action: 'USER_CREATED',
      entityType: 'USER',
      entityId: userId,
      branchId: branch_id || null,
      newValues: {
        id: userId, full_name, email: cleanEmail, phone: cleanPhone,
        roles: assignedRoleCodes, branch_id,
        allowed_branches: requestedBranchIds, status: userStatus
      },
      req
    });
  });

  const createdUser = await getFullUserProfile(userId);
  res.status(201).json({ user: createdUser });
});

// PUT /api/users/:id
router.put('/:id', requirePermission('users.update'), async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  const { full_name, email, phone, password, branch_id, roles, allowed_branches, avatar_url, status } = req.body;

  const existingUser = await queryOne<{
    id: string;
    full_name: string;
    email: string;
    phone: string;
    status: string;
    branch_id: string | null;
  }>('SELECT id, full_name, email, phone, status, branch_id FROM users WHERE id = ? AND deleted_at IS NULL', [id]);

  if (!existingUser) {
    res.status(404).json({ error: 'NOT_FOUND', message: 'User not found.' });
    return;
  }

  // Prevent modifying other users in other branches for non-superusers
  if (!req.user!.isSuperUser && existingUser.branch_id && !req.user!.allowedBranchIds.includes(existingUser.branch_id) && id !== req.user!.id) {
    res.status(403).json({ error: 'BRANCH_ACCESS_DENIED', message: 'You do not have permission to edit users in this branch.' });
    return;
  }

  // Role references may be ids or codes; resolve them server-side before any mutation.
  // A non-superuser can never assign a role with permissions beyond their own.
  let validatedUpdateRoles: Array<{ id: string; code: string }> | null = null;
  if (Array.isArray(roles)) {
    validatedUpdateRoles = [];
    for (const roleRef of roles.map((r: unknown) => String(r))) {
      const roleRow = await queryOne<{ id: string; code: string }>(
        "SELECT id, code FROM roles WHERE (id = ? OR code = ?) AND status = 'ACTIVE'",
        [roleRef, roleRef]
      );
      if (!roleRow) {
        res.status(400).json({ error: 'VALIDATION_ERROR', code: 'INVALID_ROLE', message: `Role ${roleRef} does not exist or is inactive.`, details: { role: roleRef } });
        return;
      }
      if (!validatedUpdateRoles.some(r => r.id === roleRow.id)) validatedUpdateRoles.push(roleRow);
    }
    if (!req.user!.isSuperUser) {
      const forbiddenAdministrativeRole = validatedUpdateRoles.find(r => ['OWNER', 'SUPER_ADMIN'].includes(r.code));
      if (forbiddenAdministrativeRole) {
        res.status(403).json({ error: 'FORBIDDEN', code: 'FORBIDDEN', message: 'Only OWNER and SUPER_ADMIN can grant administrative roles.', details: { role: forbiddenAdministrativeRole.code } });
        return;
      }
      if (validatedUpdateRoles.length) {
        const placeholders = validatedUpdateRoles.map(() => '?').join(',');
        const requestedPerms = await query<{ code: string }>(
          `SELECT DISTINCT p.code FROM permissions p INNER JOIN role_permissions rp ON rp.permission_id=p.id WHERE rp.role_id IN (${placeholders})`,
          validatedUpdateRoles.map(r => r.id)
        );
        const callerPerms = new Set(req.user!.permissions);
        const forbidden = requestedPerms.map(p => p.code).filter(code => !callerPerms.has(code));
        if (forbidden.length) {
          res.status(403).json({ error: 'PRIVILEGE_ESCALATION_FORBIDDEN', code: 'PRIVILEGE_ESCALATION_FORBIDDEN', message: 'You cannot assign a role that grants permissions you do not possess.', details: { permissions: forbidden } });
          return;
        }
      }
    }
  }

  const cleanEmail = email ? String(email).trim().toLowerCase() : existingUser.email;
  const cleanPhone = phone ? String(phone).trim() : existingUser.phone;

  // Primary branch and additional branch access are always validated server-side.
  const requestedUpdateBranchIds = Array.from(new Set<string>([
    ...((branch_id !== undefined && branch_id) ? [String(branch_id)] : []),
    ...(Array.isArray(allowed_branches) ? allowed_branches.map(String) : [])
  ]));
  if (!req.user!.isSuperUser) {
    const unauthorized = requestedUpdateBranchIds.filter((b) => !req.user!.allowedBranchIds.includes(b));
    if (unauthorized.length) {
      res.status(403).json({ error: 'BRANCH_ACCESS_DENIED', code: 'BRANCH_ACCESS_DENIED', message: 'Cannot assign a user to a branch outside your access scope.', details: { branch_ids: unauthorized } });
      return;
    }
  }
  if (requestedUpdateBranchIds.length) {
    const placeholders = requestedUpdateBranchIds.map(() => '?').join(',');
    const found = await query<{ id: string }>(`SELECT id FROM branches WHERE id IN (${placeholders}) AND status <> 'INACTIVE'`, requestedUpdateBranchIds);
    const foundIds = new Set(found.map((b) => b.id));
    const missing = requestedUpdateBranchIds.filter((b) => !foundIds.has(b));
    if (missing.length) {
      res.status(400).json({ error: 'VALIDATION_ERROR', code: 'INVALID_BRANCH', message: 'One or more requested branches do not exist or are inactive.', details: { branch_ids: missing } });
      return;
    }
  }

  // Check email uniqueness if changed
  if (cleanEmail !== existingUser.email) {
    const conflict = await queryOne('SELECT id FROM users WHERE LOWER(email) = ? AND id != ? AND deleted_at IS NULL', [cleanEmail, id]);
    if (conflict) {
      res.status(409).json({ error: 'CONFLICT', message: 'Email is already in use by another user.' });
      return;
    }
  }

  // Check phone uniqueness if changed
  if (cleanPhone !== existingUser.phone) {
    const conflict = await queryOne('SELECT id FROM users WHERE phone = ? AND id != ? AND deleted_at IS NULL', [cleanPhone, id]);
    if (conflict) {
      res.status(409).json({ error: 'CONFLICT', message: 'Phone is already in use by another user.' });
      return;
    }
  }

  const now = new Date().toISOString();
  let updatePasswordClause = '';
  const updateParams: any[] = [
    full_name !== undefined ? full_name.trim() : existingUser.full_name,
    cleanEmail,
    cleanPhone,
    status !== undefined ? status : existingUser.status,
    branch_id !== undefined ? branch_id : existingUser.branch_id,
    avatar_url !== undefined ? avatar_url : null
  ];

  if (password && String(password).trim().length >= 8) {
    updatePasswordClause = ', password_hash = ?';
    updateParams.push(hashPassword(password));
  }

  updateParams.push(now, id);

  await execute(
    `UPDATE users 
     SET full_name = ?, email = ?, phone = ?, status = ?, branch_id = ?, avatar_url = ? ${updatePasswordClause}, updated_at = ?
     WHERE id = ?`,
    updateParams
  );

  // Waiter credentials are bound to the primary branch and active employment state.
  const branchChanged = branch_id !== undefined && branch_id !== existingUser.branch_id;
  const becameInactive = status !== undefined && status !== 'ACTIVE';
  if (branchChanged || becameInactive) {
    const waiterCode = await queryOne<{ status: string; branch_id: string }>('SELECT status,branch_id FROM waiter_access_codes WHERE user_id=?', [id]);
    if (waiterCode?.status === 'ACTIVE') {
      await execute("UPDATE waiter_access_codes SET status='REVOKED',updated_at=?,changed_by=? WHERE user_id=?", [now, req.user!.id, id]);
      await execute("UPDATE waiter_pos_sessions SET status='REVOKED',revoked_at=? WHERE user_id=? AND status='ACTIVE'", [now, id]);
      await recordAuditLog({ action: branchChanged ? 'WAITER_CODE_REVOKED_BRANCH_CHANGE' : 'WAITER_CODE_REVOKED_STATUS_CHANGE', entityType: 'WAITER_ACCESS_CODE', entityId: id, branchId: waiterCode.branch_id, oldValues: { status: 'ACTIVE', branch_id: waiterCode.branch_id }, newValues: { status: 'REVOKED', reason: branchChanged ? 'PRIMARY_BRANCH_CHANGED' : 'USER_STATUS_CHANGED', new_branch_id: branch_id }, req });
    }
  }

  // Update roles if provided. Only the server-resolved role set is persisted.
  if (Array.isArray(roles) && validatedUpdateRoles) {
    const keepsWaiterRole = validatedUpdateRoles.some((r) => r.code === 'WAITER');
    await execute('DELETE FROM user_roles WHERE user_id = ?', [id]);
    for (const roleRow of validatedUpdateRoles) {
      await execute(
        `INSERT INTO user_roles (id, user_id, role_id, created_at) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING`,
        [`ur_${id}_${roleRow.id}`, id, roleRow.id, now]
      );
    }
    if (!keepsWaiterRole) {
      const waiterCode = await queryOne<{ status: string; branch_id: string }>('SELECT status,branch_id FROM waiter_access_codes WHERE user_id=?', [id]);
      if (waiterCode?.status === 'ACTIVE') {
        await execute("UPDATE waiter_access_codes SET status='REVOKED', updated_at=?, changed_by=? WHERE user_id=?", [now, req.user!.id, id]);
        await execute("UPDATE waiter_pos_sessions SET status='REVOKED', revoked_at=? WHERE user_id=? AND status='ACTIVE'", [now, id]);
        await recordAuditLog({ action: 'WAITER_CODE_REVOKED_ROLE_CHANGE', entityType: 'WAITER_ACCESS_CODE', entityId: id, branchId: waiterCode.branch_id, oldValues: { status: 'ACTIVE' }, newValues: { status: 'REVOKED', reason: 'WAITER_ROLE_REMOVED' }, req });
      }
    }
  }

  // Update branch access if provided
  if (Array.isArray(allowed_branches)) {
    await execute('DELETE FROM user_branch_access WHERE user_id = ?', [id]);
    for (const bId of allowed_branches) {
      await execute(
        `INSERT INTO user_branch_access (id, user_id, branch_id, created_at) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING`,
        [`uba_${id}_${bId}`, id, bId, now]
      );
    }
  }

  await recordAuditLog({
    action: 'USER_UPDATED',
    entityType: 'USER',
    entityId: id,
    branchId: branch_id || existingUser.branch_id,
    oldValues: existingUser,
    newValues: { full_name, email: cleanEmail, phone: cleanPhone, status, branch_id, roles, allowed_branches },
    req
  });

  const updatedProfile = await getFullUserProfile(id);
  res.json({ user: updatedProfile });
});

// GET /api/users/:id/status
router.get('/:id/status', requirePermission('users.view'), async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  const user = await queryOne<any>(
    `SELECT id, full_name, email, phone, status, employment_status, disciplinary_status, 
            joined_at, status_reason, status_changed_at, status_changed_by, branch_id
     FROM users WHERE id = ? AND deleted_at IS NULL`,
    [id]
  );
  if (!user) {
    res.status(404).json({ error: 'NOT_FOUND', message: 'Employee not found.' });
    return;
  }
  if (denyIfForeignBranch(req, res, user)) return;

  res.json({
    user_id: user.id,
    full_name: user.full_name,
    email: user.email,
    employment_status: user.employment_status || 'ACTIVE',
    disciplinary_status: user.disciplinary_status || 'NONE',
    joined_at: user.joined_at,
    status_reason: user.status_reason,
    status_changed_at: user.status_changed_at,
    status_changed_by: user.status_changed_by,
    primary_branch_id: user.branch_id
  });
});

// PUT /api/users/:id/status
router.put('/:id/status', requirePermission('users.update'), async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  const currentUser = req.user!;

  if (currentUser.id === id) {
    res.status(400).json({
      error: 'FORBIDDEN',
      message: 'Employees cannot change their own employment or disciplinary status.'
    });
    return;
  }

  const { employment_status, disciplinary_status, reason, notes, effective_from, effective_until } = req.body;

  const validEmployment = ['ACTIVE', 'INTERN', 'PROBATION', 'ON_LEAVE', 'SUSPENDED', 'TERMINATED'];
  const validDisciplinary = ['NONE', 'WARNING', 'REPRIMAND', 'FINAL_REPRIMAND'];

  if (employment_status && !validEmployment.includes(employment_status)) {
    res.status(400).json({ error: 'VALIDATION_ERROR', message: `Invalid employment_status. Allowed: ${validEmployment.join(', ')}` });
    return;
  }

  if (disciplinary_status && !validDisciplinary.includes(disciplinary_status)) {
    res.status(400).json({ error: 'VALIDATION_ERROR', message: `Invalid disciplinary_status. Allowed: ${validDisciplinary.join(', ')}` });
    return;
  }

  const existing = await queryOne<any>('SELECT * FROM users WHERE id = ? AND deleted_at IS NULL', [id]);
  if (!existing) {
    res.status(404).json({ error: 'NOT_FOUND', message: 'Employee not found.' });
    return;
  }
  if (denyIfForeignBranch(req, res, existing)) return;

  const newEmployment = employment_status || existing.employment_status || 'ACTIVE';
  const newDisciplinary = disciplinary_status || existing.disciplinary_status || 'NONE';
  const now = new Date().toISOString();
  const changedBy = currentUser.full_name || currentUser.email;

  let newOverallStatus = existing.status;
  if (newEmployment === 'TERMINATED') {
    newOverallStatus = 'INACTIVE';
  } else if (newEmployment === 'SUSPENDED') {
    newOverallStatus = 'SUSPENDED';
  } else if (newEmployment === 'ACTIVE' || newEmployment === 'INTERN' || newEmployment === 'PROBATION') {
    newOverallStatus = 'ACTIVE';
  }

  // 1. Update user
  await execute(
    `UPDATE users 
     SET employment_status = ?, disciplinary_status = ?, status = ?, status_reason = ?, status_changed_at = ?, status_changed_by = ?, updated_at = ?
     WHERE id = ?`,
    [newEmployment, newDisciplinary, newOverallStatus, reason || null, now, changedBy, now, id]
  );

  if (newEmployment === 'TERMINATED' || newEmployment === 'SUSPENDED' || newOverallStatus !== 'ACTIVE') {
    const waiterCode = await queryOne<{ status: string; branch_id: string }>('SELECT status,branch_id FROM waiter_access_codes WHERE user_id=?', [id]);
    if (waiterCode?.status === 'ACTIVE') {
      await execute("UPDATE waiter_access_codes SET status='REVOKED', updated_at=?, changed_by=? WHERE user_id=?", [now, req.user!.id, id]);
      await execute("UPDATE waiter_pos_sessions SET status='REVOKED', revoked_at=? WHERE user_id=? AND status='ACTIVE'", [now, id]);
      await recordAuditLog({ action: 'WAITER_CODE_REVOKED_STATUS_CHANGE', entityType: 'WAITER_ACCESS_CODE', entityId: id, branchId: waiterCode.branch_id, oldValues: { status: 'ACTIVE' }, newValues: { status: 'REVOKED', reason: `EMPLOYMENT_${newEmployment}` }, req });
    }
  }

  // 2. Insert into employee_status_history
  const historyId = `esh_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  await execute(
    `INSERT INTO employee_status_history 
     (id, user_id, employment_status, disciplinary_status, reason, notes, effective_from, effective_until, changed_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      historyId,
      id,
      newEmployment,
      newDisciplinary,
      reason || 'Status update',
      notes || null,
      effective_from || now,
      effective_until || null,
      changedBy,
      now
    ]
  );

  // 3. Audit Log
  await recordAuditLog({
    action: 'EMPLOYEE_STATUS_CHANGED',
    entityType: 'USER',
    entityId: id,
    branchId: existing.branch_id,
    oldValues: {
      employment_status: existing.employment_status,
      disciplinary_status: existing.disciplinary_status,
      status: existing.status
    },
    newValues: {
      employment_status: newEmployment,
      disciplinary_status: newDisciplinary,
      status: newOverallStatus,
      reason,
      notes,
      effective_from,
      effective_until,
      changed_by: changedBy
    },
    req
  });

  res.json({
    message: 'Employee status updated successfully and recorded in audit history.',
    user_id: id,
    employment_status: newEmployment,
    disciplinary_status: newDisciplinary,
    status: newOverallStatus,
    status_history_id: historyId
  });
});

// GET /api/users/:id/status-history
router.get('/:id/status-history', requirePermission('users.view'), async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  const user = await queryOne<any>('SELECT id, full_name, email, branch_id FROM users WHERE id = ?', [id]);
  if (!user) {
    res.status(404).json({ error: 'NOT_FOUND', message: 'Employee not found.' });
    return;
  }
  if (denyIfForeignBranch(req, res, user)) return;

  const history = await query(
    'SELECT * FROM employee_status_history WHERE user_id = ? ORDER BY created_at DESC',
    [id]
  );

  res.json({ user, history });
});

// DELETE /api/users/:id (Safe soft delete)
router.delete('/:id', requirePermission('users.delete'), async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;

  if (req.user!.id === id) {
    res.status(400).json({ error: 'SELF_DELETE_FORBIDDEN', message: 'Cannot delete your own user account.' });
    return;
  }

  const user = await queryOne<{ id: string; full_name: string; email: string; branch_id: string | null; disciplinary_status: string }>(
    'SELECT id, full_name, email, branch_id, disciplinary_status FROM users WHERE id = ? AND deleted_at IS NULL',
    [id]
  );

  if (!user) {
    res.status(404).json({ error: 'NOT_FOUND', message: 'User not found.' });
    return;
  }
  if (denyIfForeignBranch(req, res, user)) return;

  // Check if user is the sole OWNER
  const ownerRole = await queryOne<{ id: string }>('SELECT id FROM roles WHERE code = ?', ['OWNER']);
  if (ownerRole) {
    const isTargetOwner = await queryOne('SELECT id FROM user_roles WHERE user_id = ? AND role_id = ?', [id, ownerRole.id]);
    if (isTargetOwner) {
      const ownerCount = await queryOne<{ count: number }>(
        'SELECT COUNT(*)::int as count FROM user_roles ur JOIN users u ON u.id = ur.user_id WHERE ur.role_id = ? AND u.deleted_at IS NULL',
        [ownerRole.id]
      );
      if ((ownerCount?.count || 0) <= 1) {
        res.status(400).json({ error: 'FORBIDDEN', message: 'Cannot delete the only remaining OWNER of the system.' });
        return;
      }
    }
  }

  const now = new Date().toISOString();
  const changedBy = req.user!.full_name || req.user!.email;

  // Soft delete preserves historical audit log integrity
  await execute(
    `UPDATE users 
     SET deleted_at = ?, status = 'TERMINATED', employment_status = 'TERMINATED', 
         status_reason = 'Employee account terminated and safely archived',
         status_changed_at = ?, status_changed_by = ?, updated_at = ? 
     WHERE id = ?`,
    [now, now, changedBy, now, id]
  );

  await execute("UPDATE waiter_access_codes SET status='REVOKED', updated_at=?, changed_by=? WHERE user_id=? AND status='ACTIVE'", [now, req.user!.id, id]);
  await execute("UPDATE waiter_pos_sessions SET status='REVOKED', revoked_at=? WHERE user_id=? AND status='ACTIVE'", [now, id]);

  // Insert termination into status history
  await execute(
    `INSERT INTO employee_status_history 
     (id, user_id, employment_status, disciplinary_status, reason, changed_by, created_at)
     VALUES (?, ?, 'TERMINATED', ?, 'Employee Account Terminated and Archived', ?, ?)`,
    [
      `esh_${id}_term_${Date.now()}`,
      id,
      user.disciplinary_status || 'NONE',
      changedBy,
      now
    ]
  );

  await recordAuditLog({
    action: 'EMPLOYEE_DELETED',
    entityType: 'USER',
    entityId: id,
    branchId: user.branch_id,
    oldValues: { email: user.email, full_name: user.full_name },
    newValues: { status: 'TERMINATED', employment_status: 'TERMINATED', deleted_at: now },
    req
  });

  res.json({ 
    success: true, 
    message: `Employee ${user.full_name} (${user.email}) successfully terminated and safely archived.` 
  });
});

// GET /api/users/:id/branch-access
router.get('/:id/branch-access', requirePermission('users.view'), async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;

  const user = await queryOne<{ id: string; full_name: string; email: string; branch_id: string | null; status: string }>(
    'SELECT id, full_name, email, branch_id, status FROM users WHERE id = ? AND deleted_at IS NULL',
    [id]
  );

  if (!user) {
    res.status(404).json({ error: 'NOT_FOUND', message: 'User not found.' });
    return;
  }
  if (denyIfForeignBranch(req, res, user)) return;

  // Get user roles
  const roles = await query<{ code: string }>(
    `SELECT r.code FROM roles r 
     INNER JOIN user_roles ur ON ur.role_id = r.id 
     WHERE ur.user_id = ? AND r.status = 'ACTIVE'`,
    [id]
  );
  const isSuper = roles.some(r => r.code === 'OWNER' || r.code === 'SUPER_ADMIN');

  // All active branches
  const allBranches = await query<{
    id: string;
    name: string;
    code: string;
    franchise_id: string | null;
    franchise_name: string | null;
    franchise_code: string | null;
    status: string;
  }>(
    `SELECT b.id, b.name, b.code, b.franchise_id, f.name as franchise_name, f.code as franchise_code, b.status
     FROM branches b
     LEFT JOIN franchises f ON f.id = b.franchise_id
     WHERE b.status = 'ACTIVE'
     ORDER BY f.name ASC, b.name ASC`
  );

  // User's assigned branch access
  const directAccess = await query<{
    branch_id: string;
    name: string;
    code: string;
    franchise_id: string | null;
    franchise_name: string | null;
  }>(
    `SELECT uba.branch_id, b.name, b.code, b.franchise_id, f.name as franchise_name
     FROM user_branch_access uba
     INNER JOIN branches b ON b.id = uba.branch_id
     LEFT JOIN franchises f ON f.id = b.franchise_id
     WHERE uba.user_id = ?`,
    [id]
  );

  const allowedBranchIds = directAccess.map(b => b.branch_id);
  if (user.branch_id && !allowedBranchIds.includes(user.branch_id)) {
    allowedBranchIds.push(user.branch_id);
  }

  const hasAllAccess = isSuper || (allBranches.length > 0 && allowedBranchIds.length >= allBranches.length);

  const primaryBranch = user.branch_id 
    ? allBranches.find(b => b.id === user.branch_id) || null
    : null;

  res.json({
    user_id: user.id,
    full_name: user.full_name,
    email: user.email,
    primary_branch_id: user.branch_id,
    primary_branch: primaryBranch,
    allowed_branch_ids: allowedBranchIds,
    allowed_branches: directAccess,
    has_all_access: hasAllAccess,
    is_super_user: isSuper,
    all_branches: allBranches
  });
});

// PUT /api/users/:id/branch-access
router.put('/:id/branch-access', requirePermission('users.update'), async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  const { primary_branch_id, allowed_branch_ids, has_all_access } = req.body;

  const existingUser = await queryOne<{ id: string; full_name: string; email: string; branch_id: string | null }>(
    'SELECT id, full_name, email, branch_id FROM users WHERE id = ? AND deleted_at IS NULL',
    [id]
  );

  if (!existingUser) {
    res.status(404).json({ error: 'NOT_FOUND', message: 'User not found.' });
    return;
  }
  if (denyIfForeignBranch(req, res, existingUser)) return;

  // Branch access defines the isolation boundary, so a non-superuser may never widen it
  // beyond their own scope — for themselves or anyone else. Same idiom as POST / and PUT /:id.
  if (!req.user!.isSuperUser) {
    if (has_all_access) {
      res.status(403).json({ error: 'BRANCH_ACCESS_DENIED', code: 'BRANCH_ACCESS_DENIED', message: 'Only a superuser may grant access to all branches.', details: {} });
      return;
    }
    const requested = Array.from(new Set<string>([
      ...((primary_branch_id !== undefined && primary_branch_id) ? [String(primary_branch_id)] : []),
      ...(Array.isArray(allowed_branch_ids) ? allowed_branch_ids.map(String) : [])
    ]));
    const unauthorized = requested.filter(b => !req.user!.allowedBranchIds.includes(b));
    if (unauthorized.length) {
      res.status(403).json({ error: 'BRANCH_ACCESS_DENIED', code: 'BRANCH_ACCESS_DENIED', message: 'Cannot assign a user to a branch outside your access scope.', details: { branch_ids: unauthorized } });
      return;
    }
  }

  const now = new Date().toISOString();

  // 1. Primary branch update if provided
  if (primary_branch_id !== undefined && primary_branch_id !== existingUser.branch_id) {
    if (primary_branch_id !== null) {
      const branchExists = await queryOne('SELECT id, name FROM branches WHERE id = ?', [primary_branch_id]);
      if (!branchExists) {
        res.status(400).json({ error: 'VALIDATION_ERROR', message: `Primary branch ${primary_branch_id} does not exist.` });
        return;
      }
    }

    await execute('UPDATE users SET branch_id = ?, updated_at = ? WHERE id = ?', [primary_branch_id, now, id]);

    const waiterCode = await queryOne<{ status: string; branch_id: string }>('SELECT status,branch_id FROM waiter_access_codes WHERE user_id=?', [id]);
    if (waiterCode?.status === 'ACTIVE') {
      await execute("UPDATE waiter_access_codes SET status='REVOKED',updated_at=?,changed_by=? WHERE user_id=?", [now, req.user!.id, id]);
      await execute("UPDATE waiter_pos_sessions SET status='REVOKED',revoked_at=? WHERE user_id=? AND status='ACTIVE'", [now, id]);
      await recordAuditLog({ action: 'WAITER_CODE_REVOKED_BRANCH_CHANGE', entityType: 'WAITER_ACCESS_CODE', entityId: id, branchId: waiterCode.branch_id, oldValues: { status: 'ACTIVE', branch_id: waiterCode.branch_id }, newValues: { status: 'REVOKED', reason: 'PRIMARY_BRANCH_CHANGED', new_branch_id: primary_branch_id }, req });
    }

    await recordAuditLog({
      action: 'USER_PRIMARY_BRANCH_CHANGED',
      entityType: 'USER',
      entityId: id,
      branchId: primary_branch_id || existingUser.branch_id,
      oldValues: { primary_branch_id: existingUser.branch_id },
      newValues: { primary_branch_id },
      req
    });
  }

  // 2. Allowed branches update
  const oldAccessRows = await query<{ branch_id: string }>('SELECT branch_id FROM user_branch_access WHERE user_id = ?', [id]);
  const oldAllowedIds = oldAccessRows.map(r => r.branch_id);

  let newBranchIdsToAssign: string[] = [];

  if (has_all_access === true) {
    const allActive = await query<{ id: string }>('SELECT id FROM branches WHERE status = ?', ['ACTIVE']);
    newBranchIdsToAssign = allActive.map(b => b.id);
  } else if (Array.isArray(allowed_branch_ids)) {
    newBranchIdsToAssign = [...allowed_branch_ids];
    const currentPrimary = primary_branch_id !== undefined ? primary_branch_id : existingUser.branch_id;
    if (currentPrimary && !newBranchIdsToAssign.includes(currentPrimary)) {
      newBranchIdsToAssign.push(currentPrimary);
    }
  }

  if (has_all_access !== undefined || allowed_branch_ids !== undefined) {
    await execute('DELETE FROM user_branch_access WHERE user_id = ?', [id]);
    for (const bId of newBranchIdsToAssign) {
      const bExists = await queryOne('SELECT id FROM branches WHERE id = ?', [bId]);
      if (bExists) {
        await execute(
          `INSERT INTO user_branch_access (id, user_id, branch_id, created_at) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING`,
          [`uba_${id}_${bId}`, id, bId, now]
        );
      }
    }

    await recordAuditLog({
      action: 'USER_BRANCH_ACCESS_CHANGED',
      entityType: 'USER',
      entityId: id,
      branchId: primary_branch_id !== undefined ? primary_branch_id : existingUser.branch_id,
      oldValues: { allowed_branch_ids: oldAllowedIds },
      newValues: {
        allowed_branch_ids: newBranchIdsToAssign,
        has_all_access: Boolean(has_all_access),
        total_branches: newBranchIdsToAssign.length
      },
      req
    });
  }

  const updatedProfile = await getFullUserProfile(id);
  res.json({
    message: 'User branch access updated successfully.',
    user: updatedProfile,
    primary_branch_id: updatedProfile?.branch_id,
    allowed_branch_ids: updatedProfile?.allowedBranchIds,
    has_all_access: Boolean(has_all_access)
  });
});

export default router;
