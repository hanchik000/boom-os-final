import fs from 'node:fs';
const read=p=>fs.readFileSync(p,'utf8');
const checks=[
 ['client handles block links',read('src/components/VisualCustomerMenuView.tsx').includes('const openBlock=')],
 ['migration exists',fs.existsSync('prisma/migrations/20260920060000_stage35_3_visual_catalog/migration.sql')],
 ['visual catalog model',fs.readFileSync('prisma/schema.prisma','utf8').includes('model VisualCatalogBlock')],
 ['public catalog endpoint',fs.readFileSync('server/routes/visual-catalog.ts','utf8').includes("router.get('/public'" )],
 ['manager catalog endpoint',fs.readFileSync('server/routes/visual-catalog.ts','utf8').includes("router.get('/', requirePermission('visual_catalog.view')")],
 ['create permission',fs.readFileSync('server/routes/visual-catalog.ts','utf8').includes("requirePermission('visual_catalog.manage')")],
 ['real categories source',fs.readFileSync('server/routes/visual-catalog.ts','utf8').includes('FROM menu_categories')],
 ['real items source',fs.readFileSync('server/routes/visual-catalog.ts','utf8').includes('FROM menu_items')],
 ['branch isolation',fs.readFileSync('server/routes/visual-catalog.ts','utf8').includes('allowedBranchIds')],
 ['audit create',fs.readFileSync('server/routes/visual-catalog.ts','utf8').includes('VISUAL_CATALOG_BLOCK_CREATED')],
 ['audit update',fs.readFileSync('server/routes/visual-catalog.ts','utf8').includes('VISUAL_CATALOG_BLOCK_UPDATED')],
 ['customer visual entry',fs.readFileSync('src/App.tsx','utf8').includes('VisualCustomerMenuView')],
 ['manager visual entry',fs.readFileSync('src/App.tsx','utf8').includes('<VisualCatalogView />')],
 ['api client',fs.readFileSync('src/api.ts','utf8').includes('getPublicVisualCatalog')],
 ['no price source duplication',!fs.readFileSync('src/components/VisualCustomerMenuView.tsx','utf8').includes('const price =')],
 ['stage docs',fs.existsSync('docs/STAGE-35.3-VISUAL-CATALOG.md')]
];
let ok=0; for(const [n,v] of checks){console.log(`${v?'PASS':'FAIL'} ${n}`); if(v)ok++;} console.log(`${ok}/${checks.length} PASS`); if(ok!==checks.length)process.exit(1);
