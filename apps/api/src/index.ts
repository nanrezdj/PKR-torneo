import { createApp } from "./app";
import { TournamentRoom } from "./durable/TournamentRoom";
import type { Env } from "./env";

export { TournamentRoom };

const app = createApp();

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (
      url.pathname.startsWith("/api/") ||
      request.headers.get("Upgrade")?.toLowerCase() === "websocket"
    ) {
      return app.fetch(request, env, ctx);
    }
    if (env.ASSETS) return env.ASSETS.fetch(request);
    return new Response("Poker Tournament Manager", {
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  },
} satisfies ExportedHandler<Env>;
