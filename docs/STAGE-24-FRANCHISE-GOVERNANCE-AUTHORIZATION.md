# STAGE 24 — FRANCHISE GOVERNANCE AUTHORIZATION & 3+ FRANCHISE ISOLATION AUDIT

Constitution reference: §8 (OWNER → FRANCHISE → BRANCH → EMPLOYEES), §9 (RBAC),
§37 (critical operations: branch changes, employee permissions), §42–§43 (security; the
frontend is not a security mechanism), §49–§52 (testing and runtime verification),
§55 (no false PASS), §60 (data integrity and security first).

Continues from Stage 23 (`f798961`) and resolves the open decision it explicitly deferred:
whether a franchise member holding `franchises.update` should be able to mutate that
franchise's shared metadata. No router was rewritten, no second authorization system was
introduced, OWNER/SUPER_ADMIN semantics are unchanged, and GENERAL_MANAGER was not touched.

## AUDIT

### Part A — franchise mutation endpoints

Every franchise-level and branch-level mutation was read end to end (not just its
permission decorator) and classified by what it actually changes:

| Endpoint | Permission | Franchise check (before) | Branch scope check | Superuser check | Blast radius |
| --- | --- | --- | --- | --- | --- |
| `PUT /api/franchises/:id` | `franchises.update` | `canUserAccessFranchise` (membership) | none | none | entire franchise: name, code, contact info, **and `status`** |
| `PATCH /api/franchises/:id/status` | `franchises.update` | `canUserAccessFranchise` (membership) | none | none | entire franchise's `status` |
| `DELETE /api/franchises/:id` | `franchises.delete` | `canUserAccessFranchise` (membership) | none | none | entire franchise (soft delete), guarded only by a dependency check |
| `POST /franchises/:id/branches/:branchId` | `franchises.update` | superuser-only (Stage 23) | superuser-only (Stage 23) | yes (Stage 23) | moves one branch's franchise membership |
| `DELETE /franchises/:id/branches/:branchId` | `franchises.update` | superuser-only (Stage 23) | superuser-only (Stage 23) | yes (Stage 23) | same |
| **`PUT /api/branches/:id`** | `branches.update` | **none** | `requireBranchAccess` (the branch being edited only) | **none** | can silently carry a `franchise_id` field — re-parents the branch |
| **`POST /api/branches`** | `branches.create` | **none** | **none** | **none** | can carry `franchise_id` at creation, and creation auto-grants the creator `user_branch_access` on the new branch |

