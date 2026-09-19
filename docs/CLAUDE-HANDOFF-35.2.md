# BOOM OS — Claude Handoff after Stage 35.2

## Current checkpoint
- Stage 34.12 Unified BOOMCARD Operations Journal: complete, static 15/15.
- Stage 34.13 Final Functional Integration: complete, static 22/22.
- Stage 35.0 Design System: complete, static 10/10.
- Stage 35.1 Waiter POS Visual Layer: complete, static 12/12.
- Stage 35.2 POS Motion + Video Media Engine: implemented, static 12/12.

## Stage 35.1
A presentation-only stylesheet now applies the Stage 35.0 tokens to the existing Waiter POS. It adds responsive terminal/tablet/mobile layout, touch states, menu cards, order panel styling, login keypad styling and reduced-motion support. No business logic was moved or duplicated.

## Stage 35.2
Implemented:
- `pos_media` metadata table and migration `20260920040000_stage35_2_pos_media`.
- Admin permissions: `pos.media.view`, `pos.media.manage`.
- `GET /api/pos-media` branch-scoped admin listing.
- `POST /api/pos-media` URL media creation.
- `POST /api/pos-media/upload` raw binary upload, max 100 MB.
- Supported MIME types: MP4, WebM, JPG, PNG, WebP, GIF.
- `PATCH /api/pos-media/:id` configuration update.
- `DELETE /api/pos-media/:id` soft deactivation.
- `GET /api/pos-media/current` waiter-session-scoped active media.
- Local file serving under `/uploads/pos-media`.
- Active/schedule/priority/order/fallback metadata.
- Audit events for create/upload/update/deactivation.
- Manager UI `POSMediaView` with branch selector, file upload, URL media creation, preview, activation and deactivation.
- Waiter POS renders the selected active media block. Media failure hides only the block and does not affect ordering.

## Important security rule
Non-superusers cannot read or mutate another branch's media. Global media records are superuser-only. Waiter POS reads only its own branch plus global active fallback candidates.

## Explicit non-goals
- No offline media cache yet.
- No transcoding/CDN yet.
- No media analytics yet.
- No visual catalog composition yet.
- No promotion/banner/theme engine yet.

## Verification run in this handoff environment
- Stage 35.0 static: 10/10 PASS.
- Stage 35.1 static: 12/12 PASS.
- Stage 35.2 static: 12/12 PASS.
- Stage 34.12 static: 15/15 PASS.
- Stage 34.13 static: 22/22 PASS.

The ZIP was provided without `node_modules`, so full TypeScript build and PostgreSQL runtime/E2E verification were not claimed here.

## Next development target
Stage 35.3 — BOOM MENU EXPERIENCE / Visual Catalog.

Implement the visual catalog as a configurable presentation layer over the existing Menu Engine:
- manager-controlled page composition;
- category cards and reorderable sections;
- banners/media blocks;
- links to real categories, dishes, promotions, collections or external URLs;
- branch/channel targeting and schedule;
- server-authoritative real menu data/prices;
- no duplicate menu source of truth;
- reusable for Online, Local, QR and future Offline Menu.

Do not redesign unrelated admin/POS business flows.
