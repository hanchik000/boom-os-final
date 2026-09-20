// BOOM OS -- Stage 36: Admin Control Center, Menu Builder, Media, Banners and Branding.
//
// Source guards for the invariants the Stage 36 runtime test cannot pin: that ADMIN controls the
// EXISTING engines rather than growing parallel ones, that every new write is RBAC-gated,
// branch-scoped, soft-deleting and audited, and that no business value is computed in the
// frontend. The behavioural proof lives in tests/stage36_admin_control_center_e2e.mjs.
import fs from 'node:fs';
const read = p => fs.readFileSync(p, 'utf8');

const menu = read('server/routes/menu.ts');
const publicMenu = read('server/routes/public-menu.ts');
const mediaAssets = read('server/routes/media-assets.ts');
const visualCatalogApi = read('server/routes/visual-catalog.ts');
const seed = read('server/seed.ts');
const schema = read('prisma/schema.prisma');
const migration = read('prisma/migrations/20260922000000_stage36_dish_media/migration.sql');

const app = read('src/App.tsx');
const sidebar = read('src/components/Sidebar.tsx');
const builder = read('src/components/MenuEngineView.tsx');
const brandingCtx = read('src/context/BrandingContext.tsx');
const brandingView = read('src/components/BrandingView.tsx');
const mediaView = read('src/components/MediaLibraryView.tsx');
const catalogView = read('src/components/VisualCatalogView.tsx');
const previewView = read('src/components/MenuPreviewView.tsx');
const promotionsView = read('src/components/PromotionsView.tsx');
const customerMenu = read('src/components/VisualCustomerMenuView.tsx');
const waiterPos = read('src/components/WaiterPOSView.tsx');
const api = read('src/api.ts');
const ru = read('src/translations/ru.ts');
const tk = read('src/translations/tk.ts');
const builderCss = read('src/design-system/menu-builder.css');
const main = read('src/main.tsx');

const srcFiles = fs.readdirSync('src/components').map(f => `src/components/${f}`).filter(f => f.endsWith('.tsx'));

