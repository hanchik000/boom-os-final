// BOOM OS -- Stage 44: the administrative interface on a phone, dead ends for accounts without a
// branch, and honest data freshness on the kitchen screens.
//
// Source guards only. No business behaviour changed in this stage: no endpoint, no permission, no
// schema, no financial or kitchen rule. The behavioural proof is the unchanged E2E regression; the
// visual proof is the browser walkthrough recorded in the stage report.
import fs from 'node:fs';
const read = p => fs.readFileSync(p, 'utf8');
const stripComments = src => src
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '')
  .replace(/^\s*\*.*$/gm, '');

const app = read('src/App.tsx');
const sidebar = read('src/components/Sidebar.tsx');
const header = read('src/components/Header.tsx');
const adminCss = read('src/design-system/admin-ui.css');
const cmdCss = read('src/design-system/command-center.css');
const kitchenCss = read('src/design-system/kitchen.css');
const scope = read('src/useBranchScope.ts');
const fresh = read('src/freshness.ts');
const views = fs.readdirSync('src/components').filter(f => f.endsWith('.tsx'));
const src = Object.fromEntries(views.map(f => [f, read(`src/components/${f}`)]));
const code = Object.fromEntries(views.map(f => [f, stripComments(src[f])]));

// The six screens that used to dead-end for an account with no branch of its own.
const BRANCH_SCOPED = ['KitchenStationView.tsx', 'ExpoView.tsx', 'ReceiptSettingsView.tsx',
  'FoodCostView.tsx', 'AnalyticsView.tsx', 'CreditReportsView.tsx', 'KitchenControlView.tsx'];
// The three kitchen screens that are left open for a whole shift.
const LIVE = ['KitchenStationView.tsx', 'ExpoView.tsx', 'KitchenControlView.tsx'];

