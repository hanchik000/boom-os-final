# Stage 34.6 — BOOMCARD Lifecycle

## The lifecycle is a manager's decision

```
CANDIDATE  ──(manager approves)──▶  ACTIVE  ──(lapses or is withdrawn)──▶  INACTIVE
    ▲                                  │                                       │
    │                                  └──(manager renews)──┘                  │
    └────────────────────(manager may activate again)───────────────────────────┘
```

**Automation only ever proposes.** `POST /api/boomcard/lifecycle/evaluate` computes each guest's
real qualifying spend for a period from `COMPLETED` orders and reports who crosses the threshold.
With automation on it records them as `CANDIDATE` and lapses cards whose validity has run out; it
**never** sets a card `ACTIVE`. Activation, renewal, deactivation and the birthday benefit are all
manager-permissioned routes.

With **automation off**, the evaluation still runs and still reports who qualifies — it simply
creates nothing — and manual creation, activation, renewal and deactivation keep working exactly as
before. That is the whole point of the switch, and the E2E proves both halves.

## Nothing is hardcoded

| Setting | Default |
|---|---|
| `BOOMCARD_AUTO_LIFECYCLE_ENABLED` | `true` |
| `BOOMCARD_MONTHLY_SPEND_THRESHOLD` | `5000.00` |
| `BOOMCARD_VALIDITY_DAYS` | `30` |
| `BOOMCARD_BREAKFAST_PER_PERIOD` | `4` |

A manager can override the validity and the allowance per decision, or name an exact `valid_until`
(useful for a campaign that ends on a fixed date). All spend comparison is BigInt cents.

## Nothing is destroyed

Every transition and every grant is its own `boomcard_events` row, recording the status before and
after, who decided it, whether it was automatic, the qualifying spend and the period it was judged
on. Deactivation only changes state — the card, its history and its grants survive, and the card can
be activated again. A guest can only ever have one card (`customer_id` is unique).

## The guest's cabinet

`GET /api/boomcard/cabinet/:token` — no authentication: the opaque `cabinet_token` **is** the
credential, so a cabinet link cannot be guessed from anything the guest can see elsewhere. It
returns:

- the card status and validity,
- the breakfast balance as **granted / used / remaining**,
- a **generic** birthday benefit — *that* one is waiting, how many, and until when,
- cashback, which is wired in by Stage 34.7 when the BOOMBACK ledger exists (reported as `null`
  until then, rather than inventing a number).

### The privacy rule

The manager chooses a **specific** menu item and quantity for the birthday benefit, and the manager
view shows it. The guest's cabinet **never selects the product at all** — a static guard asserts the
cabinet handler contains no reference to `menu_items`, and the E2E asserts the cabinet response
contains neither the dish name nor its id.

## API

| Method | Path | Auth |
|---|---|---|
| `GET` | `/api/boomcard/cabinet/:token` | the token itself |
| `GET` | `/api/boomcard/settings` | `boomcard.view` |
| `GET` | `/api/boomcard?branch_id&status` | `boomcard.view` |
| `GET` | `/api/boomcard/:id` | `boomcard.view` |
| `POST` | `/api/boomcard` | `boomcard.manage` |
| `POST` | `/api/boomcard/:id/activate` · `/renew` · `/deactivate` | `boomcard.manage` |
| `POST` | `/api/boomcard/:id/birthday-gift` | `boomcard.manage` |
| `POST` | `/api/boomcard/lifecycle/evaluate` | `boomcard.manage` |
| `PATCH` | `/api/customers/:id` | `customers.manage` — records a guest's `birth_date` |

A guest's date of birth is recorded so a manager can decide when a birthday benefit is due. It is
never a discount and grants nothing by itself.

## RBAC

Two new permissions: `boomcard.view` (managers + cashier) and `boomcard.manage` (managers only).
Every authenticated route is branch-checked with the existing `allowed(req, branchId)` helper, and
every transition is audited as `BOOMCARD_<TYPE>`.

## Database

One additive migration, `20260919200000_stage34_6_boomcard`: three new tables (`boomcards`,
`boomcard_events`, `boomcard_birthday_gifts`) plus a nullable `customers.birth_date`.

## UI

New **BOOMCARD** screen (`boomcard.view`): the period evaluation runner (which states plainly that
it activates nobody), status filters, the card list with breakfast balance and validity, and a
detail pane with the lifecycle actions, the birthday-benefit assignment (stating that the guest will
not see which dish it is), the granted gifts and the full event history. RU + TK.

## Tests

- `tests/stage34_6_boomcard_static.mjs` — 33 source guards.
- `tests/stage34_6_boomcard_e2e.mjs` — 91 HTTP calls, 9 denials, 19 fresh-DB post-conditions:
  automation proposing a candidate from real spend without activating it, re-running creating no
  duplicate, manager approval / renewal / deactivation / re-activation with the history intact, the
  cabinet showing the breakfast balance and a generic benefit while leaking neither the dish name nor
  its id, automation off still reporting while manual management keeps working, an expired card
  lapsing automatically, and branch isolation.
- Negative control: making the evaluation activate candidates, and making the cabinet return the
  gift's name, fails the E2E and both corresponding static guards.
