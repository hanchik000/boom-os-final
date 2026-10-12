# Stage 44 — ADMIN on a phone · no dead ends · honest data freshness

Stage 44 closes the three items Stage 41–43 left on the backlog. It adds **no business
functionality**: no endpoint, no permission, no migration, no change to Order Core, Menu Engine,
Inventory, Recipe, Food Cost, financial logic, BOOMCARD/BOOMCOIN/BOOMBACK, CRM, RBAC or branch
isolation. Every change is in the client layer, and each one started from a measurement, not an
assumption.

---

## 1. What was wrong, measured

A probe (`probe_phone.mjs`) opened all 34 administrative screens at 390×844 and measured them.

| Measured | Result |
|---|---|
| Horizontal page overflow | **0 px on every screen** — the page itself never scrolled |
| `main` working width | **134 px of 390** on all 34 screens |
| Sidebar width | 256 px, fixed, on all 34 screens |

So the administrative interface had no phone mode at all: the sidebar never collapsed and the
content was squeezed into a third of the screen. Separately, a classification probe found content
that stuck out of the viewport with **no scrollable ancestor** — cut off, not reachable:

* `commandCenter` — the waiter and cashier tables (507 px wide, clipped at 390)
* `foodCost` — the food-cost table (507 px, clipped)
* `boomcardJournal` — the journal table (463 px, clipped)
* `employees` — the "Код официанта" column of the employee list

A third probe looked for screens that render nothing and explain nothing. It found six that
dead-ended for any account **without a branch of its own** (an owner, a network manager, a
franchise-level account):

| Screen | What it did |
|---|---|
| `kitchen`, `expo` | "Экран кухни работает в филиале — у вашей учётной записи он не выбран." |
| `receiptSettings` | "У вас нет назначенного филиала." |
| `foodCost`, `analytics`, `creditReports` | rendered the tab bar and an empty period — **said nothing at all** |

And the three kitchen screens polled every 15–30 s with a blind `setInterval`: they kept polling
while the tab was hidden, never said how old the board was, and a failed refresh showed a bare
error over a board the cook could no longer date.

---

## 2. What changed

### The phone layout (`src/App.tsx`, `Sidebar.tsx`, `Header.tsx`, `admin-ui.css`)

Below the tablet breakpoint the sidebar is a drawer: `max-md:fixed`, off-screen
(`max-md:-translate-x-full`) until opened, with `data-drawer-open` on the element so its state can
be verified rather than assumed. It closes on choosing a destination, on Escape, and on a tap
beside it (`#boom-nav-backdrop`, `md:hidden`). The header carries the only way to open it
(`#btn-open-nav`) and wraps instead of pushing the page title out of view; the branch and franchise
scope selectors stay **usable** on a phone — they wrap, they are not hidden, because choosing a
branch is how a manager reads the right numbers.

The drawer's own hooks sit **above** the shell's loading early-return. Placing them below it was a
real crash, caught in the browser: *"Rendered more hooks than during the previous render"* blanked
the whole application. A static guard now pins the order.

The trigger's breakpoint lives in `admin-ui.css`, not as a Tailwind `md:hidden`: that stylesheet is
registered after the utilities and `.btn-secondary` sets its own `display`, so the utility lost and
the button stayed visible on a desktop. This was found by browser measurement, not by reading.

### Nothing is cut off (13 table wrappers, `command-center.css`, `EmployeesView.tsx`)

Every wrapper that directly holds a table now scrolls sideways instead of clipping it — the same
`overflow-x-auto` idiom UsersView, AuditView, SettingsView and DashboardView already used.
`.cmd-table-wrap` scrolls, and the employee list scrolls as a whole (`min-w-[620px]` on its rows).

### One rule for "which branch is this screen about" (`src/useBranchScope.ts`)

The order of preference is the one the system already followed in InventoryView and
KitchenControlView, now in one place: **the account's own branch** → **the scope chosen in the page
header** → **the first branch the account may see**. The branch list is read only by someone with
`branches.view`, through the existing `api.getBranches()`; the server still decides what every
branch request returns. A selector is offered only when there is more than one branch to choose, so
a cook is never asked to pick anything. Where there is genuinely no branch, the screen says so and
says where to choose one.

### Honest freshness (`src/freshness.ts`, the three kitchen screens)

