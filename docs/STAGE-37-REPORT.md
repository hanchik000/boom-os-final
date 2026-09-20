# BOOM OS — Stage 37 Report
## Advanced Menu Engine · Burger Constructor · Dish Completeness

Stage 36 made ADMIN the control centre. Stage 37 completes the menu domain behind it, so that one
chain — ADMIN Menu Builder → Menu Engine → Burger Constructor → Customer/QR/Waiter surfaces →
Order Core → immutable historical snapshot — runs on a single source of truth.

The most important finding of this stage was not a missing field. It was that **the Burger
Constructor was silently dead on the one surface that actually takes the order.**

---

## 1. The defect Stage 37 found and fixed

`WaiterPOSView.add()` fetched a dish's modifier groups from `GET /api/menu/items/:id/modifiers`.
That route is behind `authenticateToken` — a **JWT** route. A waiter device holds only a *device
session* (`x-waiter-session`), never a JWT, so the call **always** failed. The POS caught the
error and fell through to `addLine(item)`, which adds the burger with no components at all.

The result: a manager could configure a burger in ADMIN, the guest could not see it, and the
waiter added it to the order plain. No error was ever shown to anybody.

**Fix:** the device menu route `GET /api/menu/pos` now returns each dish's modifier groups and
options alongside the dish — the same tables, the same branch scope, one round trip. The POS reads
`item.modifier_groups` and never calls the JWT route again. A source comment records why, and a
static guard fails if the call is reintroduced.

---

## 2. Implemented functionality

| Area | What changed |
|---|---|
| Burger Constructor | Configurable from ADMIN end to end: groups with min/max/required, options with price deltas, EN naming, and an optional link from an option to a **real Menu Engine dish**. |
| Waiter POS | Receives the constructor with the device menu (see §1), enforces the group rules in the UI to avoid a guaranteed rejection, and states that the server prices the order. |
| Customer Menu | Dish cards now show the real photo, weight, allergen count and a "configurable" badge; a dish sheet shows gallery, 360, ingredients, allergens and the full component list. **Before Stage 37 the public menu returned no modifiers at all.** |
| QR Menu | Same engine, same helper, same payload; branch still resolved server-side from the token. |
| Menu Builder | The four-field inline row is replaced by a full dish editor: General / Public information / Media. |
| Media Library | A 360 asset can be **declared** on an image; the card badges it as 360. |
| Dish completeness | RU/TK/EN content, structured weight, customer-facing ingredients, allergens, gallery and 360 — the four gaps the Stage 36 report listed as outstanding. |

---

## 3. Schema changes

All additive. No column dropped, renamed or retyped; no row rewritten.

| Table | Added |
|---|---|
| `menu_categories` | `name_en` |
| `menu_items` | `name_en`, `description_en`, `ingredients_ru/tk/en`, `weight_value DECIMAL(10,3)`, `weight_unit` |
| `menu_modifier_groups` | `name_en` |
| `menu_modifiers` | `name_en`, `source_menu_item_id` (FK → `menu_items`, **ON DELETE SET NULL**) |
| `allergens` *(new)* | regulated reference list: `code` (unique), `label_ru/tk/en`, `sort_order`, `active` |
| `menu_item_allergens` *(new)* | dish ↔ allergen link, unique pair |
| `menu_item_media` *(new)* | dish ↔ media asset link with `sort_order`, unique pair |

**Why paired `*_en` columns rather than a translation table.** The project's existing i18n pattern
*is* paired `*_ru`/`*_tk` columns, on every entity, throughout. There is no translation/content
model in this schema to reuse. Introducing one would have meant migrating every existing menu
string — a far larger and riskier change than the stage called for. EN columns are nullable and RU
is the fallback, so an untranslated dish renders rather than going blank.

**Why `menu_item_media` is not a second media system.** It stores no file: only
`menu_item_id + media_asset_id + sort_order`. Every byte still lives in the Stage 35.4
`media_assets` table. The Stage 36 primary-photo column `menu_items.media_asset_id` is untouched.

