-- DropConstraint (was created as a table-level UNIQUE constraint, not a standalone index)
ALTER TABLE "recipes" DROP CONSTRAINT "recipes_branch_menu_item_key";

-- AlterTable
ALTER TABLE "inventory_items" ADD COLUMN     "average_cost" DECIMAL(14,4) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "order_items" ADD COLUMN     "recipe_cost_snapshot" DECIMAL(14,4),
ADD COLUMN     "recipe_version_snapshot" INTEGER;

-- AlterTable
ALTER TABLE "recipes" ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "inventory_counts" (
    "id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "inventory_item_id" TEXT NOT NULL,
    "theoretical_quantity" DECIMAL(14,4) NOT NULL,
    "counted_quantity" DECIMAL(14,4) NOT NULL,
    "delta" DECIMAL(14,4) NOT NULL,
    "reason" TEXT,
    "counted_by" TEXT NOT NULL,
    "stock_movement_id" TEXT,
    "created_at" TEXT NOT NULL,

    CONSTRAINT "inventory_counts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_inventory_counts_branch_created" ON "inventory_counts"("branch_id", "created_at");

-- CreateIndex
CREATE INDEX "idx_inventory_counts_item_created" ON "inventory_counts"("inventory_item_id", "created_at");

-- CreateIndex
CREATE INDEX "idx_recipes_branch_menu_item_active" ON "recipes"("branch_id", "menu_item_id", "active");

-- CreateIndex
CREATE UNIQUE INDEX "recipes_branch_menu_item_version_key" ON "recipes"("branch_id", "menu_item_id", "version");

-- AddForeignKey
ALTER TABLE "inventory_counts" ADD CONSTRAINT "inventory_counts_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_counts" ADD CONSTRAINT "inventory_counts_inventory_item_id_fkey" FOREIGN KEY ("inventory_item_id") REFERENCES "inventory_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_counts" ADD CONSTRAINT "inventory_counts_counted_by_fkey" FOREIGN KEY ("counted_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