const checks = [
  // ------------------------------------------------------------- A. THE PHONE LAYOUT EXISTS
  ['the sidebar can be a drawer: it takes an open flag and a way to close itself',
    /drawerOpen\?: boolean;/.test(sidebar) && /onCloseDrawer\?: \(\) => void;/.test(sidebar)],
  ['below the tablet breakpoint the drawer is lifted out of the layout, so the content gets the whole screen',
    /max-md:fixed/.test(sidebar) && /max-md:inset-y-0/.test(sidebar) && /max-md:left-0/.test(sidebar)],
  ['the drawer is off-screen until it is opened',
    /drawerOpen \? 'max-md:translate-x-0' : 'max-md:-translate-x-full'/.test(sidebar)],
  ['its state is readable from the DOM, so it can be verified rather than assumed',
    /data-drawer-open=\{drawerOpen \? 'true' : 'false'\}/.test(sidebar)],
  ['nothing changes at tablet width and above: every drawer rule is a max-md rule',
    (code['Sidebar.tsx'].match(/\bmax-md:/g) || []).length >= 6 &&
    !/(?<!max-)md:(fixed|translate)/.test(code['Sidebar.tsx'])],
  ['tapping beside the drawer closes it, and the backdrop exists only on a phone',
    /id="boom-nav-backdrop"/.test(sidebar) && /md:hidden/.test(sidebar) &&
    /onClick=\{\(\) => onCloseDrawer\?\.\(\)\}/.test(sidebar)],
  ['a phone has a way to reach the navigation at all',
    /onOpenNav\?: \(\) => void;/.test(header) && /id="btn-open-nav"/.test(header) &&
    /onClick=\{\(\) => onOpenNav\?\.\(\)\}/.test(header)],
  ['the trigger\'s breakpoint lives with its own styles, where no later stylesheet can outrank it',
    /\.boom-nav-trigger \{ display: inline-flex;/.test(adminCss) &&
    /@media \(min-width: 768px\) \{ \.boom-nav-trigger \{ display: none; \} \}/.test(adminCss) &&
    /id="btn-open-nav"[\s\S]{0,200}boom-nav-trigger/.test(header) &&
    !/boom-nav-trigger[^"]*md:hidden|md:hidden[^"]*boom-nav-trigger/.test(header)],
  ['the drawer closes when a destination is chosen, by Escape, and from the backdrop',
    /onSelectTab=\{\(tab\) => \{ setCurrentTab\(tab\); setNavOpen\(false\); \}\}/.test(app) &&
    /if \(e\.key === 'Escape'\) setNavOpen\(false\);/.test(app) &&
    /onCloseDrawer=\{\(\) => setNavOpen\(false\)\}/.test(app)],
  ['the drawer hooks run before the loading early-return, so React never sees a changing hook order',
    app.includes('const [navOpen, setNavOpen] = useState(false);') &&
    app.includes("window.addEventListener('keydown', onKey);") &&
    app.indexOf('const [navOpen, setNavOpen] = useState(false);') < app.indexOf('if (isLoading) {') &&
    app.indexOf("window.addEventListener('keydown', onKey);") < app.indexOf('if (isLoading) {')],
  ['the Escape listener is removed again',
    /return \(\) => window\.removeEventListener\('keydown', onKey\);/.test(app)],

  // ------------------------------------------------------- B. NOTHING IS CUT OFF ON A PHONE
  ['no wrapper clips the table it holds: a wide table scrolls to its last column',
    views.every(f => {
      const lines = src[f].split('\n');
      return !lines.some((l, i) => l.includes('overflow-hidden') &&
        (lines[i + 1] || '').trim().startsWith('<table'));
    })],
  ['the command centre tables scroll instead of being clipped',
    /\.cmd-table-wrap\{[^}]*overflow-x:auto/.test(cmdCss) && /\.cmd-table\{min-width:460px\}/.test(cmdCss)],
  ['the employee list scrolls as a whole instead of losing its last column',
    /rounded-2xl border border-slate-800 overflow-x-auto bg-slate-900\/50/.test(src['EmployeesView.tsx']) &&
    (src['EmployeesView.tsx'].match(/grid-cols-\[1\.4fr_1fr_1fr_1fr_130px\] min-w-\[620px\]/g) || []).length === 2],
  ['the header survives a 390px screen: it wraps instead of pushing the title out of view',
    /flex items-center justify-between gap-3 flex-wrap/.test(header) &&
    /flex items-center gap-2 sm:gap-3 flex-wrap justify-end/.test(header)],
  ['the branch and franchise scopes stay usable on a phone -- they wrap, they are not hidden',
    !/hidden lg:flex items-center gap-2 bg-slate-950/.test(header) &&
    !/hidden md:flex items-center gap-2 bg-slate-950/.test(header) &&
    /id="branch-scope-select"/.test(header) && /id="franchise-scope-select"/.test(header)],

  // --------------------------------------------------- C. NO DEAD ENDS WITHOUT A HOME BRANCH
  ['there is ONE rule for which branch a screen is about, not six copies',
    fs.existsSync('src/useBranchScope.ts') && /export function useBranchScope\(\)/.test(scope) &&
    /selectedBranchFilter !== 'ALL' \? selectedBranchFilter : list\[0\]\?\.id/.test(scope)],
  ['the account\'s own branch is what a screen opens on, so a cook is never asked to choose',
    /if \(user\?\.branch_id\) setBranchId\(prev => prev \|\| user\.branch_id!\);/.test(scope) &&
    /setBranchId\(prev => prev \|\| user\?\.branch_id \|\|/.test(scope)],
  ['the branch list is read only by someone allowed to read it -- no new permission, no new endpoint',
    /if \(!hasPermission\('branches\.view'\)\) return;/.test(scope) &&
    /api\.getBranches\(\)/.test(scope) && !/fetch\(/.test(scope)],
  ['every screen that used to dead-end now uses that one rule',
    BRANCH_SCOPED.every(f => /useBranchScope\(\)/.test(code[f]) &&
      !/const branchId = user\?\.branch_id \|\| '';/.test(code[f]))],
  ['and each one says what to do when there is genuinely no branch',
    BRANCH_SCOPED.every(f => /<EmptyState/.test(code[f]) &&
      /Выберите филиал в шапке страницы/.test(src[f]) && /şahamçany saýlaň/.test(src[f]))],
  ['a branch selector appears only when there is more than one branch to choose',
    BRANCH_SCOPED.every(f => !/branches\.length/.test(code[f]) || /branches\.length > 1/.test(code[f]))],

  // ------------------------------------------------------------------ D. HONEST FRESHNESS
  ['the "N назад" wording lives in one module',
    fs.existsSync('src/freshness.ts') && /export function agoFragment/.test(fresh) &&
    /export function timeAgoLabel/.test(fresh)],
  ['no screen keeps a second copy of it',
    views.every(f => !/function (agoFragment|timeAgoLabel)/.test(code[f]))],
  ['the manager command centre now reads it from there, with its wording unchanged',
    /import \{ agoFragment, timeAgoLabel \} from '\.\.\/freshness';/.test(src['ManagerCommandCenterView.tsx']) &&
    /timeAgoLabel\(lastUpdatedAt, ru\)/.test(src['ManagerCommandCenterView.tsx'])],
  ['each live kitchen screen records when its data actually arrived',
    LIVE.every(f => /const \[lastUpdatedAt, setLastUpdatedAt\] = useState<number \| null>\(null\);/.test(code[f]) &&
      /setLastUpdatedAt\(Date\.now\(\)\)/.test(code[f]))],
  ['a failed read never backdates the screen as fresh',
    LIVE.every(f => !/catch \(e: any\) \{[\s\S]{0,200}setLastUpdatedAt/.test(code[f]))],
  ['each live kitchen screen shows that age to the person using it',
    /id="kt-last-updated"/.test(src['KitchenStationView.tsx']) &&
    /id="expo-last-updated"/.test(src['ExpoView.tsx']) &&
    /id="kitchen-control-last-updated"/.test(src['KitchenControlView.tsx']) &&
    LIVE.every(f => /timeAgoLabel\(lastUpdatedAt, ru\)/.test(code[f]))],
  ['polling stops while the tab is hidden and reads once on return',
    LIVE.every(f => /if \(document\.hidden\) stop\(\);\s*\n\s*else \{ void (loadQueue|load|refresh)\(true\); start\(\); \}/.test(code[f]) &&
      /document\.addEventListener\('visibilitychange', onVisibility\);/.test(code[f]) &&
      /document\.removeEventListener\('visibilitychange', onVisibility\);/.test(code[f]))],
  ['the age ticker only re-renders -- it never fetches',
    LIVE.every(f => /setInterval\(\(\) => setTick\(x => x \+ 1\), 1000\)/.test(code[f])) &&
    LIVE.every(f => !/setInterval\(\(\) => \{ setTick[\s\S]{0,120}(load|refresh)\(/.test(code[f]))],
  ['a failed refresh keeps the last real board on screen and dates it',
    /\{error && queue && \(/.test(src['KitchenStationView.tsx']) &&
    /\{error && lastUpdatedAt && \(/.test(src['ExpoView.tsx']) &&
    /\{error && load && \(/.test(src['KitchenControlView.tsx']) &&
    LIVE.every(f => /agoFragment\(lastUpdatedAt, (true|false)\)/.test(code[f]))],
  ['a failure with nothing to show yet is still a plain error, not a stale notice',
    /\{error && !queue && <Notice kind="error">/.test(src['KitchenStationView.tsx']) &&
    /\{error && !lastUpdatedAt && <Notice kind="error">/.test(src['ExpoView.tsx']) &&
    /\{error && !load && <Notice kind="error">/.test(src['KitchenControlView.tsx'])],
  ['the stale notice has one style, in the kitchen stylesheet',
    /\.kt-stale\{/.test(kitchenCss) && /\.kt-last-updated\{/.test(kitchenCss)],

  // ------------------------------------------------------- E. WHAT MUST NOT HAVE CHANGED
  ['no API contract was added for this stage: the new modules call methods that already existed',
    /getBranches: \(/.test(read('src/api.ts')) &&
    !/fetch\(/.test(scope) && !/fetch\(/.test(fresh) &&
    BRANCH_SCOPED.every(f => !/fetch\('\/api\//.test(code[f]))],
  ['the reduced-motion convention is untouched',
    read('src/design-system/tokens.css').includes('transition-duration: 0.001ms !important') &&
    app.includes('boom-reduced-motion-safe')],
  ['Stage 40 navigation and the separate advanced section are intact',
    /const navSections: NavSection\[\]/.test(sidebar) && /const advancedSection: NavSection/.test(sidebar) &&
    /CONFIGURATION_PERMISSIONS/.test(sidebar)],
  ['role visibility still comes from the existing permission check',
    /hasPermission\(i\.permission\)/.test(sidebar)],
  ['both languages are carried everywhere this stage wrote text',
    /Меню/.test(read('src/translations/ru.ts')) && /Menýu/.test(read('src/translations/tk.ts')) &&
    BRANCH_SCOPED.every(f => /Şahamça saýlanmadyk/.test(src[f]))],
  ['the stage report exists', fs.existsSync('docs/STAGE-44-ADMIN-PHONE-FRESHNESS-REPORT.md')],
];

let ok = 0;
for (const [name, v] of checks) { console.log(`${v ? 'PASS' : 'FAIL'} ${name}`); if (v) ok++; }
console.log(`${ok}/${checks.length} PASS`);
if (ok !== checks.length) process.exit(1);