The "N назад" wording moved out of ManagerCommandCenterView into `src/freshness.ts` — one source,
same behaviour (Stage 35.9's own guard still passes, 32/32). The kitchen, the pass and the kitchen
control screen now:

* record `lastUpdatedAt` **only** after a successful read, never in a `catch`;
* show that age (`#kt-last-updated`, `#expo-last-updated`, `#kitchen-control-last-updated`) with a
  display-only one-second ticker that never fetches;
* pause polling while the tab is hidden and read once immediately on return;
* on a failed refresh keep the last real board on screen under a stale notice that **dates the data
  it is showing** instead of inventing a value; a failure with nothing to show yet stays a plain
  error.

---

## 3. Real defects found and fixed during the stage

1. **ADMIN had no phone layout** — 134 px of working width on all 34 screens (root cause measured,
   not guessed).
2. **The hook-order crash** — the drawer state declared after the shell's loading early-return
   blanked the application with "Rendered more hooks than during the previous render".
3. **`md:hidden` lost to `.btn-secondary`** — the phone nav trigger stayed visible on tablet and
   desktop until its breakpoint moved next to its own styles.
4. **Four clipped regions** — three tables and the employee list's last column were unreachable on
   a phone, with document overflow still reading 0 (which is why the first probe looked clean).
5. **Six dead-end screens** for accounts without a home branch; three of them (`foodCost`,
   `analytics`, `creditReports`) rendered an empty shell and said nothing.
6. **Kitchen screens polled while hidden** and never dated their board.

---

## 4. Test results (actually run)

| Suite | Result |
|---|---|
| `tests/stage44_admin_phone_freshness_static.mjs` | **39/39 PASS** |
| Stage 44 negative controls (8) | **8/8 behaved correctly** — each guard failed when its protection was removed, then the file was restored |
| Browser: navigation (`verify44_nav.mjs`, phone 390 / tablet 820 / desktop 1440) | **18/18 PASS** |
| Browser: freshness (`verify44_fresh.mjs`) | **14/14 PASS** |
| All static suites (`tests/*_static.mjs`) | **63/63 suites PASS** |
| Full E2E regression (`tests/*_e2e.mjs`, 36 suites, fresh DB each) | see §6 |
| `npm run lint` (`tsc --noEmit`) | clean |
| `npm run build` | clean |

Phone re-measurement after the fixes, all 34 administrative screens: document overflow **0**,
`main` **390 px**, and **no clipped region on any screen**.

### Negative controls

| # | What was broken | Guard that must fail |
|---|---|---|
| NC1 | drawer put back into the layout flow (the 134 px bug) | drawer is lifted out of the layout |
| NC2 | a table wrapper clips its table again | no wrapper clips its table |
| NC3 | drawer state declared after the loading early-return | hook order is fixed |
| NC4 | a failed read backdates the screen as fresh | failure never writes `lastUpdatedAt` |
| NC5 | branch selector shown when there is nothing to choose | selector only when > 1 branch |
| NC6 | a second copy of the freshness wording in a screen | the wording lives in one module |
| NC7 | nav trigger back to a Tailwind utility that loses | breakpoint lives with its own styles |
| NC8 | a screen reads only the account's own branch again | every screen uses the shared rule |

---

## 5. Files

**New**
* `src/useBranchScope.ts` — the one branch-selection rule
* `src/freshness.ts` — the one "N назад" wording
* `tests/stage44_admin_phone_freshness_static.mjs` — 39 source guards
* `docs/STAGE-44-ADMIN-PHONE-FRESHNESS-REPORT.md`

**Changed** — `src/App.tsx`, `src/components/Sidebar.tsx`, `Header.tsx`,
`KitchenStationView.tsx`, `ExpoView.tsx`, `KitchenControlView.tsx`, `ReceiptSettingsView.tsx`,
`FoodCostView.tsx`, `AnalyticsView.tsx`, `CreditReportsView.tsx`, `EmployeesView.tsx`,
`BoomcardJournalView.tsx`, `FranchiseDetailModal.tsx`, `ManagerCommandCenterView.tsx`,
`src/design-system/admin-ui.css`, `command-center.css`, `kitchen.css`,
`src/translations/ru.ts`, `src/translations/tk.ts`.

**Untouched** — no file under `server/`, `prisma/` or `server.ts`: zero migrations, zero API
changes, zero permission changes.

---

## 6. Limitations, stated plainly

* **A global administrative search does not exist.** It is new functionality, not a UX
  unification, and it remains out of scope until it is asked for as its own stage.
* The phone drawer is a navigation layout, not a redesign of each screen for a phone: wide tables
  are now **reachable by scrolling sideways**, not reflowed into cards. Reflowing them is a design
  decision with real cost and was not assumed.
* `kitchen` and `expo` are built for a kitchen screen; on a phone they work, but they were designed
  for a wall-mounted tablet and still read best there.
