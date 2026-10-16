# Sprint 1 — Functional foundation (10 working days)

## Day 1–2: Scaffold and schema
- pnpm workspace with React/Vite web, Hono Worker API, shared types, Vitest, Wrangler.
- Local D1 migrations and seed script.
- Deliverable: app boots and schema migrates cleanly.

## Day 3–4: Identity and membership
- Invite/accept, secure sessions, membership middleware, admin authorization.
- Deliverable: uninvited user cannot access tournament resources.

## Day 5–6: Tournament configuration
- Draft creation, member selection, host, independent prices, blind levels, prize shares.
- Deliverable: create and validate a tournament, 100% prize allocation.

## Day 7–8: Financial engine
- Initial entries, rebuy request and approval, confirmed payments, ledger summaries.
- Deliverable: exactly 4 standard rebuys / 5 host rebuys; duplicate operations blocked.

## Day 9: Frontend screens
- Tournament list, create wizard, player list, live financial dashboard (polling acceptable in sprint 1).
- Deliverable: mobile-responsive functional flow.

## Day 10: QA and demo
- Integration tests, concurrency tests, financial invariants, D1 migration test, mobile review.
- Deliverable: demo with 6 players, entry CRC 10000, rebuy CRC 5000, 50/30/20 payout.

## Definition of Done
- Every mutation authenticated and authorized.
- No floating-point currency math.
- D1 transactions and idempotency on all financial writes.
- Sum of prize allocations equals committed valid entries after reconciliation.
- README with local setup and Cloudflare deployment commands.
- Tests pass, no unhandled security or data-integrity failures.

## Later sprints
Sprint 2: Durable Objects/WebSockets, authoritative clock, pause, alarms, reconnection, TV mode.
Sprint 3: polished casino UI, PWA, theme editor, production hardening.
Sprint 4: drag-and-drop Design Studio, accessibility audit, performance, observability.
