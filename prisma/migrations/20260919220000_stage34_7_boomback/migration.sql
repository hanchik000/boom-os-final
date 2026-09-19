-- AlterTable
ALTER TABLE "customers" ADD COLUMN     "boomback_balance" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "boomback_ledger" (
    "id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "balance_before" DECIMAL(12,2) NOT NULL,
    "balance_after" DECIMAL(12,2) NOT NULL,
    "order_id" TEXT,
    "bill_id" TEXT,
    "payment_id" TEXT,
    "reason" TEXT,
    "created_by" TEXT,
    "created_at" TEXT NOT NULL,
    "entry_key" TEXT NOT NULL,

    CONSTRAINT "boomback_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "uq_boomback_ledger_entry_key" ON "boomback_ledger"("entry_key");

-- CreateIndex
CREATE INDEX "idx_boomback_ledger_branch_created" ON "boomback_ledger"("branch_id", "created_at");

-- CreateIndex
CREATE INDEX "idx_boomback_ledger_customer_created" ON "boomback_ledger"("customer_id", "created_at");

-- AddForeignKey
ALTER TABLE "boomback_ledger" ADD CONSTRAINT "boomback_ledger_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "boomback_ledger" ADD CONSTRAINT "boomback_ledger_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "boomback_ledger" ADD CONSTRAINT "boomback_ledger_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "boomback_ledger" ADD CONSTRAINT "boomback_ledger_bill_id_fkey" FOREIGN KEY ("bill_id") REFERENCES "order_bills"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "boomback_ledger" ADD CONSTRAINT "boomback_ledger_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

