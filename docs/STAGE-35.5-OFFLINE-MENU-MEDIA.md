# Stage 35.5 — Offline Menu + Offline Media

Implemented:
- Service Worker at `public/boom-offline.js`.
- Network-first cache for public branch and visual-catalog API responses.
- Cache-first strategy for `/uploads/menu-media/*`.
- Navigation fallback to cached app shell.
- Automatic old cache cleanup.
- Customer menu registers the service worker.
- Customer menu shows an explicit offline-state banner.
- Offline layer is presentation/read-cache only and has no dependency on orders, payments, inventory or Order Core.
- Cached data is never treated as authoritative for prices or transactions; online server remains the source of truth.

## Verification
- `tests/stage35_5_offline_menu_static.mjs`: 14/14 PASS.
- Full stage static suite: 50/50 PASS after fixing one stale Stage 8 assertion and the Stage 35.4 upload SQL arity defect.

## Important runtime limitation
A full TypeScript/Vite build was not completed in this environment because dependency installation was interrupted; the resulting workspace does not contain a complete `node_modules` tree. PostgreSQL runtime E2E was therefore not claimed.
