import React, { useState } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { LanguageProvider, useLanguage } from './context/LanguageContext';
import { BrandingProvider, useBranding } from './context/BrandingContext';
import { Sidebar, NavTab } from './components/Sidebar';
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

  const getTabTitle = (tab: NavTab) => {
    switch (tab) {
      case 'dashboard':
        return { 
          title: t('nav.dashboard'), 
          subtitle: language === 'ru' 
            ? 'Централизованные операции, телеметрия и системная безопасность' 
            : 'Merkezi amallar, telemetriýa we howpsuzlyk binýady' 
        };
      case 'organization':
        return {
          title: t('nav.organization'),
          subtitle: language === 'ru' ? 'Единая структура HQ, франшиз, филиалов и сотрудников' : 'HQ, franşizalar, şahamçalar we işgärleriň ýeke-täk gurluşy'
        };
      case 'franchises':
        return { 
          title: t('franchise.title'), 
          subtitle: language === 'ru'
            ? 'Региональные юридические лица, холдинговая структура и филиалы'
            : 'Sebit ýuridiki taraplary, holding gurluşy we şahamçalar'
        };
      case 'branches':
        return { 
          title: t('nav.branches'), 
          subtitle: language === 'ru'
            ? 'Сеть ресторанов, часовые пояса и изолированные области доступа'
            : 'Restoranlar ulgamy, wagt guşaklyklary we aýratynlaşdyrylan rugsatlar'
        };
      case 'employees':
        return { title: language === 'ru' ? 'Персонал' : 'Işgärler', subtitle: language === 'ru' ? 'Операционные профили, должности и структура сотрудников' : 'Işgärleriň iş profilleri, wezipeleri we gurluşy' };
      case 'users':
        return { 
          title: t('staff.title'), 
          subtitle: language === 'ru'
            ? 'Управление штатом, статусы сотрудников и распределение ролей'
            : 'Işgärler düzümi, işgär ýagdaýlary we rollary paýlamak'
        };
      case 'roles':
        return { 
          title: t('nav.roles'), 
          subtitle: language === 'ru'
            ? 'Ролевая модель доступа (RBAC) и матрица прав'
            : 'Rollara esaslanan rugsat modeli (RBAC) we ygtyýarlyklar tablisasy'
        };
      case 'rbac':
        return { 
          title: t('nav.rbacTest'), 
          subtitle: language === 'ru'
            ? 'Интерактивная симуляция политик доступа ролей и филиалов'
            : 'Rollaryň we şahamçalaryň rugsat syýasatynyň interaktiw barlagy'
        };
      case 'orderApprovals':
        return { title: language === 'ru' ? 'Согласования заказов' : 'Sargyt tassyklamalary', subtitle: language === 'ru' ? 'Запросы официантов на удаление позиций с обязательным решением менеджера' : 'Ofisiantlaryň pozisiýa aýyrmak haýyşlaryny menejer tarapyndan tassyklamak' };
      case 'menu':
        return { title: 'Menu Engine', subtitle: language === 'ru' ? 'Категории, блюда, цены и модификаторы' : 'Kategoriýalar, tagamlar, bahalar we modifikatorlar' };
      case 'operations':
        return { title: language === 'ru' ? 'Операции' : 'Operasiýalar', subtitle: language === 'ru' ? 'Касса, платежи, подтверждение заказов и KDS' : 'Kassa, tölegler, sargyt tassyklamasy we KDS' };
      case 'cashierPos':
        return { title: t('nav.cashierPos'), subtitle: language === 'ru' ? 'Рабочее место кассира: заказы, оплата, чеки' : 'Kassir iş orny: sargytlar, töleg, çekler' };
      case 'receiptSettings':
        return { title: t('nav.receiptSettings'), subtitle: language === 'ru' ? 'Логотип, поля и формат печати чека по филиалу' : 'Şahamça boýunça logo, meýdanlar we çap formaty' };
      case 'creditReports':
        return { title: t('nav.creditReports'), subtitle: language === 'ru' ? 'Кредитные счета клиентов и сотрудников, задолженность и погашения' : 'Müşderi we işgär kredit hasaplary, bergi we üzülmeler' };
      case 'commandCenter':
        return { title: t('nav.commandCenter'), subtitle: language === 'ru' ? 'Продажи, касса, кухня, официанты, кассиры, склад и персонал в реальном времени' : 'Hakyky wagtda satuw, kassa, aşhana, ofisiantlar, kassirler, ammar we işgärler' };
      case 'liveOperations':
        return { title: t('nav.liveOperations'), subtitle: language === 'ru' ? 'Активные заказы, кухня, нагрузка официантов и кассиров прямо сейчас' : 'Häzirki wagtda işjeň sargytlar, aşhana, ofisiant we kassir ýüki' };
      case 'customers':
        return { title: t('nav.customers'), subtitle: language === 'ru' ? 'Единая карточка гостя: заказы, скидки, BOOMCARD, BOOMCOIN, BOOMBACK и кредит' : 'Bitewi myhman kartoçkasy: sargytlar, arzanladyşlar, BOOMCARD, BOOMCOIN, BOOMBACK we kredit' };
      case 'boomcard':
        return { title: t('nav.boomcard'), subtitle: language === 'ru' ? 'Жизненный цикл карты, льготы и личный кабинет гостя' : 'Kartyň ýaşaýyş sikli, ýeňillikler we myhmanyň şahsy kabineti' };
      case 'serviceCharge':
        return { title: t('nav.serviceCharge'), subtitle: language === 'ru' ? 'Процент обслуживания, распределение по категориям и история версий' : 'Hyzmat göterimi, kategoriýalar boýunça paýlanyş we wersiýa taryhy' };
      case 'analytics':
        return { title: t('nav.analytics'), subtitle: language === 'ru' ? 'Продажи, блюда, категории, время и матрица меню за период' : 'Döwür boýunça satuwlar, naharlar, kategoriýalar, wagt we menýu matrisasy' };
      case 'boomcardJournal':
        return { title: t('nav.boomcardJournal'), subtitle: language === 'ru' ? 'Единый журнал операций BOOMCOIN, BOOMBACK, завтраков, подарков и жизненного цикла карты' : 'BOOMCOIN, BOOMBACK, ertirlik, sowgat we kart ömür aýlawynyň ýeke-täk žurnaly' };
      case 'posMedia': return { title: 'POS Media', subtitle: language === 'ru' ? 'Видео, изображения и анимации для POS-терминалов' : 'POS terminallary üçin wideo, surat we animasiýa' };
      case 'menuMedia': return { title: t('nav.menuMedia'), subtitle: language === 'ru' ? 'Единая библиотека изображений, GIF и видео для меню' : 'Menýu üçin bitewi surat, GIF we wideo kitaphanasy' };
      case 'visualCatalog': return { title: t('nav.visualCatalog'), subtitle: language === 'ru' ? 'Композиция премиального каталога без изменения Menu Engine' : 'Menu Engine-i üýtgetmän premium katalog kompozisiýasy' };
      case 'promotions': return { title: t('nav.promotions'), subtitle: language === 'ru' ? 'Реальные акционные цены на реальные блюда, с автоматическим окончанием' : 'Hakyky naharlar üçin hakyky aksiýa bahalary, awtomatiki tamamlanma bilen' };
      case 'foodCost':
        return { title: t('nav.foodCost'), subtitle: language === 'ru' ? 'Рецепты, себестоимость, маржа и рентабельность меню' : 'Reseptler, baha, marja we menýu girdejililigi' };
      case 'inventory':
        return { title: language === 'ru' ? 'Склад и Inventory' : 'Ammar we Inventory', subtitle: language === 'ru' ? 'Остатки, рецептуры, поставщики и складские движения' : 'Galyndylar, reseptler, üpjün edijiler we ammar hereketleri' };
      case 'settings':
        return { 
          title: t('nav.settings'), 
          subtitle: language === 'ru'
            ? 'Глобальные параметры холдинга, сессии и операционные флаги'
            : 'Holdingiň global parametrleri, sessiýa we operasion sazlamalar'
        };
      case 'menuPreview':
        return {
          title: t('nav.menuPreview'),
          subtitle: language === 'ru'
            ? 'Реальный гостевой экран и QR-вход выбранного филиала, без отдельной копии меню'
            : 'Saýlanan şahamçanyň hakyky myhman ekrany we QR girişi, menýunyň nusgasyz'
        };
      case 'branding':
        return {
          title: t('nav.branding'),
          subtitle: language === 'ru'
            ? 'Логотип и названия из system_settings — единый источник для всех интерфейсов'
            : 'system_settings-den logotip we atlar — ähli interfeýsler üçin bitewi çeşme'
        };
      case 'audit':
        return { 
          title: t('nav.audit'), 
          subtitle: language === 'ru'
            ? 'Неизменяемый журнал всех системных событий и изменений'
            : 'Ähli ulgam wakalarynyň we üýtgeşmeleriniň üýtgemeýän ýazgysy'
        };
    }
  };

  const { title, subtitle } = getTabTitle(currentTab);

  return (
    <div className="min-h-screen flex bg-slate-950 text-slate-100 font-sans antialiased selection:bg-amber-500 selection:text-slate-950">
      {/* Sidebar */}
      <Sidebar
        currentTab={currentTab}
        onSelectTab={(tab) => setCurrentTab(tab)}
        onOpenTestModal={() => setIsTestModalOpen(true)}
        acceptanceTestsEnabled={acceptanceTestsEnabled}
      />

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 h-screen overflow-hidden">
        {/* Header */}
        <Header
          title={title}
          subtitle={subtitle}
          onOpenLoginModal={() => setIsLoginModalOpen(true)}
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
