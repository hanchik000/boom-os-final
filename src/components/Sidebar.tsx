import React, { useEffect, useState } from 'react';
import {
  ChefHat,
  PackageCheck,
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

export type NavTab = 'dashboard' | 'commandCenter' | 'liveOperations' | 'menu' | 'organization' | 'franchises' | 'branches' | 'employees' | 'users' | 'roles' | 'rbac' | 'inventory' | 'operations' | 'cashierPos' | 'receiptSettings' | 'orderApprovals' | 'creditReports' | 'foodCost' | 'analytics' | 'boomcardJournal' | 'serviceCharge' | 'posMedia' | 'visualCatalog' | 'menuMedia' | 'promotions' | 'boomcard' | 'customers' | 'settings' | 'audit' | 'branding' | 'menuPreview' | 'kitchen' | 'expo' | 'kitchenLoad';

interface SidebarProps {
  currentTab: NavTab;
  onSelectTab: (tab: NavTab) => void;
  onOpenTestModal: () => void;
  acceptanceTestsEnabled?: boolean;
  /** Stage 44: on a phone the sidebar is a drawer; these say whether it is open and how to close it. */
  drawerOpen?: boolean;
  onCloseDrawer?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ currentTab, onSelectTab, onOpenTestModal, acceptanceTestsEnabled = false, drawerOpen = false, onCloseDrawer }) => {
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
  // ---------------------------------------------------------------------------------------------
  // Stage 40 -- POWERFUL INSIDE, SIMPLE OUTSIDE.
  //
  // Before this the sidebar showed 31 destinations at once, in nine always-expanded groups. Every
  // route, permission and component is unchanged; what changed is how many of them a person has
  // to read before finding the one they need.
  //
  //  * Nine everyday sections, shown as nine rows. A section opens on click and the one holding
  //    the current screen opens by itself, so the list stays short instead of growing to 31.
  //  * A section with a single screen navigates straight there -- no pointless second click.
  //  * Everything that CONFIGURES the system, rather than running it, moved into "Advanced
  //    settings" at the bottom, collapsed. Daily work never lives there: prices stay in Menu,
  //    payment stays in Sales, goods receipt stays in Stock.
  //  * Labels are what a new employee would call these things, not what the code calls them.
  //
  // Role relevance needs no new mechanism: each entry already declares the permission it needs,
  // and a section with nothing visible in it is not rendered at all. A waiter therefore never
  // sees Advanced settings, because every entry inside it is permission-gated.
  // ---------------------------------------------------------------------------------------------
  type NavEntry = { id: NavTab; key: TranslationKey; icon: any; permission?: string };
  type NavSection = { id: string; key: TranslationKey; icon: any; items: NavEntry[] };

  const navSections: NavSection[] = [
    { id: 'home', key: 'nav.group.home', icon: LayoutDashboard, items: [
      { id: 'dashboard', key: 'nav.dashboard', icon: LayoutDashboard },
    ] },
    { id: 'sales', key: 'nav.group.sales', icon: CreditCard, items: [
      { id: 'cashierPos', key: 'nav.cashierPos', icon: CreditCard, permission: 'payments.create' },
      { id: 'commandCenter', key: 'nav.commandCenter', icon: Gauge, permission: 'dashboard.view' },
    ] },
    { id: 'orders', key: 'nav.group.orders', icon: ClipboardCheck, items: [
      { id: 'operations', key: 'nav.operations', icon: MonitorCog, permission: 'orders.view' },
      { id: 'liveOperations', key: 'nav.liveOperations', icon: Radio, permission: 'operations.view' },
      { id: 'orderApprovals', key: 'nav.orderApprovals', icon: ClipboardCheck, permission: 'orders.item_remove.approve' },
      // Stage 42: the kitchen's own working screens. Daily operations, so they belong here and not
      // in "Расширенные настройки"; each is gated by the permission its API already demands.
      { id: 'kitchen', key: 'nav.kitchen', icon: ChefHat, permission: 'kds.view' },
      { id: 'expo', key: 'nav.expo', icon: PackageCheck, permission: 'kitchen.expo.view' },
      { id: 'kitchenLoad', key: 'nav.kitchenLoad', icon: Gauge, permission: 'kds.view' },
    ] },
    { id: 'menu', key: 'nav.group.menu', icon: UtensilsCrossed, items: [
      { id: 'menu', key: 'nav.menu', icon: UtensilsCrossed, permission: 'menu.view' },
      { id: 'menuPreview', key: 'nav.menuPreview', icon: MonitorSmartphone, permission: 'menu.view' },
      { id: 'visualCatalog', key: 'nav.visualCatalog', icon: PanelsTopLeft, permission: 'visual_catalog.view' },
      { id: 'menuMedia', key: 'nav.menuMedia', icon: ImagePlus, permission: 'menu.media.view' },
    ] },
    { id: 'stock', key: 'nav.group.stock', icon: Boxes, items: [
      { id: 'inventory', key: 'nav.inventory', icon: Boxes, permission: 'inventory.view' },
      { id: 'foodCost', key: 'nav.foodCost', icon: Scale, permission: 'food_cost.view' },
    ] },
    { id: 'staff', key: 'nav.group.staff', icon: BriefcaseBusiness, items: [
      { id: 'employees', key: 'nav.employees', icon: BriefcaseBusiness, permission: 'employees.view' },
      { id: 'users', key: 'nav.users', icon: Users, permission: 'users.view' },
    ] },
    { id: 'guests', key: 'nav.group.guests', icon: Users, items: [
      { id: 'customers', key: 'nav.customers', icon: Users, permission: 'customers.view' },
      { id: 'creditReports', key: 'nav.creditReports', icon: Wallet, permission: 'credit.reports' },
    ] },
    { id: 'marketing', key: 'nav.group.marketing', icon: Tag, items: [
      { id: 'promotions', key: 'nav.promotions', icon: Tag, permission: 'promotions.view' },
      { id: 'boomcard', key: 'nav.boomcard', icon: CreditCard, permission: 'boomcard.view' },
      { id: 'boomcardJournal', key: 'nav.boomcardJournal', icon: ScrollText, permission: 'boomcard.journal.view' },
    ] },
    { id: 'reports', key: 'nav.group.reports', icon: BarChart3, items: [
      { id: 'analytics', key: 'nav.analytics', icon: BarChart3, permission: 'analytics.view' },
    ] },
  ];

  // Configuration, not daily work. Collapsed by default and opened on demand.
  const advancedSection: NavSection = { id: 'advanced', key: 'nav.group.advanced', icon: Sliders, items: [
    { id: 'organization', key: 'nav.organization', icon: Network, permission: 'franchises.view' },
    { id: 'franchises', key: 'nav.franchises', icon: Building, permission: 'franchises.view' },
    { id: 'branches', key: 'nav.branches', icon: Building2, permission: 'branches.view' },
    { id: 'roles', key: 'nav.roles', icon: ShieldCheck, permission: 'roles.view' },
    { id: 'rbac', key: 'nav.rbacTest', icon: KeyRound, permission: 'rbac.test' },
    { id: 'branding', key: 'nav.branding', icon: Palette, permission: 'settings.view' },
    { id: 'receiptSettings', key: 'nav.receiptSettings', icon: Printer, permission: 'print.manage' },
    { id: 'serviceCharge', key: 'nav.serviceCharge', icon: Percent, permission: 'service_charge.view' },
    { id: 'posMedia', key: 'nav.posMedia', icon: MonitorPlay, permission: 'pos.media.view' },
    { id: 'settings', key: 'nav.settings', icon: Sliders, permission: 'settings.view' },
    { id: 'audit', key: 'nav.audit', icon: History, permission: 'audit.view' },
  ] };

  const visibleOf = (section: NavSection) => section.items.filter(i => !i.permission || hasPermission(i.permission));
  const sections = navSections.map(s => ({ ...s, visible: visibleOf(s) })).filter(s => s.visible.length > 0);
  // Stage 40 defect fix: a CASHIER holds `branches.view` -- a read they legitimately need -- which
  // was enough to put "Advanced settings" in front of them. Reading a branch list is not
  // configuring the system, so the section now appears only for someone who actually holds a
  // configuration-grade permission. This is presentation only: no permission is granted, none is
  // removed, and the server still authorises every request exactly as before.
  const CONFIGURATION_PERMISSIONS = ['settings.view', 'roles.view', 'audit.view', 'franchises.view', 'rbac.test', 'print.manage', 'service_charge.view', 'pos.media.view'];
  const configures = CONFIGURATION_PERMISSIONS.some(p => hasPermission(p));
  const advanced = { ...advancedSection, visible: configures ? visibleOf(advancedSection) : [] };

  // The section holding the current screen is open; the operator can open another by hand.
  const sectionOf = (tab: NavTab) => [...sections, advanced].find(s => s.visible.some(i => i.id === tab))?.id || 'home';
  const [openSection, setOpenSection] = useState<string>(() => sectionOf(currentTab));
  useEffect(() => { setOpenSection(sectionOf(currentTab)); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [currentTab]);

  const futureModules = [
    { name: 'Boomcard & Coin' },
    { name: 'CRM & Guests' },
    { name: 'Finance Ledger' },
    { name: 'Executive Analytics' }
  ];

  return (
    <>
    {/* Stage 44: the backdrop exists only while the drawer is open on a phone, and tapping it closes
        the drawer. At tablet width and above it is never rendered at all. */}
    {drawerOpen && (
      <div id="boom-nav-backdrop" className="fixed inset-0 z-40 bg-slate-950/70 md:hidden" role="presentation"
        onClick={() => onCloseDrawer?.()} />
    )}
    <aside id="boom-sidebar" data-drawer-open={drawerOpen ? 'true' : 'false'}
      className={`w-64 flex-shrink-0 bg-slate-900 border-r border-slate-800 flex flex-col justify-between select-none
        max-md:fixed max-md:inset-y-0 max-md:left-0 max-md:z-50 max-md:w-[min(17rem,85vw)] max-md:overflow-y-auto
        max-md:transition-transform ${drawerOpen ? 'max-md:translate-x-0' : 'max-md:-translate-x-full'}`}>
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

        {/* Stage 40: nine everyday sections, then Advanced settings. A section opens on click;
            the one holding the current screen opens by itself. One-screen sections go straight
            there. Nothing was removed -- only the number of rows a person reads at once. */}
        <div className="p-3 space-y-1">
          {sections.map((section) => {
            const SectionIcon = section.icon;
            const single = section.visible.length === 1;
            const holdsCurrent = section.visible.some(i => i.id === currentTab);
            const isOpen = !single && openSection === section.id;
            // A one-screen section IS its destination, so its row carries the tab it opens --
            // useful for deep links and automation, and it costs nothing.
            return (
              <div key={section.id}>
                <button
                  id={`nav-section-${section.id}`}
                  onClick={() => (single ? onSelectTab(section.visible[0].id) : setOpenSection(isOpen ? '' : section.id))}
                  aria-expanded={single ? undefined : isOpen}
                  data-tab={single ? section.visible[0].id : undefined}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all ${
                    holdsCurrent
                      ? 'bg-amber-500/15 text-amber-300 font-semibold border border-amber-500/30'
                      : 'text-slate-300 font-medium hover:text-white hover:bg-slate-800/60'
                  }`}
                >
                  <SectionIcon className={`w-4 h-4 ${holdsCurrent ? 'text-amber-400' : 'text-slate-400'}`} />
                  <span className="flex-1 text-left">{t(section.key)}</span>
                  {!single && <ChevronRight className={`w-3.5 h-3.5 transition-transform ${isOpen ? 'rotate-90' : ''} ${holdsCurrent ? 'text-amber-400' : 'text-slate-500'}`} />}
                </button>

                {isOpen && (
                  <nav className="mt-1 mb-1 ml-4 pl-3 border-l border-slate-800 space-y-0.5">
                    {section.visible.map((item) => {
                      const isActive = currentTab === item.id;
                      return (
                        <button
                          key={item.id}
                          id={`nav-${item.id}`}
                          onClick={() => onSelectTab(item.id)}
                          className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] transition-all ${
                            isActive ? 'text-amber-300 font-semibold bg-amber-500/10' : 'text-slate-400 hover:text-white hover:bg-slate-800/50'
                          }`}
                        >
                          <span className="flex-1 text-left">{t(item.key)}</span>
                        </button>
                      );
                    })}
                  </nav>
                )}
              </div>
            );
          })}
        </div>

        {/* Configuration, not daily work. Collapsed until asked for, and absent entirely for a
            role that may not configure anything -- every entry inside is permission-gated. */}
        {advanced.visible.length > 0 && (
          <div className="px-3 pb-2">
            <div className="border-t border-slate-800/80 pt-3">
              <button
                id="nav-section-advanced"
                onClick={() => setOpenSection(openSection === 'advanced' ? '' : 'advanced')}
                aria-expanded={openSection === 'advanced'}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all ${
                  advanced.visible.some(i => i.id === currentTab)
                    ? 'bg-amber-500/15 text-amber-300 font-semibold border border-amber-500/30'
                    : 'text-slate-400 font-medium hover:text-white hover:bg-slate-800/60'
                }`}
              >
                <Sliders className="w-4 h-4 text-slate-500" />
                <span className="flex-1 text-left">{t('nav.group.advanced')}</span>
                <ChevronRight className={`w-3.5 h-3.5 text-slate-500 transition-transform ${openSection === 'advanced' ? 'rotate-90' : ''}`} />
              </button>
              {openSection === 'advanced' && (
                <nav className="mt-1 ml-4 pl-3 border-l border-slate-800 space-y-0.5">
                  {advanced.visible.map((item) => (
                    <button
                      key={item.id}
                      id={`nav-${item.id}`}
                      onClick={() => onSelectTab(item.id)}
                      className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] transition-all ${
                        currentTab === item.id ? 'text-amber-300 font-semibold bg-amber-500/10' : 'text-slate-400 hover:text-white hover:bg-slate-800/50'
                      }`}
                    >
                      <span className="flex-1 text-left">{t(item.key)}</span>
                    </button>
                  ))}
                </nav>
              )}
            </div>
          </div>
        )}

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
    </>
  );
};
