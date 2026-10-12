import React, { useState } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { LanguageProvider, useLanguage } from './context/LanguageContext';
import { BrandingProvider, useBranding } from './context/BrandingContext';
import { Sidebar, NavTab } from './components/Sidebar';
import { TranslationKey } from './translations/ru';
import { Header } from './components/Header';
import { DashboardView } from './components/DashboardView';
import { FranchisesView } from './components/FranchisesView';
import { OrganizationView } from './components/OrganizationView';
import { BranchesView } from './components/BranchesView';
import { UsersView } from './components/UsersView';
import { EmployeesView } from './components/EmployeesView';
import { RolesView } from './components/RolesView';
import { RBACTestConsoleView } from './components/RBACTestConsoleView';
import { SettingsView } from './components/SettingsView';
import { AuditView } from './components/AuditView';
import { KitchenStationView } from './components/KitchenStationView';
import { ExpoView } from './components/ExpoView';
import { KitchenControlView } from './components/KitchenControlView';
import { AcceptanceTestModal } from './components/AcceptanceTestModal';
import { LoginModal } from './components/LoginModal';
import { WaiterPOSView } from './components/WaiterPOSView';
import { InventoryView } from './components/InventoryView';
import { OrderApprovalsView } from './components/OrderApprovalsView';
import { MenuEngineView } from './components/MenuEngineView';
import { OperationsView } from './components/OperationsView';
import { VisualCustomerMenuView } from './components/VisualCustomerMenuView';
import { CashierPOSView } from './components/CashierPOSView';
import { ReceiptSettingsView } from './components/ReceiptSettingsView';
import { CreditReportsView } from './components/CreditReportsView';
import { AnalyticsView } from './components/AnalyticsView';
import { BoomcardJournalView } from './components/BoomcardJournalView';
import { ManagerCommandCenterView } from './components/ManagerCommandCenterView';
import { LiveOperationsView } from './components/LiveOperationsView';
import { ServiceChargeView } from './components/ServiceChargeView';
import { BoomcardView } from './components/BoomcardView';
import { CustomersView } from './components/CustomersView';
import { FoodCostView } from './components/FoodCostView';
import { POSMediaView } from './components/POSMediaView';
import { VisualCatalogView } from './components/VisualCatalogView';
import { MediaLibraryView } from './components/MediaLibraryView';
import { PromotionsView } from './components/PromotionsView';
import { BrandingView } from './components/BrandingView';
import { MenuPreviewView } from './components/MenuPreviewView';

