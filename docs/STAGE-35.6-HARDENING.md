# Stage 35.6 Hardening

A focused hardening pass over Stage 35.6 (Online/QR/Customer Menu), scoped to exactly the two
known limitations named in the original Stage 35.6 report, plus a re-verification of the four
invariants that report claimed. This is not a project-wide audit — nothing outside the
QR/channel/offline/promotion chain was touched.

No production code changed as a result of this pass. Every invariant checked was found to already
hold; the work here is new regression coverage (`tests/stage35_6_hardening_static.mjs`,
`tests/stage35_6_hardening_e2e.mjs`) plus three genuine negative controls, each independently
proven to fail before being reverted (see below).

## A1 — QR flow

Re-traced the full chain: `qr_token` → `GET /api/public/qr/:token` → branch → `GET
/api/visual-catalog/public` / `GET /api/public/menu` → real `menu_items`/`menu_categories` rows →
real price → real availability → `activePromotionMap()` for a real promotion, if one is live. No
step in this chain accepts a branch id from the client — the token is the only input the handler
reads (new static guard: `QR handler never reads req.query or req.body at all`).

**Negative control (IDOR):** temporarily patched `public-menu.ts`'s `/qr/:token` handler to trust
`req.query.branch_id` when present, ahead of the token lookup. Rebuilt and re-ran
`stage35_6_online_qr_customer_menu_e2e.mjs` — check **8d** ("supplying a branch_id alongside the
token cannot redirect resolution to another branch") genuinely failed, resolving branch B2's data
through branch B1's token. Reverted the patch, rebuilt, re-ran — clean pass restored. Franchise
isolation was exercised in the same run: B1 and B2 belong to two different franchises (FA/FB), so
this is a cross-franchise IDOR attempt, not just cross-branch.

No recipe/food-cost/stock/employee/CRM data exists on the public QR/menu/catalog response shape at
all — confirmed by both the existing Stage 35.6 static guards and this pass's new ones (`QR route
selects only public-safe columns`, `an invalid/unknown token yields 404 ... not a fallback branch`).

## A2 — ONLINE / QR / LOCAL / OFFLINE as presentation-only channels

Confirmed structurally, not just by convention: `visual-catalog.ts`'s `/public` handler queries
`menu_items`/`menu_categories`/`activePromotionMap()` for the **item list first**, and only
afterwards filters the **block list** by `onChannel()`. The channel parameter is never part of any
WHERE clause that touches price or availability — it only decides which `visual_catalog_blocks`
rows are returned. New static guard (`channel filtering happens strictly after the item/price
query`) pins the ordering so this can't silently drift. No per-channel product/menu table exists
anywhere in the schema (also newly guarded).

## A3 — Offline safety

Structural guarantee, re-confirmed: `server/routes/orders.ts`'s item parser
(`for (const x of rawItems) { ... parsedItems.push({menuItemId,q,modifierIds,comment...}) }`)
never reads a price-shaped field from the request body at all — only `menu_item_id`, `quantity`,
`modifier_ids`, `comment`. The unit price used for every order line always comes from the
server-side `SELECT id,name_ru,name_tk,price FROM menu_items WHERE id IN (...)` query, executed at
order-creation time, every time. There is no code path — offline or online — through which a
previously observed (and therefore potentially stale) price can reach an actual order.

**Three negative controls, each proven to fail before being reverted:**

1. **Offline payment / Order Core mutation.** Temporarily added `/api/orders` to
   `boom-offline.js`'s `CACHEABLE_API` list (simulating the service worker starting to intercept
   order traffic). Re-ran the static suites — `stage35_5_offline_menu_static.mjs` ("no order
   dependency"), `stage35_6_online_qr_customer_menu_static.mjs` ("offline service worker never
   touches payments/orders endpoints") and the new
   `stage35_6_hardening_static.mjs` (two checks) all genuinely failed. Reverted — clean pass
   restored on all three files. (`/api/payments` was not separately injected since the same
   `CACHEABLE_API`-membership mechanism and the same guards cover it identically; the guard
   asserting the SW never mentions `/api/payments` anywhere in its source was left as the
   permanent check.)
2. **Client-supplied ("smuggled") price.** Temporarily made `orders.ts` thread an optional
   `x?.price` field from each order-item payload through to the unit-price calculation instead of
   always using the server-side `menu_items.price`. Rebuilt, ran the new
   `stage35_6_hardening_e2e.mjs` against a fresh database — check **3b** ("the smuggled price
   field is completely ignored") genuinely failed: the order was created with subtotal `1.00`
   instead of the real `150.00`. Reverted, rebuilt, re-ran — clean pass restored.
3. **Stale cached price treated as authoritative.** No code injection needed here — this is
   directly observable: `stage35_6_hardening_e2e.mjs` checks 1–2b create a menu item at 100.00,
   simulate a client having cached that price (`GET /api/public/menu`), then change the *real*
   price server-side to 150.00, then place an order with **no price field in the request at all**
   (exactly what a real client sends). The order's subtotal is 150.00 — the current server price —
   proving a value a client cached before ordering can never become authoritative, because the
   order request never carries a price for the server to trust in the first place. Checks 4–5b
   repeat this with a live promotion in flight (order still prices at the real 150.00, not the
   promo 80.00 — Stage 35.6 deliberately added no order-time promotion path).

## A4 — Promotion Engine invariants

Re-verified against the running code (not just re-read):

- Real item, real price: `promotions.ts` requires `menu_item_id` to resolve to a real, active
  `menu_items` row before a promotion can be created.
- Strictly lower price: `promoCents >= normalCents` → `400 PROMO_PRICE_NOT_A_DISCOUNT`, checked
  against the live `menu_items.price` at creation time.
- Start/end window and branch respected: `WHERE (branch_id=? OR branch_id IS NULL) AND active=true
  AND starts_at<=? AND ends_at>=?` — the one rule `activePromotionMap()` applies, called
  identically by both `public-menu.ts` and `visual-catalog.ts`.
- No stored "is active" flag: `active` is a manager on/off switch, but *liveness* is `active AND
  starts_at<=now<=ends_at`, recomputed on every single read — confirmed by the E2E suite's
  expired/scheduled/live three-way check (Stage 35.6 checks 11–14) and reconfirmed here with a
  fresh price-change scenario (hardening checks 4–5b).
- No second discount engine: `promotions.ts` never touches the `order_discounts` table, and
  `orders.ts` never imports `promotions.ts` — two structurally separate code paths, now pinned by
  a static guard.

## A5 — Bundle size

`npx vite build` still emits the ">500 kB after minification" warning:

```
dist/assets/index-C0V04dc8.js   1,437.25 kB │ gzip: 275.26 kB
```

Root cause: `src/App.tsx` statically imports all 38 view components (`DashboardView`,
`CashierPOSView`, `UsersView`, `FranchisesView`, ... including the largest files —
`CashierPOSView.tsx` at 84 KB, `UsersView.tsx`/`FranchisesView.tsx` at 40 KB each) and switches
between them by `activeTab` — every role's screens ship in the one bundle a cashier, a waiter and
an owner all download alike, whether or not that role can ever reach most of those tabs.

The standard, low-risk fix is per-tab `React.lazy()` + a single `<Suspense>` boundary around the
switch in `App.tsx`, since only one tab is ever rendered at a time. This was evaluated but **not
implemented in this pass**: every one of these 38 components is a *named* export (`export const
XView = ...`), so each lazy import needs a `.then(m => ({ default: m.XView }))` wrapper, and the
change touches the routing of every screen in the application at once — the exact kind of broad,
all-surfaces frontend change the hardening scope explicitly excludes ("do not perform a massive
frontend rewrite"), and the kind of change that per this project's own rules requires driving the
app in a real browser through every role's nav tabs before it can be called low-risk, not just a
green build. That verification pass is bigger than this hardening pass's scope.

**Deferred, with a concrete plan for whoever picks it up:**
1. Wrap each `import { XView } from './components/XView'` in `App.tsx` as
   `const XView = React.lazy(() => import('./components/XView').then(m => ({ default: m.XView })))`.
2. Wrap the `activeTab` switch's rendered output in one `<Suspense fallback={...}>`.
3. Verify every nav tab still renders for every role in a real browser (Playwright), not just that
   the build succeeds — a `React.lazy` misconfiguration fails silently as a blank pane, not a
   build error.
4. Do not touch `AcceptanceTestModal`/`LoginModal` if they are ever mounted outside the
   `activeTab` switch (mounted-on-app-load modals should stay eager).

No build configuration was weakened to hide the warning (`chunkSizeWarningLimit` was left
untouched).

## Verification

- TypeScript (`tsc --noEmit`): PASS, no errors.
- `prisma validate`: PASS.
- `npx vite build`: PASS (bundle-size warning unchanged and documented above, not hidden).
- `esbuild server.ts`: PASS.
- Full static suite (`npm run test:static`, all stages through 35.6 + this hardening pass): PASS.
- `tests/stage35_6_online_qr_customer_menu_e2e.mjs`: PASS (fresh DB).
- `tests/stage35_6_hardening_e2e.mjs` (new): PASS (fresh DB).
- Full 29-suite E2E regression (Stage 19 through 34.12, plus both Stage 35.6 suites): see the
  Stage 35.6 Hardening commit message for the pass/fail summary recorded at commit time.
- Three genuine negative controls (QR IDOR, price-smuggling, offline order interception): each
  independently confirmed to fail before the injected code was reverted, per the sections above.

No test was weakened, skipped, or replaced with a mock to force a PASS.
