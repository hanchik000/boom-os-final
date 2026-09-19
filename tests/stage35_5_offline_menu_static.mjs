import fs from 'node:fs';
import assert from 'node:assert/strict';
const read=p=>fs.readFileSync(p,'utf8');
const sw=read('public/boom-offline.js');
const view=read('src/components/VisualCustomerMenuView.tsx');
const server=read('server.ts');
const checks=[
 ['service worker exists',fs.existsSync('public/boom-offline.js')],
 ['cache version',sw.includes("boom-menu-offline-v1")],
 ['offline API catalog cache',sw.includes('/api/visual-catalog/public')],
 ['offline API branches cache',sw.includes('/api/public/branches')],
 ['media cache',sw.includes('/uploads/menu-media/')],
 ['network-first API',sw.includes('fetch(request)')&&sw.includes('cache.put(request')],
 ['offline API fallback',sw.includes('OFFLINE_CACHE_MISS')],
 ['navigation fallback',sw.includes('/index.html')],
 ['SW registration',view.includes("navigator.serviceWorker.register('/boom-offline.js')")],
 ['offline state',view.includes('navigator.onLine')],
 ['offline banner',view.includes('Офлайн-режим')],
 ['media static serving',server.includes("/uploads/menu-media")],
 ['no order dependency',!sw.includes('/api/orders')],
 ['no payment dependency',!sw.includes('/api/payments')]
];
let ok=0; for(const [n,v] of checks){console.log(`${v?'PASS':'FAIL'} ${n}`);if(v)ok++}
console.log(`${ok}/${checks.length} PASS`); if(ok!==checks.length)process.exit(1);
