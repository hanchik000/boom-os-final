// BOOM OS -- Stage 41: ONE SYSTEM, ONE UX LANGUAGE.
//
// Source guards for the vocabulary this stage introduced and for the inconsistencies it removed.
// Nothing here tests business behaviour: the point of Stage 41 is that behaviour did NOT change.
// The behavioural proof is the unchanged E2E suite; the visual proof is the browser walkthrough.
import fs from 'node:fs';
const read = p => fs.readFileSync(p, 'utf8');
const views = fs.readdirSync('src/components').filter(f => f.endsWith('.tsx'));
const viewSrc = Object.fromEntries(views.map(f => [f, read(`src/components/${f}`)]));
const ui = read('src/components/ui/index.tsx');
const css = read('src/design-system/admin-ui.css');
const app = read('src/App.tsx');
const main = read('src/main.tsx');
const ru = read('src/translations/ru.ts');
const tk = read('src/translations/tk.ts');

// The screens that make up the administrative interface. POS and guest screens have their own
// design layers (waiter-pos.css, cashier-pos.css) and are deliberately not in this list.
const ADMIN = views.filter(f => !/WaiterPOSView|CashierPOSView|CustomerMenuView|VisualCustomerMenuView|CustomerDishSheet|CustomerSiteSections|AcceptanceTestModal|LoginModal/.test(f));
const adminSrc = ADMIN.map(f => viewSrc[f]).join('\n');
// A guard must read what RUNS. Comments in these files quote the very strings this stage removed
// ("Immutable Ledger", "Inventory & Stock", alert()), so they are stripped before any scan.
const stripComments = src => src
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '')
  .replace(/^\s*\*.*$/gm, '');
const adminCode = stripComments(adminSrc);

