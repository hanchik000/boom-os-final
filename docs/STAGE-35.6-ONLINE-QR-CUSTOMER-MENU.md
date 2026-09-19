# Stage 35.6 — Online / QR / Customer Menu

ONLINE, QR, LOCAL and OFFLINE are not four menus. They are one customer menu
(`VisualCustomerMenuView`) reading one public endpoint chain (`/api/public/*`,
`/api/visual-catalog/public`), which reads the same Visual Catalog + Menu Engine data every other
BOOM OS surface reads. The only thing that differs per channel is *presentation* — which blocks
show — never a price, a product, or an availability rule.

```
ONLINE / QR / LOCAL / OFFLINE
        │  (channel = presentation targeting only)
        ▼
   Visual Catalog  (server/routes/visual-catalog.ts)
        │
        ▼
   Menu Engine  (menu_items / menu_categories — the same tables every other module reads)
        │
        ▼
   Order Core  (unchanged — this stage adds no order/payment path)
```

---

## 1. The channel model

`VisualCatalogBlock` gained one nullable column, `channels` (comma-separated
`ONLINE`/`QR`/`LOCAL`/`OFFLINE`). Empty/NULL means every channel — the pre-35.6 default, so every
block created before this stage keeps working unchanged. `GET /api/visual-catalog/public` accepts
`?channel=`, and the block list is filtered in that one place (`onChannel()`); nothing else in the
request changes — same categories, same items, same prices.

The manager sets channels per block from `VisualCatalogView` (checkboxes, `normalizeChannels()`
drops anything not in the fixed four-value set rather than storing a typo silently).

The client (`VisualCustomerMenuView`) resolves its own channel from, in order: an explicit
`?channel=` query param, a QR visit (see below, always `QR`), or a LAN-hostname heuristic
(`localhost`/private IP ranges → `LOCAL`), defaulting to `ONLINE`.

## 2. QR menu entry — server-side resolution, no IDOR surface

A QR code encodes **one opaque token**, never a branch id. `branches.qr_token` is a unique,
`crypto.randomBytes(18)`-generated column, nullable until a manager (re)generates one from
`BranchesView` (`GET/POST /api/branches/:id/qr[/regenerate]`, `branches.update`-gated,
`requireBranchAccess`).

`GET /api/public/qr/:token` is the *only* thing that turns a token into a branch, and it does so
with `SELECT id,name,code,address,phone,currency FROM branches WHERE qr_token=?` — the same
public-safe column list `/api/public/branches` already used. The client never supplies a branch id
in this flow: `VisualCustomerMenuView` reads `?qr=`, calls `resolveQrBranch()`, and **locks** the
branch selector to whatever the server returned. A guessed or tampered token simply fails to
resolve (404) — there is no branch id parameter anywhere in the QR request for an attacker to
manipulate, which is what makes the IDOR class of attack structurally impossible here rather than
merely checked for.

## 3. The Promotion Engine

Genuinely new — before this stage `orders.promotion_amount` was a reserved column that was always
`'0.00'`; no promotion could ever be created. `Promotion` (`server/routes/promotions.ts`) attaches
a real promotional price to a real `menu_item_id`, for a real `[starts_at, ends_at]` window:

- **Never a discount pretending to be a promotion**: `promo_price` must be strictly lower than the
  item's real price, checked against the live `menu_items.price` at creation
  (`PROMO_PRICE_NOT_A_DISCOUNT` otherwise).
- **Expiry is automatic, not a flag a job has to flip**: whether a promotion is live is computed on
  *every* read as `active AND starts_at <= now <= ends_at` (`activePromotionMap()`), never stored.
  The moment `ends_at` passes, the next read simply stops returning it.
- **One rule, everywhere it's needed**: both public reads (`public-menu.ts`'s `/menu` and
  `visual-catalog.ts`'s `/public`) call the exact same `activePromotionMap()` — a menu item's
  promotional price can never disagree between the plain menu and the visual catalog.
- **Placements** (`PRODUCT_CARD`/`CATALOG`/`BANNER`/`CATEGORY`/`PROMOTIONS_SECTION`) let a manager
  choose where a promotion surfaces, mirroring the channel-targeting pattern above.
- **Not the existing manual discount**: `OrderDiscount` (34.3) stays exactly what it is — a
  cashier/waiter applying a one-off reduction to one order. A promotion is a catalog-level price the
  server offers every guest who looks at that item; the two never share code or a table.
- Permissions: `promotions.view` / `promotions.manage`, manager-only, branch-scoped and audited
  like every other module.

The client renders `promo_price`/`promo_badge` exactly as received — there is no arithmetic on a
price anywhere in `VisualCustomerMenuView`.

