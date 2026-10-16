import {
  type GlobalRole,
  maxEntries,
  minorToNumber,
  rebuyCap,
  summarize,
  toMinor,
} from "@pkr/domain";
import type { AppDB } from "../db/app-db";
import { assertCanRead } from "./support";

export async function getTournament(
  db: AppDB,
  tournamentId: string,
  user: { id: string; role: GlobalRole },
) {
  const { tournament } = await assertCanRead(db, tournamentId, user);
  const [members, entries, allocations, rules, levels, requests, payments, definitive, paid] =
    await Promise.all([
      db
        .prepare(
          `SELECT m.user_id, m.member_role, m.player_status, u.display_name, u.email
         FROM tournament_members m JOIN users u ON u.id = m.user_id
         WHERE m.tournament_id = ? ORDER BY m.joined_at, u.display_name`,
        )
        .bind(tournamentId)
        .all<{
          user_id: string;
          member_role: "player" | "admin";
          player_status: string;
          display_name: string;
          email: string;
        }>(),
      db
        .prepare(
          "SELECT id, user_id, kind, amount_minor, used_at FROM entries WHERE tournament_id = ? AND status = 'valid' ORDER BY created_at, id",
        )
        .bind(tournamentId)
        .all<{
          id: string;
          user_id: string;
          kind: "initial" | "rebuy";
          amount_minor: number;
          used_at: string | null;
        }>(),
      db
        .prepare(
          `SELECT pa.entry_id, pa.amount_minor, p.status, p.user_id
         FROM payment_allocations pa JOIN payments p ON p.id = pa.payment_id
         WHERE p.tournament_id = ?`,
        )
        .bind(tournamentId)
        .all<{ entry_id: string; amount_minor: number; status: string; user_id: string }>(),
      db
        .prepare(
          "SELECT place, basis_points FROM prize_rules WHERE tournament_id = ? ORDER BY place",
        )
        .bind(tournamentId)
        .all<{ place: number; basis_points: number }>(),
      db
        .prepare(
          "SELECT level_no, kind, small_blind, big_blind, ante, duration_seconds FROM blind_levels WHERE tournament_id = ? ORDER BY level_no",
        )
        .bind(tournamentId)
        .all(),
      db
        .prepare(
          `SELECT r.id, r.user_id AS userId, u.display_name AS displayName, r.status, r.method, r.note, r.requested_at AS requestedAt
         FROM rebuy_requests r JOIN users u ON u.id = r.user_id
         WHERE r.tournament_id = ? ORDER BY r.requested_at DESC`,
        )
        .bind(tournamentId)
        .all(),
      db
        .prepare(
          `SELECT p.id, p.user_id AS userId, u.display_name AS displayName, p.method, p.amount_minor AS amountMinor,
                p.status, p.reference, p.created_at AS createdAt
         FROM payments p JOIN users u ON u.id = p.user_id
         WHERE p.tournament_id = ? ORDER BY p.created_at DESC`,
        )
        .bind(tournamentId)
        .all(),
      db
        .prepare(
          `SELECT a.place, a.user_id AS userId, u.display_name AS displayName, a.amount_minor AS amountMinor
         FROM prize_allocations a JOIN users u ON u.id = a.user_id
         WHERE a.tournament_id = ? ORDER BY a.place`,
        )
        .bind(tournamentId)
        .all<{ place: number; userId: string; displayName: string; amountMinor: number }>(),
      db
        .prepare(
          "SELECT COALESCE(SUM(amount_minor), 0) AS paid FROM prize_payouts WHERE tournament_id = ? AND status = 'confirmed'",
        )
        .bind(tournamentId)
        .first<{ paid: number }>(),
    ]);

  const collectedByEntry = new Map<string, number>();
  const collectedByUser = new Map<string, number>();
  for (const row of allocations) {
    if (row.status !== "confirmed") continue;
    collectedByEntry.set(
      row.entry_id,
      (collectedByEntry.get(row.entry_id) ?? 0) + row.amount_minor,
    );
    collectedByUser.set(row.user_id, (collectedByUser.get(row.user_id) ?? 0) + row.amount_minor);
  }
  const summary = summarize({
    validEntries: entries.map((entry) => ({
      kind: entry.kind,
      amountMinor: toMinor(entry.amount_minor),
    })),
    confirmedAllocatedMinor: toMinor(
      [...collectedByEntry.values()].reduce((sum, value) => sum + value, 0),
    ),
    prizeRules: rules.map((rule) => ({ place: rule.place, basisPoints: rule.basis_points })),
    definitivePrizes: definitive.length
      ? definitive.map((prize) => ({
          place: prize.place,
          userId: prize.userId,
          amountMinor: toMinor(prize.amountMinor),
        }))
      : null,
    prizesPaidMinor: toMinor(paid?.paid ?? 0),
  });
  const players = members.map((member) => {
    const own = entries.filter((entry) => entry.user_id === member.user_id);
    const initial = own.find((entry) => entry.kind === "initial");
    const isHost = tournament.host_user_id === member.user_id;
    return {
      userId: member.user_id,
      displayName: member.display_name,
      email: member.email,
      memberRole: member.member_role,
      playerStatus: member.player_status,
      isHost,
      isCashier: tournament.cashier_user_id === member.user_id,
      initialState: !initial ? "missing" : initial.used_at ? "used" : "paid",
      rebuyCount: own.filter((entry) => entry.kind === "rebuy").length,
      rebuyCap: rebuyCap(isHost, tournament.max_rebuys, tournament.host_extra_rebuys),
      entryCount: own.length,
      maxEntries: maxEntries(isHost, tournament.max_rebuys, tournament.host_extra_rebuys),
      committedMinor: own.reduce((sum, entry) => sum + entry.amount_minor, 0),
      collectedMinor: collectedByUser.get(member.user_id) ?? 0,
    };
  });
  return {
    id: tournament.id,
    title: tournament.title,
    currency: tournament.currency,
    status: tournament.status,
    hostUserId: tournament.host_user_id,
    cashierUserId: tournament.cashier_user_id,
    cashierName:
      members.find((member) => member.user_id === tournament.cashier_user_id)?.display_name ?? null,
    entryPriceMinor: tournament.entry_price_minor,
    rebuyPriceMinor: tournament.rebuy_price_minor,
    maxRebuys: tournament.max_rebuys,
    hostExtraRebuys: tournament.host_extra_rebuys,
    version: tournament.version,
    warningSeconds: tournament.warning_seconds,
    levelAdvance: tournament.level_advance === "manual" ? "manual" : "auto",
    ladderMode: tournament.ladder_mode === "template" ? "template" : "custom",
    blindSmallStep: tournament.blind_small_step,
    players,
    prizeRules: rules.map((rule) => ({ place: rule.place, basisPoints: rule.basis_points })),
    blindLevels: levels.map((level) => {
      const row = level as {
        level_no: number;
        kind: "play" | "break";
        small_blind: number;
        big_blind: number;
        ante: number;
        duration_seconds: number;
      };
      return {
        levelNo: row.level_no,
        kind: row.kind,
        smallBlind: row.small_blind,
        bigBlind: row.big_blind,
        ante: row.ante,
        durationSeconds: row.duration_seconds,
      };
    }),
    rebuyRequests: requests,
    payments,
    summary: {
      currency: tournament.currency,
      committedMinor: minorToNumber(summary.committedMinor),
      collectedMinor: minorToNumber(summary.collectedMinor),
      outstandingMinor: minorToNumber(summary.outstandingMinor),
      projectedPoolMinor: minorToNumber(summary.projectedPoolMinor),
      projectedPrizes: summary.projectedPrizes.map((prize) => ({
        place: prize.place,
        basisPoints: prize.basisPoints,
        amountMinor: minorToNumber(prize.amountMinor),
      })),
      definitivePrizes: definitive.length ? definitive : null,
      prizesPaidMinor: minorToNumber(summary.prizesPaidMinor),
      initialCount: summary.initialCount,
      rebuyCount: summary.rebuyCount,
      entryCount: summary.initialCount + summary.rebuyCount,
      playerCount: members.filter((member) => member.player_status !== "withdrawn").length,
    },
  };
}

export async function getSummary(
  db: AppDB,
  tournamentId: string,
  user: { id: string; role: GlobalRole },
) {
  const detail = await getTournament(db, tournamentId, user);
  return detail.summary;
}
