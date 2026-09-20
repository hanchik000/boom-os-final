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

// Query-string builder shared by the report endpoints: undefined and empty values are dropped so
// an unset filter is absent rather than sent as an empty string the server would have to ignore.
function qs(params: Record<string, unknown>): string {
  const q = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') q.set(k, String(v)); });
  return q.toString();
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
  getMenuAdmin: (branch_id?: string, includeArchived?: boolean) => { const q=new URLSearchParams(); if(branch_id)q.set('branch_id',branch_id); if(includeArchived)q.set('include_archived','true'); const s=q.toString(); return request<{branch_id:string;categories:any[];items:any[]}>(`/api/menu${s?`?${s}`:''}`); },
  createMenuCategory: (data:any) => request<{category:any}>('/api/menu/categories',{method:'POST',body:JSON.stringify(data)}),
  updateMenuCategory: (id:string,data:any) => request<{category:any}>(`/api/menu/categories/${id}`,{method:'PATCH',body:JSON.stringify(data)}),
  // Stage 36: archive (soft delete) -- the backend has always supported it, ADMIN never called it.
  archiveMenuCategory: (id:string) => request<{success:boolean;message:string}>(`/api/menu/categories/${encodeURIComponent(id)}`,{method:'DELETE'}),
  createMenuItem: (data:any) => request<{item:any}>('/api/menu/items',{method:'POST',body:JSON.stringify(data)}),
  updateMenuItem: (id:string,data:any) => request<{item:any}>(`/api/menu/items/${id}`,{method:'PATCH',body:JSON.stringify(data)}),
  archiveMenuItem: (id:string) => request<{success:boolean;message:string}>(`/api/menu/items/${encodeURIComponent(id)}`,{method:'DELETE'}),
  getMenuModifiers: (itemId:string, branch_id?:string, includeArchived?:boolean) => { const q=new URLSearchParams(); if(branch_id)q.set('branch_id',branch_id); if(includeArchived)q.set('include_archived','true'); const s=q.toString(); return request<{item:any;groups:any[]}>(`/api/menu/items/${itemId}/modifiers${s?`?${s}`:''}`); },
  // Stage 37: the regulated allergen reference list (read-only; seeded, not user content).
  getAllergens: () => request<{ allergens: Array<{id:string;code:string;label_ru:string;label_tk:string;label_en:string;sort_order:number}> }>('/api/menu/allergens'),
  createModifierGroup: (itemId:string,data:any) => request<{group:any}>(`/api/menu/items/${itemId}/modifier-groups`,{method:'POST',body:JSON.stringify(data)}),
  createModifier: (groupId:string,data:any) => request<{modifier:any}>(`/api/menu/modifier-groups/${groupId}/modifiers`,{method:'POST',body:JSON.stringify(data)}),
  // Stage 36: modifier group/option editing and archiving (new backend routes).
  updateModifierGroup: (groupId:string,data:any) => request<{group:any}>(`/api/menu/modifier-groups/${encodeURIComponent(groupId)}`,{method:'PATCH',body:JSON.stringify(data)}),
  archiveModifierGroup: (groupId:string) => request<{success:boolean;message:string}>(`/api/menu/modifier-groups/${encodeURIComponent(groupId)}`,{method:'DELETE'}),
  updateModifier: (modifierId:string,data:any) => request<{modifier:any}>(`/api/menu/modifiers/${encodeURIComponent(modifierId)}`,{method:'PATCH',body:JSON.stringify(data)}),
  archiveModifier: (modifierId:string) => request<{success:boolean;message:string}>(`/api/menu/modifiers/${encodeURIComponent(modifierId)}`,{method:'DELETE'}),

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
  createPayment: (data:{order_id:string;bill_id?:string;method:string;amount:string;credit_account_id?:string},idempotencyKey:string,posSessionToken?:string) => request<{payment:any;replayed?:boolean}>('/api/payments',{method:'POST',headers:{'Idempotency-Key':idempotencyKey,...(posSessionToken?{'X-Pos-Session-Token':posSessionToken}:{})},body:JSON.stringify(data)}),
  refundPayment: (id:string) => request<{payment:any}>(`/api/payments/${id}/refund`,{method:'POST'}),
  // Credit mode (receivables)
  // Stage 34.3: one customer core. Listing and creating a guest go through /api/customers for every
  // surface; the credit module's own detail view stays separate only because it returns the credit
  // account alongside the same customer record.
  createCustomer: (data:{branch_id:string;name:string;phone?:string;email?:string}) => request<{customer:any;existed:boolean}>('/api/customers',{method:'POST',body:JSON.stringify(data)}),
  getCustomers: (params:{branch_id:string;search?:string}) => { const q=new URLSearchParams(); q.set('branch_id',params.branch_id); if(params.search) q.set('search',params.search); return request<{customers:any[]}>(`/api/customers?${q.toString()}`); },
  getCreditCustomer: (id:string) => request<{customer:any;account:any;orders:any[];transactions:any[]}>(`/api/credit/customers/${id}`),
  createCreditAccount: (data:{branch_id:string;type:'CUSTOMER'|'EMPLOYEE';customer_id?:string;employee_id?:string}) => request<{account:any;existed:boolean}>('/api/credit/accounts',{method:'POST',body:JSON.stringify(data)}),
  // Stage 34.10: the per-account drill-down is period-scoped and says whether the owner is
  // archived and whether the account is past its own individual limit.
  getCreditAccount: (id:string,params?:{start?:string;end?:string}) => { const q=new URLSearchParams(); Object.entries(params||{}).forEach(([k,v])=>{if(v) q.set(k,String(v));}); const qs=q.toString(); return request<{account:any;owner:any;available_credit:string;over_limit:boolean;period:{start:string|null;end:string|null};transactions:any[]}>(`/api/credit/accounts/${id}${qs?`?${qs}`:""}`); },
  setCreditLimit: (id:string,credit_limit:string) => request<{account:any}>(`/api/credit/accounts/${id}/limit`,{method:'PUT',body:JSON.stringify({credit_limit})}),
  recordCreditRepayment: (data:{account_id:string;amount:string;method:string;branch_id:string;note?:string},idempotencyKey:string,posSessionToken?:string) => request<{transaction:any;account:any;replayed?:boolean}>('/api/credit/repay',{method:'POST',headers:{'Idempotency-Key':idempotencyKey,...(posSessionToken?{'X-Pos-Session-Token':posSessionToken}:{})},body:JSON.stringify(data)}),
  getCreditTransactions: (params:{branch_id:string;account_id?:string;type?:string;start?:string;end?:string}) => { const q=new URLSearchParams(); Object.entries(params).forEach(([k,v])=>{if(v) q.set(k,String(v));}); return request<{transactions:any[]}>(`/api/credit/transactions?${q.toString()}`); },
  getCreditReportOverview: (params:{branch_id:string;start?:string;end?:string}) => { const q=new URLSearchParams(); Object.entries(params).forEach(([k,v])=>{if(v) q.set(k,String(v));}); return request<any>(`/api/credit/reports/overview?${q.toString()}`); },
  getCreditReportCustomers: (branch_id:string,status?:string) => request<{branch_id:string;status:string|null;customers:any[]}>(`/api/credit/reports/customers?branch_id=${encodeURIComponent(branch_id)}${status?`&status=${encodeURIComponent(status)}`:""}`),
  getCreditReportStaff: (branch_id:string,status?:string) => request<{branch_id:string;status:string|null;staff:any[]}>(`/api/credit/reports/staff?branch_id=${encodeURIComponent(branch_id)}${status?`&status=${encodeURIComponent(status)}`:""}`),
  getCreditReportBranch: () => request<{branches:any[]}>('/api/credit/reports/branch'),
  // Stage 34.11: Food & Sales analytics. Every figure below is computed by the SERVER from the
  // Order Core; the client only chooses the period, the sort and the filters.
  getAnalyticsSales: (p:{branch_id:string;start?:string;end?:string;order_type?:string}) => request<any>(`/api/analytics/sales?${qs(p)}`),
  getAnalyticsDishes: (p:{branch_id:string;start?:string;end?:string;sort?:string;order?:string;category_id?:string;limit?:number}) => request<any>(`/api/analytics/dishes?${qs(p)}`),
  getAnalyticsCategories: (p:{branch_id:string;start?:string;end?:string}) => request<any>(`/api/analytics/categories?${qs(p)}`),
  getAnalyticsTime: (p:{branch_id:string;start?:string;end?:string}) => request<any>(`/api/analytics/time?${qs(p)}`),
  getAnalyticsMatrix: (p:{branch_id:string;start?:string;end?:string}) => request<any>(`/api/analytics/matrix?${qs(p)}`),
  getAnalyticsDish: (menuItemId:string,p:{branch_id:string;start?:string;end?:string}) => request<any>(`/api/analytics/dishes/${menuItemId}?${qs(p)}`),

  // Stage 34.12: the unified BOOMCARD Operations Journal -- every figure and filter is applied by
  // the SERVER; the client only chooses which page and which filters to ask for.
  getBoomcardJournal: (p:{branch_id:string;start?:string;end?:string;source?:string;event_type?:string;status?:string;customer_id?:string;boomcard_id?:string;order_id?:string;operator_id?:string;search?:string;page?:number;page_size?:number}) => request<{branch_id:string;period:{start:string|null;end:string|null};page:number;page_size:number;total:number;total_pages:number;rows:any[]}>(`/api/boomcard/journal?${qs(p)}`),
  getBoomcardJournalSummary: (p:{branch_id:string;start?:string;end?:string}) => request<{branch_id:string;period:{start:string|null;end:string|null};event_types:any[]}>(`/api/boomcard/journal/summary?${qs(p)}`),

  // POS Media Engine — Stage 35.2
  getPosMedia: (branch_id?: string) => request<{ media: any[] }>(`/api/pos-media${branch_id ? `?branch_id=${encodeURIComponent(branch_id)}` : ''}`),
  getVisualCatalog: (branch_id: string) => request<{ blocks:any[]; categories:any[]; items:any[] }>(`/api/visual-catalog?branch_id=${encodeURIComponent(branch_id)}`),
  getMediaAssets: (branch_id?: string) => request<{ assets:any[] }>(`/api/media-assets${branch_id ? `?branch_id=${encodeURIComponent(branch_id)}` : ''}`),
  createMediaAsset: (data:any) => request<{asset:any}>('/api/media-assets',{method:'POST',body:JSON.stringify(data)}),
  updateMediaAsset: (id:string,data:any) => request<{asset:any}>(`/api/media-assets/${encodeURIComponent(id)}`,{method:'PATCH',body:JSON.stringify(data)}),
  deactivateMediaAsset: (id:string) => request<{success:boolean}>(`/api/media-assets/${encodeURIComponent(id)}`,{method:'DELETE'}),
  uploadMediaAsset: async (file: File, branchId: string | null) => { const token=getStoredToken(); const headers:Record<string,string>={'Content-Type':file.type,'X-Media-Name':file.name}; if(branchId)headers['X-Branch-Id']=branchId; if(token)headers.Authorization=`Bearer ${token}`; const response=await fetch('/api/media-assets/upload',{method:'POST',headers,body:file}); const data=await response.json().catch(()=>null); if(!response.ok)throw new Error(data?.message||data?.error||`HTTP ${response.status}`); return data as {asset:any}; },
  getPublicVisualCatalog: (branch_id: string, lang='ru', channel?: string) => request<{ branch:any; channel:string|null; blocks:any[]; categories:any[]; items:any[] }>(`/api/visual-catalog/public?branch_id=${encodeURIComponent(branch_id)}&lang=${lang}${channel?`&channel=${encodeURIComponent(channel)}`:''}`),
  // Stage 35.6 -- QR menu entry: the branch is resolved server-side from the opaque token, never
  // supplied by the client.
  resolveQrBranch: (token: string) => request<{ branch: any }>(`/api/public/qr/${encodeURIComponent(token)}`),
  getBranchQr: (branchId: string) => request<{ branch_id:string; qr_token:string|null; qr_url:string|null }>(`/api/branches/${encodeURIComponent(branchId)}/qr`),
  regenerateBranchQr: (branchId: string) => request<{ branch_id:string; qr_token:string; qr_url:string }>(`/api/branches/${encodeURIComponent(branchId)}/qr/regenerate`, { method:'POST' }),
  // Promotion Engine -- Stage 35.6
  getPromotions: (branch_id: string) => request<{ branch_id:string; promotions:any[] }>(`/api/promotions?branch_id=${encodeURIComponent(branch_id)}`),
  createPromotion: (data:any) => request<{promotion:any}>('/api/promotions',{method:'POST',body:JSON.stringify(data)}),
  updatePromotion: (id:string,data:any) => request<{promotion:any}>(`/api/promotions/${encodeURIComponent(id)}`,{method:'PATCH',body:JSON.stringify(data)}),
  deactivatePromotion: (id:string) => request<{success:boolean}>(`/api/promotions/${encodeURIComponent(id)}`,{method:'DELETE'}),
  createVisualCatalogBlock: (data:any) => request<{block:any}>('/api/visual-catalog',{method:'POST',body:JSON.stringify(data)}),
  updateVisualCatalogBlock: (id:string,data:any) => request<{block:any}>(`/api/visual-catalog/${id}`,{method:'PATCH',body:JSON.stringify(data)}),
  deactivateVisualCatalogBlock: (id:string) => request<{success:boolean}>(`/api/visual-catalog/${id}`,{method:'DELETE'}),
  createPosMedia: (data: any) => request<{ media: any }>('/api/pos-media', { method:'POST', body:JSON.stringify(data) }),
  updatePosMedia: (id: string, data: any) => request<{ media: any }>(`/api/pos-media/${encodeURIComponent(id)}`, { method:'PATCH', body:JSON.stringify(data) }),
  deactivatePosMedia: (id: string) => request<{ success: boolean }>(`/api/pos-media/${encodeURIComponent(id)}`, { method:'DELETE' }),
  uploadPosMedia: async (file: File, branchId: string | null) => {
    const token = getStoredToken();
    const headers: Record<string,string> = { 'Content-Type': file.type, 'X-Media-Name': file.name };
    if (branchId) headers['X-Branch-Id'] = branchId;
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const response = await fetch('/api/pos-media/upload', { method:'POST', headers, body:file });
    const data = await response.json().catch(()=>null);
    if (!response.ok) throw new Error(data?.message || data?.error || `HTTP ${response.status}`);
    return data as { media:any };
  },
  getCurrentWaiterPosMedia: () => waiterRequest<{ media:any[]; primary:any|null }>('/api/pos-media/current'),
  getCreditReportCashier: (params:{branch_id:string;start?:string;end?:string}) => { const q=new URLSearchParams(); Object.entries(params).forEach(([k,v])=>{if(v) q.set(k,String(v));}); return request<{branch_id:string;transactions:any[]}>(`/api/credit/reports/cashier?${q.toString()}`); },
  // Manager Command Center (Stage 32): one aggregation endpoint, branch + date-range scoped.
  getManagerDashboard: (params:{branch_id:string;start?:string;end?:string}) => { const q=new URLSearchParams(); q.set('branch_id',params.branch_id); if(params.start) q.set('start',params.start); if(params.end) q.set('end',params.end); return request<any>(`/api/dashboard/manager?${q.toString()}`); },
  // Live Operations (Stage 33): one "right now" operational aggregation endpoint, branch-scoped.
  getLiveOperations: (branch_id:string) => request<any>(`/api/operations/live?branch_id=${encodeURIComponent(branch_id)}`),
  // Recipe Engine (Stage 34) -- extends the existing inventory.ts recipe endpoints (getRecipes
  // above) with versioning.
  getRecipeVersions: (menuItemId:string, branch_id:string) => request<{branch_id:string;menu_item_id:string;versions:any[]}>(`/api/inventory/recipes/${menuItemId}/versions?branch_id=${encodeURIComponent(branch_id)}`),
  createRecipe: (data:{branch_id:string;menu_item_id:string;name:string;yield_qty?:string;ingredients:Array<{inventory_item_id:string;quantity:string}>}) => request<{recipe:any}>('/api/inventory/recipes',{method:'POST',body:JSON.stringify(data)}),
  createRecipeVersion: (recipeId:string, data:{name?:string;yield_qty?:string;ingredients:Array<{inventory_item_id:string;quantity:string}>}) => request<{recipe:any}>(`/api/inventory/recipes/${recipeId}/versions`,{method:'POST',body:JSON.stringify(data)}),
  setRecipeStatus: (recipeId:string, active:boolean) => request<{recipe:any}>(`/api/inventory/recipes/${recipeId}/status`,{method:'PUT',body:JSON.stringify({active})}),
  // Inventory counts / variance (Stage 34)
  getInventoryCounts: (branch_id:string) => request<{counts:any[]}>(`/api/inventory/counts?branch_id=${encodeURIComponent(branch_id)}`),
  createInventoryCount: (data:{branch_id:string;inventory_item_id:string;counted_quantity:string;reason?:string}) => request<{count:any;item:any}>('/api/inventory/counts',{method:'POST',body:JSON.stringify(data)}),
  // Food Cost / Profitability (Stage 34)
  getFoodCostMenuItems: (params:{branch_id:string;category_id?:string;active?:boolean}) => { const q=new URLSearchParams(); q.set('branch_id',params.branch_id); if(params.category_id) q.set('category_id',params.category_id); if(params.active===false) q.set('active','false'); return request<{branch_id:string;items:any[]}>(`/api/food-cost/menu-items?${q.toString()}`); },
  getFoodCostMenuItemDetail: (menuItemId:string, branch_id:string) => request<{item:any;recipe:any}>(`/api/food-cost/menu-items/${menuItemId}?branch_id=${encodeURIComponent(branch_id)}`),
  getFoodCostIngredients: (branch_id:string) => request<{branch_id:string;ingredients:any[]}>(`/api/food-cost/ingredients?branch_id=${encodeURIComponent(branch_id)}`),
  getFoodCostProfitability: (params:{branch_id:string;start?:string;end?:string}) => { const q=new URLSearchParams(); q.set('branch_id',params.branch_id); if(params.start) q.set('start',params.start); if(params.end) q.set('end',params.end); return request<any>(`/api/food-cost/profitability?${q.toString()}`); },
  getFoodCostValuation: (branch_id:string) => request<{branch_id:string;total_value:string;items:any[]}>(`/api/food-cost/valuation?${new URLSearchParams({branch_id}).toString()}`),
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

  // Stage 34.1 -- controlled cancellation / "closed by establishment". `inventory_treatment` is
  // always supplied explicitly by the person making the request; the UI never defaults it.
  getMyWaiterOrders: () => waiterRequest<{ branch_id:string; orders:any[] }>('/api/orders/pos/mine'),
  requestWaiterOrderClosure: (orderId:string, body:{ reason:string; comment?:string|null; inventory_treatment:'WRITE_OFF'|'NO_WRITE_OFF'|'RESTORE_STOCK' }) => waiterRequest<{ closure:any }>(`/api/orders/${orderId}/closure-requests`, { method:'POST', body: JSON.stringify({ type:'CANCELLATION', ...body }) }),
  requestOrderClosure: (orderId:string, body:{ type:'CANCELLATION'|'CLOSED_BY_ESTABLISHMENT'; reason:string; comment?:string|null; inventory_treatment:'WRITE_OFF'|'NO_WRITE_OFF'|'RESTORE_STOCK'; refund_requested?:boolean }) => request<{ closure:any }>(`/api/orders/${orderId}/closure-requests`, { method:'POST', body: JSON.stringify(body) }),
  getOrderClosures: (params?: { branch_id?:string; status?:string }) => { const q=new URLSearchParams(); if(params?.branch_id) q.set('branch_id',params.branch_id); if(params?.status) q.set('status',params.status); return request<{ branch_id:string; closures:any[] }>(`/api/orders/closure-requests?${q.toString()}`); },
  approveOrderClosure: (closureId:string, reason?:string) => request<{ closure:any; order:any }>(`/api/orders/closure-requests/${closureId}/approve`, { method:'POST', body: JSON.stringify({ reason }) }),
  rejectOrderClosure: (closureId:string, reason?:string) => request<{ closure:any; order:any }>(`/api/orders/closure-requests/${closureId}/reject`, { method:'POST', body: JSON.stringify({ reason }) }),

  // Stage 34.2 -- service charge configuration versions, ledger and pool distribution.
  getServiceCharge: (branchId:string) => request<{ config:any|null; categories:string[]; modes:string[]; strategies:string[] }>(`/api/service-charge/${branchId}`),
  getServiceChargeHistory: (branchId:string) => request<{ versions:any[] }>(`/api/service-charge/${branchId}/history`),
  publishServiceCharge: (branchId:string, body:any) => request<{ config:any }>(`/api/service-charge/${branchId}`, { method:'PUT', body: JSON.stringify(body) }),
  getServiceChargeLedger: (branchId:string) => request<{ ledger:any[]; totals:any[] }>(`/api/service-charge/${branchId}/ledger`),
  distributeServiceCharge: (branchId:string, from:string, to:string) => request<{ pools_processed:number; distributed:any[]; skipped:any[] }>(`/api/service-charge/${branchId}/distribute`, { method:'POST', body: JSON.stringify({ from, to }) }),

  // Stage 34.3 -- CRM customers and MANUAL, per-order discounts. There is no automatic discount:
  // attaching a customer never changes a price, and every amount below is computed by the server.
  // Stage 34.9: one identity, every surface -- orders, discounts, BOOMCARD, BOOMCOIN, BOOMBACK and
  // credit for one guest, each balance recomputed by the server from its own ledger.
  getCrmCustomer: (id:string) => request<{ customer:any; orders:any[]; discounts:any[]; boomcard:any; boomcoin:any; boomback:any; credit:any }>(`/api/customers/${id}`),
  getWaiterCustomerIdentity: (id:string) => waiterRequest<{ customer:any; orders:any[]; boomcard:any; boomcoin:any; boomback:any; credit:any }>(`/api/customers/pos/${id}`),
  searchWaiterCustomers: (search:string) => waiterRequest<{ branch_id:string; customers:any[] }>(`/api/customers/pos/search?search=${encodeURIComponent(search)}`),
  createWaiterCustomer: (body:{ name:string; phone?:string }) => waiterRequest<{ customer:any; existed:boolean }>('/api/customers/pos', { method:'POST', body: JSON.stringify(body) }),
  setOrderCustomer: (orderId:string, customerId:string|null) => request<{ order:any }>(`/api/orders/${orderId}/customer`, { method:'POST', body: JSON.stringify({ customer_id: customerId }) }),
  setWaiterOrderCustomer: (orderId:string, customerId:string|null) => waiterRequest<{ order:any }>(`/api/orders/${orderId}/customer`, { method:'POST', body: JSON.stringify({ customer_id: customerId }) }),
  getDiscountOptions: () => request<{ presets:string[]; max_percent:string }>('/api/orders/discount-options'),
  applyOrderDiscount: (orderId:string, body:{ percent?:string; amount?:string; reason?:string|null; bill_id?:string }) => request<{ discount:any; order:any }>(`/api/orders/${orderId}/discount`, { method:'POST', body: JSON.stringify(body) }),
  removeOrderDiscount: (orderId:string) => request<{ discount:any; order:any }>(`/api/orders/${orderId}/discount`, { method:'DELETE' }),
  getOrderDiscounts: (orderId:string) => request<{ order_id:string; discounts:any[] }>(`/api/orders/${orderId}/discounts`),

  // Stage 34.4 -- split bill / separate checks. The order stays the single sale; the bills are a
  // partition of it, and every amount below is the one the server computed.
  getOrderBills: (orderId:string) => request<{ order_id:string; split_mode:string; order_final_amount:string; bills:any[]; unassigned_items:any[] }>(`/api/orders/${orderId}/bills`),
  splitOrderBills: (orderId:string, mode:'ITEMS'|'EQUAL', count:number) => request<{ bills:any[] }>(`/api/orders/${orderId}/bills/split`, { method:'POST', body: JSON.stringify({ mode, count }) }),
  moveBillItem: (orderId:string, orderItemId:string, billId:string|null, quantity?:number) => request<{ bills:any[] }>(`/api/orders/${orderId}/bills/move-item`, { method:'POST', body: JSON.stringify({ order_item_id: orderItemId, bill_id: billId, quantity }) }),
  setBillCustomer: (orderId:string, billId:string, customerId:string|null) => request<{ bills:any[] }>(`/api/orders/${orderId}/bills/${billId}/customer`, { method:'POST', body: JSON.stringify({ customer_id: customerId }) }),
  voidBill: (orderId:string, billId:string) => request<{ bills:any[] }>(`/api/orders/${orderId}/bills/${billId}`, { method:'DELETE' }),
  mergeOrderBills: (orderId:string) => request<{ split_mode:string; bills:any[] }>(`/api/orders/${orderId}/bills/merge`, { method:'POST', body: '{}' }),
  // Stage 34.5 -- BOOMCOIN. Every number here is recomputed by the server from the authoritative
  // ledger; the counter is guidance and never grants anything.
  getBoomcoinCounter: (customerId:string) => request<any>(`/api/loyalty/boomcoin/customers/${customerId}`),
  getWaiterBoomcoinCounter: (customerId:string) => waiterRequest<any>(`/api/loyalty/boomcoin/customers/${customerId}`),
  getBoomcoinSettings: () => request<{ earning_enabled:boolean; counter_ui_enabled:boolean; spend_per_coin:string }>('/api/loyalty/boomcoin/settings'),
  getBoomcoinLedger: (params:{ branch_id?:string; customer_id?:string }) => { const q=new URLSearchParams(); if(params.branch_id) q.set('branch_id',params.branch_id); if(params.customer_id) q.set('customer_id',params.customer_id); return request<{ entries:any[]; totals:any[] }>(`/api/loyalty/boomcoin/ledger?${q.toString()}`); },
  // Stage 34.6 -- BOOMCARD lifecycle. Every transition below is a manager decision the server
  // records; the client never decides a status or a validity window on its own.
  getBoomcardSettings: () => request<{ automatic_lifecycle_enabled:boolean; monthly_spend_threshold:string; validity_days:number; breakfasts_per_period:number }>('/api/boomcard/settings'),
  getBoomcards: (params:{ branch_id?:string; status?:string }) => { const q=new URLSearchParams(); if(params.branch_id) q.set('branch_id',params.branch_id); if(params.status) q.set('status',params.status); return request<{ branch_id:string; cards:any[] }>(`/api/boomcard?${q.toString()}`); },
  getBoomcard: (id:string) => request<{ card:any; events:any[]; gifts:any[] }>(`/api/boomcard/${id}`),
  createBoomcard: (customerId:string, reason?:string) => request<{ card:any }>('/api/boomcard', { method:'POST', body: JSON.stringify({ customer_id: customerId, reason }) }),
  activateBoomcard: (id:string, body:any={}) => request<{ card:any }>(`/api/boomcard/${id}/activate`, { method:'POST', body: JSON.stringify(body) }),
  renewBoomcard: (id:string, body:any={}) => request<{ card:any }>(`/api/boomcard/${id}/renew`, { method:'POST', body: JSON.stringify(body) }),
  deactivateBoomcard: (id:string, reason?:string) => request<{ card:any }>(`/api/boomcard/${id}/deactivate`, { method:'POST', body: JSON.stringify({ reason }) }),
  grantBirthdayGift: (id:string, menuItemId:string, quantity:number, reason?:string) => request<{ gift:any }>(`/api/boomcard/${id}/birthday-gift`, { method:'POST', body: JSON.stringify({ menu_item_id: menuItemId, quantity, reason }) }),
  evaluateBoomcardLifecycle: (branchId:string, from:string, to:string) => request<any>('/api/boomcard/lifecycle/evaluate', { method:'POST', body: JSON.stringify({ branch_id: branchId, from, to }) }),
  updateCustomer: (id:string, body:{ name?:string; birth_date?:string|null }) => request<{ customer:any }>(`/api/customers/${id}`, { method:'PATCH', body: JSON.stringify(body) }),
  // Stage 34.7 -- BOOMBACK. Money the guest holds, not a discount; every amount is the server's.
  // Stage 34.8 -- complimentary items. A request only; the manager's approval is what creates the
  // zero-price order line, and the server decides everything about it.
  getComplimentReasons: () => request<{ reasons:string[] }>('/api/orders/compliment-reasons'),
  requestCompliment: (orderId:string, body:{ menu_item_id:string; quantity:number; reason:string; comment?:string|null; bill_id?:string }) => request<{ compliment:any }>(`/api/orders/${orderId}/compliments`, { method:'POST', body: JSON.stringify(body) }),
  requestWaiterCompliment: (orderId:string, body:{ menu_item_id:string; quantity:number; reason:string; comment?:string|null }) => waiterRequest<{ compliment:any }>(`/api/orders/${orderId}/compliments`, { method:'POST', body: JSON.stringify(body) }),
  getComplimentRequests: (params:{ branch_id?:string; status?:string; from?:string; to?:string }) => { const q=new URLSearchParams(); Object.entries(params).forEach(([k,v])=>{ if(v) q.set(k,String(v)); }); return request<{ compliments:any[]; totals:any[] }>(`/api/orders/compliment-requests?${q.toString()}`); },
  approveCompliment: (id:string, reason?:string) => request<{ compliment:any; order:any }>(`/api/orders/compliment-requests/${id}/approve`, { method:'POST', body: JSON.stringify({ reason }) }),
  rejectCompliment: (id:string, reason?:string) => request<{ compliment:any; order:any }>(`/api/orders/compliment-requests/${id}/reject`, { method:'POST', body: JSON.stringify({ reason }) }),
  getBoombackBalance: (customerId:string) => request<{ customer_id:string; balance:string; cached_balance:string }>(`/api/loyalty/boomback/customers/${customerId}`),
  getBoombackLedger: (params:{ branch_id?:string; customer_id?:string }) => { const q=new URLSearchParams(); if(params.branch_id) q.set('branch_id',params.branch_id); if(params.customer_id) q.set('customer_id',params.customer_id); return request<{ entries:any[]; totals:any[] }>(`/api/loyalty/boomback/ledger?${q.toString()}`); },
  adjustBoomback: (customerId:string, amount:string, reason:string) => request<{ entry:any }>('/api/loyalty/boomback/adjust', { method:'POST', body: JSON.stringify({ customer_id: customerId, amount, reason }) }),
  redeemBreakfast: (boomcardId:string, orderId:string, menuItemId:string, quantity:number) => request<{ order_item_id:string; card:any; order:any }>(`/api/boomcard/${boomcardId}/breakfast/redeem`, { method:'POST', body: JSON.stringify({ order_id: orderId, menu_item_id: menuItemId, quantity }) }),
  adjustBoomcoin: (customerId:string, coins:number, reason:string) => request<{ entry:any }>('/api/loyalty/boomcoin/adjust', { method:'POST', body: JSON.stringify({ customer_id: customerId, coins, reason }) }),
  getWaiterOrderBills: (orderId:string) => waiterRequest<{ order_id:string; split_mode:string; order_final_amount:string; bills:any[]; unassigned_items:any[] }>(`/api/orders/${orderId}/bills`),
  splitWaiterOrderBills: (orderId:string, mode:'ITEMS'|'EQUAL', count:number) => waiterRequest<{ bills:any[] }>(`/api/orders/${orderId}/bills/split`, { method:'POST', body: JSON.stringify({ mode, count }) }),
  moveWaiterBillItem: (orderId:string, orderItemId:string, billId:string|null, quantity?:number) => waiterRequest<{ bills:any[] }>(`/api/orders/${orderId}/bills/move-item`, { method:'POST', body: JSON.stringify({ order_item_id: orderItemId, bill_id: billId, quantity }) }),
  mergeWaiterOrderBills: (orderId:string) => waiterRequest<{ split_mode:string; bills:any[] }>(`/api/orders/${orderId}/bills/merge`, { method:'POST', body: '{}' }),

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
  // Stage 36: the one branding read every surface uses (public by design -- it is the brand a
  // guest already sees; it exposes no other setting).
  getPublicBranding: () => request<{ branding: { product_name:string; network_name:string; mark:string; logo_url:string; logo_dark_url:string; favicon_url:string } }>('/api/public/branding'),
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
