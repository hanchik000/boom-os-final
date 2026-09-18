-- Employee management profile, separated from authentication identity.
CREATE TABLE "employee_profiles" (
    "user_id" TEXT NOT NULL,
    "employee_code" TEXT NOT NULL,
    "position_title" TEXT NOT NULL,
    "department" TEXT,
    "employment_type" TEXT NOT NULL DEFAULT 'FULL_TIME',
    "hire_date" TEXT,
    "termination_date" TEXT,
    "notes" TEXT,
    "created_at" TEXT NOT NULL,
    "updated_at" TEXT NOT NULL,
    CONSTRAINT "employee_profiles_pkey" PRIMARY KEY ("user_id"),
    CONSTRAINT "employee_profiles_employee_code_key" UNIQUE ("employee_code"),
    CONSTRAINT "employee_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "idx_employee_profiles_position" ON "employee_profiles"("position_title");
CREATE INDEX "idx_employee_profiles_department" ON "employee_profiles"("department");
CREATE INDEX "idx_employee_profiles_type" ON "employee_profiles"("employment_type");

-- Backfill an operational profile for existing users without one.
INSERT INTO "employee_profiles" ("user_id", "employee_code", "position_title", "department", "employment_type", "hire_date", "created_at", "updated_at")
SELECT u."id", 'EMP-' || u."id", 'Staff', NULL, 'FULL_TIME', COALESCE(u."joined_at", u."created_at"), u."created_at", u."updated_at"
FROM "users" u
LEFT JOIN "employee_profiles" ep ON ep."user_id" = u."id"
WHERE ep."user_id" IS NULL;