const checks = [
  // ---------------------------------------------------------------- A. dish media == ONE media engine
  ['dish media is a nullable FK into the EXISTING MediaAsset table, not a second media table',
    /media_asset_id\s+String\?/.test(schema) && /media_asset\s+MediaAsset\?\s+@relation\(fields:\s*\[media_asset_id\]/.test(schema)],
  ['Stage 36 introduced NO new media model -- only the two that already existed (PosMedia for POS idle screens, MediaAsset for the menu library)',
    (() => {
      const models = (schema.match(/^model\s+(\w*Media\w*)\s/gm) || []).map(m => m.trim().split(/\s+/)[1]).sort();
      return models.join(',') === 'MediaAsset,PosMedia';
    })()],
  ['detaching or deleting an asset never cascades a dish away (ON DELETE SET NULL)',
    /ON DELETE SET NULL/.test(migration) && /onDelete:\s*SetNull/.test(schema)],
  ['the migration only ADDs a nullable column and an index -- it drops nothing',
    /ADD COLUMN "media_asset_id" TEXT/.test(migration) && !/DROP\s+(TABLE|COLUMN)/i.test(migration)],
  ['the admin menu resolves the photo from media_assets by LEFT JOIN, it does not store a second URL on the dish',
    menu.includes('LEFT JOIN media_assets m ON m.id=mi.media_asset_id')],
  ['the waiter POS menu reads the SAME asset row (and only while the asset is active)',
    menu.includes('LEFT JOIN media_assets m ON m.id=mi.media_asset_id AND m.active=true')],
  ['the guest menu reads the SAME asset row', publicMenu.includes('LEFT JOIN media_assets md ON md.id=mi.media_asset_id AND md.active=true')],
  ['the visual catalog reads the SAME asset row', visualCatalogApi.includes('LEFT JOIN media_assets md ON md.id=mi.media_asset_id AND md.active=true')],
  ['attaching a dish photo validates the asset exists and is inside the caller\'s branch scope',
    menu.includes("code:'MEDIA_ASSET_NOT_FOUND'") && menu.includes("if (asset.branch_id && !scopedBranch(req, asset.branch_id)) return res.status(403)")],
  ['the JSON media-asset create route inserts as many values as it names columns (Stage 36 fix)',
    (() => {
      const m = [...mediaAssets.matchAll(/INSERT INTO media_assets \(([^)]*)\) VALUES \(([^)]*)\)/g)];
      return m.length > 0 && m.every(x => x[1].split(',').length === x[2].split(',').length);
    })()],

  // ---------------------------------------------------------------- B. Menu Builder writes -> the existing engine
  ['modifier groups can be edited and archived, gated on the EXISTING menu.manage permission',
    menu.includes("router.patch('/modifier-groups/:groupId', requirePermission('menu.manage')") &&
    menu.includes("router.delete('/modifier-groups/:groupId', requirePermission('menu.manage')")],
  ['modifier options can be edited and archived, gated on the EXISTING menu.manage permission',
    menu.includes("router.patch('/modifiers/:modifierId', requirePermission('menu.manage')") &&
    menu.includes("router.delete('/modifiers/:modifierId', requirePermission('menu.manage')")],
  ['every new modifier route resolves its branch through the shared scope helper',
    menu.includes('async function loadScopedGroup(') && menu.includes('scopedBranch(req, group.branch_id)')],
  ['archiving a modifier group or option is a SOFT delete (status INACTIVE), never a DELETE FROM',
    /UPDATE menu_modifier_groups SET status='INACTIVE'/.test(menu) &&
    /UPDATE menu_modifiers SET status='INACTIVE'/.test(menu) &&
    !/DELETE FROM menu_modifier/i.test(menu)],
  ['no menu route hard-deletes a business row', !/DELETE FROM menu_(items|categories)/i.test(menu)],
  ['the new modifier writes are recorded in the EXISTING audit system, not a new one',
    ['MENU_MODIFIER_GROUP_UPDATED', 'MENU_MODIFIER_GROUP_ARCHIVED', 'MENU_MODIFIER_UPDATED', 'MENU_MODIFIER_ARCHIVED']
      .every(a => menu.includes(a)) && menu.includes('insertAuditLog(execute')],
  ['the archive/restore surface reads archived rows through an explicit opt-in flag, so every other caller keeps the ACTIVE-only view',
    menu.includes("const includeArchived = String(req.query.include_archived || '') === 'true';") &&
    menu.includes("const withArchived = String(req.query.include_archived || '') === 'true';")],

  // ---------------------------------------------------------------- C. Burger Constructor == no second engine
  ['the Menu Builder states in source that the Burger Constructor is not a second engine',
    /not a second engine/i.test(builder)],
  ['the constructor renders the existing modifier groups/options -- it defines no component table of its own',
    builder.includes("Tab = 'catalog' | 'constructor'") && builder.includes('api.getMenuModifiers(')],
  ['the Menu Builder never computes a total, a discount or a promotional price in the browser',
    !/subtotal|totalPrice|\bdiscount\s*=/.test(builder)],
  ['the Menu Builder sends prices as the operator typed them and renders back what the server returned',
    builder.includes('api.updateMenuItem(') && !/parseFloat\([^)]*\)\s*[*+\-]/.test(builder)],

  // ---------------------------------------------------------------- D. Media Library completeness
  ['the Media Library edits the whole asset record through the EXISTING PATCH route',
    ['alt_ru', 'alt_tk', 'poster_url', 'focal_x', 'focal_y', 'priority'].every(f => mediaView.includes(f)) &&
    mediaView.includes('api.updateMediaAsset(')],
  ['the Media Library writes are gated on menu.media.manage and reads on menu.media.view',
    mediaView.includes("hasPermission('menu.media.manage')") && mediaView.includes("hasPermission('menu.media.view')")],
  ['the Media Library "delete" is the existing soft deactivation, and says so',
    mediaView.includes('api.deactivateMediaAsset(') && /nothing is hard-deleted/i.test(mediaView)],
  ['the media PATCH route is branch-scoped and audited server-side',
    mediaAssets.includes("router.patch('/:id', requirePermission('menu.media.manage')") &&
    mediaAssets.includes("MENU_MEDIA_ASSET_UPDATED")],

  // ---------------------------------------------------------------- E. Banners / Visual Catalog
  ['banners are the existing visual_catalog_blocks with type=BANNER, not a separate banner engine',
    catalogView.includes("'BANNER'") && /same block table with a different `type`/i.test(catalogView) &&
    !fs.existsSync('server/routes/banners.ts')],
  ['an existing block can now be fully edited (subtitle, channels, schedule, priority) via the existing PATCH route',
    ['subtitle_ru', 'subtitle_tk', 'schedule_start', 'schedule_end', 'priority', 'channels'].every(f => catalogView.includes(f)) &&
    catalogView.includes('api.updateVisualCatalogBlock(')],
  ['create and edit share ONE field set, so the two paths cannot drift apart',
    catalogView.includes('const fields = (f: any, set: (next: any) => void') &&
    (catalogView.match(/fields\((form|editForm)/g) || []).length === 2],
  ['deactivated blocks stay listed for ADMIN so they can be restored instead of re-created',
    catalogView.includes('showInactive')],
  ['catalog writes are gated on visual_catalog.manage both in the UI and on the server',
    catalogView.includes("hasPermission('visual_catalog.manage')") &&
    visualCatalogApi.includes("router.patch('/:id', requirePermission('visual_catalog.manage')")],
  ['the catalog view states that a block never carries a price or a discount',
    /never carries a price/i.test(catalogView)],

  // ---------------------------------------------------------------- F. Promotions administration
  ['an existing promotion can be edited from ADMIN through the existing PATCH route',
    promotionsView.includes('const saveEdit = async (p: any)') && promotionsView.includes('api.updatePromotion(p.id, {')],
  ['the promotion editor sends the raw values and lets the SERVER re-validate them',
    /server re-validates the price, the window and the placements/i.test(promotionsView)],
  ['the promotion editor never decides for itself whether a promotion is live',
    promotionsView.includes('p.is_live') && !/Date\.now\(\)\s*[<>]/.test(promotionsView)],

  // ---------------------------------------------------------------- G. Branding == existing system_settings
  ['branding keys are seeded into the EXISTING system_settings table, idempotently',
    ['BRANDING_PRODUCT_NAME', 'BRANDING_NETWORK_NAME', 'BRANDING_MARK', 'BRANDING_LOGO_URL', 'BRANDING_LOGO_DARK_URL', 'BRANDING_FAVICON_URL']
      .every(k => seed.includes(k)) && seed.includes('ON CONFLICT (key) DO NOTHING')],
  ['no branding table, no branding permission and no branding audit action were invented',
    !/model\s+Branding/i.test(schema) && !/branding\.(view|update|manage)/.test(seed + brandingView + api)],
  ['branding is written through the existing settings route, which carries settings.update and SETTINGS_UPDATED',
    brandingView.includes('api.updateSetting(') && brandingView.includes("hasPermission('settings.update')")],
  ['the public branding read exposes ONLY the six BRANDING_* keys',
    publicMenu.includes("router.get('/branding'") &&
    /WHERE key IN \('BRANDING_PRODUCT_NAME','BRANDING_NETWORK_NAME','BRANDING_MARK','BRANDING_LOGO_URL','BRANDING_LOGO_DARK_URL','BRANDING_FAVICON_URL'\)/.test(publicMenu)],
  ['there is ONE branding context and it is mounted above the whole app',
    app.includes('<BrandingProvider>') && app.includes("import { BrandingProvider, useBranding } from './context/BrandingContext';")],
  ['the branding context never lets a failed fetch blank out the brand area',
    brandingCtx.includes('const FALLBACK: Branding') && brandingCtx.includes('setBranding({ ...FALLBACK, ...(r.branding || {}) });')],
  ['the sidebar, the boot screen, the login, the dashboard, the waiter POS and the guest menu all read that ONE source',
    [sidebar, app, read('src/components/LoginModal.tsx'), read('src/components/DashboardView.tsx'), waiterPos, customerMenu]
      .every(f => f.includes('useBranding()'))],
  ['no hardcoded product/network wordmark remains in the shipped brand areas',
    !sidebar.includes('BOOMBURGER Network') && !/>\s*BOOM OS\s*</.test(sidebar) &&
    !customerMenu.includes('>BOOMBURGER<') && !waiterPos.includes('<strong>BOOM OS</strong>')],

  // ---------------------------------------------------------------- H. Unified ADMIN navigation
  ['navigation is grouped rather than one flat list', sidebar.includes('const navGroups:')],
  ['every nav entry has its own label -- no two destinations share a translation key',
    (() => {
      const keys = [...sidebar.matchAll(/\{ id: '\w+', key: '((?!nav\.group\.)[\w.]+)'/g)].map(m => m[1]);
      return keys.length > 0 && new Set(keys).size === keys.length;
    })()],
  ['every group heading and every new nav label exists in BOTH languages',
    ['nav.group.overview', 'nav.group.operations', 'nav.group.menu', 'nav.group.kitchen', 'nav.group.pos',
     'nav.group.customers', 'nav.group.staff', 'nav.group.reports', 'nav.group.settings',
     'nav.menu', 'nav.inventory', 'nav.operations', 'nav.orderApprovals', 'nav.branding', 'nav.menuPreview']
      .every(k => ru.includes(`"${k}"`) && tk.includes(`"${k}"`))],
  ['each nav entry is still filtered by its own permission -- grouping granted nobody anything',
    sidebar.includes('group.items.filter((item) => !item.permission || hasPermission(item.permission))')],
  ['there is exactly ONE inventory destination and ONE inventory backend (the duplication was a label defect)',
    (sidebar.match(/id: 'inventory'/g) || []).length === 1 && !fs.existsSync('server/routes/warehouse.ts')],
  ['every nav tab in the sidebar is actually routed in App.tsx (no button that goes nowhere)',
    (() => {
      // group headings share the same shape but are not destinations -- match only leaf entries.
      const ids = [...sidebar.matchAll(/\{ id: '(\w+)', key: '(?!nav\.group\.)[\w.]+'/g)].map(m => m[1]);
      return ids.length > 0 && ids.every(id => app.includes(`currentTab === '${id}'`));
    })()],
  ['POS configuration surfaces are consolidated into one group', sidebar.includes("{ id: 'pos', key: 'nav.group.pos'")],

  // ---------------------------------------------------------------- I. Menu preview == the real guest screen
  ['the menu preview embeds the REAL guest entry point instead of re-implementing the menu',
    previewView.includes('screen=customer') && previewView.includes('<iframe') && !previewView.includes('getPublicVisualCatalog')],
  ['the QR preview uses the server-issued token, and the branch selector cannot override it',
    previewView.includes('api.getBranchQr(') && /branch selector cannot override it/i.test(previewView) &&
    !/qr_token\s*=\s*[`'"]/.test(previewView)],
  ['the ?branch= preselect is validated against the public branch list and ignored on a QR visit',
    customerMenu.includes('if(qrToken)return;') && customerMenu.includes('list.find((b:any)=>b.id===want)')],
  ['QR branch resolution is still server-side only',
    publicMenu.includes("router.get('/qr/:token'") || api.includes('/api/public/qr/')],

  // ---------------------------------------------------------------- J. no fake data, no frontend financial truth
  ['no Stage 36 admin surface ships mock, sample or placeholder business data',
    [builder, mediaView, catalogView, previewView, brandingView]
      .every(f => !/MOCK_|SAMPLE_|FAKE_|DUMMY_|Math\.random\(\)/.test(f))],
  ['no Stage 36 admin surface computes money',
    [builder, mediaView, catalogView, previewView, brandingView]
      .every(f => !/\*\s*0\.\d|toFixed\(2\)\s*\*|\bVAT\b|serviceCharge\s*\*/.test(f))],
  ['no component invents a permission client-side; every gate is a hasPermission() call on a real code',
    srcFiles.every(f => !/hasPermission\(\s*true\s*\)/.test(read(f)))],

  // ---------------------------------------------------------------- K. wiring + docs
  ['the Menu Builder stylesheet is registered once in main.tsx', (main.match(/menu-builder\.css/g) || []).length === 1],
  ['the Menu Builder stylesheet honours reduced motion', builderCss.includes('@media (prefers-reduced-motion:reduce)')],
  ['the new api client methods exist for every new route',
    ['archiveMenuCategory', 'archiveMenuItem', 'updateModifierGroup', 'archiveModifierGroup', 'updateModifier', 'archiveModifier', 'getPublicBranding']
      .every(m => api.includes(`${m}:`))],
  ['the requirement coverage matrix exists', fs.existsSync('docs/STAGE-36-REQUIREMENT-COVERAGE.md')],
  ['the stage report exists', fs.existsSync('docs/STAGE-36-REPORT.md')],
  ['the Stage 36 runtime test exists', fs.existsSync('tests/stage36_admin_control_center_e2e.mjs')],
];

let ok = 0;
for (const [name, v] of checks) { console.log(`${v ? 'PASS' : 'FAIL'} ${name}`); if (v) ok++; }
console.log(`${ok}/${checks.length} PASS`);
if (ok !== checks.length) process.exit(1);
