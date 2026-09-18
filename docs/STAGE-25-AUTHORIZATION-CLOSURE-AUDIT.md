# STAGE 25 — AUTHORIZATION CLOSURE AUDIT

Constitution reference: §8 (franchise/branch hierarchy), §9 (RBAC), §36–§37 (audit log,
critical operations), §42–§43 (security; the frontend is not a security mechanism),
§49–§52 (testing and runtime verification), §55 (no false PASS).

Continues from Stage 24 (`d70440c`). Purpose: prove the branch/franchise authorization
fixes from Stages 21–24 cannot be bypassed through an alternative endpoint. No router was
rewritten, no second authorization system was introduced, OWNER/SUPER_ADMIN semantics are
unchanged.

## AUDIT

### Part A/B — every mutation path touching branch/franchise access

Every `POST`/`PUT`/`PATCH`/`DELETE` handler across `server/routes/*.ts` was traced for
writes to `franchise_id`, `branch_id`, `allowed_branch_ids`, `user_branch_access`,
`has_all_access`, or role/permission grants affecting branch access — not by reading route
decorators, but by reading the actual write path each handler takes. No bulk-operation,
import, or admin endpoint exists anywhere in the codebase (confirmed by source search).

| Sink | Guard | Classification |
| --- | --- | --- |
| `franchises.ts` PUT/PATCH/DELETE `:id` | superuser-only (Stage 24) | (B) |
| `franchises.ts` POST/DELETE `:id/branches/:branchId` | superuser-only (Stage 23/24) | (B) |
| `franchises.ts` POST `/` (create) | none, but creates an empty franchise with no branches — no access implication | (D) |
| `branches.ts` POST `/` — `franchise_id` field | superuser-only (Stage 24) | (B) |
| `branches.ts` PUT `/:id` — `franchise_id` field | superuser-only (Stage 24) | (B) |
| `branches.ts` DELETE `/:id` | `requireBranchAccess` (own branch only, no franchise implication) | (A) |
| `users.ts` POST `/` — `allowed_branches` | subset-of-caller-scope check (Stage 21) | (A) |
| `users.ts` PUT `/:id` — `allowed_branches` | subset-of-caller-scope check (Stage 21) | (A) |
| `users.ts` PUT `/:id/branch-access` — `allowed_branch_ids`/`has_all_access`/`primary_branch_id` | subset-of-caller-scope check, `has_all_access` superuser-only (Stage 21/24) | (A) |
| `users.ts` GET `/:id`, `/:id/status`, `/:id/status-history`, `/:id/branch-access`, DELETE `/:id` | `denyIfForeignBranch` (Stage 21) | (A) |
| `employees.ts` POST `/:id/profile` | `canAccessEmployee` (pre-existing) | (A) |
| `roles.ts` POST/PUT — `permission_ids` | orthogonal axis: granting a permission is not granting branch access; `OWNER`/`SUPER_ADMIN` role codes specifically blocked for non-superusers (pre-existing) | (A) |
| Every operational write (`cash-shifts`, `inventory`, `kpi`, `menu`, `tables`, `print`, `operator-pos`) reading `branch_id` from query/body | `allowed(req,b)` / `scopedBranch()` / `branch()` per file, consistently | (A) |
| **`rbac.ts` POST `/test` — `user_id` (any value, no relationship check)** | **none** | **(E) — see VULNERABILITIES** |

`franchises.create/update/delete` and `branches.create/update/delete` are granted to no
seeded role (confirmed against every `rp_*` grant list in `server/seed.ts`), consistent with
every prior stage's finding: latent until a custom role is granted the permission. **This is
the first finding in Stages 21–25 that is exploitable with the shipped, unmodified seed** —
`rbac.test` is granted to `BRANCH_MANAGER` directly.

### Field-name sweep (Part B)

Searched for every variant listed in the task (`branch_id`, `branchId`, `franchise_id`,
`franchiseId`, `branch_ids`, `branchIds`, `allowed_branch_ids`, `allowedBranchIds`,
`franchise_ids`, `franchiseIds`) across every route file. No camelCase or plural body-field
variant exists beyond what the table above already covers; `franchiseId`/`branchId` only
appear as internal variable names or Express path-parameter names (`:branchId`), never as an
alternate body-field spelling that could sidestep a snake_case-only check.

## 3+ FRANCHISE RESULTS

