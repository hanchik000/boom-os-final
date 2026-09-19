-- AlterTable
ALTER TABLE "order_discounts" ADD COLUMN     "bill_id" TEXT;

-- AlterTable
ALTER TABLE "order_items" ADD COLUMN     "bill_id" TEXT;

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "split_mode" TEXT NOT NULL DEFAULT 'NONE';

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "bill_id" TEXT;

-- CreateTable
CREATE TABLE "order_bills" (
    "id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "bill_number" INTEGER NOT NULL,
    "customer_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "subtotal" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "discount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "service_charge" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "final_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "created_at" TEXT NOT NULL,
    "updated_at" TEXT NOT NULL,
    "closed_at" TEXT,

    CONSTRAINT "order_bills_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_order_bills_branch_status" ON "order_bills"("branch_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "uq_order_bills_order_number" ON "order_bills"("order_id", "bill_number");

-- CreateIndex
CREATE INDEX "idx_order_items_bill" ON "order_items"("bill_id");

-- CreateIndex
CREATE INDEX "idx_payments_bill_status" ON "payments"("bill_id", "status");

-- AddForeignKey
ALTER TABLE "order_bills" ADD CONSTRAINT "order_bills_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_bills" ADD CONSTRAINT "order_bills_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_bills" ADD CONSTRAINT "order_bills_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_discounts" ADD CONSTRAINT "order_discounts_bill_id_fkey" FOREIGN KEY ("bill_id") REFERENCES "order_bills"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_bill_id_fkey" FOREIGN KEY ("bill_id") REFERENCES "order_bills"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_bill_id_fkey" FOREIGN KEY ("bill_id") REFERENCES "order_bills"("id") ON DELETE SET NULL ON UPDATE CASCADE;

