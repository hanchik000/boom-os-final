// BOOM OS -- Stage 39: ADMIN site design / Customer Menu visual editor.
//
// Source guards for the architecture this stage is defined by: CONTENT and DESIGN are separate,
// a visual section can never hold a second copy of business data, and the design editor offers
// presets rather than an injection surface. The behavioural proof is stage39_site_design_e2e.mjs.
import fs from 'node:fs';
const read = p => fs.readFileSync(p, 'utf8');

const schema = read('prisma/schema.prisma');
const migration = read('prisma/migrations/20260925000000_stage39_site_design/migration.sql');
const visualCatalog = read('server/routes/visual-catalog.ts');
const menu = read('server/routes/menu.ts');
const publicMenu = read('server/routes/public-menu.ts');
const api = read('src/api.ts');
const editor = read('src/components/VisualCatalogView.tsx');
const sections = read('src/components/CustomerSiteSections.tsx');
const customerMenu = read('src/components/VisualCustomerMenuView.tsx');
const dishEditor = read('src/components/MenuDishEditor.tsx');
const css = read('src/design-system/menu-builder.css');

const checks = [
  // -------------------------------------------- A. THE SOURCE-OF-TRUTH RULE
  ['a reference section may not carry its own title, subtitle or media -- enforced server-side',
    visualCatalog.includes("const REFERENCE_TYPES = ['MENU_ITEM','CATEGORY','PROMOTION']") &&
    visualCatalog.includes('function referenceConflict') &&
    visualCatalog.includes("code:'BLOCK_DUPLICATES_MENU_DATA'")],
  ['the guard runs on BOTH create and edit, and on edit against the RESULTING type',
    (visualCatalog.match(/referenceConflict\(/g) || []).length === 3 &&
    visualCatalog.includes('const conflict=referenceConflict(finalType,{...row,...req.body});')],
  ['the visual catalog table has NO price column of any kind',
    !/^\s*(price|amount|cost|promo_price)\s/m.test((schema.match(/^model VisualCatalogBlock \{[\s\S]*?^\}/m) || [''])[0])],
  ['the public payload serves a reference section with null content, by construction',
    visualCatalog.includes('title:isReference?null:loc(r,\'title\',lang)') &&
    visualCatalog.includes('media_url:isReference?null:')],
  ['a reference whose entity was archived drops out rather than rendering broken',
    visualCatalog.includes("if(r.type==='MENU_ITEM') return Boolean(r.menu_item_id)&&itemIds.has(r.menu_item_id);")],
  ['the guest renderer reads the dish from the live Menu Engine rows, never from the section',
    sections.includes('const item = items.find(i => i.id === b.menu_item_id);') &&
    /PRICE is the Menu Engine's/.test(sections)],
  ['the editor does not even offer content fields on a reference section',
    editor.includes("const REFERENCE_TYPES = ['MENU_ITEM', 'CATEGORY', 'PROMOTION']") &&
    editor.includes('const isRef = REFERENCE_TYPES.includes(f.type);') &&
    editor.includes('title_ru: isRef ? null :')],

  // -------------------------------------------- B. no second engine / CMS
  ['no second menu, catalog, CMS or page system was created',
    !fs.existsSync('server/routes/cms.ts') && !fs.existsSync('server/routes/pages.ts') &&
    !fs.existsSync('server/routes/site.ts') && !/model\s+(Page|CmsBlock|SiteContent)\b/.test(schema) &&
    (schema.match(/^model VisualCatalogBlock \{/gm) || []).length === 1],
  ['sections stay on the EXISTING visual_catalog_blocks table -- only nullable columns were added',
    (migration.match(/ALTER TABLE "visual_catalog_blocks" ADD COLUMN/g) || []).length === 10 &&
    !/DROP\s+(TABLE|COLUMN|CONSTRAINT)/i.test(migration) && !/ALTER COLUMN/i.test(migration)],
  ['exactly one new table, holding per-branch design presets',
    (migration.match(/CREATE TABLE/g) || []).length === 1 && /CREATE TABLE "site_designs"/.test(migration) &&
    /site_designs_branch_id_key/.test(migration)],
  ['branding remains its own existing system -- no branding column was added here',
    !/BRANDING_/.test(visualCatalog) && !/logo|favicon|brand_name/i.test((schema.match(/^model SiteDesign \{[\s\S]*?^\}/m) || [''])[0])],
  ['media is still the one Media Engine: a section references an asset, it never stores a file',
    /media_asset_id/.test(visualCatalog) && !/model\s+SiteMedia/.test(schema)],

  // -------------------------------------------- C. presets, not CSS injection
  ['every section preset is validated against a closed set, server-side',
    visualCatalog.includes('const PRESETS: Record<string, string[]>') &&
    visualCatalog.includes('function readPresets') && visualCatalog.includes("code:'INVALID_DESIGN_PRESET'")],
  ['every page-level design value is validated against a closed set too',
    visualCatalog.includes('const DESIGN_PRESETS: Record<string, string[]>') &&
    /if\(!DESIGN_PRESETS\[key\]\.includes\(v\)\)/.test(visualCatalog)],
  ['the design table has no field that could hold CSS, HTML or script',
    // `card_style` legitimately contains the word "style"; what must be absent is a field that
    // could hold free markup or a stylesheet.
    !/\b(custom_css|custom_html|raw_css|raw_html|script|head_html|body_html|inline_style)\b/i
      .test((schema.match(/^model SiteDesign \{[\s\S]*?^\}/m) || [''])[0])],
  ['the stylesheet keys off data-* attributes, never an interpolated administrator string',
    /\.boom-site\[data-theme="GRAPHITE"\]/.test(css) && /\.site-card\[data-card="PREMIUM"\]/.test(css)],
  ['no guest component interpolates a preset into a class name or a style string',
    !/className=\{`[^`]*\$\{(design|b)\.(theme|accent|card_style|density|radius)/.test(sections) &&
    !/dangerouslySetInnerHTML/.test(sections + customerMenu + editor)],
  ['the reason presets exist instead of free CSS is recorded in source',
    /never free CSS|not an injection surface|cannot be used as an injection surface/i.test(visualCatalog)],

  // -------------------------------------------- D. ordering is server-persisted
  ['reordering is one atomic server call over the whole ordered list',
    visualCatalog.includes("router.post('/reorder', requirePermission('visual_catalog.manage')") &&
    visualCatalog.includes('await transaction(async (tx)=>{')],
  ['a reorder may only touch sections in the caller\'s own branch',
    visualCatalog.includes("if(rows.some((r:any)=>r.branch_id!==branch))")],
  ['the editor reorders through that route, not by patching rows one at a time',
    editor.includes('api.reorderVisualCatalog(branchId, next.map(x => x.id))') &&
    !/updateVisualCatalogBlock\([^)]*sort_order/.test(editor)],
  ['the guest renders the persisted order', customerMenu.includes('data.blocks.map((b:any)=><SiteSection')],

  // -------------------------------------------- E. RBAC / branch / audit
  ['every design and section mutation carries the EXISTING visual_catalog.manage permission',
    (visualCatalog.match(/requirePermission\('visual_catalog\.manage'\)/g) || []).length === 5 &&
    (visualCatalog.match(/requirePermission\('visual_catalog\.view'\)/g) || []).length === 2],
  ['no new permission code was invented', !/visual_catalog\.(publish|design|site)/.test(visualCatalog + api)],
  ['branch scope is enforced on every route through the existing helpers',
    visualCatalog.includes('const isAccessible = (req: Request, branchId: string | null) =>') &&
    (visualCatalog.match(/scope\(req,/g) || []).length >= 4],
  ['mutations are recorded in the EXISTING audit log, with new actions for the new operations',
    visualCatalog.includes("action:'VISUAL_CATALOG_REORDERED'") && visualCatalog.includes("action:'SITE_DESIGN_UPDATED'") &&
    visualCatalog.includes('insertAuditLog(') && !/audit_v2|site_audit/.test(visualCatalog)],
  ['a deactivated section is recoverable -- nothing is hard-deleted',
    /UPDATE visual_catalog_blocks SET active=false/.test(visualCatalog) && !/DELETE FROM visual_catalog_blocks/i.test(visualCatalog)],

  // -------------------------------------------- F. Menu Builder owns content
  ['a dish can be moved between categories from the Menu Builder, branch-scoped',
    menu.includes('let categoryId = row.category_id;') && menu.includes("code:'MENU_CATEGORY_NOT_FOUND'") &&
    dishEditor.includes("aria-label={t('Категория', 'Kategoriýa')}")],
  ['archiving a dish is reversible again -- restoring clears deleted_at',
    menu.includes("const deletedAt = status === 'ACTIVE' ? null : row.deleted_at;") &&
    /an ARCHIVED dish is loaded too/.test(menu)],
  ['the customer menu still reads dish content from the public Menu Engine route',
    publicMenu.includes("router.get('/menu'") && customerMenu.includes('api.getPublicVisualCatalog(')],

  // -------------------------------------------- G. public safety
  ['no internal cost, recipe, stock or supplier field is selected on the guest catalog route',
    !/recipe_cost|average_cost|theoretical_cost|current_stock|supplier|food_cost/i.test(visualCatalog)],
  ['the design served publicly is preset identifiers only',
    visualCatalog.includes('design:await siteDesignFor(branch)') && visualCatalog.includes('export async function siteDesignFor')],

  // -------------------------------------------- H. wiring + docs
  ['the api client exposes the reorder and design routes',
    ['reorderVisualCatalog', 'getSiteDesign', 'updateSiteDesign'].every(m => api.includes(`${m}:`))],
  ['the editor offers the new section vocabulary',
    ['MENU_ITEM', 'TEXT', 'MEDIA', 'CTA'].every(t => editor.includes(`'${t}'`))],
  ['the guest renderer handles every section type it is sent',
    ['MENU_ITEM', 'CATEGORY', 'PROMOTION', 'NEW_ITEMS', 'SPACER', 'TEXT', 'MEDIA'].every(t => sections.includes(`'${t}'`))],
  ['the new guest styling honours reduced motion',
    /@media \(prefers-reduced-motion:reduce\)\{\.site-card\{transition:none\}/.test(css)],
  ['the stage report exists', fs.existsSync('docs/STAGE-FINAL-SITE-DESIGN-REPORT.md')],
  ['the report states plainly that this is not a Webflow clone',
    fs.existsSync('docs/STAGE-FINAL-SITE-DESIGN-REPORT.md') && /not a full arbitrary Webflow/i.test(read('docs/STAGE-FINAL-SITE-DESIGN-REPORT.md'))],
  ['the Stage 39 runtime test exists', fs.existsSync('tests/stage39_site_design_e2e.mjs')],
];

let ok = 0;
for (const [name, v] of checks) { console.log(`${v ? 'PASS' : 'FAIL'} ${name}`); if (v) ok++; }
console.log(`${ok}/${checks.length} PASS`);
if (ok !== checks.length) process.exit(1);
