import {
  type ClockAction,
  type ClockLevel,
  type ClockSnapshot,
  type GlobalRole,
  type LevelAdvance,
  applyClockAction,
  catchUpClock,
  clockChanged,
  displayRemaining,
  templateLevel,
} from "@pkr/domain";
import { nowIso, randomId } from "../crypto";
import type { AppDB } from "../db/app-db";
import { ApiError } from "../http";
import { assertCanAdmin, assertCanRead } from "./support";

type ClockRow = {
  level_no: number;
  state: ClockSnapshot["state"];
  remaining_seconds: number;
  started_at_ms: number | null;
  version: number;
};

function toSnapshot(row: ClockRow): ClockSnapshot {
  return {
    levelNo: row.level_no,
    state: row.state,
    remainingSeconds: row.remaining_seconds,
    startedAtMs: row.started_at_ms,
    version: row.version,
  };
}

async function loadLevels(db: AppDB, tournamentId: string): Promise<ClockLevel[]> {
  const rows = await db
    .prepare(
      `SELECT level_no, kind, small_blind, big_blind, ante, duration_seconds
       FROM blind_levels WHERE tournament_id = ? ORDER BY level_no`,
    )
    .bind(tournamentId)
    .all<{
      level_no: number;
      kind: "play" | "break";
      small_blind: number;
      big_blind: number;
      ante: number;
      duration_seconds: number;
    }>();
  return rows.map((row) => ({
    levelNo: row.level_no,
    kind: row.kind,
    smallBlind: row.small_blind,
    bigBlind: row.big_blind,
    ante: row.ante,
    durationSeconds: row.duration_seconds,
  }));
}

async function loadClock(db: AppDB, tournamentId: string): Promise<ClockSnapshot> {
  const row = await db
    .prepare(
      "SELECT level_no, state, remaining_seconds, started_at_ms, version FROM tournament_clock WHERE tournament_id = ?",
    )
    .bind(tournamentId)
    .first<ClockRow>();
  if (!row) throw new ApiError(404, "NOT_FOUND", "Este torneo no tiene reloj");
  return toSnapshot(row);
}

export type ClockDto = {
  state: ClockSnapshot["state"];
  levelNo: number;
  remainingSeconds: number;
  serverTime: string;
  version: number;
  kind: "play" | "break";
  smallBlind: number;
  bigBlind: number;
  ante: number;
  durationSeconds: number;
  warningSeconds: number;
  levelAdvance: LevelAdvance;
  next: {
    levelNo: number;
    kind: "play" | "break";
    smallBlind: number;
    bigBlind: number;
    ante: number;
    durationSeconds: number;
  } | null;
};

function toDto(
  snapshot: ClockSnapshot,
  levels: ClockLevel[],
  nowMs: number,
  warningSeconds: number,
  levelAdvance: LevelAdvance,
): ClockDto {
  const current = levels.find((level) => level.levelNo === snapshot.levelNo) ?? levels[0];
  const next = levels.find((level) => level.levelNo === snapshot.levelNo + 1) ?? null;
  if (!current) throw new ApiError(422, "BUSINESS_RULE_VIOLATION", "El torneo no tiene niveles");
  return {
    state: snapshot.state,
    levelNo: snapshot.levelNo,
    remainingSeconds: displayRemaining(snapshot, nowMs),
    serverTime: new Date(nowMs).toISOString(),
    version: snapshot.version,
    kind: current.kind,
    smallBlind: current.smallBlind,
    bigBlind: current.bigBlind,
    ante: current.ante,
    durationSeconds: current.durationSeconds,
    warningSeconds,
    levelAdvance,
    next: next
      ? {
          levelNo: next.levelNo,
          kind: next.kind,
          smallBlind: next.smallBlind,
          bigBlind: next.bigBlind,
          ante: next.ante,
          durationSeconds: next.durationSeconds,
        }
      : null,
  };
}

type ClockSettings = {
  warningSeconds: number;
  levelAdvance: LevelAdvance;
  ladderMode: "template" | "custom";
  smallStep: number;
};

