-- Stage 38 — modifier-derived recipe cost.
-- Additive only: two nullable columns on an existing table, mirroring the pair order_items has
-- carried since Stage 34. Nothing is dropped, renamed or retyped, and no existing row is written.
ALTER TABLE "order_item_modifiers" ADD COLUMN "recipe_version_snapshot" INTEGER;
ALTER TABLE "order_item_modifiers" ADD COLUMN "recipe_cost_snapshot" DECIMAL(14,4);
