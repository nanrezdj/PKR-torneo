import type { CreateTournamentInput } from "@pkr/contracts";
import {
  type GlobalRole,
  assertBlindLevels,
  templateLevel,
  assertMinimumPlayers,
  assertPositiveMinor,
  assertPrizeRules,
  canAdminister,
  maxEntries,
  toMinor,
} from "@pkr/domain";
import { nowIso, randomId } from "../crypto";
import type { AppDB, Stmt } from "../db/app-db";
import type { Idem } from "../http";
import { ApiError } from "../http";
import {
  assertCanAdmin,
  assertCanHandleMoney,
  assertCanRead,
  auditStmt,
  memberOf,
  rememberStmt,
  withOptional,
} from "./support";

function collectInitialEntry(
  db: AppDB,
  tournamentId: string,
  userId: string,
  actorId: string,
  method: "cash" | "transfer",
  now: string,
  usedAt: string | null,
): Stmt[] {
  const entryId = randomId();
  const paymentId = randomId();
  return [
    db
      .prepare(
        `INSERT INTO entries (id, tournament_id, user_id, kind, rebuy_request_id, amount_minor, status, created_by, created_at, used_at)
         SELECT ?, t.id, ?, 'initial', NULL, t.entry_price_minor, 'valid', ?, ?, ?
         FROM tournaments t
         WHERE t.id = ?
           AND EXISTS (
             SELECT 1 FROM tournament_members m
             WHERE m.tournament_id = t.id AND m.user_id = ? AND m.player_status != 'withdrawn'
           )
           AND NOT EXISTS (
             SELECT 1 FROM entries e
             WHERE e.tournament_id = t.id AND e.user_id = ? AND e.kind = 'initial' AND e.status = 'valid'
           )`,
      )
      .bind(entryId, userId, actorId, now, usedAt, tournamentId, userId, userId),
    db
      .prepare(
        `INSERT INTO ledger_entries (id, tournament_id, user_id, entry_id, payment_id, kind, amount_minor, direction, created_at)
         SELECT ?, e.tournament_id, e.user_id, e.id, NULL, 'obligation_created', e.amount_minor, 'debit', ?
         FROM entries e WHERE e.id = ?`,
      )
      .bind(randomId(), now, entryId),
    db
      .prepare(
        `INSERT INTO payments (id, tournament_id, user_id, method, amount_minor, status, reference, confirmed_by, created_at, confirmed_at)
         SELECT ?, e.tournament_id, e.user_id, ?, e.amount_minor, 'confirmed', NULL, ?, ?, ?
         FROM entries e WHERE e.id = ?`,
      )
      .bind(paymentId, method, actorId, now, now, entryId),
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
      .bind(randomId(), entryId, now, paymentId),
  ];
}