const checks = [
  // ---------------------------------------------------------------- A. ONE SHARED VOCABULARY
  ['there is ONE shared UX module, not a second design system',
    fs.existsSync('src/components/ui/index.tsx') &&
    ['Toolbar', 'SearchInput', 'LoadingState', 'EmptyState', 'Notice', 'Modal', 'ConfirmDialog', 'FormActions']
      .every(x => ui.includes(`export const ${x}`))],
  ['it is built on the existing tokens, and adds no colour of its own',
    /var\(--boom-gold\)/.test(css) && /var\(--boom-focus-ring\)/.test(css) &&
    !/#[0-9a-f]{6}/i.test(css.replace(/#111827|#05070b|#fca5a5|#fecaca|#86efac|#fcd34d/g, ''))],
  ['the stylesheet is registered once, next to the existing ones',
    (main.match(/admin-ui\.css/g) || []).length === 1 && main.includes('design-system/tokens.css') === false && main.includes('index.css')],
  ['the shared module holds no business logic and no API calls',
    !/api\.|fetch\(|hasPermission|price|amount|total/i.test(ui.replace(/\/\/[^\n]*/g, ''))],

  // ---------------------------------------------------------------- B. BUTTON HIERARCHY
  ['the four button roles exist, each with one definition',
    ['.btn {', '.btn-secondary {', '.btn-ghost {', '.btn-danger {'].every(s => css.includes(s))],
  ['they share one height rhythm, one radius and one focus ring',
    /\.btn,\n\.btn-secondary,\n\.btn-ghost,\n\.btn-danger \{/.test(css) &&
    /\.btn:focus-visible,[\s\S]{0,120}box-shadow: var\(--boom-focus-ring\)/.test(css)],
  ['no administrative screen hand-paints an action button in the brand colours any more',
    !/className="(?=[^"]*\bbg-(?:amber|rose|emerald)-500\b(?!\/))(?=[^"]*\brounded)[^"]*"/.test(
      adminCode.split('\n').filter(l => /<button|<label/.test(l)).join('\n'))],
  ['a filter chip and a sub-tab are the same control',
    css.includes('.boom-chip') && css.includes('.boom-chip.is-active') &&
    ['FranchisesView.tsx', 'BoomcardView.tsx', 'ServiceChargeView.tsx'].every(f => viewSrc[f].includes('boom-chip'))],
  // A badge may still be tinted -- it carries meaning, not a choice. What must not survive is a
  // BUTTON that invents its own "this one is selected" or "press me" colour.
  ['and no screen keeps its own colour for "this one is selected"',
    !/className=\{?`?[^"`]*bg-(blue|emerald|rose)-500\/(20|30)[^"`]*`?\}?/.test(
      stripComments(viewSrc['FranchisesView.tsx']).split('\n').filter(l => /<button/.test(l) || /hover:bg-/.test(l)).join('\n'))],

  // ---------------------------------------------------------------- C. ONE PAGE HEADER
  ['the page title is the navigation label -- one source, no second map',
    app.includes('const PAGE_KEYS: Record<NavTab, TranslationKey>') && app.includes("title: t(PAGE_KEYS[tab])") &&
    !/title: 'Menu Engine'|title: 'POS Media'|'Склад и Inventory'/.test(app)],
  ['every screen has a one-line description in both languages',
    app.includes('const PAGE_DESCRIPTIONS: Record<NavTab, [string, string]>') &&
    (app.match(/: \['[^']+', '[^']+'\]/g) || []).length >= 31],
  ['list screens carry the shared toolbar instead of their own header block',
    ['UsersView.tsx', 'BranchesView.tsx', 'RolesView.tsx', 'SettingsView.tsx', 'AuditView.tsx', 'InventoryView.tsx',
     'PromotionsView.tsx', 'POSMediaView.tsx', 'CustomersView.tsx', 'BoomcardView.tsx', 'OrderApprovalsView.tsx',
     'ServiceChargeView.tsx', 'OrganizationView.tsx', 'ReceiptSettingsView.tsx']
      .every(f => viewSrc[f].includes('<Toolbar'))],
  ['and the four command-style screens no longer print a second title in capitals',
    ['MenuEngineView.tsx', 'MediaLibraryView.tsx', 'VisualCatalogView.tsx', 'BrandingView.tsx']
      .every(f => viewSrc[f].includes('boom-toolbar') && !viewSrc[f].includes('cmd-title'))],

  // ---------------------------------------------------------------- D. STATES
  ['loading is one shared state, never a bare word',
    !/>\s*(Loading|Загрузка\.\.\.|LOADING)[^<]*</.test(adminCode) &&
    ADMIN.filter(f => viewSrc[f].includes('<LoadingState')).length >= 12],
  ['an empty list explains itself and, where there is one, offers the action',
    ui.includes('EmptyState') && /title: string; hint\?: string; action\?: React.ReactNode/.test(ui) &&
    viewSrc['BranchesView.tsx'].includes('<EmptyState') && viewSrc['InventoryView.tsx'].includes('<EmptyState')],
  ['success, failure and information are told the same way',
    css.includes('.boom-notice.is-success') && css.includes('.boom-notice.is-error') && css.includes('.boom-notice.is-info') &&
    ADMIN.filter(f => viewSrc[f].includes('<Notice')).length >= 10],
  ['errors still go through the Stage 40 human-language translation',
    read('src/api.ts').includes('humanError(') && read('src/humanErrors.ts').includes('export function errorText') &&
    !/\|\| 'Failed to [a-z]/.test(adminCode)],

  // ---------------------------------------------------------------- E. IRREVERSIBLE ACTIONS
  ['no administrative screen uses a browser confirm() or alert() any more',
    !/(^|[^.\w])(confirm|alert)\(/m.test(adminCode)],
  ['they all use the one confirmation dialog',
    ['BranchesView.tsx', 'RolesView.tsx', 'UsersView.tsx', 'EmployeesView.tsx', 'POSMediaView.tsx',
     'PromotionsView.tsx', 'FranchiseDetailModal.tsx', 'MenuDishEditor.tsx']
      .every(f => viewSrc[f].includes('<ConfirmDialog'))],
  ['and it says what happens, rather than asking a bare question',
    /перестанет|сохран|не сможет/.test(viewSrc['BranchesView.tsx']) && /сохран|не сможет/.test(viewSrc['UsersView.tsx'])],
  ['archiving is still archiving: no screen shows the internal deleted_at field',
    !/>\{[^}]*deleted_at[^}]*\}</.test(adminCode)],

  // ---------------------------------------------------------------- F. FORMS
  ['a form loses nothing silently: the dish editor warns about unsaved changes',
    viewSrc['MenuDishEditor.tsx'].includes('const dirty = useMemo') &&
    viewSrc['MenuDishEditor.tsx'].includes('requestClose') && /несохранённые/.test(viewSrc['MenuDishEditor.tsx'])],
  ['a dialog does not leak its clicks to the screen underneath',
    ui.includes('onClick={e => e.stopPropagation()}')],
  ['required fields, hints and field errors have one look',
    ['.boom-label', '.boom-req', '.boom-help', '.boom-field-error'].every(c => css.includes(c))],
  ['no field is labelled with a database column name',
    !/placeholder=\{k\}/.test(viewSrc['InventoryView.tsx']) && viewSrc['InventoryView.tsx'].includes('boom-label')],

  // ---------------------------------------------------------------- G. LANGUAGE
  ['the working interface is no longer written in English anywhere',
    !/(Loading (personnel|security|configuration|franchise)|No (users|settings|audit|franchises|branches assigned|employees currently)|Are you sure|Immutable Ledger|Stock Items|Inventory & Stock|Operational Hierarchy|Deactivate Franchise|Edit Details)/i.test(adminCode)],
  ['one verb per meaning: an entity is ADDED, never "created" on one screen and "opened" on another',
    /"ui.createRole": "Добавить роль"/.test(ru) && /"ui.openNewBranch": "Добавить филиал"/.test(ru) &&
    /"ui.addNewStaff": "Добавить сотрудника"/.test(ru) &&
    !/Создать блюдо|Создать группу|Создать акцию/.test(adminCode)],
  ['both languages carry every label this stage touched',
    ['ui.createRole', 'ui.openNewBranch', 'ui.newPermission', 'ui.addNewStaff'].every(k => ru.includes(`"${k}"`) && tk.includes(`"${k}"`))],
  ['the shared module speaks both languages and hardcodes neither',
    /language === 'ru'/.test(ui) && /Ýüklenýär|Goý bolsun|Tassykla/.test(ui)],

  // ---------------------------------------------------------------- H. WHAT MUST NOT HAVE CHANGED
  ['Stage 40 navigation is intact: sections plus a separate advanced section',
    viewSrc['Sidebar.tsx'].includes('const navSections: NavSection[]') &&
    viewSrc['Sidebar.tsx'].includes('const advancedSection: NavSection') &&
    viewSrc['Sidebar.tsx'].includes('CONFIGURATION_PERMISSIONS')],
  ['role-aware visibility still comes from the existing permission check',
    viewSrc['Sidebar.tsx'].includes('hasPermission(i.permission)') && !/ROLE_UX|const ROLES =/.test(ui)],
  ['the reduced-motion convention is untouched',
    read('src/design-system/tokens.css').includes('transition-duration: 0.001ms !important') &&
    read('src/App.tsx').includes('boom-reduced-motion-safe')],
  ['the shared stylesheet adds no animation of its own beyond one spinner',
    (css.match(/animation:/g) || []).length <= 1],
  ['the stage report exists', fs.existsSync('docs/STAGE-41-UNIFIED-UX-REPORT.md')],
];

let ok = 0;
for (const [name, v] of checks) { console.log(`${v ? 'PASS' : 'FAIL'} ${name}`); if (v) ok++; }
console.log(`${ok}/${checks.length} PASS`);
if (ok !== checks.length) process.exit(1);
