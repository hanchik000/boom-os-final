CREATE TABLE "inventory_items" (
  "id" TEXT NOT NULL,
  "branch_id" TEXT NOT NULL,
  "sku" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "unit" TEXT NOT NULL,
  "current_stock" DECIMAL(14,4) NOT NULL DEFAULT 0,
  "reorder_point" DECIMAL(14,4) NOT NULL DEFAULT 0,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL,
  CONSTRAINT "inventory_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "inventory_items_branch_sku_key" UNIQUE ("branch_id","sku")
);
CREATE INDEX "idx_inventory_items_branch_active" ON "inventory_items"("branch_id","active");
CREATE INDEX "idx_inventory_items_low_stock" ON "inventory_items"("branch_id","current_stock","reorder_point");
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "recipes" (
  "id" TEXT NOT NULL,
  "branch_id" TEXT NOT NULL,
  "menu_item_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "yield_qty" DECIMAL(14,4) NOT NULL DEFAULT 1,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL,
  CONSTRAINT "recipes_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "recipes_branch_menu_item_key" UNIQUE ("branch_id","menu_item_id")
);
CREATE INDEX "idx_recipes_branch_active" ON "recipes"("branch_id","active");
ALTER TABLE "recipes" ADD CONSTRAINT "recipes_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "recipes" ADD CONSTRAINT "recipes_menu_item_id_fkey" FOREIGN KEY ("menu_item_id") REFERENCES "menu_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "recipe_ingredients" (
  "id" TEXT NOT NULL,
  "recipe_id" TEXT NOT NULL,
  "inventory_item_id" TEXT NOT NULL,
  "quantity" DECIMAL(14,4) NOT NULL,
  "created_at" TEXT NOT NULL,
  CONSTRAINT "recipe_ingredients_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "recipe_ingredients_recipe_item_key" UNIQUE ("recipe_id","inventory_item_id")
);
CREATE INDEX "idx_recipe_ingredients_inventory" ON "recipe_ingredients"("inventory_item_id");
ALTER TABLE "recipe_ingredients" ADD CONSTRAINT "recipe_ingredients_recipe_id_fkey" FOREIGN KEY ("recipe_id") REFERENCES "recipes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "recipe_ingredients" ADD CONSTRAINT "recipe_ingredients_inventory_item_id_fkey" FOREIGN KEY ("inventory_item_id") REFERENCES "inventory_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "suppliers" (
  "id" TEXT NOT NULL,
  "branch_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "phone" TEXT,
  "email" TEXT,
  "address" TEXT,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "created_at" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL,
  CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "suppliers_branch_name_key" UNIQUE ("branch_id","name")
);
CREATE INDEX "idx_suppliers_branch_status" ON "suppliers"("branch_id","status");
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "purchases" (
  "id" TEXT NOT NULL,
  "branch_id" TEXT NOT NULL,
  "supplier_id" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "reference" TEXT,
  "notes" TEXT,
  "total_cost" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "created_at" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL,
  "received_at" TEXT,
  CONSTRAINT "purchases_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "idx_purchases_branch_status_created" ON "purchases"("branch_id","status","created_at");
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "purchase_items" (
  "id" TEXT NOT NULL,
  "purchase_id" TEXT NOT NULL,
  "inventory_item_id" TEXT NOT NULL,
  "quantity" DECIMAL(14,4) NOT NULL,
  "unit_cost" DECIMAL(14,2) NOT NULL,
  "subtotal" DECIMAL(14,2) NOT NULL,
  CONSTRAINT "purchase_items_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "idx_purchase_items_purchase" ON "purchase_items"("purchase_id");
CREATE INDEX "idx_purchase_items_inventory" ON "purchase_items"("inventory_item_id");
ALTER TABLE "purchase_items" ADD CONSTRAINT "purchase_items_purchase_id_fkey" FOREIGN KEY ("purchase_id") REFERENCES "purchases"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "purchase_items" ADD CONSTRAINT "purchase_items_inventory_item_id_fkey" FOREIGN KEY ("inventory_item_id") REFERENCES "inventory_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "stock_movements" (
  "id" TEXT NOT NULL,
  "branch_id" TEXT NOT NULL,
  "inventory_item_id" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "quantity" DECIMAL(14,4) NOT NULL,
  "unit_cost" DECIMAL(14,2),
  "reference_type" TEXT,
  "reference_id" TEXT,
  "reason" TEXT,
  "created_by" TEXT,
  "created_at" TEXT NOT NULL,
  CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "uq_stock_movement_reference" UNIQUE ("branch_id","reference_type","reference_id","inventory_item_id","type")
);
CREATE INDEX "idx_stock_movements_branch_created" ON "stock_movements"("branch_id","created_at");
CREATE INDEX "idx_stock_movements_item_created" ON "stock_movements"("inventory_item_id","created_at");
CREATE INDEX "idx_stock_movements_branch_type" ON "stock_movements"("branch_id","type");
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_inventory_item_id_fkey" FOREIGN KEY ("inventory_item_id") REFERENCES "inventory_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
