# BOOM OS — Stage 39 Report
## ADMIN Site Design and Customer Menu Visual Editor

**This is NOT a full arbitrary Webflow/Tilda clone.** It is a controlled BOOM OS Customer Menu /
Visual Catalog editor: a fixed vocabulary of sections and a fixed set of design presets, all
validated server-side. There is no HTML editor, no CSS editor, no script field, and no path by
which an administrator can inject markup or a stylesheet.

The purpose of the stage is one separation:

| Screen | Owns | Answers |
|---|---|---|
| **Menu Builder** | dish content | *what we sell* |
| **Visual Catalog** | page composition and appearance | *how we show it* |
| **Branding** | logo, names, favicon | *who we are* |

A manager changes a burger's name, price, photo or category without opening the site editor, and
rearranges the site without touching a single dish.

---

## 1. Existing architecture reused

Nothing was replaced. Stage 39 extended what was already there:

| Reused | How |
|---|---|
| `visual_catalog_blocks` | the same table gained nullable columns; no second block table |
| `media_assets` (Stage 35.4) | sections *reference* an asset; no file is stored anywhere else |
| `menu_items` / `menu_categories` | the only place dish content lives, then and now |
| `system_settings` branding (Stage 36) | untouched, still the brand source of truth |
| `visual_catalog.view` / `.manage` | the existing permissions; no new code invented |
| `insertAuditLog` | the existing ledger; two new action names, no second log |
| Branch scoping helpers (`scope`, `isAccessible`) | unchanged, applied to every new route |

No CMS, no page system, no second Menu Engine, no second Visual Catalog, no duplicate media or
branding engine.

## 2. Menu Builder responsibilities

Independently edits, with no visual block involved: name RU/TK/EN, description RU/TK/EN, price,
**category**, weight, public ingredients, allergens, active/archive state, modifiers, modifier
groups, Burger Constructor rules, primary image, gallery, video and 360 media.

Two defects were found while verifying this and fixed (§9).

## 3. Visual Catalog responsibilities

Ten section types: `HERO`, `BANNER`, `TEXT`, `MEDIA`, `CTA`, `CATEGORY`, `MENU_ITEM`,
`PROMOTION`, `NEW_ITEMS`, `SPACER`. Ordering, activation, scheduling, channel targeting, and
per-section appearance presets. Deactivation stays recoverable — nothing is hard-deleted.

## 4. Branding responsibilities

Unchanged. Logo, product name, network name, favicon and wordmark remain in `system_settings`
behind `settings.update`, edited on their own screen. The design editor has no branding field,
and the browser flow verifies the two are separate operations.

---

## 5. THE SOURCE-OF-TRUTH RULE

The rule the stage exists to guarantee:

> A section that **references** a Menu Engine entity may not carry a copy of that entity's content.

`MENU_ITEM`, `CATEGORY` and `PROMOTION` sections store an id and appearance presets. Their title,
subtitle and media are refused at the API with `BLOCK_DUPLICATES_MENU_DATA` (400), on create
**and** on edit — checked against the *resulting* type, so a block cannot be converted to a
reference type while keeping a duplicated title.

Three further layers back it up:

- **There is no price column on `visual_catalog_blocks` at all.** The forbidden state is not
  merely rejected; it is unrepresentable.
- **The public payload serves reference sections with `title: null` and `media_url: null`**, by
  construction. The guest renderer resolves the dish from the live Menu Engine rows in the same
  response.
- **The editor does not offer the fields**, and says why in the UI.

A reference whose entity was archived **drops out** of the guest menu rather than rendering
broken, and returns when the dish is restored.

## 6. Supported design controls

Per-branch page design (`site_designs`, one row per branch):

| Control | Values |
|---|---|
| `theme` | MIDNIGHT · GRAPHITE · CHARCOAL |
| `accent` | GOLD · AMBER · COPPER · IVORY |
| `typography` | EDITORIAL · COMPACT · DISPLAY |
| `card_style` | STANDARD · PREMIUM · COMPACT · IMAGE_FIRST |
| `density` | COMPACT · NORMAL · SPACIOUS |
| `radius` | SHARP · SOFT · ROUNDED |
| `image_ratio` | SQUARE · PORTRAIT · LANDSCAPE · WIDE · AUTO |
| `show_hero` | boolean |

