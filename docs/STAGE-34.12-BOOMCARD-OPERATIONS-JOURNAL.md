# Stage 34.12 — the unified BOOMCARD Operations Journal

A read model, not a new ledger. It creates nothing, writes nothing, and owns no table of its own
(two nullable, additive columns on the existing `boomcard_events` are the only schema change — see
below). Every row is a normalized view of one row that already exists in
`boomcoin_ledger`, `boomback_ledger` or `boomcard_events`, which remain the sole sources of truth.

`GET /api/boomcard/journal`, `GET /api/boomcard/journal/summary` — permission `boomcard.journal.view`,
branch-scoped like everything else.

---

## What was genuinely missing, and the minimal fix

Building the journal surfaced two real gaps in the existing BOOMCARD module, not invented scope:

**1. Birthday-gift redemption did not exist.** Stage 34.6 granted birthday gifts
(`boomcard_birthday_gifts`, status `GRANTED → REDEEMED → EXPIRED`) but nothing ever redeemed one —
there was no endpoint, and `BIRTHDAY_GIFT_REDEEMED` had never fired. The journal cannot expose an
event that is never created, so Stage 34.12 adds
`POST /api/boomcard/:id/birthday-gift/:giftId/redeem`, built to the exact shape of the existing
breakfast redemption: a real menu item added to a real open order at price 0, so the **existing**
payment → consumption path consumes its real ingredients and records its real cost. The gift row
itself (not a counter) is what is spent — `status='REDEEMED'`, `redeemed_at`, `redeemed_order_id` —
so it can be redeemed exactly once; redeeming it again is refused with `BIRTHDAY_GIFT_NOT_AVAILABLE`.

**2. `boomcard_events` had no structured drill-down identifiers.** A breakfast or birthday-gift
redemption only ever said "Redeemed on order X" as free text — there was no `order_id` or
`menu_item_id` column to join on. Reconstructing them by parsing `reason` would have meant inventing
data from a string. Instead, two nullable columns (`order_id`, `menu_item_id`) were added to
`BoomcardEvent`, populated only where the event actually involves them (a **redemption** has both; a
**grant** has at most the menu item; a lifecycle transition has neither). The migration is purely
additive — `ALTER TABLE ... ADD COLUMN`, two `ADD CONSTRAINT`, nothing dropped.

Both were real blockers for the journal's own stated requirement ("enough identifiers to drill down
to the original source record"), not architecture invented beyond the brief.

---

## The three normalized sources, one shape

`server/routes/boomcard-journal.ts` builds one `UNION ALL` of three branches — `boomcoin_ledger`,
`boomback_ledger`, `boomcard_events` — each mapped to the identical column list, so a plain union is
safe:

```
source, source_id                          -- the drill-down: which table, which row
event_type, event_category
created_at, branch_id, branch_name
boomcard_id, card_number, customer_id, customer_name, customer_phone
order_id, order_number, payment_id
menu_item_id, menu_item_name_ru, menu_item_name_tk
quantity, amount, boomback_amount, boomcoin_amount
balance_before, balance_after
operator_id, operator_name, operator_role
approver_id, approver_name
reason, status
audit_action, audit_entity_type, audit_entity_id
```

A field the source row does not carry is `NULL`, never invented: a breakfast **grant** carries no
menu item (it is a balance increment, not tied to one dish — honestly absent); every row's
`approver_id`/`approver_name` is `NULL`, because none of these operations is a two-step
request/approval workflow like a closure or a compliment — there is no separate approver to report.

**No arithmetic happens in this module.** Every money and count column is a straight SQL cast from
its source row (`bbl.amount::text`, `bcl.coins`, …) — there is no `parseFloat`, no `Number()`-based
math anywhere in it except one `Number()` on a unit count for `page`/`page_size`. The one place SQL
itself sums anything is the summary rollup's own `SUM`/`ABS`, computed by Postgres.

The operator's role is read through a **correlated scalar subquery**, never a `LEFT JOIN` onto
`user_roles` — a join there would fan a multi-role operator into duplicate rows and corrupt both the
row count and the pagination.

### The eleven required event types, and the four categories

| Source | `type` | journal `event_type` | `event_category` |
|---|---|---|---|
| boomcoin_ledger | EARNED | `BOOMCOIN_EARNED` | CUSTOMER_REWARD |
| boomcoin_ledger | REDEEMED | `BOOMCOIN_REDEEMED` | CUSTOMER_REWARD |
| boomback_ledger | EARNED | `BOOMBACK_EARNED` | CUSTOMER_REWARD |
| boomback_ledger | REDEEMED | `BOOMBACK_REDEEMED` | **PAYMENT_SETTLEMENT** |
| boomcard_events | BREAKFAST_GRANTED | `BREAKFAST_GRANTED` | CUSTOMER_REWARD |
| boomcard_events | BREAKFAST_REDEEMED | `BREAKFAST_REDEEMED` | **OPERATIONAL_BENEFIT** |
| boomcard_events | BIRTHDAY_GIFT_GRANTED | `BIRTHDAY_GIFT_GRANTED` | CUSTOMER_REWARD |
| boomcard_events | BIRTHDAY_GIFT_REDEEMED | `BIRTHDAY_GIFT_REDEEMED` | **OPERATIONAL_BENEFIT** |
| boomcard_events | ACTIVATED / RENEWED / DEACTIVATED | `BOOMCARD_ACTIVATED` / `_RENEWED` / `_DEACTIVATED` | LIFECYCLE |
| boomcard_events | CANDIDATE_IDENTIFIED | `CANDIDATE_IDENTIFIED` | LIFECYCLE |