---

## 4. Migrations

`prisma/migrations/20260923000000_stage37_menu_domain/migration.sql` — 10 `ADD COLUMN`, 3
`CREATE TABLE`, their indexes and foreign keys. Verified with `prisma validate`, and
`prisma migrate deploy` applied cleanly to a fresh database on every E2E run (34 runs this stage).

---

## 5. APIs changed

| Route | Change |
|---|---|
| `GET /api/menu` | Returns EN content, weight, ingredients, plus `allergens[]` and `gallery[]` (two extra queries, never N+1). |
| `GET /api/menu/pos` | **Now returns `modifier_groups[]` per dish** (§1), plus the public dish information. |
| `POST/PATCH /api/menu/items` | Accept EN content, structured weight, ingredients, `allergen_ids[]`, `gallery_media_ids[]`. `POST` is now audited (it was not). |
| `POST/PATCH /api/menu/categories` | Accept `name_en`. |
| `POST/PATCH /api/menu/modifier-groups…`, `…/modifiers…` | Accept `name_en`; options accept `source_menu_item_id`. |
| `GET /api/menu/items/:id/modifiers` | Returns `name_en` and the resolved source dish name/SKU. |
| `GET /api/public/menu` | `lang=en`; weight, ingredients, allergens, gallery and **`modifier_groups[]`**. |
| `GET /api/visual-catalog/public` | Same additions, via the same shared helper. |
| `POST/PATCH /api/media-assets` | Accept and validate `MEDIA_360`. |

## 6. APIs added

One: `GET /api/menu/allergens` (`menu.view`) — the seeded regulated list. Deliberately read-only:
the EU 14 are a legal set, not user content. ADMIN links dishes to them; it cannot invent codes.

No `/menu-v2`, no `/modifiers-v2`, no `/burger-constructor`, no `/order-v2`.

---

## 7. Menu Builder

`MenuDishEditor` replaces the inline row editor with three sections:

- **General** — name and description RU/TK/EN, price, sort order, status.
- **Public information** — structured weight (value + unit), customer-facing ingredients in three
  languages, and the allergen picker. The panel states in the UI that this is *not* the recipe.
- **Media** — primary image, plus a gallery that can hold extra photos, video and a 360 asset,
  each badged by kind.

The constructor panel gained an EN name for each group and option, and a dropdown binding an
option to a real dish.

## 8. Burger Constructor

No new engine. A configurable dish is a dish whose modifier groups are its components. What Stage
37 added is reach: the groups are now visible on every surface that needs them, options can be
named in three languages, and an option can point at a real Menu Engine item.

That last link is what gives a chosen component a **recipe path**: `source_menu_item_id` → that
dish's `recipes` → `recipe_ingredients` → `inventory_items`. It is `ON DELETE SET NULL`, so
archiving the source dish never deletes the option and never touches a historical order line.

## 9. Media

The Stage 35.4 Media Engine is unchanged as a store. Stage 37 adds the gallery link table and the
`MEDIA_360` kind.

## 10. Multilingual content

RU/TK/EN on dish name, description, public ingredients, category name, modifier group name and
option name. `lang=en` on both public routes. RU is the fallback for any untranslated field.

**Scope note, stated plainly:** EN here is *dish content*. The application chrome (navigation,
buttons, admin labels) remains RU/TK — `LanguageContext` was not extended, because translating the
whole interface is a separate piece of work and half-translating it would be worse than not.

## 11. Allergens

A seeded reference list of the regulated EU 14, each with RU/TK/EN labels, linked to dishes
through a join table. Public information only — a code and three labels. An unknown or inactive
allergen id is rejected, not silently dropped.

## 12. Weight

`weight_value DECIMAL(10,3)` + `weight_unit` ∈ {G, KG, ML, L, PCS}. Validated as an inseparable
pair: a value with no valid unit is a 400, and clearing one clears both, so a dish can never carry
a number with no unit. Displayed to the guest with a localized unit label shared by the card and
the dish sheet.