Per-section overrides: `card_style`, `density`, `image_ratio`, `overlay` (NONE/SOFT/STRONG),
`alignment` (LEFT/CENTER). Empty means "inherit the page design".

**Why presets and not CSS.** Every value is checked against a closed set server-side; an unknown
value is a 400, never a silent drop. The stylesheet keys off `data-*` attributes, so no component
interpolates an administrator's string into a class, a style or any markup. `<script>alert(1)</script>`
as a theme is refused and the stored design is left untouched — verified, not asserted.

## 7. Ordering

`POST /api/visual-catalog/reorder` takes the whole ordered list in one transaction. The browser
never decides the order; the guest menu renders what the table holds. Every id must belong to the
caller's own branch. The editor's arrows call this route — they no longer patch two rows and race.

## 8. Preview

The Stage 36 **Menu Preview** screen is reused unchanged: it embeds the real guest screen at the
real URL, per branch, channel and device width. It is not a mock — the same components, the same
public route, the same data. Stage 39 added nothing here because nothing was missing.

## 9. Draft / publish safety

The brief said not to build CMS versioning if none exists, and none does. The minimal safe model
consistent with the architecture is what shipped:

- invalid configuration is rejected server-side (presets, reference conflicts, link targets);
- a deactivated section stays recoverable in ADMIN;
- an archived dish cannot leave a broken customer section — the section drops out;
- a design write is a single upsert, so a partial design can never be stored.

---

## 10. Two defects found and fixed

| Defect | Severity | Fix |
|---|---|---|
| **Archiving a dish was irreversible.** `DELETE` sets `deleted_at`, but `PATCH /items/:id` looked up `WHERE deleted_at IS NULL` → every restore answered 404. The Menu Builder's own "return to sale" button had never worked. | High — a dead button on a destructive action | the PATCH loads archived rows, and setting `status: 'ACTIVE'` clears `deleted_at` |
| **`PATCH /items/:id` ignored `category_id`.** A dish could not be moved between categories from ADMIN at all, though §3 of the brief requires it. | High — a stated requirement silently absent | the route accepts and branch-validates `category_id`; the dish editor offers a category selector |

## 11. Branch isolation

Enforced on every route. A branch-1 manager cannot create, edit, reorder, restyle **or read**
branch 2's configuration, and branch 1's sections and media never appear in branch 2's Customer
Menu. Verified by denial and by reading branch 2 back afterwards.

## 12. RBAC

The existing `visual_catalog.view` / `visual_catalog.manage` pair, on all seven routes. No new
permission code. A waiter cannot create a section, reorder, change the design, or read the
configuration — and the stored design survives every attempt.

## 13. Audit

The existing log, the existing helper, with actor and branch context.
`VISUAL_CATALOG_BLOCK_CREATED` / `_UPDATED` / `_DEACTIVATED` were already there;
`VISUAL_CATALOG_REORDERED` and `SITE_DESIGN_UPDATED` are new action names on the same ledger.

---

## 14. Tests

**`tests/stage39_site_design_static.mjs` — 39/39 source guards.** Among them: no second CMS or
page model; exactly one new table; the block model has no price column; the guard runs on create
and edit; the design model has no field that could hold CSS/HTML/script; no component interpolates
a preset into a class or style; ordering goes through the reorder route; no new permission code.

## 15. E2E

**`tests/stage39_site_design_e2e.mjs` — 100 HTTP calls, 18 denials, 47 post-conditions**, fresh
database, covering the brief's A–H matrix: menu content (name, description, price, image,
category, archive, restore, modifiers, constructor), visual catalog (create every type, reorder,
activate/deactivate, hero, banner, featured item, category, promotion, media), design presets,
source of truth, branch security, RBAC, audit and public safety.

## 16. Negative controls — performed, not claimed

| # | Guard removed | Result |
|---|---|---|
| 1 | source-of-truth protection (`referenceConflict`) | **7 failures.** A `MENU_ITEM` section stored `"Classic Burger 90"` as its own title — exactly the three-sources-of-truth state §15 of the brief forbids. |
| 2 | branch isolation (`isAccessible` + the reorder scope check) | **8 failures.** A branch-1 manager created, edited, reordered, restyled and read branch 2, and the mandatory control fired: a branch-2 manager rewrote a branch-1 section. |
| 3 | RBAC (`requirePermission` on all seven routes) | **5 failures.** A waiter created sections, reordered them, changed the design and read the configuration. |