Two rows in bold were **not** covered by Stage 23's fix, because Stage 23 only touched the
dedicated attach/detach endpoints. `branches.ts` implements the identical operation
(assigning a branch's `franchise_id`) through two more code paths that had no franchise
check, no superuser check, and in the `PUT` case only checked access to the branch being
edited — not the destination franchise.

`requireBranchAccess` on `PUT /api/branches/:id` proves the caller holds *this* branch. It
proves nothing about the franchise the caller is trying to move it into. This is the same
scope-mismatch class Stage 23 found and fixed on the dedicated endpoints, reached through a
different door.

`franchises.create`, `franchises.update`, `franchises.delete`, `branches.create`,
`branches.update` and `branches.delete` are **not granted to any seeded role** — confirmed
by grepping `server/seed.ts` for every `rp_*` grant list, none of which contain these codes.
Exploitability with the shipped seed is nil. All of it becomes live the instant a custom role
is granted these permissions, which the platform explicitly supports (`POST /api/roles` is
itself an assignable action) and which every prior stage's test methodology in this series
has exercised for exactly that reason.

### Determination: this is a scope-mismatch authorization defect, not intentional design

Four sources were checked before concluding, as Stage 23 did for GENERAL_MANAGER:

1. **Constitution §8**: hierarchy is `OWNER → FRANCHISE → BRANCH → EMPLOYEES`. Franchise
   governance sits structurally above branch-level operations, and nothing in the document
   grants franchise authority via mere branch membership.
2. **The pattern already established in this codebase**: Stage 21 fixed employee routes so
   an actor's authority never exceeds the branch they hold; Stage 22 fixed `GET
   /franchises/:id/employees` so passing the franchise gate does not become row-level access
   to every branch; Stage 23 restricted branch re-parenting to superuser semantics for
   exactly this reason — a cross-franchise member satisfied every condition the gate checked
   without being trusted with the whole entity. Franchise governance mutation is the same
   shape of problem: an action whose effect reaches branches and employees the actor does not
   hold, gated only by proof of holding *one* of them.
3. **No code or product decision anywhere states the opposite.** Stage 23's own report
   recorded this exact question as an open KNOWN GAP requiring a decision, rather than
   asserting the permissive behavior was correct.
4. **Nothing operationally depends on the permissive reading.** No seeded role uses it today.

**Verdict: privilege escalation.** A user assigned to exactly one branch of a
multi-branch franchise, if granted `franchises.update` — a permission whose *name* suggests
"can edit this franchise" and says nothing about branch coverage — could rename, suspend, or
(if the franchise happens to have no other active branches) delete a tenant entity governing
branches and staff who never authorized that user to act on their behalf.

## 3+ FRANCHISE RESULTS (Part B)

Topology: Franchise A = { A1, A2 }, Franchise B = { B1, B2 }, Franchise C = { C1, C2 }.
Every one of the six branches was built fully operational — menu, inventory, dining area and
table, a waiter with a POS session, a real order taken through the KDS to READY, an operator
POS lock, a cash shift, and a completed payment — verified directly in PostgreSQL, not
assumed from the setup script's exit code.

Subject **U**: non-superuser holding **A1 + B1 + C1** — exactly one branch in each of the
three franchises — carrying a 33-permission operational-plus-franchise role so no refusal
below can be attributed to a missing permission.

**Points 1–9, 11 (no defects — all held on the first execution after Part A's fixes):**

| # | Requirement | Result |
| --- | --- | --- |
| 1 | U reaches A1/B1/C1 | 49 in-scope accesses confirmed across all three, including writes |
| 2 | U refused A2/B2/C2 | refused in every case tested |
| 3 | One branch of a franchise does not grant its sibling | held for every one of the three franchises independently |
| 4 | Direct object ids cannot bypass scope | refused for orders, payments/refunds, cash shifts/X-reports, employees, employee status/history, employee KPI, menu items, KDS tickets, inventory, branch-access — for every sibling |
| 5 | `branch_id` in query/body/path cannot bypass scope | refused in all three positions, for every write and every read tested |
| 6/7/8 | Franchise A/B/C membership grants nothing in the other two | each franchise's `/branches` and `/employees` subresource, read by U, contains only the branch U holds in that franchise and none of the other five branches |
| 9 | Self-grant remains impossible | self-grant of A2/B2/C2, `has_all_access`, primary-branch move, and widening another user all refused; U's stored scope re-read afterwards and unchanged |
| 11 | OWNER/SUPER_ADMIN unchanged | 10 privileged accesses asserted to succeed, including reads of all three sibling branches and all three franchises' employee lists |

List endpoints (`/api/branches`, `/api/users`, `/api/employees`, implicit inventory,
implicit orders) were read by U and never contained A2, B2 or C2.

**Points 10, 12 — see VULNERABILITIES and FIXES below.** Point 10 (immediate revocation)
held once tested in isolation: narrowing U from three branches to two produced a 403 on the
very next request for the revoked branch — on the branch itself, on its menu, on its order,
and on the franchise gate it was the last branch holding open — with no re-login. Point 12
(no branch re-parenting without superuser) is where Part A's two new findings surfaced.

## VULNERABILITIES FOUND

Two new defects, in addition to confirming the one Stage 23 already fixed still holds under
a three-franchise topology:

| # | Endpoint | Class | Reproduction |
| --- | --- | --- | --- |
| 1 | `PUT /api/franchises/:id`, `PATCH /:id/status`, `DELETE /:id` | Scope-mismatch privilege escalation | A non-superuser holding one branch of a franchise, with `franchises.update`/`.delete`, could rename it, change its `status` to `SUSPENDED`/`INACTIVE`, or delete it — reaching every branch and employee under it, not just the one it holds |
| 2 | `PUT /api/branches/:id` (via a `franchise_id` field in the body) | Second, unguarded path to branch re-parenting | `requireBranchAccess` proves the caller holds the branch being edited; it proves nothing about the destination franchise. A caller holding branch A1, with `branches.update`, could set `franchise_id` to Franchise B and move A1 there without holding any branch of B |
| 3 | `POST /api/branches` (via a `franchise_id` field at creation) | Third, unguarded path — doubles as a self-grant | A caller with `branches.create` could create a brand-new branch pre-assigned to a foreign franchise. Creation auto-grants the creator `user_branch_access` on the branch it just made (`server/routes/branches.ts`, existing behavior, unchanged), so this also silently grants the creator a real foothold inside a franchise they held zero access to — a self-grant that bypasses the branch-access write path entirely |

None are exploitable with the shipped seed (confirmed: `franchises.*`, `branches.create`,
`branches.update`, `branches.delete` are granted to no seeded role). All three become live
the moment a scoped role is granted the corresponding permission, which the platform
explicitly supports and which this stage's own test role does for exactly that reason.

Defect 3 was the most serious found in this series so far: it does not merely expose or
mutate data across a tenant boundary — reproduced without the fix, it would have let an
attacker **create their own membership** inside a franchise they had no relationship to,
entirely outside the branch-access grant path that every other invariant in Stages 21–23
assumed was the only way in.

## FIXES

Minimum change, extending the exact boundary Stage 23 already established for branch
re-parenting to the two remaining paths, plus the new franchise-governance boundary:

- **`server/routes/franchises.ts`** — `PUT /:id`, `PATCH /:id/status`, `DELETE /:id` now
  require `req.user!.isSuperUser`, answering `FRANCHISE_GOVERNANCE_SUPERUSER_ONLY` (403).
  This code is deliberately distinct from Stage 23's `FRANCHISE_STRUCTURE_SUPERUSER_ONLY`:
  governance (acting on the franchise entity) and structure (moving a branch between
  franchises) are different classes of action and stay independently identifiable in logs
  and error handling. Read routes (`GET /:id`, `/:id/overview`, `/:id/orders`,
  `/:id/branches`, `/:id/employees`) are untouched — they remain membership-gated with
  row-level scoping, per Stage 22's established contract.
- **`server/routes/branches.ts`** `PUT /:id` — changing `franchise_id` to a value different
  from the branch's current one now requires superuser, answering
  `FRANCHISE_STRUCTURE_SUPERUSER_ONLY` — the same code Stage 23 used, because it is the same
  operation. A no-op (omitted, or equal to the existing value) is not a re-parent and remains
  allowed for any authorized branch edit.
- **`server/routes/branches.ts`** `POST /` — supplying any `franchise_id` at creation now
  requires superuser, same code. Non-superusers can still create branches; the branch is
  simply created with no franchise until a superuser assigns one.

No other business logic changed. No read endpoint, no list endpoint, no operational route
(orders, payments, inventory, KDS, cash shifts) was touched.

### Regression this required in Stage 23's own suite

Stage 23's test explicitly asserted `mustAllow` for a franchise member renaming their own
franchise, labeled "by contract" — reflecting the Stage 22 contract this stage supersedes.
That assertion was changed to `mustDeny`, with a comment explaining the supersession, rather
than left in place or silently deleted. This is not a case of weakening a test to hide a
regression: the underlying behavior was re-examined on new evidence (Part A's audit) and
determined to be a defect, exactly as the task instructed — "if it is a privilege escalation,
fix the smallest possible authorization boundary … and document the reason," even where that
reverses a prior stage's documented assumption. Stage 22's static guard, which asserted the
franchise-membership gate on these same three routes, was rewritten to assert the superseding
superuser-only rule, using precise verb+path matching (the previous version's path-prefix
match was ambiguous across GET/PUT/DELETE sharing the `/:id` literal — fixed as a side effect
of writing the new assertion correctly).

## REGRESSION TESTS

- **`tests/stage24_three_franchise_isolation_e2e.mjs`** — the runtime proof for both parts.
  Six fully operational branches across three franchises, a triple-franchise subject, an
  outsider subject, and the OWNER. Paces its own requests to stay under the server's
  real 300-req/min-per-IP rate limiter (`basicRateLimiter` in `server.ts`, unmodified) —
  this suite is large enough to hit it, and the fix belongs in the test harness, not in
  relaxing a real production safeguard. `npm run test:e2e:triple`.
- **`tests/stage24_authorization_invariants_static.mjs`** — 16 source assertions, including
  that all three re-parenting paths (`franchises.ts` attach/detach, `branches.ts PUT`,
  `branches.ts POST`) require superuser and share the structural code, that the three
  governance mutations require superuser and share a *distinct* governance code, and that
  `isSuperUser` still resolves to exactly OWNER/SUPER_ADMIN. Folded into `npm run test:static`.
  **Verified non-vacuous by negative control**: reverting the `PUT /:id` governance fix in a
  scratch copy of the file made this guard fail with the expected assertion message; restoring
  the fix made it pass again.
- **`tests/stage22_tenant_isolation_static.mjs`** — rewritten to match verbs to paths exactly
  (`router.VERB('path'`) instead of a path-literal prefix match, which had been silently
  matching GET/PUT/DELETE handlers sharing the same `/:id` literal. Now asserts the
  Stage-24-superseding rule for governance and re-affirms Stage 23's rule for re-parenting.
- **`tests/stage23_cross_franchise_e2e.mjs`** — updated as described above (one assertion
  changed from allow to deny, with the reasoning recorded inline).

### The 8 invariants, all exercised and reported

I1 (effective scope intersection), I2 (no implicit sibling access), I3 (no self-grant), I4
(no unauthorized re-parenting), I5 (immediate revocation), I6 (exact multi-franchise scope),
I7 (superuser unchanged), and **I9** (no unauthorized franchise governance mutation — new
this stage). The suite tracks which invariants were actually reached and fails the run if any
of the eight was never exercised, so the set cannot silently shrink in a future edit.

### Non-vacuity

42 existence proofs (every sibling branch and its order, payment, inventory, KDS ticket, cash
shift and employee proven reachable for OWNER before any denial is asserted against it), 49
in-scope accesses (a deny-everything regression would fail the suite), 2 control probes (a
no-op franchise reassignment on the caller's own branch must still succeed, and re-asserting
one's own three branches must still succeed), and post-conditions that re-read the full
three-franchise topology from PostgreSQL after every mutation attempt — this is what caught
that a naive fix could still leave a foreign branch half-absorbed. Every denial code was
spot-checked to be a genuine 403 (`STAGE24_SHOW_CODES=1`), and the illicit-branch-creation
attempt was independently confirmed absent by querying the database directly, not by trusting
the HTTP response alone. The audit log was read directly and shows every
`BRANCH_ASSIGNED_TO_FRANCHISE` / `FRANCHISE_UPDATED` entry across the whole run attributed to
the superuser actor only.

## FULL E2E RESULTS

Against the production bundle (`NODE_ENV=production`, `node dist/server.cjs`) on
PostgreSQL 16, each suite on a freshly created database with migrations applied.

| Suite | Result |
| --- | --- |
| `stage18_8_full_runtime.mjs` | PASS |
| `stage19_core_flow_e2e.mjs` | PASS |
| `stage20_operations_runtime_e2e.mjs` | PASS (45 checks) |
| `stage21_branch_isolation_e2e.mjs` | PASS (21 proofs, 8 controls, 63 denials, 4 privileged) |
| `stage22_tenant_isolation_e2e.mjs` | PASS (14 proofs, 28 in-scope, 53 denials, 8 privileged) |
| `stage23_cross_franchise_e2e.mjs` | PASS (33 proofs, 41 in-scope, 88 denials, 7 privileged, 7/7 invariants) |
| **`stage24_three_franchise_isolation_e2e.mjs`** | **PASS (42 proofs, 49 in-scope, 2 controls, 133 denials, 10 privileged, 8/8 invariants)** |

`tsc --noEmit` 0 errors · `npm run build` PASS · `prisma validate` valid ·
`npm run test:static` — every static suite in the repository PASS, exit 0.

Docker was not retried: Stage 20 established that the environment's egress policy refuses
Docker Hub's blob CDN, which no code change in this stage touches or affects.

## KNOWN GAPS

- **Franchise aggregates remain unscoped**, unchanged from Stage 23: `GET /:id` and
  `/:id/overview` report whole-franchise counts to any member. This stage did not revisit
  that decision.
- **Branch creation and update are now more restrictive for non-superusers**: a non-superuser
  with `branches.create`/`.update` can still create/edit branches, but can no longer set or
  change `franchise_id` at all. Franchise assignment for a non-superuser must now go through
  a superuser. This is a deliberate narrowing consistent with Stage 23's precedent, not an
  accidental side effect — no seeded role is affected.
- **`franchises.delete`'s dependency check** (blocks deletion while the franchise has active
  branches or employees) is now moot for non-superusers, since they can no longer reach
  `DELETE /:id` at all. It remains in place for superusers and was not altered.
- **`/franchises/:id/orders`** remains an intentionally unimplemented stub (`connected:
  false`), unchanged since Stage 23; its authorization gate was not re-tested in this stage
  since Part 3 was not in this stage's scope.
- **GENERAL_MANAGER** unchanged; Stage 23's determination stands.
- **Not covered**: a user whose branches span four or more franchises (the pattern is now
  proven for two and three; nothing in the fix is franchise-count-dependent, but it was not
  separately exercised beyond three), franchise-level isolation for promotions/CRM/BOOMCARD
  (not implemented), and the frontend.

## COMMIT HASH

This document is committed together with its fixes and tests as a single commit on
`claude/boom-os-constitution-w1d7zs`, continuing from Stage 23's `f798961`. (Embedding this
commit's own hash inside a file it contains is self-referential and was not attempted; the
exact hash is reported in the session transcript and in `git log`.)
