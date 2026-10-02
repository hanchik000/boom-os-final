import React, { useState, useEffect } from 'react';
import {
  ShieldCheck,
  ShieldAlert,
  Plus,
  Key,
  Edit2,
  Trash2,
  Check,
  X,
  Lock,
  Users,
  AlertCircle,
  HelpCircle
} from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';
import { api } from '../api';
import { Role, Permission } from '../types';
import { useAuth } from '../context/AuthContext';
import { errorText } from '../humanErrors';
import { ConfirmDialog, LoadingState, Notice, Toolbar } from './ui';

export const RolesView: React.FC = () => {
  const { t, language } = useLanguage();
  const ru = language === 'ru';
  const { user: currentUser, hasPermission } = useAuth();
  const [roles, setRoles] = useState<Role[]>([]);
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [groupedPerms, setGroupedPerms] = useState<Record<string, Permission[]>>({});
  const [loading, setLoading] = useState(true);

  // Modals
  const [isCreateRoleOpen, setIsCreateRoleOpen] = useState(false);
  const [isCreatePermOpen, setIsCreatePermOpen] = useState(false);
  const [editingRole, setEditingRole] = useState<Role | null>(null);
  const [deletingRole, setDeletingRole] = useState<Role | null>(null);
  const [deleteError, setDeleteError] = useState('');

  // Role Form
  const [roleForm, setRoleForm] = useState({
    code: '',
    name: '',
    description: '',
    status: 'ACTIVE' as 'ACTIVE' | 'INACTIVE',
    permission_ids: [] as string[]
  });

  // Permission Form
  const [permForm, setPermForm] = useState({
    code: '',
    name: '',
    module: 'system',
    description: ''
  });

  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const fetchRolesAndPermissions = async () => {
    try {
      setLoading(true);
      const [rRes, pRes] = await Promise.all([
        api.getRoles(),
        api.getPermissions()
      ]);
      setRoles(rRes.roles);
      setPermissions(pRes.permissions);
      setGroupedPerms(pRes.grouped);
    } catch (err) {
      console.error('Failed to load roles/permissions:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRolesAndPermissions();
  }, []);

  const openCreateRoleModal = () => {
    setRoleForm({
      code: '',
      name: '',
      description: '',
      status: 'ACTIVE',
      permission_ids: ['users.view', 'branches.view']
    });
    setFormError(null);
    setIsCreateRoleOpen(true);
  };

  const openEditRoleModal = (r: Role) => {
    setEditingRole(r);
    setRoleForm({
      code: r.code,
      name: r.name,
      description: r.description || '',
      status: r.status,
      permission_ids: r.permissions ? r.permissions.map(p => p.id) : []
    });
    setFormError(null);
  };

  const handleRoleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setIsSubmitting(true);
    try {
      if (editingRole) {
        await api.updateRole(editingRole.id, roleForm);
        setEditingRole(null);
      } else {
        await api.createRole(roleForm);
        setIsCreateRoleOpen(false);
      }
      fetchRolesAndPermissions();
    } catch (err: any) {
      setFormError(errorText(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handlePermSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setIsSubmitting(true);
    try {
      await api.createPermission(permForm);
      setIsCreatePermOpen(false);
      fetchRolesAndPermissions();
    } catch (err: any) {
      setFormError(errorText(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteRole = async () => {
    if (!deletingRole) return;
    try {
      await api.deleteRole(deletingRole.id);
      setDeletingRole(null);
      fetchRolesAndPermissions();
    } catch (err: any) {
      setDeleteError(errorText(err));
    }
  };

  const togglePerm = (permId: string) => {
    setRoleForm(prev => {
      const exists = prev.permission_ids.includes(permId);
      return {
        ...prev,
        permission_ids: exists
          ? prev.permission_ids.filter(id => id !== permId)
          : [...prev.permission_ids, permId]
      };
    });
  };

  const toggleModulePerms = (modulePerms: Permission[]) => {
    const allSelected = modulePerms.every(p => roleForm.permission_ids.includes(p.id));
    setRoleForm(prev => {
      if (allSelected) {
        const idsToRemove = new Set(modulePerms.map(p => p.id));
        return {
          ...prev,
          permission_ids: prev.permission_ids.filter(id => !idsToRemove.has(id))
        };
      } else {
        const currentSet = new Set(prev.permission_ids);
        modulePerms.forEach(p => currentSet.add(p.id));
        return {
          ...prev,
          permission_ids: Array.from(currentSet)
        };
      }
    });
  };

  return (
    <div id="view-roles" className="p-8 space-y-6 max-w-7xl mx-auto">
      {/* Stage 41: one page header, in the shell. The secondary action (a new permission) and the
          primary one (a new role) now use the shared button hierarchy instead of two hand-built
          styles that happened to look different on every other screen. */}
      <Toolbar>
        {hasPermission('permissions.create') && (
          <button
            id="btn-create-permission-modal"
            className="btn-secondary"
            onClick={() => {
              setPermForm({ code: '', name: '', module: 'system', description: '' });
              setFormError(null);
              setIsCreatePermOpen(true);
            }}
          >
            <Key className="w-3.5 h-3.5 text-amber-400" />
            <span>{t('ui.newPermission')}</span>
          </button>
        )}
        {hasPermission('roles.create') && (
          <button id="btn-create-role-modal" className="btn" onClick={openCreateRoleModal}>
            <Plus className="w-4 h-4" />
            <span>{t('ui.createRole')}</span>
          </button>
        )}
      </Toolbar>

      {/* Roles Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {loading ? (
          <div className="col-span-full"><LoadingState/></div>
        ) : (
          roles.map((r) => {
            const isUserOwnRole = currentUser?.roleCodes?.includes(r.code);
            return (
              <div
                key={r.id}
                className="p-5 rounded-2xl bg-slate-900/70 border border-slate-800 hover:border-slate-700/80 transition-all flex flex-col justify-between space-y-4"
              >
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-extrabold text-sm text-white">{r.name}</span>
                        {r.is_system === 1 ? (
                          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20 uppercase">
                            System
                          </span>
                        ) : (
                          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-400 border border-purple-500/20 uppercase">
                            Custom
                          </span>
                        )}
                      </div>
                      <div className="font-mono text-xs font-bold text-amber-400 mt-0.5">{r.code}</div>
                    </div>

                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                      r.status === 'ACTIVE'
                        ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/25'
                        : 'bg-slate-800 text-slate-400'
                    }`}>
                      {r.status}
                    </span>
                  </div>

                  <p className="text-xs text-slate-400 mt-2 line-clamp-2 min-h-[32px]">
                    {r.description || 'No description provided.'}
                  </p>

                  <div className="flex items-center gap-4 mt-4 pt-3 border-t border-slate-800/80 text-xs text-slate-400">
                    <div className="flex items-center gap-1.5">
                      <Key className="w-3.5 h-3.5 text-amber-400" />
                      <span>{r.permissions?.length || 0} permissions</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Users className="w-3.5 h-3.5 text-blue-400" />
                      <span>{r.user_count || 0} users</span>
                    </div>
                  </div>
                </div>

                <div className="pt-2 flex items-center justify-between border-t border-slate-800/60">
                  <span className="text-[10px] text-slate-500 font-mono">
                    Updated: {new Date(r.updated_at).toLocaleDateString()}
                  </span>

                  <div className="flex items-center gap-1">
                    {hasPermission('roles.update') && (
                      <button
                        onClick={() => openEditRoleModal(r)}
                        disabled={!currentUser?.isSuperUser && isUserOwnRole}
                        title={
                          !currentUser?.isSuperUser && isUserOwnRole
                            ? 'Cannot modify permissions of your own role'
                            : 'Edit Role & Permissions'
                        }
                        className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-amber-400 disabled:opacity-30 disabled:hover:text-slate-400 transition-colors"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                    )}

                    {hasPermission('roles.delete') && r.is_system !== 1 && (
                      <button
                        onClick={() => setDeletingRole(r)}
                        className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-rose-400 transition-colors"
                        title={t('ui.deleteRole')}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Create / Edit Role Modal */}
      {(isCreateRoleOpen || editingRole) && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-in fade-in duration-150">
          <div className="w-full max-w-2xl bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden max-h-[92vh] flex flex-col">
            <div className="p-5 border-b border-slate-800 flex items-center justify-between">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-amber-400" />
                <span>{isCreateRoleOpen ? 'Create New Security Role' : `Edit Role: ${editingRole?.name} (${editingRole?.code})`}</span>
              </h3>
              <button
                onClick={() => { setIsCreateRoleOpen(false); setEditingRole(null); }}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleRoleSubmit} className="p-6 space-y-4 overflow-y-auto">
              {formError && (
                <Notice kind="error">{formError}</Notice>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">Role Code (Uppercase Identifier) *</label>
                  <input
                    type="text"
                    required
                    disabled={Boolean(editingRole)}
                    value={roleForm.code}
                    onChange={(e) => setRoleForm({ ...roleForm, code: e.target.value.toUpperCase() })}
                    placeholder="e.g. QUALITY_AUDITOR"
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-amber-500 disabled:opacity-50"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">Display Name *</label>
                  <input
                    type="text"
                    required
                    value={roleForm.name}
                    onChange={(e) => setRoleForm({ ...roleForm, name: e.target.value })}
                    placeholder="e.g. Quality Auditor"
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-amber-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Description</label>
                <textarea
                  rows={2}
                  value={roleForm.description}
                  onChange={(e) => setRoleForm({ ...roleForm, description: e.target.value })}
                  placeholder="Explain duties, responsibilities, and access boundaries of this role..."
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-amber-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-2 flex items-center justify-between">
                  <span>Granted Permissions Matrix</span>
                  <span className="text-amber-400 font-mono text-[11px]">
                    {roleForm.permission_ids.length} selected
                  </span>
                </label>

                <div className="space-y-3 max-h-64 overflow-y-auto pr-1">
                  {(Object.entries(groupedPerms) as [string, Permission[]][]).map(([moduleName, perms]) => {
                    const allChecked = perms.every(p => roleForm.permission_ids.includes(p.id));
                    return (
                      <div key={moduleName} className="p-3 bg-slate-950 rounded-xl border border-slate-800/80">
                        <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-800/60">
                          <span className="text-xs font-bold text-slate-200 uppercase tracking-wider">
                            Module: {moduleName}
                          </span>
                          <button
                            type="button"
                            onClick={() => toggleModulePerms(perms)}
                            className="text-[10px] font-semibold text-amber-400 hover:underline"
                          >
                            {allChecked ? 'Deselect All' : 'Select All'}
                          </button>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          {perms.map(p => {
                            const isChecked = roleForm.permission_ids.includes(p.id);
                            return (
                              <label
                                key={p.id}
                                className={`flex items-start gap-2 p-2 rounded-lg text-xs cursor-pointer select-none transition-colors ${
                                  isChecked ? 'bg-amber-500/15 text-amber-200' : 'text-slate-400 hover:bg-slate-900'
                                }`}
                              >
                                <input
                                  type="checkbox"
                                  checked={isChecked}
                                  onChange={() => togglePerm(p.id)}
                                  className="mt-0.5 rounded border-slate-700 text-amber-500 focus:ring-0"
                                />
                                <div className="min-w-0">
                                  <div className="font-semibold text-slate-200">{p.name}</div>
                                  <div className="text-[10px] font-mono text-slate-500">{p.code}</div>
                                </div>
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="pt-4 border-t border-slate-800 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => { setIsCreateRoleOpen(false); setEditingRole(null); }}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-400 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="btn btn-sm"
                >
                  {isSubmitting ? 'Saving...' : isCreateRoleOpen ? 'Create Role' : 'Save Permissions'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Create Permission Modal */}
      {isCreatePermOpen && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-in fade-in duration-150">
          <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Key className="w-4 h-4 text-amber-400" />
                <span>{t('ui.registerPermission')}</span>
              </h3>
              <button onClick={() => setIsCreatePermOpen(false)} className="boom-modal-close">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handlePermSubmit} className="space-y-4">
              {formError && (
                <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs">
                  {formError}
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Permission Code *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. reports.export"
                  value={permForm.code}
                  onChange={(e) => setPermForm({ ...permForm, code: e.target.value.toLowerCase() })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-amber-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Permission Name *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Export Reports"
                  value={permForm.name}
                  onChange={(e) => setPermForm({ ...permForm, name: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-amber-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Target Module *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. reports"
                  value={permForm.module}
                  onChange={(e) => setPermForm({ ...permForm, module: e.target.value.toLowerCase() })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-amber-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Description</label>
                <textarea
                  rows={2}
                  placeholder="Describe what access this permission enables..."
                  value={permForm.description}
                  onChange={(e) => setPermForm({ ...permForm, description: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-amber-500"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setIsCreatePermOpen(false)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-400 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="btn btn-sm"
                >
                  Register Permission
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation */}
      {/* Stage 41: one confirmation pattern for every irreversible action, in both languages. */}
      <ConfirmDialog
        open={Boolean(deletingRole)}
        title={ru ? 'Удалить роль?' : 'Roly pozmaly?'}
        description={deletingRole
          ? (ru
            ? `Роль «${deletingRole.name}» (${deletingRole.code}) будет удалена. Сотрудники с этой ролью потеряют её права — назначьте им другую роль заранее.`
            : `«${deletingRole.name}» (${deletingRole.code}) roly pozular. Bu rolly işgärler onuň hukuklaryny ýitirer — olara öňünden başga rol beriň.`)
          : undefined}
        confirmLabel={ru ? 'Удалить' : 'Poz'}
        onCancel={() => { setDeletingRole(null); setDeleteError(''); }}
        onConfirm={() => { void handleDeleteRole(); }}
      />
      {deleteError && <div className="fixed bottom-6 right-6 z-50 max-w-sm"><Notice kind="error">{deleteError}</Notice></div>}
    </div>
  );
};
