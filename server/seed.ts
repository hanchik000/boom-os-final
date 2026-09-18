import bcrypt from 'bcryptjs';
import { query, queryOne, execute, transaction } from './db';

export async function seedInitialData() {
  console.log('Ensuring BOOM OS baseline data and permissions...');
  const now = new Date().toISOString();

  // 1. Seed Permissions
  const permissionsList = [
    // Users module
    { id: 'perm_users_view', code: 'users.view', name: 'View Users', module: 'users', description: 'View user profiles, list, and details' },
    { id: 'perm_users_create', code: 'users.create', name: 'Create Users', module: 'users', description: 'Register and invite new staff members' },
    { id: 'perm_users_update', code: 'users.update', name: 'Update Users', module: 'users', description: 'Edit user information, branch assignments, and status' },
    { id: 'perm_users_delete', code: 'users.delete', name: 'Deactivate / Delete Users', module: 'users', description: 'Deactivate or soft-delete user accounts' },

    { id: 'perm_employees_view', code: 'employees.view', name: 'View Employees', module: 'employees', description: 'View employee operational profiles' },
    { id: 'perm_employees_update', code: 'employees.update', name: 'Manage Employee Profiles', module: 'employees', description: 'Create and update employee operational profiles' },

    // Branches module
    { id: 'perm_branches_view', code: 'branches.view', name: 'View Branches', module: 'branches', description: 'View list of restaurant branches and details' },
    { id: 'perm_branches_create', code: 'branches.create', name: 'Create Branches', module: 'branches', description: 'Register new restaurant locations' },
    { id: 'perm_branches_update', code: 'branches.update', name: 'Update Branches', module: 'branches', description: 'Modify branch details, operating params, and status' },
    { id: 'perm_branches_delete', code: 'branches.delete', name: 'Deactivate Branches', module: 'branches', description: 'Deactivate restaurant branch locations' },

    // Franchises module
    { id: 'perm_franchises_view', code: 'franchises.view', name: 'View Franchises', module: 'franchises', description: 'View franchise network entities and performance' },
    { id: 'perm_franchises_create', code: 'franchises.create', name: 'Create Franchises', module: 'franchises', description: 'Register new franchise holding accounts' },
    { id: 'perm_franchises_update', code: 'franchises.update', name: 'Update Franchises', module: 'franchises', description: 'Modify franchise partners and contracts' },
    { id: 'perm_franchises_delete', code: 'franchises.delete', name: 'Delete Franchises', module: 'franchises', description: 'Safely archive franchise entities' },

    // Roles module
    { id: 'perm_roles_view', code: 'roles.view', name: 'View Roles', module: 'roles', description: 'View security roles and granted permissions' },
    { id: 'perm_roles_create', code: 'roles.create', name: 'Create Roles', module: 'roles', description: 'Create custom enterprise job roles' },
    { id: 'perm_roles_update', code: 'roles.update', name: 'Update Roles', module: 'roles', description: 'Edit roles and assign/revoke permissions' },
    { id: 'perm_roles_delete', code: 'roles.delete', name: 'Delete Roles', module: 'roles', description: 'Delete non-system custom roles' },

    // Permissions module
    { id: 'perm_permissions_view', code: 'permissions.view', name: 'View Permissions', module: 'permissions', description: 'Inspect available system permissions catalogue' },
    { id: 'perm_permissions_create', code: 'permissions.create', name: 'Create Permissions', module: 'permissions', description: 'Register new system permissions' },
    { id: 'perm_permissions_update', code: 'permissions.update', name: 'Update Permissions', module: 'permissions', description: 'Edit permission metadata' },

    // Settings module
    { id: 'perm_settings_view', code: 'settings.view', name: 'View Settings', module: 'settings', description: 'View system-wide parameters and configuration' },
    { id: 'perm_settings_update', code: 'settings.update', name: 'Update Settings', module: 'settings', description: 'Modify global restaurant network settings' },

    // Audit module
    { id: 'perm_audit_view', code: 'audit.view', name: 'View Audit Logs', module: 'audit', description: 'Access immutable system security and activity audit trails' },

    // RBAC testing console
    { id: 'perm_rbac_test', code: 'rbac.test', name: 'RBAC Simulation & Test', module: 'rbac', description: 'Access interactive RBAC authorization simulator' },

    // Prepared future module permissions
    { id: 'perm_pos_access', code: 'pos.access', name: 'Access POS', module: 'pos', description: 'Access operational point-of-sale workflows' },
    { id: 'perm_menu_view', code: 'menu.view', name: 'View Menu', module: 'menu', description: 'View active menu for an authorized branch' },
    { id: 'perm_menu_manage', code: 'menu.manage', name: 'Manage Menu', module: 'menu', description: 'Create and update branch menu categories and items' },
    { id: 'perm_tables_view', code: 'tables.view', name: 'View Tables', module: 'tables', description: 'View dining areas and tables in an authorized branch' },
    { id: 'perm_tables_manage', code: 'tables.manage', name: 'Manage Tables', module: 'tables', description: 'Create and configure dining areas and tables' },
    { id: 'perm_orders_create', code: 'orders.create', name: 'Create Orders', module: 'orders', description: 'Create operational orders from an authorized POS identity' },
    { id: 'perm_orders_view', code: 'orders.view', name: 'View Orders', module: 'orders', description: 'View orders in authorized branches' },
    { id: 'perm_orders_confirm', code: 'orders.confirm', name: 'Confirm Orders', module: 'orders', description: 'Confirm waiter-created orders for kitchen processing' },
    { id: 'perm_orders_item_remove_request', code: 'orders.item_remove.request', name: 'Request Order Item Removal', module: 'orders', description: 'Request removal of an order item with a reason' },
    { id: 'perm_orders_item_remove_approve', code: 'orders.item_remove.approve', name: 'Approve Order Item Removal', module: 'orders', description: 'Approve or reject waiter item-removal requests' },
    { id: 'perm_payments_view', code: 'payments.view', name: 'View Payments', module: 'payments', description: 'View payments in authorized branches' },
    { id: 'perm_payments_create', code: 'payments.create', name: 'Create Payments', module: 'payments', description: 'Accept payments for confirmed orders' },
    { id: 'perm_payments_refund', code: 'payments.refund', name: 'Refund Payments', module: 'payments', description: 'Refund completed payments with audit trail' },
    { id: 'perm_cash_shifts_view', code: 'cash_shifts.view', name: 'View Cash Shifts', module: 'finance', description: 'View cash register shifts and X reports' },
    { id: 'perm_cash_shifts_open', code: 'cash_shifts.open', name: 'Open Cash Shift', module: 'finance', description: 'Open a branch cash register shift' },
    { id: 'perm_cash_shifts_close', code: 'cash_shifts.close', name: 'Close Cash Shift', module: 'finance', description: 'Close a branch cash register shift and produce Z report' },
    { id: 'perm_kds_view', code: 'kds.view', name: 'View Kitchen Display', module: 'kitchen', description: 'View kitchen production tickets' },
    { id: 'perm_kds_update', code: 'kds.update', name: 'Update Kitchen Display', module: 'kitchen', description: 'Advance kitchen production ticket states' },
    { id: 'perm_boomcard_access', code: 'boomcard.access', name: 'Access Boomcard (Future)', module: 'boomcard', description: 'Prepared permission for future Loyalty module' },
    { id: 'perm_crm_access', code: 'crm.access', name: 'Access CRM (Future)', module: 'crm', description: 'Prepared permission for future CRM module' },
    { id: 'perm_inventory_access', code: 'inventory.access', name: 'Access Inventory', module: 'inventory', description: 'Access branch inventory and stock workflows' },
    { id: 'perm_inventory_view', code: 'inventory.view', name: 'View Inventory', module: 'inventory', description: 'View stock levels, recipes, suppliers and movements' },
    { id: 'perm_inventory_manage', code: 'inventory.manage', name: 'Manage Inventory', module: 'inventory', description: 'Manage stock items, recipes and adjustments' },
    { id: 'perm_inventory_purchase', code: 'inventory.purchase', name: 'Manage Purchases', module: 'inventory', description: 'Create and receive supplier purchases' },
    { id: 'perm_finance_access', code: 'finance.access', name: 'Access Finance (Future)', module: 'finance', description: 'Prepared permission for future Finance module' },
    { id: 'perm_analytics_access', code: 'analytics.access', name: 'Access Analytics (Future)', module: 'analytics', description: 'Prepared permission for future Analytics module' }
  ];

  for (const p of permissionsList) {
    await execute(
      `INSERT INTO permissions (id, code, name, module, description, created_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`,
      [p.id, p.code, p.name, p.module, p.description, now]
    );
  }

  // Employee permissions are additive and must also be present in already-initialized databases.
  // 2. Seed Base Roles
  const rolesList = [
    { id: 'role_owner', code: 'OWNER', name: 'Owner', description: 'Proprietor with unconstrained authority across all restaurant entities and branches', is_system: 1 },
    { id: 'role_super_admin', code: 'SUPER_ADMIN', name: 'Super Administrator', description: 'Full administrative access to all configuration, security, branches and users', is_system: 1 },
    { id: 'role_general_manager', code: 'GENERAL_MANAGER', name: 'General Manager', description: 'Network-wide operational manager supervising all branch operations and personnel', is_system: 1 },
    { id: 'role_branch_manager', code: 'BRANCH_MANAGER', name: 'Branch Manager', description: 'Operational leader managing a specific branch location and staff', is_system: 1 },
    { id: 'role_accountant', code: 'ACCOUNTANT', name: 'Accountant', description: 'Financial auditor with access to logs, reports and configuration reviews', is_system: 1 },
    { id: 'role_hr', code: 'HR', name: 'Human Resources', description: 'Staffing manager handling user profiles, role assignments and invitations', is_system: 1 },
    { id: 'role_marketing', code: 'MARKETING', name: 'Marketing Specialist', description: 'Campaign and brand coordinator', is_system: 1 },
    { id: 'role_cashier', code: 'CASHIER', name: 'Cashier', description: 'Frontline staff member operating at checkout counters in assigned branch', is_system: 1 },
    { id: 'role_waiter', code: 'WAITER', name: 'Waiter', description: 'Floor service staff serving dining tables in assigned branch', is_system: 1 },
    { id: 'role_kitchen', code: 'KITCHEN', name: 'Kitchen Staff', description: 'Culinary production line operator in assigned branch', is_system: 1 },
    { id: 'role_courier', code: 'COURIER', name: 'Courier', description: 'Delivery fulfillment runner', is_system: 1 }
  ];

  for (const r of rolesList) {
    await execute(
      `INSERT INTO roles (id, code, name, description, is_system, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'ACTIVE', ?, ?) ON CONFLICT DO NOTHING`,
      [r.id, r.code, r.name, r.description, r.is_system, now, now]
    );
  }

  // Map permissions to roles
  const allPerms = await query<{ id: string; code: string }>('SELECT id, code FROM permissions');
  const roleOwner = await queryOne<{ id: string }>('SELECT id FROM roles WHERE code = ?', ['OWNER']);
  const roleSuperAdmin = await queryOne<{ id: string }>('SELECT id FROM roles WHERE code = ?', ['SUPER_ADMIN']);
  const roleBranchManager = await queryOne<{ id: string }>('SELECT id FROM roles WHERE code = ?', ['BRANCH_MANAGER']);
  const roleHR = await queryOne<{ id: string }>('SELECT id FROM roles WHERE code = ?', ['HR']);
  const roleAccountant = await queryOne<{ id: string }>('SELECT id FROM roles WHERE code = ?', ['ACCOUNTANT']);
  const roleCashier = await queryOne<{ id: string }>('SELECT id FROM roles WHERE code = ?', ['CASHIER']);

  // OWNER & SUPER_ADMIN get all permissions
  for (const p of allPerms) {
    if (roleOwner) {
      await execute(
        `INSERT INTO role_permissions (id, role_id, permission_id, created_at) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING`,
        [`rp_owner_${p.code.replace('.', '_')}`, roleOwner.id, p.id, now]
      );
    }
    if (roleSuperAdmin) {
      await execute(
        `INSERT INTO role_permissions (id, role_id, permission_id, created_at) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING`,
        [`rp_sa_${p.code.replace('.', '_')}`, roleSuperAdmin.id, p.id, now]
      );
    }
  }

  // HR gets employee profile management.
  const employeePermCodes = ['employees.view', 'employees.update'];
  if (roleHR) {
    for (const code of employeePermCodes) {
      const p = allPerms.find(x => x.code === code);
      if (p) await execute(`INSERT INTO role_permissions (id, role_id, permission_id, created_at) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING`, [`rp_hr_${code.replace('.', '_')}`, roleHR.id, p.id, now]);
    }
  }

  // Branch Manager permissions: view users, view branches, view audit
  const bmPermCodes = ['users.view', 'users.update', 'employees.view', 'employees.update', 'branches.view', 'roles.view', 'audit.view', 'rbac.test'];
  if (roleBranchManager) {
    for (const code of bmPermCodes) {
      const p = allPerms.find(x => x.code === code);
      if (p) {
        await execute(
          `INSERT INTO role_permissions (id, role_id, permission_id, created_at) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING`,
          [`rp_bm_${code.replace('.', '_')}`, roleBranchManager.id, p.id, now]
        );
      }
    }
  }

  // HR permissions: users.*, roles.view, branches.view
  const hrPermCodes = ['users.view', 'users.create', 'users.update', 'roles.view', 'branches.view'];
  if (roleHR) {
    for (const code of hrPermCodes) {
      const p = allPerms.find(x => x.code === code);
      if (p) {
        await execute(
          `INSERT INTO role_permissions (id, role_id, permission_id, created_at) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING`,
          [`rp_hr_${code.replace('.', '_')}`, roleHR.id, p.id, now]
        );
      }
    }
  }

  // Accountant permissions: settings.view, branches.view, audit.view
  const accPermCodes = ['branches.view', 'settings.view', 'audit.view'];
  if (roleAccountant) {
    for (const code of accPermCodes) {
      const p = allPerms.find(x => x.code === code);
      if (p) {
        await execute(
          `INSERT INTO role_permissions (id, role_id, permission_id, created_at) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING`,
          [`rp_acc_${code.replace('.', '_')}`, roleAccountant.id, p.id, now]
        );
      }
    }
  }

  const roleGeneralManager = await queryOne<{ id: string }>('SELECT id FROM roles WHERE code = ?', ['GENERAL_MANAGER']);

  const stage17Perms = [
    { id: 'perm_service_charge_view', code: 'service_charge.view', name: 'View Service Charge', module: 'finance', description: 'View service charge configuration and ledger' },
    { id: 'perm_service_charge_manage', code: 'service_charge.manage', name: 'Manage Service Charge', module: 'finance', description: 'Configure service charge and allocation rules' },
    { id: 'perm_kpi_view', code: 'kpi.view', name: 'View KPI', module: 'kpi', description: 'View KPI rules and employee KPI results' },
    { id: 'perm_kpi_manage', code: 'kpi.manage', name: 'Manage KPI', module: 'kpi', description: 'Create and evaluate KPI rules' },
    { id: 'perm_pos_operator', code: 'pos.operator', name: 'Operator POS Access', module: 'pos', description: 'Lock and unlock operator POS' },
    { id: 'perm_print_view', code: 'print.view', name: 'View Print Settings', module: 'print', description: 'View receipt and printer profiles' },
    { id: 'perm_print_manage', code: 'print.manage', name: 'Manage Print Settings', module: 'print', description: 'Manage receipt and printer profiles' },
    { id: 'perm_print_execute', code: 'print.execute', name: 'Print Receipts', module: 'print', description: 'Create print jobs' },
    { id: 'perm_print_reprint', code: 'print.reprint', name: 'Reprint Receipts', module: 'print', description: 'Reprint previously generated documents' },
    { id: 'perm_waiter_status_view', code: 'waiters.status.view', name: 'View Waiter Status', module: 'waiters', description: 'View operational waiter qualification status' },
    { id: 'perm_waiter_status_manage', code: 'waiters.status.manage', name: 'Manage Waiter Status', module: 'waiters', description: 'Change waiter qualification status' },
    // waiters.ts gates its entire management router (list waiters, view/change waiter status,
    // issue/revoke waiter POS codes) behind this permission before any route-specific check
    // runs (see requireWaiterCodeManager's own stated intent: GM/BM/Owner/SuperAdmin). It was
    // never registered as a grantable permission at all, silently locking the whole router to
    // superusers only -- add it alongside the waiter-status permissions it gates together with.
    { id: 'perm_waiter_codes_manage', code: 'waiter_codes.manage', name: 'Manage Waiter POS Codes', module: 'waiters', description: 'List waiters and issue, revoke or view waiter POS access codes and status' },
    // Credit Mode (receivables): customer/staff credit accounts and their transaction ledger.
    { id: 'perm_credit_view', code: 'credit.view', name: 'View Credit Accounts', module: 'credit', description: 'View credit accounts, balances and transaction history' },
    { id: 'perm_credit_issue', code: 'credit.issue', name: 'Issue Credit', module: 'credit', description: 'Settle an order as a customer or staff credit sale' },
    { id: 'perm_credit_repay', code: 'credit.repay', name: 'Record Credit Repayment', module: 'credit', description: 'Record a full or partial repayment against a credit account' },
    { id: 'perm_credit_manage_limit', code: 'credit.manage_limit', name: 'Manage Credit Limits', module: 'credit', description: 'Set credit limits, approve over-limit sales and payroll deductions, and post adjustments' },
    { id: 'perm_credit_reports', code: 'credit.reports', name: 'View Credit Reports', module: 'credit', description: 'View receivables and credit reports across the branch' },
    // Manager Command Center: a read-only aggregation of sales/cash/credit/orders/KDS/waiter/
    // cashier/inventory/staff data the caller already has section-level permission for. It never
    // grants access to a domain the caller could not already reach through its own endpoint.
    { id: 'perm_dashboard_view', code: 'dashboard.view', name: 'View Manager Dashboard', module: 'dashboard', description: 'View the Manager Command Center aggregate dashboard' },
    // Live Operations (Stage 33): a read-only "right now" operational view. Same rule as
    // dashboard.view -- every section it shows is still gated by that section's own existing
    // permission (orders.view, kds.view, payments.view, credit.reports, inventory.view); this
    // permission only unlocks the aggregate live-operations screen itself.
    { id: 'perm_operations_view', code: 'operations.view', name: 'View Live Operations', module: 'operations', description: 'View the Live Operations control center (active orders, KDS, waiter/cashier workload, POS sessions, alerts)' },
    // Stage 34: recipe cost / food cost % / gross margin / profitability / inventory valuation
    // reporting. Distinct from inventory.view (raw stock counts) because these figures reveal
    // cost structure and margin, which should stay manager-level even for staff who can already
    // see stock levels.
    { id: 'perm_food_cost_view', code: 'food_cost.view', name: 'View Food Cost Reports', module: 'food_cost', description: 'View recipe cost, food cost %, gross margin, ingredient economics and menu profitability' },
    // Stage 34.1: controlled cancellation / "closed by establishment". Requesting is separated
    // from approving on purpose -- a waiter or cashier may raise the request but can never
    // finalise it alone, because the request decides both an order's fate and (independently)
    // whether produced food is written off and whether money leaves the till.
    { id: 'perm_order_closure_request', code: 'orders.closure.request', name: 'Request Order Closure', module: 'orders', description: 'Request a cancellation or an establishment closure of an order (requires manager approval)' },
    { id: 'perm_order_closure_approve', code: 'orders.closure.approve', name: 'Approve Order Closure', module: 'orders', description: 'Approve or reject a cancellation / establishment closure, its inventory treatment and its refund' }
  ];
  for (const p of stage17Perms) await execute(`INSERT INTO permissions (id,code,name,module,description,created_at) VALUES (?,?,?,?,?,?) ON CONFLICT (code) DO NOTHING`,[p.id,p.code,p.name,p.module,p.description,now]);
  const stage17RolePerms = ['service_charge.view','service_charge.manage','kpi.view','kpi.manage','pos.operator','print.view','print.manage','print.execute','print.reprint','waiters.status.view','waiters.status.manage','waiter_codes.manage','credit.view','credit.issue','credit.repay','credit.manage_limit','credit.reports','dashboard.view','operations.view','food_cost.view','orders.closure.request','orders.closure.approve'];
  for (const role of [roleOwner, roleSuperAdmin, roleGeneralManager, roleBranchManager]) {
    if (!role) continue;
    for (const code of stage17RolePerms) { const p=allPerms.find(x=>x.code===code) || stage17Perms.find(x=>x.code===code); if(p) await execute(`INSERT INTO role_permissions (id,role_id,permission_id,created_at) VALUES (?,?,?,?) ON CONFLICT DO NOTHING`,[`rp_${role.id}_${code.replace(/[^a-z0-9]/gi,'_')}`,role.id,p.id,now]); }
  }

  // Operational permissions are additive and safe for existing installations.
  const roleWaiter = await queryOne<{ id: string }>('SELECT id FROM roles WHERE code = ?', ['WAITER']);
  const operationalManagerPerms = ['orders.item_remove.approve','menu.view','menu.manage','tables.view','tables.manage','orders.view','orders.confirm','payments.view','payments.create','payments.refund','cash_shifts.view','cash_shifts.open','cash_shifts.close','kds.view','kds.update','inventory.access','inventory.view','inventory.manage','inventory.purchase'];
  for (const role of [roleGeneralManager, roleBranchManager]) {
    if (!role) continue;
    for (const code of operationalManagerPerms) { const p=allPerms.find(x=>x.code===code); if(p) await execute(`INSERT INTO role_permissions (id, role_id, permission_id, created_at) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING`, [`rp_${role.id}_${code.replace(/[^a-z0-9]/gi,'_')}`,role.id,p.id,now]); }
  }
  if (roleWaiter) {
    for (const code of ['pos.access','menu.view','tables.view','orders.create','orders.item_remove.request']) { const p=allPerms.find(x=>x.code===code); if(p) await execute(`INSERT INTO role_permissions (id, role_id, permission_id, created_at) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING`, [`rp_waiter_${code.replace(/[^a-z0-9]/gi,'_')}`,roleWaiter.id,p.id,now]); }
  }
  // Cashier permissions: branches.view + order confirmation/view. 'pos.operator' is required
  // because requireOperatorPosSession (operator-pos.ts) demands the short-lived POS session
  // token specifically from CASHIER-role callers, and /operator-pos/unlock -- the only way to
  // obtain that token -- itself requires 'pos.operator'. Without this grant a CASHIER account
  // can never unlock a session and payments.create becomes permanently unreachable for it,
  // even though CASHIER already holds payments.create itself (Stage 28 runtime-confirmed).
  if (roleCashier) {
    // print.view/execute/reprint let the cashier preview and print/reprint receipts for their
    // own branch (Stage 29 Cashier POS); print.manage (receipt design settings) intentionally
    // stays manager-only, matching the existing grant to GENERAL_MANAGER/BRANCH_MANAGER above.
    // credit.view/issue/repay let the cashier issue a credit sale and record a repayment
    // within their own approved limit; credit.manage_limit (set limits, approve over-limit
    // sales, post adjustments) and credit.reports stay manager-only, same separation as print.
    for (const code of ['branches.view','orders.view','orders.confirm','payments.view','payments.create','cash_shifts.view','cash_shifts.open','cash_shifts.close','pos.operator','print.view','print.execute','print.reprint','credit.view','credit.issue','credit.repay','orders.closure.request']) {
      const p = allPerms.find(x => x.code === code) || stage17Perms.find(x => x.code === code); if (!p) continue;
      await execute(`INSERT INTO role_permissions (id, role_id, permission_id, created_at) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING`, [`rp_csh_${code.replace(/[^a-z0-9]/gi,'_')}`, roleCashier.id, p.id, now]);
    }
  }

  await execute(`INSERT INTO system_settings (id,key,value,type,description,created_at,updated_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT (key) DO NOTHING`, ['setting_dine_service_charge','DINE_IN_SERVICE_CHARGE_PERCENT','10','number','Server-calculated service charge percentage for DINE_IN orders only.',now,now]);
  // Live Operations (Stage 33) delay detection: a configurable operational threshold, not a
  // number hardcoded in route or UI code. Editable by settings.update (Owner/SuperAdmin) via the
  // existing Settings screen; read server-side by /api/operations/live.
  await execute(`INSERT INTO system_settings (id,key,value,type,description,created_at,updated_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT (key) DO NOTHING`, ['setting_kds_warning_minutes','KDS_PREP_WARNING_MINUTES','15','number','Minutes an order may stay in PREPARING before Live Operations flags it WARNING.',now,now]);
  // Stage 34.1 auto-cancel windows. Both are configurable operational thresholds, never hardcoded
  // in route or UI code, and an automatic cancellation is only ever permitted while production has
  // not started -- see POST /api/orders/closures/auto-cancel.
  await execute(`INSERT INTO system_settings (id,key,value,type,description,created_at,updated_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT (key) DO NOTHING`, ['setting_order_confirmation_timeout','ORDER_CONFIRMATION_TIMEOUT','15','number','Minutes an order may stay in PENDING_CONFIRMATION before it becomes eligible for automatic cancellation.',now,now]);
  await execute(`INSERT INTO system_settings (id,key,value,type,description,created_at,updated_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT (key) DO NOTHING`, ['setting_kitchen_accept_timeout','KITCHEN_ACCEPT_TIMEOUT','10','number','Minutes a confirmed order may wait for the kitchen to start production before it becomes eligible for automatic cancellation.',now,now]);
  await execute(`INSERT INTO system_settings (id,key,value,type,description,created_at,updated_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT (key) DO NOTHING`, ['setting_kds_delayed_minutes','KDS_PREP_DELAYED_MINUTES','25','number','Minutes an order may stay in PREPARING before Live Operations flags it DELAYED.',now,now]);

  // 3. No demo franchises, branches, employees or operational users are created here.
  // BOOM OS starts empty by design. Real entities are created by the owner/authorized managers.

  // 4. Optional bootstrap owner. This is the only account that may be created automatically,
  // and only when explicit environment variables are supplied by the deployment operator.
  const bootstrapPassword = process.env.BOOTSTRAP_OWNER_PASSWORD?.trim();
  const bootstrapEmail = process.env.BOOTSTRAP_OWNER_EMAIL?.trim().toLowerCase();
  const bootstrapName = process.env.BOOTSTRAP_OWNER_NAME?.trim();
  const bootstrapPhone = process.env.BOOTSTRAP_OWNER_PHONE?.trim();

  if (bootstrapPassword || bootstrapEmail || bootstrapName || bootstrapPhone) {
    if (!bootstrapPassword || bootstrapPassword.length < 12) {
      throw new Error('FATAL CONFIGURATION ERROR: BOOTSTRAP_OWNER_PASSWORD is required (minimum 12 characters) when bootstrap owner configuration is provided.');
    }
    if (!bootstrapEmail || !bootstrapName) {
      throw new Error('FATAL CONFIGURATION ERROR: BOOTSTRAP_OWNER_EMAIL and BOOTSTRAP_OWNER_NAME are required when bootstrap owner configuration is provided.');
    }

    const existingOwner = await queryOne<{ id: string }>(
      `SELECT u.id FROM users u INNER JOIN user_roles ur ON ur.user_id = u.id INNER JOIN roles r ON r.id = ur.role_id WHERE r.code = 'OWNER' AND u.deleted_at IS NULL LIMIT 1`
    );

    if (!existingOwner) {
      const userId = `usr_owner_${Date.now().toString(36)}`;
      const nowOwner = new Date().toISOString();
      const passwordHash = bcrypt.hashSync(bootstrapPassword, bcrypt.genSaltSync(12));

      const ownerRole = await queryOne<{ id: string }>('SELECT id FROM roles WHERE code = ?', ['OWNER']);
      if (!ownerRole) throw new Error('OWNER system role is missing.');

      await transaction(async ({ execute: txExecute }) => {
        await txExecute(
          `INSERT INTO users (id, full_name, email, phone, password_hash, avatar_url, status, employment_status, disciplinary_status, joined_at, branch_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, NULL, 'ACTIVE', 'ACTIVE', 'NONE', ?, NULL, ?, ?)`,
          [userId, bootstrapName, bootstrapEmail, bootstrapPhone || '', passwordHash, nowOwner, nowOwner, nowOwner]
        );

        await txExecute(
          `INSERT INTO user_roles (id, user_id, role_id, created_at) VALUES (?, ?, ?, ?)`,
          [`ur_${userId}_${ownerRole.id}`, userId, ownerRole.id, nowOwner]
        );
      });

      console.log(`Bootstrap owner created: ${bootstrapEmail}. No demo branches, franchises or staff were created.`);
    } else {
      console.log('Existing OWNER account detected; bootstrap owner creation skipped.');
    }
  } else {
    console.log('No bootstrap owner configured. BOOM OS remains empty until an owner account is provisioned.');
  }

  // 5. Seed System Settings
  const settingsList = [
    { id: 'st_01', key: 'system.brand_name', value: 'BOOM', type: 'string', description: 'Global brand trading name' },
    { id: 'st_02', key: 'system.organization_name', value: '', type: 'string', description: 'Legal holding enterprise entity name; configured by the owner' },
    { id: 'st_03', key: 'system.default_currency', value: 'TMT', type: 'string', description: 'Base default currency for multi-currency transactions' },
    { id: 'st_04', key: 'system.default_timezone', value: 'Asia/Ashgabat', type: 'string', description: 'Default system timezone for scheduling and auditing' },
    { id: 'st_05', key: 'security.session_timeout_minutes', value: '180', type: 'number', description: 'Maximum inactive duration before re-authentication is required' },
    { id: 'st_06', key: 'security.password_min_length', value: '8', type: 'number', description: 'Enforced minimum password character count' },
    { id: 'st_07', key: 'audit.retention_days', value: '365', type: 'number', description: 'Retention horizon for security audit event records' },
    { id: 'st_08', key: 'security.rate_limit_rpm', value: '120', type: 'number', description: 'Maximum requests per minute per authenticated IP address' }
  ];

  for (const s of settingsList) {
    await execute(
      `INSERT INTO system_settings (id, key, value, type, description, updated_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`,
      [s.id, s.key, s.value, s.type, s.description, null, now, now]
    );
  }

  // No synthetic bootstrap audit event is inserted. Real actions are audited when they happen.

  console.log('BOOM OS foundation initial data seeded successfully.');
}
