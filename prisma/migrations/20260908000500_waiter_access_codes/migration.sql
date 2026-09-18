CREATE TABLE "waiter_access_codes" (
    "user_id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "code_hash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "created_at" TEXT NOT NULL,
    "updated_at" TEXT NOT NULL,
    "changed_by" TEXT,
    "last_used_at" TEXT,
    CONSTRAINT "waiter_access_codes_pkey" PRIMARY KEY ("user_id"),
    CONSTRAINT "waiter_access_codes_code_hash_key" UNIQUE ("code_hash"),
    CONSTRAINT "waiter_access_codes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "waiter_access_codes_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "idx_waiter_codes_branch" ON "waiter_access_codes"("branch_id");
CREATE INDEX "idx_waiter_codes_status" ON "waiter_access_codes"("status");
