# BOOM OS — Phase 3: Organization Management

## Purpose

Phase 3 establishes one canonical operational hierarchy:

`BOOM HQ → Franchise → Branch → Employee`

The hierarchy is represented by the existing PostgreSQL entities `franchises`, `branches`, `users`, `user_branch_access`, `roles`, and `permissions`.

## New read model

- `GET /api/organization/tree` — permission `franchises.view`; returns visible franchises with their visible branches and unassigned branches.
- `GET /api/organization/summary` — permission `franchises.view`; returns scoped counts for franchises, branches, and employees.

This is intentionally a read/aggregation layer. Future POS, CRM, Inventory and Finance modules should reference `franchise_id` and `branch_id`; they must not introduce competing organization trees.

## Access rules

- OWNER and SUPER_ADMIN can see all active branches.
- Other users see only their resolved `allowedBranchIds`.
- A branch belongs to at most one franchise (`branches.franchise_id`).
- An employee has a primary branch plus explicit branch access through `user_branch_access`.
- Soft-deleted franchises remain available for historical integrity and are excluded from the active tree.

## Next phase

Do not add POS or Menu here. The next phase should harden employee/branch assignment transactions and then build the Menu domain on top of this stable hierarchy.
