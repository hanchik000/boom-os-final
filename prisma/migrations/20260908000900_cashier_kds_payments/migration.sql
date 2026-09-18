CREATE TABLE "cash_shifts" (
  "id" TEXT NOT NULL,
  "branch_id" TEXT NOT NULL,
  "cashier_user_id" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'OPEN',
  "opening_cash" DECIMAL(12,2) NOT NULL,
  "cash_sales" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "card_sales" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "online_sales" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "bonus_sales" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "refunds" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "voids" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "expected_cash" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "actual_cash" DECIMAL(12,2),
  "difference" DECIMAL(12,2),
  "opened_at" TEXT NOT NULL,
  "closed_at" TEXT,
  "created_at" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL,
  CONSTRAINT "cash_shifts_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "idx_cash_shifts_branch_status" ON "cash_shifts"("branch_id","status");
CREATE INDEX "idx_cash_shifts_cashier_opened" ON "cash_shifts"("cashier_user_id","opened_at");
CREATE UNIQUE INDEX "uq_cash_shifts_one_open_per_branch" ON "cash_shifts"("branch_id") WHERE "status" = 'OPEN';
ALTER TABLE "cash_shifts" ADD CONSTRAINT "cash_shifts_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "cash_shifts" ADD CONSTRAINT "cash_shifts_cashier_user_id_fkey" FOREIGN KEY ("cashier_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "payments" (
  "id" TEXT NOT NULL,
  "order_id" TEXT NOT NULL,
  "branch_id" TEXT NOT NULL,
  "cash_shift_id" TEXT,
  "cashier_user_id" TEXT NOT NULL,
  "method" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PAID',
  "amount" DECIMAL(12,2) NOT NULL,
  "external_reference" TEXT,
  "idempotency_key" TEXT,
  "created_at" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL,
  "refunded_at" TEXT,
  CONSTRAINT "payments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "payments_branch_idempotency_key_key" UNIQUE ("branch_id","idempotency_key")
);
CREATE INDEX "idx_payments_order_status" ON "payments"("order_id","status");
CREATE INDEX "idx_payments_branch_created" ON "payments"("branch_id","created_at");
CREATE INDEX "idx_payments_shift" ON "payments"("cash_shift_id");
ALTER TABLE "payments" ADD CONSTRAINT "payments_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payments" ADD CONSTRAINT "payments_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payments" ADD CONSTRAINT "payments_cash_shift_id_fkey" FOREIGN KEY ("cash_shift_id") REFERENCES "cash_shifts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payments" ADD CONSTRAINT "payments_cashier_user_id_fkey" FOREIGN KEY ("cashier_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "kds_tickets" (
  "id" TEXT NOT NULL,
  "order_id" TEXT NOT NULL,
  "branch_id" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'NEW',
  "created_at" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL,
  "started_at" TEXT,
  "ready_at" TEXT,
  "completed_at" TEXT,
  CONSTRAINT "kds_tickets_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "kds_tickets_order_id_key" UNIQUE ("order_id")
);
CREATE INDEX "idx_kds_branch_status_created" ON "kds_tickets"("branch_id","status","created_at");
ALTER TABLE "kds_tickets" ADD CONSTRAINT "kds_tickets_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "kds_tickets" ADD CONSTRAINT "kds_tickets_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
