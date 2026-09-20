# BOOM OS — Stage 38 Report
## Modifier Recipe Consumption and Historical Cost

Stage 37 created the relation `menu_modifiers.source_menu_item_id`. Stage 38 makes it operational:
a chosen component now resolves through that link into the **existing** Recipe Engine and consumes
real ingredients through the **existing** inventory ledger — transactionally, idempotently,
branch-scoped, with a historical cost snapshot a later change can never rewrite.

No parallel engine was created. There is no `modifier_inventory`, no `modifier_stock`, no
`modifier_consumption`, and no hardcoded deduction anywhere.

---

## 1. Architecture used — the existing integration point

`consumeInventoryForOrder()` in `server/routes/payments.ts` is where BOOM OS has always turned a
paid order into stock movements. It is called **once**, inside the payment transaction, at the
moment the order completes:

```
POST /api/payments  →  transaction {
    … validate order, KDS ticket, bill …
    if (every bill settled) {
        consumeInventoryForOrder()      ← the one pipeline
        recordServiceChargeLedger()
        UPDATE orders SET status='COMPLETED'
    }
}
```

Stage 38 changed what that function resolves. It did not add a second call site, a second
transaction, or a second ledger.

## 2. Modifier → source item resolution

For each `order_items` row, the function reads its chosen components:

```sql
SELECT oim.id, oim.quantity, mm.source_menu_item_id
  FROM order_item_modifiers oim
  JOIN menu_modifiers mm ON mm.id = oim.modifier_id
 WHERE oim.order_item_id = ?
```

- `source_menu_item_id IS NULL` → a plain option ("no onion") consumes nothing.
- `modifier_id` is `ON DELETE SET NULL`, so a component whose option was deleted outright keeps
  its historical row and resolves to nothing — it can never consume against a dangling reference.

## 3. Recipe resolution

Through the **same** helper the base dish uses, branch-scoped:

```sql
SELECT id, version, yield_qty FROM recipes
 WHERE branch_id = ? AND menu_item_id = ? AND active = true
```

The component's requirements are then read from `recipe_ingredients` and scaled in the database's
own `DECIMAL(14,4)` arithmetic by `order_item.quantity × order_item_modifier.quantity`.

## 4. Inventory consumption — and a correctness fix Stage 38 required

`stock_movements` is uniquely keyed `(branch_id, reference_type, reference_id, inventory_item_id,
type)`, so **one order can hold only one SALE movement per ingredient**. The previous per-line
loop decremented `current_stock` once per line but let the second `INSERT` fall into
`ON CONFLICT DO NOTHING` — so two lines sharing an ingredient moved stock twice while the ledger
recorded it once.

That was latent before Stage 38 and would have become the *normal* case the moment a cheese
component shared cheddar with its burger. Consumption now runs in three passes:

1. **Resolve** every requirement (base + components) without touching stock, aggregating per
   inventory item.
2. **Move** stock once per ingredient — locked `FOR UPDATE` in sorted (deterministic) order,
   stock checked, decremented by the aggregate, and **one** SALE movement written whose quantity
   is the whole truth about what the order took.
3. **Snapshot** the costs, priced at the `average_cost` just consumed at.

Sorting the lock order also removes the lock-ordering deadlock two interleaved orders could hit
when they shared ingredients. `ON CONFLICT DO NOTHING` is kept, now doing only what it was meant
to do: absorb a retry.

## 5. Historical snapshot behaviour

`order_item_modifiers` gained the same pair `order_items` has carried since Stage 34:

| Column | Meaning |
|---|---|
| `recipe_version_snapshot INTEGER` | the component recipe version consumed |
| `recipe_cost_snapshot DECIMAL(14,4)` | its ingredient cost at the moment of consumption |

`price_delta_snapshot` (the **selling** price) is untouched. `order_items.recipe_cost_snapshot`
remains the line's **total** internal cost — base + components — so every Stage 34 food-cost and
analytics query keeps working with no change at all.

Proven against the brief's exact scenario: cheese 20g cheddar consumed today; the recipe is then
revised to 30g, cheddar gets dearer, and the selling price rises to 18.00. The old order still
reads **3.20 cost / +10.00 sold**; a new order reads the new, dearer figures.

The Recipe Engine's own versioning is what makes this meaningful — `POST /recipes/:id/versions`
inserts a new version and deactivates the previous row rather than mutating it.

## 6. Missing recipe — the explicit rule, documented

**The rule is the one BOOM OS has always applied to a dish, applied unchanged to a component:**

> A menu item with no active recipe consumes nothing and leaves its cost snapshot `NULL`.

This is **not** a silent fallback and no new one was invented:

