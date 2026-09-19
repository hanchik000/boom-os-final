# Stage 35.2 — POS Motion + Video Media Engine

## Status
Implemented as a functional media subsystem.

## Delivered
- `pos_media` metadata table and additive migration.
- Branch-scoped media records with superuser-only global media.
- Supported uploads: MP4, WebM, JPG, PNG, WebP, GIF; 100 MB request cap.
- Uploaded files are stored under `uploads/pos-media` and served as static assets.
- Admin create-by-URL and upload flows.
- Active/inactive state, priority, order, fallback and schedule fields.
- Audit events for upload/create/update/deactivation.
- Branch isolation for management reads/writes.
- Waiter POS reads only its own active branch media plus global fallback media.
- POS media is a presentation layer only; it has no Order Core, price, payment or inventory dependency.
- Media failure is non-fatal: the POS continues without the block.

## API
- `GET /api/pos-media` — manager/admin listing.
- `POST /api/pos-media` — URL media record.
- `POST /api/pos-media/upload` — binary upload.
- `PATCH /api/pos-media/:id` — configuration update.
- `DELETE /api/pos-media/:id` — soft deactivation.
- `GET /api/pos-media/current` — waiter-session scoped active media.

## Explicit boundary
This stage does not add offline caching, CDN/transcoding, playlist analytics, or visual catalog composition. Those remain later 35.x work.

## Verification
`tests/stage35_2_pos_media_static.mjs` = 12/12 PASS.
Runtime PostgreSQL upload/stream verification remains a manual acceptance item until the project is run with its real database/runtime.
