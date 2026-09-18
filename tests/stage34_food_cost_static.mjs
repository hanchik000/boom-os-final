// BOOM OS -- Stage 34: static regression guards for the Recipe Engine + Food Cost + Inventory
// Economic Control stage. Reuses the EXISTING recipes/recipe_ingredients/inventory_items/
// stock_movements/order_items/payments tables and consumption/refund code paths -- these checks
// guard against a second inventory system, a second recipe system, or a second financial
// calculation ever being introduced.
import fs from 'node:fs';
import assert from 'node:assert/strict';

const inventoryTs = fs.readFileSync(new URL('../server/routes/inventory.ts', import.meta.url), 'utf8');
const paymentsTs = fs.readFileSync(new URL('../server/routes/payments.ts', import.meta.url), 'utf8');
const foodCostTs = fs.readFileSync(new URL('../server/routes/food-cost.ts', import.meta.url), 'utf8');
const serverTs = fs.readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
const seedTs = fs.readFileSync(new URL('../server/seed.ts', import.meta.url), 'utf8');
const schema = fs.readFileSync(new URL('../prisma/schema.prisma', import.meta.url), 'utf8');
const apiTs = fs.readFileSync(new URL('../src/api.ts', import.meta.url), 'utf8');
const foodCostView = fs.readFileSync(new URL('../src/components/FoodCostView.tsx', import.meta.url), 'utf8');
const sidebar = fs.readFileSync(new URL('../src/components/Sidebar.tsx', import.meta.url), 'utf8');

let passed = 0;
function check(label, cond) { assert.ok(cond, `FAILED: ${label}`); passed++; }

