-- CreateTable
CREATE TABLE "order_closures" (
    "id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "comment" TEXT,
    "inventory_treatment" TEXT NOT NULL,
    "refund_requested" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "production_state" TEXT NOT NULL,
    "requester_user_id" TEXT,
    "requester_role" TEXT,
    "approver_user_id" TEXT,
    "decision_reason" TEXT,
    "refund_payment_id" TEXT,
    "inventory_applied" BOOLEAN NOT NULL DEFAULT false,
    "paid_at_request" BOOLEAN NOT NULL DEFAULT false,
    "write_off_cost" DECIMAL(14,4),
    "created_at" TEXT NOT NULL,
    "decided_at" TEXT,

    CONSTRAINT "order_closures_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_order_closures_branch_status_created" ON "order_closures"("branch_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "idx_order_closures_order_status" ON "order_closures"("order_id", "status");

-- AddForeignKey
ALTER TABLE "order_closures" ADD CONSTRAINT "order_closures_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_closures" ADD CONSTRAINT "order_closures_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_closures" ADD CONSTRAINT "order_closures_requester_user_id_fkey" FOREIGN KEY ("requester_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_closures" ADD CONSTRAINT "order_closures_approver_user_id_fkey" FOREIGN KEY ("approver_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- AlterTable: stock_movements.unit_cost carried only 2 decimals while it is now stamped with the
-- ingredient's weighted-average cost (DECIMAL(14,4)); widening stops that silent rounding.
ALTER TABLE "stock_movements" ALTER COLUMN "unit_cost" SET DATA TYPE DECIMAL(14,4);
