-- Stage 18.2: waiter status terminology hardening.
-- Historical rows are preserved; only the current default/status value is normalized.
UPDATE "waiter_profiles" SET "status" = 'PROBATION' WHERE "status" = 'TRIAL';
UPDATE "waiter_status_history" SET "status" = 'PROBATION' WHERE "status" = 'TRIAL';
ALTER TABLE "waiter_profiles" ALTER COLUMN "status" SET DEFAULT 'PROBATION';
