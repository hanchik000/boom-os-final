-- Stage 35.6 -- channel targeting, QR branch resolution, and the Promotion Engine.
-- Purely additive: two nullable columns and one new table. Nothing dropped, nothing renamed.

-- AlterTable
ALTER TABLE "branches" ADD COLUMN "qr_token" TEXT;
CREATE UNIQUE INDEX "branches_qr_token_key" ON "branches"("qr_token");

-- AlterTable
ALTER TABLE "visual_catalog_blocks" ADD COLUMN "channels" TEXT;

-- CreateTable
CREATE TABLE "promotions" (
    "id" TEXT NOT NULL,
    "branch_id" TEXT,
    "menu_item_id" TEXT NOT NULL,
    "promo_price" DECIMAL(12,2) NOT NULL,
    "starts_at" TEXT NOT NULL,
    "ends_at" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "placements" TEXT NOT NULL DEFAULT 'PRODUCT_CARD,CATALOG',
    "badge_ru" TEXT DEFAULT 'Акция',
    "badge_tk" TEXT DEFAULT 'BOOM DEAL',
    "created_by" TEXT,
    "updated_by" TEXT,
    "created_at" TEXT NOT NULL,
    "updated_at" TEXT NOT NULL,

    CONSTRAINT "promotions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "idx_promotions_branch_active_window" ON "promotions"("branch_id", "active", "starts_at", "ends_at");
CREATE INDEX "idx_promotions_menu_item" ON "promotions"("menu_item_id", "active");

ALTER TABLE "promotions" ADD CONSTRAINT "promotions_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "promotions" ADD CONSTRAINT "promotions_menu_item_id_fkey" FOREIGN KEY ("menu_item_id") REFERENCES "menu_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "promotions" ADD CONSTRAINT "promotions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "promotions" ADD CONSTRAINT "promotions_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