## 13. 360 media

A 360 asset is an ordinary equirectangular image *file*; what makes it 360 is the declaration.
Stage 37 therefore never infers it: `MEDIA_360` is reachable only by an explicit `kind`, only from
an image, and a video or GIF is refused with `INVALID_360_ASSET`.

**What the guest viewer actually is, stated honestly:** a drag-to-pan viewer over the
equirectangular image — horizontal wrap-around pan with clamped vertical travel. It is **not** a
WebGL sphere projection: there is no perspective correction and no gyroscope, so lines near the
poles still bend as they do in the source image. It adds no dependency and works with a thumb on a
phone. The source comment says exactly this.

## 14. Order Core integration

**Nothing in Order Core was changed.** Inspection confirmed it already does everything the brief
requires, server-side: it rejects an unknown or inactive modifier, one from another branch, one
belonging to a different dish, a selection violating a group's min/max, a missing required group,
and a combination that would make the price negative — then prices from the server row and ignores
any price the client sends. A static guard asserts no Stage 37 concept leaked into `orders.ts`.

## 15. Historical snapshots

Also already correct, and now proven against the brief's exact scenario. The E2E orders a burger
at 95.00 with brioche +8.00 and cheddar +10.00, then raises the dish to 110.00, raises cheddar to
+15.00 and **archives** brioche. The historical order still reads 113.00 with brioche +8.00 (by
name) and cheddar +10.00. `modifier_id` is `ON DELETE SET NULL` and `name_snapshot` /
`price_delta_snapshot` hold the values, so an archived component still prints on an old receipt.

## 16. RBAC

Every Stage 37 write rides the existing `menu.manage` / `menu.media.manage` permissions. No new
permission was created and none was widened. Verified by denial, not by assumption: a waiter
cannot create a group or change a modifier price; a cashier cannot change allergens or archive a
group; each refusal was followed by a read proving nothing changed.

## 17. Audit

The existing log, the existing helper. `MENU_ITEM_CREATED` (new this stage), `MENU_ITEM_UPDATED`
(now carrying weight, allergen and gallery changes), and the existing modifier actions. No second
ledger.

## 18. Branch isolation

Enforced server-side on every new path: gallery assets, option source dishes, modifier edits and
the public reads are all branch-scoped. A branch-1 manager cannot edit a branch-2 dish or option;
a branch-1 waiter device cannot order a branch-2 modifier; branch 2's guest menu shows none of
branch 1's dishes or components.

---

## 19. Tests

**`tests/stage37_advanced_menu_engine_static.mjs` — 52/52 source guards.** Among them: the
migration is additive; exactly two models hold a media file; no public route selects a recipe,
cost, quantity, supplier or stock column; `api.getMenuModifiers()` is gone from the waiter POS; no
Stage 37 screen performs money arithmetic; `orders.ts` contains no Stage 37 concept.

## 20. E2E

**`tests/stage37_advanced_menu_engine_e2e.mjs` — 84 HTTP calls, 21 denials, 59 post-conditions**,
fresh database. Sections map to the brief's A–V:

A/B/C/D dish + RU/TK/EN + weight + allergens · E/F media and a declared 360 · G/H/I/J/K/L the
constructor · M Customer Menu in all three languages · N QR Menu with server-side resolution ·
O Waiter POS via a real device session · P Order Core · Q the historical snapshot ·
R branch isolation · S RBAC · T audit · U soft delete · V recipe/cost separation.

### Negative controls — performed, not claimed

Two protections were deliberately removed, the server rebuilt, and the suite re-run:

1. **Order Core's min/max/required enforcement removed** →
   `I2 expected 400, got 201` and `I3 expected 400, got 201`. Restored → green.
2. **The gallery's branch-scope check removed** →
   `E4 expected 403, got 200`, and three further failures showing **branch 2's asset appearing in
   branch 1's guest menu**. Restored → green.

The suite also carries an inverse control: the same cross-branch write that is refused for a
branch-1 manager **succeeds** for the branch-2 manager who owns the row, proving the refusal is
authorization and not a broken route.

