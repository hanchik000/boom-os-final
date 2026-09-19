# BOOM OS Design System — Stage 35.0

This stage establishes the visual contract without redesigning existing screens.

## Principles

1. Function before decoration.
2. Black/graphite foundation, white text, restrained metallic-gold accent.
3. Existing business screens must not change behavior because of the design system.
4. Animation is progressive enhancement and must respect `prefers-reduced-motion`.
5. Touch targets, readability, ordering speed and financial correctness take priority over visual effects.
6. New 35.x components should consume the `--boom-*` tokens instead of inventing local design constants.

## Token groups

- surfaces and borders
- typography colors
- BOOM gold accent and semantic states
- radii and elevation
- motion durations/easing
- keyboard/focus treatment

## Planned consumers

- 35.1 Waiter POS visual layer
- 35.2 POS motion/video media engine
- 35.3 Visual Catalog
- 35.4 Menu Media Engine
- 35.5 Offline Menu + Offline Media
- 35.6 Online / QR / Customer Menu
- 35.7 Cashier POS
- 35.8 Manager Dashboard
- 35.9 Unified BOOM OS UX
