// BOOM OS -- Stage 37: Advanced Menu Engine, Burger Constructor and dish completeness.
//
// Source guards for the invariants the runtime suite cannot pin: that the menu domain grew by
// extension rather than duplication, that customer-facing data stays separate from the recipe,
// that no surface computes a business value in the browser, and that the Stage 37 additions are
// wired into the SAME engines, permissions and audit log that already existed.
// The behavioural proof lives in tests/stage37_advanced_menu_engine_e2e.mjs.
import fs from 'node:fs';
const read = p => fs.readFileSync(p, 'utf8');

const schema = read('prisma/schema.prisma');
const migration = read('prisma/migrations/20260923000000_stage37_menu_domain/migration.sql');
const menu = read('server/routes/menu.ts');
const publicMenu = read('server/routes/public-menu.ts');
const visualCatalog = read('server/routes/visual-catalog.ts');
const mediaAssets = read('server/routes/media-assets.ts');
const orders = read('server/routes/orders.ts');
const seed = read('server/seed.ts');

const api = read('src/api.ts');
const builder = read('src/components/MenuEngineView.tsx');
const dishEditor = read('src/components/MenuDishEditor.tsx');
const mediaView = read('src/components/MediaLibraryView.tsx');
const waiterPos = read('src/components/WaiterPOSView.tsx');
const customerMenu = read('src/components/VisualCustomerMenuView.tsx');
const dishSheet = read('src/components/CustomerDishSheet.tsx');
const builderCss = read('src/design-system/menu-builder.css');