function MainLayout() {
  const publicScreen = new URLSearchParams(window.location.search).get('screen');
  if (publicScreen === 'customer') return <VisualCustomerMenuView />;
  if (publicScreen === 'waiter') {
    return <WaiterPOSView />;
  }
  const { user, isLoading } = useAuth();
  const { t, language } = useLanguage();
  const [currentTab, setCurrentTab] = useState<NavTab>('dashboard');
  const [isTestModalOpen, setIsTestModalOpen] = useState(false);
  const acceptanceTestsEnabled = import.meta.env.VITE_ENABLE_ACCEPTANCE_TESTS === 'true';
  const [isLoginModalOpen, setIsLoginModalOpen] = useState(false);
  const { branding } = useBranding();

  // Stage 44: ADMIN had no phone layout at all. The 256px sidebar never collapsed, so on
  // a 390px screen the working area was 134px wide and every screen's content was squeezed out of
  // view. Below the tablet breakpoint the sidebar is now a drawer: closed by default, opened from
  // the header, and closed again by choosing a destination, by Escape or by tapping beside it.
  // Nothing changes at tablet width and above.
  const [navOpen, setNavOpen] = useState(false);
  React.useEffect(() => {
    if (!navOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setNavOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navOpen]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center text-slate-400 gap-3">
        <div className="w-10 h-10 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400 font-black text-xl animate-pulse">
          {branding.mark}
        </div>
        <p className="text-xs font-mono font-medium tracking-wide">
          BOOTING {branding.product_name} FOUNDATION...
        </p>
      </div>
    );
  }

  // Stage 41: ONE source for the page title. Before this the shell header had its own title map,
  // so a screen could be called "Menu Engine" at the top while the navigation that led to it said
  // "Блюда и цены", and "Склад и Inventory" / "POS Media" leaked internal vocabulary into the
  // working interface. The title is now literally the navigation label, and the description is one
  // short line saying what the screen is for -- both languages, from the existing translations.
  const PAGE_KEYS: Record<NavTab, TranslationKey> = {
    dashboard: 'nav.dashboard', organization: 'nav.organization', franchises: 'nav.franchises',
    branches: 'nav.branches', employees: 'nav.employees', users: 'nav.users', roles: 'nav.roles',
    rbac: 'nav.rbacTest', orderApprovals: 'nav.orderApprovals', menu: 'nav.menu',
    operations: 'nav.operations', cashierPos: 'nav.cashierPos', receiptSettings: 'nav.receiptSettings',
    creditReports: 'nav.creditReports', commandCenter: 'nav.commandCenter', liveOperations: 'nav.liveOperations',
    customers: 'nav.customers', boomcard: 'nav.boomcard', serviceCharge: 'nav.serviceCharge',
    analytics: 'nav.analytics', boomcardJournal: 'nav.boomcardJournal', posMedia: 'nav.posMedia',
    menuMedia: 'nav.menuMedia', visualCatalog: 'nav.visualCatalog', promotions: 'nav.promotions',
    foodCost: 'nav.foodCost', inventory: 'nav.inventory', settings: 'nav.settings',
    menuPreview: 'nav.menuPreview', branding: 'nav.branding', audit: 'nav.audit',
    kitchen: 'nav.kitchen', expo: 'nav.expo', kitchenLoad: 'nav.kitchenLoad',
  };
  const PAGE_DESCRIPTIONS: Record<NavTab, [string, string]> = {
    dashboard: ['Общее состояние сети за сегодня', 'Şu günki umumy ýagdaý'],
    organization: ['Структура сети: франшизы, филиалы, сотрудники', 'Ulgamyň gurluşy: franşizalar, şahamçalar, işgärler'],
    franchises: ['Юридические лица и их филиалы', 'Ýuridiki taraplar we olaryň şahamçalary'],
    branches: ['Рестораны сети и их настройки', 'Ulgamyň restoranlary we sazlamalary'],
    employees: ['Сотрудники, должности и коды официантов', 'Işgärler, wezipeler we ofisiant kodlary'],
    users: ['Кто и куда может входить в систему', 'Ulgama kimiň nirä girip biljekdigi'],
    roles: ['Наборы прав, которые выдаются сотрудникам', 'Işgärlere berilýän hukuk toplumlary'],
    rbac: ['Проверка: что доступно конкретной роли', 'Barlag: belli bir rola näme elýeterli'],
    orderApprovals: ['Запросы официантов, требующие решения менеджера', 'Menejeriň çözgüdini talap edýän ofisiant haýyşlary'],
    menu: ['Категории, блюда, цены и состав', 'Kategoriýalar, tagamlar, bahalar we düzümi'],
    operations: ['Заказы, оплата и кухня за смену', 'Çalşykdaky sargytlar, tölegler we aşhana'],
    cashierPos: ['Рабочее место кассира: заказы, оплата, чеки', 'Kassir iş orny: sargytlar, töleg, çekler'],
    receiptSettings: ['Что печатается на чеке филиала', 'Şahamçanyň çeginde näme çap edilýär'],
    creditReports: ['Задолженность клиентов и погашения', 'Müşderileriň bergisi we üzülmeler'],
    commandCenter: ['Продажи, касса, кухня и персонал за день', 'Günüň satuwy, kassasy, aşhanasy we işgärleri'],
    liveOperations: ['Что происходит в зале прямо сейчас', 'Häzirki wagtda zalda näme bolup geçýär'],
    customers: ['Карточка гостя: заказы, бонусы, кредит', 'Myhman kartoçkasy: sargytlar, bonuslar, kredit'],
    boomcard: ['Карты лояльности и льготы гостей', 'Wepalylyk kartlary we myhman ýeňillikleri'],
    serviceCharge: ['Процент обслуживания и его распределение', 'Hyzmat göterimi we onuň paýlanyşy'],
    analytics: ['Продажи, блюда и категории за период', 'Döwür boýunça satuwlar, tagamlar we kategoriýalar'],
    boomcardJournal: ['История начислений и списаний бонусов', 'Bonus hasaplamalarynyň we ýazylyşlarynyň taryhy'],
    posMedia: ['Видео и изображения на экранах POS', 'POS ekranlaryndaky wideo we suratlar'],
    menuMedia: ['Библиотека фото и видео для меню', 'Menýu üçin surat we wideo kitaphanasy'],
    visualCatalog: ['Оформление гостевого меню', 'Myhman menýusynyň bezegi'],
    promotions: ['Акционные цены и сроки их действия', 'Aksiýa bahalary we hereket möhletleri'],
    foodCost: ['Рецепты, себестоимость и маржа блюд', 'Reseptler, önümçilik bahasy we marja'],
    inventory: ['Остатки, поставщики и движения склада', 'Galyndylar, üpjün edijiler we ammar hereketleri'],
    settings: ['Системные параметры сети', 'Ulgamyň sazlamalary'],
    menuPreview: ['Меню глазами гостя и QR-вход', 'Menýu myhmanyň gözi bilen we QR giriş'],
    branding: ['Логотип и названия во всех интерфейсах', 'Ähli interfeýslerde logotip we atlar'],
    audit: ['Кто, что и когда изменил в системе', 'Ulgamda kim, näme we haçan üýtgetdi'],
    kitchen: ['Очередь цеха: что принять, начать и отдать', 'Bölümiň nobaty: kabul et, başla we ber'],
    expo: ['Сборка и передача готовых заказов', 'Taýýar sargytlary ýygnamak we bermek'],
    kitchenLoad: ['Загрузка цехов, задержки и запросы помощи', 'Bölümleriň ýüki, gijä galmalar we kömek haýyşlary'],
  };
  const getTabTitle = (tab: NavTab) => ({
    title: t(PAGE_KEYS[tab]),
    subtitle: PAGE_DESCRIPTIONS[tab][language === 'ru' ? 0 : 1],
  });

  const { title, subtitle } = getTabTitle(currentTab);

  // Stage 44: ADMIN on a phone. Until now the sidebar was 256px of fixed width at every size, so on
 
  return (
    // Stage 40 defect fix: the admin shell never carried `boom-reduced-motion-safe`, so its
    // Tailwind transitions kept animating for someone who asked the OS for reduced motion -- the
    // customer menu honoured the setting and the working interface did not. Reuses the existing
    // convention from tokens.css rather than inventing a second one.
    <div className="boom-reduced-motion-safe min-h-screen flex bg-slate-950 text-slate-100 font-sans antialiased selection:bg-amber-500 selection:text-slate-950">
      {/* Sidebar -- a column on a desktop, a drawer on a phone. */}
      <Sidebar
        currentTab={currentTab}
        onSelectTab={(tab) => { setCurrentTab(tab); setNavOpen(false); }}
        onOpenTestModal={() => setIsTestModalOpen(true)}
        acceptanceTestsEnabled={acceptanceTestsEnabled}
        drawerOpen={navOpen}
        onCloseDrawer={() => setNavOpen(false)}
      />

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 h-screen overflow-hidden">
        {/* Header */}
        <Header
          title={title}
          subtitle={subtitle}
          onOpenLoginModal={() => setIsLoginModalOpen(true)}
          onOpenNav={() => setNavOpen(true)}
        />

        {/* Scrollable View Container */}
        <main className="flex-1 overflow-y-auto bg-slate-950/60">
          {currentTab === 'dashboard' && (
            <DashboardView
              onNavigate={(tab) => setCurrentTab(tab)}
              onOpenTestModal={() => setIsTestModalOpen(true)}
              acceptanceTestsEnabled={acceptanceTestsEnabled}
            />
          )}
          {currentTab === 'organization' && <OrganizationView />}
          {currentTab === 'franchises' && <FranchisesView />}
          {currentTab === 'branches' && <BranchesView />}
          {currentTab === 'employees' && <EmployeesView />}
          {currentTab === 'users' && <UsersView />}
          {currentTab === 'roles' && <RolesView />}
          {currentTab === 'rbac' && <RBACTestConsoleView />}
          {currentTab === 'menu' && <MenuEngineView />}
          {currentTab === 'inventory' && <InventoryView />}
          {currentTab === 'operations' && <OperationsView />}
          {currentTab === 'cashierPos' && <CashierPOSView />}
          {currentTab === 'receiptSettings' && <ReceiptSettingsView />}
          {currentTab === 'creditReports' && <CreditReportsView />}
          {currentTab === 'commandCenter' && <ManagerCommandCenterView onNavigate={(tab) => setCurrentTab(tab)} />}
          {currentTab === 'liveOperations' && <LiveOperationsView onNavigate={(tab) => setCurrentTab(tab)} />}
          {currentTab === 'foodCost' && <FoodCostView />}
          {currentTab === 'analytics' && <AnalyticsView />}
          {currentTab === 'boomcardJournal' && <BoomcardJournalView />}
          {currentTab === 'posMedia' && <POSMediaView />}
          {currentTab === 'visualCatalog' && <VisualCatalogView />}
          {currentTab === 'menuMedia' && <MediaLibraryView />}
          {currentTab === 'promotions' && <PromotionsView />}
          {currentTab === 'serviceCharge' && <ServiceChargeView />}
          {currentTab === 'boomcard' && <BoomcardView />}
          {currentTab === 'customers' && <CustomersView />}
          {currentTab === 'orderApprovals' && <OrderApprovalsView />}
          {currentTab === 'menuPreview' && <MenuPreviewView />}
          {currentTab === 'branding' && <BrandingView />}
          {currentTab === 'settings' && <SettingsView />}
          {currentTab === 'audit' && <AuditView />}
          {currentTab === 'kitchen' && <KitchenStationView />}
          {currentTab === 'expo' && <ExpoView />}
          {currentTab === 'kitchenLoad' && <KitchenControlView />}
        </main>
      </div>

      {/* Modals */}
      {acceptanceTestsEnabled && <AcceptanceTestModal
        isOpen={isTestModalOpen}
        onClose={() => setIsTestModalOpen(false)}
      />}

      <LoginModal
        isOpen={isLoginModalOpen}
        onClose={() => setIsLoginModalOpen(false)}
      />
    </div>
  );
}

export default function App() {
  return (
    <LanguageProvider>
      <AuthProvider>
        <BrandingProvider>
          <MainLayout />
        </BrandingProvider>
      </AuthProvider>
    </LanguageProvider>
  );
}