Not repeated in this stage — the three-franchise topology and its 12 points were already
fully proven in Stage 24's E2E suite, re-run unchanged in this stage's TEST RESULTS to
confirm no regression from this stage's fix (see below).

## USER ACCESS ESCALATION (Part C)

Topology: Franchise A = `{A1, A2}`, Franchise B = `{B1, B2}`. Subject **U**: non-superuser
holding **A1 only**, with the **real seeded `BRANCH_MANAGER` role** — not a custom role, to
prove exploitability with the role a real deployment would actually assign — plus a small
purpose-built add-on role granting only `franchises.view`/`.update`, so the franchise-scope
checks test the *scope* axis and not the (already known) permission axis.

Every discovered access-changing path was attempted by U against B1 and against granting
access to a second user (T, holding A2 only) and a third, unrelated user (W, holding B2
only) — proving the denial is not a per-target special case:

- Direct branch-access endpoint: self-grant, `has_all_access`, primary-branch move, granting
  another user (T, and separately W, a stranger U never interacted with before).
- Generic user update (`PUT /users/:id`) reassigning `branch_id` — both on T and on itself.
- Branch creation pre-assigned to a foreign franchise; branch re-parenting via `PUT
  /branches/:id`, both for a branch U holds and one it does not.
- Franchise creation (permission-axis denial: `BRANCH_MANAGER` lacks `franchises.create`)
  and franchise governance mutation (scope-axis denial: U holds `franchises.update` yet is
  still refused, proving Stage 24's fix holds even for a permission-holder).
- Branch attach/detach.
- No bulk operation exists to test (confirmed absent in Part A).
- **The RBAC simulator** — the headline finding, detailed below.

**Every attempt was refused with a genuine 401/403.** The test harness's `mustDenyAuth`
helper explicitly rejects a 400/404/409 as proof — those are not authorization failures and
are not counted, per the task's instruction. **Post-condition**: U's and T's stored
`allowed_branch_ids` were re-read fresh from the server after every attempt and are exactly
`[A1]` and `[A2]` respectively — not merely "the last call failed," but "nothing changed
across the whole sequence."

## TOPOLOGY INVARIANTS (Part D)

All ten proven at runtime, each exercised with a genuine 401/403 or (for #8, #9) with an
explicit before/after state check:

1. Non-superuser cannot move a branch between franchises — including a branch it does not
   even hold (A2).
2. Non-superuser cannot create a branch in an unauthorized franchise.
3. Non-superuser cannot assign a user to an unauthorized branch — via branch-access or via
   generic user update.
4. Non-superuser cannot grant themselves another branch — including one in their *own*
   franchise they don't hold (A2, from U who holds A1).
5. Non-superuser cannot grant another user another branch — tested against a user U had
   never previously interacted with.
6. One branch membership does not expand to sibling branches (A1 → A2 refused, both the
   branch record and its menu).
7. Franchise membership does not expand to another franchise — U (a genuine, permission-
   holding member of franchise A) is refused franchise B's read, its branches, and its
   employees; a positive control confirms U *does* pass its own franchise's gate.
8. Revocation takes effect on the next request. **Corrected methodology mid-build**: a
   user's primary `branch_id` is always implicitly part of their effective scope by design
   (`server/auth.ts`, `getFullUserProfile`), so revoking a user's own primary branch to an
   empty list is not a meaningful test — it was never expected to deny access, and the first
   draft of this check was wrong to expect otherwise. Fixed by testing revocation of a
   *secondary* (non-primary) grant on a dedicated subject, the same pattern already proven
   correct in Stages 21/23/24: access was present before the revocation, denied on the very
   next request after it, with no re-login, while the primary branch remained reachable
   throughout.
9. OWNER/SUPER_ADMIN behavior unchanged — reads of both foreign branches and franchises,
   branch re-parenting, and RBAC simulation of an arbitrary user all remain unrestricted for
   the superuser, asserted positively alongside the denials so global access is never
   mistaken for a defect.
10. All topology/access mutations create the expected audit records. Read `GET /api/audit`
    as OWNER and confirmed, by exact `action` + `entity_id` match against real rows (verified
    non-vacuous: the same check correctly returns `false` for a wrong id or a wrong action),
    that `FRANCHISE_CREATED`, `BRANCH_ASSIGNED_TO_FRANCHISE`, and the branch-access
    revocation/restoration each left the audit trail Constitution §36–§37 require.

## VULNERABILITIES FOUND

One genuine bypass, found in Part A/B and confirmed live before any fix existed:

| Endpoint | Class | Severity |
| --- | --- | --- |
| `POST /api/rbac/test` | Authorization bypass — a second, unscoped door to data Stage 21 explicitly protects | **Exploitable with the shipped seed** (unlike every prior finding in Stages 21–24) |

`POST /api/rbac/test` accepts an arbitrary `user_id` in the request body and, with zero check
that the caller has any relationship to that user, returns their full name, email, active
status, resolved role codes, resolved permission list, and — most sensitively — their
**complete `allowed_branch_ids` array**: the exact branch-access footprint Stage 21's
`denyIfForeignBranch` (in `users.ts`) and `canAccessEmployee` (in `employees.ts`) already
restrict on every direct endpoint.

**Live reproduction, before the fix**: a `BRANCH_MANAGER` of branch A1 (the real, seeded
role — no custom role was created for this reproduction) was correctly refused
`GET /api/users/:id` for a waiter assigned to a completely unrelated branch (403,
`BRANCH_ACCESS_DENIED`). The identical manager, targeting the identical waiter, via
`POST /api/rbac/test` with only `{ user_id: <waiter id> }`, received **200** with the
waiter's full name, email, role, and `allowed_branch_ids` containing the foreign branch,
confirmed `true` by direct comparison.

`rbac.test` is granted to `BRANCH_MANAGER` in `server/seed.ts` unconditionally — this
required no custom role, no elevated permission grant, nothing beyond the stock deployment
a franchise actually ships with. It is a real oracle for enumerating any user's branch
footprint across the entire network by any branch manager, regardless of which branch or
franchise that manager actually manages.

It is a read/disclosure, not a write: calling it does not grant U any actual operational
capability in the foreign branch (no other endpoint's authorization is affected). It is
included as a finding because the task's explicit purpose statement — "prove that the
authorization fixes from Stages 21–24 cannot be bypassed through an alternative endpoint" —
is precisely what this violates, and because a complete branch-access map of every employee
in the network is itself sensitive operational intelligence Stage 21 went out of its way to
protect.

## FIXES

Minimum change, reusing the exact authorization model already established in `users.ts` and
`employees.ts` — not a new one:

- `server/routes/rbac.ts` gains one local helper, `canSimulateUser(caller, targetUserId,
  targetBranchId)`, mirroring `employees.ts`'s `canAccessEmployee` field for field: superuser
  exempt, self exempt, target's primary branch checked against the caller's
  `allowedBranchIds`, then the target's secondary `user_branch_access` grants checked the
  same way. Applied once, immediately after the target user is loaded and before any of
  their role, permission, or branch data is resolved — so a denial short-circuits before any
  of that data is computed, not merely before it is returned.
- Every legitimate use of the tool remains unaffected: simulating oneself, simulating a
  teammate in a branch the caller holds, and superuser simulation of anyone are all
  unchanged (verified live, not merely by code inspection).

No other endpoint in `rbac.ts` was touched. `GET /options` (a dropdown-population helper with
no target-user parameter) was not in scope and carries no equivalent risk.

## REGRESSION TESTS

- `tests/stage25_authorization_closure_e2e.mjs` — the runtime proof for Parts A–D in one run.
  Reproduces the RBAC-simulator bypass against the real seeded `BRANCH_MANAGER` role
  specifically (not a custom role), re-verifies every Stage 21–24 access-changing path live,
  and proves all ten topology invariants including the new audit-record check. Paces its own
  requests under the server's real 300 req/min rate limiter, per the Stage 24 pattern.
  `npm run test:e2e:closure`.
- `tests/stage25_authorization_invariants_static.mjs` — 6 source assertions: the helper
  exists and keeps its exemptions, the gate runs before any target data is resolved (not
  merely before the response is sent), and the refusal is a genuine 403. Folded into
  `npm run test:static`. **Verified non-vacuous by negative control**: reverting the gate in
  a scratch copy of the file made the guard fail with the expected message; restoring it
  made it pass again.

### Two corrections made to the test itself while building it, recorded rather than hidden

- The first draft of invariant #8 (revocation) tried to revoke a user's own primary branch
  to an empty scope and expected denial — this contradicts documented, intentional behavior
  (a user's primary branch is always implicitly in their effective scope), so the assertion
  would have been asserting a defect that isn't one. Rewritten to test a *secondary* grant on
  a dedicated subject, matching the methodology already proven correct in three prior stages.
- Several of invariant #7's franchise-membership checks initially used U with only the seeded
  `BRANCH_MANAGER` role, which does not hold `franchises.view` — meaning the resulting 403s
  were conflating the *permission* axis with the *scope* axis this invariant is meant to
  isolate, exactly the false-positive class the task explicitly warns against. Fixed by
  adding U a small, purpose-built role granting only `franchises.view`/`.update`, so every
  subsequent denial is unambiguously a scope decision.

## TEST RESULTS

Against the production bundle (`NODE_ENV=production`, `node dist/server.cjs`) on
PostgreSQL 16, each suite on a freshly created database with migrations applied.

| Check | Result |
| --- | --- |
| `tsc --noEmit` | 0 errors |
| `npm run build` | PASS |
| `prisma validate` | valid |
| `npm run test:static` (all 25 static suites, including Stage 21–25) | PASS, exit 0 |
| `stage25_authorization_closure_e2e.mjs` | **PASS (3 existence proofs, 5 in-scope, 1 control, 29 genuine 401/403 denials, 5 privileged, 8/8 invariants)** |
| `stage24_three_franchise_isolation_e2e.mjs` (explicitly required by Part F) | PASS (42 proofs, 49 in-scope, 2 controls, 133 denials, 10 privileged, 8/8 invariants) — unchanged, confirming no regression |

Per the task's explicit instruction, Stages 18.8/19/20/21/22/23's E2E suites were **not**
re-run: this stage's only code change is confined to `server/routes/rbac.ts`, a file none of
those suites exercise, and it does not touch `server/auth.ts` or any of `users.ts`/
`branches.ts`/`franchises.ts`, which is what those suites actually cover. Docker was not
retried, per the task's instruction — the environment's egress policy is unrelated to this
stage's code.

Independently confirmed in the database (not only via HTTP status codes): the final
franchise↔branch topology is exactly `{A1,A2}`/`{B1,B2}`, every user's stored
`allowed_branch_ids` matches what the E2E asserted, and every
`BRANCH_ASSIGNED_TO_FRANCHISE`/`FRANCHISE_*` audit entry across the whole run is attributed
to the superuser actor only.

**`tests/stage1_2_acceptance.ts`** (a pre-existing, legacy acceptance script from very early
in the project, predating the "empty by design" baseline established around Stage 11) also
calls `POST /api/rbac/test` directly, four times. It was read, not run: every one of its
calls uses `loginAsOwner()` — a superuser token — so `canSimulateUser`'s superuser exemption
means this stage's fix has no effect on it. It was not executed because it hardcodes
`owner@boomburger.ru`/`Password123!` credentials and fixture ids (`br_sev_03`, `role_owner`)
that do not exist in a freshly bootstrapped, empty-baseline database, is not part of
`test:static` or any suite any prior stage's final verification has run, and resurrecting it
is out of this stage's scope. Recorded here rather than silently skipped.

## KNOWN GAPS

- **`GET /api/rbac/options`** (a dropdown-population helper) was read and confirmed to carry
  no target-user parameter and no equivalent disclosure risk, so it was not modified; it was
  not re-audited beyond that confirmation.
- **Branch/franchise name and code disclosure via the simulator remains.** A caller supplying
  an arbitrary `branch_id`/`franchise_id` they have no access to still receives that entity's
  name and code back in `simulation_params` (used only to explain the hypothetical
  evaluation, not the target user's own data). This is materially lower severity than the
  fixed issue — the caller already supplied the id, so no id-guessing/enumeration value is
  added beyond what the id itself already exposes — and fixing it would touch the
  simulator's core "what if" purpose rather than the confirmed user-data leak. Left
  unfixed and documented, per the task's instruction not to change behavior "merely because
  it is unusual" without a demonstrated bypass of an established contract.
- **`franchises.create`** still creates a franchise with no ownership/membership concept at
  all (an empty franchise belongs to no one until a superuser attaches branches to it).
  Unchanged; not a defect, since it grants no access to anyone.
- **Not covered:** a full field-by-field audit of every endpoint's response payload for
  incidental cross-branch data in nested joins beyond the ones this stage traced (the
  `rbac.test` finding was found by tracing write/read *paths* per the task's Part A/B
  categories, not by diffing every JSON response shape in the codebase).
