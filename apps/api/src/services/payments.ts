import { type GlobalRole, allocatePayment, canAdminister, toMinor } from "@pkr/domain";
import { nowIso, randomId } from "../crypto";
import type { AppDB, Stmt } from "../db/app-db";
import { ApiError, type Idem } from "../http";
import {
  assertCanHandleMoney,
  assertCanRead,
  auditStmt,
  rememberStmt,
  withOptional,
} from "./support";

export async function createPayment(
  db: AppDB,
  tournamentId: string,
  actor: { id: string; role: GlobalRole },
  input: {
    userId: string;
    method: "cash" | "transfer" | "other";
    amountMinor: number;
    reference?: string;
  },
  idem: Idem | null,
): Promise<{ id: string; status: "reported" }> {
  const { member } = await assertCanRead(db, tournamentId, actor);
  const admin = canAdminister(actor.role, member?.member_role ?? null);
  if (!admin && (input.userId !== actor.id || !member || member.player_status === "withdrawn")) {
    throw new ApiError(403, "FORBIDDEN", "Solo puedes reportar tu propio pago");
  }
  const payee = await db
    .prepare("SELECT user_id FROM tournament_members WHERE tournament_id = ? AND user_id = ?")
    .bind(tournamentId, input.userId)
    .first();
  if (!payee)
    throw new ApiError(422, "BUSINESS_RULE_VIOLATION", "Ese jugador no está en el torneo");
  const id = randomId();
  const now = nowIso();
  const body = { id, status: "reported" as const };
  await db.batch(
    withOptional(
      [
        db
          .prepare(
            `INSERT INTO payments (id, tournament_id, user_id, method, amount_minor, status, reference, created_at)
             VALUES (?, ?, ?, ?, ?, 'reported', ?, ?)`,
          )
          .bind(
            id,
            tournamentId,
            input.userId,
            input.method,
            input.amountMinor,
            input.reference ?? null,
            now,
          ),
        db
          .prepare(
            `INSERT INTO ledger_entries (id, tournament_id, user_id, entry_id, payment_id, kind, amount_minor, direction, created_at)
             VALUES (?, ?, ?, NULL, ?, 'payment_reported', ?, 'credit', ?)`,
          )
          .bind(randomId(), tournamentId, input.userId, id, input.amountMinor, now),
        auditStmt(db, tournamentId, actor.id, "payment.report", "payment", id, {
          userId: input.userId,
          amountMinor: input.amountMinor,
          method: input.method,
        }),
      ],
      rememberStmt(db, idem, 201, body, "EXISTS (SELECT 1 FROM payments WHERE id = ?)", [id]),
    ),
  );
  return body;
}

