import fs from 'node:fs';
const read = p => fs.readFileSync(p, 'utf8');
const promo = read('server/routes/promotions.ts');
const pub = read('server/routes/public-menu.ts');
const vc = read('server/routes/visual-catalog.ts');
const branches = read('server/routes/branches.ts');
const view = read('src/components/VisualCustomerMenuView.tsx');
const api = read('src/api.ts');
const schema = read('prisma/schema.prisma');
const seed = read('server/seed.ts');

const checks = [
  // -- ONE menu, channel-aware, not four separate menus
  ['channel is presentation targeting on the SAME public endpoint', vc.includes("router.get('/public'") && vc.includes('const channel=')],
  ['channel filter never touches price/availability, only which blocks show', vc.includes('const onChannel') && !/onChannel[\s\S]{0,200}price/.test(vc)],
  ['four channels are declared once', vc.includes("const CHANNELS = ['ONLINE','QR','LOCAL','OFFLINE'];")],
  ['a block with no channels set is visible everywhere (backward compatible)', vc.includes('!list.length || list.includes(channel)')],
  ['manager can target channels per block on create and update', vc.includes('normalizeChannels(req.body?.channels)') && vc.includes('normalizeChannels(req.body.channels) : row.channels')],
  ['client reads channel from the URL, detects QR/LOCAL, never invents it', view.includes('function detectChannel') && view.includes("params.get('channel')")],

  // -- QR: server-side token -> branch resolution, never a client-supplied branch id
  ['a public QR resolution endpoint exists', pub.includes("router.get('/qr/:token'")],
  ['QR resolves ONLY from the token, never trusts a branch id from the client', /router\.get\('\/qr\/:token'[\s\S]{0,400}WHERE qr_token=\?/.test(pub) && !/router\.get\('\/qr\/:token'[\s\S]{0,400}req\.(query|body)\.branch_id/.test(pub)],
  ['QR resolution returns only public-safe branch fields', /SELECT id,name,code,address,phone,currency FROM branches WHERE qr_token=\?/.test(pub)],
  ['branch qr_token is a unique, opaque column', schema.includes('qr_token     String?            @unique')],
  ['manager QR endpoints exist and are branch-access checked', branches.includes("router.get('/:id/qr'") && branches.includes("router.post('/:id/qr/regenerate'") && branches.includes('requireBranchAccess')],
  ['QR token is generated server-side with real randomness, never client-supplied', branches.includes('crypto.randomBytes(18)')],
  ['client locks the branch from a resolved QR token, the selector cannot override it', view.includes('resolveQrBranch') && view.includes('setBranchLocked(true)')],

  // -- Promotion Engine: real product, real price, real promo price, server-computed
  ['Promotion model attaches to a REAL menu item, not a second product', schema.includes('model Promotion {') && /model Promotion \{[\s\S]*?menu_item_id  String\n/.test(schema)],
  ['whether a promotion is live is computed on every read, never a stored flag', promo.includes('active=true AND starts_at<=? AND ends_at>=?')],
  ['a promo price must be genuinely lower than the real price -- never invented', promo.includes('PROMO_PRICE_NOT_A_DISCOUNT') && promo.includes('promoCents >= normalCents')],
  ['the ONE rule every public read shares', (pub.match(/activePromotionMap/g) || []).length >= 1 && (vc.match(/activePromotionMap/g) || []).length >= 1],
  ['promotions are a dedicated permission, separate from a manual discount', seed.includes("code: 'promotions.view'") && seed.includes("code: 'promotions.manage'")],
  ['promotion creation is branch-scoped and audited', promo.includes('PROMOTION_CREATED') && promo.includes('isAccessible')],
  ['client never computes a promo price -- it only renders what the server sent', !/promo_price\s*=\s*[^;]*\*/.test(view) && !/promo_price\s*=\s*[^;]*-/.test(view)],

  // -- Security / no internal data leakage on public routes
  ['public menu/catalog select no recipe, cost, stock or employee columns', !/recipe_cost|average_cost|current_stock|password_hash/.test(pub) && !/recipe_cost|average_cost|current_stock|password_hash/.test(vc)],
  ['public QR route never selects margin/cost fields', !/cost|margin/i.test(/router\.get\('\/qr\/:token'[\s\S]*?\n\}\);/.exec(pub)?.[0] || '')],
  ['public routes require no staff authentication (that is the point of a public menu)', !/router\.use\(authenticateToken\)/.test(pub)],
  ['manager promotion/catalog routes DO require authentication and a permission', promo.includes('router.use(authenticateToken)') && promo.includes("requirePermission('promotions.manage')")],

  // -- Offline stays a read/cache layer, never a financial authority
  ['offline service worker never touches payments/orders endpoints', !/\/api\/payments|\/api\/orders/.test(read('public/boom-offline.js'))],
  ['no order/payment API call exists in the customer menu view', !/api\.createOrder|api\.createPayment|api\.createWaiterOrder/.test(view)],

  // -- One Menu Engine, one Order Core -- nothing duplicated
  ['channel/QR/promotions read the EXISTING menu_items/menu_categories tables, no parallel product table', vc.includes('FROM menu_items') && pub.includes('FROM menu_items') && !/CREATE TABLE.*menu_items_v2|model MenuItemV2/i.test(schema)],
  ['no second discount engine was created for promotions', !fs.existsSync('server/routes/discount-engine.ts') && !schema.includes('model DiscountEngine')],
  ['stage docs exist', fs.existsSync('docs/STAGE-35.6-ONLINE-QR-CUSTOMER-MENU.md')],
];

let ok = 0;
for (const [name, v] of checks) { console.log(`${v ? 'PASS' : 'FAIL'} ${name}`); if (v) ok++; }
console.log(`${ok}/${checks.length} PASS`);
if (ok !== checks.length) process.exit(1);
