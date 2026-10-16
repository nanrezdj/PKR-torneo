import {
  type GlobalRole,
  type MemberRole,
  canAdminister,
  canHandleMoney,
  canReadTournament,
} from "@pkr/domain";
import { nowIso, randomId } from "../crypto";
import type { AppDB, SqlValue, Stmt } from "../db/app-db";
import { ApiError, type Idem } from "../http";

export type TournamentRow = {
  id: string;
  title: string;
  currency: string;
  status: string;
  host_user_id: string;
  cashier_user_id: string | null;
  created_by: string;
  entry_price_minor: number;
  rebuy_price_minor: number;
  max_rebuys: number;
  host_extra_rebuys: number;
  version: number;
  warning_seconds: number;
  level_advance: "auto" | "manual";
  ladder_mode: "template" | "custom";
  blind_small_step: number;
  created_at: string;
};

export type MemberRow = {
  user_id: string;
  member_role: MemberRole;
  player_status: string;
  display_name: string;
  email: string;
};

export async function tournamentOr404(db: AppDB, tournamentId: string): Promise<TournamentRow> {
  const row = await db
    .prepare(
      `SELECT id, title, currency, status, host_user_id, cashier_user_id, created_by, entry_price_minor, rebuy_price_minor,
              max_rebuys, host_extra_rebuys, version, warning_seconds, level_advance, ladder_mode,
              blind_small_step, created_at
       FROM tournaments WHERE id = ?`,
    )
    .bind(tournamentId)
    .first<TournamentRow>();
  if (!row) throw new ApiError(404, "NOT_FOUND", "No encontramos ese torneo");
  return row;
}

export async function memberOf(
  db: AppDB,
  tournamentId: string,
  userId: string,
): Promise<MemberRow | null> {
  return db
    .prepare(
      `SELECT m.user_id, m.member_role, m.player_status, u.display_name, u.email
       FROM tournament_members m JOIN users u ON u.id = m.user_id
       WHERE m.tournament_id = ? AND m.user_id = ?`,
    )
    .bind(tournamentId, userId)
    .first<MemberRow>();
}

export async function assertCanRead(
  db: AppDB,
  tournamentId: string,
  user: { id: string; role: GlobalRole },
): Promise<{ tournament: TournamentRow; member: MemberRow | null }> {
  const tournament = await tournamentOr404(db, tournamentId);
  const member = await memberOf(db, tournamentId, user.id);
  if (!canReadTournament(user.role, member !== null)) {
    throw new ApiError(403, "FORBIDDEN", "No participas en este torneo");
  }
  return { tournament, member };
}

export async function assertCanAdmin(
  db: AppDB,
  tournamentId: string,
  user: { id: string; role: GlobalRole },
): Promise<{ tournament: TournamentRow; member: MemberRow | null }> {
  const loaded = await assertCanRead(db, tournamentId, user);
  if (!canAdminister(user.role, loaded.member?.member_role ?? null)) {
    throw new ApiError(403, "FORBIDDEN", "No puedes administrar este torneo");
  }
  return loaded;
}

export async function assertCanHandleMoney(
  db: AppDB,
  tournamentId: string,
  user: { id: string; role: GlobalRole },
): Promise<{ tournament: TournamentRow; member: MemberRow | null }> {
  const loaded = await assertCanRead(db, tournamentId, user);
  const cashierStillPlaying =
    loaded.member !== null &&
    loaded.member.player_status !== "withdrawn" &&
    loaded.tournament.cashier_user_id === user.id;
  if (
    !canHandleMoney(
      user.role,
      loaded.member?.member_role ?? null,
      user.id,
      cashierStillPlaying ? loaded.tournament.cashier_user_id : null,
    )
  ) {
    throw new ApiError(
      403,
      "FORBIDDEN",
      "Solo el administrador o el cajero pueden decidir el dinero",
    );
  }
  return loaded;
}

export function auditStmt(
  db: AppDB,
  tournamentId: string | null,
  actorId: string,
  action: string,
  entityType: string,
  entityId: string,
  details: unknown,
  whenSql = "1 = 1",
  whenValues: SqlValue[] = [],
): Stmt {
  return db
    .prepare(
      `INSERT INTO audit_logs (id, tournament_id, actor_user_id, action, entity_type, entity_id, details_json, created_at)
       SELECT ?, ?, ?, ?, ?, ?, ?, ?
       WHERE ${whenSql}`,
    )
    .bind(
      randomId(),
      tournamentId,
      actorId,
      action,
      entityType,
      entityId,
      JSON.stringify(details),
      nowIso(),
      ...whenValues,
    );
}

export function rememberStmt(
  db: AppDB,
  idem: Idem | null,
  status: number,
  body: unknown,
  whenSql: string,
  whenValues: SqlValue[],
): Stmt | null {
  if (!idem) return null;
  return db
    .prepare(
      `INSERT INTO idempotency_keys (scope, key, request_hash, response_json, created_at)
       SELECT ?, ?, ?, ?, ?
       WHERE ${whenSql}`,
    )
    .bind(
      idem.scope,
      idem.key,
      idem.hash,
      JSON.stringify({ status, body }),
      nowIso(),
      ...whenValues,
    );
}

export function withOptional(statements: Stmt[], extra: Stmt | null): Stmt[] {
  return extra ? [...statements, extra] : statements;
}