const checks = [
  // ------------------------------------------------- A. the schema grew by EXTENSION, not duplication
  ['EN content follows the existing paired-column i18n pattern on every menu entity',
    /name_en\s+String\?/.test(schema) && /description_en\s+String\?/.test(schema) &&
    ['menu_categories', 'menu_items', 'menu_modifier_groups', 'menu_modifiers'].every(t => new RegExp(`ALTER TABLE "${t}"\\s+ADD COLUMN "name_en"`).test(migration))],
  ['weight is STRUCTURED (a decimal plus a unit), never a formatted string',
    /weight_value\s+Decimal\?\s+@db\.Decimal\(10,3\)/.test(schema) && /weight_unit\s+String\?/.test(schema)],
  ['allergens are a reference table plus a dish link, not a free-text blob on the dish',
    /^model Allergen \{/m.test(schema) && /^model MenuItemAllergen \{/m.test(schema) && !/allergens\s+String\?/.test(schema)],
  ['the dish gallery REFERENCES existing media assets -- it is not a second media table',
    /^model MenuItemMedia \{/m.test(schema) && /media_asset_id String/.test(schema) &&
    (schema.match(/^model\s+(\w*Media\w*)\s/gm) || []).map(m => m.trim().split(/\s+/)[1]).sort().join(',') === 'MediaAsset,MenuItemMedia,PosMedia'],
  ['Stage 36\'s single primary photo column is untouched', /media_asset_id String\?/.test(schema) && !/DROP COLUMN "media_asset_id"/.test(migration)],
  ['a modifier option can be backed by a real Menu Engine item, with SET NULL so archiving never deletes it',
    /source_menu_item_id String\?/.test(schema) && /ON DELETE SET NULL/.test(migration) && /idx_menu_modifiers_source_item/.test(migration)],
  ['the migration is purely additive -- it drops and retypes nothing',
    !/DROP\s+(TABLE|COLUMN|CONSTRAINT)/i.test(migration) && !/ALTER COLUMN/i.test(migration) &&
    (migration.match(/ADD COLUMN/g) || []).length >= 10],
  ['no second menu, modifier or order engine was created',
    !fs.existsSync('server/routes/menu-v2.ts') && !fs.existsSync('server/routes/modifiers.ts') &&
    !fs.existsSync('server/routes/burger-constructor.ts') && !fs.existsSync('server/routes/orders-v2.ts') &&
    !/menu-v2|modifiers-v2|order-v2|burger-constructor/.test(api)],

  // ------------------------------------------------- B. the allergen list is a seeded regulated set
  ['the regulated allergen set is seeded idempotently with all three labels',
    seed.includes('ON CONFLICT (code) DO NOTHING') && seed.includes("['GLUTEN',") && seed.includes("['MOLLUSC',") &&
    (seed.match(/\['[A-Z]+',\s+'/g) || []).length >= 14],
  ['allergens are read-only from the API -- ADMIN links dishes, it does not invent regulated codes',
    menu.includes("router.get('/allergens', requirePermission('menu.view')") &&
    !/router\.(post|patch|delete)\('\/allergens/.test(menu)],
  ['an unknown or inactive allergen id is rejected rather than silently dropped',
    menu.includes('async function replaceAllergens') && menu.includes("code:'INVALID_ALLERGEN'")],

  // ------------------------------------------------- C. THE WAITER POS FIX (the Stage 37 defect)
  ['the waiter DEVICE menu route now carries the constructor groups',
    /router\.get\('\/pos'[\s\S]{0,4000}modifier_groups\s*=\s*groupsByItem/.test(menu)],
  ['the waiter POS reads those groups from the device payload, not from a JWT-only route',
    waiterPos.includes('const groups=item.modifier_groups||[]') &&
    // the name may survive in the comment that explains the fix; what must be gone is the CALL
    !waiterPos.split('\n').some(l => !l.trim().startsWith('//') && /api\.getMenuModifiers\(/.test(l))],
  ['the POS records in source WHY this changed, so it is not silently reintroduced',
    /JWT route a waiter device can never satisfy/.test(waiterPos)],
  ['the POS mirrors the group rules only to avoid a guaranteed rejection, and says the server decides',
    waiterPos.includes('const groupIssue=') && /SERVER is the authority/.test(waiterPos) && waiterPos.includes('Итоговую цену рассчитывает сервер')],

  // ------------------------------------------------- D. the guest surfaces consume the same engine
  ['the public menu serves modifier groups (before Stage 37 it served none)',
    publicMenu.includes('modifier_groups: extra.groups.get(x.id)')],
  ['the QR/visual guest surface uses the SAME language resolver and the SAME extras helper',
    visualCatalog.includes("from './public-menu'") && visualCatalog.includes('publicMenuExtras(') && visualCatalog.includes('pickLang(req.query.lang)')],
  ['there is exactly ONE public extras implementation, exported and shared',
    publicMenu.includes('export async function publicMenuExtras') &&
    (publicMenu.match(/async function publicMenuExtras/g) || []).length === 1 &&
    !/function publicMenuExtras/.test(visualCatalog)],
  ['EN falls back to RU so a missing translation can never blank a dish out',
    publicMenu.includes('export function loc(') && /fallback = row\?\.\[`\$\{field\}_ru`\]/.test(publicMenu)],
  ['the public modifier read is restricted to ACTIVE rows in the requested branch',
    /FROM menu_modifier_groups WHERE branch_id=\? AND status='ACTIVE'/.test(publicMenu) &&
    /FROM menu_modifiers\s*\n\s*WHERE status='ACTIVE'/.test(publicMenu)],

  // ------------------------------------------------- E. public data vs internal recipe data
  ['the public payload carries customer-facing ingredients, which are a different field from the recipe',
    /ingredients_ru/.test(schema) && publicMenu.includes("loc(x,'ingredients',lang)")],
  ['no public route selects a recipe, cost, quantity, supplier or stock column',
    ![publicMenu, visualCatalog].some(f => /SELECT[\s\S]{0,900}(recipe_|food_cost|unit_cost|supplier_id|quantity_on_hand)/i.test(f))],
  ['the Recipe Engine remains a separate model chain (recipe -> recipe_ingredient -> inventory_item)',
    /^model Recipe \{/m.test(schema) && /^model RecipeIngredient \{/m.test(schema) && /inventory_item_id String/.test(schema)],
  ['the dish editor states in source that public ingredients are not the recipe',
    /is not a recipe|NOT the recipe|не рецепт/i.test(dishEditor)],

  // ------------------------------------------------- F. 360 media is declared, never inferred
  ['360 is a declared kind on the EXISTING media table, not a new media system',
    mediaAssets.includes("const KINDS = ['IMAGE','VIDEO','GIF','MEDIA_360']") && !/model Media360/.test(schema)],
  ['a normal photo never silently becomes 360 -- the source says so and only images can be marked',
    /never the bytes|not the bytes/i.test(mediaAssets) && mediaAssets.includes("const IMAGE_KINDS = ['IMAGE','MEDIA_360']") &&
    mediaAssets.includes("code:'INVALID_MEDIA_KIND_CHANGE'")],
  ['a video or GIF cannot be declared a 360 asset', mediaAssets.includes("code:'INVALID_360_ASSET'")],
  ['the Media Library exposes the 360 declaration only for image assets',
    mediaView.includes("a.kind === 'IMAGE' || a.kind === 'MEDIA_360'") && mediaView.includes("kind: draft.is360 ? 'MEDIA_360' : 'IMAGE'")],
  ['the guest 360 viewer describes honestly what it is (a pan, not a WebGL projection)',
    /NOT a WebGL sphere projection/.test(dishSheet) && dishSheet.includes('Viewer360')],

  // ------------------------------------------------- G. Order Core untouched and still authoritative
  ['Order Core still validates every group rule server-side',
    orders.includes("code:'MODIFIER_SELECTION_INVALID'") && orders.includes("code:'MODIFIER_ITEM_MISMATCH'") && orders.includes("code:'MODIFIER_UNAVAILABLE'")],
  ['Order Core still prices from the server row, ignoring anything the client sends',
    /const base=moneyCents\(m\.price\)/.test(orders) && /const delta=selected\.reduce\(/.test(orders)],
  ['the historical snapshot columns are unchanged and still written on every line',
    /name_snapshot\s+String/.test(schema) && /price_delta_snapshot\s+Decimal/.test(schema) &&
    orders.includes('INSERT INTO order_item_modifiers')],
  ['an archived modifier is unusable in a NEW order because the lookup filters on ACTIVE',
    /AND mm\.status='ACTIVE' AND mg\.status='ACTIVE'/.test(orders)],
  ['Stage 37 changed no pricing or snapshot logic in Order Core',
    !/weight_value|allergen|ingredients_|MEDIA_360|name_en/.test(orders)],

  // ------------------------------------------------- H. RBAC, audit, soft delete
  ['every Stage 37 menu write is gated on the EXISTING menu.manage permission',
    ['/items', '/categories', '/modifier-groups/:groupId', '/modifiers/:modifierId']
      .every(r => new RegExp(`'${r.replace(/[/:]/g, m => '\\' + m)}',\\s*requirePermission\\('menu\\.manage'\\)`).test(menu))],
  ['gallery and source-item writes are branch-scoped through the shared helper, not a new rule',
    menu.includes('async function replaceGallery') && /scopedBranch\(req, asset\.branch_id\)/.test(menu) &&
    menu.includes('async function resolveSourceItem') && /src\.branch_id !== branchId/.test(menu)],
  ['the new dish fields are recorded in the EXISTING audit log, not a new ledger',
    /MENU_ITEM_UPDATED[\s\S]{0,700}weight_value/.test(menu) && menu.includes('insertAuditLog(execute') && !/audit_v2|stage37_audit/.test(menu)],
  ['dish creation is audited too (it was not before Stage 37)', menu.includes("action:'MENU_ITEM_CREATED'")],
  ['no Stage 37 route hard-deletes a menu entity',
    !/DELETE FROM menu_(items|categories|modifiers|modifier_groups)\b/i.test(menu)],
  ['replacing an allergen or gallery set only ever clears the JOIN rows, never the referenced entity',
    /DELETE FROM menu_item_allergens WHERE menu_item_id=\?/.test(menu) && /DELETE FROM menu_item_media WHERE menu_item_id=\?/.test(menu)],

  // ------------------------------------------------- I. no frontend business logic
  ['no Stage 37 screen computes money, a discount or a total',
    [builder, dishEditor, mediaView, dishSheet].every(f => !/\*\s*0\.\d|price\s*\*\s*|subtotal\s*\+=|\bVAT\b/.test(f))],
  ['the dish editor sends what was typed and renders what the server returned',
    dishEditor.includes('api.updateMenuItem(') && /never computes a business value|no arithmetic/i.test(dishEditor)],
  ['no Stage 37 screen ships mock or placeholder business data',
    [builder, dishEditor, mediaView, dishSheet, customerMenu].every(f => !/MOCK_|SAMPLE_|FAKE_|DUMMY_/.test(f))],
  ['the guest dish sheet states that the server prices the order',
    /server when the order is placed|рассчитывает сервер/.test(dishSheet)],

  // ------------------------------------------------- J. wiring
  ['the api client exposes the allergen reference list', api.includes('getAllergens:')],
  ['the Menu Builder opens the full dish editor rather than the old four-field inline row',
    builder.includes('MenuDishEditor') && builder.includes('toDishDraft(i)')],
  ['the dish editor covers general, public information and media in one place',
    ['name_en', 'weight_value', 'ingredients_ru', 'allergen_ids', 'gallery_media_ids'].every(f => dishEditor.includes(f))],
  ['the constructor can name a component in EN and bind it to a real dish',
    builder.includes('source_menu_item_id') && builder.includes('name_en')],
  ['the guest menu opens the dish sheet and flags a 360 dish on the card',
    customerMenu.includes('CustomerDishSheet') && customerMenu.includes("g.kind==='MEDIA_360'")],
  ['the new admin styling honours reduced motion', /\.mb-allergen\{/.test(builderCss) && /@media \(prefers-reduced-motion:reduce\)\{\.mb-allergen\{transition:none\}\}/.test(builderCss)],
  ['the stage report exists', fs.existsSync('docs/STAGE-37-REPORT.md')],
  ['the Stage 37 runtime test exists', fs.existsSync('tests/stage37_advanced_menu_engine_e2e.mjs')],
];

let ok = 0;
for (const [name, v] of checks) { console.log(`${v ? 'PASS' : 'FAIL'} ${name}`); if (v) ok++; }
console.log(`${ok}/${checks.length} PASS`);
if (ok !== checks.length) process.exit(1);
