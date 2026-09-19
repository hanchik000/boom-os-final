-- DropIndex
ALTER TABLE "service_charge_configs" DROP CONSTRAINT "service_charge_configs_branch_id_key";

-- DropIndex
DROP INDEX "uq_service_charge_ledger_order_user_target_department";

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "service_charge_config_id" TEXT;

-- AlterTable
ALTER TABLE "service_charge_allocations" ADD COLUMN     "category_id" TEXT;

-- AlterTable
ALTER TABLE "service_charge_configs" ADD COLUMN     "created_by" TEXT,
ADD COLUMN     "delivery_percent" DECIMAL(5,2) NOT NULL DEFAULT 0,
ADD COLUMN     "effective_from" TEXT,
ADD COLUMN     "effective_to" TEXT,
ADD COLUMN     "note" TEXT,
ADD COLUMN     "scope" TEXT NOT NULL DEFAULT 'BRANCH',
ADD COLUMN     "takeaway_percent" DECIMAL(5,2) NOT NULL DEFAULT 0,
ALTER COLUMN "branch_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "service_charge_ledger" ADD COLUMN     "allocation_key" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "category" TEXT,
ADD COLUMN     "config_id" TEXT,
ADD COLUMN     "pool_id" TEXT,
ADD COLUMN     "strategy" TEXT;

-- Backfill before the new NOT NULL / UNIQUE constraints can hold on an existing installation:
-- every pre-existing configuration has been in force since it was created, and every pre-existing
-- ledger row gets the deterministic allocation key the new recording code computes.
UPDATE "service_charge_configs" SET "effective_from" = "created_at" WHERE "effective_from" IS NULL;
ALTER TABLE "service_charge_configs" ALTER COLUMN "effective_from" SET NOT NULL;

UPDATE "service_charge_ledger"
SET "allocation_key" = COALESCE("department", 'NONE') || '|' || "target_type" || '|' || COALESCE("user_id", 'POOL')
WHERE "allocation_key" = '';

-- CreateTable
CREATE TABLE "service_charge_categories" (
    "id" TEXT NOT NULL,
    "config_id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "percent" DECIMAL(5,2) NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'COMMON',
    "strategy" TEXT NOT NULL DEFAULT 'EQUAL',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TEXT NOT NULL,
    "updated_at" TEXT NOT NULL,

    CONSTRAINT "service_charge_categories_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_service_charge_category_config_active" ON "service_charge_categories"("config_id", "active");

-- CreateIndex
CREATE UNIQUE INDEX "uq_service_charge_category_config_category" ON "service_charge_categories"("config_id", "category");

-- CreateIndex
CREATE INDEX "idx_service_charge_config_branch_status_from" ON "service_charge_configs"("branch_id", "status", "effective_from");

-- CreateIndex
CREATE INDEX "idx_service_charge_config_scope_status_from" ON "service_charge_configs"("scope", "status", "effective_from");

-- CreateIndex
CREATE UNIQUE INDEX "uq_service_charge_ledger_order_allocation_key" ON "service_charge_ledger"("order_id", "allocation_key");

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_service_charge_config_id_fkey" FOREIGN KEY ("service_charge_config_id") REFERENCES "service_charge_configs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_charge_categories" ADD CONSTRAINT "service_charge_categories_config_id_fkey" FOREIGN KEY ("config_id") REFERENCES "service_charge_configs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_charge_allocations" ADD CONSTRAINT "service_charge_allocations_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "service_charge_categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_charge_ledger" ADD CONSTRAINT "service_charge_ledger_config_id_fkey" FOREIGN KEY ("config_id") REFERENCES "service_charge_configs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_charge_ledger" ADD CONSTRAINT "service_charge_ledger_pool_id_fkey" FOREIGN KEY ("pool_id") REFERENCES "service_charge_ledger"("id") ON DELETE CASCADE ON UPDATE CASCADE;

