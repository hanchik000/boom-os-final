# STAGE 21 — MULTI-BRANCH ISOLATION

Constitution reference: §8 (branch isolation), §9 (RBAC), §35 (manager control),
§42–§43 (security; the frontend is not a security mechanism), §49–§52 (testing and runtime
verification), §55 (no false PASS), §60 (data integrity and security before UX).

Continues from Stage 20. No new business feature, no router rewritten, no second
authorization system, no stack change.

## AUDIT

Branch scope is resolved once, in `server/auth.ts`, and carried on `req.user`:

- `isSuperUser` = OWNER or SUPER_ADMIN → `allowedBranchIds` = every ACTIVE branch.
- everyone else → rows in `user_branch_access`, plus their own `users.branch_id`.

Routes then enforce it through one of three consistent devices: the `requireBranchAccess`
middleware, a local `allowed(req, branchId)` helper, or `scopedBranch(req, branchId)`.
Waiter POS routes scope on `session.branch_id` instead, which is stronger: the branch comes
from the session, never from the request.

Every route taking an `:id` parameter was enumerated and checked for whether it validates
the *loaded object's* branch, since filtering a list by `branch_id` says nothing about
direct object access. Two passes were needed: the first flagged `branches.ts` and
`orders.ts` handlers that are in fact guarded by middleware or by `session.branch_id`, which
is why every candidate below was confirmed by running it rather than by reading alone.

Findings by category:

- **Correctly guarded:** menu, orders, payments, cash shifts, KDS, inventory, tables,
  service charge, KPI, print, operator POS, waiters, employees, and `users` GET/PUT `/:id`.
- **Globally scoped by design, not a branch concern:** `roles` and `system_settings` carry
  no `branch_id` in the Prisma schema. Confirmed against the schema, not assumed.
- **Privileged by design:** OWNER and SUPER_ADMIN reach every branch. This is the documented
  model and is asserted positively in the suite so it is never mistaken for a defect.
- **Franchise endpoints** (`/api/franchises/:id/orders`, `/:id/employees`, `/:id/overview`)
  aggregate across the branches of a franchise and carry no per-branch filter. No seeded
  role except the superusers holds `franchises.*`, so this is not exploitable today. It is
  recorded under KNOWN GAPS rather than fixed, because franchise-level aggregation is a
  different isolation axis and narrowing it is a product decision.
- **Unguarded and exploitable:** five handlers in `server/routes/users.ts`, listed below.

## VULNERABILITIES FOUND

All five were reproduced against a live server before any code was changed, by a
BRANCH_MANAGER of branch A acting on branch B. BRANCH_MANAGER carries 38 permissions
including the whole operational set, so every result below is a *branch* decision and not a
missing permission.

| # | Endpoint | Class | Impact |
| --- | --- | --- | --- |
| 1 | `GET /api/users/:id/status` | IDOR / BOLA read | Employment and disciplinary status, name, email and join date of any employee in any branch |
| 2 | `GET /api/users/:id/status-history` | IDOR / BOLA read | Full employment history plus identity of any employee in any branch |
| 3 | `PUT /api/users/:id/status` | IDOR / BOLA **write** | Suspend or terminate another branch's employee. Reproduced: manager A set branch B's waiter to SUSPENDED, persisted and audit-logged |
| 4 | `GET /api/users/:id/branch-access` | IDOR / BOLA read | Branch assignments and branch details of a foreign branch's manager |
| 5 | `PUT /api/users/:id/branch-access` | **Privilege escalation** | No authorization on the target or on the requested branches. A branch manager could set their own `allowed_branch_ids` to any branch, or `has_all_access: true`, defeating isolation entirely |

Number 5 is the most serious: it is the boundary itself, so a single call would have
converted a branch-scoped manager into an effectively network-wide one.

Two latent inconsistencies were also closed: `DELETE /api/users/:id` and
`DELETE /api/branches/:id` had no branch check while their sibling routes did. Neither is
exploitable with the seeded roles (no seeded non-superuser role holds `users.delete` or
`branches.delete`), but permissions are assignable, so both were fixed.

## FIXES

Minimum change, reusing the existing RBAC and branch model:

