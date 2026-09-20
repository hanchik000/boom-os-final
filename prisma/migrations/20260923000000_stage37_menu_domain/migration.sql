-- Stage 37 — Advanced Menu Engine.
-- Additive only: every statement either ADDs a nullable column or CREATEs a new table, so the
-- migration is safe on a populated database and produces the same shape on a fresh one. No
-- column is dropped, renamed or retyped, and no existing row is rewritten.

-- 1. EN dish/category/modifier content. Nullable, RU remains the fallback until EN is written.
ALTER TABLE "menu_categories"      ADD COLUMN "name_en" TEXT;
ALTER TABLE "menu_items"           ADD COLUMN "name_en" TEXT;
ALTER TABLE "menu_items"           ADD COLUMN "description_en" TEXT;
ALTER TABLE "menu_modifier_groups" ADD COLUMN "name_en" TEXT;
ALTER TABLE "menu_modifiers"       ADD COLUMN "name_en" TEXT;

-- 2. Customer-facing ingredients. Deliberately NOT the recipe: recipe_ingredients keeps the
--    quantities and cost and is never reachable from a public route.
ALTER TABLE "menu_items" ADD COLUMN "ingredients_ru" TEXT;
ALTER TABLE "menu_items" ADD COLUMN "ingredients_tk" TEXT;
ALTER TABLE "menu_items" ADD COLUMN "ingredients_en" TEXT;

-- 3. Structured portion weight: a number and a unit, never a formatted string.
ALTER TABLE "menu_items" ADD COLUMN "weight_value" DECIMAL(10,3);
ALTER TABLE "menu_items" ADD COLUMN "weight_unit" TEXT;

-- 4. A modifier option may be backed by a real Menu Engine item, which is what lets the Recipe
--    Engine resolve what the chosen component consumes. SET NULL so archiving the source dish
--    never deletes the option or breaks a historical order line.
ALTER TABLE "menu_modifiers" ADD COLUMN "source_menu_item_id" TEXT;
CREATE INDEX "idx_menu_modifiers_source_item" ON "menu_modifiers"("source_menu_item_id");
ALTER TABLE "menu_modifiers"
  ADD CONSTRAINT "menu_modifiers_source_item_fkey"
  FOREIGN KEY ("source_menu_item_id") REFERENCES "menu_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 5. Allergens: a regulated reference list plus a dish link. Public information only.
CREATE TABLE "allergens" (
  "id"         TEXT NOT NULL,
  "code"       TEXT NOT NULL,
  "label_ru"   TEXT NOT NULL,
  "label_tk"   TEXT NOT NULL,
  "label_en"   TEXT NOT NULL,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "active"     BOOLEAN NOT NULL DEFAULT true,
  "created_at" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL,
  CONSTRAINT "allergens_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "allergens_code_key" ON "allergens"("code");
CREATE INDEX "idx_allergens_active" ON "allergens"("active", "sort_order");

CREATE TABLE "menu_item_allergens" (
  "id"           TEXT NOT NULL,
  "menu_item_id" TEXT NOT NULL,
  "allergen_id"  TEXT NOT NULL,
  "created_at"   TEXT NOT NULL,
  CONSTRAINT "menu_item_allergens_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "menu_item_allergens_pair_key" ON "menu_item_allergens"("menu_item_id", "allergen_id");
CREATE INDEX "idx_menu_item_allergens_item" ON "menu_item_allergens"("menu_item_id");
ALTER TABLE "menu_item_allergens"
  ADD CONSTRAINT "menu_item_allergens_item_fkey"
  FOREIGN KEY ("menu_item_id") REFERENCES "menu_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "menu_item_allergens"
  ADD CONSTRAINT "menu_item_allergens_allergen_fkey"
  FOREIGN KEY ("allergen_id") REFERENCES "allergens"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 6. The dish gallery. menu_items.media_asset_id (the Stage 36 primary photo) is untouched;
--    these rows only REFERENCE existing media_assets, they never copy a file.
CREATE TABLE "menu_item_media" (
  "id"             TEXT NOT NULL,
  "menu_item_id"   TEXT NOT NULL,
  "media_asset_id" TEXT NOT NULL,
  "sort_order"     INTEGER NOT NULL DEFAULT 0,
  "created_at"     TEXT NOT NULL,
  CONSTRAINT "menu_item_media_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "menu_item_media_pair_key" ON "menu_item_media"("menu_item_id", "media_asset_id");
CREATE INDEX "idx_menu_item_media_item" ON "menu_item_media"("menu_item_id", "sort_order");
ALTER TABLE "menu_item_media"
  ADD CONSTRAINT "menu_item_media_item_fkey"
  FOREIGN KEY ("menu_item_id") REFERENCES "menu_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "menu_item_media"
  ADD CONSTRAINT "menu_item_media_asset_fkey"
  FOREIGN KEY ("media_asset_id") REFERENCES "media_assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
