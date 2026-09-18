import React, { useState, useEffect } from 'react';
import {
  Users,
  Building2,
  Building,
  ShieldCheck,
  Key,
  FileText,
  Activity,
  CheckCircle2,
  Server,
  Lock,
  ArrowUpRight,
  Sparkles,
  RefreshCw,
  ShoppingBag,
  HeartHandshake,
  DollarSign
} from 'lucide-react';
import { api } from '../api';
import { SystemTelemetry, FranchiseOverview } from '../types';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { NavTab } from './Sidebar';

interface DashboardViewProps {
  onNavigate: (tab: NavTab) => void;
  onOpenTestModal: () => void;
  acceptanceTestsEnabled?: boolean;
}

export const DashboardView: React.FC<DashboardViewProps> = ({ onNavigate, onOpenTestModal, acceptanceTestsEnabled = false }) => {
  const { user, selectedFranchiseFilter } = useAuth();
  const { t, language } = useLanguage();
  const [telemetry, setTelemetry] = useState<SystemTelemetry | null>(null);
  const [franchiseOverview, setFranchiseOverview] = useState<FranchiseOverview | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchStats = async () => {
    try {
      setLoading(true);
      const data = await api.getStats();
      setTelemetry(data);

      if (selectedFranchiseFilter && selectedFranchiseFilter !== 'ALL') {
        try {
          const fData = await api.getFranchiseOverview(selectedFranchiseFilter);
          setFranchiseOverview(fData);
        } catch {
          setFranchiseOverview(null);
        }
      } else {
        setFranchiseOverview(null);
      }
    } catch (err) {
      console.error('Failed to load system telemetry:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStats();
  }, [selectedFranchiseFilter]);

  return (
    <div id="view-dashboard" className="p-8 space-y-8 max-w-7xl mx-auto">
      {/* Welcome Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-6 rounded-2xl bg-gradient-to-r from-slate-900 via-slate-900 to-slate-800/80 border border-slate-800 shadow-xl">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-amber-500/15 text-amber-400 border border-amber-500/25">
              BOOM OS
            </span>
            <span className="text-slate-400 text-xs font-mono">• Foundation Kernel Active</span>
          </div>
          <h2 className="text-2xl font-black text-white tracking-tight">
            {t('nav.dashboard')} — Central Server
          </h2>
          <p className="text-sm text-slate-400 mt-1 max-w-2xl">
            {language === 'ru'
              ? 'Централизованная система управления сетью ресторанов BOOMBURGER. Управление мульти-филиальным доступом, франшизами, RBAC безопасностью и неизменяемым криптографическим аудитом.'
              : 'BOOMBURGER restoranlar ulgamy üçin merkezi dolandyryş ulgamy. Şahamçalary, franşizalary, RBAC howpsuzlygyny we üýtgewsiz audit ýazgylaryny dolandyrýar.'}
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={fetchStats}
            className="p-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors border border-slate-700"
            title="Refresh System Telemetry"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-amber-400' : ''}`} />
          </button>
          {acceptanceTestsEnabled && (
            <button
              id="btn-dash-run-tests"
              onClick={onOpenTestModal}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs tracking-wide shadow-lg shadow-amber-500/20 transition-all cursor-pointer"
            >
              <Sparkles className="w-4 h-4" />
              <span>Acceptance Tests</span>
            </button>
          )}
        </div>
      </div>

      {/* Franchise Scoped Focus Card (when selectedFranchiseFilter !== 'ALL') */}
      {selectedFranchiseFilter !== 'ALL' && franchiseOverview && (
        <div className="p-6 rounded-2xl bg-amber-500/5 border border-amber-500/20 space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400">
                <Building className="w-5 h-5" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono font-bold bg-amber-500/20 text-amber-300 px-2 py-0.5 rounded border border-amber-500/30">
                    {franchiseOverview.franchise.code}
                  </span>
                  <h3 className="text-lg font-bold text-white">
                    {franchiseOverview.franchise.name} ({t('nav.franchises')} Scope)
                  </h3>
                </div>
                <p className="text-xs text-slate-400 mt-0.5">
                  {franchiseOverview.franchise.legal_name} • {franchiseOverview.franchise.contact_name}
                </p>
              </div>
            </div>

            <button
              onClick={() => onNavigate('franchises')}
              className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-amber-400 text-xs font-semibold transition-colors flex items-center gap-1.5"
            >
              <span>{t('franchise.card')}</span>
              <ArrowUpRight className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2">
            <div className="p-3.5 rounded-xl bg-slate-900/90 border border-slate-800">
              <span className="text-[10px] uppercase font-bold text-slate-400 block mb-1">
                {t('franchise.totalBranches')}
              </span>
              <div className="text-xl font-bold text-white">{franchiseOverview.metrics.total_branches}</div>
              <span className="text-[11px] text-emerald-400 font-semibold">
                {franchiseOverview.metrics.active_branches} {t('status.active').toLowerCase()}
              </span>
            </div>

            <div className="p-3.5 rounded-xl bg-slate-900/90 border border-slate-800">
              <span className="text-[10px] uppercase font-bold text-slate-400 block mb-1">
                {t('franchise.totalEmployees')}
              </span>
              <div className="text-xl font-bold text-white">{franchiseOverview.metrics.total_employees}</div>
              <span className="text-[11px] text-emerald-400 font-semibold">
                {franchiseOverview.metrics.active_employees} {t('status.active').toLowerCase()}
              </span>
            </div>

            <div className="p-3.5 rounded-xl bg-slate-900/90 border border-slate-800">
              <span className="text-[10px] uppercase font-bold text-slate-400 block mb-1">
                {t('franchise.orders')} (POS)
              </span>
              <div className="text-xl font-bold text-slate-400">N/A</div>
              <span className="text-[11px] text-amber-400 font-medium">
                {t('module.notConnected')}
              </span>
            </div>

            <div className="p-3.5 rounded-xl bg-slate-900/90 border border-slate-800">
              <span className="text-[10px] uppercase font-bold text-slate-400 block mb-1">
                {t('franchise.financials')} (P&L)
              </span>
              <div className="text-xl font-bold text-slate-400">N/A</div>
              <span className="text-[11px] text-amber-400 font-medium">
                {t('module.notConnected')}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Primary Foundation Metrics (No sales/KPI as mandated) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        {/* Users */}
        <div
          onClick={() => onNavigate('users')}
          className="p-5 rounded-xl bg-slate-900/80 border border-slate-800 hover:border-slate-700 transition-all cursor-pointer group"
        >
          <div className="flex items-center justify-between text-slate-400 mb-3">
            <span className="text-xs font-semibold uppercase tracking-wider">{t('nav.users')}</span>
            <div className="p-2 rounded-lg bg-blue-500/10 text-blue-400 group-hover:scale-110 transition-transform">
              <Users className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-black text-white tracking-tight">
            {telemetry?.stats.users.total ?? 0}
          </div>
          <p className="text-xs text-slate-400 mt-1">
            <span className="text-emerald-400 font-semibold">{telemetry?.stats.users.active ?? 0} active</span>
          </p>
        </div>

        {/* Branches */}
        <div
          onClick={() => onNavigate('branches')}
          className="p-5 rounded-xl bg-slate-900/80 border border-slate-800 hover:border-slate-700 transition-all cursor-pointer group"
        >
          <div className="flex items-center justify-between text-slate-400 mb-3">
            <span className="text-xs font-semibold uppercase tracking-wider">{t('nav.branches')}</span>
            <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400 group-hover:scale-110 transition-transform">
              <Building2 className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-black text-white tracking-tight">
            {telemetry?.stats.branches.total ?? 0}
          </div>
          <p className="text-xs text-slate-400 mt-1">
            <span className="text-emerald-400 font-semibold">{telemetry?.stats.branches.active ?? 0} operational</span>
          </p>
        </div>

        {/* Franchises */}
        <div
          onClick={() => onNavigate('franchises')}
          className="p-5 rounded-xl bg-slate-900/80 border border-slate-800 hover:border-slate-700 transition-all cursor-pointer group"
        >
          <div className="flex items-center justify-between text-slate-400 mb-3">
            <span className="text-xs font-semibold uppercase tracking-wider">{t('nav.franchises')}</span>
            <div className="p-2 rounded-lg bg-amber-500/10 text-amber-400 group-hover:scale-110 transition-transform">
              <Building className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-black text-white tracking-tight">
            {telemetry?.stats.franchises?.total ?? 0}
          </div>
          <p className="text-xs text-slate-400 mt-1">
            <span className="text-emerald-400 font-semibold">{telemetry?.stats.franchises?.active ?? 0} active</span>
          </p>
        </div>

        {/* Roles & Permissions */}
        <div
          onClick={() => onNavigate('roles')}
          className="p-5 rounded-xl bg-slate-900/80 border border-slate-800 hover:border-slate-700 transition-all cursor-pointer group"
        >
          <div className="flex items-center justify-between text-slate-400 mb-3">
            <span className="text-xs font-semibold uppercase tracking-wider">{t('nav.roles')}</span>
            <div className="p-2 rounded-lg bg-purple-500/10 text-purple-400 group-hover:scale-110 transition-transform">
              <ShieldCheck className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-black text-white tracking-tight">
            {telemetry?.stats.roles.total ?? 0}
          </div>
          <p className="text-xs text-slate-400 mt-1">RBAC matrix active</p>
        </div>

        {/* Audit Events */}
        <div
          onClick={() => onNavigate('audit')}
          className="p-5 rounded-xl bg-slate-900/80 border border-slate-800 hover:border-slate-700 transition-all cursor-pointer group"
        >
          <div className="flex items-center justify-between text-slate-400 mb-3">
            <span className="text-xs font-semibold uppercase tracking-wider">{t('nav.audit')}</span>
            <div className="p-2 rounded-lg bg-rose-500/10 text-rose-400 group-hover:scale-110 transition-transform">
              <FileText className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-black text-white tracking-tight">
            {telemetry?.stats.auditLogsTotal ?? 0}
          </div>
          <p className="text-xs text-slate-400 mt-1">Immutable records</p>
        </div>
      </div>

      {/* System Status & Architectural Guard */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Subsystem Readiness Matrix */}
        <div className="lg:col-span-2 p-6 rounded-2xl bg-slate-900/70 border border-slate-800 space-y-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <Server className="w-5 h-5 text-amber-400" />
              <h3 className="text-base font-bold text-white">System Foundation Status</h3>
            </div>
            <span className={`text-xs font-mono px-2.5 py-1 rounded-full flex items-center gap-1.5 ${
              telemetry?.systemStatus?.database === 'CONNECTED'
                ? 'text-emerald-400 bg-emerald-500/10 border border-emerald-500/20'
                : 'text-amber-400 bg-amber-500/10 border border-amber-500/20'
            }`}>
              <span className={`w-2 h-2 rounded-full ${telemetry?.systemStatus?.database === 'CONNECTED' ? 'bg-emerald-400' : 'bg-amber-400'}`}></span>
              {telemetry?.systemStatus?.database === 'CONNECTED' ? 'DATABASE CONNECTED' : 'DATABASE STATUS UNKNOWN'}
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            <div className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800/80 flex items-start gap-3">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 mt-0.5 flex-shrink-0" />
              <div>
                <span className="font-bold text-slate-200 block">Database: PostgreSQL Relational</span>
                <span className="text-slate-400 text-[11px]">Normalized tables, foreign keys, unique constraints, indices enabled.</span>
              </div>
            </div>

            <div className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800/80 flex items-start gap-3">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 mt-0.5 flex-shrink-0" />
              <div>
                <span className="font-bold text-slate-200 block">Authentication: JWT + Bcrypt</span>
                <span className="text-slate-400 text-[11px]">Passwords securely hashed, never sent to frontend.</span>
              </div>
            </div>

            <div className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800/80 flex items-start gap-3">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 mt-0.5 flex-shrink-0" />
              <div>
                <span className="font-bold text-slate-200 block">Hierarchy: FRANCHISE → BRANCH → EMPLOYEES</span>
                <span className="text-slate-400 text-[11px]">Strict 3-tier boundary enforced on all operations.</span>
              </div>
            </div>

            <div className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800/80 flex items-start gap-3">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 mt-0.5 flex-shrink-0" />
              <div>
                <span className="font-bold text-slate-200 block">Cryptographic Security Audit Log</span>
                <span className="text-slate-400 text-[11px]">Every critical data mutation logs user, branch, before/after states.</span>
              </div>
            </div>
          </div>

          <div className="p-4 rounded-xl bg-amber-500/5 border border-amber-500/20 text-xs text-slate-300 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Lock className="w-4 h-4 text-amber-400 flex-shrink-0" />
              <span>
                <strong>Architectural Boundary:</strong> POS, Kitchen, Menu and Inventory are active operational modules; CRM remains reserved for a subsequent phase.
              </span>
            </div>
          </div>
        </div>

        {/* Current Active Persona & Branch Context */}
        <div className="p-6 rounded-2xl bg-slate-900/70 border border-slate-800 flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-2 mb-4">
              <Activity className="w-5 h-5 text-amber-400" />
              <h3 className="text-base font-bold text-white">Active Session IAM</h3>
            </div>

            {user && (
              <div className="space-y-3">
                <div className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800">
                  <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                    Authenticated User
                  </div>
                  <div className="font-bold text-sm text-white">{user.full_name}</div>
                  <div className="text-xs text-slate-400">{user.email}</div>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {user.roles.map(r => (
                      <span key={r.id} className="text-[10px] font-bold px-2 py-0.5 rounded bg-purple-500/15 text-purple-300 border border-purple-500/25">
                        {r.code}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800">
                  <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                    Branch Authority Scope
                  </div>
                  <div className="text-xs text-slate-300 font-semibold">
                    {user.isSuperUser ? (
                      <span className="text-emerald-400">Universal Access (All Branches in Network)</span>
                    ) : (
                      <span>{user.allowedBranchIds?.length || 0} Assigned Branches</span>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="pt-4 border-t border-slate-800/80">
            <button
              onClick={() => onNavigate('audit')}
              className="w-full flex items-center justify-center gap-2 text-xs font-semibold text-amber-400 hover:text-amber-300 transition-colors"
            >
              <span>Inspect Audit Trail</span>
              <ArrowUpRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Recent System Activity Stream */}
      <div className="p-6 rounded-2xl bg-slate-900/70 border border-slate-800 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-bold text-white flex items-center gap-2">
            <FileText className="w-4 h-4 text-amber-400" />
            <span>Recent System Activity</span>
          </h3>
          <button
            onClick={() => onNavigate('audit')}
            className="text-xs font-semibold text-slate-400 hover:text-white transition-colors"
          >
            View all logs →
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-800 text-slate-400 uppercase font-bold text-[10px] tracking-wider">
                <th className="py-2.5 px-3">Timestamp</th>
                <th className="py-2.5 px-3">Action</th>
                <th className="py-2.5 px-3">Entity</th>
                <th className="py-2.5 px-3">User</th>
                <th className="py-2.5 px-3">Branch</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 font-medium">
              {telemetry?.recentActivities?.length ? telemetry.recentActivities.map((act) => (
                <tr key={act.id} className="hover:bg-slate-800/40 transition-colors">
                  <td className="py-2.5 px-3 text-slate-400 font-mono text-[11px]">
                    {new Date(act.created_at).toLocaleString()}
                  </td>
                  <td className="py-2.5 px-3">
                    <span className="px-2 py-0.5 rounded font-mono text-[10px] font-bold bg-slate-800 text-amber-400 border border-slate-700">
                      {act.action}
                    </span>
                  </td>
                  <td className="py-2.5 px-3 text-slate-300 font-mono">{act.entity_type}</td>
                  <td className="py-2.5 px-3 text-slate-200">{act.user_name || 'System'}</td>
                  <td className="py-2.5 px-3 text-slate-400">{act.branch_name || 'HQ / Global'}</td>
                </tr>
              )) : (
                <tr><td colSpan={5} className="py-8 text-center text-slate-500">{language === 'ru' ? 'Нет данных' : 'Maglumat ýok'}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
