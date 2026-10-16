import type { GlobalRole } from "@pkr/domain";
import { nowIso, randomId } from "../crypto";
import type { AppDB } from "../db/app-db";
import { ApiError, type Idem } from "../http";
import {
  assertCanHandleMoney,
  assertCanRead,
  auditStmt,
  rememberStmt,
  withOptional,
} from "./support";

export async function requestRebuy(
  db: AppDB,
  tournamentId: string,
  userId: string,
  input: { method?: "cash" | "transfer" | "other"; note?: string },
  idem: Idem | null,
): Promise<{ id: string; status: "pending" }> {
  const { member } = await assertCanRead(db, tournamentId, { id: userId, role: "player" });
  if (!member || member.player_status === "withdrawn") {
    throw new ApiError(403, "FORBIDDEN", "No puedes solicitar una recompra");
  }
  const id = randomId();
  const body = { id, status: "pending" as const };
  const result = await db.batch(
    withOptional(
      [
        db
          .prepare(
            `INSERT INTO rebuy_requests (id, tournament_id, user_id, status, method, note, requested_at)
             SELECT ?, ?, ?, 'pending', ?, ?, ?
             WHERE EXISTS (
               SELECT 1 FROM tournament_members m
               JOIN tournaments t ON t.id = m.tournament_id
               WHERE m.tournament_id = ? AND m.user_id = ? AND m.player_status = 'active' AND t.status = 'live'
             )
             AND NOT EXISTS (
               SELECT 1 FROM rebuy_requests r
               WHERE r.tournament_id = ? AND r.user_id = ? AND r.status = 'pending'
             )
             AND (
               SELECT COUNT(*) FROM entries e
               WHERE e.tournament_id = ? AND e.user_id = ? AND e.kind = 'rebuy' AND e.status = 'valid'
             ) < (
               SELECT max_rebuys + CASE WHEN host_user_id = ? THEN host_extra_rebuys ELSE 0 END
               FROM tournaments WHERE id = ?
             )`,
          )
          .bind(
            id,
            tournamentId,
            userId,
            input.method ?? null,
            input.note ?? null,
            nowIso(),
            tournamentId,
            userId,
            tournamentId,
            userId,
            tournamentId,
            userId,
            userId,
            tournamentId,
          ),
      ],
      rememberStmt(db, idem, 201, body, "EXISTS (SELECT 1 FROM rebuy_requests WHERE id = ?)", [id]),
    ),
  );
  if (result[0]?.changes !== 1) {
    const pending = await db
      .prepare(
        "SELECT id FROM rebuy_requests WHERE tournament_id = ? AND user_id = ? AND status = 'pending'",
      )
      .bind(tournamentId, userId)
      .first();
    if (pending) throw new ApiError(409, "CONFLICT", "Ya tienes una recompra pendiente");
    throw new ApiError(422, "BUSINESS_RULE_VIOLATION", "No puedes solicitar otra recompra");
  }
  return body;
}

