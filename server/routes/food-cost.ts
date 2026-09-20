import { Router, Request } from 'express';
import { query, queryOne } from '../db';
import { authenticateToken, requirePermission } from '../auth';

const router = Router();
router.use(authenticateToken);

function allowed(req: Request, b: string) { return Boolean(req.user?.isSuperUser || req.user?.allowedBranchIds.includes(b)); }

// Quantities and unit costs both carry up to 4 decimal places in the schema
// (recipe_ingredients.quantity, inventory_items.average_cost); money shown against the menu
// price (2 decimals) is scale2. Every ratio below is BigInt arithmetic -- no Float anywhere in
// this file.
function scaled4(v: unknown): bigint {
  const s = String(v ?? '0').trim();
  if (!/^-?\d+(?:\.\d{1,4})?$/.test(s)) return 0n;
  const neg = s.startsWith('-'); const clean = neg ? s.slice(1) : s;
  const [a, b = ''] = clean.split('.');
  const c = BigInt(a) * 10000n + BigInt((b + '0000').slice(0, 4));
  return neg ? -c : c;
}
function fromScaled4(c: bigint): string { const neg = c < 0n; const abs = neg ? -c : c; return `${neg ? '-' : ''}${abs / 10000n}.${(abs % 10000n).toString().padStart(4, '0')}`; }
function scaled4ToCents(c4: bigint): bigint { return c4 / 100n; } // scale4 -> scale2, truncating
function moneyCents(v: unknown): bigint {
  const s = String(v ?? '0').trim();
  if (!/^-?\d+(?:\.\d{1,2})?$/.test(s)) return 0n;
  const neg = s.startsWith('-'); const clean = neg ? s.slice(1) : s;
  const [a, b = ''] = clean.split('.');
  const c = BigInt(a) * 100n + BigInt((b + '00').slice(0, 2));
  return neg ? -c : c;
}
function centsText(c: bigint): string { const neg = c < 0n; const abs = neg ? -c : c; return `${neg ? '-' : ''}${abs / 100n}.${(abs % 100n).toString().padStart(2, '0')}`; }
// A percentage with 2 decimal places, computed entirely in BigInt (numerator/denominator in
// cents): e.g. pctString(3250n, 10000n) -> "32.50".
function pctString(numeratorCents: bigint, denominatorCents: bigint): string | null {
  if (denominatorCents <= 0n) return null;
  const hundredths = (numeratorCents * 10000n) / denominatorCents; // e.g. 3250 = 32.50%
  const neg = hundredths < 0n; const abs = neg ? -hundredths : hundredths;
  return `${neg ? '-' : ''}${abs / 100n}.${(abs % 100n).toString().padStart(2, '0')}`;
}

// recipe_cost (per yield batch) = SUM(ingredient_qty * ingredient_avg_cost); cost per sold unit =
// recipe_cost / yield_qty. Both computed in scale4 BigInt, then converted to cents for the
// food-cost-%/margin comparison against the (2-decimal) menu price.
function computeRecipeCostPerUnitCents(ingredients: Array<{ quantity: any; average_cost: any }>, yieldQty: any): bigint {
  let totalScaled4 = 0n;
  for (const ing of ingredients) totalScaled4 += (scaled4(ing.quantity) * scaled4(ing.average_cost)) / 10000n;
  const yieldScaled4 = scaled4(yieldQty) || 10000n; // yield_qty defaults to 1 if somehow zero/unparsed
  const perUnitScaled4 = (totalScaled4 * 10000n) / yieldScaled4;
  return scaled4ToCents(perUnitScaled4);
}

async function activeRecipeWithIngredients(branchId: string, menuItemId: string) {
  const recipe = await queryOne<any>('SELECT * FROM recipes WHERE branch_id=? AND menu_item_id=? AND active=true', [branchId, menuItemId]);
  if (!recipe) return null;
  const ingredients = await query<any>('SELECT ri.*,i.sku,i.name,i.unit,i.average_cost FROM recipe_ingredients ri JOIN inventory_items i ON i.id=ri.inventory_item_id WHERE ri.recipe_id=? ORDER BY i.name', [recipe.id]);
  return { recipe, ingredients };
}

