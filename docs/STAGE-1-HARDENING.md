# BOOM OS — Stage 1 Architecture Hardening

## Workflow
AUDIT → PLAN → IMPLEMENT → MIGRATION → TEST → VERIFY → REPORT

## Implemented

1. **Multi-branch isolation hardening**
   - Users and employees are resolved by primary branch **or** explicit `user_branch_access`.
   - Branch filters are rejected with `403 BRANCH_ACCESS_DENIED` when outside the current operator scope.
   - RBAC simulation options no longer expose users from unrelated branches to non-superusers.
   - User provisioning rejects branch assignments outside the creator's scope.

2. **Transactional foundation mutations**
   - Added a Prisma `$transaction` helper for the existing raw-SQL repository style.
   - User provisioning now atomically creates the user, status history, employee profile, roles, branch access, and its audit event.
   - Invalid role/branch references are validated before the transaction starts.

3. **Audit semantics**
   - Audit write failures are no longer silently swallowed.
   - Transactional mutations can write their audit event inside the same database transaction.

4. **Session hardening**
   - JWT/session lifetime is configurable through `SESSION_TTL_DAYS`.
   - Inactivity timeout is configurable through `SESSION_IDLE_TIMEOUT_MINUTES`.
   - Expired idle sessions are rejected during authentication.

5. **Migration/health correctness**
   - Health migration telemetry now reads Prisma's `_prisma_migrations` table rather than the custom mirror table.
   - Added indexes for common multi-branch and audit queries in migration `20260908000400_hardening_indexes`.

6. **Baseline syntax repair**
   - Repaired existing Stage 5 TypeScript syntax defects in affected i18n/UI files so the source can be parsed.
   - Added the missing `TranslationKey` export used by the existing language context.

## Verification

- TypeScript/TSX syntax parsing: **PASSED** using the installed TypeScript parser.
- Static Stage 1 hardening acceptance: **PASSED**.
- Full `tsc --noEmit`: **NOT VERIFIED** because the environment did not retain/install the repository dependency tree; `npm ci` timed out and the required type packages were unavailable afterward.
- Prisma CLI validation: **NOT VERIFIED** because `node_modules/.bin/prisma` was unavailable after the dependency installation attempt.
- Live PostgreSQL integration tests: **NOT VERIFIED** because no live database connection was available in this session.

No claim of full runtime PASS is made.

## Next stage

After Stage 1 hardening is accepted, proceed to the first restaurant operational domain using the existing architecture: **Menu Engine → Tables → unified Order Core → waiter dedicated POS → cashier confirmation → KDS**. The waiter code/device and customer feedback requirements remain part of that operational implementation and are not duplicated as a separate order/statistics system.
