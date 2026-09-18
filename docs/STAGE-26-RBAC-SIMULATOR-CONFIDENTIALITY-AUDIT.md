# BOOM OS — Stage 26: RBAC Simulator Confidentiality Audit

## Workflow
AUDIT → PLAN → IMPLEMENT → TEST → VERIFY → REPORT

## Scope

Focused read-side security audit of `POST /api/rbac/test` (the RBAC
simulator) and its companion `GET /api/rbac/options` (dropdown data),
closing the Stage 25 KNOWN GAP: "the simulator still echoes a
caller-supplied branch/franchise's name+code." No architecture rewrite.
No unrelated feature work.

## 1. Contract

Established from existing code (`server/routes/rbac.ts`,
`server/routes/franchises.ts`, `server/routes/branches.ts`), the seed
(`server/seed.ts`), and `docs/STAGE-1-HARDENING.md`:

- `POST /api/rbac/test` requires the `rbac.test` permission, granted only
  to `BRANCH_MANAGER` (and superusers) per the seed — never
  `GENERAL_MANAGER`. It is a diagnostic **simulation**: given a target
  `user_id` and optional hypothetical `role_id` / `branch_id` /
  `franchise_id` / `permission_code` overrides, it reports what that
  user's *effective* access would resolve to, without mutating anything.
- `user_id` identifies an existing target user to simulate; there is no
  indication self-simulation is treated specially anywhere in the code —
  the same `canSimulateUser()` gate (added in Stage 25) applies uniformly.
- Fields intentionally returned: the target's resolved roles, permission
  matrix, and `allowed_branch_ids` — this *is* the tool's purpose, and is
  already gated by `canSimulateUser()` so only a caller who shares branch
  scope with the target (or is a superuser) can simulate them at all.
- Fields that are **not** part of the contract: a foreign branch's or
  franchise's `name`/`code`, resolved merely because the caller typed its
  id into a hypothetical-override field. `docs/STAGE-1-HARDENING.md`
  (Stage 1) explicitly documents the original intent — "RBAC simulation
  options no longer expose users from unrelated branches to
  non-superusers" — establishing that branch-scoped confidentiality was
  the design intent from the start; the current disclosure was a
  regression, not an intentional feature.
- Cross-branch/cross-franchise simulation of a *target user* is allowed
  exactly when `canSimulateUser()` already allows it (shared branch scope
  or superuser). Cross-branch/cross-franchise *disclosure of a
  hypothetical branch/franchise's metadata* is a different, narrower
  question — addressed in Part C below — and was not previously gated at
  all.

## 2. Payload Confidentiality Matrix

Checked every response field (not just HTTP status) across
OWNER/SUPER_ADMIN, BRANCH_MANAGER@A1 only, BRANCH_MANAGER@A1+B1, and
BRANCH_MANAGER@no-branch, against self / same-branch / sibling-branch /
foreign-franchise targets, and against self/same-branch/sibling/foreign
`branch_id`/`franchise_id` override params.

| Actor \ Target or param | self | same-branch user | sibling-branch user | foreign-franchise user | own branch/franchise param | foreign branch/franchise param |
|---|---|---|---|---|---|---|
| OWNER/SUPER_ADMIN | 200, full fields | 200, full fields | 200, full fields | 200, full fields | 200, full fields | 200, full fields (by design — superuser) |
| BRANCH_MANAGER@A1 | 200, full fields | 200, full fields | 403, no leak | 403, no leak | 200, full fields | **403 (was 200 leaking name+code — FIXED)** |
| BRANCH_MANAGER@A1+B1 | 200, full fields | 200 (A1 or B1) | 403 for A2/B2, no leak | 403, no leak | 200, full fields | **403 for foreign, 200 for either owned branch/franchise — FIXED** |
| BRANCH_MANAGER@no-branch | 403 on any target, no leak | 403, no leak | 403, no leak | 403, no leak | n/a | **403, no leak — FIXED** |

No PII, email, phone, role, permission, `allowed_branch_ids`,
`branch_id`, branch/franchise name or code, franchise id, employment
info, or status/history data was found on any denied (403) response, both
before and after the fix — the pre-existing `canSimulateUser()` gate
already prevented target-user data leakage. The only confidentiality
defect was branch/franchise metadata resolved from the **override
parameters**, not from the target user (Part C).

## 3. Branch/Franchise Leak Audit

**Origin**: `POST /test` resolved `branch_id`/`franchise_id` from the
request body into a `targetBranch`/`targetFranchise` lookup purely to
build the simulation's hypothetical context, and returned that lookup's
`name`/`code`/`status` fields in `simulation_params.branch` /
`.franchise` — with no check that the caller was authorized to see that
branch or franchise at all. `GET /options` had the same class of
omission: its `franchises` list was unscoped while `users` and
`branches` in the very same response *were* scoped.

**Could the caller select arbitrary IDs?** Yes — `branch_id`/
`franchise_id` are plain request-body fields, no ownership check existed.

