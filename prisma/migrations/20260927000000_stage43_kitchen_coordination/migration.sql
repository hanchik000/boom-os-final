-- Stage 43 — finishing the kitchen flow: serving a whole order together, delay limits per dish
-- category, and escalation reminders that actually repeat.
--
-- Additive only, and only on the kitchen's own table. Order Core, Menu Engine, Inventory and the
-- financial tables are untouched; no column is dropped or retyped.

-- 1. "Подать вместе" as a PLANNING fact rather than only a message. The flag is set from the
--    existing waiter note (kitchen_comments, kind SERVE_TOGETHER) -- there is no second place to
--    declare it, and orders.* is not modified.
ALTER TABLE "kds_item_tasks" ADD COLUMN "serve_together" BOOLEAN NOT NULL DEFAULT false;

-- 2. The order-wide target the stations are paced to when its items must leave together: the
--    LATEST forecast among the order's tasks. Kept separate from forecast_ready_at so the station's
--    own estimate and the coordinated target never overwrite one another.
ALTER TABLE "kds_item_tasks" ADD COLUMN "coordinated_ready_at" TEXT;

-- 3. How many times a critical delay has already been escalated. Written only by the escalation
--    pass; it is what makes a REPEATING reminder idempotent without a background job.
ALTER TABLE "kds_item_tasks" ADD COLUMN "escalation_round" INTEGER NOT NULL DEFAULT 0;

-- 4. A branch may now set a delay limit for a whole dish category. The table already carried
--    category_id; this is the index that makes looking the row up cheap, plus the foreign key that
--    keeps it pointing at a real category.
CREATE INDEX "idx_kitchen_thresholds_category" ON "kitchen_thresholds"("branch_id","category_id");
ALTER TABLE "kitchen_thresholds" ADD CONSTRAINT "kitchen_thresholds_category_id_fkey"
  FOREIGN KEY ("category_id") REFERENCES "menu_categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 5. Finding an order's tasks when one of its notes arrives, and finding what still needs
--    escalating, are both hot paths now.
CREATE INDEX "idx_kds_item_tasks_serve_together" ON "kds_item_tasks"("order_id","serve_together");
CREATE INDEX "idx_kds_item_tasks_escalation" ON "kds_item_tasks"("branch_id","delay_state","escalation_round");
