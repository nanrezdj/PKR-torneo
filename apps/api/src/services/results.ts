import { type GlobalRole, allocatePrizes, minorToNumber, toMinor } from "@pkr/domain";
import { nowIso, randomId } from "../crypto";
import type { AppDB, Stmt } from "../db/app-db";
import { ApiError, type Idem } from "../http";
import { assertCanAdmin, auditStmt, rememberStmt, withOptional } from "./support";

export async function finalizeTournament(
  db: AppDB,
  tournamentId: string,
  actor: { id: string; role: GlobalRole },
  winners: { place: number; userId: string }[],
  idem: Idem | null,
): Promise<{ status: "finalizing" }> {
  const { tournament } = await assertCanAdmin(db, tournamentId, actor);
  if (tournament.status !== "live")
    throw new ApiError(409, "CONFLICT", "Solo se puede cerrar un torneo en juego");
  const rules = await db
    .prepare("SELECT place, basis_points FROM prize_rules WHERE tournament_id = ? ORDER BY place")
    .bind(tournamentId)
    .all<{ place: number; basis_points: number }>();
  if (winners.length !== rules.length) {
    throw new ApiError(422, "BUSINESS_RULE_VIOLATION", "Indica un ganador por cada puesto");
  }
  const poolRow = await db
    .prepare(
      "SELECT COALESCE(SUM(amount_minor), 0) AS pool FROM entries WHERE tournament_id = ? AND status = 'valid'",
    )
    .bind(tournamentId)
    .first<{ pool: number }>();
  const shares = allocatePrizes(
    toMinor(poolRow?.pool ?? 0),
    rules.map((rule) => ({ place: rule.place, basisPoints: rule.basis_points })),
  );
  const now = nowIso();
  const statements: Stmt[] = [
    db
      .prepare(
        "UPDATE tournaments SET status = 'finalizing', version = version + 1 WHERE id = ? AND status = 'live'",
      )
      .bind(tournamentId),
  ];
  for (const share of shares) {
    const winner = winners.find((item) => item.place === share.place);
    if (!winner) throw new ApiError(422, "BUSINESS_RULE_VIOLATION", "Falta un puesto de premio");
    const member = await db
      .prepare("SELECT user_id FROM tournament_members WHERE tournament_id = ? AND user_id = ?")
      .bind(tournamentId, winner.userId)
      .first();
    if (!member)
      throw new ApiError(422, "BUSINESS_RULE_VIOLATION", "El ganador no está en el torneo");
    statements.push(
      db
        .prepare(
          `INSERT INTO prize_allocations (tournament_id, place, user_id, amount_minor)
           SELECT ?, ?, ?, ?
           WHERE EXISTS (SELECT 1 FROM tournaments WHERE id = ? AND status = 'finalizing')`,
        )
        .bind(
          tournamentId,
          share.place,
          winner.userId,
          minorToNumber(share.amountMinor),
          tournamentId,
        ),
      db
        .prepare(
          `INSERT INTO ledger_entries (id, tournament_id, user_id, entry_id, payment_id, kind, amount_minor, direction, created_at)
           SELECT ?, ?, ?, NULL, NULL, 'prize_allocated', ?, 'credit', ?
           WHERE EXISTS (SELECT 1 FROM prize_allocations WHERE tournament_id = ? AND place = ?)`,
        )
        .bind(
          randomId(),
          tournamentId,
          winner.userId,
          minorToNumber(share.amountMinor),
          now,
          tournamentId,
          share.place,
        ),
    );
  }
  const body = { status: "finalizing" as const };
  statements.push(
    auditStmt(
      db,
      tournamentId,
      actor.id,
      "tournament.finalize",
      "tournament",
      tournamentId,
      { winners },
      "EXISTS (SELECT 1 FROM tournaments WHERE id = ? AND status = 'finalizing')",
      [tournamentId],
    ),
  );
  const results = await db.batch(
    withOptional(
      statements,
      rememberStmt(
        db,
        idem,
        200,
        body,
        "EXISTS (SELECT 1 FROM tournaments WHERE id = ? AND status = 'finalizing')",
        [tournamentId],
      ),
    ),
  );
  if (results[0]?.changes !== 1)
    throw new ApiError(409, "CONFLICT", "El torneo no se puede finalizar");
  return body;
}

export async function closeTournament(
  db: AppDB,
  tournamentId: string,
  actor: { id: string; role: GlobalRole },
  idem: Idem | null,
): Promise<{ status: "closed" }> {
  await assertCanAdmin(db, tournamentId, actor);
  const body = { status: "closed" as const };
  const results = await db.batch(
    withOptional(
      [
        db
          .prepare(
            "UPDATE tournaments SET status = 'closed' WHERE id = ? AND status = 'finalizing'",
          )
          .bind(tournamentId),
        auditStmt(
          db,
          tournamentId,
          actor.id,
          "tournament.close",
          "tournament",
          tournamentId,
          {},
          "EXISTS (SELECT 1 FROM tournaments WHERE id = ? AND status = 'closed')",
          [tournamentId],
        ),
      ],
      rememberStmt(
        db,
        idem,
        200,
        body,
        "EXISTS (SELECT 1 FROM tournaments WHERE id = ? AND status = 'closed')",
        [tournamentId],
      ),
    ),
  );
  if (results[0]?.changes !== 1)
    throw new ApiError(409, "CONFLICT", "Primero hay que finalizar el torneo");
  return body;
}

export async function payPrize(
  db: AppDB,
  tournamentId: string,
  actor: { id: string; role: GlobalRole },
  input: { place: number; amountMinor: number; method: "cash" | "transfer" | "other" },
  idem: Idem | null,
): Promise<{ id: string; status: "confirmed" }> {
  await assertCanAdmin(db, tournamentId, actor);
  const allocation = await db
    .prepare(
      "SELECT user_id, amount_minor FROM prize_allocations WHERE tournament_id = ? AND place = ?",
    )
    .bind(tournamentId, input.place)
    .first<{ user_id: string; amount_minor: number }>();
  if (!allocation)
    throw new ApiError(422, "BUSINESS_RULE_VIOLATION", "Ese puesto todavía no tiene premio");
  const id = randomId();
  const now = nowIso();
  const body = { id, status: "confirmed" as const };
  await db.batch(
    withOptional(
      [
        db
          .prepare(
            `INSERT INTO prize_payouts (id, tournament_id, place, user_id, amount_minor, status, method, confirmed_by, created_at, confirmed_at)
             VALUES (?, ?, ?, ?, ?, 'confirmed', ?, ?, ?, ?)`,
          )
          .bind(
            id,
            tournamentId,
            input.place,
            allocation.user_id,
            input.amountMinor,
            input.method,
            actor.id,
            now,
            now,
          ),
        db
          .prepare(
            `INSERT INTO ledger_entries (id, tournament_id, user_id, entry_id, payment_id, kind, amount_minor, direction, created_at)
             VALUES (?, ?, ?, NULL, NULL, 'prize_paid', ?, 'debit', ?)`,
          )
          .bind(randomId(), tournamentId, allocation.user_id, input.amountMinor, now),
        auditStmt(db, tournamentId, actor.id, "prize.pay", "prize_payout", id, {
          place: input.place,
        }),
      ],
      rememberStmt(db, idem, 201, body, "EXISTS (SELECT 1 FROM prize_payouts WHERE id = ?)", [id]),
    ),
  );
  return body;
}
