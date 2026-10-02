import React, { useState, useEffect } from 'react';
import {
  Building,
  Plus,
  Search,
  ExternalLink,
  Edit2,
  Users,
  MapPin,
  Phone,
  Mail,
  CheckCircle2,
  XCircle,
  Link,
  Unlink,
  Layers,
  ArrowRight,
  ShieldAlert,
  AlertTriangle,
  FileText
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { Franchise, Branch } from '../types';
import { errorText } from '../humanErrors';
import { EmptyState, LoadingState } from './ui';

export const FranchisesView: React.FC = () => {
  const { hasPermission, token } = useAuth();
  // Stage 41: this screen spoke English only, in a product whose interface is Russian and Turkmen.
  const { language } = useLanguage();
  const ru = language === 'ru';
  const [franchises, setFranchises] = useState<Franchise[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'ACTIVE' | 'INACTIVE'>('ALL');

  // Selected franchise for deep hierarchy inspection
  const [selectedFranchise, setSelectedFranchise] = useState<Franchise | null>(null);
  const [franchiseBranches, setFranchiseBranches] = useState<Branch[]>([]);
  const [franchiseEmployees, setFranchiseEmployees] = useState<any[]>([]);
  const [activeSubTab, setActiveSubTab] = useState<'branches' | 'employees' | 'details'>('branches');
  const [isSubLoading, setIsSubLoading] = useState(false);

  // Unlinked branches for assignment
  const [allBranches, setAllBranches] = useState<Branch[]>([]);
  const [selectedBranchToAssign, setSelectedBranchToAssign] = useState<string>('');

  // Modals
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingFranchise, setEditingFranchise] = useState<Franchise | null>(null);

  // Form states
  const [formData, setFormData] = useState({
    name: '',
    code: '',
    legal_name: '',
    contact_name: '',
    phone: '',
    email: '',
    address: '',
    status: 'ACTIVE' as 'ACTIVE' | 'INACTIVE'
  });
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [actionSuccessMessage, setActionSuccessMessage] = useState<string | null>(null);

  const fetchFranchises = async () => {
    setIsLoading(true);
    try {
      let url = '/api/franchises?';
      if (statusFilter !== 'ALL') url += `status=${statusFilter}&`;
      if (search.trim()) url += `search=${encodeURIComponent(search.trim())}`;

      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setFranchises(data.franchises || []);
      }
    } catch (err) {
      console.error('Failed to load franchises', err);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchAllBranches = async () => {
    try {
      const res = await fetch('/api/branches', {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setAllBranches(data.branches || []);
      }
    } catch (err) {
      console.error('Failed to load branches', err);
    }
  };

  useEffect(() => {
    fetchFranchises();
    fetchAllBranches();
  }, [search, statusFilter, token]);

  const loadFranchiseDetails = async (franchise: Franchise) => {
    setSelectedFranchise(franchise);
    setIsSubLoading(true);
    try {
      const [branchesRes, employeesRes] = await Promise.all([
        fetch(`/api/franchises/${franchise.id}/branches`, { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`/api/franchises/${franchise.id}/employees`, { headers: { Authorization: `Bearer ${token}` } })
      ]);

      if (branchesRes.ok) {
        const bData = await branchesRes.json();
        setFranchiseBranches(bData.branches || []);
      }
      if (employeesRes.ok) {
        const eData = await employeesRes.json();
        setFranchiseEmployees(eData.employees || []);
      }
    } catch (err) {
      console.error('Failed to load franchise details', err);
    } finally {
      setIsSubLoading(false);
    }
  };

  const handleOpenCreate = () => {
    setFormData({
      name: '',
      code: '',
      legal_name: '',
      contact_name: '',
      phone: '',
      email: '',
      address: '',
      status: 'ACTIVE'
    });
    setFormError(null);
    setIsCreateModalOpen(true);
  };

  const handleOpenEdit = (f: Franchise) => {
    setEditingFranchise(f);
    setFormData({
      name: f.name,
      code: f.code,
      legal_name: f.legal_name,
      contact_name: f.contact_name,
      phone: f.phone,
      email: f.email,
      address: f.address,
      status: f.status
    });
    setFormError(null);
    setIsEditModalOpen(true);
  };

  const handleSaveFranchise = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setIsSubmitting(true);

    const isEdit = Boolean(editingFranchise);
    const url = isEdit ? `/api/franchises/${editingFranchise!.id}` : '/api/franchises';
    const method = isEdit ? 'PUT' : 'POST';

    try {
      const res = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(formData)
      });

      const data = await res.json();
      if (!res.ok) {
        setFormError(errorText(data));
        setIsSubmitting(false);
        return;
      }

      setIsCreateModalOpen(false);
      setIsEditModalOpen(false);
      setEditingFranchise(null);
      setActionSuccessMessage(isEdit ? (ru ? 'Франшиза сохранена.' : 'Franşiza ýatda saklandy.') : (ru ? 'Франшиза добавлена.' : 'Franşiza goşuldy.'));
      setTimeout(() => setActionSuccessMessage(null), 4000);
      fetchFranchises();
      if (selectedFranchise && selectedFranchise.id === data.franchise?.id) {
        setSelectedFranchise(data.franchise);
      }
    } catch (err: any) {
      setFormError(errorText(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleToggleStatus = async (f: Franchise) => {
    const nextStatus = f.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
    try {
      const res = await fetch(`/api/franchises/${f.id}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ status: nextStatus })
      });
      if (res.ok) {
        fetchFranchises();
        if (selectedFranchise?.id === f.id) {
          setSelectedFranchise({ ...selectedFranchise, status: nextStatus });
        }
      }
    } catch (err) {
      console.error('Failed to toggle status', err);
    }
  };

  const handleAssignBranch = async () => {
    if (!selectedFranchise || !selectedBranchToAssign) return;
    try {
      const res = await fetch(`/api/franchises/${selectedFranchise.id}/branches/${selectedBranchToAssign}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        setSelectedBranchToAssign('');
        loadFranchiseDetails(selectedFranchise);
        fetchFranchises();
        fetchAllBranches();
      }
    } catch (err) {
      console.error('Failed to assign branch', err);
    }
  };

  const handleRemoveBranch = async (branchId: string) => {
    if (!selectedFranchise) return;
    try {
      const res = await fetch(`/api/franchises/${selectedFranchise.id}/branches/${branchId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        loadFranchiseDetails(selectedFranchise);
        fetchFranchises();
        fetchAllBranches();
      }
    } catch (err) {
      console.error('Failed to remove branch', err);
    }
  };

  // Branches not in this franchise
  const candidateBranches = allBranches.filter(b => b.franchise_id !== selectedFranchise?.id);

  return (
    <div id="franchises-view" className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Visual Hierarchy Reminder Banner */}
      <div className="p-4 rounded-xl bg-gradient-to-r from-slate-900 via-amber-950/20 to-slate-900 border border-amber-500/20 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Layers className="w-5 h-5 text-amber-400" />
            <span className="text-xs font-bold text-amber-400 tracking-wider uppercase">
              {ru ? 'Структура сети' : 'Ulgamyň gurluşy'}
            </span>
          </div>
          <div className="flex items-center gap-2 mt-1 text-sm font-semibold text-slate-200">
            <span className="px-2 py-0.5 rounded bg-amber-500/10 text-amber-300 border border-amber-500/30">
              {ru ? 'Франшиза' : 'Franşiza'}
            </span>
            <ArrowRight className="w-4 h-4 text-slate-500" />
            <span className="px-2 py-0.5 rounded bg-blue-500/10 text-blue-300 border border-blue-500/30">
              {ru ? 'Филиал' : 'Şahamça'}
            </span>
            <ArrowRight className="w-4 h-4 text-slate-500" />
            <span className="px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-300 border border-emerald-500/30">
              {ru ? 'Сотрудники' : 'Işgärler'}
            </span>
          </div>
        </div>
        <div className="text-xs text-slate-400 max-w-md">
          Branches belong to specific Franchises. Employee access and RBAC permissions are isolated strictly at the branch level.
        </div>
      </div>

      {actionSuccessMessage && (
        <div className="p-3.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
          <span>{actionSuccessMessage}</span>
        </div>
      )}

      {/* Action Toolbar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3 flex-1">
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              id="search-franchises-input"
              placeholder={ru ? 'Поиск по названию, коду или контакту…' : 'Ady, kody ýa-da aragatnaşygy boýunça gözleg…'}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-4 py-2 bg-slate-900 border border-slate-800 rounded-lg text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-amber-500/50"
            />
          </div>

          {/* Stage 41: the same segmented selector used for filters and sub-tabs on every screen,
              and the options say what they mean instead of showing the stored status value. */}
          <div className="flex items-center gap-1">
            {([['ALL', ru ? 'Все' : 'Ählisi'], ['ACTIVE', ru ? 'Работают' : 'Işleýär'], ['INACTIVE', ru ? 'Отключены' : 'Öçürilen']] as const).map(([st, label]) => (
              <button
                key={st}
                onClick={() => setStatusFilter(st)}
                className={`boom-chip ${statusFilter === st ? 'is-active' : ''}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {hasPermission('franchises.create') && (
          <button
            id="btn-register-franchise"
            onClick={handleOpenCreate}
            className="btn btn-sm"
          >
            <Plus className="w-4 h-4" />
            <span>{ru ? 'Добавить франшизу' : 'Franşiza goş'}</span>
          </button>
        )}
      </div>

      {/* Main Grid: Franchises List & Detail Hierarchy Viewer */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Franchises Table / Cards */}
        <div className={selectedFranchise ? 'lg:col-span-6 space-y-3' : 'lg:col-span-12 space-y-3'}>
          <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
            <div className="p-4 border-b border-slate-800 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-slate-200">{ru ? 'Франшизы' : 'Franşizalar'}</h3>
                <p className="text-xs text-slate-400">{ru ? 'Юридические лица сети и их филиалы' : 'Ulgamyň ýuridiki taraplary we şahamçalary'}</p>
              </div>
              <span className="text-xs font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-300 font-bold">
                {franchises.length} total
              </span>
            </div>

            {isLoading ? (
              <LoadingState/>
            ) : franchises.length === 0 ? (
              <EmptyState
                title={ru ? 'Франшизы не найдены.' : 'Franşiza tapylmady.'}
                hint={ru ? 'Франшиза объединяет филиалы одного юридического лица.' : 'Franşiza bir ýuridiki tarapyň şahamçalaryny birleşdirýär.'}/>
            ) : (
              <div className="divide-y divide-slate-800/80">
                {franchises.map((f) => {
                  const isSelected = selectedFranchise?.id === f.id;
                  return (
                    <div
                      key={f.id}
                      id={`franchise-row-${f.code}`}
                      className={`p-4 transition-colors flex flex-col gap-3 ${
                        isSelected ? 'bg-amber-500/5 border-l-2 border-amber-500' : 'hover:bg-slate-800/40'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-xs font-bold text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20">
                              {f.code}
                            </span>
                            <h4 className="text-sm font-bold text-slate-100">{f.name}</h4>
                            <span
                              className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                                f.status === 'ACTIVE'
                                  ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                                  : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                              }`}
                            >
                              {f.status}
                            </span>
                          </div>
                          <p className="text-xs text-slate-400 mt-1">{f.legal_name}</p>
                        </div>

                        <div className="flex items-center gap-1.5">
                          <button
                            id={`btn-view-franchise-${f.code}`}
                            onClick={() => loadFranchiseDetails(f)}
                            className={`px-3 py-1.5 rounded text-xs font-semibold flex items-center gap-1 transition-colors ${
                              isSelected
                                ? 'bg-amber-500 text-slate-950 font-bold'
                                : 'bg-slate-800 hover:bg-slate-700 text-slate-200'
                            }`}
                          >
                            <span>{ru ? 'Структура' : 'Gurluş'}</span>
                            <ExternalLink className="w-3 h-3" />
                          </button>

                          {hasPermission('franchises.update') && (
                            <button
                              id={`btn-edit-franchise-${f.code}`}
                              onClick={() => handleOpenEdit(f)}
                              className="p-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors"
                              title="Edit Franchise"
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Metrics bar */}
                      <div className="grid grid-cols-3 gap-2 p-2 bg-slate-950/60 rounded-lg border border-slate-800/80 text-xs">
                        <div>
                          <span className="text-[10px] text-slate-500 uppercase font-mono block">{ru ? 'Филиалы' : 'Şahamçalar'}</span>
                          <span className="font-mono font-bold text-blue-400">{f.branch_count || 0}</span>
                        </div>
                        <div>
                          <span className="text-[10px] text-slate-500 uppercase font-mono block">{ru ? 'Сотрудники' : 'Işgärler'}</span>
                          <span className="font-mono font-bold text-emerald-400">{f.employee_count || 0}</span>
                        </div>
                        <div>
                          <span className="text-[10px] text-slate-500 uppercase font-mono block">{ru ? 'Контакты' : 'Aragatnaşyk'}</span>
                          <span className="text-slate-300 truncate block">{f.contact_name}</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Deep Hierarchy Panel (Branches & Employees inside selected franchise) */}
        {selectedFranchise && (
          <div className="lg:col-span-6 space-y-4">
            <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-xl">
              {/* Franchise Detail Header */}
              <div className="p-4 bg-slate-900 border-b border-slate-800">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-bold text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20">
                      {selectedFranchise.code}
                    </span>
                    <h3 className="text-sm font-bold text-slate-100">{selectedFranchise.name}</h3>
                  </div>
                  <button
                    onClick={() => setSelectedFranchise(null)}
                    className="btn-secondary btn-sm"
                  >
                    {ru ? 'Закрыть' : 'Ýap'}
                  </button>
                </div>

                {/* Sub-tabs */}
                <div className="flex items-center gap-2 mt-4 border-b border-slate-800/80 pb-2">
                  <button
                    onClick={() => setActiveSubTab('branches')}
                    className={`boom-chip ${activeSubTab === 'branches' ? 'is-active' : ''}`}
                  >
                    <Building className="w-3.5 h-3.5" />
                    <span>{ru ? 'Филиалы' : 'Şahamçalar'} ({franchiseBranches.length})</span>
                  </button>

                  <button
                    onClick={() => setActiveSubTab('employees')}
                    className={`boom-chip ${activeSubTab === 'employees' ? 'is-active' : ''}`}
                  >
                    <Users className="w-3.5 h-3.5" />
                    <span>{ru ? 'Сотрудники' : 'Işgärler'} ({franchiseEmployees.length})</span>
                  </button>

                  <button
                    onClick={() => setActiveSubTab('details')}
                    className={`boom-chip ${activeSubTab === 'details' ? 'is-active' : ''}`}
                  >
                    <FileText className="w-3.5 h-3.5" />
                    <span>{ru ? 'Юридические данные и контакты' : 'Ýuridiki maglumatlar we aragatnaşyk'}</span>
                  </button>
                </div>
              </div>

              {/* Sub-tab Body */}
              <div className="p-4">
                {isSubLoading ? (
                  <div className="p-8 text-center text-xs text-slate-500 font-mono">{ru ? 'Загружаем структуру…' : 'Gurluş ýüklenýär…'}</div>
                ) : activeSubTab === 'branches' ? (
                  <div className="space-y-4">
                    {/* Add Branch to Franchise form */}
                    {hasPermission('franchises.update') && candidateBranches.length > 0 && (
                      <div className="p-3 bg-slate-950/70 border border-slate-800 rounded-lg flex items-center gap-2">
                        <select
                          id="select-branch-to-assign"
                          value={selectedBranchToAssign}
                          onChange={(e) => setSelectedBranchToAssign(e.target.value)}
                          className="flex-1 bg-slate-900 border border-slate-700 rounded text-xs px-3 py-1.5 text-slate-200 focus:outline-none"
                        >
                          <option value="">-- Select branch to assign to this franchise --</option>
                          {candidateBranches.map((b) => (
                            <option key={b.id} value={b.id}>
                              [{b.code}] {b.name} {b.franchise_name ? `(currently in ${b.franchise_name})` : '(unassigned)'}
                            </option>
                          ))}
                        </select>
                        <button
                          id="btn-confirm-assign-branch"
                          onClick={handleAssignBranch}
                          disabled={!selectedBranchToAssign}
                          className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-semibold text-xs rounded transition-colors flex items-center gap-1"
                        >
                          <Link className="w-3 h-3" />
                          <span>{ru ? 'Привязать филиал' : 'Şahamçany birikdir'}</span>
                        </button>
                      </div>
                    )}

                    {franchiseBranches.length === 0 ? (
                      <div className="p-6 text-center text-xs text-slate-500">
                        {ru ? 'К этой франшизе пока не привязан ни один филиал.' : 'Bu franşiza entek hiç bir şahamça birikdirilmedi.'}
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {franchiseBranches.map((branch) => (
                          <div
                            key={branch.id}
                            className="p-3 rounded-lg bg-slate-950 border border-slate-800 flex items-center justify-between gap-3"
                          >
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="font-mono text-xs font-bold text-blue-400 bg-blue-500/10 px-1.5 py-0.5 rounded border border-blue-500/20">
                                  {branch.code}
                                </span>
                                <span className="text-xs font-bold text-slate-200">{branch.name}</span>
                                <span
                                  className={`text-[9px] font-bold px-1.5 py-0.2 rounded-full ${
                                    branch.status === 'ACTIVE'
                                      ? 'bg-emerald-500/10 text-emerald-400'
                                      : 'bg-rose-500/10 text-rose-400'
                                  }`}
                                >
                                  {branch.status}
                                </span>
                              </div>
                              <p className="text-[11px] text-slate-400 mt-1 flex items-center gap-1">
                                <MapPin className="w-3 h-3 text-slate-500" />
                                {branch.address}
                              </p>
                            </div>

                            <div className="flex items-center gap-2">
                              <span className="text-[11px] font-mono text-slate-400">
                                {branch.staff_count || 0} staff
                              </span>

                              {hasPermission('franchises.update') && (
                                <button
                                  id={`btn-unlink-branch-${branch.code}`}
                                  onClick={() => handleRemoveBranch(branch.id)}
                                  className="p-1.5 rounded bg-slate-800 hover:bg-red-500/20 text-slate-400 hover:text-red-400 transition-colors"
                                  title={ru ? 'Отвязать филиал от франшизы' : 'Şahamçany franşizadan aýyr'}
                                >
                                  <Unlink className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ) : activeSubTab === 'employees' ? (
                  <div className="space-y-3">
                    {franchiseEmployees.length === 0 ? (
                      <div className="p-6 text-center text-xs text-slate-500">
                        {ru ? 'В филиалах этой франшизы пока нет сотрудников.' : 'Bu franşizanyň şahamçalarynda entek işgär ýok.'}
                      </div>
                    ) : (
                      <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
                        {franchiseEmployees.map((emp) => (
                          <div
                            key={emp.id}
                            className="p-3 rounded-lg bg-slate-950 border border-slate-800 flex items-start justify-between gap-3"
                          >
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="text-xs font-bold text-slate-200">{emp.full_name}</span>
                                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20 font-bold">
                                  {emp.roles?.[0]?.code || 'USER'}
                                </span>
                                <span
                                  className={`text-[9px] font-bold px-1.5 py-0.2 rounded-full ${
                                    emp.status === 'ACTIVE'
                                      ? 'bg-emerald-500/10 text-emerald-400'
                                      : 'bg-rose-500/10 text-rose-400'
                                  }`}
                                >
                                  {emp.status}
                                </span>
                              </div>
                              <p className="text-[11px] text-slate-400 mt-1">{emp.email}</p>

                              {/* Primary & Allowed Branches Badges */}
                              <div className="flex flex-wrap items-center gap-1.5 mt-2">
                                {emp.primary_branch_name ? (
                                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20 font-medium">
                                    Primary: {emp.primary_branch_name}
                                  </span>
                                ) : (
                                  <span className="text-[10px] text-slate-500">{ru ? 'Основной филиал не выбран' : 'Esasy şahamça saýlanmadyk'}</span>
                                )}

                                {emp.has_all_branches ? (
                                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-bold">
                                    Universal Branch Access
                                  </span>
                                ) : (
                                  <span className="text-[10px] font-mono text-slate-400">
                                    {emp.branch_access?.length || 0} allowed branch(es)
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  /* Legal & Contact Info */
                  <div className="space-y-4 text-xs">
                    <div className="p-3 bg-slate-950 rounded-lg border border-slate-800 space-y-2">
                      <div className="flex justify-between py-1 border-b border-slate-800/60">
                        <span className="text-slate-400">{ru ? 'Юридическое лицо' : 'Ýuridiki tarap'}</span>
                        <span className="text-slate-200 font-semibold">{selectedFranchise.legal_name}</span>
                      </div>
                      <div className="flex justify-between py-1 border-b border-slate-800/60">
                        <span className="text-slate-400">{ru ? 'Код франшизы' : 'Franşiza kody'}</span>
                        <span className="font-mono text-amber-400 font-bold">{selectedFranchise.code}</span>
                      </div>
                      <div className="flex justify-between py-1 border-b border-slate-800/60">
                        <span className="text-slate-400">{ru ? 'Контактное лицо' : 'Aragatnaşyk şahsy'}</span>
                        <span className="text-slate-200 font-semibold">{selectedFranchise.contact_name}</span>
                      </div>
                      <div className="flex justify-between py-1 border-b border-slate-800/60">
                        <span className="text-slate-400">{ru ? 'Телефон' : 'Telefon'}</span>
                        <span className="text-slate-200 font-mono">{selectedFranchise.phone}</span>
                      </div>
                      <div className="flex justify-between py-1 border-b border-slate-800/60">
                        <span className="text-slate-400">{ru ? 'Электронная почта' : 'E-poçta'}</span>
                        <span className="text-slate-200 font-mono">{selectedFranchise.email}</span>
                      </div>
                      <div className="flex justify-between py-1 border-b border-slate-800/60">
                        <span className="text-slate-400">{ru ? 'Юридический адрес' : 'Ýuridiki salgy'}</span>
                        <span className="text-slate-200 text-right">{selectedFranchise.address}</span>
                      </div>
                      <div className="flex justify-between py-1">
                        <span className="text-slate-400">{ru ? 'Статус работы' : 'Iş ýagdaýy'}</span>
                        <span
                          className={`font-bold ${
                            selectedFranchise.status === 'ACTIVE' ? 'text-emerald-400' : 'text-rose-400'
                          }`}
                        >
                          {selectedFranchise.status}
                        </span>
                      </div>
                    </div>

                    {hasPermission('franchises.update') && (
                      <div className="flex items-center justify-between pt-2">
                        {/* Stage 41: switching a franchise off is a destructive action and now looks
                            like every other one; switching it back on is an ordinary secondary action. */}
                        <button
                          onClick={() => handleToggleStatus(selectedFranchise)}
                          className={selectedFranchise.status === 'ACTIVE' ? 'btn-danger btn-sm' : 'btn-secondary btn-sm'}
                        >
                          {selectedFranchise.status === 'ACTIVE'
                            ? (ru ? 'Отключить франшизу' : 'Franşizany öçür')
                            : (ru ? 'Включить франшизу' : 'Franşizany aç')}
                        </button>

                        <button
                          onClick={() => handleOpenEdit(selectedFranchise)}
                          className="btn btn-sm"
                        >
                          {ru ? 'Изменить данные' : 'Maglumatlary üýtget'}
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Create / Edit Franchise Modal */}
      {(isCreateModalOpen || isEditModalOpen) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
          <div className="w-full max-w-lg bg-slate-900 border border-slate-800 rounded-xl shadow-2xl overflow-hidden">
            <div className="p-4 border-b border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Building className="w-4 h-4 text-amber-400" />
                <h3 className="text-sm font-bold text-slate-100">
                  {isEditModalOpen ? `Edit Franchise (${formData.code})` : 'Register New Franchise'}
                </h3>
              </div>
              <button
                onClick={() => {
                  setIsCreateModalOpen(false);
                  setIsEditModalOpen(false);
                }}
                className="text-slate-400 hover:text-slate-200"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveFranchise} className="p-5 space-y-4 text-xs">
              {formError && (
                <div className="p-3 rounded bg-rose-500/10 border border-rose-500/30 text-rose-300">
                  {formError}
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-400 mb-1 font-medium">{ru ? 'Название франшизы' : 'Franşizanyň ady'} <span className="boom-req">*</span></label>
                  <input
                    type="text"
                    id="input-franchise-name"
                    required
                    placeholder={ru ? 'например, Ашхабадская франшиза' : 'meselem, Aşgabat franşizasy'}
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded text-slate-200 focus:outline-none focus:border-amber-500"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1 font-medium">{ru ? 'Код франшизы' : 'Franşiza kody'} <span className="boom-req">*</span></label>
                  <input
                    type="text"
                    id="input-franchise-code"
                    required
                    placeholder={ru ? 'например, ASH-001' : 'meselem, ASH-001'}
                    value={formData.code}
                    onChange={(e) => setFormData({ ...formData, code: e.target.value.toUpperCase() })}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded text-slate-200 font-mono uppercase focus:outline-none focus:border-amber-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-slate-400 mb-1 font-medium">{ru ? 'Юридическое лицо' : 'Ýuridiki tarap'} <span className="boom-req">*</span></label>
                <input
                  type="text"
                  id="input-franchise-legal"
                  required
                  placeholder={ru ? 'например, BOOMBURGER Ашхабад ЗАО' : 'meselem, BOOMBURGER Aşgabat ÝGPJ'}
                  value={formData.legal_name}
                  onChange={(e) => setFormData({ ...formData, legal_name: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded text-slate-200 focus:outline-none focus:border-amber-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-400 mb-1 font-medium">{ru ? 'Контактное лицо' : 'Aragatnaşyk şahsy'} <span className="boom-req">*</span></label>
                  <input
                    type="text"
                    id="input-franchise-contact"
                    required
                    placeholder={ru ? 'например, Иван Петров' : 'meselem, Aman Amanow'}
                    value={formData.contact_name}
                    onChange={(e) => setFormData({ ...formData, contact_name: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded text-slate-200 focus:outline-none focus:border-amber-500"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1 font-medium">{ru ? 'Телефон' : 'Telefon'} <span className="boom-req">*</span></label>
                  <input
                    type="text"
                    id="input-franchise-phone"
                    required
                    placeholder="+993 (12) 45-67-89"
                    value={formData.phone}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded text-slate-200 focus:outline-none focus:border-amber-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-400 mb-1 font-medium">{ru ? 'Электронная почта' : 'E-poçta'} <span className="boom-req">*</span></label>
                  <input
                    type="email"
                    id="input-franchise-email"
                    required
                    placeholder="ashgabat@boomburger.com"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded text-slate-200 focus:outline-none focus:border-amber-500"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1 font-medium">{ru ? 'Статус' : 'Ýagdaý'}</label>
                  <select
                    id="select-franchise-status"
                    value={formData.status}
                    onChange={(e) => setFormData({ ...formData, status: e.target.value as any })}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded text-slate-200 focus:outline-none focus:border-amber-500"
                  >
                    <option value="ACTIVE">{ru ? 'Работает' : 'Işleýär'}</option>
                    <option value="INACTIVE">{ru ? 'Отключена' : 'Öçürilen'}</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-slate-400 mb-1 font-medium">{ru ? 'Юридический адрес' : 'Ýuridiki salgy'} <span className="boom-req">*</span></label>
                <textarea
                  id="input-franchise-address"
                  required
                  rows={2}
                  placeholder={ru ? 'например, г. Ашхабад, ул. …' : 'meselem, Aşgabat ş., … köçesi'}
                  value={formData.address}
                  onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded text-slate-200 focus:outline-none focus:border-amber-500"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => {
                    setIsCreateModalOpen(false);
                    setIsEditModalOpen(false);
                  }}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded font-semibold transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  id="btn-submit-franchise"
                  disabled={isSubmitting}
                  className="btn"
                >
                  {isSubmitting ? 'Saving...' : isEditModalOpen ? 'Update Franchise' : 'Create Franchise'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
