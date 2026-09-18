# STAGE 22 — ADVANCED TENANT / FRANCHISE ISOLATION

Constitution reference: §6–§8 (organization, franchise, branch hierarchy), §9 (RBAC),
§42–§43 (security; the frontend is not a security mechanism), §49–§52 (testing and runtime
verification), §55 (no false PASS), §60 (data integrity and security first).

Continues from Stage 21 and closes the two gaps it recorded: users holding several branches,
and franchise-level isolation. No router was rewritten, no second authorization system was
introduced, and the privilege model was not changed.

## AUDIT

### Data model

`Franchise` has exactly one relation: `Branch[]`. There is **no** `franchise_id` on `User`
and no `user_franchise_access` table — verified against `prisma/schema.prisma`, not assumed.
A user's reach into a franchise is therefore derivable only from the branches they hold, and
`server/routes/franchises.ts` implements precisely that:

```
canUserAccessFranchise(user, franchiseId)
  = user.isSuperUser || any branch of that franchise is in user.allowedBranchIds
```

This helper explicitly handles non-superusers, so the intended model is that a branch-scoped
user may legitimately hold franchise permissions. That is what made the tests below
meaningful rather than theoretical.

**Correction to Stage 21.** Stage 21 recorded the franchise endpoints as "not branch-filtered"
based on a source scan whose pattern did not include `canUserAccessFranchise`. That was
imprecise: the read endpoints *are* gated. The real defect is narrower and is stated below.

### Authorization shape found

| Route | Franchise gate | Rows scoped to held branches |
| --- | --- | --- |
| `GET /api/franchises` | n/a | **yes** — filtered by `allowedBranchIds` |
| `GET /:id/branches` | yes | **yes** — the reference implementation |
| `GET /:id` | yes | aggregates only |
| `GET /:id/overview` | yes | aggregates only |
| `GET /:id/orders` | yes | returns an empty stub; the module is not connected |
| `GET /:id/employees` | yes | **no — defect** |
| `PUT /:id` | **no — defect** | — |
| `PATCH /:id/status` | **no — defect** | — |
| `DELETE /:id` | **no — defect** | — |
| `POST /:id/branches/:branchId` | **no — defect** | **no — defect** |
| `DELETE /:id/branches/:branchId` | **no — defect** | **no — defect** |

`GET /` and `GET /:id/branches` establish the intended contract: gate on the franchise, then
scope the returned rows. The defects are deviations from that same contract, so every fix
below restates it rather than inventing anything.

### Session semantics

`getFullUserProfile()` runs inside `authenticateToken` on **every** request, so
`allowedBranchIds` is recomputed per request and never cached in the JWT. Revocation is
therefore expected to be immediate, and this is asserted rather than assumed.

### GENERAL_MANAGER

The seed describes it as "network-wide operational manager", but `server/auth.ts` grants
superuser status only to OWNER and SUPER_ADMIN, so GENERAL_MANAGER is branch-scoped in code.
The instruction was not to expand it without an explicit specification requirement. The
conflict is between a seed *description* and code *behaviour*; behaviour was left unchanged
and the conflict is recorded under KNOWN GAPS.

## MULTI-BRANCH RESULTS (Part A)

Topology: Franchise A = { A1, A2 }, Franchise B = { B1, B2 }, each branch populated with its
own menu, inventory and staff. Actors: a user scoped to **A1+A2**, one scoped to **A1 only**,
one with **no branch access**, and the OWNER.

**No defects were found in Part A.** Everything asserted held on the first run:

- The A1+A2 user reads and writes both of its branches: branches, menu, inventory, orders,
  KDS, cash shifts, payments, employees, employee status, KPI rules, service charge, and a
  successful menu-item write into A2 (28 in-scope accesses confirmed).
- The same user is refused branch B1 in every form tested: query `branch_id`, body
  `branch_id`, direct object ids (employee, employee status, status history, employee KPI,
  menu item), and object-level writes (edit and delete a foreign menu item, suspend a foreign
  employee, update and delete a foreign branch, open a shift, lock the POS, reconfigure
  service charge).
- Lists contain both held branches and never the others: branches, users, employees, and the
  implicit (no `branch_id`) inventory list.
