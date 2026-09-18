CREATE TABLE "menu_modifier_groups" (
  "id" TEXT NOT NULL, "branch_id" TEXT NOT NULL, "menu_item_id" TEXT NOT NULL, "name_ru" TEXT NOT NULL, "name_tk" TEXT NOT NULL,
  "min_select" INTEGER NOT NULL DEFAULT 0, "max_select" INTEGER NOT NULL DEFAULT 1, "required" BOOLEAN NOT NULL DEFAULT false,
  "sort_order" INTEGER NOT NULL DEFAULT 0, "status" TEXT NOT NULL DEFAULT 'ACTIVE', "created_at" TEXT NOT NULL, "updated_at" TEXT NOT NULL,
  CONSTRAINT "menu_modifier_groups_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "menu_modifier_groups_item_fkey" FOREIGN KEY ("menu_item_id") REFERENCES "menu_items"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "menu_modifier_groups_branch_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "idx_menu_modifier_groups_item" ON "menu_modifier_groups"("menu_item_id");
CREATE INDEX "idx_menu_modifier_groups_branch" ON "menu_modifier_groups"("branch_id");
CREATE TABLE "menu_modifiers" (
  "id" TEXT NOT NULL, "group_id" TEXT NOT NULL, "name_ru" TEXT NOT NULL, "name_tk" TEXT NOT NULL, "price_delta" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "sort_order" INTEGER NOT NULL DEFAULT 0, "status" TEXT NOT NULL DEFAULT 'ACTIVE', "created_at" TEXT NOT NULL, "updated_at" TEXT NOT NULL,
  CONSTRAINT "menu_modifiers_pkey" PRIMARY KEY ("id"), CONSTRAINT "menu_modifiers_group_fkey" FOREIGN KEY ("group_id") REFERENCES "menu_modifier_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "idx_menu_modifiers_group" ON "menu_modifiers"("group_id");
CREATE TABLE "order_item_modifiers" (
  "id" TEXT NOT NULL, "order_item_id" TEXT NOT NULL, "modifier_id" TEXT, "name_snapshot" TEXT NOT NULL, "price_delta_snapshot" DECIMAL(12,2) NOT NULL,
  "quantity" INTEGER NOT NULL DEFAULT 1, "created_at" TEXT NOT NULL,
  CONSTRAINT "order_item_modifiers_pkey" PRIMARY KEY ("id"), CONSTRAINT "order_item_modifiers_item_fkey" FOREIGN KEY ("order_item_id") REFERENCES "order_items"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "order_item_modifiers_modifier_fkey" FOREIGN KEY ("modifier_id") REFERENCES "menu_modifiers"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "idx_order_item_modifiers_item" ON "order_item_modifiers"("order_item_id");
