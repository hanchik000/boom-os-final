# Claude Handoff — BOOM OS

Historical checkpoint: **Stage 34.12 was implemented; Stage 34.13 has now been implemented locally.**

## What was added
- Unified read-only BOOMCARD Operations Journal endpoint: `GET /api/boomcard/journal`.
- Source-of-truth sources: `boomback_ledger`, `boomcoin_ledger`, `boomcard_events`, `boomcard_birthday_gifts` for actual redeemed birthday gifts.
- Event normalization for BOOMBACK, BOOMCOIN, breakfasts, birthday benefits, BOOMCARD lifecycle.
- Server-side branch isolation, event validation, filters and pagination.
- New permission: `boomcard.journal.view`.
- Manager UI: `BoomcardJournalView` with RU/TK navigation, event/date filters and pagination.
- API client wiring and route registration.
- Static guard: `tests/stage34_12_boomcard_journal_static.mjs` (15/15 passed in this handoff environment).
- Documentation: `docs/STAGE-34.12-BOOMCARD-OPERATIONS-JOURNAL.md`.

## Important
This is a working development checkpoint, not a claim of full production verification. PostgreSQL-backed E2E was not run in this handoff environment because the dependency installation/runtime database were unavailable.

## Next task
Use `docs/CLAUDE-HANDOFF-34.13.md`. Stage 34.13 implementation is already present; only dependency/runtime verification and any real regression fixes remain. Do not redo 34.12. First inspect the current working tree and validate the 34.12 route/UI/types. Then run the existing regression suite and add only the missing integration checks.

34.13 should verify the real cross-module flows using existing business logic and Order Core, especially:
- waiter -> order -> KDS -> payment -> inventory -> receipt -> analytics
- customer -> manual discount -> payment
- credit sale -> repayment
- BOOMCARD -> BOOMCOIN / BOOMBACK / breakfast
- controlled establishment closure -> refund
- compliment -> approval -> real zero-price order line -> inventory cost
- split bill -> independent payments -> single Order Core analytics count
- recipe version -> historical cost snapshot
- branch/RBAC isolation and audit

Do not redesign the UI in 34.13.
Do not rewrite the architecture.
Do not create duplicate ledgers or business logic.
After 34.13, stop before 35.x and report verified vs manual-acceptance vs deferred work.
