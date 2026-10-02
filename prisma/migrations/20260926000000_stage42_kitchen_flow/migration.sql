-- Stage 42 — Smart Kitchen: station routing, per-item kitchen work, forecasting, delays, EXPO.
--
-- Additive only. Order Core is untouched: orders, order_items, payments, bills, recipes and stock
-- movements keep every column and every rule they had. The existing one-ticket-per-order table
-- (kds_tickets) also stays exactly as it is and remains the aggregate the older screens read; what
-- this migration adds is the per-item, per-station unit of kitchen work underneath it.

-- 1. The stations of a branch. Configurable rows, never hardcoded business logic.
--    is_expo marks the assembly/handover station, which never receives cooking work.
CREATE TABLE "kitchen_stations" (
  "id"                TEXT NOT NULL,
  "branch_id"         TEXT NOT NULL,
  "code"              TEXT NOT NULL,
  "name_ru"           TEXT NOT NULL,
  "name_tk"           TEXT NOT NULL,
  "is_expo"           BOOLEAN NOT NULL DEFAULT false,
  -- how many items this station can genuinely cook at the same time; the queue forecast divides
  -- the remaining work by it.
  "parallel_capacity" INTEGER NOT NULL DEFAULT 1,
  "sort_order"        INTEGER NOT NULL DEFAULT 0,
  "status"            TEXT NOT NULL DEFAULT 'ACTIVE',
  "deleted_at"        TEXT,
  "created_at"        TEXT NOT NULL,
  "updated_at"        TEXT NOT NULL,
  CONSTRAINT "kitchen_stations_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "kitchen_stations_branch_code_key" ON "kitchen_stations"("branch_id","code");
CREATE INDEX "idx_kitchen_stations_branch" ON "kitchen_stations"("branch_id","status","sort_order");
ALTER TABLE "kitchen_stations" ADD CONSTRAINT "kitchen_stations_branch_id_fkey"
  FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 2. Routing a DISH to a station, with its standard time. is_secondary marks an additional
--    processing step on another station (a burger that also needs the FRY station, for instance).
CREATE TABLE "menu_item_routes" (
  "id"                TEXT NOT NULL,
  "menu_item_id"      TEXT NOT NULL,
  "station_id"        TEXT NOT NULL,
  "standard_minutes"  DECIMAL(8,2) NOT NULL DEFAULT 5,
  "tolerance_minutes" DECIMAL(8,2) NOT NULL DEFAULT 2,
  "is_secondary"      BOOLEAN NOT NULL DEFAULT false,
  "status"            TEXT NOT NULL DEFAULT 'ACTIVE',
  "created_at"        TEXT NOT NULL,
  "updated_at"        TEXT NOT NULL,
  CONSTRAINT "menu_item_routes_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "menu_item_routes_item_station_key" ON "menu_item_routes"("menu_item_id","station_id");
CREATE INDEX "idx_menu_item_routes_item" ON "menu_item_routes"("menu_item_id","status");
ALTER TABLE "menu_item_routes" ADD CONSTRAINT "menu_item_routes_menu_item_id_fkey"
  FOREIGN KEY ("menu_item_id") REFERENCES "menu_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "menu_item_routes" ADD CONSTRAINT "menu_item_routes_station_id_fkey"
  FOREIGN KEY ("station_id") REFERENCES "kitchen_stations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 3. The explicitly configured fallback for a whole category. There is no guessing from a dish
--    name anywhere in this system: without a dish route and without a category route an item goes
--    to the "needs assignment" queue.
CREATE TABLE "menu_category_routes" (
  "id"                TEXT NOT NULL,
  "category_id"       TEXT NOT NULL,
  "station_id"        TEXT NOT NULL,
  "standard_minutes"  DECIMAL(8,2) NOT NULL DEFAULT 5,
  "tolerance_minutes" DECIMAL(8,2) NOT NULL DEFAULT 2,
  "status"            TEXT NOT NULL DEFAULT 'ACTIVE',
  "created_at"        TEXT NOT NULL,
  "updated_at"        TEXT NOT NULL,
  CONSTRAINT "menu_category_routes_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "menu_category_routes_category_station_key" ON "menu_category_routes"("category_id","station_id");
ALTER TABLE "menu_category_routes" ADD CONSTRAINT "menu_category_routes_category_id_fkey"
  FOREIGN KEY ("category_id") REFERENCES "menu_categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "menu_category_routes" ADD CONSTRAINT "menu_category_routes_station_id_fkey"
  FOREIGN KEY ("station_id") REFERENCES "kitchen_stations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 4. The unit of kitchen work: one order line on one station. Several stations can hold work for
--    the same order and progress independently, which is why a station finishing its own task can
--    never by itself mark the whole order ready.
--    standard_minutes is the NORM in force when the task was created; forecast_* is the prediction;
--    started_at/ready_at are the FACT. Three different things, never overwritten into one.
CREATE TABLE "kds_item_tasks" (
  "id"                  TEXT NOT NULL,
  "branch_id"           TEXT NOT NULL,
  "order_id"            TEXT NOT NULL,
  "order_item_id"       TEXT NOT NULL,
  "station_id"          TEXT,
  "menu_item_id"        TEXT,
  "title_snapshot"      TEXT NOT NULL,
  "quantity"            INTEGER NOT NULL DEFAULT 1,
  "is_secondary"        BOOLEAN NOT NULL DEFAULT false,
  "status"              TEXT NOT NULL DEFAULT 'QUEUED',
  "priority"            INTEGER NOT NULL DEFAULT 0,
  "standard_minutes"    DECIMAL(8,2),
  "tolerance_minutes"   DECIMAL(8,2),
  "expected_minutes"    DECIMAL(8,2),
  "forecast_source"     TEXT,
  "forecast_start_at"   TEXT,
  "forecast_ready_at"   TEXT,
  "forecast_confidence" TEXT,
  "forecast_sample_size" INTEGER NOT NULL DEFAULT 0,
  "accepted_at"         TEXT,
  "started_at"          TEXT,
  "ready_at"            TEXT,
  "served_at"           TEXT,
  "cancelled_at"        TEXT,
  "delay_state"         TEXT NOT NULL DEFAULT 'NONE',
  "delay_reason"        TEXT,
  "reassigned_from"     TEXT,
  "reassign_reason"     TEXT,
  "created_at"          TEXT NOT NULL,
  "updated_at"          TEXT NOT NULL,
  CONSTRAINT "kds_item_tasks_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "kds_item_tasks_item_station_key" ON "kds_item_tasks"("order_item_id","station_id");
CREATE INDEX "idx_kds_item_tasks_station_queue" ON "kds_item_tasks"("branch_id","station_id","status","created_at");
CREATE INDEX "idx_kds_item_tasks_order" ON "kds_item_tasks"("order_id");
CREATE INDEX "idx_kds_item_tasks_history" ON "kds_item_tasks"("station_id","menu_item_id","ready_at");
ALTER TABLE "kds_item_tasks" ADD CONSTRAINT "kds_item_tasks_branch_id_fkey"
  FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "kds_item_tasks" ADD CONSTRAINT "kds_item_tasks_order_id_fkey"
  FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "kds_item_tasks" ADD CONSTRAINT "kds_item_tasks_order_item_id_fkey"
  FOREIGN KEY ("order_item_id") REFERENCES "order_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "kds_item_tasks" ADD CONSTRAINT "kds_item_tasks_station_id_fkey"
  FOREIGN KEY ("station_id") REFERENCES "kitchen_stations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "kds_item_tasks" ADD CONSTRAINT "kds_item_tasks_menu_item_id_fkey"
  FOREIGN KEY ("menu_item_id") REFERENCES "menu_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 5. When a delay counts as a warning, a delay or a critical delay, and when it escalates.
--    Ratios of the expected time, so one row works for a 2-minute drink and a 20-minute steak.
--    A row with station_id and category_id both null is the branch default.
CREATE TABLE "kitchen_thresholds" (
  "id"               TEXT NOT NULL,
  "branch_id"        TEXT NOT NULL,
  "station_id"       TEXT,
  "category_id"      TEXT,
  "warning_ratio"    DECIMAL(5,2) NOT NULL DEFAULT 0.80,
  "late_ratio"       DECIMAL(5,2) NOT NULL DEFAULT 1.00,
  "critical_ratio"   DECIMAL(5,2) NOT NULL DEFAULT 1.50,
  "escalate_minutes" INTEGER NOT NULL DEFAULT 5,
  "updated_by"       TEXT,
  "created_at"       TEXT NOT NULL,
  "updated_at"       TEXT NOT NULL,
  CONSTRAINT "kitchen_thresholds_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "kitchen_thresholds_scope_key" ON "kitchen_thresholds"("branch_id","station_id","category_id");
ALTER TABLE "kitchen_thresholds" ADD CONSTRAINT "kitchen_thresholds_branch_id_fkey"
  FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "kitchen_thresholds" ADD CONSTRAINT "kitchen_thresholds_station_id_fkey"
  FOREIGN KEY ("station_id") REFERENCES "kitchen_stations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 6. What the waiter tells the kitchen. A message, never a change: it cannot touch the order's
--    composition, price, recipe or stock -- those go through the existing approval routes.
CREATE TABLE "kitchen_comments" (
  "id"              TEXT NOT NULL,
  "branch_id"       TEXT NOT NULL,
  "order_id"        TEXT NOT NULL,
  "order_item_id"   TEXT,
  "kind"            TEXT NOT NULL,
  "text"            TEXT,
  "author_user_id"  TEXT,
  "author_role"     TEXT,
  "source"          TEXT NOT NULL,
  -- true when cooking had already started: the kitchen must see that this arrived late.
  "after_start"     BOOLEAN NOT NULL DEFAULT false,
  "acknowledged_at" TEXT,
  "acknowledged_by" TEXT,
  "created_at"      TEXT NOT NULL,
  CONSTRAINT "kitchen_comments_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "idx_kitchen_comments_order" ON "kitchen_comments"("order_id","created_at");
CREATE INDEX "idx_kitchen_comments_branch_new" ON "kitchen_comments"("branch_id","acknowledged_at","created_at");
ALTER TABLE "kitchen_comments" ADD CONSTRAINT "kitchen_comments_branch_id_fkey"
  FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "kitchen_comments" ADD CONSTRAINT "kitchen_comments_order_id_fkey"
  FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "kitchen_comments" ADD CONSTRAINT "kitchen_comments_order_item_id_fkey"
  FOREIGN KEY ("order_item_id") REFERENCES "order_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 7. Delay notifications, help requests and escalations. dedupe_key is what makes them idempotent:
--    the same delay on the same task can only ever be announced once, however many times a screen
--    refreshes or a recalculation runs.
CREATE TABLE "kitchen_alerts" (
  "id"              TEXT NOT NULL,
  "branch_id"       TEXT NOT NULL,
  "station_id"      TEXT,
  "order_id"        TEXT,
  "task_id"         TEXT,
  "type"            TEXT NOT NULL,
  "severity"        TEXT NOT NULL DEFAULT 'INFO',
  "audience"        TEXT NOT NULL,
  "reason"          TEXT,
  "message_ru"      TEXT,
  "message_tk"      TEXT,
  "dedupe_key"      TEXT NOT NULL,
  "created_by"      TEXT,
  "acknowledged_at" TEXT,
  "acknowledged_by" TEXT,
  "resolution"      TEXT,
  "created_at"      TEXT NOT NULL,
  CONSTRAINT "kitchen_alerts_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "kitchen_alerts_dedupe_key" ON "kitchen_alerts"("dedupe_key");
CREATE INDEX "idx_kitchen_alerts_branch_open" ON "kitchen_alerts"("branch_id","acknowledged_at","created_at");
ALTER TABLE "kitchen_alerts" ADD CONSTRAINT "kitchen_alerts_branch_id_fkey"
  FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "kitchen_alerts" ADD CONSTRAINT "kitchen_alerts_station_id_fkey"
  FOREIGN KEY ("station_id") REFERENCES "kitchen_stations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "kitchen_alerts" ADD CONSTRAINT "kitchen_alerts_order_id_fkey"
  FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "kitchen_alerts" ADD CONSTRAINT "kitchen_alerts_task_id_fkey"
  FOREIGN KEY ("task_id") REFERENCES "kds_item_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 8. The handover itself: who assembled the order, who took it, and -- if an incomplete order was
--    released -- why, by whom, and which items were missing. One row per handover, append-only.
CREATE TABLE "expo_handovers" (
  "id"             TEXT NOT NULL,
  "branch_id"      TEXT NOT NULL,
  "order_id"       TEXT NOT NULL,
  "kind"           TEXT NOT NULL,
  "missing_items"  TEXT,
  "reason"         TEXT,
  "actor_user_id"  TEXT,
  "actor_role"     TEXT,
  "created_at"     TEXT NOT NULL,
  CONSTRAINT "expo_handovers_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "idx_expo_handovers_order" ON "expo_handovers"("order_id","created_at");
CREATE INDEX "idx_expo_handovers_branch" ON "expo_handovers"("branch_id","created_at");
ALTER TABLE "expo_handovers" ADD CONSTRAINT "expo_handovers_branch_id_fkey"
  FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "expo_handovers" ADD CONSTRAINT "expo_handovers_order_id_fkey"
  FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
