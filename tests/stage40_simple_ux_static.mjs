// BOOM OS -- Stage 40: SIMPLE UX. "Powerful inside, simple outside."
//
// Source guards for what this stage actually changed: a short sectioned navigation instead of a
// flat wall of 31 links, rarely-used configuration gathered into "Расширенные настройки" WITHOUT
// hiding daily work there, human sentences instead of server codes, and the four real UX defects
// found while walking the product as each role. Nothing here tests business logic -- the point of
// Stage 40 is that the business logic did NOT change.
import fs from 'node:fs';
const read = p => fs.readFileSync(p, 'utf8');

const sidebar = read('src/components/Sidebar.tsx');
const header = read('src/components/Header.tsx');
const app = read('src/App.tsx');
const ru = read('src/translations/ru.ts');
const tk = read('src/translations/tk.ts');
const errors = read('src/humanErrors.ts');
const api = read('src/api.ts');
const operations = read('src/components/OperationsView.tsx');
const cashier = read('src/components/CashierPOSView.tsx');
const boomcard = read('src/components/BoomcardView.tsx');
const waiter = read('src/components/WaiterPOSView.tsx');

// Every destination the sidebar offered before this stage. The list is the contract: Stage 40 was
// allowed to REGROUP navigation, never to remove a way of reaching a screen.
const DESTINATIONS = ['dashboard','commandCenter','liveOperations','cashierPos','operations','orderApprovals',
  'menu','menuPreview','visualCatalog','menuMedia','inventory','foodCost','employees','users','customers',
  'creditReports','promotions','boomcard','boomcardJournal','analytics','organization','franchises','branches',
  'roles','rbac','branding','receiptSettings','serviceCharge','posMedia','settings','audit'];
// What may live behind "Расширенные настройки": configuration, not daily work.
const ADVANCED = ['organization','franchises','branches','roles','rbac','branding','receiptSettings',
  'serviceCharge','posMedia','settings','audit'];