export async function createTournament(
  db: AppDB,
  actorId: string,
  input: CreateTournamentInput,
  idem: Idem | null,
): Promise<{ id: string; version: number }> {
  assertPositiveMinor(toMinor(input.entryPriceMinor), "La entrada");
  assertPositiveMinor(toMinor(input.rebuyPriceMinor), "La recompra");
  assertPrizeRules(input.prizeRules);
  assertBlindLevels(input.blindLevels);
  const memberIds = [...new Set(input.memberIds.filter((id) => id !== input.hostUserId))];
  const ids = [input.hostUserId, ...memberIds];
  const adminUserId = input.adminUserId ?? null;
  const cashierUserId = input.cashierUserId ?? null;
  const levelAdvance = input.levelAdvance ?? "auto";
  const ladderMode = input.ladderMode ?? "custom";
  const opening = [...input.blindLevels].sort((a, b) => a.levelNo - b.levelNo)[0];
  const smallStep = input.blindSmallStep ?? opening.smallBlind;
  if (ladderMode === "template" && (!Number.isInteger(smallStep) || smallStep <= 0)) {
    throw new ApiError(
      422,
      "BUSINESS_RULE_VIOLATION",
      "El small inicial tiene que ser un monto entero",
    );
  }
  if (adminUserId && !ids.includes(adminUserId)) {
    throw new ApiError(
      422,
      "BUSINESS_RULE_VIOLATION",
      "El administrador tiene que estar en la mesa",
    );
  }
  if (cashierUserId && !ids.includes(cashierUserId)) {
    throw new ApiError(422, "BUSINESS_RULE_VIOLATION", "El cajero tiene que estar en la mesa");
  }
  const found = await db
    .prepare(`SELECT id FROM users WHERE id IN (${ids.map(() => "?").join(",")})`)
    .bind(...ids)
    .all<{ id: string }>();
  if (found.length !== ids.length) {
    throw new ApiError(422, "BUSINESS_RULE_VIOLATION", "El anfitrión o algún jugador no existe");
  }
  const id = randomId();
  const now = nowIso();
  const generated = ladderMode === "template" ? templateLevel(smallStep, 1) : null;
  if (ladderMode === "template" && !generated) {
    throw new ApiError(422, "BUSINESS_RULE_VIOLATION", "El small inicial tiene que ser un monto entero");
  }
  const first = generated ?? opening;
  const storedLevels = ladderMode === "template" ? [first] : input.blindLevels;
  const statements: Stmt[] = [
    db
      .prepare(
        `INSERT INTO tournaments (
           id, title, currency, status, host_user_id, cashier_user_id, created_by, entry_price_minor, rebuy_price_minor,
           max_rebuys, host_extra_rebuys, version, warning_seconds, level_advance, ladder_mode,
           blind_small_step, created_at
         ) VALUES (?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, 0, 15, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        input.title,
        input.currency,
        input.hostUserId,
        cashierUserId,
        actorId,
        input.entryPriceMinor,
        input.rebuyPriceMinor,
        input.maxRebuys,
        input.hostExtraRebuys,
        levelAdvance,
        ladderMode,
        ladderMode === "template" ? smallStep : 0,
        now,
      ),
    db
      .prepare(
        `INSERT INTO tournament_members (tournament_id, user_id, member_role, player_status, joined_at)
         VALUES (?, ?, ?, 'registered', ?)`,
      )
      .bind(id, input.hostUserId, adminUserId === input.hostUserId ? "admin" : "player", now),
  ];
  for (const userId of memberIds) {
    const role = userId === adminUserId ? "admin" : "player";
    statements.push(
      db
        .prepare(
          `INSERT INTO tournament_members (tournament_id, user_id, member_role, player_status, joined_at)
           VALUES (?, ?, ?, 'registered', ?)`,
        )
        .bind(id, userId, role, now),
    );
  }
  for (const userId of ids) {
    statements.push(
      ...collectInitialEntry(db, id, userId, actorId, input.entryMethod ?? "cash", now, null),
    );
  }
  for (const rule of input.prizeRules) {
    statements.push(
      db
        .prepare("INSERT INTO prize_rules (tournament_id, place, basis_points) VALUES (?, ?, ?)")
        .bind(id, rule.place, rule.basisPoints),
    );
  }
  for (const level of storedLevels) {
    statements.push(
      db
        .prepare(
          `INSERT INTO blind_levels (tournament_id, level_no, kind, small_blind, big_blind, ante, duration_seconds)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          id,
          level.levelNo,
          level.kind,
          level.smallBlind,
          level.bigBlind,
          level.ante,
          level.durationSeconds,
        ),
    );
  }
  statements.push(
    db
      .prepare(
        `INSERT INTO tournament_clock (tournament_id, level_no, state, remaining_seconds, started_at_ms, version)
         VALUES (?, 1, 'stopped', ?, NULL, 0)`,
      )
      .bind(id, first.durationSeconds),
    auditStmt(db, id, actorId, "tournament.create", "tournament", id, {
      title: input.title,
      hostUserId: input.hostUserId,
    }),
  );
  const body = { id, version: 0 };
  await db.batch(
    withOptional(
      statements,
      rememberStmt(db, idem, 201, body, "EXISTS (SELECT 1 FROM tournaments WHERE id = ?)", [id]),
    ),
  );
  return body;
}

export async function addMember(
  db: AppDB,
  tournamentId: string,
  userId: string,
  method: "cash" | "transfer",
  actor: { id: string; role: GlobalRole },
): Promise<void> {
  const { tournament } = await assertCanHandleMoney(db, tournamentId, actor);
  if (tournament.status === "closed" || tournament.status === "archived") {
    throw new ApiError(409, "CONFLICT", "El torneo ya está cerrado");
  }
  const user = await db.prepare("SELECT id FROM users WHERE id = ?").bind(userId).first();
  if (!user) throw new ApiError(422, "BUSINESS_RULE_VIOLATION", "Ese jugador no existe");
  const now = nowIso();
  const live = tournament.status === "live";
  const statements: Stmt[] = [
    db
      .prepare(
        `INSERT INTO tournament_members (tournament_id, user_id, member_role, player_status, joined_at)
         VALUES (?, ?, 'player', ?, ?)`,
      )
      .bind(tournamentId, userId, live ? "active" : "registered", now),
    ...collectInitialEntry(db, tournamentId, userId, actor.id, method, now, live ? now : null),
    auditStmt(db, tournamentId, actor.id, "member.add", "user", userId, { method }),
  ];
  await db.batch(statements);
}

