# Phase 4 — Employee Management

## Purpose
Separates an employee's operational profile from authentication identity while keeping User → Role → Branch access intact.

## Added
- `employee_profiles` PostgreSQL table and Prisma model.
- Stable employee code.
- Position, department, employment type, hire/termination dates and internal notes.
- `/api/employees` list/detail endpoints with branch isolation.
- `/api/employees/:id/profile` profile upsert endpoint.
- Audit events for profile creation/update.
- Automatic profile creation for newly provisioned users.
- Migration backfill for existing users.
- Dedicated Personnel view in the existing UI.

## Separation of concerns
`users` remains the identity/authentication record. `employee_profiles` contains operational HR data. Roles and branch access remain in their existing RBAC tables.

## Verification
`tests/stage4_employee_management.ts` performs static acceptance checks. Full PostgreSQL/runtime tests require the project's dependencies and a live PostgreSQL instance.
