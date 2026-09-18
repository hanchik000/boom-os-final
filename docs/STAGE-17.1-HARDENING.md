# Stage 17.1 — History & Service Charge Hardening

## Fixed
- Prisma schema now declares MenuItem.deleted_at and MenuCategory.deleted_at, matching the Stage 17 database migration.
- Menu reads exclude archived records.
- Added soft-delete endpoints for menu items/categories; historical orders retain snapshots.
- Order item removal recalculates DINE_IN service charge from the branch Service Charge configuration before falling back to the legacy system setting.

## Verification
- Stage 17 static acceptance remains required.
- Runtime PostgreSQL validation remains NOT VERIFIED until dependencies and a live database are available.
