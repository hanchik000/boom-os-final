# Stage 35.9 — Manager Command Center Live Operations

## Objective

Make the already-correct Manager Command Center (Stage 35.8) operationally reliable when a
manager keeps it open for a working shift: manual refresh, controlled automatic refresh, a
visible "last updated" indicator, safe handling of refresh failures, and no visual flicker or
uncontrolled polling. This is a frontend-only reliability layer — no new business logic, no new
endpoint, no change to any financial calculation, Order Core, payment, credit, inventory, or RBAC
code.

## Inspection before changing anything

`ManagerCommandCenterView.tsx` already called `api.getManagerDashboard({ branch_id, start, end })`
(the existing `/api/dashboard/manager` route, unchanged, still `dashboard.view` + branch-scope
gated) on mount and on every branch/date-filter change, plus a 45s `setInterval` that already
cleaned itself up correctly on unmount/filter-change. `src/api.ts`'s generic `request()` helper has
no `AbortController`/sequencing support to reuse, and no other component in the project uses
`document.visibilitychange` — so both the request-race protection and the visibility-based pause
are new, small, local additions to this one component, not a new shared architecture. No backend
change was needed: the endpoint already returns everything this stage displays.

## Refresh architecture

- **`requestIdRef`** (a `useRef<number>` counter) — the race-protection mechanism. Every `load()`
  call increments it and captures its own id; the response (success or failure) is only applied to
  state if `requestIdRef.current` still equals that id when it resolves. A slower, superseded
  response (e.g. one still in flight for a filter combination the manager has since changed away
  from) is silently discarded — the visible dashboard always corresponds to the newest request.
- **`busyRef`** (a `useRef<boolean>`) — a simple duplicate-request guard used only at the two call
  sites that could otherwise fire a redundant network call for the *same* filters: the manual
  refresh button and the auto-poll tick. Both check `!busyRef.current` before calling `load()`.
  The filter-change effect (`useEffect(() => { void load('initial') }, [load])`) deliberately does
  **not** check this guard — a branch/date change is always a new, deliberate request and must
  fire immediately regardless of what was already in flight; `requestIdRef` is what keeps that
  safe.
- **`load(mode)`** — the one fetch function, unchanged in what it requests. `mode` only decides
  which loading flag it sets (`loading` for the no-data-yet initial fetch, `refreshing` for a
  background fetch with data already on screen) — it never changes the request itself.

## Polling behaviour

Exactly one `setInterval` exists per mounted instance, at `REFRESH_MS = 30000` (30s, the only
timing constant changed by this stage; previously 45s). The polling `useEffect` re-creates its
interval only when `load`'s identity changes (i.e. when `branchId`/date range change), always
clearing the previous one first via the effect's cleanup — the same pattern the pre-existing code
already used, now combined with visibility handling:

- `document.visibilitychange` → tab hidden: the interval is stopped (`clearInterval`, `timer` reset
  to `null`) — no request fires while the tab is in the background.
- → tab visible again: one immediate refresh fires (guarded by `busyRef`, same as a manual click),
  then the interval restarts from that point.
- Component unmount: the effect's cleanup stops the interval and removes the listener, same as any
  React effect teardown.

A second, independent, display-only `setInterval` (1s) exists purely to re-render the "N sec/min
ago" text as time passes; it touches no request state, fetches nothing, and is paused/resumed by
the same visibility pattern for symmetry, though its cost is negligible either way.

## "Last updated"

`lastUpdatedAt` (a `useState<number | null>`, a client-side `Date.now()` timestamp) is set **only**
inside `load()`'s success path, immediately after `setData(r)`. It is never touched by a failed
request and never touched merely because the poll timer fired — only by data actually arriving.
`agoFragment()`/`timeAgoLabel()` are small local formatters (`"только что"` / `"N сек назад"` /
`"N мин назад"` / `"N ч назад"`), following the file's own established `ru ? '...' : '...'`
inline-ternary i18n convention rather than introducing the separate `t()` translation-key system
`Header.tsx` uses elsewhere — consistent with how every other string in this file already works,
not a second i18n system.

## Stale-data / error handling

Two distinct banners, both new:

- **`.cmd-stale`** (amber, quiet): shown when a refresh fails **and** `data` from a previous
  successful fetch is still present. The dashboard underneath keeps rendering that data — nothing
  is cleared, hidden, or replaced with a placeholder. Text: *"Не удалось обновить данные. Показаны
  данные от N назад."*, matching the spec's example.
- **`.cmd-error`** (red, the pre-existing style): shown only when there is no `data` at all (the
  original initial-load-failure case, unchanged from Stage 35.8).

A later successful refresh clears `error` (`setError('')` on the success path, as before), which
removes whichever banner was showing — no separate "clear stale" logic was needed since both
banners are simple `{error && data ...}` / `{error && !data ...}` conditionals on the same state.

## No visual flicker

`{loading && !data && <div className="cmd-loading">…}` — this guard already existed before Stage
35.9 and already prevented the full-panel spinner from ever reappearing once `data` has loaded
once, for any reason (manual refresh, auto refresh, or a filter change). Stage 35.9 did not touch
this guard; it only added a quiet, secondary indicator (the refresh button's spinner + the
"Обновляется…" header text) for the cases that guard already excludes. No skeleton state, no
page-level blank, was ever introduced.

