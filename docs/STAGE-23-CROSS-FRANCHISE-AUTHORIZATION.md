# STAGE 23 — CROSS-FRANCHISE USER AUTHORIZATION & AUTHORIZATION SEMANTICS AUDIT

Constitution reference: §8 (OWNER → FRANCHISE → BRANCH → EMPLOYEES), §9 (RBAC),
§42–§43 (security; the frontend is not a security mechanism), §49–§52 (testing and runtime
verification), §55 (no false PASS), §60 (data integrity and security first).

Continues from Stage 22 and closes the semantics it left open. No router rewritten, no
second authorization system, OWNER/SUPER_ADMIN semantics unchanged, GENERAL_MANAGER
unchanged.

## AUDIT

### Effective scope

`getFullUserProfile()` runs inside `authenticateToken` on **every** request, so
`allowedBranchIds` is read from `user_branch_access` per request and never carried in the
JWT. Revocation is therefore structurally immediate, and the suite proves it rather than
assuming it.

### The franchise contract, restated

`canUserAccessFranchise(user, franchiseId)` is a **membership gate**: a non-superuser passes
if they hold *any* branch of that franchise. Stage 22 established that passing the gate must
not become row-level access to every branch, and `GET /api/franchises` and
`GET /:id/branches` are the reference implementations. Stage 23 tested that contract against
the case Stage 22 did not have: a user holding branches in **two different franchises**.

### The gap Stage 22's fix did not close

Stage 22 guarded branch re-parenting with "franchise gate on the target **and** the branch
inside the caller's scope". A cross-franchise user satisfies both by construction — they
hold the branch, and they hold a branch of the target franchise — so they could still move a
branch between franchises. This was found by execution, not by reading.

## CROSS-FRANCHISE RESULTS (Part 1)

Topology: Franchise A = { A1, A2 }, Franchise B = { B1, B2 }. Every branch was built fully
operational — menu, inventory, dining area and table, waiter with a POS session, a real
order taken to READY through the KDS, an operator POS lock, a cash shift and a completed
payment — so the direct-object probes act on rows that genuinely exist.

Subject **U**: non-superuser holding **A1 + B1**, one branch in each franchise, carrying a
purpose-built role with 34 operational and franchise permissions so that no refusal can be
attributed to a missing permission.

**No defects were found in Part 1.** U reaches both of its branches across two franchises
(42 in-scope accesses, including writes) and is refused A2 and B2 in every form tested:

- query `branch_id`, body `branch_id` and path `branchId`;
- direct object ids for orders, cash shifts and X-reports, employees, employee status,
  employee status history, employee branch-access, employee KPI, menu items, KDS tickets and
  payments;
- writes: confirm a foreign order, advance a foreign KDS ticket, refund a foreign payment,
  close a foreign shift, suspend a foreign employee, edit and delete a foreign menu item,
  update and delete a foreign branch, reconfigure a foreign service charge, open a shift,
  lock the POS, create a KPI rule, move stock, and widen a foreign employee's scope;
- list endpoints (`/api/branches`, `/api/users`, `/api/employees`, implicit inventory,
  implicit orders) carry exactly A1 and B1 and never A2 or B2.

The critical property holds: **holding one branch of a franchise granted no access to its
sibling branch.** A2 is in the same franchise as A1, B2 in the same franchise as B1, and both
were refused throughout.

## FRANCHISE AGGREGATION RESULTS (Part 2)

U passes **both** franchise gates, because it holds a branch in each. Row-level subresources
remained correctly scoped:

| Endpoint | Result for U |
| --- | --- |
| `GET /api/franchises` | both franchises listed — correct, U holds a branch in each |
| `GET /franchises/A` and `/franchises/B` | 200 — gate passes by membership |
| `GET /franchises/A/branches` | A1 only; A2 absent |
| `GET /franchises/B/branches` | B1 only; B2 absent |
| `GET /franchises/A/employees` | A1 staff only; A2 staff absent |
| `GET /franchises/B/employees` | B1 staff only; B2 staff absent |
| Cross-contamination | neither franchise view carried the other franchise's rows |

Aggregate endpoints (`GET /:id`, `/:id/overview`) return counts for the whole franchise once
the gate is passed. Per the task's instruction not to change semantics merely to satisfy a
test, this was left unchanged: these are aggregates rather than records, the behaviour is the
existing product model, and altering it would change what the number means for a legitimate
franchise member. It is carried forward as a documented decision, not as a fix.

One semantics observation, asserted as the existing contract rather than relabelled a
vulnerability: **a member of a franchise holding `franchises.update` may edit that
franchise's metadata**, even if they hold only one of its branches. U renamed Franchise A and
this is by design under the Stage 22 gate. A non-member was refused the same operation with
403. Whether a partial member should be able to rename the whole franchise is a product
decision, recorded under KNOWN GAPS.