- The single-branch user reaches A1 and is refused A2 — proving the multi-branch grant is
  what widened access, not the franchise.
- The no-branch user is refused everywhere and its branch list is empty.
- The OWNER reaches every branch — asserted positively so global access is never mistaken
  for a defect.
- **Revocation is immediate.** After the OWNER narrowed the A1+A2 user to A1, the very next
  request for A2 returned 403, on `/api/branches/:id` and on `/api/menu` alike, with no
  re-login. A1 continued to work.
- A multi-branch user cannot widen its own scope: self-granting a third branch,
  `has_all_access`, moving its primary branch, and widening another user are all refused,
  while re-asserting branches inside its own scope still works (control probe). The Stage 21
  fix holds for multi-branch holders, which was the specific question asked.

## FRANCHISE RESULTS (Part B)

A dedicated non-system role (`FRANCHISE_PARTNER_*`) was created through the API holding
`franchises.view/update/delete` plus `users.view`, `employees.view`, `branches.view`, and
assigned to a user scoped to **A1 only**. That user passes the Franchise A gate (it holds one
of its branches) and must fail the Franchise B gate.

`franchises.delete` was granted deliberately: without it the delete probe would have been
refused for a *missing permission*, which proves nothing about franchise isolation. This is
exactly the class of false denial the task warned against.

Working correctly before any change: the franchise list is filtered, Franchise B is refused
for read, overview, employees, branches and orders, and `GET /:id/branches` already scoped
its rows to the held branch.

## VULNERABILITIES FOUND

All reproduced against a live server before any code changed. 12 assertion failures across 6
distinct defects:

| # | Endpoint | Class | Impact |
| --- | --- | --- | --- |
| 1 | `GET /franchises/:id/employees` | Cross-branch read inside a franchise | Gated on holding *one* branch, then returned every employee of *every* branch of the franchise with PII, roles and full branch-access lists. A holder of A1 read A2's staff |
| 2 | `PUT /franchises/:id` | Missing franchise gate | Renamed a franchise the caller has no branch in — reproduced, Franchise B was renamed |
| 3 | `PATCH /franchises/:id/status` | Missing franchise gate | Deactivated a foreign franchise — reproduced, Franchise B set to INACTIVE |
| 4 | `DELETE /franchises/:id` | Missing franchise gate | Archive a foreign franchise |
| 5 | `POST /franchises/:id/branches/:branchId` | Missing gate **and** missing branch check | Attach **any** branch to **any** franchise. Reproduced three ways: a foreign-franchise branch pulled into the caller's franchise, an unheld same-franchise branch, and the caller's own branch pushed into the foreign franchise |
| 6 | `DELETE /franchises/:id/branches/:branchId` | Missing gate and branch check | Detach a branch the caller does not hold |

Number 5 is the most serious. It is a topology attack rather than a read: pulling a foreign
branch into a franchise the attacker can see would, combined with defect 1, have exposed that
branch's employees. The run confirmed the corruption — B1 ended up inside Franchise A and A1
inside Franchise B.

Exploitability with the shipped seed is nil, because no seeded role except the superusers
holds `franchises.*`. These are latent defects that become live the moment that permission is
granted to a scoped role — which the presence of `canUserAccessFranchise` shows is intended.

## FIXES

Minimum change, restating the contract the file already implements twice:

- **`GET /:id/employees`** now scopes its rows to `allowedBranchIds` for non-superusers,
  exactly as `GET /:id/branches` does, and returns an empty list when the caller holds no
  branches. Superusers are unaffected.
- **`PUT /:id`, `PATCH /:id/status`, `DELETE /:id`** now call the existing
  `canUserAccessFranchise` gate.
- **`POST` and `DELETE /:id/branches/:branchId`** now require both the franchise gate and
  that the branch is inside the caller's `allowedBranchIds`, answering `BRANCH_ACCESS_DENIED`
  otherwise.

No new helper, no new middleware, no change to `canUserAccessFranchise`, and no change to
OWNER/SUPER_ADMIN semantics.

## REGRESSION TESTS

- `tests/stage22_tenant_isolation_e2e.mjs` — two franchises of two branches each, four actor
  types, Part A and Part B in one run. `npm run test:e2e:tenant`.
