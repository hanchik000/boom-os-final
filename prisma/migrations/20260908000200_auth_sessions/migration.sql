CREATE TABLE "auth_sessions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TEXT NOT NULL,
    "created_at" TEXT NOT NULL,
    "last_seen_at" TEXT,
    "revoked_at" TEXT,
    "ip_address" TEXT,
    "user_agent" TEXT,
    CONSTRAINT "auth_sessions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "auth_sessions_token_hash_key" ON "auth_sessions"("token_hash");
CREATE INDEX "idx_auth_sessions_user" ON "auth_sessions"("user_id");
CREATE INDEX "idx_auth_sessions_expires" ON "auth_sessions"("expires_at");
CREATE INDEX "idx_auth_sessions_revoked" ON "auth_sessions"("revoked_at");

ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
