ALTER TABLE "menu_categories" ADD COLUMN "deleted_at" TEXT;
ALTER TABLE "menu_items" ADD COLUMN "deleted_at" TEXT;
CREATE INDEX "idx_menu_categories_deleted_at" ON "menu_categories"("deleted_at");
CREATE INDEX "idx_menu_items_deleted_at" ON "menu_items"("deleted_at");

CREATE TABLE "waiter_profiles" (
  "user_id" TEXT NOT NULL PRIMARY KEY,
  "status" TEXT NOT NULL DEFAULT 'TRIAL',
  "changed_by" TEXT,
  "changed_at" TEXT NOT NULL,
  CONSTRAINT "waiter_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "idx_waiter_profiles_status" ON "waiter_profiles"("status");

CREATE TABLE "waiter_status_history" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "user_id" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "changed_by" TEXT,
  "effective_at" TEXT NOT NULL,
  "created_at" TEXT NOT NULL,
  CONSTRAINT "waiter_status_history_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "idx_waiter_status_history_user_created" ON "waiter_status_history"("user_id","created_at");

CREATE TABLE "service_charge_configs" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "branch_id" TEXT NOT NULL UNIQUE,
  "percent" DECIMAL(5,2) NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "created_at" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL,
  CONSTRAINT "service_charge_configs_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE TABLE "service_charge_allocations" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "config_id" TEXT NOT NULL,
  "target_type" TEXT NOT NULL,
  "department" TEXT,
  "user_id" TEXT,
  "percent" DECIMAL(5,2) NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL,
  CONSTRAINT "service_charge_allocations_config_id_fkey" FOREIGN KEY ("config_id") REFERENCES "service_charge_configs"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "service_charge_allocations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "idx_service_charge_alloc_config_active" ON "service_charge_allocations"("config_id","active");
CREATE INDEX "idx_service_charge_alloc_user_active" ON "service_charge_allocations"("user_id","active");
CREATE TABLE "service_charge_ledger" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "branch_id" TEXT NOT NULL,
  "order_id" TEXT NOT NULL,
  "user_id" TEXT,
  "target_type" TEXT NOT NULL,
  "department" TEXT,
  "base_amount" DECIMAL(12,2) NOT NULL,
  "percent" DECIMAL(5,2) NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'EARNED',
  "created_at" TEXT NOT NULL,
  CONSTRAINT "service_charge_ledger_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "service_charge_ledger_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "service_charge_ledger_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "uq_service_charge_ledger_order_user_target_department" ON "service_charge_ledger"("order_id","user_id","target_type","department");
CREATE INDEX "idx_service_charge_ledger_branch_created" ON "service_charge_ledger"("branch_id","created_at");
CREATE INDEX "idx_service_charge_ledger_user_created" ON "service_charge_ledger"("user_id","created_at");

CREATE TABLE "kpi_rules" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "branch_id" TEXT,
  "name" TEXT NOT NULL,
  "role_code" TEXT,
  "user_id" TEXT,
  "metric" TEXT NOT NULL,
  "threshold" DECIMAL(14,2) NOT NULL,
  "threshold_mode" TEXT NOT NULL DEFAULT 'GREATER_THAN',
  "reward_type" TEXT NOT NULL,
  "reward_value" DECIMAL(14,2) NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL,
  CONSTRAINT "kpi_rules_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "kpi_rules_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "idx_kpi_rules_branch_active" ON "kpi_rules"("branch_id","active");
CREATE INDEX "idx_kpi_rules_user_active" ON "kpi_rules"("user_id","active");
CREATE TABLE "kpi_ledger" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "rule_id" TEXT NOT NULL,
  "branch_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "period_start" TEXT NOT NULL,
  "period_end" TEXT NOT NULL,
  "metric_value" DECIMAL(14,2) NOT NULL,
  "reward_amount" DECIMAL(14,2) NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'EARNED',
  "created_at" TEXT NOT NULL,
  CONSTRAINT "kpi_ledger_rule_id_fkey" FOREIGN KEY ("rule_id") REFERENCES "kpi_rules"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "kpi_ledger_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "kpi_ledger_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "uq_kpi_ledger_rule_user_period" ON "kpi_ledger"("rule_id","user_id","period_start","period_end");
CREATE INDEX "idx_kpi_ledger_branch_period" ON "kpi_ledger"("branch_id","period_end");
CREATE INDEX "idx_kpi_ledger_user_period" ON "kpi_ledger"("user_id","period_end");

CREATE TABLE "operator_pos_sessions" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "user_id" TEXT NOT NULL,
  "branch_id" TEXT NOT NULL,
  "pin_hash" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "device_id" TEXT NOT NULL,
  "last_seen_at" TEXT NOT NULL,
  "expires_at" TEXT NOT NULL,
  "locked_at" TEXT,
  "created_at" TEXT NOT NULL,
  CONSTRAINT "operator_pos_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "operator_pos_sessions_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "idx_operator_sessions_branch_status" ON "operator_pos_sessions"("branch_id","status");
CREATE INDEX "idx_operator_sessions_user_status" ON "operator_pos_sessions"("user_id","status");

CREATE TABLE "print_profiles" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "branch_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "paper_width" INTEGER NOT NULL DEFAULT 80,
  "language" TEXT NOT NULL DEFAULT 'ru',
  "config_json" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL,
  CONSTRAINT "print_profiles_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "idx_print_profiles_branch_active" ON "print_profiles"("branch_id","active");
CREATE TABLE "print_jobs" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "branch_id" TEXT NOT NULL,
  "order_id" TEXT,
  "requested_by" TEXT NOT NULL,
  "print_type" TEXT NOT NULL,
  "printer_name" TEXT,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "copy_number" INTEGER NOT NULL DEFAULT 1,
  "created_at" TEXT NOT NULL,
  "printed_at" TEXT,
  CONSTRAINT "print_jobs_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "print_jobs_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "print_jobs_requested_by_fkey" FOREIGN KEY ("requested_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "idx_print_jobs_branch_created" ON "print_jobs"("branch_id","created_at");
CREATE INDEX "idx_print_jobs_order_type" ON "print_jobs"("order_id","print_type");

INSERT INTO "system_settings" ("id","key","value","type","description","created_at","updated_at") VALUES
('setting_waiter_idle_timeout','POS_WAITER_IDLE_TIMEOUT_MINUTES','60','number','Idle timeout for waiter POS sessions.',now(),now()) ON CONFLICT ("key") DO NOTHING;