export async function collectInitialPayment(
  db: AppDB,
  tournamentId: string,
  userId: string,
  method: "cash" | "transfer",
  actor: { id: string; role: GlobalRole },
): Promise<void> {
  const { tournament } = await assertCanHandleMoney(db, tournamentId, actor);
  const member = await memberOf(db, tournamentId, userId);
  if (!member || member.player_status === "withdrawn" || member.player_status === "eliminated") {
    throw new ApiError(422, "BUSINESS_RULE_VIOLATION", "Ese jugador no está en la mesa");
  }
  const now = nowIso();
  const live = tournament.status === "live" || tournament.status === "finalizing";
  const statements = collectInitialEntry(
    db,
    tournamentId,
    userId,
    actor.id,
    method,
    now,
    live ? now : null,
  );
  const results = await db.batch(statements);
  if (results[0]?.changes !== 1) {
    throw new ApiError(409, "CONFLICT", "Ese jugador ya tiene la primera entrada");
  }
}

export async function startTournament(
  db: AppDB,
  tournamentId: string,
  actor: { id: string; role: GlobalRole },
  idem: Idem | null,
): Promise<{ status: "live" }> {
  const { tournament } = await assertCanAdmin(db, tournamentId, actor);
  if (tournament.status !== "draft" && tournament.status !== "ready") {
    throw new ApiError(409, "CONFLICT", "El torneo no se puede iniciar");
  }
  const members = await db
    .prepare(
      `SELECT m.user_id
       FROM tournament_members m
       WHERE m.tournament_id = ? AND m.player_status IN ('registered', 'active')
         AND EXISTS (
           SELECT 1 FROM entries e
           WHERE e.tournament_id = m.tournament_id AND e.user_id = m.user_id
             AND e.kind = 'initial' AND e.status = 'valid'
             AND (
               SELECT COALESCE(SUM(pa.amount_minor), 0)
               FROM payment_allocations pa
               JOIN payments p ON p.id = pa.payment_id AND p.status = 'confirmed'
               WHERE pa.entry_id = e.id
             ) >= e.amount_minor
         )
       ORDER BY m.joined_at, m.user_id`,
    )
    .bind(tournamentId)
    .all<{ user_id: string }>();
  const roster = await db
    .prepare(
      `SELECT COUNT(*) AS total FROM tournament_members
       WHERE tournament_id = ? AND player_status IN ('registered', 'active')`,
    )
    .bind(tournamentId)
    .first<{ total: number }>();
  if ((roster?.total ?? 0) !== members.length) {
    throw new ApiError(
      422,
      "BUSINESS_RULE_VIOLATION",
      "Cada jugador tiene que tener la primera entrada pagada",
    );
  }
  try {
    assertMinimumPlayers(members.length);
  } catch (error) {
    throw new ApiError(
      422,
      "BUSINESS_RULE_VIOLATION",
      error instanceof Error ? error.message : "Hacen falta al menos 3 jugadores para iniciar",
    );
  }
  const now = nowIso();
  const nextVersion = tournament.version + 1;
  const statements: Stmt[] = [
    db
      .prepare(
        `UPDATE tournaments SET status = 'live', version = ?
         WHERE id = ? AND status IN ('draft', 'ready') AND version = ?`,
      )
      .bind(nextVersion, tournamentId, tournament.version),
    db
      .prepare(
        `UPDATE entries SET used_at = ?
         WHERE tournament_id = ? AND kind = 'initial' AND status = 'valid' AND used_at IS NULL`,
      )
      .bind(now, tournamentId),
    db
      .prepare(
        `UPDATE tournament_members SET player_status = 'active'
         WHERE tournament_id = ? AND player_status = 'registered'`,
      )
      .bind(tournamentId),
  ];
  const body = { status: "live" as const };
  statements.push(
    auditStmt(
      db,
      tournamentId,
      actor.id,
      "tournament.start",
      "tournament",
      tournamentId,
      {},
      "EXISTS (SELECT 1 FROM tournaments WHERE id = ? AND version = ?)",
      [tournamentId, nextVersion],
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
        "EXISTS (SELECT 1 FROM tournaments WHERE id = ? AND version = ?)",
        [tournamentId, nextVersion],
      ),
    ),
  );
  if (results[0]?.changes !== 1)
    throw new ApiError(409, "CONFLICT", "El torneo no se puede iniciar");
  return body;
}

export async function assignCashier(
  db: AppDB,
  tournamentId: string,
  userId: string,
  actor: { id: string; role: GlobalRole },
): Promise<{ cashierUserId: string }> {
  await assertCanAdmin(db, tournamentId, actor);
  const member = await memberOf(db, tournamentId, userId);
  if (!member || member.player_status === "withdrawn") {
    throw new ApiError(
      422,
      "BUSINESS_RULE_VIOLATION",
      "El cajero tiene que ser un jugador de la mesa",
    );
  }
  const result = await db
    .prepare("UPDATE tournaments SET cashier_user_id = ? WHERE id = ?")
    .bind(userId, tournamentId)
    .run();
  if (result.changes !== 1) throw new ApiError(404, "NOT_FOUND", "No encontramos ese torneo");
  await auditStmt(db, tournamentId, actor.id, "cashier.assign", "user", userId, {
    cashierUserId: userId,
  }).run();
  return { cashierUserId: userId };
}

