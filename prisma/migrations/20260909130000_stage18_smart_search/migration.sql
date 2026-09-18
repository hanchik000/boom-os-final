-- Stage 18: Smart Search metadata. Public search may only use customer-safe fields.
ALTER TABLE "menu_items" ADD COLUMN IF NOT EXISTS "smart_tags_ru" TEXT NOT NULL DEFAULT '';
ALTER TABLE "menu_items" ADD COLUMN IF NOT EXISTS "smart_tags_tk" TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS "idx_menu_items_smart_tags_ru" ON "menu_items"("smart_tags_ru");
CREATE INDEX IF NOT EXISTS "idx_menu_items_smart_tags_tk" ON "menu_items"("smart_tags_tk");