## /FRANCHISES/:ID/ORDERS STATUS

**Classification: (A) intentionally unimplemented.** The evidence is explicit and was not
inferred:

- the handler carries the comment `// Pure integration interface: NO fake orders`;
- it returns `connected: false` with `"Orders module not connected yet. Real-time POS bridge pending."`;
- `franchises.ts` contains **zero** `FROM orders` queries;
- it is routed and gated by `canUserAccessFranchise`, so it is not dead code.

This is a deliberate refusal to fabricate data, consistent with the project's empty-baseline
stance. **No orders implementation was invented.** What the suite proves is only the
authorization gate — a member reaches the stub, a non-member is refused 403 — and it asserts
that the response still declares itself unconnected with an empty `orders` array, for
superusers too.

**Branch/franchise scoping of real order rows is NOT proven and is not reported as passing.**
The static guard fails deliberately if `connected: false` is removed or if the handler starts
reading order rows, so scoping must be proven before this endpoint can ship data.

## GENERAL_MANAGER SEMANTICS

Four sources were read before drawing any conclusion.

| Source | What it says |
| --- | --- |
| Constitution §9 | Base roles are OWNER, SUPER_ADMIN, BRANCH_MANAGER, MANAGER, WAITER, CASHIER, KITCHEN, BAR. **GENERAL_MANAGER is not listed at all** |
| `server/seed.ts` | "Network-wide operational manager supervising all branch operations and personnel" |
| `server/auth.ts` | `isSuperUser` = OWNER or SUPER_ADMIN only; GENERAL_MANAGER resolves scope from `user_branch_access` like any scoped role |
| Routes | One reference: `waiters.ts` `hasManagementRole()` groups it with BRANCH_MANAGER for waiter-code management — a *capability* check, still branch-scoped |
| `docs/STAGE-2-WAITER-POS-DESIGN.md` | "Code management … is **branch-scoped**. Seeded authority: OWNER, SUPER_ADMIN, GENERAL_MANAGER and BRANCH_MANAGER" |
| `docs/STAGE-11-EMPTY-BASELINE.md` | "OWNER assigns the manager a system role (for example `BRANCH_MANAGER` or `GENERAL_MANAGER`) **and branch access**" |

**Verdict: this is stale seed prose, not an authorization defect.** Two project documents
state that GENERAL_MANAGER is assigned branch access and operates branch-scoped, which is
exactly what the code does. The seed's sentence describes the role's organizational meaning,
and reading it as a superuser grant would contradict both documents and the Constitution,
which does not define the role at all. **Behaviour was left unchanged.**

The decision that must be taken later, stated precisely so it is not rediscovered:

> If the business wants a GENERAL_MANAGER to see the whole network, the correct mechanism in
> the existing model is to grant that user access to all branches (`user_branch_access`, or
> `has_all_access` applied by a superuser). It must **not** be done by adding GENERAL_MANAGER
> to `isSuperUser`, which would also bypass every permission check, not just branch scope —
> `requirePermission` returns early for superusers.

## VULNERABILITIES

One defect, found by execution and reproduced before fixing:

| Endpoint | Class | Impact |
| --- | --- | --- |
| `POST /franchises/:id/branches/:branchId` (and `DELETE`) | Tenant-structure manipulation by a non-superuser | A user holding branches in two franchises satisfied both Stage 22 conditions and moved **Branch A1 out of Franchise A into Franchise B**. Confirmed in the database and in the audit log (`BRANCH_ASSIGNED_TO_FRANCHISE` by a non-superuser), and it broke the subject's own franchise-A access as a side effect |

This is a restructuring of the tenant hierarchy, not an operation inside a branch.

## FIXES

One change, matching invariant 4 exactly:

- `POST` and `DELETE /franchises/:id/branches/:branchId` now require **superuser semantics**.
  Holding the branch and holding a branch of the target franchise is demonstrably not
  sufficient. The response code is `FRANCHISE_STRUCTURE_SUPERUSER_ONLY` with HTTP 403.

This is strictly stronger than the Stage 22 guard it replaces, so the Stage 22 static test
was updated to assert the superseding rule rather than the weaker one. No other behaviour was
altered, and superusers can still re-parent branches — asserted positively in the suite.

## REGRESSION TESTS

- `tests/stage23_cross_franchise_e2e.mjs` — the runtime proof. Four fully operational
  branches across two franchises, a cross-franchise subject, a non-member subject and the
  OWNER. `npm run test:e2e:crossfranchise`.
