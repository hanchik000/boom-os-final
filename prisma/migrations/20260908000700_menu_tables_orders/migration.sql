CREATE TABLE "menu_categories" (
  "id" TEXT NOT NULL,
  "branch_id" TEXT,
  "name_ru" TEXT NOT NULL,
  "name_tk" TEXT NOT NULL,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "created_at" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL,
  CONSTRAINT "menu_categories_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "idx_menu_categories_branch" ON "menu_categories"("branch_id");
CREATE INDEX "idx_menu_categories_status" ON "menu_categories"("status");
ALTER TABLE "menu_categories" ADD CONSTRAINT "menu_categories_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "menu_items" (
  "id" TEXT NOT NULL,
  "branch_id" TEXT,
  "category_id" TEXT NOT NULL,
  "sku" TEXT NOT NULL,
  "name_ru" TEXT NOT NULL,
  "name_tk" TEXT NOT NULL,
  "description_ru" TEXT,
  "description_tk" TEXT,
  "price" DECIMAL(12,2) NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "created_at" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL,
  CONSTRAINT "menu_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "menu_items_sku_key" UNIQUE ("sku")
);
CREATE INDEX "idx_menu_items_branch" ON "menu_items"("branch_id");
CREATE INDEX "idx_menu_items_category" ON "menu_items"("category_id");
CREATE INDEX "idx_menu_items_status" ON "menu_items"("status");
ALTER TABLE "menu_items" ADD CONSTRAINT "menu_items_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "menu_items" ADD CONSTRAINT "menu_items_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "menu_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "dining_areas" (
  "id" TEXT NOT NULL,
  "branch_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "created_at" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL,
  CONSTRAINT "dining_areas_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "idx_dining_areas_branch" ON "dining_areas"("branch_id");
ALTER TABLE "dining_areas" ADD CONSTRAINT "dining_areas_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "dining_tables" (
  "id" TEXT NOT NULL,
  "branch_id" TEXT NOT NULL,
  "area_id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "seats" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'AVAILABLE',
  "created_at" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL,
  CONSTRAINT "dining_tables_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "dining_tables_branch_code_key" UNIQUE ("branch_id", "code")
);
CREATE INDEX "idx_dining_tables_branch" ON "dining_tables"("branch_id");
CREATE INDEX "idx_dining_tables_area" ON "dining_tables"("area_id");
CREATE INDEX "idx_dining_tables_status" ON "dining_tables"("status");
ALTER TABLE "dining_tables" ADD CONSTRAINT "dining_tables_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "dining_tables" ADD CONSTRAINT "dining_tables_area_id_fkey" FOREIGN KEY ("area_id") REFERENCES "dining_areas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "orders" (
  "id" TEXT NOT NULL,
  "order_number" TEXT NOT NULL,
  "branch_id" TEXT NOT NULL,
  "waiter_user_id" TEXT,
  "table_id" TEXT,
  "order_type" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "currency" TEXT NOT NULL,
  "subtotal" DECIMAL(12,2) NOT NULL,
  "discount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "promotion_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "service_charge" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "final_amount" DECIMAL(12,2) NOT NULL,
  "idempotency_key" TEXT,
  "notes" TEXT,
  "created_at" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL,
  "confirmed_at" TEXT,
  "confirmed_by" TEXT,
  CONSTRAINT "orders_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "orders_branch_order_number_key" UNIQUE ("branch_id", "order_number"),
  CONSTRAINT "orders_branch_idempotency_key_key" UNIQUE ("branch_id", "idempotency_key")
);
CREATE INDEX "idx_orders_branch" ON "orders"("branch_id");
CREATE INDEX "idx_orders_waiter" ON "orders"("waiter_user_id");
CREATE INDEX "idx_orders_table" ON "orders"("table_id");
CREATE INDEX "idx_orders_status" ON "orders"("status");
CREATE INDEX "idx_orders_created" ON "orders"("created_at");
ALTER TABLE "orders" ADD CONSTRAINT "orders_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "orders" ADD CONSTRAINT "orders_waiter_user_id_fkey" FOREIGN KEY ("waiter_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "orders" ADD CONSTRAINT "orders_table_id_fkey" FOREIGN KEY ("table_id") REFERENCES "dining_tables"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "order_items" (
  "id" TEXT NOT NULL,
  "order_id" TEXT NOT NULL,
  "menu_item_id" TEXT,
  "title_snapshot" TEXT NOT NULL,
  "price_snapshot" DECIMAL(12,2) NOT NULL,
  "quantity" INTEGER NOT NULL,
  "subtotal" DECIMAL(12,2) NOT NULL,
  "comment" TEXT,
  "created_at" TEXT NOT NULL,
  CONSTRAINT "order_items_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "idx_order_items_order" ON "order_items"("order_id");
CREATE INDEX "idx_order_items_menu_item" ON "order_items"("menu_item_id");
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_menu_item_id_fkey" FOREIGN KEY ("menu_item_id") REFERENCES "menu_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;
