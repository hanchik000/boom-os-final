CREATE TABLE "media_assets" (
  "id" TEXT PRIMARY KEY,
  "branch_id" TEXT,
  "name" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "mime_type" TEXT NOT NULL,
  "url" TEXT NOT NULL,
  "poster_url" TEXT,
  "alt_ru" TEXT,
  "alt_tk" TEXT,
  "focal_x" DOUBLE PRECISION NOT NULL DEFAULT 50,
  "focal_y" DOUBLE PRECISION NOT NULL DEFAULT 50,
  "size_bytes" BIGINT,
  "width" INTEGER,
  "height" INTEGER,
  "duration_ms" INTEGER,
  "active" BOOLEAN NOT NULL DEFAULT TRUE,
  "priority" INTEGER NOT NULL DEFAULT 0,
  "created_by" TEXT,
  "updated_by" TEXT,
  "created_at" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL,
  CONSTRAINT "media_assets_branch_fk" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT,
  CONSTRAINT "media_assets_creator_fk" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL,
  CONSTRAINT "media_assets_updater_fk" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL
);
CREATE INDEX "idx_media_assets_branch_active" ON "media_assets"("branch_id", "active", "priority");
CREATE INDEX "idx_media_assets_kind" ON "media_assets"("kind", "active");
ALTER TABLE "visual_catalog_blocks" ADD COLUMN "media_asset_id" TEXT;
ALTER TABLE "visual_catalog_blocks" ADD CONSTRAINT "visual_catalog_blocks_media_asset_fk" FOREIGN KEY ("media_asset_id") REFERENCES "media_assets"("id") ON DELETE SET NULL;
CREATE INDEX "idx_visual_catalog_blocks_media_asset" ON "visual_catalog_blocks"("media_asset_id");