// ================================================================================================
// GET /api/food-cost/menu-items -- every active menu item in the branch, with its current
// recipe's server-computed cost, food-cost % and gross margin. Reuses the existing recipes/
// recipe_ingredients/inventory_items tables and the existing menu_items.price as the sole
// authoritative price source -- no invented price, no frontend arithmetic.
// ================================================================================================
router.get('/menu-items', requirePermission('food_cost.view'), async (req, res) => {
  const branchId = String(req.query.branch_id || req.user!.branch_id || '');
  if (!branchId || !allowed(req, branchId)) return res.status(403).json({ error: 'BRANCH_ACCESS_DENIED', code: 'BRANCH_ACCESS_DENIED', message: 'Branch is outside your access scope.', details: {} });
  const categoryId = typeof req.query.category_id === 'string' ? req.query.category_id : null;
  const activeOnly = req.query.active !== 'false';
  const where: string[] = ['(m.branch_id=? OR m.branch_id IS NULL)', 'm.deleted_at IS NULL'];
  const params: any[] = [branchId];
  if (activeOnly) where.push(`m.status='ACTIVE'`);
  if (categoryId) { where.push('m.category_id=?'); params.push(categoryId); }
  const items = await query<any>(`SELECT m.id,m.sku,m.name_ru,m.name_tk,m.price,m.status,m.category_id,c.name_ru AS category_name_ru,c.name_tk AS category_name_tk
    FROM menu_items m LEFT JOIN menu_categories c ON c.id=m.category_id WHERE ${where.join(' AND ')} ORDER BY m.name_ru`, params);
  if (!items.length) return res.json({ branch_id: branchId, items: [] });

  const recipes = await query<any>(`SELECT r.id,r.menu_item_id,r.version,r.yield_qty FROM recipes r WHERE r.branch_id=? AND r.active=true AND r.menu_item_id IN (${items.map(() => '?').join(',')})`, [branchId, ...items.map((i: any) => i.id)]);
  const recipeByItem = new Map(recipes.map((r: any) => [r.menu_item_id, r]));
  const recipeIds = recipes.map((r: any) => r.id);
  let ingredientCounts = new Map<string, number>();
  let costByRecipe = new Map<string, bigint>();
  if (recipeIds.length) {
    const ingredientRows = await query<any>(`SELECT ri.recipe_id,ri.quantity,i.average_cost FROM recipe_ingredients ri JOIN inventory_items i ON i.id=ri.inventory_item_id WHERE ri.recipe_id IN (${recipeIds.map(() => '?').join(',')})`, recipeIds);
    const byRecipe = new Map<string, any[]>();
    for (const row of ingredientRows) { const a = byRecipe.get(row.recipe_id) || []; a.push(row); byRecipe.set(row.recipe_id, a); }
    for (const r of recipes) {
      const ings = byRecipe.get(r.id) || [];
      ingredientCounts.set(r.id, ings.length);
      costByRecipe.set(r.id, computeRecipeCostPerUnitCents(ings, r.yield_qty));
    }
  }

  const results = items.map((item: any) => {
    const recipe: any = recipeByItem.get(item.id);
    const priceCents = moneyCents(item.price);
    let recipeCost: string | null = null, foodCostPct: string | null = null, grossMargin: string | null = null, grossMarginPct: string | null = null;
    if (recipe) {
      const costCents = costByRecipe.get(recipe.id) || 0n;
      recipeCost = centsText(costCents);
      if (priceCents > 0n) {
        foodCostPct = pctString(costCents, priceCents);
        const marginCents = priceCents - costCents;
        grossMargin = centsText(marginCents);
        grossMarginPct = pctString(marginCents, priceCents);
      }
    }
    return {
      id: item.id, sku: item.sku, name_ru: item.name_ru, name_tk: item.name_tk, price: item.price, status: item.status,
      category_id: item.category_id, category_name_ru: item.category_name_ru, category_name_tk: item.category_name_tk,
      has_recipe: Boolean(recipe), recipe_version: recipe?.version ?? null, ingredient_count: recipe ? (ingredientCounts.get(recipe.id) || 0) : 0,
      recipe_cost: recipeCost, food_cost_percent: foodCostPct, gross_margin: grossMargin, gross_margin_percent: grossMarginPct,
    };
  });
  res.json({ branch_id: branchId, items: results });
});