export async function approveRebuy(
  db: AppDB,
  tournamentId: string,
  requestId: string,
  actor: { id: string; role: GlobalRole },
  method: "cash" | "transfer",
  idem: Idem | null,
): Promise<{ entryId: string; status: "approved" }> {
  await assertCanHandleMoney(db, tournamentId, actor);
  const entryId = randomId();
  const paymentId = randomId();
  const decidedAt = nowIso();
  const body = { entryId, status: "approved" as const };
  const exists = "EXISTS (SELECT 1 FROM entries WHERE id = ?)";
  const results = await db.batch(
    withOptional(
      [
        db
          .prepare(
            `UPDATE rebuy_requests
             SET status = 'approved', method = ?, decided_at = ?, decided_by = ?
             WHERE id = ? AND tournament_id = ? AND status = 'pending'
             AND (
               SELECT COUNT(*) FROM entries e
               WHERE e.tournament_id = rebuy_requests.tournament_id
                 AND e.user_id = rebuy_requests.user_id
                 AND e.kind = 'rebuy' AND e.status = 'valid'
             ) < (
               SELECT t.max_rebuys + CASE WHEN t.host_user_id = rebuy_requests.user_id THEN t.host_extra_rebuys ELSE 0 END
               FROM tournaments t WHERE t.id = rebuy_requests.tournament_id
             )`,
          )
          .bind(method, decidedAt, actor.id, requestId, tournamentId),
        db
          .prepare(
            `INSERT INTO entries (id, tournament_id, user_id, kind, rebuy_request_id, amount_minor, status, created_by, created_at, used_at)
             SELECT ?, r.tournament_id, r.user_id, 'rebuy', r.id, t.rebuy_price_minor, 'valid', ?, ?, ?
             FROM rebuy_requests r
             JOIN tournaments t ON t.id = r.tournament_id
             WHERE r.id = ? AND r.status = 'approved' AND r.decided_at = ?
               AND NOT EXISTS (SELECT 1 FROM entries e WHERE e.rebuy_request_id = r.id)`,
          )
          .bind(entryId, actor.id, decidedAt, decidedAt, requestId, decidedAt),
        db
          .prepare(
            `INSERT INTO ledger_entries (id, tournament_id, user_id, entry_id, payment_id, kind, amount_minor, direction, created_at)
             SELECT ?, e.tournament_id, e.user_id, e.id, NULL, 'obligation_created', e.amount_minor, 'debit', ?
             FROM entries e WHERE e.id = ?`,
          )
          .bind(randomId(), decidedAt, entryId),
        db
          .prepare(
            `INSERT INTO payments (id, tournament_id, user_id, method, amount_minor, status, reference, confirmed_by, created_at, confirmed_at)
             SELECT ?, e.tournament_id, e.user_id, ?, e.amount_minor, 'confirmed', NULL, ?, ?, ?
             FROM entries e WHERE e.id = ?`,
          )
          .bind(paymentId, method, actor.id, decidedAt, decidedAt, entryId),
        db
          .prepare(
            `INSERT INTO payment_allocations (payment_id, entry_id, amount_minor)
             SELECT ?, e.id, e.amount_minor FROM entries e WHERE e.id = ?`,
          )
          .bind(paymentId, entryId),
        db
          .prepare(
            `INSERT INTO ledger_entries (id, tournament_id, user_id, entry_id, payment_id, kind, amount_minor, direction, created_at)
             SELECT ?, p.tournament_id, p.user_id, ?, p.id, 'payment_confirmed', p.amount_minor, 'credit', ?
             FROM payments p WHERE p.id = ? AND p.status = 'confirmed'`,
          )
          .bind(randomId(), entryId, decidedAt, paymentId),
        db
          .prepare(
            `INSERT INTO outbox_events (id, tournament_id, event_type, payload_json, created_at, published_at)
             SELECT ?, tournament_id, 'rebuy.approved', ?, ?, ?
             FROM entries WHERE id = ?`,
          )
          .bind(randomId(), JSON.stringify({ entryId, requestId }), decidedAt, decidedAt, entryId),
        auditStmt(
          db,
          tournamentId,
          actor.id,
          "rebuy.approve",
          "rebuy_request",
          requestId,
          { entryId, method },
          exists,
          [entryId],
        ),
      ],
      rememberStmt(db, idem, 200, body, exists, [entryId]),
    ),
  );
  if (results[1]?.changes !== 1) {
    throw new ApiError(
      422,
      "BUSINESS_RULE_VIOLATION",
      "La recompra ya no está pendiente o supera el límite",
    );
  }
  return body;
}

export async function rejectRebuy(
  db: AppDB,
  tournamentId: string,
  requestId: string,
  actor: { id: string; role: GlobalRole },
  reason: string | undefined,
  idem: Idem | null,
): Promise<{ status: "rejected" }> {
  await assertCanHandleMoney(db, tournamentId, actor);
  const decidedAt = nowIso();
  const body = { status: "rejected" as const };
  const marker =
    "EXISTS (SELECT 1 FROM rebuy_requests WHERE id = ? AND status = 'rejected' AND decided_at = ?)";
  const results = await db.batch(
    withOptional(
      [
        db
          .prepare(
            `UPDATE rebuy_requests SET status = 'rejected', decided_at = ?, decided_by = ?
             WHERE id = ? AND tournament_id = ? AND status = 'pending'`,
          )
          .bind(decidedAt, actor.id, requestId, tournamentId),
        auditStmt(
          db,
          tournamentId,
          actor.id,
          "rebuy.reject",
          "rebuy_request",
          requestId,
          { reason: reason ?? null },
          marker,
          [requestId, decidedAt],
        ),
      ],
      rememberStmt(db, idem, 200, body, marker, [requestId, decidedAt]),
    ),
  );
  if (results[0]?.changes !== 1)
    throw new ApiError(409, "CONFLICT", "La solicitud ya fue decidida");
  return body;
}

export async function listRebuyRequests(
  db: AppDB,
  tournamentId: string,
  user: { id: string; role: GlobalRole },
) {
  await assertCanRead(db, tournamentId, user);
  return db
    .prepare(
      `SELECT r.id, r.user_id AS userId, u.display_name AS displayName, r.status, r.method, r.note,
              r.requested_at AS requestedAt, r.decided_at AS decidedAt,
              t.rebuy_price_minor AS amountMinor
       FROM rebuy_requests r
       JOIN users u ON u.id = r.user_id
       JOIN tournaments t ON t.id = r.tournament_id
       WHERE r.tournament_id = ?
       ORDER BY r.requested_at DESC`,
    )
    .bind(tournamentId)
    .all();
}
