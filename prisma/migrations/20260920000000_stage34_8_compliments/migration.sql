-- CreateTable
CREATE TABLE "compliment_requests" (
    "id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "bill_id" TEXT,
    "customer_id" TEXT,
    "menu_item_id" TEXT NOT NULL,
    "order_item_id" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "reason" TEXT NOT NULL,
    "comment" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "normal_value" DECIMAL(12,2) NOT NULL,
    "requester_user_id" TEXT,
    "requester_role" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "approver_user_id" TEXT,
    "decision_reason" TEXT,
    "created_at" TEXT NOT NULL,
    "decided_at" TEXT,

    CONSTRAINT "compliment_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_compliment_requests_branch_status_created" ON "compliment_requests"("branch_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "idx_compliment_requests_order_status" ON "compliment_requests"("order_id", "status");

-- AddForeignKey
ALTER TABLE "compliment_requests" ADD CONSTRAINT "compliment_requests_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compliment_requests" ADD CONSTRAINT "compliment_requests_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compliment_requests" ADD CONSTRAINT "compliment_requests_bill_id_fkey" FOREIGN KEY ("bill_id") REFERENCES "order_bills"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compliment_requests" ADD CONSTRAINT "compliment_requests_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compliment_requests" ADD CONSTRAINT "compliment_requests_menu_item_id_fkey" FOREIGN KEY ("menu_item_id") REFERENCES "menu_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compliment_requests" ADD CONSTRAINT "compliment_requests_order_item_id_fkey" FOREIGN KEY ("order_item_id") REFERENCES "order_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compliment_requests" ADD CONSTRAINT "compliment_requests_requester_user_id_fkey" FOREIGN KEY ("requester_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compliment_requests" ADD CONSTRAINT "compliment_requests_approver_user_id_fkey" FOREIGN KEY ("approver_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