// ================================================================================================
// GET /api/food-cost/menu-items/:id -- recipe detail: ingredients with line costs, total recipe
// cost, food-cost %, gross margin. Version history is served by the existing
// GET /api/inventory/recipes/:menuItemId/versions (not duplicated here).
// ================================================================================================
router.get('/menu-items/:id', requirePermission('food_cost.view'), async (req, res) => {
  const branchId = String(req.query.branch_id || req.user!.branch_id || '');
  if (!branchId || !allowed(req, branchId)) return res.status(403).json({ error: 'BRANCH_ACCESS_DENIED', code: 'BRANCH_ACCESS_DENIED', message: 'Branch is outside your access scope.', details: {} });
  const item = await queryOne<any>('SELECT m.*,c.name_ru AS category_name_ru,c.name_tk AS category_name_tk FROM menu_items m LEFT JOIN menu_categories c ON c.id=m.category_id WHERE m.id=? AND (m.branch_id=? OR m.branch_id IS NULL) AND m.deleted_at IS NULL', [req.params.id, branchId]);
  if (!item) return res.status(404).json({ error: 'NOT_FOUND', code: 'MENU_ITEM_NOT_FOUND', message: 'Menu item not found.', details: {} });
  const active = await activeRecipeWithIngredients(branchId, item.id);
  const priceCents = moneyCents(item.price);
  let response: any = { item: { id: item.id, sku: item.sku, name_ru: item.name_ru, name_tk: item.name_tk, price: item.price, status: item.status, category_name_ru: item.category_name_ru, category_name_tk: item.category_name_tk }, recipe: null };
  if (active) {
    const lines = active.ingredients.map((ing: any) => {
      const lineCostScaled4 = (scaled4(ing.quantity) * scaled4(ing.average_cost)) / 10000n;
      return { inventory_item_id: ing.inventory_item_id, sku: ing.sku, name: ing.name, unit: ing.unit, quantity: ing.quantity, unit_cost: ing.average_cost, line_cost: fromScaled4(lineCostScaled4) };
    });
    const costCents = computeRecipeCostPerUnitCents(active.ingredients, active.recipe.yield_qty);
    const recipeTotalScaled4 = active.ingredients.reduce((sum: bigint, ing: any) => sum + (scaled4(ing.quantity) * scaled4(ing.average_cost)) / 10000n, 0n);
    let foodCostPct: string | null = null, grossMargin: string | null = null, grossMarginPct: string | null = null;
    if (priceCents > 0n) {
      foodCostPct = pctString(costCents, priceCents);
      const marginCents = priceCents - costCents;
      grossMargin = centsText(marginCents);
      grossMarginPct = pctString(marginCents, priceCents);
    }
    response.recipe = { id: active.recipe.id, version: active.recipe.version, yield_qty: active.recipe.yield_qty, ingredients: lines, recipe_total_cost: fromScaled4(recipeTotalScaled4), cost_per_unit: centsText(costCents), food_cost_percent: foodCostPct, gross_margin: grossMargin, gross_margin_percent: grossMarginPct };
  }
  res.json(response);
});

// ================================================================================================
// GET /api/food-cost/ingredients -- ingredient-level economics, including which active recipes
// (and therefore menu items) each ingredient affects, for the low-stock -> affected-recipes
// integration Stage 33's alerts already surface at the item level.
// ================================================================================================
router.get('/ingredients', requirePermission('food_cost.view'), async (req, res) => {
  const branchId = String(req.query.branch_id || req.user!.branch_id || '');
  if (!branchId || !allowed(req, branchId)) return res.status(403).json({ error: 'BRANCH_ACCESS_DENIED', code: 'BRANCH_ACCESS_DENIED', message: 'Branch is outside your access scope.', details: {} });
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const items = await query<any>('SELECT * FROM inventory_items WHERE branch_id=? AND active=true ORDER BY name', [branchId]);
  if (!items.length) return res.json({ branch_id: branchId, ingredients: [] });
  const ids = items.map((i: any) => i.id);
  const consumedToday = await query<any>(`SELECT inventory_item_id, COALESCE(SUM(quantity),0) AS qty FROM stock_movements WHERE branch_id=? AND type='SALE' AND created_at>=? AND inventory_item_id IN (${ids.map(() => '?').join(',')}) GROUP BY inventory_item_id`, [branchId, todayStart, ...ids]);
  const consumedMap = new Map(consumedToday.map((r: any) => [r.inventory_item_id, r.qty]));
  const affected = await query<any>(`SELECT ri.inventory_item_id, m.name_ru, m.name_tk, m.id AS menu_item_id FROM recipe_ingredients ri
      JOIN recipes r ON r.id=ri.recipe_id AND r.active=true JOIN menu_items m ON m.id=r.menu_item_id
      WHERE r.branch_id=? AND ri.inventory_item_id IN (${ids.map(() => '?').join(',')})`, [branchId, ...ids]);
  const affectedMap = new Map<string, any[]>();
  for (const row of affected) { const a = affectedMap.get(row.inventory_item_id) || []; a.push({ menu_item_id: row.menu_item_id, name_ru: row.name_ru, name_tk: row.name_tk }); affectedMap.set(row.inventory_item_id, a); }
  const results = items.map((i: any) => ({
    id: i.id, sku: i.sku, name: i.name, unit: i.unit, current_stock: i.current_stock, reorder_point: i.reorder_point,
    unit_cost: i.average_cost, inventory_value: fromScaled4(scaled4(i.current_stock) * scaled4(i.average_cost) / 10000n),
    consumption_today: String(consumedMap.get(i.id) || '0'), affected_recipes: affectedMap.get(i.id) || [],
  }));
  res.json({ branch_id: branchId, ingredients: results });
});

