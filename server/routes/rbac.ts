import { Router, Request, Response } from 'express';
import { query, queryOne } from '../db';
import { authenticateToken, requirePermission, recordAuditLog, AuthenticatedUser } from '../auth';

const router = Router();
router.use(authenticateToken);

// The simulator resolves and returns a TARGET user's real, live data: full name, email,
// resolved roles/permissions, and -- most sensitively -- their complete allowed_branch_ids
// list, the exact same branch-access footprint Stage 21 restricted behind branch scope on
// every direct user/employee endpoint (denyIfForeignBranch in users.ts, canAccessEmployee in
// employees.ts). Without this check, POST /rbac/test is a second, unscoped door to that same
// data: a caller who cannot read a foreign-branch user directly could still learn everything
// about them, including their full cross-franchise branch list, by "simulating" them instead.
// Same authorization model as those two helpers (isSuperUser / allowedBranchIds / self), not
// a new one -- reimplemented locally because this route file has no shared import path to
// either of them, matching how every other route file in this codebase keeps its own local
// scoping helper (allowed(), canAccessEmployee(), canUserAccessFranchise()).
async function canSimulateUser(caller: AuthenticatedUser, targetUserId: string, targetBranchId: string | null): Promise<boolean> {
  if (caller.isSuperUser || targetUserId === caller.id) return true;
  if (targetBranchId && caller.allowedBranchIds.includes(targetBranchId)) return true;
  if (!caller.allowedBranchIds.length) return false;
  const placeholders = caller.allowedBranchIds.map(() => '?').join(',');
  const access = await queryOne<{ user_id: string }>(
    `SELECT user_id FROM user_branch_access WHERE user_id = ? AND branch_id IN (${placeholders}) LIMIT 1`,
    [targetUserId, ...caller.allowedBranchIds]
  );
  return Boolean(access);
}

// Core permission catalogue to evaluate for the RBAC matrix
const CORE_PERMISSIONS_MATRIX = [
  { code: 'users.view', name: 'View Users', module: 'users' },
  { code: 'users.create', name: 'Create Users', module: 'users' },
  { code: 'users.update', name: 'Update Users', module: 'users' },
  { code: 'users.delete', name: 'Deactivate Users', module: 'users' },
  { code: 'branches.view', name: 'View Branches', module: 'branches' },
  { code: 'branches.create', name: 'Create Branches', module: 'branches' },
  { code: 'branches.update', name: 'Update Branches', module: 'branches' },
  { code: 'franchises.view', name: 'View Franchises', module: 'franchises' },
  { code: 'franchises.create', name: 'Create Franchises', module: 'franchises' },
  { code: 'franchises.update', name: 'Update Franchises', module: 'franchises' },
  { code: 'settings.view', name: 'View Settings', module: 'settings' },
  { code: 'settings.update', name: 'Update Settings', module: 'settings' },
  { code: 'audit.view', name: 'View Audit Logs', module: 'audit' }
];

// GET /api/rbac/options - Helper to populate the RBAC console dropdowns
router.get('/options', requirePermission('rbac.test'), async (req: Request, res: Response): Promise<void> => {
  const userScope = req.user!.isSuperUser
    ? { sql: '', params: [] as any[] }
    : req.user!.allowedBranchIds.length
      ? { sql: ` AND (users.branch_id IN (${req.user!.allowedBranchIds.map(() => '?').join(',')}) OR EXISTS (SELECT 1 FROM user_branch_access uba_scope WHERE uba_scope.user_id = users.id AND uba_scope.branch_id IN (${req.user!.allowedBranchIds.map(() => '?').join(',')})))`, params: [...req.user!.allowedBranchIds, ...req.user!.allowedBranchIds] }
      : { sql: ' AND 1 = 0', params: [] as any[] };
  const users = await query<{ id: string; full_name: string; email: string; status: string; branch_id: string }>(
    `SELECT users.id, users.full_name, users.email, users.status, users.branch_id FROM users WHERE users.deleted_at IS NULL${userScope.sql} ORDER BY users.full_name ASC`,
    userScope.params
  );

  const roles = await query<{ id: string; code: string; name: string; is_system: number }>(
    `SELECT id, code, name, is_system FROM roles WHERE status = 'ACTIVE' ORDER BY code ASC`
  );

  const franchises = await query<{ id: string; name: string; code: string; status: string }>(
    `SELECT id, name, code, status FROM franchises ORDER BY name ASC`
  );

  const branches = await query<{ id: string; name: string; code: string; franchise_id: string | null; status: string }>(
    req.user!.isSuperUser
      ? `SELECT id, name, code, franchise_id, status FROM branches ORDER BY name ASC`
      : `SELECT DISTINCT b.id, b.name, b.code, b.franchise_id, b.status FROM branches b INNER JOIN user_branch_access uba ON uba.branch_id = b.id WHERE uba.user_id = ? ORDER BY b.name ASC`,
    req.user!.isSuperUser ? [] : [req.user!.id]
  );

  const permissions = await query<{ id: string; code: string; name: string; module: string }>(
    `SELECT id, code, name, module FROM permissions ORDER BY module ASC, code ASC`
  );

  res.json({
    users,
    roles,
    franchises,
    branches,
    permissions,
    core_matrix: CORE_PERMISSIONS_MATRIX
  });
});

