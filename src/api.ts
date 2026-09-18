import { User, Branch, Role, Permission, SystemSetting, AuditLog, SystemTelemetry } from './types';

const TOKEN_KEY = 'boom_os_auth_token';
const WAITER_SESSION_KEY = 'boom_waiter_pos_session';

export function getStoredWaiterSession(): string | null {
  return localStorage.getItem(WAITER_SESSION_KEY);
}

export function setStoredWaiterSession(token: string | null): void {
  if (token) localStorage.setItem(WAITER_SESSION_KEY, token);
  else localStorage.removeItem(WAITER_SESSION_KEY);
}

export function getStoredToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setStoredToken(token: string | null): void {
  if (token) {
    localStorage.setItem(TOKEN_KEY, token);
  } else {
    localStorage.removeItem(TOKEN_KEY);
  }
}

async function request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const token = getStoredToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {})
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(endpoint, {
    ...options,
    headers
  });

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    const errorMsg = data?.message || data?.error || `HTTP ${response.status}`;
    const err = new Error(errorMsg) as Error & { status: number; code?: string };
    err.status = response.status;
    err.code = data?.error;
    throw err;
  }

  return data as T;
}

async function waiterRequest<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const token = getStoredWaiterSession();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {})
  };
  if (token) headers['X-Waiter-Session'] = token;
  const response = await fetch(endpoint, { ...options, headers });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const err = new Error(data?.message || data?.error || `HTTP ${response.status}`) as Error & { status: number; code?: string };
    err.status = response.status;
    err.code = data?.code || data?.error;
    throw err;
  }
  return data as T;
}

