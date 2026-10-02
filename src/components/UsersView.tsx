import React, { useState, useEffect } from 'react';
import {
  Users,
  UserPlus,
  Search,
  Building2,
  Shield,
  Edit2,
  Trash2,
  CheckCircle2,
  XCircle,
  X,
  Lock,
  Phone,
  Mail,
  AlertCircle,
  UserCheck
} from 'lucide-react';
import { api } from '../api';
import { User, Branch, Role } from '../types';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { EmployeeStatusModal } from './EmployeeStatusModal';
import { errorText } from '../humanErrors';
import { ConfirmDialog, EmptyState, LoadingState, Notice, SearchInput, Toolbar } from './ui';

export const UsersView: React.FC = () => {
  const { user: currentUser, hasPermission, selectedBranchFilter } = useAuth();
  const { t, language } = useLanguage();
  const ru = language === 'ru';
  const [users, setUsers] = useState<User[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [roleFilter, setRoleFilter] = useState('');

  // Modals
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [deletingUser, setDeletingUser] = useState<User | null>(null);
  const [actionError, setActionError] = useState('');
  const [statusUser, setStatusUser] = useState<User | null>(null);
  const [branchAccessUser, setBranchAccessUser] = useState<User | null>(null);
  const [branchAccessData, setBranchAccessData] = useState<{
    primary_branch_id: string | null;
    allowed_branch_ids: string[];
    has_all_access: boolean;
  }>({ primary_branch_id: null, allowed_branch_ids: [], has_all_access: false });
  const [isSavingBranchAccess, setIsSavingBranchAccess] = useState(false);

  // Form State
  const [formData, setFormData] = useState({
    full_name: '',
    email: '',
    phone: '',
    password: '',
    branch_id: '',
    roles: [] as string[],
    allowed_branches: [] as string[],
    status: 'ACTIVE' as 'ACTIVE' | 'SUSPENDED' | 'INACTIVE'
  });
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const fetchAllData = async () => {
    try {
      setLoading(true);
      const [uRes, bRes, rRes] = await Promise.all([
        api.getUsers({
          branch_id: selectedBranchFilter !== 'ALL' ? selectedBranchFilter : undefined,
          search: searchTerm || undefined,
          status: statusFilter || undefined,
          role: roleFilter || undefined
        }),
        api.getBranches(),
        api.getRoles()
      ]);
      setUsers(uRes.users);
      setBranches(bRes.branches);
      setRoles(rRes.roles);
    } catch (err) {
      console.error('Failed to load users:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAllData();
  }, [selectedBranchFilter, searchTerm, statusFilter, roleFilter]);

  const openCreateModal = () => {
    setFormData({
      full_name: '',
      email: '',
      phone: '',
      password: '',
      branch_id: '',
      roles: [],
      allowed_branches: [],
      status: 'ACTIVE'
    });
    setFormError(null);
    setIsCreateModalOpen(true);
  };

  const openEditModal = (u: User) => {
    setEditingUser(u);
    setFormData({
      full_name: u.full_name,
      email: u.email,
      phone: u.phone,
      password: '',
      branch_id: u.branch_id || '',
      roles: u.roles.map(r => r.code),
      allowed_branches: u.branchAccess ? u.branchAccess.map(b => b.branch_id) : (u.branch_id ? [u.branch_id] : []),
      status: u.status
    });
    setFormError(null);
  };

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setIsSubmitting(true);
    try {
      await api.createUser(formData);
      setIsCreateModalOpen(false);
      fetchAllData();
    } catch (err: any) {
      setFormError(errorText(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUser) return;
    setFormError(null);
    setIsSubmitting(true);
    try {
      await api.updateUser(editingUser.id, formData);
      setEditingUser(null);
      fetchAllData();
    } catch (err: any) {
      setFormError(errorText(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!deletingUser) return;
    try {
      await api.deleteUser(deletingUser.id);
      setDeletingUser(null);
      fetchAllData();
    } catch (err: any) {
      setActionError(errorText(err));
    }
  };

  const toggleRoleSelection = (roleCode: string) => {
    setFormData(prev => {
      const exists = prev.roles.includes(roleCode);
      return {
        ...prev,
        roles: exists ? prev.roles.filter(r => r !== roleCode) : [...prev.roles, roleCode]
      };
    });
  };

  const toggleBranchSelection = (branchId: string) => {
    setFormData(prev => {
      const exists = prev.allowed_branches.includes(branchId);
      return {
        ...prev,
        allowed_branches: exists
          ? prev.allowed_branches.filter(b => b !== branchId)
          : [...prev.allowed_branches, branchId]
      };
    });
  };

  const openBranchAccessModal = async (u: User) => {
    setBranchAccessUser(u);
    try {
      const token = localStorage.getItem('boom_auth_token');
      const res = await fetch(`/api/users/${u.id}/branch-access`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setBranchAccessData({
          primary_branch_id: data.primary_branch_id,
          allowed_branch_ids: data.allowed_branch_ids || [],
          has_all_access: data.has_all_access || false
        });
      }
    } catch (err) {
      console.error('Failed to load user branch access', err);
    }
  };

  const handleSaveBranchAccess = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!branchAccessUser) return;
    setIsSavingBranchAccess(true);

    try {
      const token = localStorage.getItem('boom_auth_token');
      const res = await fetch(`/api/users/${branchAccessUser.id}/branch-access`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(branchAccessData)
      });

      if (res.ok) {
        setBranchAccessUser(null);
        fetchAllData();
      } else {
        const data = await res.json();
        setActionError(errorText(data));
      }
    } catch (err: any) {
      setActionError(errorText(err));
    } finally {
      setIsSavingBranchAccess(false);
    }
  };

  return (
    <div id="view-users" className="p-8 space-y-6 max-w-7xl mx-auto">
      {/* Stage 41: one page header for the whole system. The title and the one-line description now
          come from the shell header -- what stood here was a second title plus an English paragraph
          in a product whose interface is Russian and Turkmen. Search, filters and THE primary action
          sit in the same toolbar as on every other list screen. */}
      <Toolbar left={<>
        <SearchInput id="input-user-search" value={searchTerm} onChange={setSearchTerm}
          placeholder={ru ? 'Поиск по имени, почте или телефону…' : 'Ady, poçtasy ýa-da telefony boýunça gözleg…'} />
        <select
          id="select-user-role-filter"
          aria-label={ru ? 'Роль' : 'Rol'}
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value)}
          className="field w-auto"
        >
          <option value="">{t('ui.allRoles')}</option>
          {roles.map(r => (
            <option key={r.id} value={r.code}>{r.name} ({r.code})</option>
          ))}
        </select>
        <select
          id="select-user-status-filter"
          aria-label={ru ? 'Статус' : 'Ýagdaý'}
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="field w-auto"
        >
          <option value="">{t('ui.allStatuses')}</option>
          <option value="ACTIVE">{ru ? 'Работает' : 'Işleýär'}</option>
          <option value="SUSPENDED">{ru ? 'Приостановлен' : 'Wagtlaýyn togtadylan'}</option>
          <option value="INACTIVE">{ru ? 'Отключён' : 'Öçürilen'}</option>
        </select>
      </>}>
        {hasPermission('users.create') && (
          <button id="btn-create-user-modal" className="btn" onClick={openCreateModal}>
            <UserPlus className="w-4 h-4" />
            <span>{t('ui.addNewStaff')}</span>
          </button>
        )}
      </Toolbar>

      {/* Users Data Table */}
      <div className="bg-slate-900/70 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-800 text-slate-400 uppercase font-bold text-[10px] tracking-wider bg-slate-950/40">
                <th className="py-3 px-4">{t('ui.employee')}</th>
                <th className="py-3 px-4">{t('ui.contact')}</th>
                <th className="py-3 px-4">{t('ui.primaryBranch')}</th>
                <th className="py-3 px-4">{t('ui.assignedRoles')}</th>
                <th className="py-3 px-4">{t('ui.branchAccess')}</th>
                <th className="py-3 px-4">{t('common.status')}</th>
                <th className="py-3 px-4 text-right">{t('ui.actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 font-medium">
              {loading ? (
                <tr>
                  <td colSpan={7}><LoadingState/></td>
                </tr>
              ) : users.length === 0 ? (
                <tr>
                  <td colSpan={7}><EmptyState title={ru ? 'Сотрудники не найдены.' : 'Işgär tapylmady.'} hint={ru ? 'Измените поиск или фильтры, либо добавьте сотрудника.' : 'Gözlegi ýa-da süzgüçleri üýtgediň, ýa-da işgär goşuň.'}/></td>
                </tr>
              ) : (
                users.map((u) => (
                  <tr key={u.id} className="hover:bg-slate-800/40 transition-colors">
                    {/* Employee */}
                    <td className="py-3.5 px-4">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center font-bold text-slate-300 text-xs flex-shrink-0 overflow-hidden">
                          {u.avatar_url ? (
                            <img src={u.avatar_url} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                          ) : (
                            u.full_name.slice(0, 2).toUpperCase()
                          )}
                        </div>
                        <div>
                          <div className="font-bold text-slate-200">{u.full_name}</div>
                          <div className="text-[10px] text-slate-500 font-mono">ID: {u.id}</div>
                        </div>
                      </div>
                    </td>

                    {/* Contact */}
                    <td className="py-3.5 px-4 text-slate-300">
                      <div className="flex items-center gap-1.5">
                        <Mail className="w-3 h-3 text-slate-500" />
                        <span>{u.email}</span>
                      </div>
                      <div className="flex items-center gap-1.5 text-slate-400 text-[11px] mt-0.5">
                        <Phone className="w-3 h-3 text-slate-500" />
                        <span>{u.phone}</span>
                      </div>
                    </td>

                    {/* Primary Branch */}
                    <td className="py-3.5 px-4 text-slate-300">
                      {u.branch_name ? (
                        <div className="flex items-center gap-1.5">
                          <Building2 className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />
                          <div>
                            <span className="font-semibold block">{u.branch_name}</span>
                            <span className="text-[10px] text-slate-500 font-mono">{u.branch_code}</span>
                          </div>
                        </div>
                      ) : (
                        <span className="text-slate-500 italic">HQ / Central</span>
                      )}
                    </td>

                    {/* Assigned Roles */}
                    <td className="py-3.5 px-4">
                      <div className="flex flex-wrap gap-1">
                        {u.roles.map(r => (
                          <span
                            key={r.id}
                            className="px-2 py-0.5 rounded font-mono text-[10px] font-bold bg-purple-500/15 text-purple-300 border border-purple-500/25"
                          >
                            {r.code}
                          </span>
                        ))}
                      </div>
                    </td>

                    {/* Branch Access */}
                    <td className="py-3.5 px-4">
                      <div className="text-[11px]">
                        {u.roles.some(r => r.code === 'OWNER' || r.code === 'SUPER_ADMIN') ? (
                          <span className="px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 font-semibold border border-emerald-500/20">
                            Universal (All Branches)
                          </span>
                        ) : u.branchAccess && u.branchAccess.length > 0 ? (
                          <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700 font-mono">
                            {u.branchAccess.length} branch(es)
                          </span>
                        ) : (
                          <span className="text-slate-500 italic">{t('ui.noneAssigned')}</span>
                        )}
                      </div>
                    </td>

                    {/* Status */}
                    <td className="py-3.5 px-4">
                      <div className="flex flex-col gap-1">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded font-mono text-[10px] font-bold ${
                          (u.employment_status || u.status) === 'ACTIVE'
                            ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                            : (u.employment_status || u.status) === 'TERMINATED'
                            ? 'bg-rose-500/15 text-rose-400 border border-rose-500/30'
                            : (u.employment_status || u.status) === 'INTERN'
                            ? 'bg-blue-500/15 text-blue-400 border border-blue-500/30'
                            : 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
                        }`}>
                          {u.employment_status || u.status}
                        </span>
                        {u.disciplinary_status && u.disciplinary_status !== 'NONE' && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded font-mono text-[9px] font-bold bg-orange-500/15 text-orange-400 border border-orange-500/25">
                            {u.disciplinary_status}
                          </span>
                        )}
                      </div>
                    </td>

                    {/* Actions */}
                    <td className="py-3.5 px-4 text-right">
                      <div className="flex items-center justify-end gap-1">
                        {hasPermission('users.update') && (
                          <button
                            id={`btn-user-status-${u.id}`}
                            onClick={() => setStatusUser(u)}
                            className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-emerald-400 transition-colors"
                            title={t('employment.changeStatus')}
                          >
                            <UserCheck className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {hasPermission('users.update') && (
                          <button
                            id={`btn-user-branch-access-${u.id}`}
                            onClick={() => openBranchAccessModal(u)}
                            className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-blue-400 transition-colors"
                            title="Manage Branch Assignment"
                          >
                            <Building2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {hasPermission('users.update') && (
                          <button
                            onClick={() => openEditModal(u)}
                            className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-amber-400 transition-colors"
                            title="Edit User"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {hasPermission('users.delete') && u.id !== currentUser?.id && (
                          <button
                            onClick={() => setDeletingUser(u)}
                            className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-rose-400 transition-colors"
                            title="Deactivate / Archive User"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create / Edit Modal */}
      {(isCreateModalOpen || editingUser) && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-in fade-in duration-150">
          <div className="w-full max-w-xl bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">
            <div className="p-5 border-b border-slate-800 flex items-center justify-between">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                {isCreateModalOpen ? <UserPlus className="w-4 h-4 text-amber-400" /> : <Edit2 className="w-4 h-4 text-amber-400" />}
                <span>{isCreateModalOpen ? 'Register New Staff Member' : `Edit User: ${editingUser?.full_name}`}</span>
              </h3>
              <button
                onClick={() => { setIsCreateModalOpen(false); setEditingUser(null); }}
                className="boom-modal-close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={isCreateModalOpen ? handleCreateSubmit : handleEditSubmit} className="p-6 space-y-4 overflow-y-auto">
              {formError && (
                <Notice kind="error">{formError}</Notice>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">Full Name *</label>
                  <input
                    type="text"
                    required
                    value={formData.full_name}
                    onChange={(e) => setFormData({ ...formData, full_name: e.target.value })}
                    placeholder="e.g. Ivan Smirnov"
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-amber-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">Email Address *</label>
                  <input
                    type="email"
                    required
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    placeholder="employee@boomburger.ru"
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-amber-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">Phone Number *</label>
                  <input
                    type="text"
                    required
                    value={formData.phone}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                    placeholder="+79991234567"
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-amber-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    {isCreateModalOpen ? 'Password *' : 'New Password (Optional)'}
                  </label>
                  <input
                    type="password"
                    required={isCreateModalOpen}
                    value={formData.password}
                    onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                    placeholder={isCreateModalOpen ? 'Min. 6 characters' : 'Leave empty to keep unchanged'}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-amber-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">Primary Assigned Branch</label>
                  <select
                    value={formData.branch_id}
                    onChange={(e) => setFormData({ ...formData, branch_id: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-amber-500"
                  >
                    <option value="">HQ / Central Office</option>
                    {branches.map(b => (
                      <option key={b.id} value={b.id}>{b.name} ({b.code})</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">Account Status</label>
                  <select
                    value={formData.status}
                    onChange={(e) => setFormData({ ...formData, status: e.target.value as any })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-amber-500"
                  >
                    <option value="ACTIVE">ACTIVE</option>
                    <option value="SUSPENDED">SUSPENDED</option>
                    <option value="INACTIVE">INACTIVE</option>
                  </select>
                </div>
              </div>

              {/* Roles Assignment Multi-Selection */}
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Assign Roles (One or multiple)
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 p-3 bg-slate-950 rounded-xl border border-slate-800 max-h-36 overflow-y-auto">
                  {roles.map(r => {
                    const isSelected = formData.roles.includes(r.code);
                    return (
                      <label
                        key={r.id}
                        className={`flex items-center gap-2 p-1.5 rounded-lg text-xs cursor-pointer select-none transition-colors ${
                          isSelected ? 'bg-amber-500/15 text-amber-300 font-semibold' : 'text-slate-300 hover:bg-slate-800'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleRoleSelection(r.code)}
                          className="rounded border-slate-700 text-amber-500 focus:ring-0"
                        />
                        <span className="truncate">{r.code}</span>
                      </label>
                    );
                  })}
                </div>
              </div>

              {/* Multi-Branch Authority Access */}
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Multi-Branch Authority Access (Branches this staff member can work with)
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 p-3 bg-slate-950 rounded-xl border border-slate-800 max-h-36 overflow-y-auto">
                  {branches.map(b => {
                    const isSelected = formData.allowed_branches.includes(b.id);
                    return (
                      <label
                        key={b.id}
                        className={`flex items-center gap-2 p-1.5 rounded-lg text-xs cursor-pointer select-none transition-colors ${
                          isSelected ? 'bg-emerald-500/15 text-emerald-300 font-semibold' : 'text-slate-300 hover:bg-slate-800'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleBranchSelection(b.id)}
                          className="rounded border-slate-700 text-emerald-500 focus:ring-0"
                        />
                        <span className="truncate">{b.name} ({b.code})</span>
                      </label>
                    );
                  })}
                </div>
              </div>

              <div className="pt-4 border-t border-slate-800 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => { setIsCreateModalOpen(false); setEditingUser(null); }}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-400 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="btn btn-sm"
                >
                  {isSubmitting ? 'Saving...' : isCreateModalOpen ? 'Create Account' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Branch Access Assignment Modal */}
      {branchAccessUser && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-in fade-in duration-150">
          <div className="w-full max-w-lg bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <Building2 className="w-5 h-5 text-amber-400" />
                <div>
                  <h3 className="text-base font-bold text-white">Branch Assignment & Multi-Access</h3>
                  <p className="text-xs text-slate-400">
                    Employee: <strong>{branchAccessUser.full_name}</strong> ({branchAccessUser.email})
                  </p>
                </div>
              </div>
              <button
                onClick={() => setBranchAccessUser(null)}
                className="boom-modal-close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveBranchAccess} className="space-y-4 text-xs">
              {/* Primary Branch Selection */}
              <div>
                <label className="block font-semibold text-slate-300 mb-1">
                  Primary Home Branch *
                </label>
                <select
                  id="select-primary-branch"
                  value={branchAccessData.primary_branch_id || ''}
                  onChange={(e) => {
                    const bId = e.target.value || null;
                    setBranchAccessData(prev => ({
                      ...prev,
                      primary_branch_id: bId,
                      // Automatically ensure primary branch is included in allowed branches if not already
                      allowed_branch_ids: bId && !prev.allowed_branch_ids.includes(bId)
                        ? [...prev.allowed_branch_ids, bId]
                        : prev.allowed_branch_ids
                    }));
                  }}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-slate-200 focus:outline-none focus:border-amber-500/50"
                >
                  <option value="">-- None (HQ / Global Roaming Staff) --</option>
                  {branches.map(b => (
                    <option key={b.id} value={b.id}>
                      [{b.code}] {b.name} {b.franchise_name ? `(${b.franchise_name})` : ''}
                    </option>
                  ))}
                </select>
                <p className="text-[11px] text-slate-500 mt-1">
                  The primary branch determines where the employee is based, clocked in, and registered for daily operations.
                </p>
              </div>

              {/* All Branches Toggle */}
              <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 flex items-center justify-between">
                <div>
                  <span className="font-semibold text-slate-200 block">Grant Universal Access to All Branches</span>
                  <span className="text-[11px] text-slate-400 block">
                    Allows operating across all current and future branch locations in the network.
                  </span>
                </div>
                <input
                  type="checkbox"
                  id="toggle-all-branches-access"
                  checked={branchAccessData.has_all_access}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    setBranchAccessData(prev => ({
                      ...prev,
                      has_all_access: checked,
                      allowed_branch_ids: checked ? branches.map(b => b.id) : prev.allowed_branch_ids
                    }));
                  }}
                  className="w-4 h-4 rounded bg-slate-900 border-slate-700 text-amber-500 focus:ring-0"
                />
              </div>

              {/* Specific Allowed Branches */}
              {!branchAccessData.has_all_access && (
                <div>
                  <label className="block font-semibold text-slate-300 mb-1">
                    Allowed Working Branches
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 p-3 bg-slate-950 rounded-xl border border-slate-800 max-h-48 overflow-y-auto">
                    {branches.map(b => {
                      const isChecked = branchAccessData.allowed_branch_ids.includes(b.id);
                      return (
                        <label
                          key={b.id}
                          className={`flex items-center gap-2 p-2 rounded-lg text-xs cursor-pointer select-none transition-colors ${
                            isChecked ? 'bg-blue-500/15 text-blue-300 font-semibold border border-blue-500/30' : 'text-slate-300 hover:bg-slate-800'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => {
                              setBranchAccessData(prev => {
                                const exists = prev.allowed_branch_ids.includes(b.id);
                                return {
                                  ...prev,
                                  allowed_branch_ids: exists
                                    ? prev.allowed_branch_ids.filter(id => id !== b.id)
                                    : [...prev.allowed_branch_ids, b.id]
                                };
                              });
                            }}
                            className="rounded border-slate-700 text-blue-500 focus:ring-0"
                          />
                          <div className="truncate">
                            <span className="font-bold">[{b.code}]</span> {b.name}
                            {b.franchise_name && (
                              <span className="text-[10px] text-slate-500 block truncate">{b.franchise_name}</span>
                            )}
                          </div>
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setBranchAccessUser(null)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-400 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  id="btn-save-branch-access"
                  disabled={isSavingBranchAccess}
                  className="btn btn-sm"
                >
                  {isSavingBranchAccess ? 'Saving...' : 'Save Branch Assignment'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Stage 41: the same confirmation shell as every other irreversible action. The wording keeps
          the reassurance it already had -- history is preserved -- but drops the internal vocabulary
          ("Safe Soft Delete", the TERMINATED status name) that meant nothing to the person reading it.
          The action itself is unchanged: the server still performs its own archiving. */}
      <ConfirmDialog
        open={Boolean(deletingUser)}
        title={ru ? 'Закрыть доступ сотруднику?' : 'Işgäriň elýeterliligini ýapmalymy?'}
        description={deletingUser
          ? (ru
            ? `${deletingUser.full_name} (${deletingUser.email}) больше не сможет войти в систему. Заказы, платежи и история действий сотрудника сохраняются полностью.`
            : `${deletingUser.full_name} (${deletingUser.email}) mundan beýläk ulgama girip bilmez. Işgäriň sargytlary, tölegleri we hereket taryhy doly saklanýar.`)
          : undefined}
        confirmLabel={ru ? 'Закрыть доступ' : 'Elýeterliligi ýap'}
        onCancel={() => { setDeletingUser(null); setActionError(''); }}
        onConfirm={() => { void handleDelete(); }}
      />
      {actionError && <div className="fixed bottom-6 right-6 z-50 max-w-sm"><Notice kind="error">{actionError}</Notice></div>}

      {/* Employee Status & History Modal */}
      <EmployeeStatusModal
        user={statusUser}
        isOpen={Boolean(statusUser)}
        onClose={() => setStatusUser(null)}
        onStatusUpdated={fetchAllData}
      />
    </div>
  );
};
