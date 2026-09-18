# Stage 34 — Recipe Engine + Food Cost + Inventory Economic Control

## What was implemented

Closed the economic chain **MENU → RECIPE → INGREDIENTS → INVENTORY → ORDER → PAYMENT →
CONSUMPTION → FOOD COST → MARGIN → VARIANCE** entirely on top of the existing Recipe/Inventory/
Order Core/Payment/Refund implementation. No second inventory system, no second recipe system, no
second financial calculation was created.

- **Recipe versioning.** `recipes` gained a `version` column. Editing a recipe now inserts a new
  version and deactivates the previous one in the same transaction (`POST
  /api/inventory/recipes/:id/versions`) instead of mutating history. `PUT
  /api/inventory/recipes/:id/status` activates/retires a recipe without creating a version. `GET
  /api/inventory/recipes/:menuItemId/versions` lists full history.
- **Ingredient costing.** `inventory_items` gained `average_cost` (moving weighted average),
  maintained incrementally inside the *existing* `POST /api/inventory/purchases/:id/receive`
  transaction: `new_avg = (old_stock*old_avg + received_qty*received_cost) / (old_stock+received_qty)`,
  computed entirely in Postgres `NUMERIC` — verified against the textbook example (100kg@0.02 +
  100kg@0.03 → 0.0250).
- **Historical snapshot.** `order_items` gained two nullable columns,
  `recipe_version_snapshot`/`recipe_cost_snapshot`, populated inside the *existing*
  `consumeInventoryForOrder()` (payments.ts) at the moment of payment. A later recipe edit never
  changes an already-sold order's recorded version or cost — proven end-to-end in the E2E test: an
  order sold under recipe v1 still reports v1/its original cost after the recipe was changed to v2.
- **Consumption** is unchanged in its core formula (`ingredient_qty × order_item_qty ÷ yield_qty`,
  still inside the same payment transaction, still idempotent via the pre-existing
  `stock_movements` unique constraint); it now additionally records the cost snapshot and the
  `unit_cost` on the `SALE` stock movement (matching the existing convention already used for
  `PURCHASE` movements).
- **Refund restoration was already correct and needed no change**: `restoreInventoryForOrder()`
  reverses the literal `SALE` stock-movement quantities it finds for that order, never re-deriving
  from the *current* recipe. Verified: selling under v1 (150g), changing the recipe to v2 (170g),
  then refunding the v1 sale restores exactly the original 150g/unit — never the new recipe's
  quantity.
- **Inventory counts** (`POST/GET /api/inventory/counts`, new `InventoryCount` table): a controlled
  physical count records `theoretical_quantity` (the system stock at count time), `counted_quantity`
  and `delta`, applies the delta through the same `ADJUSTMENT` stock-movement ledger every other
  manual movement uses (never a silent direct stock write), and is audited.
- **Food Cost reporting** (new `server/routes/food-cost.ts`, gated by new `food_cost.view`):
  - `GET /menu-items` — every active menu item with its current recipe's cost, food-cost %, gross
    margin, version, ingredient count.
  - `GET /menu-items/:id` — full recipe detail with per-ingredient line costs.
  - `GET /ingredients` — ingredient economics: stock, unit cost, inventory value, today's
    consumption, and which active recipes/menu items each ingredient affects (the low-stock →
    affected-recipes integration).
  - `GET /profitability` — period sales revenue (real `order_items.subtotal` on `COMPLETED`
    orders), theoretical cost (`SUM(recipe_cost_snapshot)` — the historical cost, not a
    recalculation), gross margin. Credit sales are included as revenue (Stage 31 semantics: a
    credit sale is a sale); credit repayments never appear here because profitability reads
    `order_items`/`orders`, not `credit_transactions`.
  - `GET /valuation` — total and per-ingredient inventory value (`current_stock × average_cost`).
- **Frontend**: one new `FoodCostView` (Menu Items / Ingredients / Profitability / Inventory
  Counts tabs), with inline recipe creation, new-version editing and version history, wired into
  Sidebar/App.tsx as `foodCost`, gated by `food_cost.view`.

## Money and quantity precision

