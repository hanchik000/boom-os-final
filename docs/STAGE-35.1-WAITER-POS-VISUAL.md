# Stage 35.1 — Waiter POS Visual Layer

## Status
Implemented as a presentation-only layer.

## Scope
- Applies the Stage 35.0 design tokens to the existing Waiter POS.
- Adds a dedicated visual stylesheet for the existing terminal/login, menu, category, smart-search, cart and order-summary surfaces.
- Adds responsive behavior for tablet/mobile clients using the same Waiter POS business logic.
- Adds reduced-motion handling.
- Keeps all API calls, cart mutation, pricing, Order Core and permissions in `WaiterPOSView.tsx`.

## Explicit non-goals
- No business-rule changes.
- No new order/payment logic.
- No duplicate menu/pricing source of truth.
- No video/media engine yet; that belongs to Stage 35.2.
- No visual catalog yet; that belongs to Stage 35.3.

## Verification
Static contract: `tests/stage35_1_waiter_pos_visual_static.mjs`.

## Next
Stage 35.2 — POS Motion + Video Media Engine.