(`ADJUSTMENT`/`REVERSED` ledger rows map to `BOOMCOIN_ADJUSTED`/`_REVERSED` and
`BOOMBACK_ADJUSTED`/`_REVERSED` — extra beyond the required eleven, from the same normalization, not
a second code path.)

BOOMBACK redemption reads as a **payment settlement**, never a discount. Breakfast/birthday-gift
redemption reads as an **operational benefit** (real food/goods consumed), distinct from the
**customer reward** of being *granted* one. A card's own lifecycle is its own category. The summary
endpoint groups by `(event_type, event_category)`, so these can never be summed into one another —
and nothing in the module ever touches `orders.final_amount` or `cash_shifts.cash_sales`, so none of
it can leak into sales revenue.

---

## Filters, pagination, isolation

`GET /journal` supports `start`/`end`, `branch_id` (required, checked with the existing
branch-access helper), `customer_id`/`boomcard_id`, `event_type` (comma-separated), `source`,
`status`, `order_id`, `operator_id`, `search` (customer name/phone, card number, order number), and
`page`/`page_size` (max 200). `branch_id` and the period are pushed into each UNION branch so the
existing `(branch_id, created_at)` indexes on all three source tables are used; every other filter
is applied once, on the combined result. `total`/`total_pages` come from an identical count query
built with the same filter function, so the two can never drift apart.

The journal never filters on `deleted_at` — an archived guest's or an archived employee's history
stays fully visible, exactly like the credit reports (34.10).

## RBAC

A dedicated permission, `boomcard.journal.view`, separate from `boomcard.view` (look up a card) and
`boomcard.manage` (execute a card operation) — granted only to the manager/admin roles. A role that
holds `boomcard.manage` and can genuinely activate a card, redeem a breakfast or grant a gift is
still refused the journal without this permission: executing a BOOMCARD operation never implies
reading the journal. The E2E proves this with a real custom role holding `boomcard.manage` alone.

## Frontend

`BoomcardJournalView` (RU + TM, `boomcard.journal.view`-gated, in the sidebar): period/type/source
filters, free-text search, a paginated table with category and event badges, a per-row detail
drawer showing every field above, and a summary modal. It computes nothing — every figure is a
server field.

---

## Tests

`tests/stage34_12_boomcard_journal_static.mjs` — 40 source guards
`tests/stage34_12_boomcard_journal_e2e.mjs` — 106 HTTP calls, 6 denials, 45 DB post-conditions

```
npm run test:stage34.12        # static
npm run test:e2e:stage34.12    # fresh-DB E2E
```

The E2E drives one branch through every required event type on real orders and real payments —
BOOMCOIN and BOOMBACK earned on a real settlement, BOOMBACK spent against a real bill, a breakfast
and a birthday gift each granted and then genuinely redeemed (consuming real inventory through the
existing order-item path), the card activated, renewed and deactivated — then reads the journal back
and asserts: all eleven event types appear with real, normalized fields (not invented); BOOMBACK
redemption reads `PAYMENT_SETTLEMENT`; breakfast/gift redemption reads `OPERATIONAL_BENEFIT`;
BOOMCOIN reads `CUSTOMER_REWARD`; every filter (type, source, customer, order, operator, search)
narrows correctly; pagination pages don't overlap and totals reconcile; the Order Core's own sales
total is unchanged by any of it; an archived guest's history stays visible; a `boomcard.manage`-only
role can execute a card operation yet is still refused the journal; and branch isolation holds.

### Negative control

Genuine failures were confirmed, then the source restored, for:

| Injected | Caught by |
| --- | --- |
| BOOMBACK redemption category renamed to `DISCOUNT` | static 16; **E2E 12, 28b** |
| role lookup switched to a fan-out `LEFT JOIN` onto `user_roles` | static 27 |
| `boomcard.journal.view` granted to the cashier | static 33; **E2E 31** |
| a fake `approver_name` invented for a ledger row | static 14 |
| the journal's auth gate widened from `/journal` to router-wide | static 30b; **stage 34.7's own E2E, check 16e** |

### Repairs to older stage tests

Two assertions elsewhere had gone stale as this stage legitimately extended what they measured, and
were generalized to the invariant rather than relaxed:
- **Stage 34.6** asserted `boomcardRouter` was mounted at `/api/boomcard` exactly once by counting
  every `app.use('/api/boomcard', …)` line; the journal router is now mounted at the same base path
  (the same established pattern as order-bills before orders), so the check now counts mounts of
  `boomcardRouter` specifically.
- **Stage 34.11** asserted `analytics.view` was granted to managers by matching the literal end of
  the `stage17RolePerms` array, which this stage extended; the check now parses the array and
  asserts membership.

### Two genuine defects caught and fixed before landing

`analyticsRouter` (34.11) had never been added to `server.ts`'s async-error-forwarding list, so an
unhandled promise rejection in any analytics route would have hung the request instead of returning
a proper 500 (Express 4 does not forward a rejected async handler on its own). Both `analyticsRouter`
and the new `boomcardJournalRouter` are now wired into it.

The first full regression run surfaced a real one of this stage's own making: `boomcard-journal.ts`
originally called `router.use(authenticateToken)` unconditionally. Because this router is mounted
**before** `boomcardRouter` at the same `/api/boomcard` base path (deliberately, so `GET /journal`
is never swallowed by `boomcardRouter`'s `GET /:id`), that unscoped middleware ran for *every*
request under `/api/boomcard` — including `GET /cabinet/:token`, the guest's own deliberately public
cabinet, which sits in `boomcardRouter` ahead of *its* auth gate. Stage 34.7's own E2E caught it
immediately (an anonymous cabinet lookup came back 401). The fix scopes the gate to the `/journal`
prefix specifically (`router.use('/journal', authenticateToken)`), and a static guard (30b) now
pins it so it cannot regress silently again.
