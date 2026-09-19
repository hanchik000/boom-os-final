# Stage 34.5 — BOOMCOIN Controls

## The rule

**1 BOOMCOIN per every 200 MAN of qualifying spend** — and none of those numbers lives in code. The
rate and both switches are system settings:

| Setting | Default | Meaning |
|---|---|---|
| `BOOMCOIN_SPEND_PER_COIN` | `200.00` | qualifying spend that earns one coin |
| `BOOMCOIN_EARNING_ENABLED` | `true` | the earning engine |
| `BOOMCOIN_COUNTER_UI_ENABLED` | `true` | the POS / menu progress counter |

The two switches are **independent**: the counter can be hidden while earning continues, and
earning can be stopped while balances stay visible. Both are editable from the existing Settings
screen.

## The ledger is authoritative

`boomcoin_ledger` is the record. A guest's balance is the **sum of that ledger**, recomputed on every
read — never a number anybody typed and never something the POS calculated. Every row carries
`balance_before` / `balance_after` and `spend_before` / `spend_after`, so the history explains
itself.

The two columns on the customer (`boomcoin_balance`, `qualifying_spend`) are a **cache** maintained
inside the same transaction as the row that caused them. The read endpoint returns the computed
balance and the cached one side by side, so any drift is visible rather than hidden — and the E2E
asserts they are equal.

Nothing is ever edited or deleted. A refund does not erase the earning; it writes its **own**
`REVERSED` row.

## Cumulative progress

Coins are earned on **cumulative** qualifying spend, so a guest's progress carries across visits:

```
coins = floor(total_qualifying_spend / rate)
```

Each settlement mints the difference. The specification's three examples, proven end to end:

| Spent (cumulative) | Coins | To the next coin |
|---|---|---|
| 160.00 | 0 | 40.00 — *«закажи ещё на 40 MAN и получи 1 BOOMCOIN»* |
| 350.00 | 1 | 50.00 |
| 400.00 | 2 | 200.00 |

Qualifying spend is what the guest actually settled — the paid amount of the order (or of the
separate check). A split order earns **per bill**, for that bill's own guest.

## The counter is guidance

`GET /api/loyalty/boomcoin/customers/:id` returns the balance, the qualifying spend, the remainder
and `to_next_coin`. The POS renders the sentence; it never computes a coin, a rate or a balance, and
it shows nothing when `counter_ui_enabled` is off. Nothing about the counter grants anything.

## Idempotency

Two independent guards:

1. The payment route's own `Idempotency-Key` short-circuits a replay before accrual is reached.
2. `boomcoin_ledger.entry_key` is **never null** and unique (`<order>|<bill|ORDER>|EARNED`), with
   `ON CONFLICT DO NOTHING`, and the customer row is locked `FOR UPDATE` — so two concurrent
   payments for the same guest cannot both read the same balance and each mint a coin.

The E2E proves a replayed payment mints no second coin; the static suite asserts the second guard
exists, because the first one hides it from the HTTP path.

## API

| Method | Path | Auth |
|---|---|---|
| `GET` | `/api/loyalty/boomcoin/customers/:id` | waiter POS session **or** `loyalty.view` |
| `GET` | `/api/loyalty/boomcoin/settings` | `loyalty.view` |
| `GET` | `/api/loyalty/boomcoin/ledger?branch_id&customer_id` | `loyalty.view` |
| `POST` | `/api/loyalty/boomcoin/adjust` | `loyalty.manage` |

A manual adjustment always needs a non-zero whole number of coins **and a reason**; it is its own
ledger row, adds no qualifying spend (so it never distorts the progress counter), and is audited.

## RBAC

Two new permissions: `loyalty.view` (managers + cashier) and `loyalty.manage` (managers only). Every
route is branch-checked with the existing `allowed(req, branchId)` helper.

## Database

One additive migration, `20260919180000_stage34_5_boomcoin`: the new `boomcoin_ledger` table plus
two cache columns on `customers`.

## Tests

- `tests/stage34_5_boomcoin_static.mjs` — 30 source guards.
- `tests/stage34_5_boomcoin_e2e.mjs` — 102 HTTP calls, 5 denials, 20 fresh-DB post-conditions: the
  three worked examples, the balance equalling the ledger sum and the cache agreeing with it, a
  replayed payment minting nothing, a manual adjustment that moves the balance but not the progress,
  a refund giving the spend back as its own row, the earning switch really stopping accrual, the
  counter switch flipping independently, a rate change taking effect, and the waiter POS reading the
  same authoritative numbers.
- Negative control: ignoring the earning switch fails the "engine off" post-condition; removing the
  ledger's unique entry key fails static check 10.