## 4. Security

- Public routes (`public-menu.ts`, `visual-catalog.ts`'s `/public`) carry **no**
  `authenticateToken` — that is the point of a public menu — and select only public-safe columns:
  no recipe, no cost, no stock, no employee, no CRM data exists on this path at all (verified by a
  static guard against `recipe_cost|average_cost|current_stock|password_hash` appearing in either
  file).
- Manager routes (`promotions.ts`'s CRUD, `visual-catalog.ts`'s non-`/public` routes,
  `branches.ts`'s QR endpoints) all require authentication and their own permission, same as every
  other module.
- Branch isolation is enforced by the same `allowed()`/`requireBranchAccess` helpers used
  everywhere else — no new isolation mechanism was invented.

## 5. Offline stays a read cache

Nothing here changes Stage 35.5's rule: `public/boom-offline.js` never touches `/api/orders` or
`/api/payments`, and the customer menu view calls no order/payment endpoint at all — there is no
"place an order offline" path to secure because it does not exist. When the network returns, the
existing network-first cache strategy re-fetches the real catalog/menu/promotions from the server.

## 6. Reduced motion

The customer menu's hover/scale/translate transitions are Tailwind utilities, which do not read the
design system's `--boom-motion-*` CSS variables. `design-system/tokens.css` now also neutralizes
`.boom-motion` and every element under `.boom-reduced-motion-safe` (the menu's root element) when
`prefers-reduced-motion: reduce` is set — transitions/animations collapse to ~0 and hover
transforms are disabled, so motion can never sit on top of text, block a click, or block scroll.

## Verification

- `tests/stage35_6_online_qr_customer_menu_static.mjs` — 29 guards.
- TypeScript (`tsc --noEmit`), `prisma validate`, Vite production build and the esbuild server
  bundle all pass.
- Full static suite (all stages) green after this stage's migration was applied.

### Genuine defects found and fixed while merging Stage 35.5's handoff (not new scope)

The uploaded 35.5 handoff was verified before any 35.6 work began, per the review checklist:

1. **`boomcard-journal.ts` mounted at `/api/boomcard/journal` after `boomcardRouter`** — since
   Express matches mounts in registration order, `boomcardRouter`'s own `GET /:id`
   (`requirePermission('boomcard.view')`) would have intercepted every `/api/boomcard/journal`
   request before the journal router was ever reached, making the whole journal endpoint
   unreachable for any real user. This repo's own 34.12 journal was already correctly mounted
   *before* `boomcardRouter` at the shared `/api/boomcard` prefix (verified end-to-end by its own
   E2E), so that ordering was kept and the handoff's journal implementation was not adopted.
2. **`BIRTHDAY_GIFT_REDEEMED` could never fire** in the handoff's journal design — it read
   `boomcard_birthday_gifts.status='REDEEMED'`, but no endpoint in the handoff's `boomcard.ts` ever
   set that status. This repo's own 34.12 already includes a real
   `POST /api/boomcard/:id/birthday-gift/:giftId/redeem` endpoint, so this repo's journal was kept.
3. **`expected_cash` recomputation omitted `credit_repayments`** in both `payments.ts` (a CASH/CARD
   settlement) and `order-closure.ts` (a refund) — a real financial-integrity bug: a shift with any
   credit repayment posted would have its `expected_cash` silently reset to a value short by that
   repayment on the very next payment or refund. The handoff's fix for both was verified and
   adopted (`tests/stage34_13_final_integration_static.mjs` checks 6–7 pin this).
4. **`server/order-closure.ts` only reversed `service_charge_ledger` rows in status `EARNED`** on a
   refund/closure, missing `POOLED` and `DISTRIBUTED` rows — money already pooled or distributed
   for a since-cancelled order would never be reversed. The handoff's fix
   (`status IN ('EARNED','POOLED','DISTRIBUTED')`) was verified and adopted.
5. **A stale Stage 8 assertion** checked for an inline service-charge rounding expression in
   `orders.ts` that no longer exists there (centralized into `order-totals.ts` back in Stage 34.2) —
   currently failing in this repo. Fixed to check the real, current location.
6. **Two of this repo's own 34.11/34.12 assertions** had the same end-of-array literal-match
   brittleness already fixed elsewhere in the suite, now that `seed.ts`'s permission grant list grew
   further with 35.2–35.6 codes — generalized to parse-and-assert-membership, matching the
   established repair pattern, not relaxed.

All were negative-controlled (the forbidden behaviour was reintroduced and confirmed to fail its
guard) before being accepted, and a full 28-suite E2E regression against real PostgreSQL passed
after the merge, before any 35.6 code was written.
