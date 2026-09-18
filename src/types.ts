export type EmploymentStatus = 'ACTIVE' | 'INTERN' | 'PROBATION' | 'ON_LEAVE' | 'SUSPENDED' | 'TERMINATED';
export type DisciplinaryStatus = 'NONE' | 'WARNING' | 'REPRIMAND' | 'FINAL_REPRIMAND';

export interface EmployeeStatusHistory {
  id: string;
  user_id: string;
  employment_status: EmploymentStatus;
  disciplinary_status: DisciplinaryStatus;
  reason: string | null;
  notes: string | null;
  effective_from: string | null;
  effective_until: string | null;
  changed_by: string | null;
  created_at: string;
}

export interface Franchise {
  id: string;
  name: string;
  code: string;
  legal_name: string;
  contact_name: string;
  phone: string;
  email: string;
  address: string;
  status: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED';
  deleted_at?: string | null;
  branch_count?: number;
  active_branch_count?: number;
  employee_count?: number;
  active_employee_count?: number;
  created_at: string;
  updated_at: string;
}

export interface FranchiseModuleInfo {
  connected: boolean;
  status: string;
  label: string;
}

export interface FranchiseOverview {
  franchise: Franchise;
  metrics: {
    total_branches: number;
    active_branches: number;
    total_employees: number;
    active_employees: number;
    inactive_employees: number;
    orders_today: string | number;
    orders_this_week: string | number;
    orders_this_month: string | number;
    revenue_today: string | number;
    revenue_this_week: string | number;
    revenue_this_month: string | number;
    average_check: string | number;
    customers: string | number;
    average_rating: string | number;
    modules: Record<string, FranchiseModuleInfo>;
  };
}

export interface Branch {
  id: string;
  name: string;
  code: string;
  address: string;
  phone: string;
  timezone: string;
  currency: string;
  status: 'ACTIVE' | 'INACTIVE';
  franchise_id?: string | null;
  franchise_name?: string | null;
  franchise_code?: string | null;
  staff_count?: number;
  created_at: string;
  updated_at: string;
}

export interface Role {
  id: string;
  code: string;
  name: string;
  description: string | null;
  is_system: number;
  status: 'ACTIVE' | 'INACTIVE';
  created_at: string;
  updated_at: string;
  permissions?: Permission[];
  user_count?: number;
}

export interface Permission {
  id: string;
  code: string;
  name: string;
  module: string;
  description: string | null;
  created_at: string;
}


export interface EmployeeProfile {
  user_id: string;
  employee_code: string;
  position_title: string;
  department: string | null;
  employment_type: 'FULL_TIME' | 'PART_TIME' | 'CONTRACT' | 'INTERN' | 'SEASONAL';
  hire_date: string | null;
  termination_date: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface User {
  id: string;
  full_name: string;
  email: string;
  phone: string;
  avatar_url: string | null;
  status: 'ACTIVE' | 'SUSPENDED' | 'INACTIVE' | 'TERMINATED';
  employment_status?: EmploymentStatus;
  disciplinary_status?: DisciplinaryStatus;
  joined_at?: string | null;
  status_reason?: string | null;
  status_changed_at?: string | null;
  status_changed_by?: string | null;
  deleted_at?: string | null;
  branch_id: string | null;
  branch_name?: string;
  branch_code?: string;
  created_at: string;
  updated_at: string;
  last_login_at: string | null;
  roles: Array<{ id: string; code: string; name: string }>;
  roleCodes?: string[];
  permissions?: string[];
  allowedBranchIds?: string[];
  branchAccess?: Array<{ branch_id: string; name: string; code: string }>;
  isSuperUser?: boolean;
}

export interface SystemSetting {
  id: string;
  key: string;
  value: string;
  type: 'string' | 'number' | 'boolean' | 'json';
  description: string | null;
  updated_by: string | null;
  updater_name?: string;
  created_at: string;
  updated_at: string;
}

export interface AuditLog {
  id: string;
  user_id: string | null;
  branch_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  old_values: any;
  new_values: any;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
  user_name?: string;
  user_email?: string;
  branch_name?: string;
  branch_code?: string;
}

export interface SystemStats {
  users: {
    total: number;
    active: number;
  };
  branches: {
    total: number;
    active: number;
  };
  roles: {
    total: number;
  };
  permissions: {
    total: number;
  };
  auditLogsTotal: number;
}

export interface SystemTelemetry {
  stats: SystemStats;
  systemStatus: {
    database: string;
    security: string;
    isolation: string;
    rbac: string;
    environment: string;
  };
  recentActivities: Array<{
    id: string;
    action: string;
    entity_type: string;
    created_at: string;
    user_name: string | null;
    branch_name: string | null;
  }>;
}

export interface UserBranchAccessData {
  user_id: string;
  full_name: string;
  email: string;
  primary_branch_id: string | null;
  primary_branch: Branch | null;
  allowed_branch_ids: string[];
  allowed_branches: Array<{ branch_id: string; name: string; code: string; franchise_id?: string | null; franchise_name?: string | null }>;
  has_all_access: boolean;
  is_super_user: boolean;
  all_branches: Branch[];
}

export interface RBACTestResult {
  allowed: boolean;
  status: 'ACCESS GRANTED' | 'ACCESS DENIED';
  reason: string;
  simulation_params: {
    user: {
      id: string;
      full_name: string;
      email: string;
      status: string;
      primary_branch_id: string | null;
    };
    roles: Array<{ id: string; code: string; name: string }>;
    is_simulated_role: boolean;
    is_super_user: boolean;
    franchise: { id: string; name: string; code: string } | null;
    branch: { id: string; name: string; code: string; franchise_id: string | null } | null;
    permission: string | null;
  };
  resolved_role: string;
  resolved_roles: Array<{ id: string; code: string; name: string }>;
  resolved_permissions: string[];
  branch_access: {
    is_universal: boolean;
    allowed_branch_ids: string[];
    allowed_branches_count: number;
    has_target_branch_access: boolean;
  };
  matrix_results: Array<{
    permission: string;
    name: string;
    module: string;
    allowed: boolean;
    reason: string;
  }>;
}

