# Poker Tournament Manager — API v1
Base: `/api/v1`. Authenticated requests use secure HttpOnly sessions. Mutating financial requests require `Idempotency-Key`. Amounts are integer minor units (CRC: whole colones). All timestamps are UTC ISO-8601.

## Authentication
- `POST /auth/invitations` (super admin): `{email}` -> `202 {invitationId}`; send expiring single-use email link.
- `POST /auth/invitations/accept` (public with token): `{token,displayName}` -> session; never return raw tokens in logs.
- `POST /auth/logout` -> `204`.
- `GET /me` -> `{id,email,displayName,role}`.

## Tournaments
- `POST /tournaments` (super admin): `{title,hostUserId,currency:"CRC",entryPriceMinor:10000,rebuyPriceMinor:5000,maxRebuys:4,hostExtraRebuys:1,prizeRules:[{place:1,basisPoints:5000},{place:2,basisPoints:3000},{place:3,basisPoints:2000}],blindLevels:[{levelNo:1,kind:"play",smallBlind:100,bigBlind:200,ante:0,durationSeconds:120}]}` -> `201 {id,version}`.
- `GET /tournaments` -> tournaments authorized for caller.
- `GET /tournaments/:id` -> tournament details; only authorized members.
- `POST /tournaments/:id/members` (admin): `{userId}` -> `201`.
- `POST /tournaments/:id/start` (admin) -> `200 {status:"live"}`; create initial entry obligations atomically for confirmed members.
- `GET /tournaments/:id/summary` -> `{committedMinor,collectedMinor,outstandingMinor,projectedPrizes:[...]}`.

## Rebuy workflow
- `POST /tournaments/:id/rebuy-requests` (member): `{}` -> `201 {id,status:"pending"}`. One pending per player.
- `GET /tournaments/:id/rebuy-requests` (member) -> visible requests.
- `POST /tournaments/:id/rebuy-requests/:requestId/approve` (admin): `{}` -> `200 {entryId,status:"approved"}`; transaction checks limits and current state, creates entry + audit + outbox event.
- `POST /tournaments/:id/rebuy-requests/:requestId/reject` (admin): `{reason}` -> `200`.

## Payments
- `POST /tournaments/:id/payments` (admin): `{userId,method:"cash"|"transfer"|"other",amountMinor,reference?}` -> `201 {id,status:"reported"}`.
- `POST /tournaments/:id/payments/:paymentId/confirm` (admin) -> `200 {status:"confirmed"}`.
- `GET /tournaments/:id/ledger` (member) -> paginated entries, payments, balances and audit-safe details.

## Blinds / clock
- `PUT /tournaments/:id/blind-levels` (admin, draft/ready): `{levels:[...]}` -> `200`.
- `GET /tournaments/:id/clock` (member) -> `{state,levelNo,remainingSeconds,serverTime,version}`.
- `POST /tournaments/:id/clock/actions` (admin): `{action:"start"|"pause"|"resume"|"next"|"reset",expectedVersion}` -> updated state.
- `GET /tournaments/:id/events` (member, WebSocket upgrade) -> versioned events `{id,type,tournamentId,version,occurredAt,payload}`; reconnect via snapshot.

## Results
- `POST /tournaments/:id/finalize` (admin): `{winners:[{place:1,userId},...]}` -> calculated allocations, requires 10000 basis points total and reconciliation checks.
- `POST /tournaments/:id/close` (admin) -> closed state, audited.

## Errors
`400 VALIDATION_ERROR`, `401 UNAUTHENTICATED`, `403 FORBIDDEN`, `404 NOT_FOUND`, `409 CONFLICT`, `422 BUSINESS_RULE_VIOLATION`, `429 RATE_LIMITED`. JSON shape: `{error:{code,message,details?,requestId}}`.

## Transaction rules
Use D1 `batch()` for atomic multi-statement transactions and conditional SQL writes for race-sensitive state changes. Check affected rows. Enforce idempotency with unique keys and request hashes; same key + different payload returns 409. Persist outbox event in same transaction and deliver asynchronously. D1 SQL CHECK cannot validate cross-row limits or percentages: validate in service layer inside the transactional workflow. Payment allocation totals and overpayment policies require service-level validation. Do not treat this starter schema as a complete production accounting ledger.