- `tests/stage23_authorization_invariants_static.mjs` — 16 source assertions covering the
  seven invariants, including that `isSuperUser` still resolves to exactly OWNER and
  SUPER_ADMIN and that GENERAL_MANAGER has not been folded into it. Folded into
  `npm run test:static`.

### The seven invariants, each exercised at runtime

| # | Invariant | How it is proven |
| --- | --- | --- |
| I1 | Effective scope is the intersection of the user's branches and the resource's branch | Direct object ids in both directions: in-scope objects return 2xx, out-of-scope objects 403, for orders, shifts, employees, KPI, menu, KDS and payments |
| I2 | Franchise membership grants no row-level access to sibling branches | A2 and B2 refused throughout while their franchises are admitted; `/franchises/:id/branches` and `/employees` show only the held branch |
| I3 | A user can never grant itself a branch outside its scope | Self-grant of A2, of B2, `has_all_access`, primary-branch move and widening another user all refused; scope re-read afterwards and unchanged |
| I4 | A branch cannot be moved between franchises without superuser semantics | Four re-parenting attempts refused 403; topology re-read as OWNER and intact; a superuser move still succeeds |
| I5 | Removing a branch removes API access immediately | After narrowing U to A1, the next request for B1 returned 403 on branch, menu, order-by-id and the franchise-B subresource, with no re-login, and the franchise-B gate closed |
| I6 | A user with branches in different franchises keeps exactly those branches | 42 in-scope accesses across A1 and B1; every list endpoint carries both and neither sibling |
| I7 | OWNER/SUPER_ADMIN semantics unchanged | Superuser reads of A2, B2, both franchises' employees, a foreign order and a foreign X-report asserted to succeed |

The run reports which invariants were exercised and fails if any of the seven was never
reached, so the set cannot silently shrink.

### Non-vacuity

33 existence proofs, 42 asserted in-scope accesses (a deny-everything regression would fail),
a control probe, and post-conditions re-reading both the user's scope and the franchise
topology. **Two vacuous assertions in this stage's own suite were caught and corrected**, and
are recorded rather than quietly fixed:

- `U deletes franchise B` was refused with **400**, a business rule ("franchise not empty"),
  not a franchise decision. The probe was moved to a **non-member** actor, where it is a
  genuine 403.
- `U renames franchise A` was written as a denial but is **allowed by the existing contract**
  — U is a member of franchise A. Rather than changing the code to make the test pass, the
  expectation was corrected and the semantics question recorded.

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
| `stage23_cross_franchise_e2e.mjs` | **PASS (33 proofs, 42 in-scope, 1 control, 87 denials, 7 privileged, 7/7 invariants)** |

`tsc --noEmit` 0 errors · `npm run build` PASS · `prisma validate` valid ·
`npm run test:static` 25 suites PASS. Every out-of-scope refusal returns 403; the
franchise↔branch topology is intact and the audit log shows branch re-parenting only by the
superuser.

Docker was not retried: Stage 20 established that Docker Hub's blob CDN is refused by the
environment's egress policy, which no code change can affect.

## KNOWN GAPS

- **Franchise aggregates remain unscoped.** `GET /:id` and `/:id/overview` report counts for
  the whole franchise to any member. Deliberately unchanged. A member holding one branch can
  infer the size of the rest of its franchise — not its contents.
- **Franchise metadata may be edited by any member** holding `franchises.update`, including
  one who holds a single branch of a multi-branch franchise. This follows the Stage 22 gate
  and is asserted as the current contract. Decision needed: restrict to superusers, or to
  members holding every branch of the franchise, or leave as is.
  **RESOLVED IN STAGE 24**: determined to be a scope-mismatch privilege-escalation defect
  (the action's blast radius — every branch and employee of the franchise — exceeds the
  actor's proven authority of one branch) and restricted to superuser semantics, the same
  boundary this stage already applied to branch re-parenting. Two further unguarded paths to
  branch re-parenting were found in `server/routes/branches.ts` (`PUT /:id` and `POST /`) and
  fixed the same way. See `docs/STAGE-24-FRANCHISE-GOVERNANCE-AUTHORIZATION.md`.
- **Branch re-parenting is now superuser-only**, a deliberate narrowing. A franchise partner
  with `franchises.update` can no longer attach or detach branches at all.
- **`/franchises/:id/orders` is unimplemented.** Authorization is verified; scoping is
  unproven and must be established when the module is connected.
- **GENERAL_MANAGER** left unchanged; the decision is stated above.
- **Not covered:** a user whose branches span three or more franchises, franchise-level
  isolation for promotions/CRM/BOOMCARD (not implemented), and the frontend. Three-franchise
  isolation was proven in Stage 24, which also found and fixed the two additional
  re-parenting paths noted above.
