// BOOM OS -- Stage 38: modifier recipe consumption and historical cost.
//
// Source guards for what the runtime suite cannot pin: that consumption stayed ONE pipeline,
// that no parallel recipe/inventory/consumption system was created, that the historical snapshot
// mirrors the mechanism Stage 34 already established, and that internal cost never reaches a
// customer-facing surface. The behavioural proof is tests/stage38_modifier_consumption_e2e.mjs.
import fs from 'node:fs';
const read = p => fs.readFileSync(p, 'utf8');

const schema = read('prisma/schema.prisma');
const migration = read('prisma/migrations/20260924000000_stage38_modifier_cost/migration.sql');
const payments = read('server/routes/payments.ts');
const orders = read('server/routes/orders.ts');
const menu = read('server/routes/menu.ts');
const publicMenu = read('server/routes/public-menu.ts');
const inventory = read('server/routes/inventory.ts');
const foodCost = read('server/routes/food-cost.ts');
const analytics = read('server/routes/analytics.ts');
const closure = read('server/order-closure.ts');

const checks = [
  // ------------------------------------------------- A. no parallel engine
  ['NO parallel modifier inventory/consumption/stock system was created',
    !fs.existsSync('server/routes/modifier-inventory.ts') && !fs.existsSync('server/modifier-consumption.ts') &&
    !/model\s+Modifier(Inventory|Stock|Consumption)/i.test(schema) &&
    !/modifier_inventory|modifier_stock|modifier_consumption/i.test(schema + payments + inventory)],
  ['there is still exactly ONE consumption function, and it is still the one payments calls',
    (payments.match(/async function consumeInventoryForOrder\(/g) || []).length === 1 &&
    (payments.match(/await consumeInventoryForOrder\(/g) || []).length === 1],
  ['consumption still writes to the EXISTING stock_movements ledger with the EXISTING SALE type',
    payments.includes("'SALE', required,") && payments.includes("'ORDER', orderId, 'Consumed by paid order'")],
  ['no ingredient quantity is hardcoded -- every requirement comes from recipe_ingredients',
    payments.includes('FROM recipe_ingredients WHERE recipe_id=?') && !/quantity:\s*['"]?\d+['"]?\s*\/\/\s*modifier/i.test(payments)],

  // ------------------------------------------------- B. modifier -> source item -> recipe
  ['a chosen component is resolved through Stage 37\'s source_menu_item_id, joined from the real option row',
    /JOIN menu_modifiers mm ON mm\.id=oim\.modifier_id/.test(payments) && payments.includes('mm.source_menu_item_id')],
  ['the recipe is resolved by the SAME helper used for the base dish, branch-scoped',
    payments.includes('const activeRecipe =') && /FROM recipes WHERE branch_id=\? AND menu_item_id=\? AND active=true/.test(payments) &&
    (payments.match(/activeRecipe\(tx, branchId,/g) || []).length === 2],
  ['an option with no source item consumes nothing (a plain "no onion" is not a recipe)',
    payments.includes('if (!mod.source_menu_item_id) continue;')],
  ['the documented MISSING-RECIPE rule is the SAME one BOOM OS already applies to a dish: consume nothing, leave the cost snapshot null',
    payments.includes('if (!recipe) continue;') && /MISSING RECIPE -- the explicit rule/.test(payments) &&
    /units_without_recipe_cost/.test(foodCost)],

  // ------------------------------------------------- C. correctness of the aggregation
  ['requirements are AGGREGATED per inventory item before anything is written',
    payments.includes('const totals = new Map<string, bigint>()') && /pass 1: resolve every requirement, WITHOUT touching stock/.test(payments)],
  ['each ingredient is locked once, in a deterministic order, and only then decremented',
    /\[\.\.\.totals\.keys\(\)\]\.sort\(\)/.test(payments) && /FOR UPDATE/.test(payments)],
  ['exactly one SALE movement is written per ingredient per order, and the ON CONFLICT clause is kept for the retry case',
    (payments.match(/INSERT INTO stock_movements/g) || []).length === 1 &&
    payments.includes('ON CONFLICT (branch_id,reference_type,reference_id,inventory_item_id,type) DO NOTHING')],
  ['the reason the aggregation exists is recorded in source, so it is not undone by accident',
    /ledger recorded it once/.test(payments)],
  ['order quantity AND component quantity both scale the requirement',
    /Number\(orderItem\.quantity\) \* Math\.max\(1, Number\(mod\.quantity\)/.test(payments)],
  ['the insufficient-stock and missing-item guards still run before any write',
    payments.includes("new Error('INSUFFICIENT_STOCK')") && payments.includes("new Error('INVENTORY_ITEM_NOT_FOUND')")],
  ['no Float arithmetic entered the consumption path -- scaling stays in SQL DECIMAL and BigInt',
    !/parseFloat|Number\([^)]*quantity[^)]*\)\s*[*/+-]\s*Number/.test(payments.split('async function consumeInventoryForOrder')[1] || '')],

  // ------------------------------------------------- D. historical snapshot
  ['the component cost snapshot mirrors the pair order_items has carried since Stage 34',
    /recipe_version_snapshot Int\?/.test(schema) && /recipe_cost_snapshot\s+Decimal\? @db\.Decimal\(14,4\)/.test(schema) &&
    (schema.match(/recipe_cost_snapshot/g) || []).length >= 2],
  ['the migration is additive only', /ADD COLUMN "recipe_version_snapshot"/.test(migration) && /ADD COLUMN "recipe_cost_snapshot"/.test(migration) &&
    !/DROP\s+(TABLE|COLUMN|CONSTRAINT)/i.test(migration) && !/ALTER COLUMN/i.test(migration)],
  ['both snapshots are written at consumption time, priced at the cost just consumed at',
    payments.includes('UPDATE order_item_modifiers SET recipe_version_snapshot=?,recipe_cost_snapshot=') &&
    payments.includes('UPDATE order_items SET recipe_version_snapshot=?,recipe_cost_snapshot=')],
  ['the line total still carries the WHOLE internal cost, so every Stage 34 query keeps working unchanged',
    /order_items\.recipe_cost_snapshot remains the line's TOTAL internal cost/.test(payments) &&
    /COALESCE\(SUM\(oi\.recipe_cost_snapshot\),0\)/.test(foodCost) && /COALESCE\(SUM\(oi\.recipe_cost_snapshot\),0\)/.test(analytics)],
  ['a line that consumed nothing still leaves its snapshot NULL, exactly as before',
    payments.includes('if (!base && extra === 0n) continue;')],
  ['the Recipe Engine still versions rather than mutates, which is what makes the snapshot meaningful',
    /never mutates the previous active row/.test(inventory) && /const newVersion=current\.version\+1/.test(inventory)],

  // ------------------------------------------------- E. the 4-decimal cost defect Stage 38 found
  ['the profitability report no longer folds a 4-decimal cost sum through a 2-decimal parser',
    foodCost.includes('const costCents = scaled4ToCents(scaled4(r.theoretical_cost));') &&
    !/const costCents = moneyCents\(r\.theoretical_cost\)/.test(foodCost)],
  ['the fix is explained where it was made, and analytics already used the same 4-decimal path',
    /Stage 38 fix: theoretical_cost is SUM\(\)/.test(foodCost) && /function cost4ToCents/.test(analytics)],

  // ------------------------------------------------- F. archived source items
  ['a component whose source dish is archived is refused for a NEW order, with its own code',
    orders.includes("code:'MODIFIER_SOURCE_UNAVAILABLE'") && /m\.source_status!=='ACTIVE'\|\|m\.source_deleted_at/.test(orders)],
  ['the same rule also removes it from the surfaces that OFFER it',
    /src\.status='ACTIVE' AND src\.deleted_at IS NULL/.test(publicMenu) && /src\.status='ACTIVE' AND src\.deleted_at IS NULL/.test(menu)],
  ['history is protected by the existing SET NULL semantics, not by keeping archived rows selectable',
    /onDelete: SetNull/.test(schema) && /Historical orders are untouched/.test(orders)],

  // ------------------------------------------------- G. lifecycle: split bill, refund, closure
  ['consumption still happens ONCE per order, when the last separate check settles',
    /never once per bill, which would consume stock N times/.test(payments) && payments.includes('if(!stillOpen){')],
  ['a refund still does not restore ingredients -- the Stage 34.1 rule is untouched',
    /Refunding money is[\s\S]{0,40}not returning ingredients/.test(payments) &&
    !/async function restoreInventoryForOrder/.test(payments)],
  ['the product decision on a closure is still the existing approved treatment, with its own movements',
    /applyInventoryTreatment/.test(closure) && /'WASTE'/.test(closure) && /'RETURN'/.test(closure)],
  ['Stage 38 invented no new movement type', !/'MODIFIER_[A-Z_]+'/.test(payments)],

  // ------------------------------------------------- H. internal cost never reaches a guest
  ['no public or device route selects a cost, recipe or stock column',
    ![publicMenu].some(f => /average_cost|recipe_cost|unit_cost|theoretical_cost|current_stock/i.test(f)) &&
    !/average_cost|recipe_cost|current_stock/i.test(menu.split("router.use(authenticateToken)")[0])],
  ['the selling price and the internal cost are separate columns on the same row, and only one is public',
    /price_delta_snapshot\s+Decimal\s+@db\.Decimal\(12,2\)/.test(schema) &&
    /price_delta_snapshot above is the SELLING price/.test(schema)],

  // ------------------------------------------------- I. RBAC / branch scope unchanged
  ['consumption remains server-side only -- no route lets a client write a stock movement directly',
    !/router\.(post|put|patch)\([^)]*stock-movements/i.test(inventory)],
  ['recipe and inventory writes still require the existing inventory.manage permission',
    /router\.post\('\/recipes', requirePermission\('inventory\.manage'\)/.test(inventory) &&
    /router\.post\('\/items', requirePermission\('inventory\.manage'\)/.test(inventory)],
  ['a recipe can still only be attached to a menu item inside its own branch',
    /FROM menu_items WHERE id=\? AND \(branch_id=\? OR branch_id IS NULL\)/.test(inventory)],
  ['a component can still only be sourced from a dish inside its own branch',
    menu.includes('if (src.branch_id && src.branch_id !== branchId) return false;')],

  // ------------------------------------------------- J. docs + tests
  ['the stage report exists', fs.existsSync('docs/STAGE-38-REPORT.md')],
  ['the report documents the missing-recipe rule explicitly',
    fs.existsSync('docs/STAGE-38-REPORT.md') && /missing[- ]recipe/i.test(read('docs/STAGE-38-REPORT.md'))],
  ['the Stage 38 runtime test exists', fs.existsSync('tests/stage38_modifier_consumption_e2e.mjs')],
];

let ok = 0;
for (const [name, v] of checks) { console.log(`${v ? 'PASS' : 'FAIL'} ${name}`); if (v) ok++; }
console.log(`${ok}/${checks.length} PASS`);
if (ok !== checks.length) process.exit(1);
