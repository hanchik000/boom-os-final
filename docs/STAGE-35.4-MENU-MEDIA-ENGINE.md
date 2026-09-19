# Stage 35.4 — Menu Media Engine

## Scope
Reusable media layer for BOOM MENU / Visual Catalog. It is presentation-only and does not own menu prices, availability, orders, payments, or inventory.

## Implemented
- `media_assets` persistent library with branch/global scope.
- Supported uploads: JPEG, PNG, WebP, GIF, MP4, WebM.
- Upload limit: 150 MB.
- Poster, RU/TK alt text, focal point, priority, active state.
- Local file serving under `/uploads/menu-media`.
- Manager Media Library UI with preview and activation/deactivation.
- RBAC: `menu.media.view`, `menu.media.manage`.
- Branch/franchise scope enforcement through existing allowed-branch rules.
- Audit events for create/upload/update/deactivate.
- Visual Catalog can reference `media_asset_id`; public catalog resolves active assets server-side.
- Public catalog supports image or muted loop video blocks with poster/focal point.

## Source of truth boundaries
Menu Engine remains authoritative for products, categories, prices and availability. Media Asset is authoritative only for presentation media metadata and files. Visual Catalog remains composition only.

## Deferred
- CDN/object storage adapter.
- Automatic image transcoding/resizing.
- Video transcoding and poster extraction.
- Client-side persistent offline cache/sync (Stage 35.5).
- Advanced scheduling/campaign media playlists.

## Verification
- `tests/stage35_4_menu_media_static.mjs`: 19/19 PASS.
- Stage 35.3 static regression: 15/15 PASS.
- Full TypeScript/runtime verification was not available in this container because dependencies were not installed successfully and PostgreSQL runtime was not connected.
