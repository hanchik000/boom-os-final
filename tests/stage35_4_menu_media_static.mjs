import fs from 'node:fs';
const read=p=>fs.readFileSync(p,'utf8');
const checks=[
 ['migration exists',fs.existsSync('prisma/migrations/20260920080000_stage35_4_menu_media_engine/migration.sql')],
 ['media asset model',read('prisma/schema.prisma').includes('model MediaAsset')],
 ['media asset table',read('prisma/migrations/20260920080000_stage35_4_menu_media_engine/migration.sql').includes('CREATE TABLE "media_assets"')],
 ['catalog asset FK',read('prisma/migrations/20260920080000_stage35_4_menu_media_engine/migration.sql').includes('visual_catalog_blocks_media_asset_fk')],
 ['upload endpoint',read('server/routes/media-assets.ts').includes("router.post('/upload'")],
 ['view permission',read('server/routes/media-assets.ts').includes("menu.media.view")],
 ['manage permission',read('server/routes/media-assets.ts').includes("menu.media.manage")],
 ['size limit',read('server/routes/media-assets.ts').includes('150 * 1024 * 1024')],
 ['supported video',read('server/routes/media-assets.ts').includes("video/mp4")],
 ['supported gif',read('server/routes/media-assets.ts').includes("image/gif")],
 ['branch isolation',read('server/routes/media-assets.ts').includes('allowedBranchIds')],
 ['audit upload',read('server/routes/media-assets.ts').includes('MENU_MEDIA_ASSET_UPLOADED')],
 ['static serving',read('server.ts').includes("/uploads/menu-media")],
 ['manager library',fs.existsSync('src/components/MediaLibraryView.tsx')],
 ['catalog uses asset',read('server/routes/visual-catalog.ts').includes('media_asset_id')],
 // Stage 39 moved the guest card/section rendering into CustomerSiteSections.tsx. The invariant
 // is that the GUEST MENU still renders a video asset as a video -- not which file does it.
 ['public video support',[read('src/components/VisualCustomerMenuView.tsx'),read('src/components/CustomerSiteSections.tsx')]
   .some(f=>/media_kind\s*===\s*'VIDEO'/.test(f))],
 ['api client',read('src/api.ts').includes('getMediaAssets')],
 ['navigation',read('src/components/Sidebar.tsx').includes("menuMedia")],
 ['reduced business coupling',!read('server/routes/media-assets.ts').includes('orders.create')]
];
let ok=0;for(const [n,v] of checks){console.log(`${v?'PASS':'FAIL'} ${n}`);if(v)ok++;}console.log(`${ok}/${checks.length} PASS`);if(ok!==checks.length)process.exit(1);
