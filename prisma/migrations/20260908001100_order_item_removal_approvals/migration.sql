ALTER TABLE "order_items"
  ADD COLUMN "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN "removed_quantity" DECIMAL(12,4) NOT NULL DEFAULT 0,
  ADD COLUMN "removed_at" TEXT,
  ADD COLUMN "removed_by" TEXT,
  ADD COLUMN "removal_reason" TEXT;

CREATE INDEX "idx_order_items_order_status" ON "order_items"("order_id","status");

CREATE TABLE "order_item_removal_approvals" (
  "id" TEXT NOT NULL,
  "order_id" TEXT NOT NULL,
  "order_item_id" TEXT NOT NULL,
  "branch_id" TEXT NOT NULL,
  "requester_user_id" TEXT NOT NULL,
  "approver_user_id" TEXT,
  "requested_quantity" DECIMAL(12,4) NOT NULL,
  "reason" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "created_at" TEXT NOT NULL,
  "decided_at" TEXT,
  "decision_reason" TEXT,
  CONSTRAINT "order_item_removal_approvals_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "idx_order_item_removal_branch_status_created" ON "order_item_removal_approvals"("branch_id","status","created_at");
CREATE INDEX "idx_order_item_removal_order_status" ON "order_item_removal_approvals"("order_id","status");
CREATE INDEX "idx_order_item_removal_item_status" ON "order_item_removal_approvals"("order_item_id","status");

ALTER TABLE "order_item_removal_approvals"
  ADD CONSTRAINT "order_item_removal_approvals_order_id_fkey"
  FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "order_item_removal_approvals"
  ADD CONSTRAINT "order_item_removal_approvals_order_item_id_fkey"
  FOREIGN KEY ("order_item_id") REFERENCES "order_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "order_item_removal_approvals"
  ADD CONSTRAINT "order_item_removal_approvals_branch_id_fkey"
  FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
