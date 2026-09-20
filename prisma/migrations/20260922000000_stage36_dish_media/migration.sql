-- Stage 36 -- ADMIN Menu Builder: a dish photo/video.
--
-- Purely additive: one nullable FK from the existing menu_items table into the existing Stage 35.4
-- media_assets table. No second media table, no duplicated image record, no change to any price,
-- order, payment or inventory column. ON DELETE SET NULL so archiving a media asset can never
-- cascade into a menu item (and therefore never into order history).

ALTER TABLE "menu_items" ADD COLUMN "media_asset_id" TEXT;

CREATE INDEX "idx_menu_items_media_asset" ON "menu_items"("media_asset_id");

ALTER TABLE "menu_items"
  ADD CONSTRAINT "menu_items_media_asset_id_fkey"
  FOREIGN KEY ("media_asset_id") REFERENCES "media_assets"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
