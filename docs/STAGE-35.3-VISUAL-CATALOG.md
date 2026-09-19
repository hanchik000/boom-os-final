# Stage 35.3 — BOOM MENU EXPERIENCE / Visual Catalog

## Implemented
- Added `visual_catalog_blocks` as the persistent presentation-layer composition model.
- Branch-scoped manager CRUD with `visual_catalog.view` / `visual_catalog.manage` and audit logging.
- Supported block types: HERO, CATEGORY, BANNER, PROMOTION, NEW_ITEMS, SPACER.
- Supported links: NONE, CATEGORY, ITEM, EXTERNAL (PROMOTION/COLLECTION reserved for later engines).
- Public catalog endpoint resolves only real active Menu Engine categories/items for the selected branch.
- Customer screen opens the visual catalog first, then the real menu. Category navigation scrolls to the real menu.
- No visual block is allowed to invent a product or price; Menu Engine remains the source of truth.
- Manager can reorder, activate/deactivate and target category/item/external destinations without code.

## Deferred
- 35.4 Media Engine: upload/catalog media library, responsive video/GIF optimization, CDN/local cache and offline media.
- Promotion Engine integration for real promotional pricing/badges.
- Seasonal Theme Engine.
- Rich collection builder.

## Verification
- `tests/stage35_3_visual_catalog_static.mjs`: 15/15 static guards.
- Full TypeScript/runtime verification requires dependencies and PostgreSQL runtime to be installed/available in the execution environment.
