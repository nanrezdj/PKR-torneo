import type { CreateTournamentInput } from "@pkr/contracts";
import { describe, expect, it } from "vitest";
import type { AppDB } from "../src/db/app-db";
import { ApiError } from "../src/http";
import { actOnClock, syncAndReadClock } from "../src/services/clock";
import { confirmPayment, createPayment, voidPayment } from "../src/services/payments";
import { getSummary, getTournament } from "../src/services/read";
import { approveRebuy, requestRebuy } from "../src/services/rebuy";
import { finalizeTournament } from "../src/services/results";
import {
  assignCashier,
  createTournament,
  startTournament,
  withdrawPlayer,
} from "../src/services/tournaments";
import { openTestDb } from "./sqlite";

const admin = "11111111-1111-4111-8111-111111111111";
const host = "22222222-2222-4222-8222-222222222222";
const carlos = "33333333-3333-4333-8333-333333333333";
const ana = "44444444-4444-4444-8444-444444444444";
const outsider = "55555555-5555-4555-8555-555555555555";

const input: CreateTournamentInput = {
  title: "Torneo de prueba",
  hostUserId: host,
  memberIds: [ana, carlos],
  currency: "CRC",
  entryPriceMinor: 10000,
  rebuyPriceMinor: 5000,
  maxRebuys: 4,
  hostExtraRebuys: 1,
  entryMethod: "cash",
  prizeRules: [
    { place: 1, basisPoints: 5000 },
    { place: 2, basisPoints: 3000 },
    { place: 3, basisPoints: 2000 },
  ],
  blindLevels: [
    { levelNo: 1, kind: "play", smallBlind: 100, bigBlind: 200, ante: 0, durationSeconds: 120 },
    { levelNo: 2, kind: "play", smallBlind: 200, bigBlind: 400, ante: 0, durationSeconds: 120 },
  ],
};

async function seed(db: AppDB) {
  for (const [id, email, name, role] of [
    [admin, "admin@pkr.local", "Admin", "super_admin"],
    [host, "juan@pkr.local", "Juan Pérez", "player"],
    [carlos, "carlos@pkr.local", "Carlos M.", "player"],
    [ana, "ana@pkr.local", "Ana R.", "player"],
    [outsider, "luis@pkr.local", "Luis G.", "player"],
  ] as const) {
    await db
      .prepare("INSERT INTO users (id, email, display_name, role) VALUES (?, ?, ?, ?)")
      .bind(id, email, name, role)
      .run();
  }
}

async function rebuy(db: AppDB, tournamentId: string, userId: string) {
  const request = await requestRebuy(db, tournamentId, userId, { method: "cash" }, null);
  const approved = await approveRebuy(
    db,
    tournamentId,
    request.id,
    { id: admin, role: "super_admin" },
    "cash",
    null,
  );
  const entry = await db
    .prepare("SELECT amount_minor FROM entries WHERE id = ?")
    .bind(approved.entryId)
    .first<{ amount_minor: number }>();
  return entry?.amount_minor;
}