export async function bustPlayer(
  db: AppDB,
  tournamentId: string,
  userId: string,
  actor: { id: string; role: GlobalRole },
): Promise<void> {
  const { tournament } = await assertCanHandleMoney(db, tournamentId, actor);
  const member = await memberOf(db, tournamentId, userId);
  if (!member || member.player_status !== "active") {
    throw new ApiError(422, "BUSINESS_RULE_VIOLATION", "Ese jugador no está en juego");
  }
  const played = await db
    .prepare(
      `SELECT COUNT(*) AS total FROM entries
       WHERE tournament_id = ? AND user_id = ? AND status = 'valid'`,
    )
    .bind(tournamentId, userId)
    .first<{ total: number }>();
  const cap = maxEntries(
    tournament.host_user_id === userId,
    tournament.max_rebuys,
    tournament.host_extra_rebuys,
  );
  if ((played?.total ?? 0) < cap) {
    throw new ApiError(
      422,
      "BUSINESS_RULE_VIOLATION",
      "Solo se marca BUSTED cuando ya gastó su última entrada",
    );
  }
  const result = await db
    .prepare(
      `UPDATE tournament_members SET player_status = 'eliminated'
       WHERE tournament_id = ? AND user_id = ? AND player_status = 'active'`,
    )
    .bind(tournamentId, userId)
    .run();
  if (result.changes !== 1) throw new ApiError(409, "CONFLICT", "Ese jugador ya no está en juego");
  await auditStmt(db, tournamentId, actor.id, "player.bust", "user", userId, {}).run();
}

export async function withdrawPlayer(
  db: AppDB,
  tournamentId: string,
  userId: string,
  actor: { id: string; role: GlobalRole },
): Promise<void> {
  const { tournament, member } = await assertCanRead(db, tournamentId, actor);
  const self = actor.id === userId;
  if (!self && !canAdminister(actor.role, member?.member_role ?? null)) {
    throw new ApiError(403, "FORBIDDEN", "No puedes retirar a ese jugador");
  }
  if (!self && tournament.host_user_id === userId && actor.role !== "super_admin") {
    throw new ApiError(403, "FORBIDDEN", "No puedes retirar al anfitrión");
  }
  const result = await db
    .prepare(
      `UPDATE tournament_members SET player_status = 'withdrawn'
       WHERE tournament_id = ? AND user_id = ? AND player_status IN ('registered', 'active')`,
    )
    .bind(tournamentId, userId)
    .run();
  if (result.changes !== 1) throw new ApiError(409, "CONFLICT", "Ese jugador no está activo");
  await db
    .prepare("UPDATE tournaments SET cashier_user_id = NULL WHERE id = ? AND cashier_user_id = ?")
    .bind(tournamentId, userId)
    .run();
  await auditStmt(db, tournamentId, actor.id, "member.withdraw", "user", userId, {}).run();
}

export async function listTournaments(db: AppDB, user: { id: string; role: GlobalRole }) {
  return db
    .prepare(
      `SELECT id, title, currency, status, host_user_id, entry_price_minor, rebuy_price_minor, created_at
       FROM tournaments t
       WHERE ? = 'super_admin'
          OR EXISTS (SELECT 1 FROM tournament_members m WHERE m.tournament_id = t.id AND m.user_id = ?)
       ORDER BY created_at DESC`,
    )
    .bind(user.role, user.id)
    .all();
}

export async function listUsers(db: AppDB, user: { id: string; role: GlobalRole }, query: string) {
  const like = `%${query.trim().toLowerCase()}%`;
  if (user.role === "super_admin") {
    return db
      .prepare(
        `SELECT id, email, display_name AS displayName, role FROM users
         WHERE lower(email) LIKE ? OR lower(display_name) LIKE ?
         ORDER BY display_name LIMIT 50`,
      )
      .bind(like, like)
      .all();
  }
  return db
    .prepare(
      `SELECT DISTINCT u.id, u.email, u.display_name AS displayName, u.role
       FROM users u
       JOIN tournament_members mine ON mine.user_id = ?
       JOIN tournament_members peer ON peer.tournament_id = mine.tournament_id AND peer.user_id = u.id
       WHERE lower(u.email) LIKE ? OR lower(u.display_name) LIKE ?
       ORDER BY u.display_name LIMIT 50`,
    )
    .bind(user.id, like, like)
    .all();
}
