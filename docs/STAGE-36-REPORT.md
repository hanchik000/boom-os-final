# BOOM OS — Stage 36 Report
## Admin Control Center · Requirement Coverage · Menu Builder · Branding

The goal of this stage was not to make ADMIN *look* complete. It was to make ADMIN actually
control the BOOM OS that already exists. Every screen below writes to an engine that was already
running in production code; nothing here is a second engine, a second audit log, a second media
table or a frontend that decides a business value.

---

## 1. What was actually built

### 1.1 Backend — three minimal extensions, no new engine

| # | Change | File | Why it was needed |
|---|---|---|---|
| 1 | `PATCH` / `DELETE` `/api/menu/modifier-groups/:groupId` | `server/routes/menu.ts` | A modifier group could be created from ADMIN but never edited or retired. Archiving a group archives its options with it, in one transaction-shaped write. |
| 2 | `PATCH` / `DELETE` `/api/menu/modifiers/:modifierId` | `server/routes/menu.ts` | Same gap for the individual option (the thing that carries `price_delta`). |
| 3 | `MenuItem.media_asset_id` → `MediaAsset` (nullable FK) | `prisma/schema.prisma`, `prisma/migrations/20260922000000_stage36_dish_media/` | A dish had **no** representation for its photo at the schema level. This is the one genuinely missing piece of data, and it is a single FK into the media table that already existed — not a second media store. |