// ================================================================================================
// GET /api/food-cost/profitability -- menu profitability over a real, paid-sales period. Revenue
// and quantity come from order_items on COMPLETED orders (the existing Order Core's definitive
// "sold" marker, which already excludes REFUNDED orders); theoretical cost comes from each
// order_item's own recipe_cost_snapshot -- the historical cost AS SOLD, never recomputed from
// today's recipe. Credit sales are included in revenue (they are real sales, Stage 31 semantics);
// credit repayments are a receivable event, not a sale, and never appear here.
// ================================================================================================
router.get('/profitability', requirePermission('food_cost.view'), async (req, res) => {
  const branchId = String(req.query.branch_id || req.user!.branch_id || '');
  if (!branchId || !allowed(req, branchId)) return res.status(403).json({ error: 'BRANCH_ACCESS_DENIED', code: 'BRANCH_ACCESS_DENIED', message: 'Branch is outside your access scope.', details: {} });
  const now = new Date();
  const start = typeof req.query.start === 'string' && req.query.start ? req.query.start : new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const end = typeof req.query.end === 'string' && req.query.end ? req.query.end : now.toISOString();
  const rows = await query<any>(`SELECT oi.menu_item_id, m.name_ru, m.name_tk,
      COUNT(*)::int AS units_sold, COALESCE(SUM(oi.subtotal),0) AS revenue,
      COALESCE(SUM(oi.recipe_cost_snapshot),0) AS theoretical_cost,
      COUNT(*) FILTER (WHERE oi.recipe_cost_snapshot IS NULL)::int AS units_without_recipe_cost
    FROM order_items oi
    JOIN orders o ON o.id=oi.order_id
    LEFT JOIN menu_items m ON m.id=oi.menu_item_id
    WHERE o.branch_id=? AND o.status='COMPLETED' AND oi.status='ACTIVE' AND oi.menu_item_id IS NOT NULL AND o.created_at>=? AND o.created_at<=?
    GROUP BY oi.menu_item_id, m.name_ru, m.name_tk ORDER BY revenue DESC`, [branchId, start, end]);
  const results = rows.map((r: any) => {
    const revenueCents = moneyCents(r.revenue);
    // Stage 38 fix: theoretical_cost is SUM() over order_items.recipe_cost_snapshot, a
    // DECIMAL(14,4) column, so Postgres returns it with FOUR decimals ("196.2240"). moneyCents
    // only accepts two and silently returns 0 for anything else, so this report had been showing
    // a theoretical cost of 0.00 -- and therefore a 100% gross margin -- for every branch whose
    // summed cost was not exactly whole cents. Folded down through the same 4-decimal path
    // analytics.ts already uses (scaled4 -> cents, truncating), so both reports agree.
    const costCents = scaled4ToCents(scaled4(r.theoretical_cost));
    const marginCents = revenueCents - costCents;
    return {
      menu_item_id: r.menu_item_id, name_ru: r.name_ru, name_tk: r.name_tk, units_sold: r.units_sold,
      revenue: centsText(revenueCents), theoretical_cost: centsText(costCents), gross_margin: centsText(marginCents),
      gross_margin_percent: pctString(marginCents, revenueCents),
      units_without_recipe_cost: r.units_without_recipe_cost,
    };
  });
  res.json({ branch_id: branchId, period: { start, end }, items: results });
});

// ================================================================================================
// GET /api/food-cost/valuation -- current inventory value using the same authoritative costing
// (average_cost) as every other Stage 34 calculation. No second valuation method.
// ================================================================================================
router.get('/valuation', requirePermission('food_cost.view'), async (req, res) => {
  const branchId = String(req.query.branch_id || req.user!.branch_id || '');
  if (!branchId || !allowed(req, branchId)) return res.status(403).json({ error: 'BRANCH_ACCESS_DENIED', code: 'BRANCH_ACCESS_DENIED', message: 'Branch is outside your access scope.', details: {} });
  const items = await query<any>('SELECT id,sku,name,unit,current_stock,average_cost FROM inventory_items WHERE branch_id=? AND active=true ORDER BY name', [branchId]);
  let totalScaled4 = 0n;
  const results = items.map((i: any) => {
    const valueScaled4 = (scaled4(i.current_stock) * scaled4(i.average_cost)) / 10000n;
    totalScaled4 += valueScaled4;
    return { id: i.id, sku: i.sku, name: i.name, unit: i.unit, current_stock: i.current_stock, unit_cost: i.average_cost, value: fromScaled4(valueScaled4) };
  });
  res.json({ branch_id: branchId, total_value: fromScaled4(totalScaled4), items: results });
});

export default router;