- Stage 34's reports already count those units separately — `units_without_recipe_cost` in
  `/api/food-cost/profitability`, `units_without_cost` in analytics.
- A component with no recipe leaves `order_item_modifiers.recipe_cost_snapshot` NULL, so the gap
  is visible in exactly the same place, at component granularity.
- The order is **not** rejected. Rejecting it would make a recipe mandatory, which BOOM OS has
  never required and which would break every existing recipe-less dish.

E2E section F proves both halves: nothing is consumed, and the null cost is recorded.

## 7. Archived source item

A component backed by a dish is orderable only while that dish is orderable:

- **Order Core refuses it** — `MODIFIER_SOURCE_UNAVAILABLE` (400) when the source is archived,
  soft-deleted, or outside the order's branch.
- **It is no longer offered** — the public menu, the QR menu and the waiter device all filter it
  out, so the rejection is a backstop rather than the first thing a guest meets.
- **History is untouched** — `ON DELETE SET NULL` plus the name/price/cost snapshots mean an old
  order still prints its component correctly.

## 8. Refund behaviour

Unchanged, deliberately. The Stage 34.1 rule stands: **refunding money is not returning
ingredients**. A payment only exists once the kitchen ticket reached READY, so every refundable
order is one whose food was already produced. Components follow the base dish exactly — no
special modifier refund mechanism was created, and no `RETURN` movement is invented for them.
What happens to the product remains the manager-approved decision carried on `order_closures` and
applied by `applyInventoryTreatment` (`WASTE` / `RETURN` as that decision says).

E2E section L confirms a bare refund is refused and that component ingredients do not reappear.

## 9. Split bill behaviour

Unchanged and verified. Consumption runs only when the **last** open bill settles:

```ts
const stillOpen = !fullySettled ? {id:'partial'} : (isSplit ? <any OPEN bill> : null);
if (!stillOpen) { consumeInventoryForOrder(...) }
```

E2E section K: after the first guest pays, **nothing** is consumed; after the second, exactly 60g
cheddar for two burgers — once — with one SALE ledger row, not one per guest.

## 10. Idempotency

Four independent barriers, discovered while running the negative controls:

1. the payment idempotency key (replay returns the original payment, `replayed: true`);
2. the order-state check (a COMPLETED order is not READY for payment);
3. the amount check (nothing remains to pay);
4. the ledger's unique constraint on `(order, ingredient, SALE)`.

E2E section Q proves a replay consumes nothing more. Browser check C7/C8 proves the same through
the real UI flow.

## 11. Branch isolation

Enforced at three layers: a component can only be sourced from a dish in its own branch
(`resolveSourceItem`), a recipe can only be attached to a menu item in its own branch, and recipe
resolution at consumption time filters on the order's branch.

**Stated honestly:** the third is defence in depth. Removing it alone is *not* independently
exploitable, because the first two already make a cross-branch source unreachable — confirmed by
experiment, not assumed. The load-bearing guard is `resolveSourceItem`, and that is the one the
negative control below removes.

## 12. RBAC

No new permission and no new public mutation. Consumption is server-side only; there is no route
that lets a client write a stock movement. `inventory.manage` still gates recipes and inventory,
`menu.manage` still gates components. Verified by denial: a waiter cannot repoint a component or
move stock, a cashier cannot edit a recipe, and each refusal was followed by a read proving
nothing changed.

---

## 13. A second defect Stage 38 found and fixed

`GET /api/food-cost/profitability` folded `SUM(order_items.recipe_cost_snapshot)` — a
`DECIMAL(14,4)` sum, so Postgres returns four decimals — through `moneyCents()`, which accepts at
most two and **silently returns 0** otherwise.

The report had therefore been showing `theoretical_cost: 0.00` and a **100% gross margin** for
every branch whose summed cost was not exactly whole cents. It survived Stage 34's tests because
those figures happened to land on two decimals (150g × 0.025 = 3.75 exactly).

Fixed by folding through the same 4-decimal path `analytics.ts` already used
(`scaled4 → scaled4ToCents`, truncating), so the two reports now agree. Pinned by E2E check J3b
and browser check D6 (margin 88.85%, not 100%).

---

## 14. Tests

**`tests/stage38_modifier_consumption_static.mjs` — 39/39 source guards**, including: no parallel
engine or table; exactly one consumption function and one call site; no hardcoded quantity;
aggregation present and explained; one INSERT into `stock_movements`; both snapshot writes; the
4-decimal fix; the archived-source rule on all three surfaces; and no cost column on any public
route.

## 15. E2E