## 21. Browser verification — 41/41, real Chromium, real data

ADMIN → dish editor (EN name, weight 320.5, 14 allergens with 4 pre-selected, media tab) → edit
and save → constructor showing real groups and deltas → Media Library 360 badge and declaration →
**Customer Menu** card and dish sheet (ingredients, localized allergens, weight, the constructor,
and a 360 viewer that visibly pans when dragged: `50% → 95.1471%`) → **QR Menu** on a 390px
viewport → **Waiter POS**: device login, constructor opens, Add blocked until the required bun is
chosen, unlocks after, configured burger reaches the cart at 113.00 → order sent → **the server's
stored order** read back: unit 113.00 with `[["Бриошь","8"],["Чеддер","10"]]` → tablet (0px
overflow) and reduced motion.

Screenshots: `shot37_01_dish_editor_general` … `shot37_13_reduced_motion`.

## 22. Regression

- **32/32 E2E suites pass** (`BATCH DONE (fail=0)`), including every isolation, RBAC, POS, credit,
  loyalty, food-cost, split-bill, promotion and customer-menu suite from Stages 19–36.
- **All static suites pass.** One Stage 36 guard was repaired, not weakened: it asserted an exact
  media-model *count*, which Stage 37's link table legitimately changed. It now asserts the thing
  that actually matters — that exactly two models hold a media **file**.
- `tsc --noEmit` clean; `vite build` + `esbuild` clean; `prisma validate` clean.

---

## 23. Known remaining gaps

- **The app chrome is still RU/TK only.** EN is dish content (§10). Translating the interface is a
  separate stage.
- **The 360 viewer is a pan, not a projection** (§13). Honest, useful, and not the same thing as a
  WebGL panorama.
- **Modifier-driven inventory consumption is *linkable*, not yet *consumed*.** Stage 37 adds
  `source_menu_item_id`, which is the missing relation. Wiring payment-time consumption to walk
  that link into the Recipe Engine is deliberately left to a dedicated stage, because it changes
  historical cost economics and deserves its own verification.
- **Branch-level price overrides and effective-dated pricing** (brief §15 "branch pricing,
  effective date where supported") are **not** implemented: the schema has one price per dish per
  branch row and no effective-date model. Adding UI for it would have been fake.
- **The Vite bundle is 1.57 MB (301 KB gzipped)** and still emits the >500 KB warning — reported,
  not silenced, per brief §33.
- **The sidebar still has no responsive collapse below ~600px** — pre-existing, untouched, per
  brief §34.
- Promotions still discount the **dish**, not modifiers. Unchanged semantics, as §19 required.

## 24. Recommended next stage

**Modifier-driven recipe consumption and cost.** The relation now exists; make payment-time
consumption follow `source_menu_item_id` into the Recipe Engine so a chosen cheddar actually draws
down cheddar stock and lands in historical food cost, with its own snapshot. That is the one place
where the menu domain and the inventory domain still do not meet.

Second candidate: **branch pricing and effective dates**, which the brief asked about and this
schema genuinely cannot express yet.

---

## 25. Files

**New:** `docs/STAGE-37-REPORT.md`,
`prisma/migrations/20260923000000_stage37_menu_domain/migration.sql`,
`src/components/MenuDishEditor.tsx`, `src/components/CustomerDishSheet.tsx`,
`tests/stage37_advanced_menu_engine_e2e.mjs`, `tests/stage37_advanced_menu_engine_static.mjs`.

**Modified:** `prisma/schema.prisma`, `server/seed.ts`, `server/routes/{menu,public-menu,visual-catalog,media-assets}.ts`,
`src/api.ts`, `src/components/{MenuEngineView,MediaLibraryView,WaiterPOSView,VisualCustomerMenuView}.tsx`,
`src/design-system/menu-builder.css`, `tests/stage36_admin_control_center_static.mjs` (stale guard repaired).

**Deliberately untouched:** `server/routes/orders.ts` — Order Core needed no change.
