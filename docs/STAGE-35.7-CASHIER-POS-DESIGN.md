# Stage 35.7 — Cashier POS Design

A visual/UX-only redesign of `CashierPOSView.tsx` into BOOM OS's black / graphite / white /
metallic-gold design language, following the exact pattern Stage 35.1 established for Waiter POS:
a dedicated, presentation-only companion stylesheet (`src/design-system/cashier-pos.css`),
registered globally in `main.tsx`, that restyles the DOM the component already renders. No
business logic — state, handlers, API calls, conditions — was touched. The diff against the
previous commit is class names, comments, and (where a value used to be inlined as text) a split
into two `<span>`s so a value can be styled without changing what it says.

## What changed

- **New**: `src/design-system/cashier-pos.css` — topbar/identity, shift pill, orders rail
  (search/filters/cards), order detail panel (guest card, line items, totals), the payment action
  area (`pay-cta`, danger/info action buttons), the payment dialog (total display, method grid,
  confirm/cancel), the success screen's amount display, and the payments ledger footer.
- **Changed**: `CashierPOSView.tsx` — className swaps only, applied to: the top bar (branch /
  cashier / shift status / POS lock), the active-orders rail, the selected-order detail panel
  (head, guest/discount card, line items, totals), the payment CTA and the closure/compliment
  action buttons, the payment dialog (total, method grid, confirm/cancel), and the success
  screen's amount.
- **Changed**: `main.tsx` — one added import, same line Stage 35.1 added for `waiter-pos.css`.

## Layout

Kept the existing two-pane architecture (active orders rail + selected-order detail, both real
components already built around real data) rather than forcing the spec's four-zone sketch onto
it — per the spec's own instruction ("do not force this exact layout if the existing component
architecture suggests a better implementation. The existing functionality must remain intact").
The result still delivers every zone the spec asks for: top (identity/shift/lock), left (search,
filters, order list), center (selected order, items, totals), right/action (pay, closure,
compliment) — the last two share the same column as the order detail because that is what the
already-working component does today.

## Payment action clarity

The payment dialog explicitly separates TOTAL (`.pay-modal-grand`, 26px, gold amount), PAYMENT
METHOD (`.pay-method-grid`, one button per method, the selected one filled gold), and
CONFIRM/CANCEL (`.pay-confirm-btn` green, `.pay-cancel-btn` neutral) — the three things the spec
requires never be ambiguous. The idle payment CTA (`.pay-cta`) always shows the label and the
exact amount together, large, on a green surface; it is disabled (not hidden) whenever
`payBlockedReason()` — the existing, unchanged gate — returns a reason.

