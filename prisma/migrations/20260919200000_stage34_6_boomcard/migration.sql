-- AlterTable
ALTER TABLE "customers" ADD COLUMN     "birth_date" TEXT;

-- CreateTable
CREATE TABLE "boomcards" (
    "id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "card_number" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'CANDIDATE',
    "cabinet_token" TEXT NOT NULL,
    "qualifying_spend" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "activated_at" TEXT,
    "valid_until" TEXT,
    "deactivated_at" TEXT,
    "breakfast_granted" INTEGER NOT NULL DEFAULT 0,
    "breakfast_used" INTEGER NOT NULL DEFAULT 0,
    "created_by" TEXT,
    "created_at" TEXT NOT NULL,
    "updated_at" TEXT NOT NULL,

    CONSTRAINT "boomcards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "boomcard_events" (
    "id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "boomcard_id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status_before" TEXT,
    "status_after" TEXT,
    "qualifying_spend" DECIMAL(12,2),
    "period_start" TEXT,
    "period_end" TEXT,
    "quantity" INTEGER,
    "reason" TEXT,
    "decided_by" TEXT,
    "automatic" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TEXT NOT NULL,

    CONSTRAINT "boomcard_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "boomcard_birthday_gifts" (
    "id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "boomcard_id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "menu_item_id" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'GRANTED',
    "valid_from" TEXT NOT NULL,
    "valid_until" TEXT NOT NULL,
    "granted_by" TEXT,
    "granted_at" TEXT NOT NULL,
    "redeemed_at" TEXT,
    "redeemed_order_id" TEXT,

    CONSTRAINT "boomcard_birthday_gifts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "boomcards_customer_id_key" ON "boomcards"("customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "boomcards_card_number_key" ON "boomcards"("card_number");

-- CreateIndex
CREATE UNIQUE INDEX "boomcards_cabinet_token_key" ON "boomcards"("cabinet_token");

-- CreateIndex
CREATE INDEX "idx_boomcards_branch_status" ON "boomcards"("branch_id", "status");

-- CreateIndex
CREATE INDEX "idx_boomcard_events_branch_created" ON "boomcard_events"("branch_id", "created_at");

-- CreateIndex
CREATE INDEX "idx_boomcard_events_card_created" ON "boomcard_events"("boomcard_id", "created_at");

-- CreateIndex
CREATE INDEX "idx_boomcard_gifts_branch_status" ON "boomcard_birthday_gifts"("branch_id", "status");

-- CreateIndex
CREATE INDEX "idx_boomcard_gifts_customer_status" ON "boomcard_birthday_gifts"("customer_id", "status");

-- AddForeignKey
ALTER TABLE "boomcards" ADD CONSTRAINT "boomcards_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "boomcards" ADD CONSTRAINT "boomcards_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "boomcard_events" ADD CONSTRAINT "boomcard_events_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "boomcard_events" ADD CONSTRAINT "boomcard_events_boomcard_id_fkey" FOREIGN KEY ("boomcard_id") REFERENCES "boomcards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "boomcard_events" ADD CONSTRAINT "boomcard_events_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "boomcard_birthday_gifts" ADD CONSTRAINT "boomcard_birthday_gifts_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "boomcard_birthday_gifts" ADD CONSTRAINT "boomcard_birthday_gifts_boomcard_id_fkey" FOREIGN KEY ("boomcard_id") REFERENCES "boomcards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "boomcard_birthday_gifts" ADD CONSTRAINT "boomcard_birthday_gifts_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "boomcard_birthday_gifts" ADD CONSTRAINT "boomcard_birthday_gifts_menu_item_id_fkey" FOREIGN KEY ("menu_item_id") REFERENCES "menu_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

