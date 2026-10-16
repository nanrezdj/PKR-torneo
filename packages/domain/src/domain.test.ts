import { describe, expect, it } from "vitest";
import { assertMinimumPlayers, canAdminister, canHandleMoney, canReadTournament } from "./access";
import {
  type ClockLevel,
  type ClockSnapshot,
  applyClockAction,
  catchUpClock,
  displayRemaining,
  templateLevel,
} from "./clock";
import { DomainError, VersionConflictError } from "./errors";
import { assertLayout } from "./layout";
import { formatAmount, percentToBasisPoints, toMinor } from "./money";
import { allocatePayment, confirmedCollected } from "./payments";
import { allocatePrizes } from "./prizes";
import { canApproveRebuy, maxEntries, rebuyCap, rebuyUnitPrice } from "./rebuy";
import { summarize } from "./summary";

const rules = [
  { place: 1, basisPoints: 5000 },
  { place: 2, basisPoints: 3000 },
  { place: 3, basisPoints: 2000 },
];

const levels: ClockLevel[] = [1, 2, 3].map((levelNo) => ({
  levelNo,
  durationSeconds: 120,
  kind: "play" as const,
  smallBlind: levelNo * 100,
  bigBlind: levelNo * 200,
  ante: 0,
}));

describe("dinero", () => {
  it("rechaza decimales y formatea colones sin usarlos en el cálculo", () => {
    expect(() => toMinor(10.5)).toThrow(DomainError);
    expect(toMinor(10000)).toBe(10000n);
    expect(formatAmount(10000)).toBe("₡10.000");
    expect(formatAmount(5000)).toBe("₡5.000");
    expect(percentToBasisPoints("50")).toBe(5000);
    expect(percentToBasisPoints("33,33")).toBe(3333);
  });
});

describe("recompras", () => {
  it("da 4 al jugador y 5 al anfitrión, y la quinta no es gratis", () => {
    expect(rebuyCap(false, 4, 1)).toBe(4);
    expect(rebuyCap(true, 4, 1)).toBe(5);
    expect(maxEntries(false, 4, 1)).toBe(5);
    expect(maxEntries(true, 4, 1)).toBe(6);
    expect(canApproveRebuy(3, 4)).toBe(true);
    expect(canApproveRebuy(4, 4)).toBe(false);
    expect(canApproveRebuy(4, 5)).toBe(true);
    expect(canApproveRebuy(5, 5)).toBe(false);
    expect(rebuyUnitPrice(5000n)).toBe(5000n);
  });
});

describe("premios", () => {
  it("reparte ₡95.000 en 50/30/20 sin pérdida", () => {
    const shares = allocatePrizes(95000n, rules);
    expect(shares.map((share) => share.amountMinor)).toEqual([47500n, 28500n, 19000n]);
  });

  it("asigna el residuo al puesto más alto cuando los restos empatan", () => {
    const shares = allocatePrizes(1n, [
      { place: 1, basisPoints: 5000 },
      { place: 2, basisPoints: 5000 },
    ]);
    expect(shares.map((share) => share.amountMinor)).toEqual([1n, 0n]);
  });

  it("suma exactamente el fondo en importes no divisibles", () => {
    for (const pool of [0n, 1n, 2n, 10n, 101n, 9999n, 10000n, 1234567n]) {
      const shares = allocatePrizes(pool, rules);
      const sum = shares.reduce((total, share) => total + share.amountMinor, 0n);
      expect(sum).toBe(pool);
    }
  });

  it("exige que los puntos base sumen 10000", () => {
    expect(() => allocatePrizes(1000n, [{ place: 1, basisPoints: 9999 }])).toThrow(DomainError);
  });
});

describe("pagos", () => {
  it("permite parciales, rechaza el sobrepago y no cuenta lo solo reportado", () => {
    const allocations = allocatePayment(4000n, [
      { id: "a", outstandingMinor: 10000n },
      { id: "b", outstandingMinor: 5000n },
    ]);
    expect(allocations).toEqual([{ entryId: "a", amountMinor: 4000n }]);
    expect(() => allocatePayment(16000n, [{ id: "a", outstandingMinor: 15000n }])).toThrow(
      DomainError,
    );
    expect(
      confirmedCollected([
        { status: "reported", allocatedMinor: 10000n },
        { status: "confirmed", allocatedMinor: 4000n },
        { status: "voided", allocatedMinor: 1000n },
      ]),
    ).toBe(4000n);
  });

  it("continúa con la siguiente obligación cuando la primera ya está cubierta", () => {
    expect(
      allocatePayment(7000n, [
        { id: "a", outstandingMinor: 6000n },
        { id: "b", outstandingMinor: 5000n },
      ]),
    ).toEqual([
      { entryId: "a", amountMinor: 6000n },
      { entryId: "b", amountMinor: 1000n },
    ]);
  });
});

