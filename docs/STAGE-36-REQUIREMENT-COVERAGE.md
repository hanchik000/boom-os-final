# Stage 36 — Requirement Coverage Matrix

Verified by reading the actual route handlers, component bodies, Prisma models and seeded
permissions — not by file existence. "Existing UI" means a control a manager can actually operate,
not a file that imports the API client.

Statuses: **COMPLETE** · **PARTIAL** · **UI MISSING** · **BACKEND MISSING** ·
**INTEGRATION MISSING** (backend exists, UI never calls it) · **DUPLICATE/CONSOLIDATE** ·
**NEEDS FIX**

## A. Menu domain (P0)

| Requirement | Existing Backend | Existing API | Existing UI | RBAC | DB | Tests | Status | Action |
|---|---|---|---|---|---|---|---|---|
| Category create | `menu.ts` POST `/categories` | `createMenuCategory` | MenuEngineView form | `menu.manage` | `menu_categories` | stage16 | COMPLETE | keep |
| Category edit | `menu.ts` PATCH `/categories/:id` | `updateMenuCategory` | **none** | `menu.manage` | ✓ | — | INTEGRATION MISSING | wire UI |
| Category archive | `menu.ts` DELETE `/categories/:id` (soft, blocks if active items) | **missing** | **none** | `menu.manage` | `deleted_at` | stage15 | INTEGRATION MISSING | add api client + UI |
| Category ordering | `sort_order` on create/PATCH | partial | create-only | `menu.manage` | ✓ | — | PARTIAL | expose in edit UI |
| Dish create | `menu.ts` POST `/items` | `createMenuItem` | MenuEngineView form | `menu.manage` | `menu_items` | stage16 | COMPLETE | keep |
| Dish edit (name/desc/price/status/sort) | `menu.ts` PATCH `/items/:id` | `updateMenuItem` | **none** | `menu.manage` | ✓ | — | INTEGRATION MISSING | wire UI |
| Dish archive | `menu.ts` DELETE `/items/:id` (soft, keeps order history) | **missing** | **none** | `menu.manage` | `deleted_at` | stage15 | INTEGRATION MISSING | add api client + UI |
| Dish price (server-authoritative, branch-aware) | PATCH `/items/:id`, price snapshotted per order line | ✓ | **none** | `menu.manage` | `Decimal(12,2)` | stage8/34 | INTEGRATION MISSING | wire UI; never compute client-side |
| Dish RU/TK content | full | ✓ | create-only | `menu.manage` | ✓ | — | PARTIAL | expose in edit UI |
| Dish EN content | **not in schema** | — | — | — | — | — | BACKEND MISSING | out of scope, documented |
| Dish weight / allergens / 360 media | **not in schema** | — | — | — | — | — | BACKEND MISSING | documented, not invented |
| **Dish photo/media** | **no relation on `MenuItem`** | — | **none** | — | **missing column** | — | **BACKEND MISSING** | add `media_asset_id` + migration + wire everywhere |
| Modifier group create | `menu.ts` POST `/items/:id/modifier-groups` | `createModifierGroup` | MenuEngineView | `menu.manage` | `menu_modifier_groups` | stage16 | COMPLETE | keep |
| Modifier group edit/archive | **no PATCH/DELETE route** | — | **none** | — | ✓ | — | **BACKEND MISSING** | add minimal routes |
| Modifier option create | `menu.ts` POST `/modifier-groups/:id/modifiers` | `createModifier` | MenuEngineView | `menu.manage` | `menu_modifiers` | stage16 | COMPLETE | keep |
| Modifier option edit/archive | **no PATCH/DELETE route** | — | **none** | — | ✓ | — | **BACKEND MISSING** | add minimal routes |
| Modifier min/max/required | create-only | ✓ | create-only | `menu.manage` | ✓ | stage16 | PARTIAL | expose in edit UI |
| **Burger Constructor** | Modifier Engine already models it (groups per dish = bun/patty/sauce…; options carry `price_delta`; Order Core consumes `modifier_ids` and snapshots `price_delta_snapshot`) | ✓ | **no constructor surface** | `menu.manage` | ✓ | stage16 | **INTEGRATION MISSING** | expose as a constructor view over the SAME engine — no second engine |

## B. Media / visual (P0)