**`tests/stage38_modifier_consumption_e2e.mjs` — 240 HTTP calls, 9 denials, 65 post-conditions**,
fresh database. Sections map to the Stage 38 matrix A–T: normal dish, one component, several
components, quantity, archived source, missing recipe, recipe snapshot, modifier cost snapshot,
inventory movement, food-cost analytics, split bill, refund after preparation, cancellation,
closure, branch isolation, RBAC, idempotent retry, concurrency, pre-existing orders, and public
price.

## 16. Negative controls — performed, not claimed

Three protections were removed, the server rebuilt, and the suite re-run:

| # | Guard removed | Result |
|---|---|---|
| 1 | `resolveSourceItem`'s cross-branch check | **8 failures.** O1/O2 flipped 404→201/200 and the component ended up pointing at *branch 2's* dish, which then broke the downstream orders. |
| 2 | Consumption reaching the ledger twice | **16 failures**, including `I3: movement 300g vs stock delta 600g` — precisely the ledger/shelf divergence §4 describes. |
| 3 | Archived-source validation | **2 failures.** E2 flipped 400→201: an archived component became orderable again. |

Every guard was restored and the suite returned to green (verified by re-running, and by grepping
each guard back into place).

An inverse control is also carried in the suite: the same cross-branch write that is refused for
branch 2 **succeeds** for the branch that owns the row.

## 17. Browser verification — 29/29, real Chromium, real data

ADMIN Menu Builder showing the component bound to its real source dish → Waiter POS device login →
constructor → burger + cheese in the cart at the **selling** price 105.00 with no cost anywhere →
order sent → payment → **150g beef and 20g cheddar consumed**, line snapshot 11.70, component
snapshot 3.20 against a +10.00 selling price → **replayed payment returns `replayed: true` and
consumes nothing more** → Inventory screen and ledger showing one SALE row per ingredient →
Food Cost screen with theoretical cost 11.70 and margin 88.85% → recipe revised to 30g and price
to 18.00, and the old order **still** reads 11.70 / 3.20 / +10.00 → guest menu showing +18.00 and
no internal cost at all.

Screenshots: `shot38_01_admin_component_link` … `shot38_05_guest`.

## 18. Regression

- **33/33 E2E suites pass** (`BATCH DONE (fail=0)`).
- **All static suites pass**, including Stage 34's recipe/food-cost suites and Stage 37's.
- `tsc --noEmit`, `vite build`, `esbuild`, `prisma validate`, `prisma migrate deploy` — all clean.

---

## 19. Known limitations

- **Component quantity is stored but never greater than 1.** `order_item_modifiers.quantity`
  exists and consumption multiplies by it, so "Extra Cheese ×2" would consume the cheese recipe
  twice — but Order Core always writes `quantity: 1` today. No frontend-only quantity was
  invented. Making it selectable is an Order Core change and is the clearest next increment.
- **A component's recipe is resolved by its source dish's *active* recipe.** A component cannot
  yet have a recipe distinct from the dish it points at (e.g. "20g cheddar as a topping" vs "a
  30g cheddar side"). Today the answer is to give the topping its own menu item.
- **The consumption-time branch filter is defence in depth**, not an independently exploitable
  barrier (§11). Stated so nobody removes it believing it redundant — it is the last line if the
  other two are ever loosened.
- **Insufficient stock blocks the payment** (`INSUFFICIENT_STOCK`, 409). That is the pre-existing
  behaviour and Stage 38 did not change it, but adding components makes it easier to hit: a
  burger can now fail to settle because the *cheese* ran out.
- The known 1.57 MB bundle warning and the sidebar <600px gap are untouched, per §26 of the brief.

## 20. Recommended next stage

**Component quantity in Order Core** — make `order_item_modifiers.quantity` settable from the POS
and the guest menu, with the server validating it against the group's `max_select`. The
consumption and cost maths already honour it; only the ordering path does not.

Second candidate: **branch pricing and effective dates**, still unexpressible in the schema and
still the largest genuine gap in the menu domain.

---

## 21. Files

**New:** `docs/STAGE-38-REPORT.md`,
`prisma/migrations/20260924000000_stage38_modifier_cost/migration.sql`,
`tests/stage38_modifier_consumption_e2e.mjs`, `tests/stage38_modifier_consumption_static.mjs`.

**Modified:** `prisma/schema.prisma` (two nullable columns on `order_item_modifiers`),
`server/routes/payments.ts` (the consumption rewrite), `server/routes/orders.ts` (archived-source
rule), `server/routes/menu.ts` and `server/routes/public-menu.ts` (stop offering an archived
component), `server/routes/food-cost.ts` (the 4-decimal cost fix).

**Deliberately untouched:** the Recipe Engine, the inventory ledger, `order-closure.ts`, and every
Order Core pricing path.
