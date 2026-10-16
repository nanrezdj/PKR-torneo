import { d1Adapter } from "../db/d1";
import type { Env } from "../env";
import { syncAndReadClock } from "../services/clock";

export class TournamentRoom implements DurableObject {
  private readonly sockets = new Set<WebSocket>();

  constructor(
    private readonly state: DurableObjectState,
    private readonly env: Env,
  ) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.headers.get("Upgrade")?.toLowerCase() === "websocket") {
      return this.connect(url);
    }
    if (url.pathname.endsWith("/broadcast") && request.method === "POST") {
      const body = (await request.json()) as { tournamentId?: string; payload?: unknown };
      if (body.tournamentId) await this.state.storage.put("tournamentId", body.tournamentId);
      this.push(JSON.stringify(body.payload ?? { type: "tournament-updated" }));
      if (body.tournamentId) await this.arm(body.tournamentId);
      return new Response(null, { status: 204 });
    }
    return new Response("No encontrado", { status: 404 });
  }

  async alarm(): Promise<void> {
    const tournamentId = await this.state.storage.get<string>("tournamentId");
    if (!tournamentId) return;
    const clock = await syncAndReadClock(d1Adapter(this.env.DB), tournamentId, Date.now());
    this.push(JSON.stringify({ type: "clock", clock }));
    await this.schedule(clock.state, clock.remainingSeconds);
  }

  private async connect(url: URL): Promise<Response> {
    const tournamentId = url.searchParams.get("tournamentId");
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    server.accept();
    this.sockets.add(server);
    server.addEventListener("close", () => this.sockets.delete(server));
    if (tournamentId) {
      await this.state.storage.put("tournamentId", tournamentId);
      const clock = await syncAndReadClock(d1Adapter(this.env.DB), tournamentId, Date.now());
      server.send(JSON.stringify({ type: "clock", clock }));
      await this.schedule(clock.state, clock.remainingSeconds);
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  private push(message: string): void {
    for (const socket of this.sockets) {
      try {
        socket.send(message);
      } catch {
        this.sockets.delete(socket);
      }
    }
  }

  private async arm(tournamentId: string): Promise<void> {
    const clock = await syncAndReadClock(d1Adapter(this.env.DB), tournamentId, Date.now());
    await this.schedule(clock.state, clock.remainingSeconds);
  }

  private async schedule(state: string, remainingSeconds: number): Promise<void> {
    if (state !== "running") {
      await this.state.storage.deleteAlarm();
      return;
    }
    await this.state.storage.setAlarm(Date.now() + Math.max(remainingSeconds, 1) * 1000);
  }
}