| Requirement | Existing Backend | Existing API | Existing UI | RBAC | DB | Tests | Status | Action |
|---|---|---|---|---|---|---|---|---|
| Media upload/list/activate/archive | `media-assets.ts` full CRUD + upload | full | MediaLibraryView | `menu.media.view/manage` | `media_assets` | stage35.4 | COMPLETE | keep |
| Media alt RU/TK, focal point, poster, priority | PATCH supports | `updateMediaAsset` | **only active toggle + delete** | `menu.media.manage` | ✓ | stage35.4 | PARTIAL | expose fields in UI |
| Attach media to dish | — | — | — | — | **missing** | — | **BACKEND MISSING** | see dish photo row above |
| Visual Catalog blocks (hero/banner/promotion/new items/item/spacer) | `visual-catalog.ts` full CRUD + channel targeting | full | VisualCatalogView | `visual_catalog.view/manage` | `visual_catalog_blocks` | stage35.3/35.6 | COMPLETE | keep |
| Banners | Visual Catalog `type='BANNER'` with media/link/schedule/branch | ✓ | via VisualCatalogView | ✓ | ✓ | stage35.3 | COMPLETE | no separate banner engine |
| POS media | `pos-media.ts` | ✓ | POSMediaView | `pos.media.*` | `pos_media` | stage35.2 | COMPLETE | keep |
| Promotions (real item/price/window/branch) | `promotions.ts` full CRUD, live-computed | full | PromotionsView | `promotions.view/manage` | `promotions` | stage35.6 | COMPLETE | keep |
| Customer menu / QR consume same engine | `public-menu.ts` + `visual-catalog.ts /public`, QR resolved server-side from opaque token | ✓ | VisualCustomerMenuView | public by design | ✓ | stage35.6 + hardening | COMPLETE | keep; extend only to carry dish media |

## C. ADMIN shell (P0)

| Requirement | Existing | Status | Action |
|---|---|---|---|
| Unified ADMIN navigation | flat 29-item list, no grouping | NEEDS FIX | group into logical sections |
| Nav label correctness | `menu` **and** `inventory` both render `nav.inventory` → "Склад и Inventory" twice; `operations` **and** `orderApprovals` both render `nav.orders` → duplicate label | **NEEDS FIX (confirmed real defect, visible in Stage 35.8/35.9 browser screenshots)** | give each its own key |
| Inventory vs Warehouse duplication | **single** inventory backend (`inventory.ts`) + single `InventoryView`; the apparent duplication is purely the mislabeled nav entry above | DUPLICATE/CONSOLIDATE (label only) | fix label; do **not** touch inventory backend |
| Branding / logo | hardcoded `B` gradient tile + "BOOM OS"/"BOOMBURGER Network" literals inside `Sidebar.tsx`; no configuration anywhere | **UI+INTEGRATION MISSING** | centralize on existing `system_settings` (already has `settings.update` RBAC + `SETTINGS_UPDATED` audit) |

## D. Preserved domains (verify-only, no rewrite)

| Domain | Backend | UI | Status |
|---|---|---|---|
| Order Core / split bill / payments / refunds / closure | `orders.ts`, `order-bills.ts`, `payments.ts`, `order-closure.ts` | Waiter+Cashier POS | COMPLETE — untouched |
| Cash shifts / Z-report | `cash-shifts.ts` | CashierPOSView | COMPLETE — untouched |
| KDS | `kds.ts` | OperationsView | COMPLETE — untouched |
| Inventory / movements / counts | `inventory.ts` | InventoryView | COMPLETE — untouched |
| Recipes / food cost / margin (historical snapshots) | `food-cost.ts` | FoodCostView | COMPLETE — untouched |
| Service charge (pools, distribution, effective dates) | `service-charge.ts` | ServiceChargeView | COMPLETE — untouched |
| Manual customer discounts | `orders.ts` discount routes | CashierPOSView | COMPLETE — untouched |
| BOOMCARD / BOOMCOIN / BOOMBACK / breakfast / birthday | `boomcard.ts`, `loyalty.ts`, unified `boomcard-journal.ts` | BoomcardView + Journal | COMPLETE — untouched |
| Credit (customer+staff, limits, repayments, archived staff) | `credit.ts` | CreditReportsView | COMPLETE — untouched |
| Manager Command Center (35.8 + 35.9 live refresh) | `dashboard.ts` | ManagerCommandCenterView | COMPLETE — untouched |
| Audit | `audit.ts` + `recordAuditLog`/`insertAuditLog` | AuditView | COMPLETE — reuse, never duplicate |
| RBAC / branch isolation | `auth.ts` `requirePermission`/`requireBranchAccess`, per-route `allowed()` | RolesView/RBAC console | COMPLETE — reuse |
| Receipt settings / print | `print.ts` | ReceiptSettingsView | COMPLETE — untouched |

## E. Stage 36 action list (what this stage actually does)

**Backend (smallest compatible extensions only — 3 additions, no new engine):**
1. `PATCH`/`DELETE` `/api/menu/modifier-groups/:groupId` — edit/archive a modifier group.
2. `PATCH`/`DELETE` `/api/menu/modifiers/:modifierId` — edit/archive a modifier option.
3. `MenuItem.media_asset_id` → `MediaAsset` (nullable FK) + migration; surfaced on the admin menu
   read, the dish PATCH, and the two public reads so the customer menu shows the same photo.

