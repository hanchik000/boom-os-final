-- Stage 1 Architecture Hardening: branch-scoped lookup and audit reporting indexes.
CREATE INDEX IF NOT EXISTS "idx_user_branch_user_branch" ON "user_branch_access"("user_id", "branch_id");
CREATE INDEX IF NOT EXISTS "idx_audit_branch_created" ON "audit_logs"("branch_id", "created_at");