async function clockSettings(db: AppDB, tournamentId: string): Promise<ClockSettings> {
  const row = await db
    .prepare(
      "SELECT warning_seconds, level_advance, ladder_mode, blind_small_step FROM tournaments WHERE id = ?",
    )
    .bind(tournamentId)
    .first<{
      warning_seconds: number;
      level_advance: string;
      ladder_mode: string;
      blind_small_step: number;
    }>();
  return {
    warningSeconds: row?.warning_seconds ?? 15,
    levelAdvance: row?.level_advance === "manual" ? "manual" : "auto",
    ladderMode: row?.ladder_mode === "template" ? "template" : "custom",
    smallStep: row?.blind_small_step ?? 0,
  };
}

function withTemplate(
  stored: ClockLevel[],
  through: number,
  settings: ClockSettings,
): ClockLevel[] {
  if (settings.ladderMode !== "template" || settings.smallStep <= 0) return stored;
  const known = new Set(stored.map((level) => level.levelNo));
  const levels = [...stored];
  const last = Math.max(through, stored.at(-1)?.levelNo ?? 1);
  for (let levelNo = 1; levelNo <= last; levelNo += 1) {
    if (known.has(levelNo)) continue;
    const level = templateLevel(settings.smallStep, levelNo);
    if (!level) break;
    levels.push(level);
  }
  return levels.sort((a, b) => a.levelNo - b.levelNo);
}

function horizon(snapshot: ClockSnapshot, levels: ClockLevel[], nowMs: number): number {
  const duration = Math.max(1, levels[0]?.durationSeconds ?? 60);
  const elapsed =
    snapshot.state === "running" && snapshot.startedAtMs !== null
      ? Math.max(0, Math.floor((nowMs - snapshot.startedAtMs) / 1000))
      : 0;
  return snapshot.levelNo + Math.min(500, Math.ceil(elapsed / duration) + 2);
}

export async function syncAndReadClock(
  db: AppDB,
  tournamentId: string,
  nowMs: number,
): Promise<ClockDto> {
  const levels = await loadLevels(db, tournamentId);
  const settings = await clockSettings(db, tournamentId);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const current = await loadClock(db, tournamentId);
    const expanded = withTemplate(levels, horizon(current, levels, nowMs), settings);
    const caught = catchUpClock(current, expanded, nowMs, settings.levelAdvance);
    const playable = withTemplate(levels, Math.max(caught.levelNo, current.levelNo) + 1, settings);
    const missing = playable.filter(
      (level) => !levels.some((row) => row.levelNo === level.levelNo),
    );
    if (missing.length > 0) {
      await db.batch(
        missing.map((level) =>
          db
            .prepare(
              `INSERT INTO blind_levels (tournament_id, level_no, kind, small_blind, big_blind, ante, duration_seconds)
               SELECT ?, ?, 'play', ?, ?, 0, ?
               WHERE NOT EXISTS (
                 SELECT 1 FROM blind_levels WHERE tournament_id = ? AND level_no = ?
               )`,
            )
            .bind(
              tournamentId,
              level.levelNo,
              level.smallBlind,
              level.bigBlind,
              level.durationSeconds,
              tournamentId,
              level.levelNo,
            ),
        ),
      );
      for (const level of missing) levels.push(level);
    }
    if (!clockChanged(current, caught)) {
      return toDto(current, playable, nowMs, settings.warningSeconds, settings.levelAdvance);
    }
    const nextVersion = current.version + 1;
    const results = await db.batch([
      db
        .prepare(
          `UPDATE tournament_clock
           SET level_no = ?, state = ?, remaining_seconds = ?, started_at_ms = ?, version = ?
           WHERE tournament_id = ? AND version = ?`,
        )
        .bind(
          caught.levelNo,
          caught.state,
          caught.remainingSeconds,
          caught.startedAtMs,
          nextVersion,
          tournamentId,
          current.version,
        ),
      db
        .prepare(
          `INSERT INTO clock_snapshots (id, tournament_id, level_no, state, remaining_seconds, version, created_at)
           SELECT ?, ?, ?, ?, ?, ?, ?
           WHERE EXISTS (SELECT 1 FROM tournament_clock WHERE tournament_id = ? AND version = ?)`,
        )
        .bind(
          randomId(),
          tournamentId,
          caught.levelNo,
          caught.state,
          caught.remainingSeconds,
          nextVersion,
          nowIso(),
          tournamentId,
          nextVersion,
        ),
    ]);
    if (results[0]?.changes === 1) {
      return toDto(
        { ...caught, version: nextVersion },
        playable,
        nowMs,
        settings.warningSeconds,
        settings.levelAdvance,
      );
    }
  }
  throw new ApiError(409, "CONFLICT", "No se pudo sincronizar el reloj");
}