export const api = {

  // Public customer menu / Smart Search
  getPublicBranches: () => request<{ branches: any[] }>('/api/public/branches'),
  getPublicMenu: (branch_id: string, lang = 'ru') => request<{ branch: any; language: string; items: any[] }>(`/api/public/menu?branch_id=${encodeURIComponent(branch_id)}&lang=${encodeURIComponent(lang)}`),
  smartSearch: (branch_id: string, q: string, lang = 'ru') => request<{ branch: any; query: string; parsed: any; items: any[]; recommendations: Array<{ label: string; people: number; items: Array<{ id: string; name: string; quantity: number; unit_price: string; line_total: string }>; total: string; remaining_budget: string | null }>; disclaimer: string }>(`/api/public/smart-search?branch_id=${encodeURIComponent(branch_id)}&q=${encodeURIComponent(q)}&lang=${encodeURIComponent(lang)}`),
  // Auth
  getBootstrapStatus: () =>
    request<{ needsBootstrap: boolean }>('/api/auth/bootstrap-status'),

  bootstrapOwner: (data: { full_name: string; email: string; phone?: string; password: string }) =>
    request<{ token: string; user: User }>('/api/auth/bootstrap', {
      method: 'POST',
      body: JSON.stringify(data)
    }),

  login: (login: string, password: string) =>
    request<{ token: string; user: User }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ login, password })
    }),

  getCurrentUser: () =>
    request<{ user: User }>('/api/auth/me'),

  logout: () =>
    request<{ success: boolean }>('/api/auth/logout', { method: 'POST' }),

  // System Stats
  getStats: () =>
    request<SystemTelemetry>('/api/system/stats'),

  getHealth: () =>
    request<{ status: string; system: string; version: string }>('/api/system/health'),

  // Users
  getUsers: (params?: { branch_id?: string; search?: string; status?: string; role?: string }) => {
    const query = new URLSearchParams();
    if (params?.branch_id) query.set('branch_id', params.branch_id);
    if (params?.search) query.set('search', params.search);
    if (params?.status) query.set('status', params.status);
    if (params?.role) query.set('role', params.role);
    return request<{ users: User[] }>(`/api/users?${query.toString()}`);
  },

  getUser: (id: string) =>
    request<{ user: User }>(`/api/users/${id}`),

  createUser: (data: any) =>
    request<{ user: User }>('/api/users', {
      method: 'POST',
      body: JSON.stringify(data)
    }),

  updateUser: (id: string, data: any) =>
    request<{ user: User }>(`/api/users/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data)
    }),

  deleteUser: (id: string) =>
    request<{ success: boolean; message: string }>(`/api/users/${id}`, {
      method: 'DELETE'
    }),

  // Employees
  getEmployees: (params?: { branch_id?: string; franchise_id?: string; search?: string; employment_type?: string }) => {
    const query = new URLSearchParams();
    if (params?.branch_id) query.set('branch_id', params.branch_id);
    if (params?.franchise_id) query.set('franchise_id', params.franchise_id);
    if (params?.search) query.set('search', params.search);
    if (params?.employment_type) query.set('employment_type', params.employment_type);
    return request<{ employees: any[] }>(`/api/employees?${query.toString()}`);
  },

  getEmployee: (id: string) => request<{ employee: any }>(`/api/employees/${id}`),

  saveEmployeeProfile: (id: string, data: any) => request<{ profile: any }>(`/api/employees/${id}/profile`, {
    method: 'POST', body: JSON.stringify(data)
  }),

  // Waiter POS / personal access codes
  getWaiters: (params?: { branch_id?: string }) => {
    const query = new URLSearchParams();
    if (params?.branch_id) query.set('branch_id', params.branch_id);
    return request<{ waiters: any[] }>(`/api/waiters?${query.toString()}`);
  },

  authenticateWaiterCode: (code: string, deviceId: string) =>
    request<{ waiter: any; session: { token: string; expiresAt: string; sessionId: string } }>('/api/waiters/authenticate-code', {
      method: 'POST',
      body: JSON.stringify({ code, deviceId })
    }),

  getWaiterSession: () => waiterRequest<{ session: any; waiter: any }>('/api/waiters/session'),

  logoutWaiter: () => waiterRequest<{ success: boolean }>('/api/waiters/logout', { method: 'POST' }),

  replaceWaiterCode: (id: string, code: string) =>
    request<{ success: boolean; waiter_id: string; temporary_code: string; message: string }>(`/api/waiters/${id}/code`, {
      method: 'POST', body: JSON.stringify({ code })
    }),

  revokeWaiterCode: (id: string) =>
    request<{ success: boolean; message: string }>(`/api/waiters/${id}/code`, { method: 'DELETE' }),



  // Inventory / Stock
  getInventoryItems: (branch_id?: string, low_stock = false) => {
    const q = new URLSearchParams(); if (branch_id) q.set('branch_id', branch_id); if (low_stock) q.set('low_stock','true');
    return request<{ items: any[] }>(`/api/inventory/items?${q.toString()}`);
  },
  createInventoryItem: (data: any) => request<{ item: any }>('/api/inventory/items', { method: 'POST', body: JSON.stringify(data) }),
  getRecipes: (branch_id?: string) => request<{ recipes: any[] }>(`/api/inventory/recipes${branch_id ? `?branch_id=${encodeURIComponent(branch_id)}` : ''}`),
  getSuppliers: (branch_id?: string) => request<{ suppliers: any[] }>(`/api/inventory/suppliers${branch_id ? `?branch_id=${encodeURIComponent(branch_id)}` : ''}`),
  getStockMovements: (branch_id?: string) => request<{ movements: any[] }>(`/api/inventory/movements${branch_id ? `?branch_id=${encodeURIComponent(branch_id)}` : ''}`),

  // Menu / Tables / Unified Order Core
  getMenuAdmin: (branch_id?: string) => { const q=branch_id?`?branch_id=${encodeURIComponent(branch_id)}`:''; return request<{branch_id:string;categories:any[];items:any[]}>(`/api/menu${q}`); },
  createMenuCategory: (data:any) => request<{category:any}>('/api/menu/categories',{method:'POST',body:JSON.stringify(data)}),
  updateMenuCategory: (id:string,data:any) => request<{category:any}>(`/api/menu/categories/${id}`,{method:'PATCH',body:JSON.stringify(data)}),
  createMenuItem: (data:any) => request<{item:any}>('/api/menu/items',{method:'POST',body:JSON.stringify(data)}),
  updateMenuItem: (id:string,data:any) => request<{item:any}>(`/api/menu/items/${id}`,{method:'PATCH',body:JSON.stringify(data)}),
  getMenuModifiers: (itemId:string, branch_id?:string) => request<{item:any;groups:any[]}>(`/api/menu/items/${itemId}/modifiers${branch_id?`?branch_id=${encodeURIComponent(branch_id)}`:''}`),
  createModifierGroup: (itemId:string,data:any) => request<{group:any}>(`/api/menu/items/${itemId}/modifier-groups`,{method:'POST',body:JSON.stringify(data)}),
  createModifier: (groupId:string,data:any) => request<{modifier:any}>(`/api/menu/modifier-groups/${groupId}/modifiers`,{method:'POST',body:JSON.stringify(data)}),

  getMenu: (branch_id?: string) => {
    const q = branch_id ? `?branch_id=${encodeURIComponent(branch_id)}` : '';
    return waiterRequest<{ branch_id: string; categories: any[]; items: any[] }>(`/api/menu/pos${q}`);
  },
  getTables: (branch_id?: string) => {
    const q = branch_id ? `?branch_id=${encodeURIComponent(branch_id)}` : '';
    return waiterRequest<{ branch_id: string; areas: any[]; tables: any[] }>(`/api/tables/pos${q}`);
  },
  createWaiterOrder: (data: { order_type: 'DINE_IN'|'TAKEAWAY'; table_id?: string|null; items: Array<{ menu_item_id:string; quantity:number; comment?:string|null; modifier_ids?:string[] }>; notes?:string }, idempotencyKey: string) =>
    waiterRequest<{ order: any; replayed?: boolean }>('/api/orders', { method:'POST', headers:{'Idempotency-Key': idempotencyKey}, body:JSON.stringify(data) }),
  getOrders: (params?: { branch_id?: string; status?: string }) => {
    const q = new URLSearchParams(); if(params?.branch_id) q.set('branch_id',params.branch_id); if(params?.status) q.set('status',params.status);
    return request<{ orders:any[] }>(`/api/orders?${q.toString()}`);
  },
  confirmOrder: (id:string) => request<{ order:any }>(`/api/orders/${id}/confirm`, { method:'POST' }),
  getOrder: (id:string) => request<{ order:any }>(`/api/orders/${id}`),
  updateOrderNotes: (id:string, data:{ customer_note?:string|null; internal_note?:string|null }) => request<{ order:any }>(`/api/orders/${id}/notes`,{method:'PATCH',body:JSON.stringify(data)}),
  updateOrderItemNote: (orderId:string, itemId:string, comment:string|null) => request<{ item:any }>(`/api/orders/${orderId}/items/${itemId}/note`,{method:'PATCH',body:JSON.stringify({comment})}),
  getPayments: (params?: { branch_id?: string }) => { const q=new URLSearchParams(); if(params?.branch_id) q.set('branch_id',params.branch_id); return request<{payments:any[]}>(`/api/payments?${q.toString()}`); },
  createPayment: (data:{order_id:string;method:string;amount:string;credit_account_id?:string},idempotencyKey:string,posSessionToken?:string) => request<{payment:any;replayed?:boolean}>('/api/payments',{method:'POST',headers:{'Idempotency-Key':idempotencyKey,...(posSessionToken?{'X-Pos-Session-Token':posSessionToken}:{})},body:JSON.stringify(data)}),
  refundPayment: (id:string) => request<{payment:any}>(`/api/payments/${id}/refund`,{method:'POST'}),
  // Credit mode (receivables)
  createCustomer: (data:{branch_id:string;name:string;phone:string;email?:string}) => request<{customer:any;existed:boolean}>('/api/credit/customers',{method:'POST',body:JSON.stringify(data)}),
  getCustomers: (params:{branch_id:string;search?:string}) => { const q=new URLSearchParams(); q.set('branch_id',params.branch_id); if(params.search) q.set('search',params.search); return request<{customers:any[]}>(`/api/credit/customers?${q.toString()}`); },
  getCustomer: (id:string) => request<{customer:any;account:any;orders:any[];transactions:any[]}>(`/api/credit/customers/${id}`),
  createCreditAccount: (data:{branch_id:string;type:'CUSTOMER'|'EMPLOYEE';customer_id?:string;employee_id?:string}) => request<{account:any;existed:boolean}>('/api/credit/accounts',{method:'POST',body:JSON.stringify(data)}),
  getCreditAccount: (id:string) => request<{account:any;owner:any;available_credit:string;transactions:any[]}>(`/api/credit/accounts/${id}`),
  setCreditLimit: (id:string,credit_limit:string) => request<{account:any}>(`/api/credit/accounts/${id}/limit`,{method:'PUT',body:JSON.stringify({credit_limit})}),
  recordCreditRepayment: (data:{account_id:string;amount:string;method:string;branch_id:string;note?:string},idempotencyKey:string,posSessionToken?:string) => request<{transaction:any;account:any;replayed?:boolean}>('/api/credit/repay',{method:'POST',headers:{'Idempotency-Key':idempotencyKey,...(posSessionToken?{'X-Pos-Session-Token':posSessionToken}:{})},body:JSON.stringify(data)}),
  getCreditTransactions: (params:{branch_id:string;account_id?:string;type?:string;start?:string;end?:string}) => { const q=new URLSearchParams(); Object.entries(params).forEach(([k,v])=>{if(v) q.set(k,String(v));}); return request<{transactions:any[]}>(`/api/credit/transactions?${q.toString()}`); },
  getCreditReportOverview: (params:{branch_id:string;start?:string;end?:string}) => { const q=new URLSearchParams(); Object.entries(params).forEach(([k,v])=>{if(v) q.set(k,String(v));}); return request<any>(`/api/credit/reports/overview?${q.toString()}`); },
  getCreditReportCustomers: (branch_id:string) => request<{branch_id:string;customers:any[]}>(`/api/credit/reports/customers?branch_id=${encodeURIComponent(branch_id)}`),
  getCreditReportStaff: (branch_id:string) => request<{branch_id:string;staff:any[]}>(`/api/credit/reports/staff?branch_id=${encodeURIComponent(branch_id)}`),
  getCreditReportBranch: () => request<{branches:any[]}>('/api/credit/reports/branch'),
  getCreditReportCashier: (params:{branch_id:string;start?:string;end?:string}) => { const q=new URLSearchParams(); Object.entries(params).forEach(([k,v])=>{if(v) q.set(k,String(v));}); return request<{branch_id:string;transactions:any[]}>(`/api/credit/reports/cashier?${q.toString()}`); },
  // Manager Command Center (Stage 32): one aggregation endpoint, branch + date-range scoped.
  getManagerDashboard: (params:{branch_id:string;start?:string;end?:string}) => { const q=new URLSearchParams(); q.set('branch_id',params.branch_id); if(params.start) q.set('start',params.start); if(params.end) q.set('end',params.end); return request<any>(`/api/dashboard/manager?${q.toString()}`); },
  // Operator POS (short-lived cashier session token, gates payments.create/refund for CASHIER)
  unlockOperatorPos: (data:{ password:string; branch_id:string; device_id?:string }) => request<{ unlocked:boolean; session_id:string; session_token:string }>('/api/operator-pos/unlock',{method:'POST',body:JSON.stringify(data)}),
  lockOperatorPos: (branch_id:string) => request<{ locked:boolean }>('/api/operator-pos/lock',{method:'POST',body:JSON.stringify({branch_id})}),
  // Print / Receipt engine
  getPrintProfiles: (branch_id?:string) => request<{ profiles:any[] }>(`/api/print/profiles${branch_id?`?branch_id=${encodeURIComponent(branch_id)}`:''}`),
  createPrintProfile: (data:any) => request<{ profile:any }>('/api/print/profiles',{method:'POST',body:JSON.stringify(data)}),
  updatePrintProfile: (id:string, data:any) => request<{ profile:any }>(`/api/print/profiles/${id}`,{method:'PUT',body:JSON.stringify(data)}),
  createPrintJob: (data:{ branch_id:string; order_id?:string; print_type:string; printer_name?:string; copy_number?:number }) => request<{ job:any }>('/api/print/jobs',{method:'POST',body:JSON.stringify(data)}),
  reprintJob: (id:string) => request<{ job:any }>(`/api/print/jobs/${id}/reprint`,{method:'POST'}),
  getCashShifts: (params?: { branch_id?: string }) => { const q=new URLSearchParams(); if(params?.branch_id) q.set('branch_id',params.branch_id); return request<{shifts:any[]}>(`/api/cash-shifts?${q.toString()}`); },
  getCurrentCashShift: (branch_id?:string) => request<{shift:any|null}>(`/api/cash-shifts/current${branch_id?`?branch_id=${encodeURIComponent(branch_id)}`:''}`),
  openCashShift: (branch_id:string,opening_cash:string) => request<{shift:any}>('/api/cash-shifts',{method:'POST',body:JSON.stringify({branch_id,opening_cash})}),
  closeCashShift: (id:string,actual_cash:string) => request<{report:any}>(`/api/cash-shifts/${id}/z-report`,{method:'POST',body:JSON.stringify({actual_cash})}),
  getKds: (params?: { branch_id?: string; status?: string }) => { const q=new URLSearchParams(); if(params?.branch_id) q.set('branch_id',params.branch_id); if(params?.status) q.set('status',params.status); return request<{tickets:any[]}>(`/api/kds?${q.toString()}`); },
  updateKdsStatus: (id:string,status:string) => request<{ticket:any}>(`/api/kds/${id}/status`,{method:'POST',body:JSON.stringify({status})}),
  requestItemRemoval: (orderId:string, itemId:string, quantity:string|number, reason:string) => waiterRequest<{ approval:any }>(`/api/orders/${orderId}/items/${itemId}/removal-request`, { method:'POST', body: JSON.stringify({ quantity, reason }) }),
  getItemRemovalRequests: (params?: { branch_id?: string; status?: string }) => { const q=new URLSearchParams(); if(params?.branch_id) q.set('branch_id',params.branch_id); if(params?.status) q.set('status',params.status); return request<{ branch_id:string; requests:any[] }>(`/api/orders/removal-requests?${q.toString()}`); },
  approveItemRemoval: (approvalId:string, reason?:string) => request<{ approval:any; order:any }>(`/api/orders/removal-requests/${approvalId}/approve`, { method:'POST', body: JSON.stringify({ reason }) }),
  rejectItemRemoval: (approvalId:string, reason?:string) => request<{ approval:any }>(`/api/orders/removal-requests/${approvalId}/reject`, { method:'POST', body: JSON.stringify({ reason }) }),

  // Branches
  getBranches: (params?: { status?: string; search?: string }) => {
    const query = new URLSearchParams();
    if (params?.status) query.set('status', params.status);
    if (params?.search) query.set('search', params.search);
    return request<{ branches: Branch[] }>(`/api/branches?${query.toString()}`);
  },

  getBranch: (id: string) =>
    request<{ branch: Branch & { staff: User[] } }>(`/api/branches/${id}`),

  createBranch: (data: any) =>
    request<{ branch: Branch }>('/api/branches', {
      method: 'POST',
      body: JSON.stringify(data)
    }),

  updateBranch: (id: string, data: any) =>
    request<{ branch: Branch }>(`/api/branches/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data)
    }),

  deleteBranch: (id: string) =>
    request<{ success: boolean; message: string }>(`/api/branches/${id}`, {
      method: 'DELETE'
    }),

  // Roles
  getRoles: () =>
    request<{ roles: Role[] }>('/api/roles'),

  getRole: (id: string) =>
    request<{ role: Role & { permissions: Permission[]; users: any[] } }>(`/api/roles/${id}`),

  createRole: (data: any) =>
    request<{ role: Role }>('/api/roles', {
      method: 'POST',
      body: JSON.stringify(data)
    }),

  updateRole: (id: string, data: any) =>
    request<{ role: Role }>(`/api/roles/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data)
    }),

  deleteRole: (id: string) =>
    request<{ success: boolean; message: string }>(`/api/roles/${id}`, {
      method: 'DELETE'
    }),

  // Permissions
  getPermissions: () =>
    request<{ permissions: Permission[]; grouped: Record<string, Permission[]> }>('/api/permissions'),

  createPermission: (data: { code: string; name: string; module: string; description?: string }) =>
    request<{ permission: Permission }>('/api/permissions', {
      method: 'POST',
      body: JSON.stringify(data)
    }),

  // Settings
  getSettings: () =>
    request<{ settings: SystemSetting[] }>('/api/settings'),

  updateSetting: (key: string, data: { value: string; description?: string }) =>
    request<{ setting: SystemSetting }>(`/api/settings/${encodeURIComponent(key)}`, {
      method: 'PUT',
      body: JSON.stringify(data)
    }),

  createSetting: (data: { key: string; value: string; type: string; description?: string }) =>
    request<{ setting: SystemSetting }>('/api/settings', {
      method: 'POST',
      body: JSON.stringify(data)
    }),

  // Audit Logs
  getAuditLogs: (params?: {
    user_id?: string;
    branch_id?: string;
    action?: string;
    entity_type?: string;
    search?: string;
    start_date?: string;
    end_date?: string;
    limit?: number;
    offset?: number;
  }) => {
    const query = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([k, v]) => {
        if (v !== undefined && v !== '') query.set(k, String(v));
      });
    }
    return request<{
      logs: AuditLog[];
      total: number;
      distinctActions: string[];
      limit: number;
      offset: number;
    }>(`/api/audit?${query.toString()}`);
  },

  // Organization hierarchy
  getOrganizationTree: () =>
    request<{ franchises: any[]; unassigned_branches: Branch[] }>('/api/organization/tree'),

  getOrganizationSummary: () =>
    request<{ franchises: number; branches: number; active_branches: number; employees: number; active_employees: number }>('/api/organization/summary'),

  // Franchises
  getFranchises: (params?: { status?: string; search?: string }) => {
    const query = new URLSearchParams();
    if (params?.status) query.set('status', params.status);
    if (params?.search) query.set('search', params.search);
    return request<{ franchises: any[] }>(`/api/franchises?${query.toString()}`);
  },

  getFranchise: (id: string) =>
    request<{ franchise: any }>(`/api/franchises/${id}`),

  getFranchiseOverview: (id: string) =>
    request<{ franchise: any; metrics: any }>(`/api/franchises/${id}/overview`),

  getFranchiseBranches: (id: string) =>
    request<{ branches: Branch[] }>(`/api/franchises/${id}/branches`),

  getFranchiseEmployees: (id: string) =>
    request<{ employees: any[] }>(`/api/franchises/${id}/employees`),

  getFranchiseOrders: (id: string) =>
    request<{ connected: boolean; franchise_id: string; message: string; orders: any[] }>(`/api/franchises/${id}/orders`),

  createFranchise: (data: any) =>
    request<{ franchise: any; message: string }>('/api/franchises', {
      method: 'POST',
      body: JSON.stringify(data)
    }),

  updateFranchise: (id: string, data: any) =>
    request<{ franchise: any; message: string }>(`/api/franchises/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data)
    }),

  updateFranchiseStatus: (id: string, status: string) =>
    request<{ status: string; message: string }>(`/api/franchises/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status })
    }),

  deleteFranchise: (id: string) =>
    request<{ message: string; success: boolean }>(`/api/franchises/${id}`, {
      method: 'DELETE'
    }),

  assignBranchToFranchise: (franchiseId: string, branchId: string) =>
    request<{ message: string; branch: any }>(`/api/franchises/${franchiseId}/branches/${branchId}`, {
      method: 'POST'
    }),

  unlinkBranchFromFranchise: (franchiseId: string, branchId: string) =>
    request<{ message: string; branch: any }>(`/api/franchises/${franchiseId}/branches/${branchId}`, {
      method: 'DELETE'
    }),

  // Employee Status Management
  getUserStatus: (userId: string) =>
    request<{
      user_id: string;
      full_name: string;
      email: string;
      employment_status: string;
      disciplinary_status: string;
      joined_at: string | null;
      status_reason: string | null;
      status_changed_at: string | null;
      status_changed_by: string | null;
      primary_branch_id: string | null;
    }>(`/api/users/${userId}/status`),

  updateUserStatus: (userId: string, data: {
    employment_status?: string;
    disciplinary_status?: string;
    reason?: string;
    notes?: string;
    effective_from?: string;
    effective_until?: string;
  }) =>
    request<{
      message: string;
      user_id: string;
      employment_status: string;
      disciplinary_status: string;
      status: string;
      status_history_id: string;
    }>(`/api/users/${userId}/status`, {
      method: 'PUT',
      body: JSON.stringify(data)
    }),

  getUserStatusHistory: (userId: string) =>
    request<{ user: any; history: any[] }>(`/api/users/${userId}/status-history`)
};