// POST /api/rbac/test - Pure READ-ONLY Simulation of authorization checks
router.post('/test', requirePermission('rbac.test'), async (req: Request, res: Response): Promise<void> => {
  const {
    user_id,
    role_id,
    franchise_id,
    branch_id,
    permission,
    test_matrix
  } = req.body;

  if (!user_id) {
    res.status(400).json({
      error: 'VALIDATION_ERROR',
      message: 'user_id is required to perform authorization simulation.'
    });
    return;
  }

  // 1. Fetch user
  const user = await queryOne<{
    id: string;
    full_name: string;
    email: string;
    status: string;
    branch_id: string | null;
  }>('SELECT id, full_name, email, status, branch_id FROM users WHERE id = ? AND deleted_at IS NULL', [user_id]);

  if (!user) {
    res.status(404).json({ error: 'NOT_FOUND', message: 'Target user not found.' });
    return;
  }
  if (!(await canSimulateUser(req.user!, user.id, user.branch_id))) {
    res.status(403).json({
      error: 'FORBIDDEN', code: 'BRANCH_ACCESS_DENIED',
      message: 'Target user belongs to an unauthorized branch.', details: {}
    });
    return;
  }

  // 2. Resolve Roles
  let resolvedRoles: Array<{ id: string; code: string; name: string }> = [];
  let isSimulatedRole = false;

  if (role_id) {
    const role = await queryOne<{ id: string; code: string; name: string }>(
      'SELECT id, code, name FROM roles WHERE id = ? AND status = ?',
      [role_id, 'ACTIVE']
    );
    if (!role) {
      res.status(404).json({ error: 'NOT_FOUND', message: 'Simulated role not found or inactive.' });
      return;
    }
    resolvedRoles = [role];
    isSimulatedRole = true;
  } else {
    resolvedRoles = await query<{ id: string; code: string; name: string }>(
      `SELECT r.id, r.code, r.name 
       FROM roles r 
       INNER JOIN user_roles ur ON ur.role_id = r.id 
       WHERE ur.user_id = ? AND r.status = 'ACTIVE'`,
      [user.id]
    );
  }

  const roleCodes = resolvedRoles.map(r => r.code);
  const isSuperUser = roleCodes.includes('OWNER') || roleCodes.includes('SUPER_ADMIN');

  // 3. Resolve Permissions
  let resolvedPermissions: string[] = [];
  if (isSimulatedRole && role_id) {
    const rolePerms = await query<{ code: string }>(
      `SELECT p.code FROM permissions p 
       INNER JOIN role_permissions rp ON rp.permission_id = p.id 
       WHERE rp.role_id = ?`,
      [role_id]
    );
    resolvedPermissions = rolePerms.map(p => p.code);
  } else {
    const userPerms = await query<{ code: string }>(
      `SELECT DISTINCT p.code 
       FROM permissions p 
       INNER JOIN role_permissions rp ON rp.permission_id = p.id 
       INNER JOIN user_roles ur ON ur.role_id = rp.role_id 
       INNER JOIN roles r ON r.id = ur.role_id 
       WHERE ur.user_id = ? AND r.status = 'ACTIVE'`,
      [user.id]
    );
    resolvedPermissions = userPerms.map(p => p.code);
  }

  // 4. Resolve Branch Access
  let allowedBranchIds: string[] = [];
  const allBranches = await query<{ id: string; name: string; code: string; franchise_id: string | null }>(
    'SELECT id, name, code, franchise_id FROM branches WHERE status = ?',
    ['ACTIVE']
  );

  if (isSuperUser) {
    allowedBranchIds = allBranches.map(b => b.id);
  } else {
    const directAccess = await query<{ branch_id: string }>(
      'SELECT DISTINCT branch_id FROM user_branch_access WHERE user_id = ?',
      [user.id]
    );
    allowedBranchIds = directAccess.map(b => b.branch_id);
    if (user.branch_id && !allowedBranchIds.includes(user.branch_id)) {
      allowedBranchIds.push(user.branch_id);
    }
  }

  // Branch entity check if branch_id is provided
  let targetBranch: { id: string; name: string; code: string; franchise_id: string | null } | null = null;
  if (branch_id) {
    targetBranch = allBranches.find(b => b.id === branch_id) || null;
  }

  // Franchise entity check if franchise_id is provided
  let targetFranchise: { id: string; name: string; code: string } | null = null;
  if (franchise_id) {
    targetFranchise = await queryOne<{ id: string; name: string; code: string }>(
      'SELECT id, name, code FROM franchises WHERE id = ?',
      [franchise_id]
    );
  }

  // Evaluation function for a specific permission code
  const evaluateAccess = (permCode?: string): { allowed: boolean; reason: string } => {
    // 1. Inactive account
    if (user.status !== 'ACTIVE') {
      return {
        allowed: false,
        reason: `User account '${user.full_name}' is currently ${user.status} (inactive). Authentication and operations are prohibited.`
      };
    }

    // 2. Hierarchy conflict check: does branch belong to franchise?
    if (branch_id && franchise_id && targetBranch) {
      if (targetBranch.franchise_id !== franchise_id) {
        return {
          allowed: false,
          reason: `Branch '${targetBranch.name}' does not belong to Franchise '${targetFranchise?.name || franchise_id}'. Hierarchy isolation blocks cross-franchise access.`
        };
      }
    }

    // 3. Branch access check
    if (branch_id) {
      const hasBranchAccess = isSuperUser || allowedBranchIds.includes(branch_id);
      if (!hasBranchAccess) {
        return {
          allowed: false,
          reason: `User '${user.full_name}' does not have access to branch '${targetBranch?.name || branch_id}'. Allowed branches: ${allowedBranchIds.length === 0 ? 'None' : allowedBranchIds.length + ' assigned'}.`
        };
      }
    }

    // 4. Permission check
    if (permCode) {
      const hasPerm = isSuperUser || resolvedPermissions.includes(permCode);
      if (!hasPerm) {
        return {
          allowed: false,
          reason: `User '${user.full_name}' does not have required permission '${permCode}'. Role [${roleCodes.join(', ') || 'NONE'}] does not grant this capability.`
        };
      }
    }

    // 5. Access Granted
    if (branch_id && permCode) {
      return {
        allowed: true,
        reason: isSuperUser 
          ? `Access GRANTED. User is ${roleCodes.join('/')} with universal privileges across all franchises and branches.`
          : `Access GRANTED. User has required permission '${permCode}' AND user has verified access to branch '${targetBranch?.name || branch_id}'.`
      };
    } else if (permCode) {
      return {
        allowed: true,
        reason: isSuperUser
          ? `Access GRANTED. User is ${roleCodes.join('/')} with universal privileges.`
          : `Access GRANTED. User has required permission '${permCode}'.`
      };
    } else if (branch_id) {
      return {
        allowed: true,
        reason: `Access GRANTED. User has verified operational access to branch '${targetBranch?.name || branch_id}'.`
      };
    }

    return {
      allowed: true,
      reason: `Access GRANTED. Account is active with assigned roles: ${roleCodes.join(', ')}.`
    };
  };

  // Primary test evaluation
  const primaryResult = evaluateAccess(permission);

  // Optional or automatic matrix results for comprehensive insight
  let matrixResults: Array<{
    permission: string;
    name: string;
    module: string;
    allowed: boolean;
    reason: string;
  }> = [];

  if (test_matrix !== false) {
    matrixResults = CORE_PERMISSIONS_MATRIX.map(p => {
      const res = evaluateAccess(p.code);
      return {
        permission: p.code,
        name: p.name,
        module: p.module,
        allowed: res.allowed,
        reason: res.reason
      };
    });
  }

  // Record audit log for the simulation test event (strictly read-only)
  await recordAuditLog({
    userId: req.user!.id,
    branchId: branch_id || req.user!.branch_id,
    action: 'RBAC_ACCESS_TESTED',
    entityType: 'RBAC_SIMULATION',
    entityId: user.id,
    newValues: {
      target_user_id: user.id,
      target_user_name: user.full_name,
      simulated_role: isSimulatedRole ? resolvedRoles[0]?.code : null,
      franchise_id,
      branch_id,
      permission,
      allowed: primaryResult.allowed,
      reason: primaryResult.reason
    },
    req
  });

  res.json({
    allowed: primaryResult.allowed,
    status: primaryResult.allowed ? 'ACCESS GRANTED' : 'ACCESS DENIED',
    reason: primaryResult.reason,
    simulation_params: {
      user: {
        id: user.id,
        full_name: user.full_name,
        email: user.email,
        status: user.status,
        primary_branch_id: user.branch_id
      },
      roles: resolvedRoles,
      is_simulated_role: isSimulatedRole,
      is_super_user: isSuperUser,
      franchise: targetFranchise,
      branch: targetBranch,
      permission: permission || null
    },
    resolved_role: resolvedRoles[0]?.code || 'NO_ROLE',
    resolved_roles: resolvedRoles,
    resolved_permissions: resolvedPermissions,
    branch_access: {
      is_universal: isSuperUser,
      allowed_branch_ids: allowedBranchIds,
      allowed_branches_count: allowedBranchIds.length,
      has_target_branch_access: branch_id ? (isSuperUser || allowedBranchIds.includes(branch_id)) : true
    },
    matrix_results: matrixResults
  });
});

export default router;
