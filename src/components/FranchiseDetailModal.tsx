import React, { useState, useEffect } from 'react';
import {
  Building,
  Building2,
  Users,
  ShoppingBag,
  HeartHandshake,
  Star,
  DollarSign,
  History,
  X,
  MapPin,
  Phone,
  Mail,
  Calendar,
  AlertCircle,
  Clock,
  Shield,
  Layers,
  CheckCircle2,
  XCircle,
  ExternalLink,
  Lock,
  Plus
} from 'lucide-react';
import { Franchise, Branch, User, FranchiseOverview } from '../types';
import { api } from '../api';
import { useLanguage } from '../context/LanguageContext';
import { useAuth } from '../context/AuthContext';

interface FranchiseDetailModalProps {
  franchiseId: string | null;
  isOpen: boolean;
  onClose: () => void;
  onFranchiseUpdated?: () => void;
}

type TabKey = 'overview' | 'branches' | 'employees' | 'orders' | 'crm' | 'ratings' | 'finance' | 'activity';

export const FranchiseDetailModal: React.FC<FranchiseDetailModalProps> = ({
  franchiseId,
  isOpen,
  onClose,
  onFranchiseUpdated
}) => {
  const { t, language } = useLanguage();
  const { token, hasPermission } = useAuth();

  const [activeTab, setActiveTab] = useState<TabKey>('overview');
  const [data, setData] = useState<FranchiseOverview | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [employees, setEmployees] = useState<any[]>([]);
  const [activityLogs, setActivityLogs] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // For assigning a branch
  const [unassignedBranches, setUnassignedBranches] = useState<Branch[]>([]);
  const [selectedBranchId, setSelectedBranchId] = useState<string>('');
  const [isAssigning, setIsAssigning] = useState(false);

  useEffect(() => {
    if (!isOpen || !franchiseId) return;

    const loadData = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const [overviewRes, branchesRes, employeesRes, allBranchesRes] = await Promise.all([
          api.getFranchiseOverview(franchiseId),
          api.getFranchiseBranches(franchiseId),
          api.getFranchiseEmployees(franchiseId),
          api.getBranches()
        ]);

        setData(overviewRes);
        setBranches(branchesRes.branches || []);
        setEmployees(employeesRes.employees || []);

        // Branches not yet assigned to any franchise or this franchise
        const unassigned = (allBranchesRes.branches || []).filter(
          b => !b.franchise_id || b.franchise_id !== franchiseId
        );
        setUnassignedBranches(unassigned);

        // Fetch audit activity for this franchise
        try {
          const logsRes = await api.getAuditLogs({
            entity_type: 'franchise',
            limit: 20
          });
          setActivityLogs((logsRes.logs || []).filter(l => l.entity_id === franchiseId));
        } catch {
          // ignore
        }
      } catch (err: any) {
        setError(err.message || 'Failed to load franchise overview');
      } finally {
        setIsLoading(false);
      }
    };

    loadData();
  }, [isOpen, franchiseId]);

  if (!isOpen) return null;

  const handleAssignBranch = async () => {
    if (!franchiseId || !selectedBranchId) return;
    setIsAssigning(true);
    try {
      await api.assignBranchToFranchise(franchiseId, selectedBranchId);
      // Reload branches
      const bRes = await api.getFranchiseBranches(franchiseId);
      setBranches(bRes.branches || []);
      const allB = await api.getBranches();
      setUnassignedBranches(allB.branches.filter(b => b.franchise_id !== franchiseId));
      setSelectedBranchId('');
      if (onFranchiseUpdated) onFranchiseUpdated();
    } catch (err: any) {
      alert(err.message || 'Failed to assign branch');
    } finally {
      setIsAssigning(false);
    }
  };

  const handleUnlinkBranch = async (branchId: string) => {
    if (!franchiseId) return;
    if (!confirm(language === 'ru' ? 'Отвязать филиал от данной франшизы?' : 'Şahamçany bu franşizadan aýyrmalymy?')) return;

    try {
      await api.unlinkBranchFromFranchise(franchiseId, branchId);
      const bRes = await api.getFranchiseBranches(franchiseId);
      setBranches(bRes.branches || []);
      const allB = await api.getBranches();
      setUnassignedBranches(allB.branches.filter(b => b.franchise_id !== franchiseId));
      if (onFranchiseUpdated) onFranchiseUpdated();
    } catch (err: any) {
      alert(err.message || 'Failed to unlink branch');
    }
  };

  const franchise = data?.franchise;
  const metrics = data?.metrics;

  const tabs: Array<{ key: TabKey; label: string; icon: any; badge?: number | string }> = [
    { key: 'overview', label: t('franchise.overview'), icon: Building },
    { key: 'branches', label: t('franchise.branches'), icon: Building2, badge: branches.length },
    { key: 'employees', label: t('franchise.employees'), icon: Users, badge: employees.length },
    { key: 'orders', label: t('franchise.orders'), icon: ShoppingBag, badge: 'POS' },
    { key: 'crm', label: t('franchise.customers'), icon: HeartHandshake, badge: 'CRM' },
    { key: 'ratings', label: t('franchise.ratings'), icon: Star, badge: 'N/A' },
    { key: 'finance', label: t('franchise.financials'), icon: DollarSign, badge: 'P&L' },
    { key: 'activity', label: t('franchise.activity'), icon: History }
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative w-full max-w-5xl h-[88vh] bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl flex flex-col overflow-hidden text-slate-200">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-900/90">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400 font-bold">
              <Building className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-bold text-white tracking-tight">
                  {franchise?.name || 'Loading Franchise...'}
                </h2>
                {franchise && (
                  <span className={`px-2 py-0.5 rounded text-[11px] font-bold font-mono ${
                    franchise.status === 'ACTIVE'
                      ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                      : 'bg-rose-500/15 text-rose-400 border border-rose-500/30'
                  }`}>
                    {franchise.status}
                  </span>
                )}
                {franchise && (
                  <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 font-mono text-[11px] border border-slate-700">
                    {franchise.code}
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-400">
                {franchise?.legal_name || 'Holding Enterprise Entity'}
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="px-6 border-b border-slate-800 bg-slate-950/40 flex gap-2 overflow-x-auto select-none">
          {tabs.map(tab => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                id={`tab-franchise-${tab.key}`}
                onClick={() => setActiveTab(tab.key)}
                className={`flex items-center gap-2 py-3 px-3 text-xs font-semibold border-b-2 transition-all whitespace-nowrap ${
                  isActive
                    ? 'border-amber-500 text-amber-400'
                    : 'border-transparent text-slate-400 hover:text-slate-200'
                }`}
              >
                <Icon className={`w-3.5 h-3.5 ${isActive ? 'text-amber-400' : 'text-slate-500'}`} />
                <span>{tab.label}</span>
                {tab.badge !== undefined && (
                  <span className={`px-1.5 py-0.2 rounded text-[10px] font-mono ${
                    isActive
                      ? 'bg-amber-500/20 text-amber-300'
                      : 'bg-slate-800 text-slate-400'
                  }`}>
                    {tab.badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Body content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {isLoading ? (
            <div className="h-64 flex flex-col items-center justify-center text-slate-400 gap-3">
              <div className="w-8 h-8 rounded-full border-2 border-amber-400 border-t-transparent animate-spin"></div>
              <p className="text-xs font-mono">{t('common.loading')}</p>
            </div>
          ) : error ? (
            <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-sm flex items-center gap-3">
              <AlertCircle className="w-5 h-5 flex-shrink-0" />
              <span>{error}</span>
            </div>
          ) : (
            <>
              {/* TAB 1: OVERVIEW */}
              {activeTab === 'overview' && (
                <div className="space-y-6">
                  {/* Real Metrics Grid */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800">
                      <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
                        {t('franchise.totalBranches')}
                      </span>
                      <div className="text-2xl font-black text-white">{metrics?.total_branches ?? 0}</div>
                      <span className="text-[11px] text-emerald-400 font-semibold">
                        {metrics?.active_branches ?? 0} {t('status.active').toLowerCase()}
                      </span>
                    </div>

                    <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800">
                      <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
                        {t('franchise.totalEmployees')}
                      </span>
                      <div className="text-2xl font-black text-white">{metrics?.total_employees ?? 0}</div>
                      <span className="text-[11px] text-emerald-400 font-semibold">
                        {metrics?.active_employees ?? 0} {t('status.active').toLowerCase()}
                      </span>
                    </div>

                    <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800">
                      <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
                        {t('franchise.orders')}
                      </span>
                      <div className="text-xl font-bold text-slate-400">N/A</div>
                      <span className="text-[11px] text-amber-400 font-medium">
                        {t('module.notConnected')}
                      </span>
                    </div>

                    <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800">
                      <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
                        {t('franchise.financials')}
                      </span>
                      <div className="text-xl font-bold text-slate-400">N/A</div>
                      <span className="text-[11px] text-amber-400 font-medium">
                        {t('module.notConnected')}
                      </span>
                    </div>
                  </div>

                  {/* Franchise Legal Information Card */}
                  <div className="p-5 rounded-xl bg-slate-950/60 border border-slate-800 space-y-4">
                    <h3 className="text-sm font-bold text-white flex items-center gap-2">
                      <Shield className="w-4 h-4 text-amber-400" />
                      <span>{t('franchise.card')}</span>
                    </h3>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                      <div>
                        <span className="text-slate-400 block mb-0.5">{t('franchise.legalName')}</span>
                        <span className="font-semibold text-white">{franchise?.legal_name}</span>
                      </div>
                      <div>
                        <span className="text-slate-400 block mb-0.5">{t('franchise.code')}</span>
                        <span className="font-mono font-bold text-amber-400">{franchise?.code}</span>
                      </div>
                      <div>
                        <span className="text-slate-400 block mb-0.5">{t('franchise.contactPerson')}</span>
                        <span className="font-semibold text-white">{franchise?.contact_name}</span>
                      </div>
                      <div>
                        <span className="text-slate-400 block mb-0.5">{t('franchise.phone')}</span>
                        <span className="font-semibold text-white">{franchise?.phone}</span>
                      </div>
                      <div>
                        <span className="text-slate-400 block mb-0.5">{t('franchise.email')}</span>
                        <span className="font-semibold text-white">{franchise?.email}</span>
                      </div>
                      <div>
                        <span className="text-slate-400 block mb-0.5">{t('franchise.address')}</span>
                        <span className="font-semibold text-white">{franchise?.address}</span>
                      </div>
                      <div>
                        <span className="text-slate-400 block mb-0.5">{t('common.date')}</span>
                        <span className="font-semibold text-white">
                          {franchise?.created_at ? new Date(franchise.created_at).toLocaleDateString() : '—'}
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-400 block mb-0.5">{t('common.status')}</span>
                        <span className={`inline-block px-2 py-0.5 rounded font-bold font-mono text-[10px] ${
                          franchise?.status === 'ACTIVE'
                            ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                            : 'bg-rose-500/15 text-rose-400 border border-rose-500/30'
                        }`}>
                          {franchise?.status}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Operational readiness notice */}
                  <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/20 text-xs text-slate-300 flex items-start gap-3">
                    <Lock className="w-4 h-4 text-amber-400 mt-0.5 flex-shrink-0" />
                    <div>
                      <strong className="text-amber-300 block mb-1">
                        {language === 'ru' ? 'Архитектурный рубеж BOOM OS Foundation' : 'BOOM OS Binýat binagärlik serhedi'}
                      </strong>
                      <p className="text-slate-300 text-[11px] leading-relaxed">
                        {language === 'ru'
                          ? 'Карточка франшизы подключена к центральной базе данных holding. Ресторанные продажи, чеки и данные KDS/CRM намеренно не эмулируются фиктивными данными (No Fake Data Policy) и будут заполняться из боевых модулей POS.'
                          : 'Franşiza kartoçkasy merkezi holding maglumatlar bazasyna birikdirildi. Restoran satuwlary, çekler we KDS/CRM maglumatlary ýasama sanlar bilen doldurylmaýar (No Fake Data Policy) we POS moduly birikdirilende awtomatiki açylar.'}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 2: BRANCHES */}
              {activeTab === 'branches' && (
                <div className="space-y-4">
                  {/* Assign Branch Bar */}
                  {hasPermission('franchises.edit') && unassignedBranches.length > 0 && (
                    <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-3">
                      <div className="flex items-center gap-2 text-xs">
                        <Building2 className="w-4 h-4 text-amber-400" />
                        <span className="font-semibold text-slate-200">{t('franchise.assignBranch')}:</span>
                      </div>
                      <div className="flex items-center gap-2 w-full sm:w-auto">
                        <select
                          value={selectedBranchId}
                          onChange={(e) => setSelectedBranchId(e.target.value)}
                          className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-amber-500 flex-1 sm:w-64"
                        >
                          <option value="">{language === 'ru' ? '— Выберите филиал —' : '— Şahamçany saýlaň —'}</option>
                          {unassignedBranches.map(b => (
                            <option key={b.id} value={b.id}>
                              {b.name} ({b.code})
                            </option>
                          ))}
                        </select>
                        <button
                          onClick={handleAssignBranch}
                          disabled={!selectedBranchId || isAssigning}
                          className="px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 font-bold text-xs transition-colors flex items-center gap-1.5"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          <span>{t('common.confirm')}</span>
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Branches Table */}
                  <div className="rounded-xl border border-slate-800 overflow-hidden bg-slate-950/40">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-900/80 border-b border-slate-800 text-slate-400 font-bold uppercase tracking-wider text-[10px]">
                        <tr>
                          <th className="py-3 px-4">Branch</th>
                          <th className="py-3 px-4">Code</th>
                          <th className="py-3 px-4">Address</th>
                          <th className="py-3 px-4">Phone</th>
                          <th className="py-3 px-4">Status</th>
                          <th className="py-3 px-4 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/60">
                        {branches.length === 0 ? (
                          <tr>
                            <td colSpan={6} className="py-8 text-center text-slate-500">
                              {language === 'ru' ? 'К этой франшизе пока не привязаны филиалы' : 'Bu franşiza entek şahamça birikdirilmedi'}
                            </td>
                          </tr>
                        ) : (
                          branches.map(b => (
                            <tr key={b.id} className="hover:bg-slate-800/30 transition-colors">
                              <td className="py-3 px-4 font-semibold text-white">{b.name}</td>
                              <td className="py-3 px-4 font-mono text-amber-400">{b.code}</td>
                              <td className="py-3 px-4 text-slate-300">{b.address}</td>
                              <td className="py-3 px-4 text-slate-400">{b.phone}</td>
                              <td className="py-3 px-4">
                                <span className={`px-2 py-0.5 rounded font-mono text-[10px] font-bold ${
                                  b.status === 'ACTIVE'
                                    ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                                    : 'bg-slate-800 text-slate-400'
                                }`}>
                                  {b.status}
                                </span>
                              </td>
                              <td className="py-3 px-4 text-right">
                                {hasPermission('franchises.edit') && (
                                  <button
                                    onClick={() => handleUnlinkBranch(b.id)}
                                    className="text-xs text-rose-400 hover:text-rose-300 font-medium px-2 py-1 rounded hover:bg-rose-500/10 transition-colors"
                                  >
                                    {t('franchise.unlinkBranch')}
                                  </button>
                                )}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* TAB 3: EMPLOYEES */}
              {activeTab === 'employees' && (
                <div className="space-y-4">
                  <div className="rounded-xl border border-slate-800 overflow-hidden bg-slate-950/40">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-900/80 border-b border-slate-800 text-slate-400 font-bold uppercase tracking-wider text-[10px]">
                        <tr>
                          <th className="py-3 px-4">Employee</th>
                          <th className="py-3 px-4">Primary Branch</th>
                          <th className="py-3 px-4">Role</th>
                          <th className="py-3 px-4">Employment Status</th>
                          <th className="py-3 px-4">Disciplinary</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/60">
                        {employees.length === 0 ? (
                          <tr>
                            <td colSpan={5} className="py-8 text-center text-slate-500">
                              {language === 'ru' ? 'В филиалах этой франшизы нет сотрудников' : 'Bu franşizanyň şahamçalarynda işgär ýok'}
                            </td>
                          </tr>
                        ) : (
                          employees.map(emp => (
                            <tr key={emp.id} className="hover:bg-slate-800/30 transition-colors">
                              <td className="py-3 px-4">
                                <div className="font-semibold text-white">{emp.full_name}</div>
                                <div className="text-[11px] text-slate-400">{emp.email}</div>
                              </td>
                              <td className="py-3 px-4 text-slate-300 font-medium">
                                {emp.branch_name || 'HQ / Unassigned'}
                              </td>
                              <td className="py-3 px-4">
                                <span className="px-2 py-0.5 rounded bg-purple-500/15 text-purple-300 border border-purple-500/25 font-mono text-[10px] font-bold">
                                  {emp.roles?.[0]?.code || 'USER'}
                                </span>
                              </td>
                              <td className="py-3 px-4">
                                <span className={`px-2 py-0.5 rounded font-mono text-[10px] font-bold ${
                                  (emp.employment_status || emp.status) === 'ACTIVE'
                                    ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                                    : (emp.employment_status || emp.status) === 'TERMINATED'
                                    ? 'bg-rose-500/15 text-rose-400 border border-rose-500/30'
                                    : 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
                                }`}>
                                  {emp.employment_status || emp.status}
                                </span>
                              </td>
                              <td className="py-3 px-4">
                                <span className="text-[11px] font-mono text-slate-400">
                                  {emp.disciplinary_status || 'NONE'}
                                </span>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* TAB 4: ORDERS & POS (DISCONNECTED NOTICE) */}
              {activeTab === 'orders' && (
                <div className="p-8 rounded-2xl bg-slate-950/60 border border-slate-800 text-center space-y-4">
                  <div className="w-14 h-14 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-400 flex items-center justify-center mx-auto">
                    <ShoppingBag className="w-7 h-7" />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-white">{t('franchise.orders')}</h3>
                    <div className="mt-1 inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-800 text-amber-400 font-mono text-xs border border-amber-500/30">
                      <Lock className="w-3.5 h-3.5" />
                      <span>{t('module.notConnected')}</span>
                    </div>
                  </div>
                  <p className="text-xs text-slate-400 max-w-md mx-auto leading-relaxed">
                    {t('module.posPending')}
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 max-w-lg mx-auto pt-2">
                    <div className="p-3 rounded-lg bg-slate-900 border border-slate-800 text-slate-400 text-xs">
                      <span className="block text-[10px] uppercase font-bold text-slate-500">Orders Today</span>
                      <span className="font-mono text-base font-bold text-slate-300">N/A</span>
                    </div>
                    <div className="p-3 rounded-lg bg-slate-900 border border-slate-800 text-slate-400 text-xs">
                      <span className="block text-[10px] uppercase font-bold text-slate-500">Revenue Today</span>
                      <span className="font-mono text-base font-bold text-slate-300">N/A</span>
                    </div>
                    <div className="p-3 rounded-lg bg-slate-900 border border-slate-800 text-slate-400 text-xs">
                      <span className="block text-[10px] uppercase font-bold text-slate-500">Avg Check</span>
                      <span className="font-mono text-base font-bold text-slate-300">N/A</span>
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 5: CRM & CUSTOMERS (DISCONNECTED NOTICE) */}
              {activeTab === 'crm' && (
                <div className="p-8 rounded-2xl bg-slate-950/60 border border-slate-800 text-center space-y-4">
                  <div className="w-14 h-14 rounded-2xl bg-blue-500/10 border border-blue-500/20 text-blue-400 flex items-center justify-center mx-auto">
                    <HeartHandshake className="w-7 h-7" />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-white">{t('franchise.customers')}</h3>
                    <div className="mt-1 inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-800 text-blue-400 font-mono text-xs border border-blue-500/30">
                      <Lock className="w-3.5 h-3.5" />
                      <span>{t('module.notConnected')}</span>
                    </div>
                  </div>
                  <p className="text-xs text-slate-400 max-w-md mx-auto leading-relaxed">
                    {t('module.crmPending')}
                  </p>
                </div>
              )}

              {/* TAB 6: RATINGS & REVIEWS (DISCONNECTED NOTICE) */}
              {activeTab === 'ratings' && (
                <div className="p-8 rounded-2xl bg-slate-950/60 border border-slate-800 text-center space-y-4">
                  <div className="w-14 h-14 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-400 flex items-center justify-center mx-auto">
                    <Star className="w-7 h-7" />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-white">{t('franchise.ratings')}</h3>
                    <div className="mt-1 inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-800 text-amber-400 font-mono text-xs border border-amber-500/30">
                      <Lock className="w-3.5 h-3.5" />
                      <span>{t('module.notConnected')}</span>
                    </div>
                  </div>
                  <p className="text-xs text-slate-400 max-w-md mx-auto leading-relaxed">
                    {language === 'ru'
                      ? 'Модуль агрегации отзывов и среднего рейтинга ресторанов франшизы будет подключен вместе с мобильным приложением гостей.'
                      : 'Müşderi seslenmeleri we şahamça reýting moduly myhman mobil goşundysy bilen bilelikde birikdiriler.'}
                  </p>
                </div>
              )}

              {/* TAB 7: FINANCIALS & P&L (DISCONNECTED NOTICE) */}
              {activeTab === 'finance' && (
                <div className="p-8 rounded-2xl bg-slate-950/60 border border-slate-800 text-center space-y-4">
                  <div className="w-14 h-14 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center justify-center mx-auto">
                    <DollarSign className="w-7 h-7" />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-white">{t('franchise.financials')}</h3>
                    <div className="mt-1 inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-800 text-emerald-400 font-mono text-xs border border-emerald-500/30">
                      <Lock className="w-3.5 h-3.5" />
                      <span>{t('module.notConnected')}</span>
                    </div>
                  </div>
                  <p className="text-xs text-slate-400 max-w-md mx-auto leading-relaxed">
                    {t('module.financePending')}
                  </p>
                </div>
              )}

              {/* TAB 8: ACTIVITY LOG */}
              {activeTab === 'activity' && (
                <div className="space-y-4">
                  <div className="rounded-xl border border-slate-800 overflow-hidden bg-slate-950/40">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-900/80 border-b border-slate-800 text-slate-400 font-bold uppercase tracking-wider text-[10px]">
                        <tr>
                          <th className="py-3 px-4">Date</th>
                          <th className="py-3 px-4">Action</th>
                          <th className="py-3 px-4">User</th>
                          <th className="py-3 px-4">Details</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/60">
                        {activityLogs.length === 0 ? (
                          <tr>
                            <td colSpan={4} className="py-8 text-center text-slate-500">
                              {t('common.noData')}
                            </td>
                          </tr>
                        ) : (
                          activityLogs.map(log => (
                            <tr key={log.id} className="hover:bg-slate-800/30 transition-colors">
                              <td className="py-3 px-4 font-mono text-[11px] text-slate-400">
                                {new Date(log.created_at).toLocaleString()}
                              </td>
                              <td className="py-3 px-4">
                                <span className="px-2 py-0.5 rounded font-mono text-[10px] font-bold bg-slate-800 text-amber-400 border border-slate-700">
                                  {log.action}
                                </span>
                              </td>
                              <td className="py-3 px-4 text-slate-300">{log.user_name || 'System'}</td>
                              <td className="py-3 px-4 text-slate-400 max-w-xs truncate">
                                {log.changes ? JSON.stringify(log.changes) : '—'}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-slate-800 bg-slate-900/90 flex items-center justify-between">
          <div className="text-xs text-slate-500 font-mono">
            FRANCHISE_ID: {franchiseId}
          </div>
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold border border-slate-700 transition-colors"
          >
            {t('common.close')}
          </button>
        </div>
      </div>
    </div>
  );
};
