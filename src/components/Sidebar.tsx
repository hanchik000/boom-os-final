import React from 'react';
import {
  LayoutDashboard,
  Users,
  ShieldCheck,
  Building2,
  Network,
  Building,
  Sliders,
  History,
  Lock,
  LogOut,
  ChevronRight,
  Sparkles,
  UtensilsCrossed,
  FileCode,
  KeyRound,
  BriefcaseBusiness,
  Boxes,
  ClipboardCheck,
  MonitorCog,
  CreditCard,
  Printer,
  Wallet
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { TranslationKey } from '../translations/ru';

export type NavTab = 'dashboard' | 'menu' | 'organization' | 'franchises' | 'branches' | 'employees' | 'users' | 'roles' | 'rbac' | 'inventory' | 'operations' | 'cashierPos' | 'receiptSettings' | 'orderApprovals' | 'creditReports' | 'settings' | 'audit';

interface SidebarProps {
  currentTab: NavTab;
  onSelectTab: (tab: NavTab) => void;
  onOpenTestModal: () => void;
  acceptanceTestsEnabled?: boolean;
}

export const Sidebar: React.FC<SidebarProps> = ({ currentTab, onSelectTab, onOpenTestModal, acceptanceTestsEnabled = false }) => {
  const { user, logout, hasPermission } = useAuth();
  const { t } = useLanguage();

  const primaryNavItems: Array<{ id: NavTab; key: TranslationKey; icon: any; permission?: string }> = [
    { id: 'dashboard', key: 'nav.dashboard', icon: LayoutDashboard },
    { id: 'organization', key: 'nav.organization', icon: Network, permission: 'franchises.view' },
    { id: 'franchises', key: 'nav.franchises', icon: Building, permission: 'franchises.view' },
    { id: 'branches', key: 'nav.branches', icon: Building2, permission: 'branches.view' },
    { id: 'employees', key: 'nav.employees', icon: BriefcaseBusiness, permission: 'employees.view' },
    { id: 'users', key: 'nav.users', icon: Users, permission: 'users.view' },
    { id: 'roles', key: 'nav.roles', icon: ShieldCheck, permission: 'roles.view' },
    { id: 'rbac', key: 'nav.rbacTest', icon: KeyRound, permission: 'rbac.test' },
    { id: 'menu', key: 'nav.inventory', icon: UtensilsCrossed, permission: 'menu.view' },
    { id: 'inventory', key: 'nav.inventory', icon: Boxes, permission: 'inventory.view' },
    { id: 'operations', key: 'nav.orders', icon: MonitorCog, permission: 'orders.view' },
    { id: 'cashierPos', key: 'nav.cashierPos', icon: CreditCard, permission: 'payments.create' },
    { id: 'receiptSettings', key: 'nav.receiptSettings', icon: Printer, permission: 'print.manage' },
    { id: 'orderApprovals', key: 'nav.orders', icon: ClipboardCheck, permission: 'orders.item_remove.approve' },
    { id: 'creditReports', key: 'nav.creditReports', icon: Wallet, permission: 'credit.reports' },
    { id: 'settings', key: 'nav.settings', icon: Sliders, permission: 'settings.view' },
    { id: 'audit', key: 'nav.audit', icon: History, permission: 'audit.view' },
  ];

  const futureModules = [
    { name: 'Boomcard & Coin' },
    { name: 'CRM & Guests' },
    { name: 'Finance Ledger' },
    { name: 'Executive Analytics' }
  ];

  return (
    <aside id="boom-sidebar" className="w-64 flex-shrink-0 bg-slate-900 border-r border-slate-800 flex flex-col justify-between select-none">
      {/* Brand Header */}
      <div>
        <div className="p-5 border-b border-slate-800/80">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500 to-red-600 flex items-center justify-center font-black text-xl text-slate-950 shadow-lg shadow-amber-500/20">
              B
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-extrabold text-base tracking-wider text-white">BOOM OS</span>
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20 uppercase tracking-wider">
                  Core
                </span>
              </div>
              <p className="text-xs font-medium text-slate-400">BOOMBURGER Network</p>
            </div>
          </div>
        </div>

        {/* Primary Admin Navigation */}
        <div className="p-3">
          <div className="px-3 py-2 text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
            HQ Management
          </div>
          <nav className="space-y-1">
            {primaryNavItems.map((item) => {
              const Icon = item.icon;
              const isAllowed = !item.permission || hasPermission(item.permission);
              const isActive = currentTab === item.id;

              if (!isAllowed) return null;

              return (
                <button
                  key={item.id}
                  id={`nav-${item.id}`}
                  onClick={() => onSelectTab(item.id)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${
                    isActive
                      ? 'bg-amber-500/15 text-amber-300 font-semibold border border-amber-500/30'
                      : 'text-slate-300 hover:text-white hover:bg-slate-800/60'
                  }`}
                >
                  <Icon className={`w-4 h-4 ${isActive ? 'text-amber-400' : 'text-slate-400'}`} />
                  <span className="flex-1 text-left">{t(item.key)}</span>
                  {isActive && <ChevronRight className="w-3.5 h-3.5 text-amber-400" />}
                </button>
              );
            })}
          </nav>
        </div>

        {/* Future Modules Section (Architectural readiness, strict phase 1 boundary) */}
        <div className="px-3 pt-2">
          <div className="px-3 py-1.5 flex items-center justify-between text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
            <span>Future Modules</span>
            <span className="text-[9px] px-1.5 py-0.2 rounded bg-slate-800 text-slate-400 font-mono">
              Phase 2
            </span>
          </div>
          <div className="space-y-0.5 mt-1">
            {futureModules.map((m, idx) => (
              <div
                key={idx}
                className="flex items-center justify-between px-3 py-1.5 rounded text-xs text-slate-500 cursor-not-allowed opacity-60 hover:opacity-80 transition-opacity"
                title="Business module intentionally not activated in Phase 1 foundation"
              >
                <span className="truncate">{m.name}</span>
                <Lock className="w-3 h-3 text-slate-600" />
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Footer Profile & Acceptance Test Action */}
      <div className="p-3 border-t border-slate-800/80 bg-slate-950/40 space-y-2">
        <a
          id="btn-sidebar-swagger-docs"
          href="/api/docs"
          target="_blank"
          rel="noopener noreferrer"
          className="w-full flex items-center justify-center gap-2 px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-amber-400 hover:text-amber-300 text-xs font-semibold border border-amber-500/20 hover:border-amber-500/40 transition-colors"
        >
          <FileCode className="w-3.5 h-3.5" />
          <span>Swagger / OpenAPI Docs</span>
        </a>

        {acceptanceTestsEnabled && (
          <button
            id="btn-run-acceptance-tests"
            onClick={onOpenTestModal}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold border border-slate-700 transition-colors"
          >
            <Sparkles className="w-3.5 h-3.5 text-amber-400" />
            <span>Verify Acceptance Tests</span>
          </button>
        )}

        {user && (
          <div className="flex items-center justify-between gap-2 p-2 rounded-lg bg-slate-900 border border-slate-800">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-8 h-8 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center text-xs font-bold text-slate-200 overflow-hidden flex-shrink-0">
                {user.avatar_url ? (
                  <img src={user.avatar_url} alt={user.full_name} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                ) : (
                  user.full_name.slice(0, 2).toUpperCase()
                )}
              </div>
              <div className="min-w-0">
                <p className="text-xs font-semibold text-slate-200 truncate">{user.full_name}</p>
                <div className="flex items-center gap-1">
                  <span className="text-[10px] font-medium text-amber-400 font-mono truncate">
                    {user.roles[0]?.code || 'USER'}
                  </span>
                </div>
              </div>
            </div>
            <button
              id="btn-sidebar-logout"
              onClick={logout}
              className="p-1.5 text-slate-400 hover:text-red-400 hover:bg-slate-800 rounded transition-colors"
              title="Logout"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
    </aside>
  );
};
