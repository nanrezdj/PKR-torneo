import { DomainError, VersionConflictError } from "./errors";

export type ClockState = "stopped" | "running" | "paused" | "finished";
export type LevelAdvance = "auto" | "manual";
export type ClockAction = "start" | "pause" | "resume" | "next" | "reset";

export type ClockLevel = {
  levelNo: number;
  durationSeconds: number;
  kind: "play" | "break";
  smallBlind: number;
  bigBlind: number;
  ante: number;
};

export type ClockSnapshot = {
  levelNo: number;
  state: ClockState;
  remainingSeconds: number;
  startedAtMs: number | null;
  version: number;
};

function ordered(levels: ClockLevel[]): ClockLevel[] {
  return [...levels].sort((a, b) => a.levelNo - b.levelNo);
}

const TEMPLATE_MULTIPLES = [
  1, 2, 3, 4, 5, 6, 7, 8, 10, 12, 15, 20, 30, 40, 80, 90, 100, 110, 120, 130, 140, 150, 160, 170,
  180, 190, 200,
] as const;

export const templateCurveLength = TEMPLATE_MULTIPLES.length;

function templateMultiple(levelNo: number): number | null {
  if (!Number.isInteger(levelNo) || levelNo <= 0) return null;
  if (levelNo <= TEMPLATE_MULTIPLES.length) return TEMPLATE_MULTIPLES[levelNo - 1];
  const multiple = 200 + (levelNo - TEMPLATE_MULTIPLES.length) * 10;
  return Number.isSafeInteger(multiple) ? multiple : null;
}

export function templateLevel(smallStep: number, levelNo: number): ClockLevel | null {
  const multiple = templateMultiple(levelNo);
  if (multiple === null || !Number.isInteger(smallStep) || smallStep <= 0) return null;
  const smallBlind = smallStep * multiple;
  const bigBlind = smallBlind * 2;
  if (!Number.isSafeInteger(smallBlind) || !Number.isSafeInteger(bigBlind)) return null;
  return {
    levelNo,
    durationSeconds: levelNo >= 12 ? 12 * 60 : 10 * 60,
    kind: "play",
    smallBlind,
    bigBlind,
    ante: 0,
  };
}

export function assertBlindLevels(levels: ClockLevel[]): void {
  if (levels.length === 0) throw new DomainError("Agrega al menos un nivel");
  const levelsInOrder = ordered(levels);
  for (let index = 0; index < levelsInOrder.length; index += 1) {
    const level = levelsInOrder[index];
    if (level.levelNo !== index + 1)
      throw new DomainError("Los niveles deben numerarse desde 1 sin saltos");
    if (!Number.isInteger(level.durationSeconds) || level.durationSeconds <= 0) {
      throw new DomainError("La duración del nivel debe ser mayor que cero");
    }
    if (level.kind === "play" && level.bigBlind < level.smallBlind) {
      throw new DomainError("La ciega grande debe ser al menos la pequeña");
    }
  }
}

export function displayRemaining(snapshot: ClockSnapshot, nowMs: number): number {
  if (snapshot.state !== "running" || snapshot.startedAtMs === null)
    return snapshot.remainingSeconds;
  const elapsed = Math.floor((nowMs - snapshot.startedAtMs) / 1000);
  return Math.max(0, snapshot.remainingSeconds - elapsed);
}