export async function readClock(
  db: AppDB,
  tournamentId: string,
  user: { id: string; role: GlobalRole },
  nowMs: number,
): Promise<ClockDto> {
  await assertCanRead(db, tournamentId, user);
  return syncAndReadClock(db, tournamentId, nowMs);
}

export async function actOnClock(
  db: AppDB,
  tournamentId: string,
  actor: { id: string; role: GlobalRole },
  action: ClockAction,
  expectedVersion: number,
  nowMs: number,
): Promise<ClockDto> {
  await assertCanAdmin(db, tournamentId, actor);
  const levels = await loadLevels(db, tournamentId);
  const settings = await clockSettings(db, tournamentId);
  const current = await loadClock(db, tournamentId);
  const expanded = withTemplate(levels, current.levelNo + 2, settings);
  const next = applyClockAction(
    current,
    expanded,
    action,
    nowMs,
    expectedVersion,
    settings.levelAdvance,
  );
  const playable = withTemplate(levels, next.levelNo + 1, settings);
  const missing = playable.filter((level) => !levels.some((row) => row.levelNo === level.levelNo));
  const results = await db.batch([
    db
      .prepare(
        `UPDATE tournament_clock
         SET level_no = ?, state = ?, remaining_seconds = ?, started_at_ms = ?, version = ?
         WHERE tournament_id = ? AND version = ?`,
      )
      .bind(
        next.levelNo,
        next.state,
        next.remainingSeconds,
        next.startedAtMs,
        next.version,
        tournamentId,
        expectedVersion,
      ),
    db
      .prepare(
        `INSERT INTO clock_snapshots (id, tournament_id, level_no, state, remaining_seconds, version, created_at)
         SELECT ?, ?, ?, ?, ?, ?, ?
         WHERE EXISTS (SELECT 1 FROM tournament_clock WHERE tournament_id = ? AND version = ?)`,
      )
      .bind(
        randomId(),
        tournamentId,
        next.levelNo,
        next.state,
        next.remainingSeconds,
        next.version,
        nowIso(),
        tournamentId,
        next.version,
      ),
    ...missing.map((level) =>
      db
        .prepare(
          `INSERT INTO blind_levels (tournament_id, level_no, kind, small_blind, big_blind, ante, duration_seconds)
           SELECT ?, ?, 'play', ?, ?, 0, ?
           WHERE NOT EXISTS (SELECT 1 FROM blind_levels WHERE tournament_id = ? AND level_no = ?)
             AND EXISTS (SELECT 1 FROM tournament_clock WHERE tournament_id = ? AND version = ?)`,
        )
        .bind(
          tournamentId,
          level.levelNo,
          level.smallBlind,
          level.bigBlind,
          level.durationSeconds,
          tournamentId,
          level.levelNo,
          tournamentId,
          next.version,
        ),
    ),
  ]);
  if (results[0]?.changes !== 1) {
    throw new ApiError(409, "CONFLICT", "El reloj cambió. Actualiza e inténtalo de nuevo.");
  }
  return toDto(next, playable, nowMs, settings.warningSeconds, settings.levelAdvance);
}