**Frontend:**
4. Menu Builder: real edit/archive/price/status/reorder for categories and dishes; modifier group
   and option editing; Burger Constructor surface over the existing Modifier Engine; dish media
   picker bound to the existing Media Library.
5. Grouped ADMIN navigation + duplicate-label fix.
6. Branding section on `system_settings`, consumed by the sidebar instead of hardcoded literals.

**Explicitly NOT done (documented, not invented):** dish EN content, weight, allergens, 360 media
(no schema representation and no requirement to add one this stage); anonymous customer checkout
(deliberately absent per Stage 35.6); a second inventory/media/promotion/audit engine.

---

# F. Final status after Stage 36 implementation

Recorded after the implementation, the test suites and the browser walkthrough described in
`docs/STAGE-36-REPORT.md`. "VERIFIED" here means a named automated check or a named browser check
covers it, not that it looked plausible.

## F.1 Delivered (P0)

| Requirement | Final status | Where it is proven |
|---|---|---|
| Unified grouped ADMIN navigation | **COMPLETE** | static: grouped nav + every leaf routed in `App.tsx`; browser A2/A3/B1 (31 entries, 9 groups, every entry renders a real screen) |
| Duplicate nav label defect (`menu`/`inventory`, `operations`/`orderApprovals`) | **FIXED** | static: no two leaf entries share a translation key; browser A4 |
| Inventory vs "Warehouse" duplication | **RESOLVED (label only)** | static: exactly one `inventory` destination, no `warehouse.ts`; the inventory backend was not touched |
| Menu Builder — categories | **COMPLETE** (create/edit/reorder/archive/restore) | browser C1; E2E §1 |
| Menu Builder — dishes and prices | **COMPLETE** | browser C2 (real `95.00` from the server); E2E §1b–1d |
| Menu Builder — modifier groups and options | **COMPLETE** (create/edit/archive/restore) | E2E §2d–2g, §3; new `PATCH`/`DELETE` routes |
| Burger Constructor administration | **COMPLETE — no second engine** | browser C5/C6/C7; E2E §2h/2i (order total = server price + server delta) |
| Media Library | **COMPLETE** (name, alt RU/TK, poster, focal point, priority, active, soft-deactivate) | browser D1–D4; static D-block |
| Dish media | **COMPLETE** | E2E §4c–4o: one FK, four surfaces, cross-branch and unknown-id both refused |
| Banners / Visual Catalog management | **COMPLETE** (create + full edit + reorder + channels + schedule + restore) | browser E1–E4; E2E §8–8i |
| Real backend integration | **VERIFIED** — no Stage 36 screen holds mock data | static J-block; browser reads real seeded rows throughout |
| RBAC | **VERIFIED** with negative controls | E2E §4j/4k, §5f, §6–6h, §8i, §9e, §10b/10f, §11 |
| Audit | **VERIFIED** — reuses the existing log | E2E §5e, §7 |

## F.2 Delivered (P1)

| Requirement | Final status | Where it is proven |
|---|---|---|
| Branding / logo | **COMPLETE** | browser F1–F3, J2, J4; E2E §5–5g |
| Customer Menu Preview | **COMPLETE** (embeds the real guest screen) | browser G1–G3 |
| QR Menu Preview | **COMPLETE** (server-issued token, server-side resolution) | browser G4/G5; E2E §10–10f |
| Promotion administration | **COMPLETE** (create existed; edit added) | browser H1; E2E §9–9e |
| POS configuration surfaces | **CONSOLIDATED** into one `POS-конфигурация` nav group | static H-block; browser B1 |

## F.3 Defects found during Stage 36 verification and fixed

| Defect | Where | Fix |
|---|---|---|
| `POST /api/media-assets` (JSON create) had 21 columns but 20 placeholders — every call 500'd | `server/routes/media-assets.ts` | added the missing placeholder; static check now counts columns vs placeholders on every INSERT |
| Receipt settings sat on "Загрузка…" forever for a user with no branch | `ReceiptSettingsView.tsx` | stop loading and state what is missing |
| Order approvals threw an unhandled rejection on the (correct) branch-scope 403 | `OrderApprovalsView.tsx` | catch and surface the refusal |
| Menu Builder rendered prices unpadded (`95` instead of `95.00`) | `MenuEngineView.tsx` | display-only `money()` formatter; no arithmetic |

## F.4 Still NOT done — unchanged from section E, and deliberately so

- Dish EN content, weight and allergen fields; 360° media. No schema representation exists and
  Stage 36 was not asked to design one. Adding placeholder UI for them would be fake data.
- Anonymous customer checkout — deliberately absent since Stage 35.6.
- The app-wide sidebar still has no responsive collapse below ~600px (found in Stage 35.9,
  pre-existing, out of scope here).