Supporting reads, all on existing routes: `include_archived=true` on the admin menu and modifier
reads (so an archive/restore surface is possible without widening anyone else's view), a
`LEFT JOIN media_assets` on the admin menu, the waiter POS menu, the public guest menu and the
public visual catalog, and `GET /api/public/branding` returning **only** the six `BRANDING_*` keys.

One pre-existing defect was found and fixed: `POST /api/media-assets` named 21 columns but supplied
20 placeholders, so every JSON-create call returned a 500. It had never been exercised.

### 1.2 Frontend

| Surface | File | What it now does |
|---|---|---|
| Menu Builder | `src/components/MenuEngineView.tsx` | Categories and dishes: create, edit, reprice, reorder, archive, restore. Modifier groups and options: create, edit, archive, restore. Dish photo picker bound to the Media Library. Archive toggle. |
| Burger Constructor | same file, `constructor` tab | Renders a dish's modifier groups component-first (bun / patty / sauce). It is the same modifier rows Order Core already consumes via `modifier_ids`. |
| Media Library | `src/components/MediaLibraryView.tsx` | The whole asset record is now editable (name, alt RU/TK, poster, focal point, priority, active). Previously only the active toggle was reachable. |
| Visual Catalog / Banners | `src/components/VisualCatalogView.tsx` | Existing blocks can now be edited, not just created: titles and subtitles in both languages, media, link target, channels, schedule, sort order, priority. Deactivated blocks stay listed so they can be restored. |
| Promotions | `src/components/PromotionsView.tsx` | An existing promotion can now be edited (price, window, badges, placements) through the existing `PATCH`. |
| Branding | `src/components/BrandingView.tsx`, `src/context/BrandingContext.tsx` | Six `system_settings` rows drive the sidebar, boot screen, login, dashboard, waiter POS, guest menu, document title and favicon. |
| Menu Preview | `src/components/MenuPreviewView.tsx` | Embeds the **real** guest screen and the **real** QR entry in an iframe, per branch, channel and device width. |
| Navigation | `src/components/Sidebar.tsx` | Nine permission-filtered groups; every entry has its own label; POS configuration consolidated into one group. |

---

## 2. Architectural decisions (and what they prevent)

- **Dish media is one FK, not a second media system.** `ON DELETE SET NULL` means deleting or
  detaching an asset never removes a dish. The admin menu, the waiter POS, the guest menu and the
  visual catalog all resolve the same `media_assets` row — proven by E2E §4e–4i.
- **The Burger Constructor is not an engine.** A configurable dish is a dish whose modifier groups
  are its components. An order placed through it prices as `server price + server delta` with no
  new code path — E2E §2h/2i.
- **Branding lives in `system_settings`.** No new table, no new permission (`settings.view` /
  `settings.update` already existed), no new audit action (`SETTINGS_UPDATED` already existed).
  The public read exposes only the six branding keys and nothing else.
- **"Inventory vs Warehouse" was never two backends.** There is one `inventory.ts` and one
  `InventoryView`; the apparent duplication was a nav entry rendering the wrong translation key.
  The fix is a label. The inventory backend was not touched.
- **Archive means archive.** Every ADMIN "delete" is the existing soft path (`status='INACTIVE'`
  or `active=false`). No Stage 36 route contains a `DELETE FROM` against a business table.

---

## 3. What was tested, and how

### 3.1 Compilation

- `npx prisma validate` — schema valid.
- `npx tsc --noEmit` — clean.
- `npm run build` — Vite 1721 modules, `dist/server.cjs` 681 KB. The >500 KB chunk warning is
  unchanged from earlier stages and is reported, not suppressed.
- `npx prisma migrate deploy` — the new migration applies cleanly to a fresh database.

### 3.2 `tests/stage36_admin_control_center_e2e.mjs` — 78 HTTP calls, 14 authorization denials, 34 post-conditions, against a fresh database

Covers, with a real server and real HTTP:

1. Menu Builder writes reach the real Menu Engine (category, dish, reprice).
2. Burger Constructor: group and option edit; an order through it totals `105.50 + 30.00`.
3. Archiving is soft — the archived option is absent from the active list and present with
   `include_archived=true` at `status='INACTIVE'`.
4. Dish media: attach, four-surface consistency, alt text carried through, cross-branch attach
   refused (403), unknown asset refused (404), dish keeps its original photo after both refusals,
   detach clears the FK without deleting the asset.
5. Branding: public read works without a session, write through the settings route, public read
   reflects it, `SETTINGS_UPDATED` audit row exists, a branch manager is refused (403) and nothing
   changed.
6. RBAC: a waiter cannot create a category, reprice a dish or archive a dish. Branch isolation:
   a branch-1 manager cannot edit or archive a branch-2 modifier group or dish (404), and branch 2
   is byte-identical afterwards.
7. Audit: `MENU_MODIFIER_GROUP_UPDATED`, `MENU_MODIFIER_GROUP_ARCHIVED`, `MENU_MODIFIER_UPDATED`,
   `MENU_MODIFIER_ARCHIVED` all present in the existing log.
8. Banners: create, full edit, server-side channel targeting (visible on QR, hidden on LOCAL),
   soft deactivate still listed for ADMIN but gone for the guest, waiter refused.
9. Promotions: edit persists, the guest menu shows the server-computed promo price, an inverted
   window is refused (400).
10. QR: token readable only with `branches.update`, resolves server-side to the right branch, a
    forged token resolves to nothing (404).

### 3.3 Negative control — performed, not claimed

The branch-scope check on dish media (`server/routes/menu.ts`) was **deliberately removed**, the
server rebuilt, and the suite re-run. It failed exactly where it should:

```
FAIL 4j. NEGATIVE: a branch-1 dish cannot borrow a branch-2 media asset: expected 403, got 200
FAIL 4l. after both rejections the dish still holds its ORIGINAL photo
```

The guard was restored, the server rebuilt, and the suite returned to green. The test can
genuinely fail; its passes are therefore meaningful.

The suite also carries an inverse control (§11b/11c): the same write that is refused for a
branch-1 manager **succeeds** for the branch-2 manager who owns the dish — so the refusal is about
authorization, not about a broken route.

### 3.4 `tests/stage36_admin_control_center_static.mjs` — 62 source guards, all passing

Including: exactly two media models in the schema (the two that already existed), every INSERT in
`media-assets.ts` balances columns against placeholders, no `DELETE FROM` against a menu table, no
two nav leaves share a translation key, **every** nav leaf is routed in `App.tsx`, no Stage 36
screen contains `MOCK_`/`SAMPLE_`/`Math.random()`, and no Stage 36 screen performs money
arithmetic.

### 3.5 Browser verification — 38 checks, all passing

Real Chromium, real server, real seeded data (two categories, two dishes, two modifier groups with
priced options, two media assets, a HERO block, a QR token, an owner and a branch manager).

| Group | Checks |
|---|---|
| A. Navigation | mounts; 9 groups; 31 entries; **zero duplicate labels** |
| B. Reachability | every one of the 31 entries renders a real screen |
| C. Menu Builder | real categories; real dish at `95.00`; media picker lists the real library; the photo attaches and renders as a thumbnail; the constructor shows `Булка`/`Соус` with `+8.00`/`+5.00`; the screen states the server decides the total |
| D. Media Library | real assets listed; edit control present; alt RU/TK and focal fields exposed; the edit round-trips through the server |
| E. Visual Catalog | real block listed; editable; subtitle/schedule/channel controls present; the edit persists |
| F. Branding | real settings load; saving updates the **sidebar** immediately from the shared source; the document title follows |
| G. Menu preview | the customer preview shows the real dish at the real price and the real hero; the QR preview shows the **server-issued** token and resolves to the branch's real menu |
| H. Promotions | screen loads |
| I. Regression | Cashier POS renders for a branch user; receipt settings render; Manager Command Center renders |
| J. Guest/POS surfaces | waiter device renders; guest menu renders on a 390px viewport; both show the configured brand, not a literal |
| K. Accessibility | visible focus ring inside the Menu Builder; reduced motion disables its transitions |

Screenshots: `shot36_01_nav` … `shot36_16_reduced_motion`.

### 3.6 Full regression

- **31 / 31** E2E suites pass (`BATCH DONE (fail=0)`), including every isolation, RBAC, POS,
  credit, loyalty, food-cost and customer-menu suite from Stages 19–35.6.
- **All** static suites pass.

---

## 4. Defects found while verifying, and fixed

| Defect | Severity | Fix |
|---|---|---|
| `POST /api/media-assets` had 21 columns and 20 placeholders — every call 500'd | High (route entirely broken) | added the missing placeholder; a static check now balances every INSERT |
| Receipt settings sat on "Загрузка…" forever for a user with no branch | Medium (dead screen) | stops loading and says what is missing |
| Order approvals raised an unhandled rejection on the correct branch-scope 403 | Medium (uncaught error) | the refusal is caught and shown |
| Menu Builder rendered `95` where the operator expects `95.00` | Low (presentation) | display-only formatter; performs no arithmetic |

---

## 5. Honest limitations

- **Dish EN content, weight, allergens and 360° media are not implemented.** There is no schema
  representation for them and Stage 36 was not asked to design one. Shipping empty fields for them
  would be exactly the fake completeness this stage is meant to avoid.
- **Anonymous customer checkout remains absent**, deliberately, since Stage 35.6.
- **The app-wide sidebar still has no responsive collapse below ~600px.** Found in Stage 35.9,
  pre-existing, and out of scope here; the content column itself is responsive.
- **The Vite bundle is 1.52 MB (292 KB gzipped)** and still emits the >500 KB chunk warning. It is
  reported rather than silenced; code-splitting is a separate piece of work.
- **The Menu Preview iframe** renders the guest screen inside the admin shell. It is the real
  screen at the real URL, but it is not a substitute for testing on a physical device.

---

## 6. Files

**New:** `docs/STAGE-36-REQUIREMENT-COVERAGE.md`, `docs/STAGE-36-REPORT.md`,
`prisma/migrations/20260922000000_stage36_dish_media/migration.sql`,
`src/context/BrandingContext.tsx`, `src/components/BrandingView.tsx`,
`src/components/MenuPreviewView.tsx`, `src/design-system/menu-builder.css`,
`tests/stage36_admin_control_center_e2e.mjs`, `tests/stage36_admin_control_center_static.mjs`.

**Modified:** `prisma/schema.prisma`, `server/routes/menu.ts`, `server/routes/public-menu.ts`,
`server/routes/visual-catalog.ts`, `server/routes/media-assets.ts`, `server/seed.ts`, `src/api.ts`,
`src/App.tsx`, `src/main.tsx`, `src/components/{MenuEngineView,MediaLibraryView,VisualCatalogView,
PromotionsView,Sidebar,DashboardView,LoginModal,CashierPOSView,WaiterPOSView,
VisualCustomerMenuView,ReceiptSettingsView,OrderApprovalsView}.tsx`,
`src/design-system/waiter-pos.css`, `src/translations/{ru,tk}.ts`.
