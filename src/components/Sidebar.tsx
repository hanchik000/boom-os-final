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
  Wallet,
  Gauge,
  Radio,
  Scale,
  Percent,
  BarChart3,
  ScrollText,
  MonitorPlay, MonitorSmartphone,
  PanelsTopLeft,
  Tag,
  ImagePlus,
  Palette,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { useBranding } from '../context/BrandingContext';
import { TranslationKey } from '../translations/ru';

export type NavTab = 'dashboard' | 'commandCenter' | 'liveOperations' | 'menu' | 'organization' | 'franchises' | 'branches' | 'employees' | 'users' | 'roles' | 'rbac' | 'inventory' | 'operations' | 'cashierPos' | 'receiptSettings' | 'orderApprovals' | 'creditReports' | 'foodCost' | 'analytics' | 'boomcardJournal' | 'serviceCharge' | 'posMedia' | 'visualCatalog' | 'menuMedia' | 'promotions' | 'boomcard' | 'customers' | 'settings' | 'audit' | 'branding' | 'menuPreview';

interface SidebarProps {
  currentTab: NavTab;
  onSelectTab: (tab: NavTab) => void;
  onOpenTestModal: () => void;
  acceptanceTestsEnabled?: boolean;
}

export const Sidebar: React.FC<SidebarProps> = ({ currentTab, onSelectTab, onOpenTestModal, acceptanceTestsEnabled = false }) => {
  const { user, logout, hasPermission } = useAuth();
  const { t } = useLanguage();
  const { branding } = useBranding();

  // Stage 36 -- one grouped ADMIN information architecture instead of a flat 29-entry list.
  //
  // This also fixes a real, user-visible defect: `menu` and `inventory` both rendered the
  // `nav.inventory` label ("Склад и Inventory") and `operations` and `orderApprovals` both
  // rendered `nav.orders`, so two different destinations appeared under the same name twice in
  // the sidebar. Each entry now has its own key. No route, permission or component changed --
  // only the grouping and the labels.
  const navGroups: Array<{ id: string; key: TranslationKey; items: Array<{ id: NavTab; key: TranslationKey; icon: any; permission?: string }> }> = [
    { id: 'overview', key: 'nav.group.overview', items: [
      { id: 'dashboard', key: 'nav.dashboard', icon: LayoutDashboard },
      { id: 'commandCenter', key: 'nav.commandCenter', icon: Gauge, permission: 'dashboard.view' },
      { id: 'liveOperations', key: 'nav.liveOperations', icon: Radio, permission: 'operations.view' },
    ] },
    { id: 'operations', key: 'nav.group.operations', items: [
      { id: 'operations', key: 'nav.operations', icon: MonitorCog, permission: 'orders.view' },
      { id: 'orderApprovals', key: 'nav.orderApprovals', icon: ClipboardCheck, permission: 'orders.item_remove.approve' },
      { id: 'cashierPos', key: 'nav.cashierPos', icon: CreditCard, permission: 'payments.create' },
    ] },
    { id: 'menu', key: 'nav.group.menu', items: [
      { id: 'menu', key: 'nav.menu', icon: UtensilsCrossed, permission: 'menu.view' },
      { id: 'menuMedia', key: 'nav.menuMedia', icon: ImagePlus, permission: 'menu.media.view' },
      { id: 'visualCatalog', key: 'nav.visualCatalog', icon: PanelsTopLeft, permission: 'visual_catalog.view' },
      { id: 'promotions', key: 'nav.promotions', icon: Tag, permission: 'promotions.view' },
      { id: 'menuPreview', key: 'nav.menuPreview', icon: MonitorSmartphone, permission: 'menu.view' },
    ] },
    { id: 'kitchen', key: 'nav.group.kitchen', items: [
      { id: 'foodCost', key: 'nav.foodCost', icon: Scale, permission: 'food_cost.view' },
      { id: 'inventory', key: 'nav.inventory', icon: Boxes, permission: 'inventory.view' },
    ] },
    // Stage 36: everything that CONFIGURES a POS terminal lives in one group. The POS screens
    // themselves stay in Operations -- this group is settings, not operations.
    { id: 'pos', key: 'nav.group.pos', items: [
      { id: 'posMedia', key: 'nav.posMedia', icon: MonitorPlay, permission: 'pos.media.view' },
      { id: 'receiptSettings', key: 'nav.receiptSettings', icon: Printer, permission: 'print.manage' },
      { id: 'serviceCharge', key: 'nav.serviceCharge', icon: Percent, permission: 'service_charge.view' },
    ] },
    { id: 'customers', key: 'nav.group.customers', items: [
      { id: 'customers', key: 'nav.customers', icon: Users, permission: 'customers.view' },
      { id: 'boomcard', key: 'nav.boomcard', icon: CreditCard, permission: 'boomcard.view' },
      { id: 'boomcardJournal', key: 'nav.boomcardJournal', icon: ScrollText, permission: 'boomcard.journal.view' },
      { id: 'creditReports', key: 'nav.creditReports', icon: Wallet, permission: 'credit.reports' },
    ] },
    { id: 'staff', key: 'nav.group.staff', items: [
      { id: 'employees', key: 'nav.employees', icon: BriefcaseBusiness, permission: 'employees.view' },
      { id: 'users', key: 'nav.users', icon: Users, permission: 'users.view' },
      { id: 'roles', key: 'nav.roles', icon: ShieldCheck, permission: 'roles.view' },
      { id: 'rbac', key: 'nav.rbacTest', icon: KeyRound, permission: 'rbac.test' },
    ] },
    { id: 'reports', key: 'nav.group.reports', items: [
      { id: 'analytics', key: 'nav.analytics', icon: BarChart3, permission: 'analytics.view' },
    ] },
    { id: 'settings', key: 'nav.group.settings', items: [
      { id: 'organization', key: 'nav.organization', icon: Network, permission: 'franchises.view' },
      { id: 'franchises', key: 'nav.franchises', icon: Building, permission: 'franchises.view' },
      { id: 'branches', key: 'nav.branches', icon: Building2, permission: 'branches.view' },
      { id: 'branding', key: 'nav.branding', icon: Palette, permission: 'settings.view' },
      { id: 'settings', key: 'nav.settings', icon: Sliders, permission: 'settings.view' },
      { id: 'audit', key: 'nav.audit', icon: History, permission: 'audit.view' },
    ] },
  ];

  const futureModules = [
    { name: 'Boomcard & Coin' },
    { name: 'CRM & Guests' },
    { name: 'Finance Ledger' },
    { name: 'Executive Analytics' }
  ];

  return (
    <aside id="boom-sidebar" className="w-64 flex-shrink-0 bg-slate-900 border-r border-slate-800 flex flex-col justify-between select-none">
      {/* Brand Header -- Stage 36: rendered from the ONE branding source of truth
          (system_settings BRANDING_*), never a hardcoded literal. */}
      <div>
        <div className="p-5 border-b border-slate-800/80">
          <div className="flex items-center gap-3">
            {branding.logo_url ? (
              <img src={branding.logo_url} alt={branding.product_name} className="w-10 h-10 rounded-xl object-cover shadow-lg shadow-amber-500/20" />
            ) : (
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500 to-red-600 flex items-center justify-center font-black text-xl text-slate-950 shadow-lg shadow-amber-500/20">
                {branding.mark}
              </div>
            )}
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-extrabold text-base tracking-wider text-white truncate">{branding.product_name}</span>
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20 uppercase tracking-wider">
                  Core
                </span>
              </div>
              {branding.network_name && <p className="text-xs font-medium text-slate-400 truncate">{branding.network_name}</p>}
            </div>
          </div>
        </div>

        {/* Primary Admin Navigation -- Stage 36: grouped IA, each entry with its own label. */}
        <div className="p-3 space-y-3">
          {navGroups.map((group) => {
            const visible = group.items.filter((item) => !item.permission || hasPermission(item.permission));
            if (!visible.length) return null;
            return (
              <div key={group.id}>
                <div className="px-3 py-1.5 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                  {t(group.key)}
                </div>
                <nav className="space-y-1">
                  {visible.map((item) => {
                    const Icon = item.icon;
                    const isActive = currentTab === item.id;
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
            );
          })}
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
