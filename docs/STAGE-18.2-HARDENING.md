# BOOM OS — Stage 18.2 Hardening

## Scope

Stage 18.2 is a hardening pass over the existing Stage 18.1 codebase. No new project or parallel order architecture is introduced.

## Changes

- Prisma `Branch` now has the inverse `menu_modifier_groups` relation required by `MenuModifierGroup.branch`.
- Waiter lifecycle terminology is standardized to `PROBATION` and `PROFESSIONAL`.
- Existing `TRIAL` waiter profile/history records are migrated to `PROBATION`; historical rows are not deleted.
- `requireBranchAccess()` now fails closed when a protected route cannot resolve a branch identifier.
- Existing historical-data protections remain: users, franchises, menu categories/items are archived with `deleted_at`; orders retain snapshots and restrictive financial relations.
- Existing service-charge allocation remains backend-controlled and configurable by group or individual; non-professional waiter allocation is excluded.
- Existing operator lock/unlock backend endpoints remain under RBAC and password verification.
- Added `tests/stage18_2_hardening_static.mjs` for Stage 18.2 acceptance checks.

## Verification performed in the build environment

- Stage 18.2 static acceptance: PASS (15/15)
- Stage 17 static acceptance: PASS (17/17)
- Stage 17.1 hardening static check: PASS
- Stage 7 waiter POS static acceptance: PASS

## Runtime status

NOT VERIFIED until the archive is tested with:

`npm ci`
`npx prisma validate`
`npx prisma generate`
`npx tsc --noEmit`
`npm run build`
`npx prisma migrate deploy`

and live HTTP/API/E2E tests against PostgreSQL.