export async function confirmPayment(
  db: AppDB,
  tournamentId: string,
  paymentId: string,
  actor: { id: string; role: GlobalRole },
  method: "cash" | "transfer",
  idem: Idem | null,
): Promise<{ status: "confirmed" }> {
  await assertCanHandleMoney(db, tournamentId, actor);
  const payment = await db
    .prepare(
      "SELECT id, user_id, amount_minor, status FROM payments WHERE id = ? AND tournament_id = ?",
    )
    .bind(paymentId, tournamentId)
    .first<{ id: string; user_id: string; amount_minor: number; status: string }>();
  if (!payment) throw new ApiError(404, "NOT_FOUND", "No encontramos ese pago");
  if (payment.status !== "reported")
    throw new ApiError(409, "CONFLICT", "Ese pago ya fue decidido");
  const entries = await db
    .prepare(
      `SELECT e.id,
              e.amount_minor - COALESCE((
                SELECT SUM(pa.amount_minor) FROM payment_allocations pa
                JOIN payments p ON p.id = pa.payment_id AND p.status = 'confirmed'
                WHERE pa.entry_id = e.id
              ), 0) AS outstanding
       FROM entries e
       WHERE e.tournament_id = ? AND e.user_id = ? AND e.status = 'valid'
       ORDER BY e.created_at, e.id`,
    )
    .bind(tournamentId, payment.user_id)
    .all<{ id: string; outstanding: number }>();
  const allocations = allocatePayment(
    toMinor(payment.amount_minor),
    entries.map((entry) => ({ id: entry.id, outstandingMinor: toMinor(entry.outstanding) })),
  );
  const now = nowIso();
  const body = { status: "confirmed" as const };
  const marker =
    "EXISTS (SELECT 1 FROM payments WHERE id = ? AND status = 'confirmed' AND confirmed_at = ?)";
  const statements: Stmt[] = [
    db
      .prepare(
        `UPDATE payments SET status = 'confirmed', method = ?, confirmed_by = ?, confirmed_at = ?
         WHERE id = ? AND tournament_id = ? AND status = 'reported'`,
      )
      .bind(method, actor.id, now, paymentId, tournamentId),
  ];
  for (const allocation of allocations) {
    statements.push(
      db
        .prepare(
          `INSERT INTO payment_allocations (payment_id, entry_id, amount_minor)
           SELECT ?, ?, ?
           WHERE EXISTS (SELECT 1 FROM payments WHERE id = ? AND status = 'confirmed' AND confirmed_at = ?)`,
        )
        .bind(paymentId, allocation.entryId, Number(allocation.amountMinor), paymentId, now),
    );
  }
  statements.push(
    db
      .prepare(
        `INSERT INTO ledger_entries (id, tournament_id, user_id, entry_id, payment_id, kind, amount_minor, direction, created_at)
         SELECT ?, tournament_id, user_id, NULL, id, 'payment_confirmed', amount_minor, 'credit', ?
         FROM payments WHERE id = ? AND status = 'confirmed' AND confirmed_at = ?`,
      )
      .bind(randomId(), now, paymentId, now),
    auditStmt(
      db,
      tournamentId,
      actor.id,
      "payment.confirm",
      "payment",
      paymentId,
      { method },
      marker,
      [paymentId, now],
    ),
  );
  const results = await db.batch(
    withOptional(statements, rememberStmt(db, idem, 200, body, marker, [paymentId, now])),
  );
  if (results[0]?.changes !== 1) throw new ApiError(409, "CONFLICT", "Ese pago ya fue decidido");
  return body;
}

export async function voidPayment(
  db: AppDB,
  tournamentId: string,
  paymentId: string,
  actor: { id: string; role: GlobalRole },
  idem: Idem | null,
): Promise<{ status: "voided" }> {
  await assertCanHandleMoney(db, tournamentId, actor);
  const now = nowIso();
  const body = { status: "voided" as const };
  const marker =
    "EXISTS (SELECT 1 FROM payments WHERE id = ? AND status = 'voided' AND confirmed_at = ?)";
  const results = await db.batch(
    withOptional(
      [
        db
          .prepare(
            `UPDATE payments SET status = 'voided', confirmed_at = ?
             WHERE id = ? AND tournament_id = ? AND status IN ('reported', 'confirmed')`,
          )
          .bind(now, paymentId, tournamentId),
        db
          .prepare(
            `INSERT INTO ledger_entries (id, tournament_id, user_id, entry_id, payment_id, kind, amount_minor, direction, created_at)
             SELECT ?, tournament_id, user_id, NULL, id, 'payment_voided', amount_minor, 'debit', ?
             FROM payments WHERE id = ? AND status = 'voided' AND confirmed_at = ?`,
          )
          .bind(randomId(), now, paymentId, now),
        auditStmt(db, tournamentId, actor.id, "payment.void", "payment", paymentId, {}, marker, [
          paymentId,
          now,
        ]),
      ],
      rememberStmt(db, idem, 200, body, marker, [paymentId, now]),
    ),
  );
  if (results[0]?.changes !== 1) throw new ApiError(409, "CONFLICT", "Ese pago no se puede anular");
  return body;
}