Dangerous actions (`ЗАКРЫТО ЗАВЕДЕНИЕМ` / `ОТ ЗАВЕДЕНИЯ`) keep their existing behavior: both only
*request*, never execute — a manager decides. Both already required a typed reason plus an
explicit product-treatment choice before this stage; that requirement (the actual "deliberate
confirmation") was not weakened or strengthened, only recolored into the danger/info zone classes.

## Motion / accessibility

`cashier-pos.css` reuses the existing design-system motion tokens (`--boom-motion-fast/base`,
`--boom-ease`) and the same `@media (prefers-reduced-motion: reduce)` block pattern as
`waiter-pos.css` and `tokens.css` — it neutralizes its own transitions for every restyled element
under reduced motion. No total, price, or confirmation text carries a transition/animation rule at
all (verified by static guard), so there is nothing to disable in the first place: financial
numbers are never mid-transition, reduced motion or not. Every restyled interactive element
(`.cashier-btn`, `.order-card`, `.orders-filters button`, `.pay-method-btn`, `.pay-confirm-btn`,
search input) carries `boom-focusable`, which resolves to the shared `--boom-focus-ring` from
`tokens.css` — the same visible-focus mechanism the rest of the design system already uses.

## POS Media — deferred, not silently skipped

The spec asks Cashier POS to use the existing POS Media Engine "where appropriate." Checked and
declined for this pass: the only *read* endpoint an authenticated non-manager can call is
`GET /api/pos-media/current`, which is gated behind a **waiter session** (`getWaiterSession`), not
a manager/cashier JWT — Cashier POS authenticates via `useAuth()`, a completely different session
type. The manager endpoint (`GET /api/pos-media`) requires `pos.media.view`, which cashiers do not
hold. Wiring media into Cashier POS would require deciding whether to grant cashiers a new read
permission or add a new cashier-facing read endpoint — a permission/API surface decision, not a
"real UI integration bug," and explicitly out of scope for a stage that must not touch business
logic. Left as a named, deferred item rather than done partially or silently skipped.

## A real bug found and fixed while verifying this stage in a browser

Per the project rule that a UI/frontend stage must be driven in a real browser before being
reported done, this stage was the first in the project's history to actually render BOOM OS in a
headless Chromium session rather than relying on `tsc`/`vite build`/backend E2E alone. The app
failed to mount at all — `#root` stayed empty, `Cannot read properties of null (reading
'useContext')` — reproducing identically on the already-committed pre-35.7 state (`fc01642`), so
it long predates this stage's own changes.

Root cause: `src/components/AcceptanceTestModal.tsx` called `const { t } = useLanguage();` at
**module scope**, above the component's own definition (line 67, before `export const
AcceptanceTestModal` on line 69) — a Rules-of-Hooks violation. Since `App.tsx` imports this module
unconditionally, that line executed the instant the app's module graph loaded, long before any
React render existed to supply a hook dispatcher, crashing the entire application for every user,
on every screen — not just Cashier POS.

Fixed by moving the call inside the component body, immediately after its existing `useState`
declarations (`AcceptanceTestModal.tsx`). Verified: the app now mounts and renders correctly in a
real browser; a login → Cashier POS → unlock → open shift → select order → pay (CARD) → success →
appears in the payments ledger walkthrough was completed screenshot-by-screenshot with zero
console errors. A regression guard was added (`tests/stage35_7_cashier_pos_design_static.mjs`)
that fails if the hook call ever returns to module scope.

A second, unrelated observation from the same investigation, **not fixed** because it is outside
this stage's scope (Cashier POS only, no business/UX changes beyond it): `Header.tsx` declares an
`onOpenLoginModal` prop but never calls it, and no other component renders a visible "log in"
control — there is currently no way to open `LoginModal` from the UI. This did not block
verification (a valid JWT was set directly via `localStorage`, the same mechanism the real login
flow uses once it succeeds) but is a real, separate gap worth its own fix.

## Verification

- TypeScript (`tsc --noEmit`): PASS.
- `prisma validate`: PASS (schema untouched by this stage).
- `npx vite build`: PASS.
- esbuild server bundle: PASS.
- Full static suite (`npm run test:static`): PASS, including the new
  `tests/stage35_7_cashier_pos_design_static.mjs`.
- Full 29+ suite E2E regression (unchanged backend, run to confirm no business-logic regression):
  PASS.
- Live browser walkthrough (headless Chromium via Playwright): dashboard load → Cashier POS nav →
  POS unlock → shift open → order list/filters → order selection → item/discount/totals rendering
  → payment dialog (method grid, total, confirm) → payment success → ledger update, at desktop
  (1440px) and tablet (1024px) widths, and under `prefers-reduced-motion: reduce` — all screenshots
  clean, zero console errors beyond an expected font-CDN TLS failure (this sandbox's proxy) and
  expected 401s from pre-login telemetry calls.

## Known limitations

- POS Media is not wired into Cashier POS (see above — a permission/API decision, deferred).
- The missing login-button issue in `Header.tsx` is unrelated to Cashier POS and was left
  unfixed, as noted above.
- The pre-existing Vite >500KB bundle-size warning (documented in
  `docs/STAGE-35.6-HARDENING.md`) is unchanged by this stage.
