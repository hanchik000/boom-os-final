-- Stage 18.4: prevent concurrent active operator POS sessions for the same user/branch.
-- The application already serializes normal unlocks, but this DB constraint closes the race window.
CREATE UNIQUE INDEX IF NOT EXISTS "uq_operator_pos_one_active_per_user_branch"
ON "operator_pos_sessions" ("user_id", "branch_id")
WHERE "status" = 'ACTIVE';

-- Stage 18.4: speed up resource-to-session branch resolution and active-session checks.
CREATE INDEX IF NOT EXISTS "idx_operator_pos_active_lookup"
ON "operator_pos_sessions" ("user_id", "branch_id", "status", "expires_at");
