# Stage 35.8 — Manager Dashboard Design

A visual/UX-only redesign of `ManagerCommandCenterView.tsx` ("Центр управления" / Command Center,
the manager-facing operations dashboard behind `dashboard.view`) into BOOM OS's black / graphite /
white / metallic-gold design language, using the same presentation-only-companion-CSS pattern
Stages 35.1/35.7 established: a new `src/design-system/command-center.css`, registered globally in
`main.tsx`, restyles the DOM the component already renders. No business logic — state, handlers,
API call, date-range math, alert typing — was touched; the diff is class names, comments, and
(where a value was inlined with its wrapper) an unwrapped `<div>`/`<span>` so a value can be
styled without changing what it is or where it comes from.

## What was already there

`ManagerCommandCenterView.tsx` was already a single, read-only view over one server-aggregated
endpoint (`GET /api/dashboard/manager`, `dashboard.view` + branch-scope gated) covering every
section the stage spec asks for: real-time alerts, a KPI strip, financial reconciliation (sales
vs. received vs. receivables, kept as separate totals), cash position, live order/KDS status,
inventory counts, waiter/cashier performance tables, and credit/staff panels — each with a working
`onNavigate()` drill-down into the existing screen that owns that data (`cashierPos`, `operations`,
`inventory`, `creditReports`, `employees`). `money()` only ever formats a value the server sent;
there was no client-side financial arithmetic to remove. This stage's job was exclusively visual.

## What changed

- **New**: `src/design-system/command-center.css` — top bar (title/branch/date presets/refresh),
  alert list, KPI grid, the generic `.cmd-panel` shell reused for every card section, financial
  stat rows (with a dedicated `.total`/`.received`/`.receivables` treatment so the three totals
  stay visually distinct), the cash-position difference line, order/KDS status tile grids, the
  waiter/cashier `.cmd-table`, and the credit/staff mini-stats.
- **Changed**: `ManagerCommandCenterView.tsx` — className swaps only, applied section by section
  (top bar, alerts, KPI strip, financial reconciliation, cash position, orders, KDS, inventory,
  waiter table, cashier table, credit, staff). Removed one now-dead `ALERT_SEVERITY_COLOR`
  Tailwind-class lookup table, replaced by CSS classes keyed on the exact same `a.severity` values
  (`critical`/`warning`/`info`) the alert objects already carry from the server.
- **Changed**: `main.tsx` — one added import, same line Stage 35.1/35.7 added for their own
  stylesheets.

## Information hierarchy

Kept the existing panel order (alerts → KPI strip → financial → cash position + live orders → KDS
+ inventory → waiter/cashier tables → credit + staff) rather than reshuffling it — it already
matches the spec's priority list (sales, cash, orders, KDS, waiters, cashiers, credit, inventory,
alerts) top to bottom, and reordering an already-correct, already-tested information hierarchy for
its own sake would be exactly the kind of scope creep this stage's own rules warn against.

## Financial distinction (SALES ≠ CASH RECEIVED)

Unchanged and reinforced visually: "Продажи" (`data.financial.sales.*`) and "Получено денег"
(`data.financial.received.*`) render as two separate `.cmd-panel`s with two separate `.total`
rows — the received total is *only* `cash + card + credit_repayments`, a credit sale is never
counted as received money, and a credit repayment is never counted as a new sale. The receivables
panel (`.total.receivables`, gold) is a third, separate total again. None of these three totals
share a DOM node, a CSS class, or a computation — they are three separate reads of three separate
fields the server already keeps apart.

## Cash position

The difference figure (`.cmd-cash-diff .value`) is the most visually weighted line in the panel —
bold, larger font, colored gold when non-zero (`off`) vs. green when balanced (`balanced`) — same
`data.cash_position.last_closed_shift.difference` value the server's `CashShift` close computed,
never recomputed here.

## Alert Center

Still renders only real alerts from `data.alerts` (no `data.alerts` array, no alert list — the
guard `data.alerts?.length > 0` is unchanged). `alertText()`'s five real alert types
(`LOW_STOCK`, `ORDER_DELAY`, `CASH_DIFFERENCE`, `CREDIT_LIMIT_ISSUE`, `OPEN_CASH_SHIFT`) were not
extended or altered; each is still a button that drills into `a.link`, the same NavTab the server
response names.

## Reduced motion

`command-center.css` follows the same `@media (prefers-reduced-motion: reduce)` pattern as the
other two 35.x stylesheets, neutralizing its own transitions. No financial-value class (`.cmd-kpi-
value`, `.cmd-stat-row.total`, `.cmd-cash-diff .value`) carries a transition or animation rule in
the first place — verified by static guard — so reduced motion has nothing to disable on the
numbers themselves; only hover/press feedback on interactive chrome (buttons, clickable cards) is
ever animated.

## Security

Branch isolation and the `dashboard.view` permission gate live entirely in `server/routes/
dashboard.ts` (`requirePermission('dashboard.view')`, `if (!branchId || !allowed(req, branchId))
return 403`) and were not touched by this visual stage. The frontend's branch selector still
drives the one `branchId` value used in the single API call — there is no second, client-only
branch value that could drift from what the request actually sends.

## Verification

- TypeScript (`tsc --noEmit`): PASS.
- `prisma validate`: PASS (schema untouched).
- `npx vite build`: PASS.
- esbuild server bundle: PASS.
- Full static suite (`npm run test:static`), including the new
  `tests/stage35_8_manager_dashboard_design_static.mjs` (27 checks): PASS.
- Full 29+ suite E2E regression (unchanged backend): PASS.
- Live browser walkthrough (headless Chromium via Playwright): manager login → dashboard load →
  branch filter → date-range presets → financial section → cash position → live orders → KDS →
  waiter/cashier tables → credit → inventory → alert center → a drill-down click → tablet width →
  reduced motion — screenshots taken at each step, console checked for errors.

## Known limitations

- The pre-existing Vite >500KB bundle-size warning (documented in
  `docs/STAGE-35.6-HARDENING.md`) is unchanged by this stage.
- `Header.tsx`'s dead `onOpenLoginModal` prop (noted in `docs/STAGE-35.7-CASHIER-POS-DESIGN.md`)
  remains unrelated to this stage and unfixed.
