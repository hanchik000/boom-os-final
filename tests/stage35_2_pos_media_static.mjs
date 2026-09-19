import fs from 'node:fs';
const route=fs.readFileSync('server/routes/pos-media.ts','utf8');
const migration=fs.readFileSync('prisma/migrations/20260920040000_stage35_2_pos_media/migration.sql','utf8');
const schema=fs.readFileSync('prisma/schema.prisma','utf8');
const view=fs.readFileSync('src/components/POSMediaView.tsx','utf8');
const waiter=fs.readFileSync('src/components/WaiterPOSView.tsx','utf8');
const checks=[
 ['media table',migration.includes('CREATE TABLE "pos_media"')&&schema.includes('model PosMedia')],
 ['admin read permission',route.includes("requirePermission('pos.media.view')")],
 ['admin manage permission',route.includes("requirePermission('pos.media.manage')")],
 ['waiter session scoped read',route.includes("router.get('/current'")&&route.includes('getWaiterSession(req)')],
 ['branch isolation',route.includes('allowed(req, branchId)')],
 ['file upload',route.includes("router.post('/upload'")&&route.includes('writeFile')],
 ['upload size limit',route.includes('100 * 1024 * 1024')],
 ['active scheduling',route.includes('schedule_start')&&route.includes('schedule_end')],
 ['audit',route.includes('POS_MEDIA_UPLOADED')&&route.includes('POS_MEDIA_UPDATED')],
 ['admin UI',view.includes('uploadPosMedia')&&view.includes('getPosMedia')],
 ['POS renders media',waiter.includes('posMedia')&&waiter.includes('<video')],
 ['no Order Core coupling',!route.includes('/api/orders')],
];
for(const [n,ok] of checks) console.log(`${ok?'PASS':'FAIL'} ${n}`);
if(checks.some(([,ok])=>!ok)) process.exit(1); console.log(`Stage 35.2 static: ${checks.length}/${checks.length} PASS`);