const advancedBlock = (sidebar.match(/const advancedSection[\s\S]*?\n\s*\] \};/) || [''])[0];
const sectionsBlock = (sidebar.match(/const navSections[\s\S]*?\n\s*\];/) || [''])[0];
const idsIn = block => [...block.matchAll(/\{ id: '([A-Za-z]+)', key: 'nav\.(?!group)/g)].map(m => m[1]);
// Comment lines are prose about the code, not the code itself; a guard must read what RUNS.
const codeOnly = src => src.split('\n').filter(l => !/^\s*(\/\/|\*)/.test(l)).join('\n');

// Nothing an operator uses to get through a shift may be spelled in internal vocabulary.
const TECH_TERMS = ['Order Core','Idempot','RBAC','Recipe Snapshot','Audit Event','KDS','SKU','BOM','CRUD','Endpoint'];
const navLabels = src => [...src.matchAll(/"nav\.[A-Za-z.]+": "([^"]*)"/g)].map(m => m[1]);

const checks = [
  // ------------------------------------------------ A. SHORT, SECTIONED NAVIGATION
  ['navigation is built from a handful of sections, not a flat list of every screen',
    sidebar.includes('const navSections: NavSection[]') && idsIn(sectionsBlock).length >= 9 &&
    (sectionsBlock.match(/\{ id: '[a-z]+', key: 'nav\.group\./g) || []).length === 9 &&
    !/navGroups/.test(sidebar)],
  ['"Расширенные настройки" is its own section, separate from the everyday ones',
    sidebar.includes('const advancedSection: NavSection') && ru.includes('"nav.group.advanced": "Расширенные настройки"')],
  ['NOT ONE destination was removed -- all 31 are still reachable',
    DESTINATIONS.every(d => sidebar.includes(`id: '${d}'`))],
  ['Advanced holds configuration only -- no daily operation was hidden inside it',
    idsIn(advancedBlock).sort().join(',') === [...ADVANCED].sort().join(',')],
  ['the section holding the current screen opens itself, so nobody has to hunt for where they are',
    sidebar.includes('const sectionOf = (tab: NavTab)') && /useEffect\(\(\) => \{ setOpenSection\(sectionOf\(currentTab\)\);[\s\S]{0,80}\}, \[currentTab\]\);/.test(sidebar)],
  ['a section with nothing this person may open is not shown at all',
    sidebar.includes('.filter(s => s.visible.length > 0)')],

  // ------------------------------------------------ B. ROLE RELEVANCE WITHOUT A SECOND RBAC
  ['role relevance reuses the EXISTING permission check -- no second permission system exists',
    sidebar.includes('hasPermission(i.permission)') && !/const .*PERMISSIONS_BY_ROLE|function myRole\(/.test(sidebar)],
  ['someone who configures nothing is not offered the configuration section (cashier defect fix)',
    sidebar.includes('const CONFIGURATION_PERMISSIONS') && sidebar.includes('const configures = CONFIGURATION_PERMISSIONS.some(p => hasPermission(p));') &&
    !sidebar.includes("CONFIGURATION_PERMISSIONS = ['branches.view'")],
  ['hiding is presentation only -- the source says so and grants nothing',
    /no permission is granted, none is\n  \/\/ removed, and the server still authorises every request/.test(sidebar)],

  // ------------------------------------------------ C. HUMAN LANGUAGE
  ['no internal or technical term is used as a navigation label (RU)',
    navLabels(ru).every(l => !TECH_TERMS.some(t => l.includes(t)))],
  ['no internal or technical term is used as a navigation label (TK)',
    navLabels(tk).every(l => !TECH_TERMS.some(t => l.includes(t)))],
  ['both languages label every section',
    ['home','sales','orders','menu','stock','staff','guests','marketing','reports','advanced']
      .every(g => ru.includes(`"nav.group.${g}"`) && tk.includes(`"nav.group.${g}"`))],
  ['screens are named by what they are for, not by their module name',
    ru.includes('"nav.menu": "Блюда и цены"') && ru.includes('"nav.menuPreview": "Как видит гость"') &&
    ru.includes('"nav.inventory": "Остатки на складе"') && ru.includes('"nav.audit": "Журнал действий"')],

  // ------------------------------------------------ D. ERRORS A PERSON CAN ACT ON
  ['a refusal is explained in a sentence, not as a status line',
    errors.includes('FORBIDDEN:') && /У вас нет доступа/.test(errors) && /Недостаточно товара на складе/.test(errors)],
  ['every API failure goes through that translation',
    api.includes("import { humanError } from './humanErrors';") &&
    api.includes('err.message = humanError({ code: err.code, status: err.status, message: err.serverMessage }, currentLang());')],
  ['a raw server CODE is never shown to an operator as if it were a sentence',
    errors.includes('/^[A-Z][A-Z0-9_]{3,}$/.test(raw)') && errors.includes('looksLikeCode')],
  ['the ORIGINAL code is still carried on the error, so nothing downstream loses it',
    api.includes('err.code = data?.code || data?.error;') && api.includes('err.serverMessage =')],

  // ------------------------------------------------ E. THE REAL DEFECTS THIS STAGE FIXED
  ['the working interface honours reduced motion the same way the guest menu does',
    app.includes('boom-reduced-motion-safe') && read('src/design-system/tokens.css').includes('.boom-reduced-motion-safe')],
  ['no screen asks the server for a list its viewer may not have (branches / franchises)',
    header.includes("if (hasPermission('branches.view'))") && header.includes("if (hasPermission('franchises.view'))")],
  ['a scope selector with nothing to choose between is not shown at all',
    header.includes('{user && franchises.length > 0 && (') && header.includes('{user && visibleBranches.length > 0 && (')],
  ['"Заказы и кухня" no longer blanks out for a cashier because of the kitchen list',
    operations.includes("canKds=hasPermission('kds.view')") &&
    operations.includes('canKds?api.getKds({branch_id:branchId}).catch(fail):Promise.resolve(null)') &&
    !operations.includes('await Promise.all([api.getOrders({branch_id:branchId}),api.getPayments({branch_id:branchId}),api.getKds(')],
  ['a section is hidden when its data was never requested, rather than showing a false zero',
    operations.includes('{canKds&&<div className="panel p-4">') && operations.includes('{canKds&&<section className="panel p-4">')],
  ['the WAITER DEVICE menu endpoint is called ONLY from the waiter device screen',
    codeOnly(waiter).includes('api.getMenu(branchId)') &&
    !codeOnly(cashier).includes('api.getMenu(') && !codeOnly(boomcard).includes('api.getMenu(')],
  ['the compliment and birthday-gift dish pickers read a list their user can actually load',
    cashier.includes('api.getPublicMenu(branchId,') && boomcard.includes('api.getPublicMenu(branchId,')],

  // ------------------------------------------------ F. WHAT STAGE 40 WAS NOT ALLOWED TO TOUCH
  ['no second navigation system was introduced -- there is still one sidebar',
    fs.readdirSync('src/components').filter(f => /^Sidebar/.test(f)).length === 1],
  ['the frontend still invents no price, total or permission of its own',
    !/const *(price|total|discount) *= *[0-9]/.test(sidebar + header + operations)],
  ['the stage report exists', fs.existsSync('docs/STAGE-40-SIMPLE-UX-REPORT.md')],
];

let ok = 0;
for (const [name, v] of checks) { console.log(`${v ? 'PASS' : 'FAIL'} ${name}`); if (v) ok++; }
console.log(`${ok}/${checks.length} PASS`);
if (ok !== checks.length) process.exit(1);