describe("motor financiero", () => {
  it("cumple límites, pagos, premios y visibilidad", async () => {
    const db = openTestDb();
    await seed(db);
    const actor = { id: admin, role: "super_admin" as const };
    const created = await createTournament(db, admin, input, null);
    let summary = await getSummary(db, created.id, actor);
    expect(summary.committedMinor).toBe(30000);
    expect(summary.collectedMinor).toBe(30000);
    await startTournament(db, created.id, actor, null);
    const started = await getTournament(db, created.id, actor);
    expect(started.players.every((player) => player.initialState === "used")).toBe(true);

    const pending = await requestRebuy(db, created.id, ana, { method: "cash" }, null);
    summary = await getSummary(db, created.id, actor);
    expect(summary.committedMinor).toBe(30000);
    expect(summary.rebuyCount).toBe(0);
    expect(summary.collectedMinor).toBe(30000);
    await approveRebuy(db, created.id, pending.id, actor, "cash", null);
    summary = await getSummary(db, created.id, actor);
    expect(summary.committedMinor).toBe(35000);
    expect(summary.collectedMinor).toBe(35000);
    expect(summary.rebuyCount).toBe(1);
    expect(summary.projectedPrizes.reduce((sum, prize) => sum + prize.amountMinor, 0)).toBe(35000);

    const reported = await createPayment(
      db,
      created.id,
      actor,
      { userId: ana, method: "cash", amountMinor: 4000 },
      null,
    );
    summary = await getSummary(db, created.id, actor);
    expect(summary.collectedMinor).toBe(35000);
    await expect(confirmPayment(db, created.id, reported.id, actor, "cash", null)).rejects.toThrow(
      /pendiente de cobro/,
    );

    const tooMuch = await createPayment(
      db,
      created.id,
      actor,
      { userId: ana, method: "transfer", amountMinor: 40000 },
      null,
    );
    await expect(
      confirmPayment(db, created.id, tooMuch.id, actor, "transfer", null),
    ).rejects.toThrow(/pendiente de cobro/);
    summary = await getSummary(db, created.id, actor);
    expect(summary.collectedMinor).toBe(35000);

    const rebuyPayment = await db
      .prepare(
        `SELECT id FROM payments WHERE tournament_id = ? AND user_id = ? AND amount_minor = 5000 AND status = 'confirmed'`,
      )
      .bind(created.id, ana)
      .first<{ id: string }>();
    await voidPayment(db, created.id, rebuyPayment?.id ?? "", actor, null);
    summary = await getSummary(db, created.id, actor);
    expect(summary.collectedMinor).toBe(30000);

    for (let index = 0; index < 3; index += 1) expect(await rebuy(db, created.id, ana)).toBe(5000);
    await expect(requestRebuy(db, created.id, ana, { method: "cash" }, null)).rejects.toThrow(
      /máximo|otra recompra/i,
    );
    const detail = await getTournament(db, created.id, actor);
    const anaRow = detail.players.find((player) => player.userId === ana);
    expect(anaRow?.rebuyCount).toBe(4);
    expect(anaRow?.entryCount).toBe(5);

    for (let index = 0; index < 5; index += 1) expect(await rebuy(db, created.id, host)).toBe(5000);
    await expect(requestRebuy(db, created.id, host, { method: "transfer" }, null)).rejects.toThrow(
      /máximo|otra recompra/i,
    );
    const hostRow = (await getTournament(db, created.id, actor)).players.find(
      (player) => player.userId === host,
    );
    expect(hostRow?.rebuyCount).toBe(5);
    expect(hostRow?.entryCount).toBe(6);

    await withdrawPlayer(db, created.id, ana, { id: ana, role: "player" });
    const afterExit = await getSummary(db, created.id, actor);
    expect(afterExit.committedMinor).toBe(
      (await getTournament(db, created.id, actor)).summary.committedMinor,
    );
    expect(afterExit.committedMinor).toBeGreaterThan(35000);

    await expect(
      getSummary(db, created.id, { id: outsider, role: "player" }),
    ).rejects.toMatchObject({ status: 403 });

    const finalSummary = await getSummary(db, created.id, actor);
    const closed = await finalizeTournament(
      db,
      created.id,
      actor,
      [
        { place: 1, userId: host },
        { place: 2, userId: ana },
        { place: 3, userId: carlos },
      ],
      null,
    );
    expect(closed.status).toBe("finalizing");
    const definitive = await getSummary(db, created.id, actor);
    expect(definitive.definitivePrizes?.reduce((sum, prize) => sum + prize.amountMinor, 0)).toBe(
      finalSummary.committedMinor,
    );
    expect(definitive.projectedPoolMinor).toBe(finalSummary.committedMinor);
  });

  it("no inicia con menos de 3 jugadores", async () => {
    const db = openTestDb();
    await seed(db);
    const actor = { id: admin, role: "super_admin" as const };
    const created = await createTournament(db, admin, { ...input, memberIds: [ana] }, null);
    await expect(startTournament(db, created.id, actor, null)).rejects.toThrow(/3 jugadores/);
  });

  it("guarda administrador, cajero y si el nivel pasa solo", async () => {
    const db = openTestDb();
    await seed(db);
    const created = await createTournament(
      db,
      admin,
      { ...input, adminUserId: ana, cashierUserId: ana, levelAdvance: "manual" },
      null,
    );
    const row = await db
      .prepare("SELECT cashier_user_id, level_advance FROM tournaments WHERE id = ?")
      .bind(created.id)
      .first<{ cashier_user_id: string; level_advance: string }>();
    expect(row).toEqual({ cashier_user_id: ana, level_advance: "manual" });
    const anaRole = await db
      .prepare("SELECT member_role FROM tournament_members WHERE tournament_id = ? AND user_id = ?")
      .bind(created.id, ana)
      .first<{ member_role: string }>();
    expect(anaRole?.member_role).toBe("admin");
    await expect(
      createTournament(db, admin, { ...input, cashierUserId: admin }, null),
    ).rejects.toThrow(/cajero/);
  });

  it("la escalera automática guarda el paso y sigue sin tope", async () => {
    const db = openTestDb();
    await seed(db);
    const actor = { id: admin, role: "super_admin" as const };
    const created = await createTournament(
      db,
      admin,
      { ...input, ladderMode: "template", blindSmallStep: 100 },
      null,
    );
    const row = await db
      .prepare("SELECT ladder_mode, blind_small_step FROM tournaments WHERE id = ?")
      .bind(created.id)
      .first<{ ladder_mode: string; blind_small_step: number }>();
    expect(row).toEqual({ ladder_mode: "template", blind_small_step: 100 });
    const initial = await db
      .prepare(
        "SELECT small_blind, big_blind, duration_seconds FROM blind_levels WHERE tournament_id = ? AND level_no = 1",
      )
      .bind(created.id)
      .first<{ small_blind: number; big_blind: number; duration_seconds: number }>();
    expect(initial).toEqual({ small_blind: 100, big_blind: 200, duration_seconds: 600 });

    await startTournament(db, created.id, actor, null);
    await actOnClock(db, created.id, actor, "start", 0, 1_000_000);
    const elapsed = (11 * 600 + 16 * 720) * 1000;
    const clock = await syncAndReadClock(db, created.id, 1_000_000 + elapsed);
    expect(clock.levelNo).toBe(28);
    expect(clock.smallBlind).toBe(21000);
    expect(clock.bigBlind).toBe(42000);
    expect(clock.durationSeconds).toBe(720);
    expect(clock.next?.smallBlind).toBe(22000);
    const curve = await db
      .prepare(
        "SELECT level_no, small_blind, big_blind, duration_seconds FROM blind_levels WHERE tournament_id = ? AND level_no IN (9, 12, 15, 27) ORDER BY level_no",
      )
      .bind(created.id)
      .all<{ level_no: number; small_blind: number; big_blind: number; duration_seconds: number }>();
    expect(curve).toEqual([
      { level_no: 9, small_blind: 1000, big_blind: 2000, duration_seconds: 600 },
      { level_no: 12, small_blind: 2000, big_blind: 4000, duration_seconds: 720 },
      { level_no: 15, small_blind: 8000, big_blind: 16000, duration_seconds: 720 },
      { level_no: 27, small_blind: 20000, big_blind: 40000, duration_seconds: 720 },
    ]);
    const stored = await db
      .prepare("SELECT COUNT(*) AS total FROM blind_levels WHERE tournament_id = ?")
      .bind(created.id)
      .first<{ total: number }>();
    expect(stored?.total).toBeGreaterThanOrEqual(4);

    const finite = await createTournament(db, admin, input, null);
    const mode = await db
      .prepare("SELECT ladder_mode FROM tournaments WHERE id = ?")
      .bind(finite.id)
      .first<{ ladder_mode: string }>();
    const finiteLevels = await db
      .prepare("SELECT COUNT(*) AS total FROM blind_levels WHERE tournament_id = ?")
      .bind(finite.id)
      .first<{ total: number }>();
    expect(mode?.ladder_mode).toBe("custom");
    expect(finiteLevels?.total).toBe(2);
  });

  it("solo el cajero o un administrador deciden recompras y la forma de pago", async () => {
    const db = openTestDb();
    await seed(db);
    const actor = { id: admin, role: "super_admin" as const };
    const created = await createTournament(db, admin, input, null);
    await startTournament(db, created.id, actor, null);
    await expect(assignCashier(db, created.id, admin, actor)).rejects.toThrow(/jugador de la mesa/);
    await assignCashier(db, created.id, carlos, actor);

    const pending = await requestRebuy(db, created.id, ana, { method: "cash" }, null);
    await expect(
      approveRebuy(db, created.id, pending.id, { id: host, role: "player" }, "cash", null),
    ).rejects.toThrow(/cajero/);
    await approveRebuy(
      db,
      created.id,
      pending.id,
      { id: carlos, role: "player" },
      "transfer",
      null,
    );
    const method = await db
      .prepare("SELECT method FROM rebuy_requests WHERE id = ?")
      .bind(pending.id)
      .first<{ method: string }>();
    expect(method?.method).toBe("transfer");

    const reported = await createPayment(
      db,
      created.id,
      { id: ana, role: "player" },
      { userId: ana, method: "cash", amountMinor: 1000 },
      null,
    );
    await expect(
      confirmPayment(db, created.id, reported.id, { id: host, role: "player" }, "cash", null),
    ).rejects.toThrow(/cajero/);
    await expect(
      confirmPayment(db, created.id, reported.id, { id: carlos, role: "player" }, "transfer", null),
    ).rejects.toThrow(/pendiente de cobro/);
    const payment = await db
      .prepare(
        "SELECT method, status FROM payments WHERE tournament_id = ? AND user_id = ? AND amount_minor = 5000",
      )
      .bind(created.id, ana)
      .first<{ method: string; status: string }>();
    expect(payment).toEqual({ method: "transfer", status: "confirmed" });
  });
});