- `tests/stage22_tenant_isolation_static.mjs` — 18 source assertions that each franchise route
  keeps its gate, that row-returning routes keep their scoping, and that attach/detach keep
  the branch check. Folded into `npm run test:static`.

Non-vacuity, carried over from Stage 21 and extended:

1. **Existence proofs (14).** Before any denial, the OWNER must reach the same object, and
   for franchises the suite additionally proves the object really belongs where claimed —
   that A2's staff member is genuinely returned by Franchise A's employee list, and that
   Franchise A genuinely contains both A1 and A2.
2. **In-scope assertions (28).** Every permitted access is asserted to succeed, so a fix that
   simply denied everything would fail the suite.
3. **Post-condition on topology.** After the attach/detach attacks, the franchise↔branch
   mapping is re-read as OWNER and must be unchanged. This is what caught defect 5's damage.
4. **Permission-axis separation.** `franchises.delete` was granted to the test role so the
   delete denial is a franchise decision; separately, a plain branch manager without franchise
   permissions is asserted to be refused, keeping the two axes distinct.

## RUNTIME E2E

Against the production bundle (`NODE_ENV=production`, `node dist/server.cjs`) on
PostgreSQL 16, each suite on a freshly created database with migrations applied.

| Suite | Before | After |
| --- | --- | --- |
| `stage22_tenant_isolation_e2e.mjs` | **12 failures / 6 defects** (Part A clean, Part B failing) | PASS — 14 existence proofs, 28 in-scope, 1 control, 53 denials, 8 privileged |
| `stage21_branch_isolation_e2e.mjs` | PASS | PASS |
| `stage20_operations_runtime_e2e.mjs` | PASS (45) | PASS (45) |
| `stage19_core_flow_e2e.mjs` | PASS | PASS |
| `stage18_8_full_runtime.mjs` | PASS | PASS |

`tsc --noEmit` 0 errors · `npm run build` PASS · `prisma validate` valid ·
`npm run test:static` 23 suites PASS. Every franchise denial returns 403; the
franchise↔branch topology is byte-for-byte intact after all attack attempts.

## AUTHORIZATION MATRIX

Franchise A = { A1, A2 }, Franchise B = { B1, B2 }.

| Actor | A1 | A2 | B1 / B2 | Franchise A | Franchise B |
| --- | --- | --- | --- | --- | --- |
| OWNER / SUPER_ADMIN | full | full | full | full | full — **by design** |
| User scoped A1+A2 | full | full | 403 | rows limited to A1+A2 | 403 |
| User scoped A1 | full | 403 | 403 | rows limited to A1 | 403 |
| User with no branches | 403 | 403 | 403 | empty list | 403 |
| Franchise partner scoped A1 | full | 403 | 403 | gate passes; branches and employees limited to A1; mutations allowed only for A1 | 403 on read, overview, employees, branches, orders, rename, status, delete, attach, detach |
| Branch manager without `franchises.*` | full | — | 403 | 403 (permission axis) | 403 (permission axis) |

Self-service scope widening is refused for every non-superuser actor, including multi-branch
holders: self-grant, grant-all, primary-branch move, and widening another user.

## KNOWN GAPS

- **Franchise-level aggregates are not scoped.** `GET /:id` and `GET /:id/overview` return
  counts (branches, employees, revenue placeholders) for the whole franchise once the gate is
  passed. These are aggregates, not records, and scoping them would change what the number
  means for a legitimate franchise partner. Left unchanged deliberately, since the task was
  explicit about not altering intended semantics. A holder of one branch can therefore infer
  the size of the rest of its own franchise — not its contents.
- **Attaching the first branch to an empty franchise** is now impossible for a non-superuser,
  because `canUserAccessFranchise` cannot pass on a franchise with no branches. Superusers,
  who create franchises, are unaffected. This is the safe direction but it is a narrowing.
- **GENERAL_MANAGER** remains branch-scoped in code while the seed describes it as
  network-wide. Not changed; expanding it would widen access.
- **`GET /:id/orders`** returns an empty stub (`connected: false`), so franchise order
  isolation could not be exercised against real rows and is unproven for the eventual
  implementation.
- **Not covered:** franchise isolation for promotions/CRM/BOOMCARD (not implemented), the
  frontend, and a user holding branches across *two different franchises* simultaneously.