## Filter preservation

`branchId`, `preset`, `customStart`, `customEnd` are unchanged `useState` values in the same
component; `load()` reads them via closure (`branchId`, `range.start`, `range.end`) exactly as
Stage 35.8 did. Neither manual refresh, auto refresh, nor the visibility-resume refresh ever calls
`setBranchId`/`setPreset`/`setCustomStart`/`setCustomEnd` — there is no code path in this stage
that could revert a selected filter.

## Data race protection

Covered above (`requestIdRef`). No `AbortController` was added since the project's `fetch`-based
`request()` helper doesn't expose one to hook into, and adding one project-wide was judged out of
scope for a focused UX stage — the generation-counter approach is the "smallest safe mechanism"
the task explicitly asked for, and it fully prevents an out-of-order response from ever reaching
the screen.

## Authorization / branch isolation

Untouched. `server/routes/dashboard.ts`'s `requirePermission('dashboard.view')` and
`if (!branchId || !allowed(req, branchId)) return 403` are exactly as they were in Stage 35.8 —
this stage made no backend change at all. The branch selector still drives the one `branchId`
value the single API call uses; there is no client-side branch filtering standing in for the
server's own check.

## Accessibility / reduced motion

The refresh button carries `aria-label`, `aria-busy`, and the existing `disabled` state (now also
`true` during a background `refreshing`, not only the initial `loading`); the "last updated" text
is `aria-live="polite"` so a screen reader announces it without interrupting. Under
`prefers-reduced-motion: reduce`, `command-center.css` now also stops the refresh icon's spin
animation specifically (`.cmd-refresh-btn svg.animate-spin{animation:none}`) — the button's
disabled state and the "Обновляется…" text still communicate the same information without it.

## Tests

`tests/stage35_9_live_operations_static.mjs` — 28 checks covering the refresh control, the race/
duplicate-request protections, single-interval + visibility pause/resume + cleanup, the
last-updated state machine, the stale-vs-hard-error distinction, filter preservation, "no page
reload", and re-confirmation that no client-side financial arithmetic or SALES/RECEIVED/
RECEIVABLES merging was introduced (the same invariants Stage 35.8's suite already pins, reasserted
here since this stage touches the same file).

## Verification

- TypeScript (`tsc --noEmit`): PASS.
- `prisma validate`: PASS (schema untouched — no backend change in this stage).
- `npx vite build`: PASS.
- esbuild server bundle: PASS.
- Full static suite (`npm run test:static`), including Stage 35.8's and this stage's own suite:
  PASS.
- Stage 32 (`stage32_manager_dashboard_static.mjs`/`_e2e.mjs`) and Stage 33
  (`stage33_live_operations_static.mjs`/`_e2e.mjs`) suites: PASS, unchanged — this stage did not
  touch the backend those exercise.
- Full E2E regression: PASS.
- Live browser walkthrough (headless Chromium): manager login → dashboard load → last-updated
  indicator appears → manual refresh (loading state, no flicker, data still visible throughout) →
  branch/date filter change (filters preserved, correct new data loads) → waited through a full
  30s auto-refresh cycle (last-updated advances) → tab hidden/visible cycle (network calls verified
  to pause while hidden, resume with an immediate refresh on return) → simulated refresh failure
  (server briefly stopped: old data stayed visible, stale banner appeared) → connectivity restored
  (next successful refresh cleared the stale banner) → desktop/tablet/mobile widths → reduced
  motion → console checked at each step.

## Known limitations

- No `AbortController`-based true request cancellation — the generation-counter discards a stale
  *response* on arrival, but does not cancel the underlying in-flight HTTP request itself. Given
  the project's existing `request()` helper has no support for this and the dashboard call is a
  lightweight read, this was judged acceptable and is the documented trade-off of the "smallest
  safe mechanism" instruction.
- The pre-existing Vite >500KB bundle-size warning (documented in `docs/STAGE-35.6-HARDENING.md`)
  is unchanged by this stage.
- **A genuine pre-existing defect found during mobile verification, not fixed here**: the app's
  persistent sidebar (`#boom-sidebar` in the shared App shell) has no responsive collapse below
  roughly 600px width, so at a real mobile viewport (390px) it consumes most of the screen and the
  page overflows horizontally — on every screen in the application, not specifically the Command
  Center. Verified this is not something this stage introduced or can fix within its own scope:
  hiding the sidebar in isolation at 390px showed the Command Center's own content column,
  including this stage's toolbar (branch/date filters, "last updated", refresh button), lays out
  and wraps correctly with zero horizontal overflow on its own. Making the sidebar itself
  responsive is a whole-app-shell change well outside "restyle/harden the Command Center" and was
  left as a documented, separate, pre-existing item rather than opportunistically redesigned.
- `Header.tsx`'s dead `onOpenLoginModal` prop (documented in `docs/STAGE-35.7-CASHIER-POS-DESIGN
  .md`) remains unrelated to this stage and unfixed.
