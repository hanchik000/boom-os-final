CREATE TABLE "waiter_pos_sessions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "device_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "expires_at" TEXT NOT NULL,
    "last_seen_at" TEXT NOT NULL,
    "created_at" TEXT NOT NULL,
    "revoked_at" TEXT,
    CONSTRAINT "waiter_pos_sessions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "waiter_pos_sessions_token_hash_key" UNIQUE ("token_hash"),
    CONSTRAINT "waiter_pos_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "waiter_pos_sessions_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "idx_waiter_pos_sessions_user" ON "waiter_pos_sessions"("user_id");
CREATE INDEX "idx_waiter_pos_sessions_branch" ON "waiter_pos_sessions"("branch_id");
CREATE INDEX "idx_waiter_pos_sessions_status" ON "waiter_pos_sessions"("status");
CREATE INDEX "idx_waiter_pos_sessions_expires" ON "waiter_pos_sessions"("expires_at");
