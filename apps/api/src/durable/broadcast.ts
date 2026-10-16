import type { Env } from "../env";

export async function broadcast(env: Env, tournamentId: string, payload: unknown): Promise<void> {
  try {
    const stub = env.TOURNAMENT_ROOM.get(env.TOURNAMENT_ROOM.idFromName(tournamentId));
    await stub.fetch("https://tournament-room/broadcast", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tournamentId, payload }),
    });
  } catch (error) {
    console.error("No se pudo avisar a la sala", error);
  }
}