- `server/routes/users.ts` gains one local helper, `denyIfForeignBranch(req, res, target)`,
  which reproduces exactly the check `GET /:id` and `PUT /:id` already performed — including
  the superuser and self exemptions and the existing "user belongs to an unauthorized
  branch" 403 — so every employee-scoped route denies identically instead of each route
  re-deriving the rule or omitting it. It is applied at six call sites: `GET /:id/status`,
  `PUT /:id/status`, `GET /:id/status-history`, `GET /:id/branch-access`,
  `PUT /:id/branch-access` and `DELETE /:id`.
- `PUT /:id/branch-access` additionally refuses, for non-superusers, any `has_all_access`
  and any `primary_branch_id` or `allowed_branch_ids` outside the caller's own scope, using
  the same wording and shape `POST /` and `PUT /:id` in the same file already use.
- `server/routes/branches.ts` `DELETE /:id` now carries `requireBranchAccess(req => req.params.id)`,
  matching `GET /:id` and `PUT /:id`.

No router was rewritten, no middleware stack was reordered, and no new authorization concept
was introduced.

## REGRESSION TESTS

- `tests/stage21_branch_isolation_e2e.mjs` — the runtime proof. Builds two real branches,
  each with its own menu, inventory, tables, waiter, order, KDS ticket, cash shift, payment,
  KPI rule and service-charge config, plus one BRANCH_MANAGER scoped to each, and asserts the
  full matrix in both directions.
- `tests/stage21_branch_isolation_static.mjs` — nine cheap source assertions that the guards
  and the escalation checks are still present, folded into `npm run test:static`.

Both are registered: `npm run test:isolation` and `npm run test:e2e:isolation`.

### How the suite avoids a vacuous PASS

This mattered more than the fixes. Three devices are used:

1. **Existence proofs (21).** Before any denial is asserted, the same resource is fetched as
   OWNER and must return 2xx. A 403/404 can therefore never be credited to a row that does
   not exist.
2. **Control probes (8).** Each refusal that returns 400 rather than 403 is mirrored by the
   identical request against the actor's *own* branch, which must succeed. This proves the
   refusal is a branch decision and not incidental payload validation.
3. **Post-condition checks.** After the escalation attempts, manager A's stored scope is
   re-read and branch B is re-requested, so a silently-accepted escalation cannot hide.

Two genuinely vacuous assertions were found and corrected while building the suite, and are
recorded here rather than quietly fixed:

- The employee-status probe first sent `employment_status: 'ARCHIVED'`, which is not in the
  accepted list, so it was refused with a validation 400 that *looked* like isolation. With
  a valid `SUSPENDED` the endpoint returned 200 and the cross-branch write was exposed. This
  single mistake had been hiding the most damaging defect of the five.
- The escalation probe first sent `branch_ids`, which the endpoint ignores, so it reported a
  200 no-op. With the real field names (`allowed_branch_ids`, `has_all_access`,
  `primary_branch_id`) it became a genuine escalation attempt.

## RUNTIME E2E RESULTS

Against the production bundle (`NODE_ENV=production`, `node dist/server.cjs`) on PostgreSQL 16,
each suite on a freshly created database with migrations applied.

| Suite | Before the fixes | After |
| --- | --- | --- |
| `stage21_branch_isolation_e2e.mjs` | **9 failures / 5 distinct defects** | PASS — 21 existence proofs, 8 control probes, 63 denials, 4 privileged reads |
| `stage18_8_full_runtime.mjs` | PASS | PASS |
| `stage19_core_flow_e2e.mjs` | PASS | PASS |
| `stage20_operations_runtime_e2e.mjs` | PASS (45 checks) | PASS (45 checks) |

`tsc --noEmit` 0 errors · `npm run build` PASS · `prisma validate` valid ·
`prisma migrate deploy` 19 migrations · `npm run test:static` 21 suites PASS.

Every escalation attempt now answers 403, and the database confirms each manager still holds
exactly one branch.

## RBAC MATRIX

Read from the seeded database, not from the seed source.

