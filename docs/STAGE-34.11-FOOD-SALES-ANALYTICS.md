# Stage 34.11 — Food & Sales Analytics

A read-only module. It creates nothing, changes nothing, and owns no table. Every figure is derived
live from the existing Order Core; there is no analytics ledger, no nightly rollup and no cached
aggregate that could drift away from the orders it claims to describe.

`GET /api/analytics/*`, permission `analytics.view`, branch-scoped like everything else.

---

## The three rules it is built on

**1. What counts as sold.** Exactly the orders the Order Core calls `COMPLETED`. `SOLD_STATUS` is
declared once and every query uses it. An order that was cancelled, refunded or closed by the
establishment is not a sale and never appears in revenue — those belong to the closure reports.
Removed lines (`order_items.status <> 'ACTIVE'`) are excluded too.

**2. How cost is known.** From `order_items.recipe_cost_snapshot` — the ingredient cost of that
line **as sold**, stamped at consumption time. Never from today's recipe or today's average cost.
A recipe change next month cannot rewrite last month's margin. The module does not so much as
mention `recipe_ingredients`, `inventory_items` or `average_cost`. Lines carrying no snapshot are
counted and reported as `units_without_cost` rather than silently treated as free to produce.

**3. Why nothing is double-counted.** An order's items are a *partition*: a split order divides its
lines between separate bills, it never copies them. So summing `order_items` counts each line once
whether or not the order was split, and summing `orders` counts each order once. The module never
joins `order_bills` into a revenue sum.

Item-level and order-level revenue answer different questions, so they are two separately named
figures and are never added together:

```
item_revenue  = SUM(order_items.subtotal)   -- what the food was priced at,
                                               before order-level discounts, before service charge
net_revenue   = SUM(orders.final_amount)    -- what the guest actually owed:
                                               items − discounts + service charge
```

The identity `item_revenue − discounts + service_charge = net_revenue` is asserted by the E2E,
before and after a split.

---

## Endpoints

| Endpoint | Answers |
| --- | --- |
| `GET /sales` | orders, both revenue figures, discounts, service charge, average check, units and give-aways, broken down by order type, source and settlement method |
| `GET /dishes` | the dish ranking — `sort=UNITS\|REVENUE\|MARGIN`, `order=ASC\|DESC`, optional `category_id` |
| `GET /categories` | the same dish figures rolled up by menu category, with each category's revenue share |
| `GET /time` | orders and revenue by hour, by weekday and by day |
| `GET /matrix` | the menu matrix — see below |
| `GET /dishes/:menuItemId` | the drill-down: every order line behind one dish's numbers |

All six take the same `start` / `end` window, resolved by one `resolvePeriod()`, and all six echo
the period and the timezone they used.

### Timezone

"Today" means today **in the branch's own timezone** (`branches.timezone`, default
`Asia/Ashgabat`), not the server's. The hour and weekday breakdowns are computed with
`o.created_at::timestamptz AT TIME ZONE <branch tz>`. A report that quietly meant "today in UTC"
would be wrong for half of every evening service.

### The matrix does not name winners

`GET /matrix` returns each dish's measured popularity and margin percentage, the two **medians**
those were measured against, and which side of each median the dish falls on. It deliberately does
not name quadrants and does not call any dish a star, a puzzle, a workhorse or a dog. Which of
these numbers matters, and what to do about it, is the manager's decision — the medians are
published so they can see exactly what the comparison was against. A dish given away every time has
no margin percentage to compare and is excluded from the margin median rather than counted as 0%.

The screen says so in both languages, and a static guard fails if any verdict word ever appears in
the module's code.

### Give-aways are visible, not hidden

A compliment (34.8) and a redeemed BOOMCARD breakfast (34.7) are real order lines priced at zero.
Real food left the kitchen, so they **are** counted as units sold and they **do** carry their real
cost — but they are reported separately as `give_away_units` instead of quietly depressing a dish's
margin with no explanation. A give-away is not a discount: discounts are read from the order's own
`discount` column and stay zero.

---

## Money

BigInt throughout. `moneyCents()` for 2-decimal money, `cost4ToCents()` for the 4-decimal snapshot
costs, `pctString()` / `pctHundredths()` for percentages in and out. No `parseFloat` anywhere; the
single `Number()` in the file is on a unit **count**. The average check is an exact integer division
of cents, not a floating mean.

---

## The screen

`AnalyticsView` (RU + TM, `analytics.view`-gated, in the sidebar) with five tabs — sales, dishes,
categories, time, matrix — a period filter, a sort selector, give-away and missing-cost badges, and
a per-dish drill-down modal. It computes **nothing**: every number it shows arrives already
computed from the server.

`/api/analytics` was a reserved 501 stub in the foundation architecture; Stage 34.11 activates it
and removes it from `futureModules` (`crm` remains reserved).

---

## Tests

`tests/stage34_11_analytics_static.mjs` — 44 source guards
`tests/stage34_11_analytics_e2e.mjs` — 111 HTTP calls, 6 denials, 35 DB post-conditions

```
npm run test:stage34.11        # static
npm run test:e2e:stage34.11    # fresh-DB E2E
```

The E2E builds a real branch with a real recipe (0.2 kg rice at 20.00 → 4.0000 per portion), sells
through the real POS → KDS → payment path, and then proves: only the three COMPLETED orders count
while an unpaid and a cancelled order do not; the revenue identity holds; a split order counts once
and its revenue once; the dish ranking, its cost and its margin are right; **repurchasing the rice
at five times the price does not move last week's margin**; a compliment is counted as a unit sold,
reported as a give-away, adds no revenue and is not a discount; a category total is exactly its
dishes; the time breakdown uses `Asia/Ashgabat` and accounts for every order once; the matrix
publishes its medians and contains no verdict word; the drill-down's lines sum to the ranking's
units; a period with no orders reports zero rather than everything; and a cashier, a waiter and
another branch's manager are all refused.

### Negative control

Seven forbidden behaviours were injected and each produced genuine failures before the source was
restored:

| Injected | Caught by |
| --- | --- |
| cost recomputed from today's recipe | static 9, 10; **E2E 4f** (margin moved 16.00 → 0.00) |
| revenue joined through `order_bills` | static 16 |
| a split order counted once per bill | **E2E 1a, 2b, 3a, 3b, 3c, 7b, 7c** (revenue inflated 481.00 → 811.00) |
| cancelled orders counted as sold | static 7 |
| the matrix labelling a dish STAR / DOG | static 27 |
| a margin computed with `parseFloat` | static 22 |
| the `analytics.view` permission granted to the cashier | static 39 |