**Was access verified before disclosure?** No, prior to this fix.

**Could foreign metadata be disclosed?** Yes, confirmed by live
reproduction: `BRANCH_MANAGER@A1` supplying `branch_id: <B1's id>` (a
sibling franchise's branch) received `{"id":"...", "name":"Branch
B1","code":"B133136","franchise_id":"..."}` in the response — full
disclosure of a completely unrelated tenant's branch identity.

**Could topology be enumerated?** Yes, prior to the fix, trivially — any
branch/franchise id could be probed and its name+code read back
regardless of caller scope.

### Required Test Matrix (Part C)

| Case | Result |
|---|---|
| A1 → A2 (sibling branch, own franchise) | 403, no leak (BRANCH_ACCESS_DENIED) |
| A1 → B1 (foreign franchise's branch) | 403, no leak |
| A1 → B2 (foreign franchise's branch) | 403, no leak |
| A1 → nonexistent branch/franchise id | 403, identical shape to a real foreign id (no oracle) |
| A1+B1(MULTI) → A2/B2 | 403, no leak |
| A1+B1(MULTI) → A1/B1/FA/FB (controls) | 200, allowed — proves the gate isn't blanket-denying |
| superuser → all of the above, incl. nonexistent ids | 200 for real ids; no crash for nonexistent ids (previously crashed the whole request — see Part C fix below) |

All cases used real, existing records (Franchise A{A1,A2}, Franchise
B{B1,B2}) created fresh per test run, plus deliberately fabricated
nonexistent ids for the negative/enumeration cases.

**Second finding in this area — reliability, not confidentiality**: a
nonexistent `branch_id` crashed the entire request with HTTP 500
(`P2010`, a Postgres foreign-key violation), because the raw
unvalidated `branch_id` was written directly into
`audit_logs.branch_id` (which has an FK to `branches(id)`). This affected
superusers too, since they bypass the new scope gate. Fixed by using the
already-validated `targetBranch?.id` (which is `null`, not a garbage
string, when the id doesn't resolve to a real branch).

## 4. Enumeration Audit

For `branch_id`/`franchise_id`, a real-but-foreign id and a nonexistent
id now produce **byte-identical response shape** (same status 403, same
`code`, same `message`, same empty `details`), confirmed by direct
comparison in the E2E suite — closing the enumeration oracle, not just
the raw disclosure.

For `user_id`, an existing-but-out-of-scope target and a nonexistent
target id are **not** required to be identical by this audit: the
pre-existing `canSimulateUser()` behavior (unchanged, Stage 25) already
distinguishes 404 (`user_id` doesn't resolve) from 403 (resolves, but
caller can't simulate), matching the pattern used consistently elsewhere
in this codebase (e.g. `GET /api/users/:id`). This is a pre-existing,
codebase-wide convention, not a new or Stage-26-introduced gap, and no
response body data leak accompanies it (confirmed in Part 2's matrix).
Per the task's own caution against overstating timing side channels, no
timing analysis was attempted or claimed.

Role and permission enumeration: `resolved_roles` / permission matrix
data is only ever returned for `user_id` targets that already passed
`canSimulateUser()`, so no independent role/permission enumeration
channel exists beyond the pre-existing (and unchanged) user-simulation
boundary.

## 5. Vulnerabilities Found

1. **Branch/franchise metadata disclosure** (confidentiality) — a
   non-superuser could read any branch's or franchise's `name`/`code`/
   `status` by supplying its id as a hypothetical `branch_id`/
   `franchise_id` simulation parameter, with no ownership check.
   Confirmed exploitable by the shipped seed role (`BRANCH_MANAGER`).
2. **`GET /api/rbac/options` unscoped franchises list** (confidentiality)
   — returned every franchise network-wide to any caller with
   `rbac.test`, contradicting the scoping already applied to `users` and
   `branches` in the same response, and contradicting the established
   `GET /api/franchises` contract (Stage 22).
3. **Unvalidated `branch_id` crash in audit logging** (reliability /
   availability) — a nonexistent `branch_id` in the simulation request
   crashed the entire request with HTTP 500 due to an unhandled
   foreign-key violation, for both non-superusers and superusers.

No IDOR/enumeration bypass beyond #1 was found; no target-user PII/role/
permission leak was found (the Stage 25 `canSimulateUser()` gate already
covered that surface correctly).

## 6. Fixes

All three fixes are localized to `server/routes/rbac.ts` (54 lines
added, 6 removed; no other files changed):

1. **Caller-scope gate on `branch_id`/`franchise_id`** in `POST /test`:
   added immediately after the existing `canSimulateUser` gate. Requires
   the caller to hold the branch directly, or to hold *a* branch of the
   franchise (mirroring `canUserAccessFranchise`'s own "holds any branch
   of that franchise" model), before either id is resolved into
   disclosed metadata. Superusers are exempt, consistent with every other
   gate in this codebase. Real-foreign and nonexistent ids are treated
   identically (both simply fail the same check), closing the
   enumeration channel described in Part 4.
2. **`GET /options` franchises scoping**: branched on
   `req.user!.isSuperUser`, reusing `franchises.ts`'s exact Stage 22
   filter (`SELECT DISTINCT franchise_id FROM branches WHERE id IN
   (allowedBranchIds)`) for non-superusers, matching the scoping already
   applied to `users`/`branches` in the same endpoint.
3. **Audit-log FK crash fix**: changed `branchId: branch_id ||
   req.user!.branch_id` to `branchId: targetBranch?.id ||
   req.user!.branch_id`, using the already-validated lookup (which is
   `null`, satisfying the nullable FK, rather than an unvalidated string
   that violates it) instead of the raw request field.

No shared/second authorization system was introduced — fix #1 follows
the established per-route-file convention (a local gate reimplementing
the same branch/franchise access model already used by
`GET /api/branches/:id` and `GET /api/franchises/:id`).

## 7. Regression Tests

- **`tests/stage26_rbac_confidentiality_static.mjs`** (new, 9 checks):
  asserts the scope gate runs before `targetBranch` resolution, uses the
  correct franchise-ownership SQL pattern, returns the correct error
  codes, is wrapped in the superuser exemption, that the audit log uses
  `targetBranch?.id` (and does **not** match the old unvalidated
  pattern), and that `GET /options` branches its franchises query on
  `isSuperUser` using the Stage 22 filter. Negative-control verified:
  reverting the audit-log fix line causes the corresponding check to
  fail as expected.
- **`tests/stage26_rbac_confidentiality_e2e.mjs`** (new): builds two real
  franchises (A{A1,A2}, B{B1,B2}) and exercises the full Part
  B/C/D matrices end-to-end against a live server and database — self/
  same-branch/sibling/foreign targets, own/foreign/nonexistent
  branch_id/franchise_id params, and `GET /options` scoping for
  MGR(1 franchise)/MULTI(2 franchises)/NONE(0 franchises)/OWNER(all).
  Every denial is required to be a genuine 401/403 (never 400/404/500
  counted as a security boundary), and every denial response is checked
  field-by-field for leaked target/branch/franchise data. Negative-
  control verified: temporarily removing the new scope gate causes the
  suite to fail with "A2's name must not leak even though MGR is a
  member of its franchise."
- Registered in `package.json` as `test:stage26` (static, added to the
  `test:static` chain) and `test:e2e:rbacconfid` (E2E).

Because `server/routes/rbac.ts` is shared RBAC-adjacent infrastructure
that Stage 25's own suite directly exercises (Stage 25 fixed a
`canSimulateUser` bypass in this same file), Stage 25's E2E suite was
rerun to confirm no regression. Stages 18.8–24's suites do not touch
`rbac.ts` and no file outside `rbac.ts`/`package.json`/the two new test
files changed this stage, so they were not rerun.

## 8. Test Results

- `npx tsc --noEmit`: **PASS**, 0 errors
- `npm run build`: **PASS**, `dist/server.cjs` 345.7kb
- `npx prisma validate`: **PASS**, schema valid
- `npm run test:static`: **PASS**, exit 0, 26/26 static suites (Stages
  1–26, including the new Stage 26 static suite)
- `tests/stage25_authorization_closure_e2e.mjs` (rerun for shared-file
  regression): **PASS** — 3 existence proofs, 5 in-scope, 1 control, 29
  genuine auth denials, 5 privileged, 8/8 invariants
- `tests/stage26_rbac_confidentiality_e2e.mjs` (fresh database):
  **PASS** — 7 existence proofs, 5 in-scope, 6 controls, 12 genuine auth
  denials, 7 privileged, 4/4 invariants
- Independent post-run database check: franchise/branch topology intact;
  zero `audit_logs` rows with a `branch_id` violating the FK (confirms
  the crash fix left no orphaned/invalid state).

All fixes were verified live (before/after HTTP reproduction) and via
two independent negative-control cycles (one per test suite), confirming
both suites are non-vacuous.

## 9. Known Gaps

- The `user_id` 404-vs-403 distinction (Part 4) is an intentional,
  pre-existing, codebase-wide convention, not remediated here — it leaks
  no data, only existence of a user id, matching the same pattern already
  present in other routes (e.g. `GET /api/users/:id`). Unifying this
  convention network-wide would be a cross-cutting change well beyond
  this stage's scope (RBAC simulator confidentiality only) and is left
  as a potential future hardening item if the project ever decides to
  standardize on existence-hiding for all id lookups.
- No frontend changes were made or required; `RBACTestConsoleView.tsx`
  already only ever supplies ids sourced from its own scoped `GET
  /options` dropdowns, so the fix is effective purely server-side.

## 10. Commit Hash

See git log — this document is committed together with the code and test
changes it describes.

## 11. Git Status / Remote Status

Working tree clean after commit; pushed to
`origin/claude/boom-os-constitution-w1d7zs`. Local HEAD verified to match
remote HEAD after push.