describe("resumen", () => {
  it("separa comprometido, cobrado y pendiente", () => {
    const summary = summarize({
      validEntries: [
        { kind: "initial", amountMinor: 10000n },
        { kind: "rebuy", amountMinor: 5000n },
      ],
      confirmedAllocatedMinor: 10000n,
      prizeRules: rules,
      definitivePrizes: null,
      prizesPaidMinor: 0n,
    });
    expect(summary.committedMinor).toBe(15000n);
    expect(summary.collectedMinor).toBe(10000n);
    expect(summary.outstandingMinor).toBe(5000n);
    expect(summary.projectedPoolMinor).toBe(15000n);
    expect(summary.projectedPrizes.reduce((sum, prize) => sum + prize.amountMinor, 0n)).toBe(
      15000n,
    );
  });
});

describe("reloj", () => {
  const stopped: ClockSnapshot = {
    levelNo: 1,
    state: "stopped",
    remainingSeconds: 120,
    startedAtMs: null,
    version: 3,
  };

  it("al reconectar cae en el mismo nivel que quien no se desconectó", () => {
    const started = applyClockAction(stopped, levels, "start", 0, 3);
    const jumped = catchUpClock(started, levels, 300_000);
    let stepped = started;
    for (let second = 1; second <= 300; second += 1) {
      stepped = catchUpClock(stepped, levels, second * 1000);
    }
    expect(jumped.levelNo).toBe(3);
    expect(jumped.levelNo).toBe(stepped.levelNo);
    expect(displayRemaining(jumped, 300_000)).toBe(60);
    expect(displayRemaining(stepped, 300_000)).toBe(60);
  });

  it("la pausa congela el tiempo aunque pase el reloj de pared", () => {
    const started = applyClockAction(stopped, levels, "start", 0, 3);
    const paused = applyClockAction(started, levels, "pause", 30_000, started.version);
    expect(paused.remainingSeconds).toBe(90);
    const later = catchUpClock(paused, levels, 500_000);
    expect(later.remainingSeconds).toBe(90);
    expect(later.levelNo).toBe(1);
  });

  it("el template 100/200 sigue la tabla y después no tiene tope", () => {
    expect(templateLevel(100, 1)).toMatchObject({
      smallBlind: 100,
      bigBlind: 200,
      durationSeconds: 600,
    });
    expect(templateLevel(100, 8)).toMatchObject({ smallBlind: 800, bigBlind: 1600 });
    expect(templateLevel(100, 9)).toMatchObject({
      smallBlind: 1000,
      bigBlind: 2000,
      durationSeconds: 600,
    });
    expect(templateLevel(100, 11)).toMatchObject({ smallBlind: 1500, bigBlind: 3000 });
    expect(templateLevel(100, 12)).toMatchObject({
      smallBlind: 2000,
      bigBlind: 4000,
      durationSeconds: 720,
    });
    expect(templateLevel(100, 15)).toMatchObject({ smallBlind: 8000, bigBlind: 16000 });
    expect(templateLevel(100, 19)).toMatchObject({ smallBlind: 12000, bigBlind: 24000 });
    expect(templateLevel(100, 27)).toMatchObject({ smallBlind: 20000, bigBlind: 40000 });
    expect(templateLevel(100, 28)).toMatchObject({
      smallBlind: 21000,
      bigBlind: 42000,
      durationSeconds: 720,
    });
    expect(templateLevel(50, 9)).toMatchObject({ smallBlind: 500, bigBlind: 1000 });
  });

  it("en manual el nivel no avanza solo cuando llega a cero", () => {
    const started = applyClockAction(stopped, levels, "start", 0, 3);
    const held = catchUpClock(started, levels, 300_000, "manual");
    expect(held.levelNo).toBe(1);
    expect(held.state).toBe("paused");
    expect(held.remainingSeconds).toBe(0);
    const moved = applyClockAction(held, levels, "next", 300_000, held.version, "manual");
    expect(moved.levelNo).toBe(2);
    expect(moved.state).toBe("running");
  });

  it("rechaza una versión vieja", () => {
    const started = applyClockAction(stopped, levels, "start", 0, 3);
    expect(() => applyClockAction(started, levels, "pause", 10_000, 3)).toThrow(
      VersionConflictError,
    );
  });
});

describe("acceso y layout", () => {
  it("esconde el torneo a quien no es miembro y no deja ocultar el dinero", () => {
    expect(canReadTournament("player", false)).toBe(false);
    expect(canReadTournament("player", true)).toBe(true);
    expect(canReadTournament("super_admin", false)).toBe(true);
    expect(canAdminister("player", "player")).toBe(false);
    expect(canAdminister("player", "admin")).toBe(true);
    expect(canHandleMoney("player", "player", "cajero", "cajero")).toBe(true);
    expect(canHandleMoney("player", "player", "otro", "cajero")).toBe(false);
    expect(canHandleMoney("super_admin", null, "admin", "cajero")).toBe(true);
    expect(canHandleMoney("player", "admin", "admin-mesa", null)).toBe(true);
    expect(() => assertMinimumPlayers(2)).toThrow(DomainError);
    expect(() => assertMinimumPlayers(3)).not.toThrow();
    expect(() => assertLayout(["clock", "players"])).toThrow(DomainError);
    expect(() => assertLayout(["clock", "players", "money", "actions"])).not.toThrow();
  });
});
