-- AlterTable
ALTER TABLE "customers" ADD COLUMN     "boomcoin_balance" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "qualifying_spend" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "boomcoin_ledger" (
    "id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "coins" INTEGER NOT NULL,
    "qualifying_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "balance_before" INTEGER NOT NULL,
    "balance_after" INTEGER NOT NULL,
    "spend_before" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "spend_after" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "order_id" TEXT,
    "bill_id" TEXT,
    "reason" TEXT,
    "created_by" TEXT,
    "created_at" TEXT NOT NULL,
    "entry_key" TEXT NOT NULL,

    CONSTRAINT "boomcoin_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "uq_boomcoin_ledger_entry_key" ON "boomcoin_ledger"("entry_key");

-- CreateIndex
CREATE INDEX "idx_boomcoin_ledger_branch_created" ON "boomcoin_ledger"("branch_id", "created_at");

-- CreateIndex
CREATE INDEX "idx_boomcoin_ledger_customer_created" ON "boomcoin_ledger"("customer_id", "created_at");

-- AddForeignKey
ALTER TABLE "boomcoin_ledger" ADD CONSTRAINT "boomcoin_ledger_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "boomcoin_ledger" ADD CONSTRAINT "boomcoin_ledger_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "boomcoin_ledger" ADD CONSTRAINT "boomcoin_ledger_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "boomcoin_ledger" ADD CONSTRAINT "boomcoin_ledger_bill_id_fkey" FOREIGN KEY ("bill_id") REFERENCES "order_bills"("id") ON DELETE SET NULL ON UPDATE CASCADE;