| Role | Permissions | Branch scope |
| --- | --- | --- |
| OWNER | 62 | **All ACTIVE branches — by design** |
| SUPER_ADMIN | 62 | **All ACTIVE branches — by design** |
| BRANCH_MANAGER | 38 | `user_branch_access` + own `branch_id` |
| GENERAL_MANAGER | 30 | `user_branch_access` + own `branch_id` |
| CASHIER | 8 | `user_branch_access` + own `branch_id` |
| HR | 7 | `user_branch_access` + own `branch_id` |
| WAITER | 5 | Waiter POS session branch |
| ACCOUNTANT | 3 | `user_branch_access` + own `branch_id` |
| COURIER / KITCHEN / MARKETING | 0 | no permissions seeded |

GENERAL_MANAGER is described in the seed as network-wide but is **not** a superuser: it is
still limited to its assigned branches. That is the code's actual behaviour; if network-wide
reach is intended for it, that is a product decision, not a defect, and it is listed under
KNOWN GAPS.

## BRANCH ISOLATION MATRIX

Branch-scoped manager acting on the other branch. Every row was executed in both directions
where applicable; "403" means refused with `BRANCH_ACCESS_DENIED`.

| Area | Read foreign | Write / mutate foreign |
| --- | --- | --- |
| Branch record | 403 | 403 update, 403 delete |
| Menu (list, item, category) | 403 | 403 create into foreign, 404 update, 404 delete |
| Orders (by id and by query) | 403 | 403 confirm |
| Payments | 403 | 403 refund |
| Cash shifts, X-report | 403 | 403 open, 403 Z-report |
| Inventory items, movements, recipes, suppliers | 403 | 403 create, 403 stock movement |
| Tables | 403 | 400 create (branch-driven, control-probed) |
| KDS | 403 | 403 advance ticket |
| Service charge config and ledger | 403 | 403 reconfigure |
| KPI rules and employee KPI | 403 | 403 create rule, 400 evaluate (branch-driven, control-probed) |
| Employees / users | 403 | 403 update, 403 status change, 403 delete |
| Employee status history | 403 | — |
| Waiter qualification and codes | 403 | 403 set status, 403 issue code, 403 revoke code |
| Branch access (escalation) | 403 | 403 self-grant, 403 grant-all, 403 move primary, 403 grant other |
| Operator POS lock | — | 403 |
| Print profiles | 403 | — |
| Guessed / non-existent ids | 404 | — |
| Implicit branch (no `branch_id` supplied) | own branch only, no foreign ids leaked | — |
| List endpoints (users, employees, branches, audit, waiters) | no foreign ids present | — |

Menu update and delete answer 404 rather than 403. That is the pre-existing contract of
`scopedBranch` — it refuses to confirm that a foreign object exists — and it does not leak
data, so it was left unchanged.

## KNOWN GAPS

- **Franchise aggregation.** ADDRESSED IN STAGE 22, and the description below was imprecise:
  these endpoints *are* gated by `canUserAccessFranchise`, which the Stage 21 source scan
  missed. Stage 22 found the real defect — the gate admits a caller holding any one branch of
  the franchise, after which `/:id/employees` returned every employee of every branch — and
  fixed it along with missing gates on the franchise mutations. See
  `docs/STAGE-22-TENANT-FRANCHISE-ISOLATION.md`. Original note: `/api/franchises/:id/orders`,
  `/:id/employees` and `/:id/overview` are not branch-filtered. Not exploitable with the
  seeded roles, since only superusers hold `franchises.*`.
- **GENERAL_MANAGER** is documented as network-wide but behaves as branch-scoped. Unchanged
  deliberately; changing it would widen access.
- **Some branch refusals are 400, not 403** (`create table`, `evaluate KPI`, `create menu
  item` in a foreign branch). They are genuine branch decisions — proven by control probes —
  but report as `VALIDATION_ERROR`. Harmonising them to 403 would change existing response
  codes, so it is left for an explicit decision.
- **Not covered by this stage:** franchise-to-franchise isolation, branch isolation of
  promotions/CRM/BOOMCARD (not implemented), the frontend, and multi-branch users holding
  access to two branches at once (only single-branch managers were exercised). Franchise
  isolation and multi-branch users were both covered in Stage 22.
- The audit list was checked for absence of foreign ids, not for a complete per-branch audit
  contract.
