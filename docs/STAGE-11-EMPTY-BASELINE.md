# Stage 11 — Empty Baseline & Owner Provisioning

## Goal
BOOM OS must open as a clean operational system. No invented franchises, branches, employees, sales, customers, menu items or demo credentials are seeded.

## Bootstrap owner
The only optional automatic account is an OWNER supplied by deployment environment variables:
- `BOOTSTRAP_OWNER_NAME`
- `BOOTSTRAP_OWNER_EMAIL`
- `BOOTSTRAP_OWNER_PHONE` (optional)
- `BOOTSTRAP_OWNER_PASSWORD` (minimum 12 characters)

If these variables are not supplied, the database remains empty of business users and the startup log explicitly states that no bootstrap owner was configured.

The OWNER account has global authority through the existing RBAC model and may create franchises, branches, managers and staff.

## Manager provisioning model
1. OWNER logs in with their own email/phone + password.
2. OWNER creates a manager user.
3. OWNER assigns the manager a system role (for example `BRANCH_MANAGER` or `GENERAL_MANAGER`) and branch access.
4. The assigned role determines baseline permissions. Custom roles can be created where finer-grained capabilities are required.
5. The manager receives their own login credentials.
6. Waiter POS codes remain a separate credential and are managed only by authorized management; a manager is not automatically given a waiter POS code.

Historical records identify users by immutable user ID, not by mutable login/POS codes.

## Important
Changing the seed does not delete data from an already populated production database. Existing real data must never be removed automatically by a seed routine.


## Stage 12 clean source baseline

Legacy SQLite/JSON backups and the legacy importer are removed from the distributable project. The production baseline contains only system RBAC/settings infrastructure; no demo franchises, branches, employees, customers, menu, tables, orders, sales or PINs are seeded.