No `Float` anywhere in the new code. Quantities and unit costs (both `DECIMAL(14,4)` in the
schema) are handled as BigInt "ten-thousandths" throughout (`scaled4`/`fromScaled4` in both
`payments.ts` and `food-cost.ts`); money compared against the 2-decimal menu price is converted to
BigInt cents only at that boundary. Percentages are computed as `(numerator * 10000) /
denominator`, formatted with 2 decimals — no floating-point division anywhere.

## Unit convention (documented, not changed)

The existing consumption formula has always assumed a recipe ingredient's `quantity` is expressed
in the *same unit* the ingredient's `inventory_items.unit` is tracked in (e.g. if Beef is tracked
in grams, a recipe entry of `150` means 150g). No unit-conversion table exists or was added; this
is the pre-existing, intentional simplicity of the system, preserved as-is.

## RBAC / security

- One new permission, `food_cost.view`, granted to the same manager role set as
  `dashboard.view`/`operations.view` (Owner, Super Admin, General Manager, Branch Manager).
- Recipe and inventory-count mutations reuse the existing `inventory.manage` permission — no
  redundant `recipe.manage` permission was added.
- Every food-cost route enforces branch authorization via the existing `allowed(req, branchId)`
  helper; every recipe/count mutation route does the same. Verified in E2E: a Branch B manager is
  denied on Branch A's food-cost reports, recipe versions and inventory counts.
- All recipe mutations (`RECIPE_CREATED`, `RECIPE_VERSION_CREATED`, `RECIPE_ACTIVATED`/
  `RECIPE_DEACTIVATED`) and inventory counts (`INVENTORY_COUNT_RECORDED`) are audited via the
  existing `insertAuditLog`.

## Database

One additive migration
(`prisma/migrations/20260918190945_stage34_recipe_versioning_food_cost`): two new columns on
`inventory_items`/`order_items` each, one new column plus a widened unique constraint on
`recipes` (from `(branch_id, menu_item_id)` to `(branch_id, menu_item_id, version)` — the only
non-purely-additive change, required for versioning to be possible at all; no data was dropped),
and one new table (`inventory_counts`). Validated with `prisma validate` before and after.

## Tests

- `tests/stage34_food_cost_static.mjs` — 42 checks (no duplicate models/routes, versioning never
  mutates history, weighted-average formula, BigInt-only money math, consumption/refund symmetry
  preserved, inventory counts ledger-backed and audited, profitability semantics, RBAC/branch
  isolation, minimal new permissions, frontend wiring).
- `tests/stage34_food_cost_e2e.mjs` — 28 real DB post-conditions on a fresh database: weighted
  average costing, recipe cost / food-cost % / gross margin, real sale consumption with correct
  quantity multiplication, ledger entry with the correct `unit_cost`, recipe version change,
  **historical snapshot proven unchanged after the recipe changed**, **refund restoring the exact
  historical quantity, not the new recipe's**, profitability (credit sale included, refunded order
  excluded), ingredient/valuation reports, inventory count and its audit entry, RBAC and branch
  isolation denials.
- Both suites verified against a negative control (implementation removed/stashed, tests confirmed
  to fail for the right reason, then restored).
- Regression: Stage 29, 30, 31, 32, 33 E2E suites re-run clean. Two prior stages' static tests
  (32, 33) had an assertion generalized (not weakened) because it hard-coded the exact end of a
  role-permission-list literal that this stage legitimately extends with `food_cost.view`.

## Known intentional limitations

- **Modifier consumption was not implemented.** `MenuModifier` has no ingredient/inventory mapping
  in the existing schema (confirmed by inspection before writing any code); inventing one would
  violate the "no fake data" rule. If modifiers ever need inventory impact, that mapping should be
  added as its own additive step.
- **No unit-conversion framework.** As documented above, this preserves the existing convention
  rather than introducing a new one.
- Inventory counts are not idempotency-keyed like payments. A retried count call is still safe (a
  duplicate submission with the same counted value simply computes a zero delta and is a no-op on
  stock), but this is a low-frequency, manager-only action, not a POS flow under retry pressure,
  so a full `Idempotency-Key` mechanism was judged unnecessary scope.
- Stage 32/33 dashboards were intentionally left untouched; the low-stock → affected-recipes
  integration (section 22) is served by the new `/food-cost/ingredients` report's
  `affected_recipes` field rather than by modifying Stage 33's already-tested alert engine.

## Commit

`72b69d1`