Each guard was restored and the suite re-run green, with the restoration verified by grep.

## 17. Browser verification — 31/31, real Chromium, real data

ADMIN login → Menu Builder → **edit the dish name and price, move it to another category, swap
its photo** → save → verified on the server → Customer Menu shows the new name, new price, the
newly chosen image and the category move.

Then Visual Catalog → the editor hides content fields on a reference section and explains why →
**reorder real sections** → the guest is served the new order → **change five design presets** →
save → the guest page carries `data-theme="GRAPHITE" data-accent="COPPER" data-density="SPACIOUS"
data-radius="SHARP"`, and those resolve to genuinely different CSS (`--site-accent: #c2703f`,
`--site-radius: .25rem`) → **the dish name and price are unchanged by the design change**.

Then Branding on its own screen → the guest picks it up while design and dish data stay put.

Then: guest payload carries no recipe/cost/margin/stock/supplier data and no markup; **desktop,
tablet and mobile all render with 0px horizontal overflow**; reduced motion neutralises the new
card transitions (`1e-06s` — the project's established `0.001ms` convention, which was **not**
changed to satisfy a test); no unexpected console or page errors anywhere in the flow.

Screenshots: `shot39_01_dish_editor` … `shot39_10_reduced_motion`.

## 18. Regression

- **34/34 E2E suites pass**, all static suites pass.
- `tsc --noEmit`, `vite build`, `esbuild`, `prisma validate`, `prisma migrate deploy` — clean.
- No Order Core, payment, inventory, recipe, cost, refund, split-bill, BOOMCARD, credit, KDS,
  cashier, waiter-POS, smart-search or dashboard code was touched.

---

## 19. Known limitations

- **No draft/publish workflow.** An edit is live when saved. The brief explicitly asked not to
  build CMS versioning where none exists; §9 lists the safety measures taken instead. A branch
  wanting to stage a redesign has no "unpublished draft" today.
- **No drag-and-drop.** Ordering uses up/down controls, which persist through the same atomic
  route. Pointer dragging is a UI affordance on top of a mechanism that already works.
- **Global sections (`branch_id IS NULL`) are not reorderable from a branch editor.** They are
  shared across branches, so a single branch reordering them would silently move them for
  everyone; the route refuses rather than doing that.
- **Section appearance is presets, not free layout.** No column widths, no arbitrary spacing, no
  custom fonts, no colour picker. That is deliberate (§6) and is the line between this and a
  website builder.
- **`PROMOTION` and `NEW_ITEMS` sections use a fixed rule** (items with a live promotion; the
  first six items). They are not yet curatable lists.
- **EN is dish and section content, not app chrome** — carried over from Stage 37, unchanged.
- The known 1.57 MB bundle warning and the sidebar `<600px` gap are untouched.

## 20. Files, migration, APIs

**New:** `docs/STAGE-FINAL-SITE-DESIGN-REPORT.md`,
`prisma/migrations/20260925000000_stage39_site_design/migration.sql`,
`src/components/CustomerSiteSections.tsx`,
`tests/stage39_site_design_e2e.mjs`, `tests/stage39_site_design_static.mjs`.

**Modified:** `prisma/schema.prisma`, `server/routes/visual-catalog.ts`, `server/routes/menu.ts`,
`src/api.ts`, `src/components/VisualCatalogView.tsx`, `src/components/VisualCustomerMenuView.tsx`,
`src/components/MenuDishEditor.tsx`, `src/components/MenuEngineView.tsx`,
`src/design-system/menu-builder.css`.

**Migration (additive only):** 10 nullable columns on `visual_catalog_blocks`
(`title_en`, `subtitle_en`, `cta_label_ru/tk/en`, `card_style`, `density`, `image_ratio`,
`overlay`, `alignment`) plus the `site_designs` table. Nothing dropped, renamed or retyped.

**API — added:** `POST /api/visual-catalog/reorder`, `GET /api/visual-catalog/design`,
`PUT /api/visual-catalog/design`.
**API — extended:** `POST`/`PATCH /api/visual-catalog` (EN text, CTA labels, appearance presets,
source-of-truth guard), `GET /api/visual-catalog/public` (design + resolved reference sections),
`PATCH /api/menu/items/:id` (`category_id`, archive restore).
