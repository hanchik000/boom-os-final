import React, { useState } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { LanguageProvider, useLanguage } from './context/LanguageContext';
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
import { CustomerMenuView } from './components/CustomerMenuView';
import { CashierPOSView } from './components/CashierPOSView';
import { ReceiptSettingsView } from './components/ReceiptSettingsView';
import { CreditReportsView } from './components/CreditReportsView';
import { ManagerCommandCenterView } from './components/ManagerCommandCenterView';
import { LiveOperationsView } from './components/LiveOperationsView';
import { ServiceChargeView } from './components/ServiceChargeView';
import { BoomcardView } from './components/BoomcardView';
import { CustomersView } from './components/CustomersView';
import { FoodCostView } from './components/FoodCostView';

function MainLayout() {
  const publicScreen = new URLSearchParams(window.location.search).get('screen');
  if (publicScreen === 'customer') return <CustomerMenuView />;
  if (publicScreen === 'waiter') {
    return <WaiterPOSView />;
  }
  const { user, isLoading } = useAuth();
  const { t, language } = useLanguage();
  const [currentTab, setCurrentTab] = useState<NavTab>('dashboard');
  const [isTestModalOpen, setIsTestModalOpen] = useState(false);
  const acceptanceTestsEnabled = import.meta.env.VITE_ENABLE_ACCEPTANCE_TESTS === 'true';
  const [isLoginModalOpen, setIsLoginModalOpen] = useState(false);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center text-slate-400 gap-3">
        <div className="w-10 h-10 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400 font-black text-xl animate-pulse">
          B
        </div>
        <p className="text-xs font-mono font-medium tracking-wide">
          BOOTING BOOM OS FOUNDATION...
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
          {currentTab === 'serviceCharge' && <ServiceChargeView />}
          {currentTab === 'boomcard' && <BoomcardView />}
          {currentTab === 'customers' && <CustomersView />}
          {currentTab === 'orderApprovals' && <OrderApprovalsView />}
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
        <MainLayout />
      </AuthProvider>
    </LanguageProvider>
  );
}