export function catchUpClock(
  snapshot: ClockSnapshot,
  levels: ClockLevel[],
  nowMs: number,
  advance: LevelAdvance = "auto",
): ClockSnapshot {
  if (snapshot.state !== "running" || snapshot.startedAtMs === null) return snapshot;
  const levelsInOrder = ordered(levels);
  let levelNo = snapshot.levelNo;
  let remaining = snapshot.remainingSeconds;
  let startedAt = snapshot.startedAtMs;
  for (let guard = 0; guard < 1000; guard += 1) {
    const elapsed = Math.floor((nowMs - startedAt) / 1000);
    if (elapsed < remaining) {
      return { ...snapshot, levelNo, remainingSeconds: remaining, startedAtMs: startedAt };
    }
    const index = levelsInOrder.findIndex((level) => level.levelNo === levelNo);
    const next = levelsInOrder[index + 1];
    if (advance === "manual") {
      if (!next) {
        return {
          ...snapshot,
          levelNo,
          state: "finished",
          remainingSeconds: 0,
          startedAtMs: null,
        };
      }
      return {
        ...snapshot,
        levelNo,
        state: "paused",
        remainingSeconds: 0,
        startedAtMs: null,
      };
    }
    if (!next) {
      return {
        ...snapshot,
        levelNo,
        state: "finished",
        remainingSeconds: 0,
        startedAtMs: null,
      };
    }
    const overflow = elapsed - remaining;
    levelNo = next.levelNo;
    remaining = next.durationSeconds;
    startedAt = nowMs - overflow * 1000;
  }
  throw new DomainError("No se pudo sincronizar el reloj");
}

export function applyClockAction(
  snapshot: ClockSnapshot,
  levels: ClockLevel[],
  action: ClockAction,
  nowMs: number,
  expectedVersion: number,
  advance: LevelAdvance = "auto",
): ClockSnapshot {
  if (snapshot.version !== expectedVersion) throw new VersionConflictError();
  const base = catchUpClock(snapshot, levels, nowMs, advance);
  const levelsInOrder = ordered(levels);
  if (levelsInOrder.length === 0) throw new DomainError("El torneo no tiene niveles");
  const current = levelsInOrder.find((level) => level.levelNo === base.levelNo) ?? levelsInOrder[0];
  let next: Omit<ClockSnapshot, "version">;
  if (action === "reset") {
    const first = levelsInOrder[0];
    next = {
      levelNo: first.levelNo,
      state: "stopped",
      remainingSeconds: first.durationSeconds,
      startedAtMs: null,
    };
  } else if (action === "start") {
    if (base.state === "paused") throw new DomainError("El reloj está en pausa. Reanúdalo.");
    if (base.state === "running") throw new DomainError("El reloj ya está en marcha");
    if (base.state === "finished") throw new DomainError("El reloj ya terminó");
    next = {
      levelNo: current.levelNo,
      state: "running",
      remainingSeconds: current.durationSeconds,
      startedAtMs: nowMs,
    };
  } else if (action === "pause") {
    if (base.state !== "running") throw new DomainError("El reloj no está en marcha");
    next = {
      levelNo: base.levelNo,
      state: "paused",
      remainingSeconds: displayRemaining(base, nowMs),
      startedAtMs: null,
    };
  } else if (action === "resume") {
    if (base.state !== "paused") throw new DomainError("El reloj no está en pausa");
    next = {
      levelNo: base.levelNo,
      state: "running",
      remainingSeconds: base.remainingSeconds,
      startedAtMs: nowMs,
    };
  } else if (action === "next") {
    const index = levelsInOrder.findIndex((level) => level.levelNo === base.levelNo);
    const upcoming = levelsInOrder[index + 1];
    if (!upcoming) {
      next = { levelNo: base.levelNo, state: "finished", remainingSeconds: 0, startedAtMs: null };
    } else {
      const expiredManual =
        advance === "manual" && base.state === "paused" && base.remainingSeconds === 0;
      const state: ClockState =
        base.state === "running" || expiredManual
          ? "running"
          : base.state === "paused"
            ? "paused"
            : "stopped";
      next = {
        levelNo: upcoming.levelNo,
        state,
        remainingSeconds: upcoming.durationSeconds,
        startedAtMs: state === "running" ? nowMs : null,
      };
    }
  } else {
    throw new DomainError("Acción de reloj desconocida");
  }
  return { ...next, version: snapshot.version + 1 };
}

export function clockChanged(before: ClockSnapshot, after: ClockSnapshot): boolean {
  return (
    before.levelNo !== after.levelNo ||
    before.state !== after.state ||
    before.remainingSeconds !== after.remainingSeconds ||
    before.startedAtMs !== after.startedAtMs
  );
}
