# Stage 17 — Staff Qualification, Service Charge, KPI, Operator Lock and Print Foundation

Implemented on top of Stage 16.1.

## Added
- Historical-safe menu archive fields (`deleted_at`) without physical deletion.
- Waiter qualification status: `TRIAL` / `PROFESSIONAL`, private to manager/owner permissions.
- Service Charge configuration per branch with allocation rules for individual employees or departments.
- Service Charge ledger; trial waiters are excluded from waiter allocations.
- KPI rules and immutable KPI ledger for threshold/fixed/percentage rewards.
- Operator POS lock/unlock foundation using the authenticated employee password.
- Receipt/print profiles and audited print jobs/reprints.
- Server order calculation now prefers branch Service Charge configuration and falls back to the legacy system setting.

## Important verification state
Static source tests from Stage 13–16.1 still pass after these changes. Full Prisma validation, generation, TypeScript compilation, live PostgreSQL migration and E2E remain NOT VERIFIED in this environment.

## Smart Search
The Stage 16.1 archive contains no Smart Search implementation or complete concrete specification. No speculative Smart Search behavior was invented in Stage 17. It remains an explicit audit/implementation item once the authoritative specification is available.