// --- reuses the EXISTING Recipe/Inventory models, only additive schema changes
check('no second Recipe model was created (still one recipes table)', (schema.match(/^model Recipe \{/m) || []).length === 1);
check('no second InventoryItem model was created', (schema.match(/^model InventoryItem \{/m) || []).length === 1);
check('recipe versioning is additive (a version column on the existing Recipe model, not a new table)', /model Recipe \{[\s\S]{0,500}version\s+Int\s+@default\(1\)/.test(schema));
check('ingredient cost basis is additive (average_cost column on the existing InventoryItem model)', /model InventoryItem \{[\s\S]{0,600}average_cost\s+Decimal\s+@db\.Decimal\(14,4\)/.test(schema));
check('historical snapshot is additive (two nullable columns on the existing OrderItem model)', /recipe_version_snapshot Int\?/.test(schema) && /recipe_cost_snapshot\s+Decimal\? @db\.Decimal\(14,4\)/.test(schema));
check('InventoryCount is a genuinely new, minimal, additive table (not a duplicate of stock_movements)', /model InventoryCount \{/.test(schema) && /theoretical_quantity/.test(schema) && /counted_quantity/.test(schema));

// --- one endpoint surface, mounted once, wired into async error forwarding
check('food-cost router mounted once at /api/food-cost', (serverTs.match(/app\.use\('\/api\/food-cost'/g) || []).length === 1);
check('food-cost router wired into async error forwarding', /operationsRouter, foodCostRouter/.test(serverTs));
check('no duplicate recipe route file was created (recipes still live in inventory.ts)', !fs.existsSync(new URL('../server/routes/recipes.ts', import.meta.url)));

// --- recipe versioning: never mutates history, always inserts a new row
check('creating a recipe version never UPDATEs an existing recipe_ingredients row (ingredients are always freshly inserted for the new version)', !/UPDATE recipe_ingredients/.test(inventoryTs));
check('the previous active recipe is deactivated (not deleted) when a new version is created', /UPDATE recipes SET active=false,updated_at=\? WHERE id=\?/.test(inventoryTs));
check('a new recipe version is a genuinely new row with an incremented version number', /const newVersion=current\.version\+1/.test(inventoryTs));
check('POST /recipes refuses to create a second active recipe for the same menu item (versions endpoint is the edit path)', /RECIPE_ALREADY_EXISTS/.test(inventoryTs));
check('recipe mutations are audited: creation, version creation, activation/deactivation', /RECIPE_CREATED/.test(inventoryTs) && /RECIPE_VERSION_CREATED/.test(inventoryTs) && /RECIPE_ACTIVATED/.test(inventoryTs) && /RECIPE_DEACTIVATED/.test(inventoryTs));

// --- ingredient costing: weighted average, computed in NUMERIC (no Float), on the existing receive path
check('no second purchase-receiving endpoint was created (average_cost is updated inside the existing /purchases/:id/receive)', (inventoryTs.match(/router\.post\('\/purchases\/:id\/receive'/g) || []).length === 1);
check('weighted-average cost formula matches the documented method: (old_stock*old_avg + received_qty*received_cost) / (old_stock+received_qty)', /\(\(CAST\(\? AS DECIMAL\(14,4\)\)\*CAST\(\? AS DECIMAL\(14,4\)\)\)\+\(CAST\(\? AS DECIMAL\(14,4\)\)\*CAST\(\? AS DECIMAL\(14,2\)\)\)\)\/\(CAST\(\? AS DECIMAL\(14,4\)\)\+CAST\(\? AS DECIMAL\(14,4\)\)\)/.test(inventoryTs));
check('average_cost is computed via Postgres NUMERIC, never JS Float, in the purchase receive path', /CAST\(\? AS DECIMAL\(14,4\)\)/.test(inventoryTs) && !/parseFloat/.test(inventoryTs));

// --- recipe/food-cost math: BigInt only, no Float, anywhere in the new money code
check('payments.ts recipe-cost snapshot math uses BigInt scale-4 helpers, not Float', /function scaled4\(v: unknown\): bigint/.test(paymentsTs) && /function fromScaled4\(c: bigint\): string/.test(paymentsTs));
check('food-cost.ts uses BigInt helpers for every ratio (cost, food-cost %, margin), not Float', /function scaled4\(v: unknown\): bigint/.test(foodCostTs) && /function pctString\(numeratorCents: bigint, denominatorCents: bigint\): string \| null/.test(foodCostTs));
check('no Float/Number-based division used to compute a percentage or margin in food-cost.ts', !/Number\([^)]*\)\s*\/\s*Number\(/.test(foodCostTs));
check('food_cost_percent is null (not a divide-by-zero crash or a fabricated value) when price is zero/missing', /if \(priceCents > 0n\) \{/.test(foodCostTs));

// --- consumption: reuses the EXISTING Order Core / payment transaction, no second consumption path
check('consumption still happens inside the existing payments.ts POST / transaction (no new "sale consumption" endpoint)', (paymentsTs.match(/async function consumeInventoryForOrder/g) || []).length === 1);
check('consumption still correctly multiplies recipe ingredient quantity by order item quantity, scaled by yield_qty (unchanged core formula)', /ingredient\.quantity\*.*orderItem\.quantity\*.*recipe\.yield_qty|CAST\(\? AS DECIMAL\(14,4\)\)\*CAST\(\? AS DECIMAL\(14,4\)\)\/NULLIF\(CAST\(\? AS DECIMAL\(14,4\)\),0\)/.test(paymentsTs));
check('each order_item records its own recipe_version_snapshot and recipe_cost_snapshot at the moment of consumption', /UPDATE order_items SET recipe_version_snapshot=\?,recipe_cost_snapshot=CAST\(\? AS numeric\) WHERE id=\?/.test(paymentsTs));
check('SALE stock movements now also carry a unit_cost, consistent with PURCHASE movements', /INSERT INTO stock_movements \(id,branch_id,inventory_item_id,type,quantity,unit_cost,reference_type,reference_id,reason,created_by,created_at\)[\s\S]{0,300}stock\.id,'SALE',required,String\(stock\.average_cost/.test(paymentsTs));

// --- refund / closure: any reversal still uses the literal historical ledger rows, never today's recipe
// Stage 34.1 replaced the unconditional restore-on-refund with an explicitly approved inventory
// decision (server/order-closure.ts). What survives unchanged, and is asserted here, is that a
// reversal or a write-off is always valued from the recorded SALE stock_movements rows -- never
// re-derived from the CURRENT recipe.
const closureTs = fs.readFileSync(new URL('../server/order-closure.ts', import.meta.url), 'utf8');
check('the reversal/write-off reads the literal SALE stock_movements rows for that order', /SELECT inventory_item_id,quantity,unit_cost FROM stock_movements WHERE branch_id=\? AND reference_type='ORDER' AND reference_id=\? AND type='SALE'/.test(closureTs));
check('reversing an already-consumed order never queries the recipes tables (correctness does not depend on today\'s recipe)', (() => { const fn = closureTs.slice(closureTs.indexOf('if (treatment === \'RESTORE_STOCK\')'), closureTs.indexOf('const prod = await productionSnapshot(tx, order.id);')); return !/recipes|recipe_ingredients/.test(fn); })());

// --- inventory counts: controlled, ledger-backed, never a silent direct stock mutation
check('inventory counts apply their delta through the same stock_movements ADJUSTMENT ledger every other manual movement uses', /itemId,'ADJUSTMENT',String\(magRow\.mag\),'INVENTORY_COUNT'/.test(inventoryTs));
check('an inventory count is audited', /INVENTORY_COUNT_RECORDED/.test(inventoryTs));
check('inventory counts require inventory.manage (not a broad new permission)', /router\.post\('\/counts', requirePermission\('inventory\.manage'\)/.test(inventoryTs));

// --- profitability: real paid sales, credit sales included as revenue, credit repayments excluded, refunds excluded
check('profitability revenue comes from COMPLETED orders only (excludes REFUNDED, matches the existing Order Core status)', /o\.status='COMPLETED'/.test(foodCostTs));
check('profitability theoretical cost comes from the historical recipe_cost_snapshot, never a fresh recalculation from the current recipe', /SUM\(oi\.recipe_cost_snapshot\)/.test(foodCostTs));
check('profitability never reads credit_transactions or payments directly (credit sales already flow through order_items/orders like every other method, so repayments cannot leak in)', !/credit_transactions|FROM payments/.test(foodCostTs.slice(foodCostTs.indexOf("router.get('/profitability'"), foodCostTs.indexOf("router.get('/valuation'"))));

// --- RBAC: minimum new permissions, reused where possible
check('food_cost.view permission is seeded', /code: 'food_cost\.view'/.test(seedTs));
// Membership, not the literal end of the list -- later stages legitimately extend it.
check('food_cost.view granted to the same manager role set as operations.view/dashboard.view', (() => { const m = seedTs.match(/const stage17RolePerms = \[([^\]]*)\]/); if (!m) return false; const g = m[1].split(',').map(x => x.trim().replace(/^'|'$/g, '')); return ['dashboard.view', 'operations.view', 'food_cost.view'].every(c => g.includes(c)); })());
check('recipe mutations reuse the existing inventory.manage permission (no redundant recipe.manage permission introduced)', /router\.post\('\/recipes\/:id\/versions', requirePermission\('inventory\.manage'\)/.test(inventoryTs) && !/code: 'recipe\.manage'/.test(seedTs));
check('every food-cost report route requires food_cost.view server-side', (foodCostTs.match(/requirePermission\('food_cost\.view'\)/g) || []).length >= 5);
check('every food-cost route enforces branch authorization via the standard allowed(req,branch) helper, never trusting a frontend branch_id blindly', (foodCostTs.match(/if \(!branchId \|\| !allowed\(req, branchId\)\)/g) || []).length >= 5);

// --- frontend: wired through the existing Sidebar/App/api.ts architecture, RU/TK, no second design system
check('api.ts has exactly one getRecipes method (reused, not duplicated)', (apiTs.match(/getRecipes:/g) || []).length === 1);
check('Sidebar gates the Food Cost nav item behind food_cost.view', /id: 'foodCost', key: 'nav\.foodCost', icon: Scale, permission: 'food_cost\.view'/.test(sidebar));
check('FoodCostView never computes food-cost %/margin client-side (only formats server-returned values)', !/food_cost_percent\s*=\s*\(|gross_margin\s*=\s*price/.test(foodCostView));
check('FoodCostView uses the existing ru ? ... : ... i18n convention, no hardcoded English UI strings', (foodCostView.match(/ru \? '/g) || []).length >= 20);

console.log(`STAGE 34 FOOD COST STATIC: PASS (${passed} checks)`);
